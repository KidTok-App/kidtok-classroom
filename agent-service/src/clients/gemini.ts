/**
 * Vertex AI Gemini REST client (text + image).
 *
 * The exact call shapes (URL construction, generationConfig, safetySettings,
 * thinkingConfig, and `candidates[0].content.parts[].inlineData` parsing) are
 * ported from agent-service/legacy-reference/imageProviderClient.ts and
 * aiPromptSanitizer.ts. Auth is Application Default Credentials via
 * google-auth-library.
 *
 * RUNTIME MANDATE: this module is the ONLY place the service talks to an LLM
 * or image model, and it speaks exclusively to Vertex AI
 * (`*aiplatform.googleapis.com`) — Gemini via the Vertex publisher endpoint.
 */

import { GoogleAuth } from "google-auth-library";
import { buildVertexUrl, getThinkingPayload } from "../legacy/vertexRouting.js";
import type { GeneratedImage, ImageGen, TextLlm, TextLlmRequest } from "./interfaces.js";

const BACKOFF_SCHEDULE_MS = [1000, 3000, 7000];

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

interface GeminiCandidatesResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export class VertexAuth {
  private auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  async accessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("VERTEX_AUTH_FAILED: could not mint an access token via ADC");
    return token;
  }
}

async function postJson(
  url: string,
  token: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    return { status: resp.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractTextPart(json: unknown): string {
  const data = json as GeminiCandidatesResponse;
  if (data.promptFeedback?.blockReason) {
    throw new Error(`GEMINI_PROMPT_BLOCKED: ${data.promptFeedback.blockReason}`);
  }
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text) {
    const finish = data.candidates?.[0]?.finishReason ?? "NO_CANDIDATES";
    throw new Error(`GEMINI_EMPTY_RESPONSE: finishReason=${finish}`);
  }
  return text;
}

/** Strip accidental markdown fences before JSON.parse (defensive). */
function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(trimmed) as T;
}

export class VertexRestTextLlm implements TextLlm {
  readonly engine = "rest";
  constructor(
    private readonly authClient: VertexAuth,
    private readonly projectId: string,
    private readonly region: string,
    public readonly model: string,
  ) {}

  async generateJson<T>(req: TextLlmRequest): Promise<T> {
    const endpoint = buildVertexUrl(this.model, this.projectId, this.region, true, ":generateContent");
    const thinkingCfg = getThinkingPayload(this.model);
    const body = {
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      systemInstruction: { parts: [{ text: req.system }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: req.schema,
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
      },
      safetySettings:
        req.safetyMode === "analysis" ? ANALYSIS_SAFETY_SETTINGS : DEFAULT_SAFETY_SETTINGS,
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const token = await this.authClient.accessToken();
        const { status, json, text } = await postJson(endpoint, token, body, 90_000);
        if (status === 429 || status >= 500) {
          lastError = new Error(`GEMINI_TEXT_HTTP_${status}: ${text.substring(0, 200)}`);
          await sleep(BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)] ?? 3000);
          continue;
        }
        if (status !== 200) {
          throw new Error(`GEMINI_TEXT_HTTP_${status}: ${text.substring(0, 300)}`);
        }
        return parseJsonLoose<T>(extractTextPart(json));
      } catch (err) {
        if (err instanceof Error && /HTTP_4\d\d|PROMPT_BLOCKED/.test(err.message)) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)] ?? 3000);
      }
    }
    throw lastError ?? new Error("GEMINI_TEXT_FAILED");
  }
}

export class VertexGeminiImageGen implements ImageGen {
  constructor(
    private readonly authClient: VertexAuth,
    private readonly projectId: string,
    private readonly region: string,
    public readonly model: string,
  ) {}

  /**
   * One Gemini image call. Ported from geminiImageRequestRegional():
   * responseModalities IMAGE+TEXT, temperature 1.0, imageConfig under
   * generationConfig, internal 429/5xx retries with backoff, inlineData parse.
   * Returns null when the model produced no image part (caller treats it as a
   * soft failure and runs the sanitize-retry path).
   */
  async generatePng(prompt: string): Promise<GeneratedImage | null> {
    const endpoint = buildVertexUrl(this.model, this.projectId, this.region, true, ":generateContent");
    const thinkingCfg = getThinkingPayload(this.model);
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        temperature: 1.0,
        ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
        imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
      },
      safetySettings: DEFAULT_SAFETY_SETTINGS,
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.authClient.accessToken();
      let status: number;
      let json: unknown;
      let text: string;
      try {
        ({ status, json, text } = await postJson(endpoint, token, body, 120_000));
      } catch (err) {
        if (attempt < 2) {
          await sleep(BACKOFF_SCHEDULE_MS[attempt] ?? 3000);
          continue;
        }
        throw err instanceof Error ? err : new Error(String(err));
      }

      if (status === 429 || status >= 500) {
        if (attempt < 2) {
          await sleep(BACKOFF_SCHEDULE_MS[attempt] ?? 3000);
          continue;
        }
        throw new Error(`GEMINI_IMAGE_HTTP_${status}: ${text.substring(0, 200)}`);
      }
      if (status !== 200) {
        throw new Error(`GEMINI_IMAGE_HTTP_${status}: ${text.substring(0, 300)}`);
      }

      const data = json as GeminiCandidatesResponse;
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) return null;
      const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!imagePart?.inlineData?.data) return null;
      return {
        data: Buffer.from(imagePart.inlineData.data, "base64"),
        mimeType: imagePart.inlineData.mimeType || "image/png",
      };
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
