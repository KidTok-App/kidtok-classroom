/**
 * Shared domain types. The public episode shape MUST stay in lockstep with
 * the frontend contract in src/lib/agentApi.ts at the repo root.
 */

export type AgentStatus =
  | "scripting"
  | "planning_scenes"
  | "generating_images"
  | "generating_video"
  | "narrating"
  | "reviewing"
  | "ready"
  | "failed";

export type SceneAnimation = "kenburns-in" | "kenburns-out" | "pan-left" | "pan-right";

/** Animation cycle mandated by the assembly spec. */
export const ANIMATION_CYCLE: SceneAnimation[] = [
  "kenburns-in",
  "pan-left",
  "kenburns-out",
  "pan-right",
];

export interface ScriptScene {
  caption: string;
  narrationText: string;
  learningPoint: string;
}

export interface EpisodeScript {
  title: string;
  scenes: ScriptScene[]; // exactly 5
}

export interface PlannedScene extends ScriptScene {
  /** LLM-authored visual description for this scene. */
  visualDescription: string;
  /** Final rendered image prompt (template + tokens). */
  imagePrompt: string;
}

export interface SceneAsset {
  index: number;
  imageUrl: string;
  audioUrl: string;
  caption: string;
  durationMs: number;
  animation: SceneAnimation;
  /** True when the image fell back to the styled placeholder. */
  degraded?: boolean;
}

export interface EpisodeReview {
  score: number; // 0-100
  notes: string;
  promptImproved: boolean;
  promptVersionUsed: string | null;
  spanCount: number;
}

export interface EpisodeMetrics {
  stageDurationsMs: Record<string, number>;
  imageRetries: number;
  degradedScenes: number;
  safetyVerdict?: string;
  scenePromptVersion?: string | null;
}

export interface EpisodeDoc {
  id: string;
  topic: string;
  ageBand: number;
  createdAt: string; // ISO
  status: AgentStatus;
  generationMode?: "slides" | "video";
  videoUrl?: string;
  ownerId?: string;
  title?: string;
  scenes?: SceneAsset[];
  review?: EpisodeReview;
  error?: string;
  userSteerage?: string;
  metrics?: EpisodeMetrics;
}

/** Public response shape (matches frontend src/lib/agentApi.ts `Episode`). */
export function toPublicEpisode(doc: EpisodeDoc): Record<string, unknown> {
  return {
    id: doc.id,
    topic: doc.topic,
    ageBand: doc.ageBand,
    createdAt: doc.createdAt,
    status: doc.status,
    ...(doc.generationMode ? { generationMode: doc.generationMode } : {}),
    ...(doc.videoUrl ? { videoUrl: doc.videoUrl } : {}),
    ...(doc.ownerId ? { ownerId: doc.ownerId } : {}),
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.scenes ? { scenes: doc.scenes } : {}),
    ...(doc.review ? { review: doc.review } : {}),
    ...(doc.error ? { error: doc.error } : {}),
    ...(doc.userSteerage ? { userSteerage: doc.userSteerage } : {}),
  };
}

export interface SpanSummary {
  name: string;
  spanId: string;
  traceId: string;
  startTime: string | null;
  endTime: string | null;
  latencyMs: number | null;
  statusCode: string | null;
  attributes: Record<string, unknown>;
}
