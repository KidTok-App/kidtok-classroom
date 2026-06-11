import { Agent, AgentContext } from './agent.js';
import { OrchestratorInput } from '../types.js';
import { geminiGenerateContent } from '../tools/gemini_generate_content.js';
import { resolveModel } from '../../lib/vertexRouting.js';

export const HARD_FAIL_CATEGORY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bweapon(s|ry)?\b/i,
  /\bgore\b/i,
  /\bblood(y|shed)?\b/i,
  /\bsuggestive\b/i,
  /\bsexual\b/i,
  /\bnudity\b/i,
  /\bhate[\s-]?symbol/i,
  /\bdrugs?\b/i,
  /\balcohol\b/i,
  /\bsmoking\b/i,
  /\bself[\s-]?harm\b/i,
  /\bdangerous[\s-]?(act|stunt)\b/i,
];

export function applyCategoryTrumpsBooleanGate(
  verdict: string,
  reasons: string[]
): string {
  if (verdict === 'unsafe' || verdict === 'error' || verdict === 'pending') return verdict;
  const blob = (reasons ?? []).join(' \n ');
  if (!blob) return verdict;
  for (const re of HARD_FAIL_CATEGORY_PATTERNS) {
    if (re.test(blob)) return 'unsafe';
  }
  return verdict;
}

export function projectAudioScriptToSafetyShape(script: any): {
  hook_text: string;
  model_lines: string[];
  quiz_question: string;
  quiz_choices: string[];
  reward_label: string;
} {
  const blocks: any[] = Array.isArray(script?.blocks) ? script.blocks : [];
  const textOf = (b: any) => (typeof b?.text === 'string' ? b.text : '');
  const intro = blocks.find((b) => b?.block_type === 'intro');
  const questions = blocks.filter((b) => b?.block_type === 'question');
  const passive = blocks.filter((b) =>
    ['story_setup', 'narration', 'teaching', 'feedback', 'outro'].includes(b?.block_type),
  );
  const firstQ = questions[0];
  const choices: string[] = Array.isArray(firstQ?.evaluation?.expected_answer)
    ? firstQ.evaluation.expected_answer.map((x: any) => String(x))
    : typeof firstQ?.evaluation?.expected_answer === 'string'
    ? [firstQ.evaluation.expected_answer]
    : [];
  return {
    hook_text: textOf(intro) || (typeof script?.title === 'string' ? script.title : ''),
    model_lines: passive.map(textOf).filter((x: string) => x),
    quiz_question: textOf(firstQ),
    quiz_choices: choices,
    reward_label:
      typeof script?.learning_goal === 'string'
        ? script.learning_goal
        : typeof script?.summary === 'string'
        ? script.summary
        : '',
  };
}

const SAFETY_SYSTEM_PROMPT = `You are a child-content safety classifier for educational lessons aimed at children ages 3-8.

Analyze the lesson script and classify it as one of:
- "safe" — fully appropriate for young children
- "maybe_unsafe" — contains elements that might concern parents (mild scary content, complex emotions, cultural sensitivity, borderline topics)
- "unsafe" — contains content clearly inappropriate for children (violence, sexual themes, self-harm, hate speech, dangerous instructions, medical advice)

Be conservative: if in doubt, classify as "maybe_unsafe" rather than "safe".`;

export class SafetyCheckAgent extends Agent {
  constructor() {
    super('SafetyCheckAgent');
  }

  protected async run(input: OrchestratorInput, context: AgentContext): Promise<any> {
    const { lessonContext, script } = input;
    const model = resolveModel({ role: 'safety' });

    let hook_text = '';
    let model_lines: string[] = [];
    let quiz_question = '';
    let quiz_choices: string[] = [];
    let reward_label = '';

    if (script) {
      if (typeof script.hook_text === 'string') {
        hook_text = script.hook_text;
        model_lines = Array.isArray(script.model_lines) ? script.model_lines : [];
        quiz_question = script.quiz_question ?? '';
        quiz_choices = Array.isArray(script.quiz_choices) ? script.quiz_choices : [];
        reward_label = script.reward_label ?? '';
      } else if (Array.isArray(script.blocks)) {
        const projected = projectAudioScriptToSafetyShape(script);
        hook_text = projected.hook_text;
        model_lines = projected.model_lines;
        quiz_question = projected.quiz_question;
        quiz_choices = projected.quiz_choices;
        reward_label = projected.reward_label;
      }
    } else {
      hook_text = lessonContext.topic || '';
      model_lines = Array.isArray(lessonContext.beats)
        ? lessonContext.beats.map((b: any) => (typeof b === 'string' ? b : JSON.stringify(b)))
        : [];
    }

    const scriptSummary = [
      `Hook: ${hook_text}`,
      `Teaching lines: ${model_lines.join(' | ')}`,
      `Quiz: ${quiz_question}`,
      `Choices: ${quiz_choices.join(', ')}`,
      `Reward: ${reward_label}`,
    ].join('\n');

    const schema = {
      type: 'OBJECT',
      properties: {
        verdict: {
          type: 'STRING',
          enum: ['safe', 'maybe_unsafe', 'unsafe'],
          description: 'The safety classification.'
        },
        reasons: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Brief reasons for the classification. Empty array if safe.'
        }
      },
      required: ['verdict', 'reasons']
    };

    try {
      const responseText = await geminiGenerateContent(
        `Classify this lesson script:\n\n${scriptSummary}`,
        {
          systemInstruction: SAFETY_SYSTEM_PROMPT,
          responseSchema: schema,
          model,
          temperature: 0,
        },
        context.logContext
      );

      const parsed = JSON.parse(responseText);
      let verdict = parsed.verdict || 'maybe_unsafe';
      const reasons = Array.isArray(parsed.reasons) ? parsed.reasons : [];

      verdict = applyCategoryTrumpsBooleanGate(verdict, reasons);

      const result = {
        verdict,
        reasons,
        model_used: model,
      };

      input.safetyVerdict = result;
      return result;
    } catch (err: any) {
      const result = {
        verdict: 'error',
        reasons: [err.message || 'Safety check failed unexpectedly'],
        model_used: model,
      };
      input.safetyVerdict = result;
      return result;
    }
  }
}
