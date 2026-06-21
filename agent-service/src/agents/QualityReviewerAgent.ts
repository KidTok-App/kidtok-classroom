/**
 * QualityReviewerAgent — THE PARTNER INTEGRATION (Arize Phoenix), real at
 * runtime.
 *
 * After assembly it:
 *  1. force-flushes the OpenInference spans and retrieves THIS episode's
 *     spans from Phoenix via the MCP server (get-spans, with a short
 *     ingestion-poll loop),
 *  2. evaluates stage latencies + image retries + caption/narration
 *     alignment (Gemini),
 *  3. writes { review: { score (0-100), notes } } onto the episode's
 *     Firestore doc,
 *  4. and when it finds a scene-prompt weakness, publishes an improved
 *     "kidtok-scene-prompt" version via MCP upsert-prompt — which
 *     ScenePlannerAgent picks up on the NEXT episode,
 *  5. then sets status "ready".
 */

import { applyScaffold, assertNoUnresolvedTokens } from "../legacy/scaffoldTemplating.js";
import { SCENE_PROMPT_DESCRIPTION } from "../legacy/scenePromptTemplate.js";
import type { EpisodeStore, PhoenixMcp, TextLlm } from "../clients/interfaces.js";
import type { EpisodeReview, EpisodeScript, SceneAsset, SpanSummary, ChildProfile } from "../types.js";

const ALIGNMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    alignmentScore: {
      type: "NUMBER",
      description: "0-10. How well every caption matches its narration and learning point.",
    },
    notes: { type: "STRING", description: "One or two short sentences for the production log." },
  },
  required: ["alignmentScore", "notes"],
} as const;

const IMPROVEMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    improvedTemplate: {
      type: "STRING",
      description:
        "The full improved scene-prompt template. MUST keep the {visual_description}, {topic}, {age_label} and {age_visual_style} tokens.",
    },
    changeSummary: { type: "STRING", description: "One sentence describing what changed and why." },
  },
  required: ["improvedTemplate", "changeSummary"],
} as const;

const IMPROVEMENT_SYSTEM_PROMPT = `You maintain the image-generation prompt template for a children's cartoon pipeline.
You are given the current template plus telemetry-derived weaknesses observed in the latest episode.
Produce an improved template that directly counteracts the weaknesses (e.g. retries from safety filters → stronger child-safe, people-free phrasing; degraded scenes → simpler single-subject composition guidance; misalignment → tie the image more tightly to the scene description).
HARD REQUIREMENTS:
- Keep the tokens {visual_description}, {topic}, {age_label}, {age_visual_style} exactly as written (curly braces, snake_case).
- Keep the warm friendly 2D children's cartoon style mandate.
- Keep the "no text in image" and "no photorealistic humans" rules.
- Change wording meaningfully but keep overall length within ±40% of the current template.`;

interface StageStats {
  name: string;
  latencyMs: number;
  errored: boolean;
}

export class QualityReviewerAgent {
  constructor(
    private readonly llm: TextLlm,
    private readonly phoenix: PhoenixMcp,
    private readonly store: EpisodeStore,
    private readonly forceFlushTracing: () => Promise<void>,
    private readonly scenePromptName: string,
  ) {}

  async run(input: {
    episodeId: string;
    script: EpisodeScript;
    scenes: SceneAsset[];
    imageRetries: number;
    promptVersionUsed: string | null;
    templateUsed: string;
    templateFellBack: boolean;
    safetyVerdict: string;
    userSteerage?: string;
    childProfile?: ChildProfile;
    /** Resolved (possibly child-scoped) prompt name the planner used. */
    promptName?: string;
  }): Promise<EpisodeReview> {
    const promptName = input.promptName ?? this.scenePromptName;
    // --- 1. Pull THIS episode's spans back out of Phoenix via MCP ---------
    await this.forceFlushTracing().catch(() => {});
    const spans = await this.pollEpisodeSpans(input.episodeId);
    const stages = summarizeStages(spans);
    console.log(
      `[QualityReviewerAgent] episode=${input.episodeId} retrieved ${spans.length} spans via Phoenix MCP (stages: ${stages.map((s) => `${s.name}=${Math.round(s.latencyMs)}ms`).join(", ") || "none"})`,
    );

    // --- 2. Caption/narration alignment (Gemini) --------------------------
    let alignmentScore = 8;
    let alignmentNotes = "Alignment check unavailable.";
    try {
      let system = "You are a children's-content quality reviewer. Score how well each scene's on-screen caption matches its narration and learning point. 10 = every caption is a faithful, kid-readable headline of its narration.";
      if (input.childProfile) {
        system += ` Additionally, evaluate how successfully the episode personalization aligned with the child's profile. Child Name: ${input.childProfile.name}, Age: ${input.childProfile.ageBand}, Interests: ${input.childProfile.interests}.
Your notes MUST include a dedicated sentence assessment of child personalization alignment (e.g. "Personalization alignment: Excellent, the narrator addresses Zosia directly and explains the volcanoes using fun dinosaur analogies!").`;
      }

      const res = await this.llm.generateJson<{ alignmentScore: number; notes: string }>({
        spanName: "review-alignment",
        system,
        user: input.script.scenes
          .map(
            (s, i) =>
              `Scene ${i + 1}\n  Caption: ${s.caption}\n  Narration: ${s.narrationText}\n  Learning point: ${s.learningPoint}`,
          )
          .join("\n"),
        schema: ALIGNMENT_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1024,
        safetyMode: "analysis",
      });
      alignmentScore = clamp(Math.round(res.alignmentScore), 0, 10);
      alignmentNotes = res.notes;
    } catch (err) {
      console.warn(`[QualityReviewerAgent] alignment check failed: ${err instanceof Error ? err.message : err}`);
    }

    // --- 3. Score ----------------------------------------------------------
    const degradedScenes = input.scenes.filter((s) => s.degraded).length;
    const notes: string[] = [];
    let score = 100;

    const spansMissing = spans.length === 0;
    if (spansMissing) {
      score -= 5;
      notes.push("Telemetry: no spans retrievable from Phoenix yet; latency analysis skipped.");
    } else {
      const slow = (stage: string, budgetMs: number): void => {
        const st = stages.find((s) => s.name.startsWith(stage));
        if (st && st.latencyMs > budgetMs) {
          score -= 5;
          notes.push(`Latency: ${stage} took ${(st.latencyMs / 1000).toFixed(1)}s (budget ${budgetMs / 1000}s).`);
        }
      };
      slow("ScriptAgent", 90_000);
      slow("SceneImageAgent", 240_000);
      slow("NarrationAgent", 120_000);
      slow("PromptOptimizerAgent", 60_000);
      slow("VideoGenAgent", 180_000);
      const errored = stages.filter((s) => s.errored);
      if (errored.length > 0) {
        score -= 5 * errored.length;
        notes.push(`Telemetry: ${errored.length} stage span(s) recorded errors (${errored.map((e) => e.name).join(", ")}).`);
      }
    }

    if (input.imageRetries > 0) {
      score -= Math.min(15, input.imageRetries * 5);
      notes.push(`Images: ${input.imageRetries} scene(s) needed the sanitize-and-retry path.`);
    }
    if (degradedScenes > 0) {
      score -= Math.min(45, degradedScenes * 15);
      notes.push(`Images: ${degradedScenes} scene(s) degraded to a styled placeholder.`);
    }
    if (alignmentScore < 8) {
      score -= Math.min(20, (8 - alignmentScore) * 5);
      notes.push(`Alignment: caption/narration alignment scored ${alignmentScore}/10. ${alignmentNotes}`);
    } else {
      notes.push(`Alignment: ${alignmentScore}/10. ${alignmentNotes}`);
    }
    if (input.safetyVerdict === "maybe_unsafe") {
      score -= 5;
      notes.push("Safety: script classified maybe_unsafe (parent-sensitive elements); shipped with caution.");
    }
    if (input.templateFellBack) {
      score -= 5;
      notes.push("Prompt mgmt: published template had unresolved tokens; planner fell back to the seed template.");
    }
    score = clamp(score, 0, 100);

    // --- 4. Publish an improved scene prompt when weakness was found ------
    const weaknessFound =
      degradedScenes > 0 || input.imageRetries > 0 || alignmentScore < 8 || input.templateFellBack || !!input.userSteerage;
    let promptImproved = false;
    let finalNotes = notes.join(" ");
    let promptVersionUsed = input.promptVersionUsed;
    if (weaknessFound) {
      const improveRes = await this.improveScenePrompt(
        {
          episodeId: input.episodeId,
          templateUsed: input.templateUsed,
          userSteerage: input.userSteerage,
          childProfile: input.childProfile,
          promptName,
        },
        {
          degradedScenes,
          imageRetries: input.imageRetries,
          alignmentScore,
          notes,
        }
      );
      promptImproved = improveRes.success;
      if (promptImproved) {
        const childTag = input.childProfile?.name ? ` for ${input.childProfile.name}` : "";
        const publishedNote = `Prompt mgmt: published an improved "${promptName}" version${childTag} for the next episode (was version=${input.promptVersionUsed ?? "seed"}). Change: ${improveRes.changeSummary}`;
        finalNotes += " " + publishedNote;
      }
    }

    // --- 5. Persist review + status ready ----------------------------------
    const review: EpisodeReview = {
      score,
      notes: finalNotes,
      promptImproved,
      promptVersionUsed,
      spanCount: spans.length,
    };
    await this.store.update(input.episodeId, { review, status: "ready" });
    console.log(
      `[QualityReviewerAgent] episode=${input.episodeId} review score=${score} promptImproved=${promptImproved}`,
    );
    return review;
  }

  /** Phoenix ingestion is asynchronous — poll a few times before giving up. */
  private async pollEpisodeSpans(episodeId: string): Promise<SpanSummary[]> {
    const ATTEMPTS = 4;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const spans = await this.phoenix.getEpisodeSpans(episodeId, { limit: 250 });
        if (spans.length > 0) return spans;
      } catch (err) {
        console.warn(
          `[QualityReviewerAgent] get-spans attempt ${attempt + 1}/${ATTEMPTS} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
      if (attempt < ATTEMPTS - 1) await sleep(2500);
    }
    return [];
  }

  private async improveScenePrompt(
    input: {
      episodeId: string;
      templateUsed: string;
      userSteerage?: string;
      childProfile?: ChildProfile;
      promptName: string;
    },
    weakness: { degradedScenes: number; imageRetries: number; alignmentScore: number; notes: string[] },
  ): Promise<{ success: boolean; changeSummary?: string; versionId?: string | null }> {
    let improvedTemplate: string | null = null;
    let changeSummary = "Optimized prompt template via closed-loop quality telemetry.";
    try {
      const userPromptParts = [
        "CURRENT TEMPLATE:",
        input.templateUsed,
        "",
      ];
      if (input.childProfile) {
        const cp = input.childProfile;
        userPromptParts.push(
          "CHILD PROFILE CONTEXT (the cartoons are made for this specific child):",
          `- name: ${cp.name}`,
          `- age: ${cp.ageBand}`,
          `- interests: ${cp.interests || "(not provided)"}`,
          `- preferred art style: ${cp.artStyle || "(not provided)"}`,
          "",
          "INSTRUCTION FOR CHILD PROFILE:",
          `Bake the child's preferred art style and interests directly into the visual cues of the template so that future scenes for ${cp.name} naturally lean toward their world (e.g. interest-themed props, characters, or environments).`,
          `Your changeSummary MUST explicitly mention ${cp.name} and reference how the template now better serves their interests or art style.`,
          ""
        );
      }
      if (input.userSteerage) {
        userPromptParts.push(
          "USER DIRECTIVE / STEERAGE GUIDELINE:",
          `"${input.userSteerage}"`,
          "",
          "INSTRUCTION FOR USER DIRECTIVE:",
          "Integrate the user's specific request or steerage guideline dynamically and beautifully into the scene-prompt template so that downstream cartoon image generation is guided by it.",
          ""
        );
      }
      userPromptParts.push(
        "OBSERVED WEAKNESSES THIS EPISODE:",
        `- degraded scenes (placeholder used): ${weakness.degradedScenes}`,
        `- scenes that needed a sanitize-retry: ${weakness.imageRetries}`,
        `- caption/narration alignment: ${weakness.alignmentScore}/10`,
        ...weakness.notes.map((n) => `- ${n}`)
      );

      const res = await this.llm.generateJson<{ improvedTemplate: string; changeSummary: string }>({
        spanName: "review-prompt-improvement",
        system: IMPROVEMENT_SYSTEM_PROMPT,
        user: userPromptParts.join("\n"),
        schema: IMPROVEMENT_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 2048,
        safetyMode: "analysis",
      });
      improvedTemplate = res.improvedTemplate?.trim() || null;
      if (res.changeSummary) {
        changeSummary = res.changeSummary.trim();
      }
      if (improvedTemplate) {
        console.log(`[QualityReviewerAgent] template improvement: ${changeSummary}`);
      }
    } catch (err) {
      console.warn(
        `[QualityReviewerAgent] LLM template improvement failed (${err instanceof Error ? err.message : err}); using deterministic fallback`,
      );
    }

    // Deterministic fallback so the improvement loop still functions when the
    // LLM call fails: append targeted composition guidance.
    if (!improvedTemplate) {
      const clause =
        weakness.degradedScenes > 0 || weakness.imageRetries > 0
          ? " Keep exactly one friendly subject, a plain simple background, and strictly child-safe people-free phrasing."
          : " Mirror the scene description faithfully so the image matches the narration beat.";
      improvedTemplate = input.templateUsed.includes(clause.trim())
        ? null
        : `${input.templateUsed}${clause}`;
      changeSummary = "Added targeted composition guidance for simplified background rendering.";
    }
    if (!improvedTemplate || improvedTemplate === input.templateUsed) return { success: false };

    // Validate the template before publishing: all required tokens present
    // and nothing unresolved after a dummy render.
    for (const token of ["{visual_description}", "{topic}", "{age_label}", "{age_visual_style}"]) {
      if (!improvedTemplate.includes(token)) {
        console.warn(`[QualityReviewerAgent] improved template dropped ${token}; not publishing`);
        return { success: false };
      }
    }
    try {
      const rendered = applyScaffold(improvedTemplate, {
        visual_description: "x",
        topic: "x",
        age_label: "x",
        age_visual_style: "x",
      });
      assertNoUnresolvedTokens(rendered, "improved-scene-prompt-validation");
    } catch (err) {
      console.warn(`[QualityReviewerAgent] improved template failed validation: ${err instanceof Error ? err.message : err}`);
      return { success: false };
    }

    const version = await this.phoenix.upsertPrompt({
      name: input.promptName,
      description: SCENE_PROMPT_DESCRIPTION,
      template: improvedTemplate,
      changeSummary,
    });
    console.log(
      `[QualityReviewerAgent] upserted "${input.promptName}" via Phoenix MCP (new version=${version.versionId ?? "unknown"})`,
    );
    return { success: true, changeSummary, versionId: version.versionId };
  }
}

function summarizeStages(spans: SpanSummary[]): StageStats[] {
  const AGENT_PREFIXES = [
    "ScriptAgent",
    "ScenePlannerAgent",
    "SceneImageAgent",
    "NarrationAgent",
    "AssemblyAgent",
    "PromptOptimizerAgent",
    "VideoGenAgent",
  ];
  const out: StageStats[] = [];
  for (const prefix of AGENT_PREFIXES) {
    const matching = spans.filter((s) => s.name === prefix || s.name.startsWith(`${prefix}.`));
    if (matching.length === 0) continue;
    // Prefer the stage-level span (exact name match); fall back to summing children.
    const stageSpan = matching.find((s) => s.name === prefix);
    const latencyMs =
      stageSpan?.latencyMs ?? matching.reduce((acc, s) => acc + (s.latencyMs ?? 0), 0);
    out.push({
      name: prefix,
      latencyMs: latencyMs ?? 0,
      errored: matching.some((s) => s.statusCode === "ERROR"),
    });
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
