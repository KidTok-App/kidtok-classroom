import { ageLabel, getAgeSpec } from "../legacy/ageSpecs.js";
import {
  applyScaffold,
  assertNoUnresolvedTokens,
  UnresolvedScaffoldTokenError,
} from "../legacy/scaffoldTemplating.js";
import {
  GLOBAL_CARTOON_STYLE,
  LEGACY_SCENE_PROMPT_TEMPLATE,
  SCENE_PROMPT_DESCRIPTION,
} from "../legacy/scenePromptTemplate.js";
import type { PhoenixMcp, TextLlm } from "../clients/interfaces.js";
import { childScopedPromptName } from "../lib/promptScoping.js";
import type { EpisodeScript, PlannedScene, ChildProfile } from "../types.js";

const PLANNER_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    descriptions: {
      type: "ARRAY",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "STRING",
        description: "Visual description of one scene (1-3 sentences, concrete and drawable).",
      },
    },
  },
  required: ["descriptions"],
} as const;

const PLANNER_SYSTEM_PROMPT = `You are a visual scene planner for a children's educational cartoon studio.
Given a 5-scene episode script, write ONE visual description per scene for the illustrator.

CONSISTENCY RULES (MUST FOLLOW):
- Invent ONE friendly recurring cartoon mascot guide (an animal or whimsical creature — never a realistic human) and feature it consistently across all 5 scenes doing topic-appropriate things
- Keep the same world, lighting mood, and color family across all scenes so the episode feels continuous
- Style anchor for every scene: {STYLE_ANCHOR}

DESCRIPTION RULES:
- Concrete and drawable: subject, action, setting, 1-2 supporting props
- One clear focal point per scene; simple uncluttered background
- No text, signs, letters, or numbers in the scene
- No realistic humans, no scary imagery, no brands
- 1-3 sentences each`;

export interface ScenePlanResult {
  scenes: PlannedScene[];
  promptVersionId: string | null;
  promptSeeded: boolean;
  templateUsed: string;
  /** True when a reviewer-improved template failed token validation and we fell back to the seed. */
  templateFellBack: boolean;
  /** Resolved (possibly child-scoped) prompt name the reviewer must publish to. */
  promptName: string;
}

export class ScenePlannerAgent {
  constructor(
    private readonly llm: TextLlm,
    private readonly phoenix: PhoenixMcp,
    private readonly scenePromptName: string,
  ) {}

  async run(input: {
    episodeId: string;
    topic: string;
    ageBand: number;
    script: EpisodeScript;
    childProfile?: ChildProfile;
  }): Promise<ScenePlanResult> {
    // 1. Fetch the live template from Phoenix prompt management (MCP).
    //    Prompts are scoped per child ("<base>--<child-slug>") so each child
    //    accrues their own improvement loop; a child with no published
    //    versions yet inherits the shared baseline template.
    const promptName = childScopedPromptName(this.scenePromptName, input.childProfile?.name);
    let promptSeeded = false;
    let inheritedBaseline = false;
    let prompt = await this.phoenix.getLatestPrompt(promptName);
    if (!prompt && promptName !== this.scenePromptName) {
      prompt = await this.phoenix.getLatestPrompt(this.scenePromptName);
      if (prompt) inheritedBaseline = true;
    }
    if (!prompt) {
      prompt = await this.phoenix.upsertPrompt({
        name: this.scenePromptName,
        description: SCENE_PROMPT_DESCRIPTION,
        template: LEGACY_SCENE_PROMPT_TEMPLATE,
      });
      promptSeeded = true;
      inheritedBaseline = promptName !== this.scenePromptName;
      console.log(
        `[ScenePlannerAgent] seeded "${this.scenePromptName}" from the legacy template (version=${prompt.versionId ?? "unknown"})`,
      );
    }
    console.log(
      `[ScenePlannerAgent] episode=${input.episodeId} using scene-prompt template "${promptName}"${inheritedBaseline ? " (inherited shared baseline)" : ""} version=${prompt.versionId ?? "unknown"} seeded=${promptSeeded}`,
    );

    // 2. One consistent visual description per scene.
    const personalizationLines: string[] = [];
    if (input.childProfile) {
      const cp = input.childProfile;
      personalizationLines.push(
        `Child viewer: ${cp.name} (age ${cp.ageBand})`,
        cp.interests
          ? `Personalization hint — weave these interests into recurring visual cues (props, characters, environments) without distracting from the topic: ${cp.interests}.`
          : "",
        cp.artStyle ? `Preferred art style anchor: ${cp.artStyle}.` : "",
        "",
      );
    }
    const user = [
      `Topic: "${input.topic}"`,
      `Audience: ${ageLabel(input.ageBand)}`,
      `Episode title: ${input.script.title}`,
      "",
      ...personalizationLines.filter(Boolean),
      ...input.script.scenes.map(
          (s, i) =>
            `Scene ${i + 1}:\n  Caption: ${s.caption}\n  Narration: ${s.narrationText}\n  Learning point: ${s.learningPoint}`,
      ),
      "",
      "Write the 5 visual descriptions now (one per scene, in order).",
    ].join("\n");

    const styleAnchor = input.childProfile?.artStyle || GLOBAL_CARTOON_STYLE;
    const systemPrompt = PLANNER_SYSTEM_PROMPT.replace("{STYLE_ANCHOR}", styleAnchor);

    const { descriptions } = await this.llm.generateJson<{ descriptions: string[] }>({
      spanName: "scene-planner",
      system: systemPrompt,
      user,
      schema: PLANNER_RESPONSE_SCHEMA,
      temperature: 0.6,
      maxOutputTokens: 2048,
    });
    if (!Array.isArray(descriptions) || descriptions.length !== 5) {
      throw new Error(`SCENE_PLANNER_BAD_COUNT_${Array.isArray(descriptions) ? descriptions.length : "none"}`);
    }

    // 3. Render the final image prompt per scene via the legacy scaffold.
    const spec = getAgeSpec(input.ageBand);
    let templateUsed = prompt.template;
    let templateFellBack = false;

    const render = (template: string, visualDescription: string): string => {
      const rendered = applyScaffold(template, {
        visual_description: visualDescription.trim().replace(/\.$/, ""),
        topic: input.topic,
        age_label: ageLabel(input.ageBand),
        age_visual_style: input.childProfile?.artStyle || spec.visualStyle,
      });
      assertNoUnresolvedTokens(rendered, "scene-image-prompt");
      return rendered;
    };

    const scenes: PlannedScene[] = input.script.scenes.map((scriptScene, i) => {
      const visualDescription = (descriptions[i] ?? "").trim();
      let imagePrompt: string;
      try {
        imagePrompt = render(templateUsed, visualDescription);
      } catch (err) {
        if (err instanceof UnresolvedScaffoldTokenError && templateUsed !== LEGACY_SCENE_PROMPT_TEMPLATE) {
          // A published template regression must not break episodes: fall
          // back to the legacy seed and let the reviewer know via metrics.
          console.warn(
            `[ScenePlannerAgent] template version=${prompt?.versionId} has unresolved tokens (${err.tokens.join(", ")}); falling back to the legacy seed template`,
          );
          templateUsed = LEGACY_SCENE_PROMPT_TEMPLATE;
          templateFellBack = true;
          imagePrompt = render(templateUsed, visualDescription);
        } else {
          throw err;
        }
      }
      return { ...scriptScene, visualDescription, imagePrompt };
    });

    return {
      scenes,
      promptVersionId: prompt.versionId,
      promptSeeded,
      templateUsed,
      templateFellBack,
      promptName,
    };
  }
}
