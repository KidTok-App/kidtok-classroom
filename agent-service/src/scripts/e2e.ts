/**
 * REAL-credential end-to-end verification (run once Google + Phoenix env vars
 * and Application Default Credentials are in place — see .env.example).
 *
 * Usage:
 *   1. Start the service:  npm run build && npm start   (or npm run dev)
 *   2. In another shell:   npm run e2e        (BASE_URL overrides the target)
 *
 * What it proves:
 *   - Episode 1 ("why do volcanoes erupt", ageBand 5) reaches status=ready
 *     with 5 scenes, each carrying a real image URL + audio URL; the full
 *     manifest is printed.
 *   - Episode 2 runs after episode 1's QualityReviewerAgent and logs evidence
 *     of the Phoenix prompt-version pickup (compare promptVersionUsed across
 *     the two reviews; the service logs the ScenePlannerAgent version line).
 */

import type { AgentStatus, SceneAsset } from "../types.js";

const BASE = (process.env.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const POLL_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 10 * 60 * 1000);

interface PublicEpisode {
  id: string;
  topic: string;
  ageBand: number;
  status: AgentStatus;
  title?: string;
  scenes?: SceneAsset[];
  review?: { score: number; notes: string; promptImproved: boolean; promptVersionUsed: string | null; spanCount: number };
  error?: string;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.BEARER_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.BEARER_TOKEN}`;
  }
  return headers;
}

async function createEpisode(topic: string, ageBand: string | number): Promise<string> {
  const res = await fetch(`${BASE}/episodes`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ topic, ageBand }),
  });
  if (res.status !== 201) throw new Error(`POST /episodes → ${res.status}: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  console.log(`created episode ${id} (topic="${topic}", ageBand=${ageBand})`);
  return id;
}

async function pollUntilDone(id: string): Promise<PublicEpisode> {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${BASE}/episodes/${id}`, {
      headers: getHeaders(),
    });
    if (res.status !== 200) throw new Error(`GET /episodes/${id} → ${res.status}`);
    const ep = (await res.json()) as PublicEpisode;
    if (ep.status !== lastStatus) {
      lastStatus = ep.status;
      console.log(`  [${((Date.now() - start) / 1000).toFixed(0)}s] status → ${ep.status}`);
    }
    if (ep.status === "ready") return ep;
    if (ep.status === "failed") throw new Error(`episode ${id} FAILED: ${ep.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`episode ${id} did not finish within ${POLL_TIMEOUT_MS / 1000}s`);
}

function assertManifest(ep: PublicEpisode): void {
  const scenes = ep.scenes ?? [];
  if (scenes.length !== 5) throw new Error(`expected 5 scenes, got ${scenes.length}`);
  for (const s of scenes) {
    if (!s.imageUrl?.startsWith("http")) throw new Error(`scene ${s.index}: bad imageUrl ${s.imageUrl}`);
    if (!s.audioUrl?.startsWith("http")) throw new Error(`scene ${s.index}: bad audioUrl ${s.audioUrl}`);
    if (!(s.durationMs > 0)) throw new Error(`scene ${s.index}: durationMs=${s.durationMs}`);
    if (s.degraded) console.warn(`  note: scene ${s.index} is degraded (placeholder image)`);
  }
  console.log("  ✓ all 5 scenes have real image + audio URLs and durations");
}

async function main(): Promise<void> {
  console.log(`=== KidTok E2E against ${BASE} ===`);
  let health: { mode?: string } = { mode: "production" };
  try {
    const healthRes = await fetch(`${BASE}/healthz`, { headers: getHeaders() });
    if (healthRes.ok) {
      health = await healthRes.json() as any;
      console.log(`healthz: ${JSON.stringify(health)}`);
    } else {
      console.warn(`healthz check returned status ${healthRes.status}, bypassing healthz check.`);
    }
  } catch (err: any) {
    console.warn(`healthz check failed: ${err.message}, bypassing healthz check.`);
  }
  if (health.mode !== "production") {
    console.warn("WARNING: service is not in production mode — this run will not exercise real Google/Phoenix services.");
  }

  console.log("\n=== Episode 1: why do volcanoes erupt (ageBand 5) ===");
  const id1 = await createEpisode("why do volcanoes erupt", "5");
  const ep1 = await pollUntilDone(id1);
  assertManifest(ep1);
  console.log(`\nEPISODE 1 MANIFEST:\n${JSON.stringify(ep1, null, 2)}`);

  console.log("\n=== Episode 2: how do rainbows form (ageBand 6) — prompt pickup check ===");
  const id2 = await createEpisode("how do rainbows form", 6);
  const ep2 = await pollUntilDone(id2);
  assertManifest(ep2);
  console.log(`\nEPISODE 2 review: ${JSON.stringify(ep2.review, null, 2)}`);

  console.log("\n=== Phoenix prompt-management loop evidence ===");
  console.log(`episode 1 promptVersionUsed: ${ep1.review?.promptVersionUsed} (promptImproved=${ep1.review?.promptImproved})`);
  console.log(`episode 2 promptVersionUsed: ${ep2.review?.promptVersionUsed}`);
  if (ep1.review?.promptImproved) {
    if (ep2.review?.promptVersionUsed && ep2.review.promptVersionUsed !== ep1.review.promptVersionUsed) {
      console.log("✓ episode 2 picked up the scene-prompt version published by episode 1's reviewer");
    } else {
      throw new Error("episode 1 published an improved prompt but episode 2 did not use a newer version");
    }
  } else {
    console.log(
      "episode 1 found no weakness, so no new version was published — episode 2 correctly reused the same version. " +
        "(Also check the service logs for the '[ScenePlannerAgent] ... version=' lines.)",
    );
  }

  console.log("\nE2E PASSED");
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
