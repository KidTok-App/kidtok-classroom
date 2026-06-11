// All backend access for KidTok Classroom goes through this module.
// Requests are proxied via /api/agent/* server routes, which read the
// AGENT_API_URL secret on the server. No public env var is needed.

const BASE = "/api/agent";

// The proxy is always present in this build. Configuration errors surface
// as a 500 from the server route, with a helpful message in the body.
export const isApiConfigured = (): boolean => true;

export type AgentStatus =
  | "scripting"
  | "planning_scenes"
  | "generating_images"
  | "generating_video"
  | "narrating"
  | "reviewing"
  | "preloading"
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
  generationMode?: "slides" | "video";
  videoUrl?: string;
  scenes?: Scene[];
  error?: string;
  userSteerage?: string;
  review?: {
    score: number;
    notes: string;
    promptImproved: boolean;
    promptVersionUsed: string | null;
    spanCount: number;
  };
}

export function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("kidtok_id_token");
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
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
  generationMode?: "slides" | "video";
  userSteerage?: string;
}): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/episodes`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(input),
  });
  return handle(res);
}

export async function getEpisode(id: string): Promise<Episode> {
  const res = await fetch(`${BASE}/episodes/${encodeURIComponent(id)}`, {
    headers: getAuthHeaders(),
  });
  return handle(res);
}

export async function listEpisodes(): Promise<Episode[]> {
  const res = await fetch(`${BASE}/episodes`, {
    headers: getAuthHeaders(),
  });
  return handle(res);
}

export const STATUS_COPY: Record<AgentStatus, { title: string; subtitle: string; step: number }> = {
  scripting: { title: "Writing the story…", subtitle: "Our writer agent is dreaming up a script.", step: 1 },
  planning_scenes: { title: "Planning the scenes…", subtitle: "Sketching out what each picture will show.", step: 2 },
  generating_images: { title: "Drawing the cartoon…", subtitle: "Our artist agent is painting every scene.", step: 3 },
  generating_video: { title: "Filming movie with Gemini Omni…", subtitle: "Rendering continuous animation and audio.", step: 3 },
  narrating: { title: "Recording the voice…", subtitle: "A friendly narrator is reading the story.", step: 4 },
  reviewing: { title: "Double‑checking everything…", subtitle: "Making sure it's kid‑perfect.", step: 5 },
  preloading: { title: "Tuning the magic player…", subtitle: "Gathering voice recordings and custom paintings.", step: 6 },
  ready: { title: "Your cartoon is ready!", subtitle: "Press play to start watching.", step: 7 },
  failed: { title: "Something went wrong", subtitle: "Please try again in a moment.", step: 0 },
};

export const PIPELINE_STEPS = [
  "Script",
  "Scenes",
  "Images",
  "Narration",
  "Review",
  "Tuning",
  "Ready",
];
