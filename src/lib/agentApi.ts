// All backend access for KidTok Classroom goes through this module.
// Swap backends by changing VITE_AGENT_API_URL — no other file should call the API directly.

const BASE = import.meta.env.VITE_AGENT_API_URL as string | undefined;

export const isApiConfigured = (): boolean => Boolean(BASE && BASE.length > 0);

export type AgentStatus =
  | "scripting"
  | "planning_scenes"
  | "generating_images"
  | "narrating"
  | "reviewing"
  | "ready"
  | "failed";

export type SceneAnimation = "kenburns-in" | "kenburns-out" | "pan-left" | "pan-right";

export interface Scene {
  index: number;
  imageUrl: string;
  audioUrl: string;
  caption: string;
  durationMs: number;
  animation: SceneAnimation;
}

export interface Episode {
  id: string;
  topic: string;
  ageBand: number;
  createdAt: string;
  status: AgentStatus;
  scenes?: Scene[];
  error?: string;
}

function requireBase(): string {
  if (!BASE) {
    throw new Error(
      "The cartoon backend isn't configured yet. Please set VITE_AGENT_API_URL.",
    );
  }
  return BASE.replace(/\/$/, "");
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.text();
      detail = body ? ` — ${body.slice(0, 200)}` : "";
    } catch {
      // ignore
    }
    throw new Error(`Request failed (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

export async function createEpisode(input: {
  topic: string;
  ageBand: number;
}): Promise<{ id: string }> {
  const res = await fetch(`${requireBase()}/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle(res);
}

export async function getEpisode(id: string): Promise<Episode> {
  const res = await fetch(`${requireBase()}/episodes/${encodeURIComponent(id)}`);
  return handle(res);
}

export async function listEpisodes(): Promise<Episode[]> {
  const res = await fetch(`${requireBase()}/episodes`);
  return handle(res);
}

export const STATUS_COPY: Record<AgentStatus, { title: string; subtitle: string; step: number }> = {
  scripting: { title: "Writing the story…", subtitle: "Our writer agent is dreaming up a script.", step: 1 },
  planning_scenes: { title: "Planning the scenes…", subtitle: "Sketching out what each picture will show.", step: 2 },
  generating_images: { title: "Drawing the cartoon…", subtitle: "Our artist agent is painting every scene.", step: 3 },
  narrating: { title: "Recording the voice…", subtitle: "A friendly narrator is reading the story.", step: 4 },
  reviewing: { title: "Double‑checking everything…", subtitle: "Making sure it's kid‑perfect.", step: 5 },
  ready: { title: "Your cartoon is ready!", subtitle: "Press play to start watching.", step: 6 },
  failed: { title: "Something went wrong", subtitle: "Please try again in a moment.", step: 0 },
};

export const PIPELINE_STEPS = [
  "Script",
  "Scenes",
  "Images",
  "Narration",
  "Review",
  "Ready",
];
