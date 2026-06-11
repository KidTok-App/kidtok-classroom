/**
 * ScriptAgent — writes the episode script: { title, scenes: exactly 5 of
 * { caption, narrationText, learningPoint } }, age-banded (5/6/7/8), then
 * passes it through the legacy child-safety check.
 *
 * The system prompt's voice/audience/language rules are ported from
 * agent-service/legacy-reference/generate-lesson.ts; the placeholder
 * guardrail is ported from lessonAuthoringHelpers.ts (sanitizeLessonContent).
 */

import { buildAgeSectionForPrompt, getAgeSpec } from "../legacy/ageSpecs.js";
import { runSafetyCheck } from "../legacy/safetyCheck.js";
import type { TextLlm } from "../clients/interfaces.js";
import type { EpisodeScript, ScriptScene, ChildProfile } from "../types.js";

export class ScriptSafetyError extends Error {
  constructor(
    public readonly verdict: string,
    public readonly reasons: string[],
  ) {
    super(`SCRIPT_SAFETY_REJECTED: verdict=${verdict} reasons=${reasons.join("; ")}`);
    this.name = "ScriptSafetyError";
  }
}

const SCRIPT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "Short fun episode title (max 8 words)." },
    scenes: {
      type: "ARRAY",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "OBJECT",
        properties: {
          caption: {
            type: "STRING",
            description: "Short on-screen caption for the scene (max 10 words).",
          },
          narrationText: {
            type: "STRING",
            description: "2-4 spoken sentences for the friendly narrator.",
          },
          learningPoint: {
            type: "STRING",
            description: "The one thing the child learns in this scene.",
          },
        },
        required: ["caption", "narrationText", "learningPoint"],
      },
    },
  },
  required: ["title", "scenes"],
} as const;

/**
 * Output guardrail ported from sanitizeLessonContent(): strips
 * `[Child's Name]`-style placeholders and parent-facing phrasing.
 */
export function sanitizeScriptText(text: string): string {
  if (!text) return text;
  const placeholderPatterns = [/\[child'?s?\s+name\]/gi, /\[kid'?s?\s+name\]/gi, /\[name\]/gi, /\[child\]/gi];
  let sanitized = text;
  for (const pattern of placeholderPatterns) sanitized = sanitized.replace(pattern, "you");
  sanitized = sanitized.replace(/your\s+child/gi, "you");
  return sanitized.replace(/\s{2,}/g, " ").trim();
}

function buildSystemPrompt(ageBand: number, childProfile?: ChildProfile): string {
  const spec = getAgeSpec(ageBand);
  let basePrompt = `You are an expert educational content creator for young children aged ${spec.age}.
Create an engaging, age-appropriate 5-scene mini cartoon episode that is fun and easy to understand.

${buildAgeSectionForPrompt(spec)}

CRITICAL VOICE & AUDIENCE RULES (MUST FOLLOW):
- The narration is spoken directly to the child by a friendly narrator
- ALWAYS address the learner as "you" (second person)
- DO NOT talk about "your child" or "their child" - that is parent-facing language
- DO NOT refer to the child in third person ("the child", "the kid") when giving instructions
- Speak directly to them: "You can...", "Let's try...", "Can you find..."

CRITICAL LANGUAGE REQUIREMENTS:
- Use ONLY words within the vocabulary tier described above — no scientific jargon or adult terminology
- Explain complex concepts using playful analogies kids can see, touch, or experience
  Example: "gravity" → "the invisible hug that keeps us on the ground"
  Example: "photosynthesis" → "plants eating sunlight for lunch"
- NEVER switch to adult/scientific language mid-lesson

CRITICAL PLACEHOLDER RULES:
- NEVER output placeholder tokens like "[Child's Name]", "[child name]", "[kid's name]" or any similar square-bracket placeholders
- NEVER use "your child" in the kid-facing script
- Speak directly to the child using "you"; generic friendly terms like "buddy" or "friend" are okay if used sparingly`;

  if (childProfile) {
    basePrompt += `\n\n🧒 CHILD PERSONALIZATION RULES:
- The learner is a real child named "${childProfile.name}" who is ${childProfile.ageBand} years old.
- Address them directly by their name "${childProfile.name}" at least twice in the narration (e.g. in the first scene's hook and the final scene's joyful recap).
- Connect the explanation of the topic to the child's interests: "${childProfile.interests}"! Specifically, weave these interests "${childProfile.interests}" into the analogies, examples, or storyline of the episode. For example, if the topic is volcanoes and the child loves dinosaurs, explain volcanoes using dinosaurs exploring near them or comparing lava flow to dinosaur-related things. Ensure the core learning topic remains the primary focus.`;
  }

  basePrompt += `\n\nSTRUCTURE REQUIREMENTS:
- Exactly 5 scenes telling one continuous story: hook → discover → explain → example → joyful recap
- caption: a short on-screen caption (max 10 words, no emoji)
- narrationText: 2-4 spoken sentences following the sentence-length ceiling above
- learningPoint: the single idea the child takes away from the scene`;

  return basePrompt;
}

export class ScriptAgent {
  constructor(private readonly llm: TextLlm) {}

  async run(input: {
    episodeId: string;
    topic: string;
    ageBand: number;
    childProfile?: ChildProfile;
  }): Promise<{ script: EpisodeScript; safetyVerdict: string; safetyReasons: string[] }> {
    const system = buildSystemPrompt(input.ageBand, input.childProfile);
    const user = `Topic: "${input.topic}"\n\nWrite the 5-scene episode script now.`;

    let script: EpisodeScript | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 2 && !script; attempt++) {
      try {
        const raw = await this.llm.generateJson<EpisodeScript>({
          spanName: "script-agent",
          system,
          user,
          schema: SCRIPT_RESPONSE_SCHEMA,
          temperature: 0.7,
          maxOutputTokens: 4096,
        });
        if (!raw || typeof raw.title !== "string" || !Array.isArray(raw.scenes)) {
          throw new Error("SCRIPT_INVALID_SHAPE");
        }
        let scenes = raw.scenes.filter(
          (s): s is ScriptScene =>
            !!s &&
            typeof s.caption === "string" &&
            typeof s.narrationText === "string" &&
            typeof s.learningPoint === "string",
        );
        if (scenes.length > 5) scenes = scenes.slice(0, 5);
        if (scenes.length !== 5) throw new Error(`SCRIPT_SCENE_COUNT_${scenes.length}`);
        script = {
          title: sanitizeScriptText(raw.title),
          scenes: scenes.map((s) => ({
            caption: sanitizeScriptText(s.caption),
            narrationText: sanitizeScriptText(s.narrationText),
            learningPoint: sanitizeScriptText(s.learningPoint),
          })),
        };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (!script) throw lastErr ?? new Error("SCRIPT_GENERATION_FAILED");

    // Legacy child-safety check on the authored script.
    const summary = [
      `Title: ${script.title}`,
      ...script.scenes.map(
        (s, i) => `Scene ${i + 1} caption: ${s.caption}\nScene ${i + 1} narration: ${s.narrationText}\nScene ${i + 1} learning point: ${s.learningPoint}`,
      ),
    ].join("\n");
    const safety = await runSafetyCheck(this.llm, summary);
    if (safety.verdict === "unsafe") {
      throw new ScriptSafetyError(safety.verdict, safety.reasons);
    }
    // "maybe_unsafe" and infra "error" fail open with a recorded note —
    // mirrors the legacy gate philosophy (only positive unsafe blocks).
    return { script, safetyVerdict: safety.verdict, safetyReasons: safety.reasons };
  }
}
