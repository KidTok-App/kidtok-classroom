/**
 * Provider interfaces — every external boundary of the pipeline sits behind
 * one of these so the orchestration logic is identical in production
 * (Vertex/Firestore/GCS/TTS/Phoenix) and in the offline smoke mode (fakes.ts).
 */

import type { EpisodeDoc, SpanSummary } from "../types.js";

export interface TextLlmRequest {
  /** Short name used for the OpenInference LLM child span. */
  spanName: string;
  system: string;
  user: string;
  /** Gemini responseSchema (uppercase JSON-schema dialect). */
  schema: object;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * "analysis" relaxes safetySettings to BLOCK_NONE for calls that ANALYZE
   * text (safety classifier, prompt sanitizer) — legacy parity. Generation
   * calls keep the default BLOCK_ONLY_HIGH.
   */
  safetyMode?: "default" | "analysis";
}

export interface TextLlm {
  /** Structured-output generation. Throws on transport or parse failure. */
  generateJson<T>(req: TextLlmRequest): Promise<T>;
  /** Identifier for logs/README ("adk" | "rest" | "fake"). */
  readonly engine: string;
  readonly model: string;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface ImageGen {
  /** Returns null on a non-retryable empty/blocked result. Throws on transport errors. */
  generatePng(prompt: string): Promise<GeneratedImage | null>;
  readonly model: string;
}

export interface VisualSafetyVerdict {
  safe: boolean;
  reasons: string[];
  categories: string[];
  soft_categories: string[];
  /** Set when the classifier infra failed and we fell back to safe:true (fail-open). */
  error?: string;
}

export interface VisualSafetyClassifier {
  classify(
    imageBytes: Buffer,
    mimeType: string,
    context: { topic: string; ageBand: number; episodeId: string; sceneIndex: number },
  ): Promise<VisualSafetyVerdict>;
}

export interface SpeechSynth {
  synthesizeMp3(
    text: string,
    cfg: { voiceName: string; languageCode: string; speakingRate: number; pitch: number },
  ): Promise<Buffer>;
}

export interface AssetStorage {
  /** Uploads and returns a public URL. */
  uploadBuffer(objectPath: string, data: Buffer, contentType: string): Promise<string>;
}

export interface EpisodeStore {
  create(doc: EpisodeDoc): Promise<void>;
  update(id: string, patch: Partial<EpisodeDoc>): Promise<void>;
  get(id: string): Promise<EpisodeDoc | null>;
  list(limit?: number): Promise<EpisodeDoc[]>;
}

export interface PromptVersion {
  template: string;
  versionId: string | null;
}

/**
 * Phoenix MCP surface used at runtime:
 *   - ScenePlannerAgent: getLatestPrompt / upsertPrompt (seed)
 *   - QualityReviewerAgent: getEpisodeSpans (MCP get-spans) + upsertPrompt
 */
export interface PhoenixMcp {
  getLatestPrompt(name: string): Promise<PromptVersion | null>;
  upsertPrompt(args: {
    name: string;
    description: string;
    template: string;
  }): Promise<PromptVersion>;
  getEpisodeSpans(episodeId: string, opts?: { limit?: number }): Promise<SpanSummary[]>;
  close(): Promise<void>;
}

export interface Providers {
  textLlm: TextLlm;
  imageGen: ImageGen;
  visualSafety: VisualSafetyClassifier;
  tts: SpeechSynth;
  storage: AssetStorage;
  store: EpisodeStore;
  phoenix: PhoenixMcp;
  /** Flush OTel spans so Phoenix can serve them to the reviewer. */
  forceFlushTracing: () => Promise<void>;
}
