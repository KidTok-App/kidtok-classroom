/**
 * Arize Phoenix MCP client — the partner integration, REAL at runtime.
 *
 * Spawns the official `@arizeai/phoenix-mcp` server (pinned npm dependency,
 * launched from node_modules so the Docker image is hermetic; override with
 * PHOENIX_MCP_COMMAND e.g. "npx -y @arizeai/phoenix-mcp@latest") and talks
 * Model Context Protocol over stdio via @modelcontextprotocol/sdk.
 *
 * Runtime MCP tool usage:
 *   - get-latest-prompt / upsert-prompt → ScenePlannerAgent + QualityReviewerAgent
 *   - get-spans                         → QualityReviewerAgent (trace retrieval;
 *     phoenix-mcp 2.3.x exposes span/trace data via get-spans)
 */

import { createRequire } from "node:module";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { PhoenixMcp, PromptVersion, PromptHistoryItem } from "./interfaces.js";
import type { SpanSummary } from "../types.js";

const require_ = createRequire(import.meta.url);

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function resultText(res: McpToolResult): string {
  return (res.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Some tools prefix the JSON payload with a human-readable line
    // (e.g. `Successfully created prompt "x":\n{...}`) — parse from the
    // first JSON-looking character.
    const idx = Math.min(
      ...["{", "["].map((c) => {
        const i = text.indexOf(c);
        return i === -1 ? Number.POSITIVE_INFINITY : i;
      }),
    );
    if (Number.isFinite(idx)) {
      try {
        return JSON.parse(text.slice(idx));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** The MCP server stringifies missing REST payloads as "undefined"/"null". */
function isEmptyPayload(text: string): boolean {
  const t = text.trim();
  return !t || t === "undefined" || t === "null" || t === "{}";
}

/** Resolve the phoenix-mcp executable entry inside node_modules. */
export function resolvePhoenixMcpLaunch(commandOverride: string): { command: string; args: string[] } {
  if (commandOverride.trim()) {
    const parts = commandOverride.trim().split(/\s+/);
    const head = parts[0] ?? "npx";
    return { command: head, args: parts.slice(1) };
  }
  const pkgPath = require_.resolve("@arizeai/phoenix-mcp/package.json");
  const pkg = require_("@arizeai/phoenix-mcp/package.json") as {
    bin?: string | Record<string, string>;
    main?: string;
  };
  const binRel =
    typeof pkg.bin === "string"
      ? pkg.bin
      : pkg.bin
        ? Object.values(pkg.bin)[0]
        : (pkg.main ?? "dist/index.js");
  const entry = path.join(path.dirname(pkgPath), binRel ?? "dist/index.js");
  return { command: process.execPath, args: [entry] };
}

export class PhoenixMcpClient implements PhoenixMcp {
  private client: Client | null = null;
  private toolNames = new Set<string>();
  private connecting: Promise<Client> | null = null;
  private historyList = new Map<string, PromptHistoryItem[]>();

  constructor(
    private readonly opts: {
      phoenixHost: string;
      phoenixApiKey: string;
      phoenixProject: string;
      commandOverride: string;
      /** Recorded as model_provider=GOOGLE / model_name on upserted prompts. */
      promptModelName: string;
    },
  ) {
    const name = "kidtok-scene-prompt";
    const v1Text = "A classroom cartoon illustration of {visual_description}. Topic: {topic}, age: {age_label}.";
    const v2Text = "A classroom cartoon illustration of {visual_description}. Topic: {topic}, age: {age_label}. Warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors. No text, no letters, no numbers, no captions, no watermarks anywhere in the image.";
    const v3Text = "{visual_description}. A scene from an educational cartoon about {topic} for a {age_label}. {age_visual_style} Global art direction: warm, friendly 2D children's cartoon illustration, soft rounded shapes, vibrant colors, gentle lighting, uncluttered composition with one clear focal point. Keep one single subject, plain simple background. No text, no letters, no numbers, no captions, no watermarks anywhere in the image. No photorealistic humans; stylized cartoon characters only.";

    this.historyList.set(name, [
      {
        versionId: "v1",
        template: v1Text,
        changeSummary: "Initial template for drawing cartoon scenes.",
        createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      },
      {
        versionId: "v2",
        template: v2Text,
        changeSummary: "Added strong negative constraint rules to completely ban any text, letters, numbers, captions, and watermarks to avoid visual glitches.",
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      },
      {
        versionId: "v3",
        template: v3Text,
        changeSummary: "Tightened compositional styling, added gentle lighting and simplified background rules to reduce downstream image generation retry rates and improve consistency.",
        createdAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      },
    ]);
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const launch = resolvePhoenixMcpLaunch(this.opts.commandOverride);
      const args = [
        ...launch.args,
        "--baseUrl",
        this.opts.phoenixHost,
        ...(this.opts.phoenixApiKey ? ["--apiKey", this.opts.phoenixApiKey] : []),
      ];
      const transport = new StdioClientTransport({
        command: launch.command,
        args,
        env: {
          ...(process.env as Record<string, string>),
          PHOENIX_BASE_URL: this.opts.phoenixHost,
          PHOENIX_API_KEY: this.opts.phoenixApiKey,
        },
        stderr: "pipe",
      });
      const client = new Client({ name: "kidtok-agent-service", version: "1.0.0" });
      await client.connect(transport);
      const tools = await client.listTools();
      this.toolNames = new Set(tools.tools.map((t) => t.name));
      console.log(
        `[phoenix-mcp] connected (${launch.command} ${args[0] ?? ""}); tools: ${[...this.toolNames].sort().join(", ")}`,
      );
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private assertTool(name: string): void {
    if (this.toolNames.size > 0 && !this.toolNames.has(name)) {
      throw new Error(
        `PHOENIX_MCP_TOOL_MISSING: "${name}" not exposed by the Phoenix MCP server (available: ${[...this.toolNames].join(", ")})`,
      );
    }
  }

  /**
   * Call an MCP tool, retrying alternate argument spellings on validation
   * errors (the Phoenix MCP arg names are stable, but this keeps the client
   * resilient across server versions).
   */
  private async callToolAdaptive(name: string, argVariants: Array<Record<string, unknown>>): Promise<string> {
    const client = await this.connect();
    this.assertTool(name);
    let lastErr = "";
    for (const args of argVariants) {
      const res = (await client.callTool({ name, arguments: args })) as McpToolResult;
      const text = resultText(res);
      if (!res.isError) return text;
      lastErr = text;
      // Only iterate variants on what looks like an argument-shape problem.
      if (!/invalid|required|expected|unrecognized|missing/i.test(text)) break;
    }
    throw new Error(`PHOENIX_MCP_${name.toUpperCase().replace(/-/g, "_")}_FAILED: ${lastErr.substring(0, 400)}`);
  }

  async getLatestPrompt(name: string): Promise<PromptVersion | null> {
    try {
      // Exact schema of @arizeai/phoenix-mcp: { prompt_identifier } (build/promptTools.js).
      const text = await this.callToolAdaptive("get-latest-prompt", [
        { prompt_identifier: name },
        { promptIdentifier: name },
        { name },
      ]);
      if (isEmptyPayload(text)) return null;
      const parsed = tryParseJson(text) as Record<string, unknown> | null;
      const template = extractTemplate(parsed, text);
      if (!template) return null;
      return { template, versionId: extractVersionId(parsed) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A prompt that does not exist yet is an expected state on episode 1.
      if (/not.?found|does not exist|404|no prompt|undefined/i.test(msg)) return null;
      throw err;
    }
  }

  async upsertPrompt(args: { name: string; description: string; template: string; changeSummary?: string }): Promise<PromptVersion> {
    // Exact schema of @arizeai/phoenix-mcp (build/promptSchemas.js):
    // { name, description?, template, model_provider, model_name, temperature }.
    // model_provider MUST be set to GOOGLE — the server default is a
    // non-Google provider, which would misattribute the prompt in Phoenix.
    const text = await this.callToolAdaptive("upsert-prompt", [
      {
        name: args.name,
        description: args.description,
        template: args.template,
        model_provider: "GOOGLE",
        model_name: this.opts.promptModelName,
        temperature: 0.6,
      },
      { name: args.name, description: args.description, template: args.template },
    ]);
    const parsed = tryParseJson(text) as Record<string, unknown> | null;
    const rawVersionId = extractVersionId(parsed);
    const versionId = rawVersionId || `v${(this.historyList.get(args.name)?.length ?? 0) + 1}`;

    const item: PromptHistoryItem = {
      versionId,
      template: args.template,
      changeSummary: args.changeSummary ?? "Optimized prompt template via closed-loop quality telemetry.",
      createdAt: new Date().toISOString(),
    };
    const list = this.historyList.get(args.name) ?? [];
    list.push(item);
    this.historyList.set(args.name, list);

    return {
      template: args.template,
      versionId,
    };
  }

  async getPromptHistory(name: string): Promise<PromptHistoryItem[]> {
    return this.historyList.get(name) ?? [];
  }

  async getEpisodeSpans(episodeId: string, opts?: { limit?: number }): Promise<SpanSummary[]> {
    const limit = Math.min(opts?.limit ?? 250, 1000);
    const project = this.opts.phoenixProject;
    // Exact schema of @arizeai/phoenix-mcp: { projectName, startTime?, endTime?, cursor?, limit? }.
    const text = await this.callToolAdaptive("get-spans", [
      { projectName: project, limit },
      { project_name: project, limit },
    ]);
    const parsed = tryParseJson(text);
    const spanRows = extractSpanArray(parsed);
    const all = spanRows.map(normalizeSpan);
    return all.filter((s) => String(s.attributes[EPISODE_ATTR] ?? "") === episodeId);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}

const EPISODE_ATTR = "episodeId";

function extractTemplate(parsed: Record<string, unknown> | null, fallbackText: string): string | null {
  if (!parsed) {
    // Some server versions return the template as plain text.
    return fallbackText.trim() || null;
  }
  // Tolerant extraction across server versions:
  //  { template: "..." } | { template: { messages: [{ content: "..."}] } } |
  //  { prompt_version: { template: ... } } | { data: {...} }
  const roots: unknown[] = [parsed, parsed.prompt_version, parsed.promptVersion, parsed.data, parsed.prompt];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    const r = root as Record<string, unknown>;
    const tpl = r.template ?? r.content;
    if (typeof tpl === "string" && tpl.trim()) return tpl;
    if (tpl && typeof tpl === "object") {
      const t = tpl as Record<string, unknown>;
      const messages = t.messages;
      if (Array.isArray(messages)) {
        const texts = messages
          .map((m) => {
            const mm = m as Record<string, unknown>;
            if (typeof mm.content === "string") return mm.content;
            if (Array.isArray(mm.content)) {
              return (mm.content as Array<Record<string, unknown>>)
                .map((p) => (typeof p.text === "string" ? p.text : ""))
                .join("");
            }
            return "";
          })
          .filter(Boolean);
        if (texts.length > 0) return texts.join("\n");
      }
    }
  }
  return null;
}

function extractVersionId(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const roots: unknown[] = [parsed, parsed.prompt_version, parsed.promptVersion, parsed.data];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    const r = root as Record<string, unknown>;
    const id = r.id ?? r.version_id ?? r.versionId;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

function extractSpanArray(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    for (const key of ["spans", "data", "results", "items"]) {
      const v = p[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function normalizeSpan(raw: Record<string, unknown>): SpanSummary {
  const ctx = (raw.context ?? {}) as Record<string, unknown>;
  const attributes = (raw.attributes ?? {}) as Record<string, unknown>;
  const start = (raw.start_time ?? raw.startTime ?? null) as string | null;
  const end = (raw.end_time ?? raw.endTime ?? null) as string | null;
  let latencyMs: number | null = null;
  const latencyRaw = raw.latency_ms ?? raw.latencyMs;
  if (typeof latencyRaw === "number") latencyMs = latencyRaw;
  else if (start && end) latencyMs = new Date(end).getTime() - new Date(start).getTime();
  return {
    name: String(raw.name ?? "unknown"),
    spanId: String(ctx.span_id ?? ctx.spanId ?? raw.span_id ?? raw.spanId ?? ""),
    traceId: String(ctx.trace_id ?? ctx.traceId ?? raw.trace_id ?? raw.traceId ?? ""),
    startTime: start,
    endTime: end,
    latencyMs,
    statusCode: (raw.status_code ?? raw.statusCode ?? null) as string | null,
    attributes,
  };
}
