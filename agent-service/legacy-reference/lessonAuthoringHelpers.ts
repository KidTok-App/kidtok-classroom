/**
 * Lesson Authoring Helpers — shared utilities used by BOTH:
 *   - `generate-lesson/index.ts` (production lesson creation)
 *   - `_shared/lessonSeriesPlanner.ts` (Test Asset Generator preview pipeline)
 *
 * This file is the SINGLE SOURCE OF TRUTH for the placeholder/emoji sanitizer
 * applied to authored script JSON. It used to be inlined in each consumer; now
 * any consumer that authors a lesson script must call `sanitizeLessonContent`
 * exported here to guarantee the Test Asset Generator's preview script is
 * byte-identical to what production would emit.
 *
 * NOTE: `buildAgeSectionForPrompt`, `buildPlannerProgressionGuidance`,
 * `buildProgressionGuidance` already live in `_shared/ageSpecs.ts` — they
 * were already shared. We re-export them here so callers have one import.
 */

import {
  buildAgeSectionForPrompt,
  buildPlannerProgressionGuidance,
  buildProgressionGuidance,
  assignDifficultyStage,
} from "./ageSpecs.ts";
import { sanitizeForKidFacingText, sanitizeThumbnailEmoji } from "./emojiSanitizer.ts";

export {
  buildAgeSectionForPrompt,
  buildPlannerProgressionGuidance,
  buildProgressionGuidance,
  assignDifficultyStage,
};

/**
 * Output guardrail — strips `[Child's Name]`-style placeholders, replaces
 * `your child` with `you`, and runs the kid-safe emoji sanitizer.
 *
 * VERBATIM extraction from `generate-lesson/index.ts` lines 68–113.
 * Any change here MUST be mirrored everywhere lessons are authored
 * (currently: `generate-lesson/index.ts`, `generate-next-lesson/index.ts`,
 * and `lessonSeriesPlanner.ts`).
 */
export function sanitizeLessonContent(
  content: any,
  childNickname: string | null,
): any {
  const sanitize = (text: string): string => {
    if (!text) return text;

    const placeholderPatterns = [
      /\[child'?s?\s+name\]/gi,
      /\[kid'?s?\s+name\]/gi,
      /\[name\]/gi,
      /\[child\]/gi,
    ];

    let sanitized = text;
    const replacement = childNickname || "you";
    placeholderPatterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, replacement);
    });

    sanitized = sanitized.replace(/your\s+child/gi, "you");
    sanitized = sanitizeForKidFacingText(sanitized);
    return sanitized;
  };

  return {
    ...content,
    hook_text: sanitize(content.hook_text),
    model_lines: content.model_lines?.map((line: string) => sanitize(line)),
    quiz_question: sanitize(content.quiz_question),
    quiz_choices: content.quiz_choices?.map((choice: string) => sanitize(choice)),
    reward_label: sanitize(content.reward_label),
    thumbnail_emoji: sanitizeThumbnailEmoji(content.thumbnail_emoji),
    parent_recap_points: Array.isArray(content.parent_recap_points)
      ? content.parent_recap_points.map((p: string) => sanitize(p))
      : content.parent_recap_points,
  };
}
