/**
 * Google ADK (Agent Development Kit for TypeScript, @google/adk) engine —
 * the PRIMARY orchestration backbone (set ORCHESTRATOR_ENGINE=rest for the
 * documented plain-REST fallback).
 *
 * Each LLM-backed pipeline role is a named ADK `LlmAgent` definition
 * (script_agent, scene_planner_agent, safety_check_agent,
 * prompt_sanitizer_agent, review_alignment_agent,
 * review_prompt_improvement_agent), executed through the ADK `InMemoryRunner`
 * with Gemini served by Vertex AI (GOOGLE_GENAI_USE_VERTEXAI=true — see
 * config.ts which pins the process env for the underlying Google GenAI SDK).
 *
 * The ClassroomOrchestrator stays the single coordinator: agents never call
 * each other; ADK executes one agent per invocation with a structured-output
 * schema, and the orchestrator moves data between them.
 */

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
        return parseJsonLoose<T>(text);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr ?? new Error(`ADK_GENERATION_FAILED agent=${req.spanName}`);
  }
}
