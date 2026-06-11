import { Agent, AgentContext } from './agent.js';
import { OrchestratorInput } from '../types.js';
import { generateAssetPromptPlan } from '../../video/aiAssetGeneration/assetPromptPlanner.js';
import { projectAudioScriptToSafetyShape } from './safetyCheckAgent.js';
import { getAgeSpecFromDB } from './ageSpecs.js';
import type { LessonDataForAssets } from '../../video/assets.js';
import { resolveModel } from '../../lib/vertexRouting.js';

export class AssetPromptPlannerAgent extends Agent {
  constructor() {
    super('AssetPromptPlannerAgent');
  }

  protected async run(input: OrchestratorInput, context: AgentContext): Promise<any> {
    const { lessonContext, script } = input;
    const { topic, ageBand, runtimeConfig } = lessonContext;

    let hook_text = '';
    let model_lines: string[] = [];

    if (script) {
      if (typeof script.hook_text === 'string') {
        hook_text = script.hook_text;
        model_lines = Array.isArray(script.model_lines) ? script.model_lines : [];
      } else if (Array.isArray(script.blocks)) {
        const projected = projectAudioScriptToSafetyShape(script);
        hook_text = projected.hook_text;
        model_lines = projected.model_lines;
      }
    } else {
      hook_text = topic || '';
      model_lines = Array.isArray(lessonContext.beats)
        ? lessonContext.beats.map((b: any) => (typeof b === 'string' ? b : JSON.stringify(b)))
        : [];
    }

    const ageSpec = await getAgeSpecFromDB(ageBand);

    const lessonDataForAssets: LessonDataForAssets = {
      hook_text,
      topic,
      age_band: ageBand,
      interest: runtimeConfig?.interest || null,
      child_gender: runtimeConfig?.childGender || 'neutral',
      model_lines,
      family_values: runtimeConfig?.familyValues || null,
      db_stage_label: ageSpec.stageLabel,
      db_visual_params: ageSpec.visualOverrides ? {
        visualStyle: ageSpec.promptFraming || '',
        toneDescriptor: ageSpec.toneDescriptor || '',
        abstractionLevel: ageSpec.abstractionLevel || '',
        per_asset_visual_style: ageSpec.visualOverrides.per_asset_visual_style,
        background_style_directive: ageSpec.visualOverrides.background_style_directive,
        motion_notes: ageSpec.visualOverrides.motion_notes,
      } : null,
    };

    const model = resolveModel({ role: 'prompt-builder' });

    // Call the pre-existing generateAssetPromptPlan
    const plan = await generateAssetPromptPlan(
      lessonDataForAssets,
      context.logContext,
      undefined,
      model
    );

    if (plan) {
      input.assetPromptPlan = plan;
      return plan;
    } else {
      throw new Error('Asset prompt planning returned empty or failed');
    }
  }
}
