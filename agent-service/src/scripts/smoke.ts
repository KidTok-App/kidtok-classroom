/**
 * Offline smoke test (fake providers) — verifies the WHOLE service end to
 * end with zero external calls:
 *   API contract → orchestrator → 6 sub-agents → status flow → manifest →
 *   tracing → reviewer span analysis → prompt improvement → episode 2
 *   picking up the improved prompt version.
 *
 * Run: npm run smoke
 */

process.env.KIDTOK_FAKE_PROVIDERS = "1";
process.env.PORT = process.env.PORT || "4517";
// Fail the 3rd image call (scene index 2, attempt 0) so episode 1 exercises
// the sanitize-retry path → reviewer detects a weakness → publishes an
// improved scene prompt → episode 2 must pick up the new version.
process.env.KIDTOK_FAKE_FAIL_IMAGE_CALL = "2";

import { boot } from "../index.js";
import type { AgentStatus, SceneAsset } from "../types.js";

interface PublicEpisode {
  id: string;
  topic: string;
  ageBand: number;
  createdAt: string;
  status: AgentStatus;
  title?: string;
  scenes?: SceneAsset[];
  review?: { score: number; notes: string; promptImproved: boolean; promptVersionUsed: string | null; spanCount: number };
  error?: string;
}

const fails: string[] = [];
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    fails.push(label);
  }
}

async function pollUntilDone(base: string, id: string, timeoutMs = 60_000): Promise<PublicEpisode> {
  const start = Date.now();
  const seen: AgentStatus[] = [];
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/episodes/${id}`);
    if (res.status !== 200) throw new Error(`GET /episodes/${id} → ${res.status}`);
    const ep = (await res.json()) as PublicEpisode;
    if (seen[seen.length - 1] !== ep.status) {
      seen.push(ep.status);
      console.log(`  status → ${ep.status}`);
    }
    if (ep.status === "ready" || ep.status === "failed") {
      console.log(`  statuses observed: ${seen.join(" → ")}`);
      return ep;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`episode ${id} did not finish within ${timeoutMs}ms`);
}

async function createEpisode(base: string, topic: string, ageBand: string | number): Promise<string> {
  const res = await fetch(`${base}/episodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, ageBand }),
  });
  if (res.status !== 201) throw new Error(`POST /episodes → ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { id?: string; episodeId?: string };
  check(typeof body.id === "string" && body.id === body.episodeId, "POST returns { id, episodeId } (frontend + spec compatibility)");
  return body.id as string;
}

function verifyManifest(ep: PublicEpisode, label: string): void {
  console.log(`\n— Manifest checks (${label}) —`);
  check(ep.status === "ready", `status is ready`);
  check(Array.isArray(ep.scenes) && ep.scenes.length === 5, `exactly 5 scenes`);
  const scenes = ep.scenes ?? [];
  check(
    scenes.every((s) => typeof s.imageUrl === "string" && s.imageUrl.length > 0),
    "every scene has an imageUrl",
  );
  check(
    scenes.every((s) => typeof s.audioUrl === "string" && s.audioUrl.length > 0),
    "every scene has an audioUrl",
  );
  check(
    scenes.every((s) => typeof s.durationMs === "number" && s.durationMs > 0),
    "every scene has durationMs > 0",
  );
  const expectedAnims = ["kenburns-in", "pan-left", "kenburns-out", "pan-right", "kenburns-in"];
  check(
    scenes.map((s) => s.animation).join(",") === expectedAnims.join(","),
    "animations cycle kenburns-in / pan-left / kenburns-out / pan-right",
  );
  check(!!ep.review && typeof ep.review.score === "number", "review { score, notes } present");
  check((ep.review?.spanCount ?? 0) > 0, `reviewer retrieved spans (got ${ep.review?.spanCount})`);
}

async function main(): Promise<void> {
  console.log("=== KidTok agent-service smoke test (fake providers) ===");
  const { cfg, app, shutdown } = await boot();
  const server = app.listen(cfg.port);
  const base = `http://localhost:${cfg.port}`;
  try {
    const health = (await (await fetch(`${base}/healthz`)).json()) as { ok: boolean; mode: string };
    check(health.ok === true && health.mode === "fake-providers", "GET /healthz");

    console.log("\n=== Episode 1: volcanoes (ageBand sent as STRING '5') ===");
    const id1 = await createEpisode(base, "why do volcanoes erupt", "5");
    const ep1 = await pollUntilDone(base, id1);
    verifyManifest(ep1, "episode 1");
    check(ep1.ageBand === 5, "string ageBand coerced to number 5");
    check(ep1.review?.promptImproved === true, "episode 1 reviewer published an improved scene prompt (weakness: image retry)");
    console.log(`\nEpisode 1 manifest:\n${JSON.stringify(ep1, null, 2)}`);

    console.log("\n=== Episode 2: rainbows (must pick up the improved prompt version) ===");
    const id2 = await createEpisode(base, "how do rainbows form", 6);
    const ep2 = await pollUntilDone(base, id2);
    verifyManifest(ep2, "episode 2");
    check(
      ep1.review?.promptVersionUsed !== ep2.review?.promptVersionUsed,
      `episode 2 used a NEWER scene-prompt version (ep1=${ep1.review?.promptVersionUsed} → ep2=${ep2.review?.promptVersionUsed})`,
    );

    const list = (await (await fetch(`${base}/episodes`)).json()) as PublicEpisode[];
    check(Array.isArray(list) && list.length === 2, "GET /episodes lists both episodes");
    check(list[0]?.id === id2, "list is newest-first");

    const missing = await fetch(`${base}/episodes/nope`);
    check(missing.status === 404, "GET /episodes/:unknown → 404");
  } finally {
    server.close();
    await shutdown();
  }

  if (fails.length > 0) {
    console.error(`\nSMOKE FAILED — ${fails.length} check(s):\n${fails.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nSMOKE PASSED — full pipeline, review loop, and prompt-version pickup verified offline.");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE CRASHED:", err);
  process.exit(1);
});
