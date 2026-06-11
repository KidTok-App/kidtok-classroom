import { trace } from "@opentelemetry/api";
import { withSpan, SPAN_KIND_ATTR, SPAN_KINDS } from "../tracing.js";
import { LlmAgent, InMemoryRunner } from "@google/adk";
import type { TextLlm, TextLlmRequest } from "./interfaces.js";

const APP_NAME = "kidtok-classroom";
const USER_ID = "kidtok-orchestrator";
const SYSTEM_STATE_KEY = "kidtok_system_instruction";

const ANALYSIS_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
];

const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

/** Strip accidental markdown fences before JSON.parse (defensive). */
function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(trimmed) as T;
}

export class AdkTextLlm implements TextLlm {
  readonly engine = "adk";
  /** One named ADK agent definition + runner per pipeline role (lazy). */
  private runners = new Map<string, InMemoryRunner>();

  constructor(public readonly model: string) {}

  private runnerFor(req: TextLlmRequest): InMemoryRunner {
    const existing = this.runners.get(req.spanName);
    if (existing) return existing;

    const agentName = req.spanName.replace(/-/g, "_") + "_agent";
    const agent = new LlmAgent({
      name: agentName,
      description: `KidTok Classroom ${req.spanName} sub-agent (structured output).`,
      model: this.model,
      // The orchestrator passes the per-episode system prompt through session
      // state — the agent DEFINITION stays stable while the briefing varies.
      instruction: (ctx) =>
        ctx.state.get<string>(SYSTEM_STATE_KEY) ?? "You are a helpful KidTok Classroom sub-agent.",
      outputSchema: req.schema as never,
      generateContentConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        safetySettings: (req.safetyMode === "analysis"
          ? ANALYSIS_SAFETY_SETTINGS
          : DEFAULT_SAFETY_SETTINGS) as never,
      },
    });
    const runner = new InMemoryRunner({ agent, appName: APP_NAME });
    this.runners.set(req.spanName, runner);
    return runner;
  }

  async generateJson<T>(req: TextLlmRequest): Promise<T> {
    const tracer = trace.getTracer("kidtok-classroom");
    return withSpan(
      tracer,
      `AdkTextLlm.${req.spanName}`,
      {
        [SPAN_KIND_ATTR]: SPAN_KINDS.LLM,
        "llm.model_name": this.model,
        "input.value": `System:\n${req.system}\n\nUser:\n${req.user}`,
      },
      async (span) => {
        const runner = this.runnerFor(req);
        const session = await runner.sessionService.createSession({
          appName: APP_NAME,
          userId: USER_ID,
          state: { [SYSTEM_STATE_KEY]: req.system },
        });

        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            let text = "";
            for await (const event of runner.runAsync({
              userId: USER_ID,
              sessionId: session.id,
              newMessage: { role: "user", parts: [{ text: req.user }] },
            })) {
              const parts = event.content?.parts ?? [];
              const chunk = parts
                .map((p) => (typeof p.text === "string" ? p.text : ""))
                .join("");
              // Keep the final complete model turn (non-streaming: one event).
              if (event.author && event.author !== "user" && chunk.trim()) {
                text = event.partial ? text + chunk : chunk;
              }
            }
            if (!text.trim()) throw new Error(`ADK_EMPTY_RESPONSE agent=${req.spanName}`);
            span.setAttribute("output.value", text);
            return parseJsonLoose<T>(text);
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        throw lastErr ?? new Error(`ADK_GENERATION_FAILED agent=${req.spanName}`);
      }
    );
  }
}
