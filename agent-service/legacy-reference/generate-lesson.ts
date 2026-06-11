import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { logger } from "../_shared/logger.ts";
import { initEmojiAllowlist } from "../_shared/emojiSanitizer.ts";
import { moderatePrompt, moderatePromptByField, type ModerationOverrides } from "../_shared/contentModeration.ts";
import { generateTTSForLesson } from "../_shared/tts.ts";
import { languageNames, translateInputsToLanguage, resolveTopicForAI } from "../_shared/topicLocalization.ts";
import { isAsyncTtsEnabled, enqueueTtsJobAndUpdateStatus } from "../_shared/ttsQueue.ts";
import { getAgeSpec, getAgeSpecFromDB } from "../_shared/ageSpecs.ts";
import {
  buildAgeSectionForPrompt,
  buildPlannerProgressionGuidance,
  buildProgressionGuidance,
  assignDifficultyStage,
  sanitizeLessonContent,
} from "../_shared/lessonAuthoringHelpers.ts";
import { runSafetyCheck } from "../_shared/safetyCheck.ts";
import { initPipelineMetrics, recordLlmUsage, upsertPipelineMetrics } from "../_shared/pipelineMetrics.ts";
import { callGeminiChatCompletion } from "../_shared/geminiGateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Metric tracking helper function
const trackMetricEvent = async (
  supabaseClient: any,
  userId: string,
  eventType: string,
  lessonId?: string,
  metadata: Record<string, any> = {}
) => {
  try {
    await supabaseClient
      .from('metric_events')
      .insert({
        user_id: userId,
        lesson_id: lessonId || null,
        event_type: eventType,
        metadata: metadata,
      });
  } catch (error) {
    logger.error('Failed to track metric event', { eventType });
  }
};

// Normalization helper for parent blurbs
const MAX_PARENT_BLURB_CHARS = 2000;

const normalizeParentBlurbForAI = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  
  const trimmed = raw.trim();
  if (!trimmed) return null;
  
  // If within limit, return as-is
  if (trimmed.length <= MAX_PARENT_BLURB_CHARS) {
    return trimmed;
  }
  
  // Cut from the end at a word boundary
  let normalized = trimmed.substring(0, MAX_PARENT_BLURB_CHARS);
  
  // Find the last space to avoid cutting mid-word
  const lastSpace = normalized.lastIndexOf(' ');
  if (lastSpace > 0) {
    normalized = normalized.substring(0, lastSpace);
  }
  
  // Optionally append ellipsis to indicate truncation
  return normalized + '…';
};

// NOTE: sanitizeLessonContent is now imported from `_shared/lessonAuthoringHelpers.ts`
// (single source of truth — also used by `lessonSeriesPlanner.ts` for the
// Test Asset Generator preview pipeline). See parity rule in
// `.memory/architecture/test-preview-prompt-parity.md`.

// Input validation schema
const requestSchema = z.object({
  lessonId: z.string().uuid('Invalid lesson ID format'),
  topic: z.string()
    .trim()
    .min(3, 'Topic must be at least 3 characters')
    .max(2000, 'Topic must be less than 2000 characters'),
  ageBand: z.string().min(1, 'Age band is required').max(5, 'Invalid age band'),
  interest: z.string().max(MAX_PARENT_BLURB_CHARS, `Interest must be less than ${MAX_PARENT_BLURB_CHARS} characters`).optional().nullable(),
  childProfileId: z.string().uuid('Invalid child profile ID format').optional().nullable()
});

// Safe error messages for clients
const SAFE_ERRORS = {
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'You do not have permission to perform this action',
  NOT_FOUND: 'Lesson not found',
  INVALID_INPUT: 'Invalid input parameters',
  AI_FAILED: 'Unable to generate lesson. Please try again later',
  RATE_LIMIT: 'Rate limit exceeded. Please try again in a moment',
  QUOTA_EXCEEDED: 'AI usage limit reached. Please add credits to continue',
  SERVER_ERROR: 'Failed to generate lesson. Please try again',
  CONSENT_REQUIRED: 'Parental consent is required before generating lessons',
  SUBSCRIPTION_REQUIRED: 'A paid plan is required to generate lessons',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: SAFE_ERRORS.UNAUTHORIZED }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from JWT with retry for transient network errors
    const jwt = authHeader.replace('Bearer ', '');
    let user = null;
    let authError = null;
    const MAX_AUTH_RETRIES = 2;
    
    for (let attempt = 0; attempt <= MAX_AUTH_RETRIES; attempt++) {
      try {
        const result = await supabaseClient.auth.getUser(jwt);
        user = result.data?.user ?? null;
        authError = result.error;
        
        if (!authError && user) {
          break; // Success
        }
        
        // If it's a network error (connection reset), retry
        if (authError && attempt < MAX_AUTH_RETRIES) {
          const isNetworkError = authError.message?.includes('Connection reset') ||
                                  authError.message?.includes('network') ||
                                  authError.message?.includes('timeout');
          if (isNetworkError) {
            logger.warn(`Auth attempt ${attempt + 1} failed with network error, retrying...`);
            await new Promise(r => setTimeout(r, 200 * (attempt + 1))); // Brief backoff
            continue;
          }
        }
        break;
      } catch (fetchError: any) {
        // Catch network-level errors (TypeError from fetch)
        if (attempt < MAX_AUTH_RETRIES) {
          logger.warn(`Auth fetch error on attempt ${attempt + 1}, retrying...`, { error: fetchError.message });
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }
        authError = { message: fetchError.message };
        break;
      }
    }

    if (authError || !user) {
      logger.error('Auth verification failed', { error: authError?.message });
      return new Response(JSON.stringify({ error: SAFE_ERRORS.UNAUTHORIZED }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === CONSENT CHECK ===
    // Verify the user has given parental consent before allowing lesson generation
    const { data: consentData, error: consentError } = await supabaseClient
      .from('consent_records')
      .select('id, revoked_at')
      .eq('parent_user_id', user.id)
      .is('revoked_at', null)
      .limit(1);

    if (consentError) {
      logger.error('Consent check failed', { error: consentError.message });
    }

    const hasActiveConsent = consentData && consentData.length > 0;
    if (!hasActiveConsent) {
      logger.warn('Lesson generation blocked: no parental consent', { userId: user.id });
      return new Response(
        JSON.stringify({ error: SAFE_ERRORS.CONSENT_REQUIRED }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === PAYING-TIER GATE ===
    // Only paying tiers (supporter/plus/pro) and internal staff
    // (dev_team/admin) may generate lessons. The default 'user' role gets 402.
    const { data: payingOk, error: payingErr } = await supabaseClient
      .rpc('has_paying_or_privileged_role', { _user_id: user.id });
    if (payingErr) {
      logger.error('Paying-role check failed', { error: payingErr.message });
    }
    if (!payingOk) {
      logger.warn('Lesson generation blocked: no paying/privileged role', { userId: user.id });
      return new Response(
        JSON.stringify({
          error: SAFE_ERRORS.SUBSCRIPTION_REQUIRED,
          code: 'subscription_required',
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // === GENERATION PAUSE GATE ===
    // Platform-wide configurable pause. Blocks paid subscribers while active
    // but admin/dev_team always bypass. Configured via the Features tab
    // (ENABLE_GENERATION_PAUSE / GENERATION_PAUSE_END_AT /
    // GENERATION_PAUSE_MESSAGE_KEY in feature_flag_state).
    {
      const { data: pauseRoleRow } = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'dev_team'])
        .maybeSingle();
      const isPauseStaff = !!pauseRoleRow;

      if (!isPauseStaff) {
        const { data: pauseRows } = await supabaseClient
          .from('feature_flag_state')
          .select('key, value')
          .in('key', [
            'ENABLE_GENERATION_PAUSE',
            'GENERATION_PAUSE_END_AT',
            'GENERATION_PAUSE_MESSAGE_KEY',
          ]);
        const pauseMap = new Map<string, string>();
        for (const row of pauseRows ?? []) {
          pauseMap.set(
            (row as { key: string }).key,
            (row as { value: string }).value
          );
        }
        const pauseEnabled = pauseMap.get('ENABLE_GENERATION_PAUSE') === 'true';
        const pauseEndAt = pauseMap.get('GENERATION_PAUSE_END_AT') || null;
        const pauseMessageKey =
          pauseMap.get('GENERATION_PAUSE_MESSAGE_KEY') || 'create.pause.defaultMessage';
        let pauseActive = false;
        if (pauseEnabled && pauseEndAt) {
          const endMs = Date.parse(pauseEndAt);
          if (!isNaN(endMs) && endMs > Date.now()) pauseActive = true;
        }
        if (pauseActive) {
          logger.warn('Lesson generation blocked: platform pause active', {
            userId: user.id,
            endAt: pauseEndAt,
          });
          return new Response(
            JSON.stringify({
              error: 'Lesson generation is briefly paused.',
              code: 'generation_paused',
              endAt: pauseEndAt,
              messageKey: pauseMessageKey,
            }),
            { status: 423, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // ─── Medium-enabled gate (Video) ───────────────────────────────────
    // Privileged users (admin / dev_team) always bypass. For everyone else,
    // ENABLE_MEDIUM_VIDEO === "false" short-circuits with 403. Missing row
    // = enabled (parity with the frontend `useFeatureFlag` default).
    {
      const { data: mediumRoleRow } = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'dev_team'])
        .maybeSingle();
      const isMediumStaff = !!mediumRoleRow;
      if (!isMediumStaff) {
        const { data: mediumRow } = await supabaseClient
          .from('feature_flag_state')
          .select('value')
          .eq('key', 'ENABLE_MEDIUM_VIDEO')
          .maybeSingle();
        if (mediumRow && (mediumRow as { value: string }).value === 'false') {
          logger.warn('Video lesson generation blocked: medium disabled', { userId: user.id });
          return new Response(
            JSON.stringify({
              error: 'Video lessons are temporarily unavailable.',
              code: 'medium_disabled',
            }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }


    // Validate and parse request body
    const rawBody = await req.json();
    let validatedData;
    
    try {
      validatedData = requestSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Input validation failed');
        return new Response(
          JSON.stringify({ 
            error: SAFE_ERRORS.INVALID_INPUT,
            details: error.errors.map(e => e.message)
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

    const { lessonId, topic, ageBand, interest, childProfileId } = validatedData;

    // Initialise pipeline metrics row (prompt_submitted_at = now)
    await initPipelineMetrics(supabaseClient, lessonId, new Date().toISOString());

    // =========================================================================
    // Content moderation: blocklist check on topic + interest
    // =========================================================================
    // Fetch runtime moderation overrides and emoji allowlist
    let moderationOverrides: ModerationOverrides | null = null;
    try {
      const { data: modConfigs } = await supabaseClient
        .from('moderation_config')
        .select('id, config')
        .in('id', ['global', 'emoji_allowlist']);

      for (const row of (modConfigs || [])) {
        if (row.id === 'global' && row.config && typeof row.config === 'object') {
          moderationOverrides = row.config as ModerationOverrides;
        }
        if (row.id === 'emoji_allowlist' && row.config?.emojis && Array.isArray(row.config.emojis)) {
          initEmojiAllowlist(row.config.emojis as string[]);
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch moderation_config, using defaults', { error: e instanceof Error ? e.message : String(e) });
    }

    const moderationResult = moderatePromptByField(
      { topic, interests: interest },
      moderationOverrides,
      undefined,
    );

    if (!moderationResult.allowed) {
      logger.warn('PROMPT_BLOCKED', {
        category: moderationResult.category,
        field: moderationResult.field,
        normalizedInput: moderationResult.normalizedInput,
        userId: user.id,
        lessonId,
      });

      // Log to metric_events for later review (no raw PII — only category + truncated normalised text)
      await trackMetricEvent(supabaseClient, user.id, 'prompt_blocked', lessonId, {
        category: moderationResult.category,
        field: moderationResult.field,
        input_preview: moderationResult.normalizedInput,
      });

      return new Response(
        JSON.stringify({
          error: 'content_blocked',
          message: moderationResult.message,
          category: moderationResult.category,
          field: moderationResult.field,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // =========================================================================
    // Idempotency guard: prevent duplicate lessons from rapid repeated clicks
    // We treat any "in progress" lesson (generating/queued) in the last ~10 seconds,
    // with the same user/topic/child_profile_id, as the same logical request.
    // =========================================================================
    const TEN_SECONDS_AGO = new Date(Date.now() - 10_000).toISOString();

    let existingQuery = supabaseClient
      .from('lessons')
      .select('id, created_at, status, topic, child_profile_id, medium')
      .eq('user_id', user.id)
      .eq('topic', topic)
      .gte('created_at', TEN_SECONDS_AGO)
      // Only dedupe against in-progress generations. Once a lesson is ready,
      // a new click should create a fresh lesson.
      .in('status', ['queued', 'generating'])
      // CRITICAL: only dedupe against same-medium (video) lessons. Offline /
      // audio lessons are inserted with status='generating' too, but they
      // are managed by their own pipelines. Without this filter, a video
      // submission within ~10s of an offline/audio submission on the same
      // topic would reuse that lesson's id and series-promote it.
      .or('medium.is.null,medium.eq.video')
      .order('created_at', { ascending: false })
      .limit(1);

    if (childProfileId) {
      existingQuery = existingQuery.eq('child_profile_id', childProfileId);
    } else {
      // Correct handling for NULL in Postgres: eq(null) does not match NULLs.
      existingQuery = existingQuery.is('child_profile_id', null);
    }

    const { data: existingRecent, error: existingError } = await existingQuery.maybeSingle();

    if (existingError) {
      console.error('generate-lesson: error checking for existing recent lesson', {
        userId: user.id,
        topic: topic.substring(0, 50),
        childProfileId,
        error: existingError,
      });
    }

    // If we found an existing recent lesson that's NOT the current one, dedupe
    if (existingRecent && existingRecent.id !== lessonId) {
      console.log('generate-lesson: deduping rapid repeated request, reusing existing lesson', {
        userId: user.id,
        topic: topic.substring(0, 50),
        childProfileId,
        existingLessonId: existingRecent.id,
        requestedLessonId: lessonId,
      });

      return new Response(
        JSON.stringify({
          success: true,
          lessonId: existingRecent.id,
          deduped: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Daily lesson rate limit — DISABLED.
    // We moved away from the 3-lessons/day limit with the introduction of paid plans.
    // The code below is intentionally preserved (gated) so we can revert per-medium
    // by flipping ENFORCE_DAILY_LIMIT to true.
    const ENFORCE_DAILY_LIMIT = false;
    if (ENFORCE_DAILY_LIMIT) {
      const { data: rateLimitResult, error: rateLimitError } = await supabaseClient
        .rpc('check_and_increment_lesson_count', { _user_id: user.id, _lesson_count: 1 });

      if (rateLimitError) {
        logger.error('Rate limit check failed', { error: rateLimitError.message, code: rateLimitError.code });
        return new Response(JSON.stringify({ error: SAFE_ERRORS.SERVER_ERROR }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!rateLimitResult) {
        logger.error('Rate limit check returned no data');
        return new Response(JSON.stringify({ error: SAFE_ERRORS.SERVER_ERROR }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!rateLimitResult.allowed) {
        console.log(`Rate limit exceeded for user ${user.id}:`, rateLimitResult);
        return new Response(
          JSON.stringify({
            error: 'Daily lesson limit reached',
            message: `You've reached your daily limit of ${rateLimitResult.max_lessons} lessons. Please try again tomorrow.`,
            details: {
              current: rateLimitResult.current_count,
              max: rateLimitResult.max_lessons,
              remaining: 0,
            },
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Rate limit check passed for user ${user.id}:`, rateLimitResult);
    }
    
    // Verify lesson ownership
    const { data: lesson, error: lessonError } = await supabaseClient
      .from('lessons')
      .select('user_id')
      .eq('id', lessonId)
      .single();

    if (lessonError || !lesson) {
      logger.error('Lesson not found', { lessonId });
      return new Response(JSON.stringify({ error: SAFE_ERRORS.NOT_FOUND }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (lesson.user_id !== user.id) {
      logger.error('Unauthorized lesson access attempt', { lessonId, userId: user.id });
      return new Response(JSON.stringify({ error: SAFE_ERRORS.FORBIDDEN }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // Server-side enforcement: strip per-lesson voice/quality/template overrides
    // for non-privileged users, applying global defaults instead.
    // =========================================================================
    const { data: userRoleRow } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'dev_team'])
      .maybeSingle();

    const isPrivilegedUser = !!userRoleRow;

    if (!isPrivilegedUser) {
      // Strip preset fields for non-privileged users
      await supabaseClient
        .from('lessons')
        .update({
          preset_id: null,
          preset_snapshot: null,
          preset_applied_by: null,
          preset_applied_at: null,
        })
        .eq('id', lessonId);

      // Fetch global defaults from render_runtime_config
      const { data: configRow } = await supabaseClient
        .from('render_runtime_config')
        .select('config')
        .eq('id', 'global')
        .single();

      const globalDefaults = (configRow?.config as any)?.global_defaults;

      if (globalDefaults) {
        const overridePayload: Record<string, any> = {
          voice_intent_preset: globalDefaults.voice_personality || 'CALM_NARRATOR',
          tts_provider: globalDefaults.tts_provider || 'elevenlabs',
          elevenlabs_voice_id: globalDefaults.voice_id || null,
          elevenlabs_model_id: globalDefaults.voice_model_id || null,
          elevenlabs_stability: globalDefaults.stability ?? 0.5,
          elevenlabs_similarity_boost: globalDefaults.similarity_boost ?? 0.75,
          elevenlabs_style: globalDefaults.style ?? 0.2,
          elevenlabs_use_speaker_boost: globalDefaults.speaker_boost ?? true,
          video_render_profile: globalDefaults.video_quality || 'medium',
          video_template_id: globalDefaults.video_template || 'v4_premium',
        };

        await supabaseClient
          .from('lessons')
          .update(overridePayload)
          .eq('id', lessonId);

        console.log('[generate-lesson] LESSON_VOICE_OVERRIDE_IGNORED: applied global defaults for non-privileged user', {
          userId: user.id,
          lessonId,
        });
      }

      console.log('[generate-lesson] PRESET_STRIPPED_NON_PRIVILEGED', { userId: user.id, lessonId });
    } else {
      // Log preset application for privileged users
      const { data: lessonWithPreset } = await supabaseClient
        .from('lessons')
        .select('preset_id, preset_snapshot')
        .eq('id', lessonId)
        .single();

      if (lessonWithPreset?.preset_id) {
        await trackMetricEvent(supabaseClient, user.id, 'preset_applied_to_lesson', lessonId, {
          preset_id: lessonWithPreset.preset_id,
          preset_snapshot_keys: lessonWithPreset.preset_snapshot ? Object.keys(lessonWithPreset.preset_snapshot) : [],
        });
      }

      console.log('[generate-lesson] LESSON_VOICE_OVERRIDE_APPLIED: privileged user retains per-lesson settings', {
        userId: user.id,
        lessonId,
        role: userRoleRow.role,
        has_preset: !!lessonWithPreset?.preset_id,
      });
    }

    // =========================================================================
    // Server-side idempotency guard: if this lessonId already has a script_plan,
    // it was already generated. Return early to prevent duplicate generation.
    // This is the server-side safety net for the client-side pre-flight check.
    // =========================================================================
    const { data: existingScriptPlan } = await supabaseClient
      .from('script_plans')
      .select('id')
      .eq('lesson_id', lessonId)
      .maybeSingle();

    if (existingScriptPlan) {
      console.log(`[generate-lesson] Idempotency guard: script_plan already exists for lesson ${lessonId}, returning early`);

      // Fetch series info if applicable
      const { data: lessonInfo } = await supabaseClient
        .from('lessons')
        .select('series_id')
        .eq('id', lessonId)
        .single();

      let seriesInfo = null;
      if (lessonInfo?.series_id) {
        const { data: series } = await supabaseClient
          .from('lesson_series')
          .select('id, total_lessons')
          .eq('id', lessonInfo.series_id)
          .single();
        seriesInfo = series;
      }

      return new Response(
        JSON.stringify({
          success: true,
          lessonId,
          alreadyGenerated: true,
          isMultiLesson: !!seriesInfo,
          totalLessons: seriesInfo?.total_lessons || 1,
          seriesId: seriesInfo?.id || null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get child profile for personalization if available
    let childProfile = null;
    let childNickname: string | null = null;
    let profileInterestsRaw: string | null = null;
    let profileValuesRaw: string | null = null;
    
    if (childProfileId) {
      const { data } = await supabaseClient
        .from('child_profiles')
        .select('*')
        .eq('id', childProfileId)
        .eq('user_id', user.id) // Verify ownership
        .single();
      
      if (data) {
        childProfile = data;
        // Extract and trim nickname - it may be null/empty
        const rawNickname = data.child_nickname;
        childNickname = (rawNickname && rawNickname.trim()) ? rawNickname.trim() : null;
        
        // Extract interests and family values as free text
        profileInterestsRaw = data.interests || null;
        profileValuesRaw = data.family_values || null;
      }
    }
    
    // Get lesson-specific blurbs from lesson_outline metadata AND language_code
    const { data: lessonData } = await supabaseClient
      .from('lessons')
      .select('lesson_outline, language_code, child_gender')
      .eq('id', lessonId)
      .single();
    
    const lessonInterestsRaw = lessonData?.lesson_outline?.lesson_interests || null;
    const lessonValuesRaw = lessonData?.lesson_outline?.lesson_values || null;
    const languageCode = lessonData?.language_code || 'en';
    const childGender: string = lessonData?.child_gender || 'neutral';

    // =========================================================================
    // Gender-driven ElevenLabs voice selection (v3):
    //   boy   -> George v3  (JBFqnCBsd6RMkjVDRZzb)
    //   girl  -> Sarah  v3  (EXAVITQu4vr4xnSDxMaL)
    //   other -> random between George v3 and Sarah v3
    // Persist to lesson row so downstream TTS uses it.
    // =========================================================================
    const GENDER_VOICE_GEORGE = 'JBFqnCBsd6RMkjVDRZzb';
    const GENDER_VOICE_SARAH = 'EXAVITQu4vr4xnSDxMaL';
    const genderVoiceId =
      childGender === 'boy'
        ? GENDER_VOICE_GEORGE
        : childGender === 'girl'
        ? GENDER_VOICE_SARAH
        : Math.random() < 0.5
        ? GENDER_VOICE_GEORGE
        : GENDER_VOICE_SARAH;
    await supabaseClient
      .from('lessons')
      .update({
        tts_provider: 'elevenlabs',
        elevenlabs_voice_id: genderVoiceId,
        elevenlabs_model_id: 'eleven_v3',
      })
      .eq('id', lessonId);
    console.log('[generate-lesson] GENDER_VOICE_APPLIED', {
      lessonId,
      childGender,
      voiceId: genderVoiceId,
      modelId: 'eleven_v3',
    });

    // Normalize all blurbs for AI (ensures they don't exceed max length)
    const topicForAI = normalizeParentBlurbForAI(topic);
    const profileInterestsNorm = normalizeParentBlurbForAI(profileInterestsRaw);
    const profileValuesNorm = normalizeParentBlurbForAI(profileValuesRaw);
    const lessonInterestsNorm = normalizeParentBlurbForAI(lessonInterestsRaw);
    const lessonValuesNorm = normalizeParentBlurbForAI(lessonValuesRaw);

    // Unified blurbs for this lesson: lesson overrides profile, else profile is fallback
    const interestsForAI = lessonInterestsNorm ?? profileInterestsNorm;
    const valuesForAI = lessonValuesNorm ?? profileValuesNorm;

    // =========================================================================
    // Second moderation pass: check family_values + interests with language context
    // The first pass (above) checks topic+interest before profile is loaded.
    // This pass catches blocked content in profile values and lesson-level blurbs.
    // =========================================================================
    if (valuesForAI || interestsForAI) {
      const secondPassResult = moderatePromptByField(
        { interests: interestsForAI, values: valuesForAI },
        moderationOverrides,
        languageCode,
      );
      if (!secondPassResult.allowed) {
        logger.warn('PROMPT_BLOCKED_VALUES', {
          category: secondPassResult.category,
          field: secondPassResult.field,
          normalizedInput: secondPassResult.normalizedInput,
          userId: user.id,
          lessonId,
        });
        await trackMetricEvent(supabaseClient, user.id, 'prompt_blocked', lessonId, {
          category: secondPassResult.category,
          field: secondPassResult.field,
          input_preview: secondPassResult.normalizedInput,
          source: 'values_interests',
        });
        // Refund: rate limit was already incremented above but the lesson
        // never produced a deliverable. Don't count it against the user.
        try {
          await supabaseClient.rpc('refund_lesson_count', { _lesson_id: lessonId });
        } catch (refundErr) {
          logger.warn('LESSON_COUNT_REFUND_FAILED', {
            lessonId,
            source: 'content_blocked_values',
            error: refundErr instanceof Error ? refundErr.message : String(refundErr),
          });
        }
        return new Response(
          JSON.stringify({
            error: 'content_blocked',
            message: secondPassResult.message,
            category: secondPassResult.category,
            field: secondPassResult.field,
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Safe logging with PII minimization
    console.log('Generating lesson:', { 
      lessonId, 
      topic: topic.substring(0, 50), // Truncate topic
      ageBand, 
      interest,
      hasChildProfile: !!childProfile,
      hasNickname: !!childNickname,
      hasTopicForAI: !!topicForAI,
      hasInterestsForAI: !!interestsForAI,
      hasValuesForAI: !!valuesForAI,
      languageCode
    });

    // Get content language name from shared helper
    const contentLanguage = languageNames[languageCode] || 'English';

    // =========================================================================
    // PRE-TRANSLATION STEP: Translate inputs to target language if needed
    // (auth flows through geminiGateway SA — GOOGLE_SERVICE_ACCOUNT_GEMINI_JSON)
    // =========================================================================

    // Translate parent inputs to target language
    const translationResult = await translateInputsToLanguage(
      {
        topic: topicForAI || topic,
        interests: interestsForAI,
        values: valuesForAI
      },
      languageCode,
      contentLanguage,
    );

    // Use translated versions for all AI prompts
    const translatedTopic = translationResult.topic;
    const translatedInterests = translationResult.interests;
    const translatedValues = translationResult.values;
    
    console.log('Input translation:', {
      languageCode,
      contentLanguage,
      wasTranslated: translationResult.wasTranslated,
      originalTopicPreview: translationResult.originals.topic?.substring(0, 50),
      translatedTopicPreview: translatedTopic?.substring(0, 50),
    });

    // =========================================================================
    // Compute English topic for music prompt (Lyria 2 requires English input)
    // =========================================================================
    let parentTopicEnglish: string;
    if (languageCode === 'en') {
      // Input is already English
      parentTopicEnglish = topicForAI || topic;
    } else if (translationResult.wasTranslated) {
      // Input was English, got translated to target language
      // originals.topic IS the English version
      parentTopicEnglish = translationResult.originals.topic;
    } else {
      // Input was in target language (e.g., user typed in Polish)
      // Need to translate TO English for Lyria
      try {
        const reverseTranslation = await translateInputsToLanguage(
          { topic: topicForAI || topic },
          'en',
          'English',
        );
        parentTopicEnglish = reverseTranslation.topic;
        console.log('Reverse-translated topic to English for music:', {
          originalPreview: (topicForAI || topic).substring(0, 50),
          englishPreview: parentTopicEnglish.substring(0, 50),
        });
      } catch (err) {
        // Graceful fallback: use original (Lyria may reject it, but better than crashing)
        console.warn('Failed to reverse-translate topic to English, using original', {
          error: err instanceof Error ? err.message : String(err),
        });
        parentTopicEnglish = topicForAI || topic;
      }
    }

    // Check sophistication flag
    const enableSophistication = Deno.env.get('ENABLE_LESSON_SOPHISTICATION') === 'true';
    const ageSpec = enableSophistication ? await getAgeSpecFromDB(supabaseClient, ageBand) : null;

    // Step 1: Assess topic complexity to choose appropriate AI model
    console.log('Assessing topic complexity...', { enableSophistication, exactAge: ageSpec?.age });
    const complexityPrompt = enableSophistication
      ? `Assess the complexity of this educational topic for a ${ageSpec!.age}-year-old child (${ageSpec!.stageLabel}).
Topic: "${translatedTopic}"

${buildAgeSectionForPrompt(ageSpec!)}

Complexity Assessment Criteria:
1. ABSTRACT vs CONCRETE: Is it tangible (animals, toys, colors) or abstract (emotions, time, physics)?
2. SCOPE: Is it narrow (specific letter) or broad (entire alphabet, scientific field)?
3. SCIENTIFIC DEPTH: Does it involve scientific concepts, theories, or processes?
4. PREREQUISITE KNOWLEDGE: Does it require understanding other concepts first?
5. AGE APPROPRIATENESS: Is this typically taught in one session or across multiple grades?

Examples of COMPLEX topics needing series:
- Scientific concepts: "Quantum physics", "Space exploration", "How weather works", "Photosynthesis", "Gravity"
- Abstract concepts: "Time", "Emotions", "Friendship", "Democracy"
- Broad categories: "Animals", "Planets", "How things work", "Transportation"
- Multi-part concepts: Alphabet, numbers 1-20, days/months, body systems

Examples of SIMPLE topics for single lessons:
- Specific items: "The letter A", "The number 5", "Circles", "Red color"
- Concrete objects: "Cat", "Ball", "Apple", "Sun"
- Single actions: "Jumping", "Clapping", "Waving"

CRITICAL: If a topic is scientific, abstract, or typically taught across multiple grades/lessons, it's COMPLEX.

Respond with complexity level: "simple" or "complex"`
      : `Assess the complexity of this educational topic for children aged ${ageBand}.
Topic: "${translatedTopic}"

Complexity Assessment Criteria:
1. ABSTRACT vs CONCRETE: Is it tangible (animals, toys, colors) or abstract (emotions, time, physics)?
2. SCOPE: Is it narrow (specific letter) or broad (entire alphabet, scientific field)?
3. SCIENTIFIC DEPTH: Does it involve scientific concepts, theories, or processes?
4. PREREQUISITE KNOWLEDGE: Does it require understanding other concepts first?
5. AGE APPROPRIATENESS: Is this typically taught in one session or across multiple grades?

Examples of COMPLEX topics needing series:
- Scientific concepts: "Quantum physics", "Space exploration", "How weather works", "Photosynthesis", "Gravity"
- Abstract concepts: "Time", "Emotions", "Friendship", "Democracy"
- Broad categories: "Animals", "Planets", "How things work", "Transportation"
- Multi-part concepts: Alphabet, numbers 1-20, days/months, body systems

Examples of SIMPLE topics for single lessons:
- Specific items: "The letter A", "The number 5", "Circles", "Red color"
- Concrete objects: "Cat", "Ball", "Apple", "Sun"
- Single actions: "Jumping", "Clapping", "Waving"

CRITICAL: If a topic is scientific, abstract, or typically taught across multiple grades/lessons, it's COMPLEX.

Respond with complexity level: "simple" or "complex"`;

    // Add timeout handling for complexity assessment
    let isComplexTopic = false;
    let complexityReasoning = 'Default assessment due to timeout or error';
    
    try {
      const complexityController = new AbortController();
      const complexityTimeout = setTimeout(() => complexityController.abort(), 8000); // 8 second timeout

      const complexityResponse = await callGeminiChatCompletion({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'user', content: complexityPrompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'assess_complexity',
            description: 'Assess topic complexity level',
            parameters: {
              type: 'object',
              properties: {
                complexity_level: {
                  type: 'string',
                  enum: ['simple', 'complex'],
                  description: 'Overall complexity assessment'
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of the assessment'
                }
              },
              required: ['complexity_level', 'reasoning']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'assess_complexity' } }
      }, { signal: complexityController.signal });

      clearTimeout(complexityTimeout);

      if (complexityResponse.ok) {
        const complexityData = await complexityResponse.json();
        // Record LLM usage for complexity check
        if (complexityData.usage) {
          recordLlmUsage(supabaseClient, lessonId, 'google/gemini-2.5-flash-lite', complexityData.usage).catch(() => {});
        }
        const complexityCall = complexityData.choices?.[0]?.message?.tool_calls?.[0];
        if (complexityCall) {
          const complexityResult = JSON.parse(complexityCall.function.arguments);
          isComplexTopic = complexityResult.complexity_level === 'complex';
          complexityReasoning = complexityResult.reasoning || complexityReasoning;
        }
      } else {
        logger.error('Complexity assessment returned non-OK status', { status: complexityResponse.status });
      }
    } catch (error) {
      logger.error('Complexity assessment error (defaulting to simple)');
      // Default to simple/fast model on error
      isComplexTopic = false;
    }
    
    console.log('Complexity assessment:', { 
      level: isComplexTopic ? 'complex' : 'simple', 
      reasoning: complexityReasoning,
      willUseModel: isComplexTopic ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview'
    });

    // Step 2: Analyze if topic needs multiple lessons (using model based on complexity)
    const targetDuration = ageSpec ? ageSpec.lessonDurationSeconds : 30;
    const ageLabel = ageSpec ? `a ${ageSpec.age}-year-old (${ageSpec.stageLabel})` : `${ageBand} year-olds`;
    const plannerPrompt = `Analyze if this topic requires multiple ${targetDuration}-second lessons or can be covered in one lesson.
Topic: "${translatedTopic}"
Age: ${ageSpec ? `${ageSpec.age} (${ageSpec.stageLabel})` : ageBand}

Write all output (series_title, lesson titles, objectives) in ${contentLanguage}.

PRIMARY GOAL: MAXIMIZE LEARNING EFFECTIVENESS - Each child must truly master the skill/concept.

FOUNDATIONAL LEARNING RULE (STRICT - NO EXCEPTIONS):
For topics that are discrete, sequential learning elements, EACH element MUST have its own dedicated lesson.

MANDATORY ONE-LESSON-PER-ELEMENT TOPICS:
✓ Alphabet → EXACTLY 26 lessons
✓ Numbers 1-10 → EXACTLY 10 lessons
✓ Days of week → EXACTLY 7 lessons
✓ Months of year → EXACTLY 12 lessons
✓ Basic shapes → 5-6 lessons

COMPLEX TOPICS (break into logical subtopics):
- Scientific concepts → 6-8 lessons
- Broad categories → 8-10 lessons
- Systems → 6-8 lessons

SIMPLE SINGLE-LESSON TOPICS:
- Specific items: "The letter A", "The number 5", "Red color"
- Single concepts: "Jumping", "Circles", "Rain"

TARGET LESSON DURATION: ~${targetDuration} seconds each.

LANGUAGE SAFETY - CRITICAL:
- ALL content must use simple, age-appropriate language for ${ageLabel}
- NEVER use complex scientific terminology or jargon

NAMING GUIDELINES:
- Series titles: Kid-friendly and fun
- Lesson titles: NEVER include "Lesson 1:" prefixes - UI shows numbers
- Use playful language kids understand${ageSpec ? buildPlannerProgressionGuidance(ageSpec) : ''}`;

    console.log(`Calling planner AI with gemini-2.5-flash...`);
    const plannerResponse = await callGeminiChatCompletion({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'user', content: plannerPrompt }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'create_lesson_plan',
          description: 'Create a lesson plan structure',
          parameters: {
            type: 'object',
            properties: {
              needs_multiple_lessons: { type: 'boolean' },
              total_lessons: { type: 'number' },
              series_title: { type: 'string' },
              series_description: { type: 'string' },
              lessons: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sequence: { type: 'number' },
                    title: { type: 'string' },
                    objective: { type: 'string' },
                    estimated_seconds: { type: 'number' },
                    difficulty_stage: {
                      type: 'string',
                      enum: ['introduce', 'explore', 'challenge', 'synthesize'],
                      description: 'Progression stage for this lesson in the series difficulty curve'
                    }
                  },
                  required: ['sequence', 'title', 'objective', 'estimated_seconds', 'difficulty_stage']
                }
              }
            },
            required: ['needs_multiple_lessons', 'total_lessons', 'lessons']
          }
        }
      }],
      tool_choice: { type: 'function', function: { name: 'create_lesson_plan' } }
    });

    if (!plannerResponse.ok) {
      logger.error('Planner AI error', { status: plannerResponse.status });
      if (plannerResponse.status === 429) {
        return new Response(JSON.stringify({ error: SAFE_ERRORS.RATE_LIMIT }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (plannerResponse.status === 402) {
        return new Response(JSON.stringify({ error: SAFE_ERRORS.QUOTA_EXCEEDED }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: SAFE_ERRORS.AI_FAILED }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Planner AI response received, parsing...');
    console.log('[generate-lesson] Stage: planner_parse_started');
    
    let plannerData;
    try {
      plannerData = await plannerResponse.json();
      // Record LLM usage for planner call
      if (plannerData.usage) {
        recordLlmUsage(supabaseClient, lessonId, 'google/gemini-2.5-flash', plannerData.usage).catch(() => {});
      }
    } catch (jsonErr) {
      console.error('[generate-lesson] Failed to parse planner response JSON:', jsonErr);
      await supabaseClient.from('lessons').update({
        status: 'failed',
        tts_error: 'PLANNER_RESPONSE_INVALID_JSON',
      }).eq('id', lessonId);
      return new Response(JSON.stringify({ error: SAFE_ERRORS.AI_FAILED, stage: 'planner_parse' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const toolCall = plannerData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      const responsePreview = JSON.stringify(plannerData).substring(0, 500);
      console.error('[generate-lesson] No tool call in planner response:', { responsePreview });
      await supabaseClient.from('lessons').update({
        status: 'failed',
        tts_error: 'PLANNER_NO_TOOL_CALL',
      }).eq('id', lessonId);
      return new Response(JSON.stringify({ error: SAFE_ERRORS.AI_FAILED, stage: 'planner_tool_call' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    let lessonPlan;
    try {
      lessonPlan = JSON.parse(toolCall.function.arguments);
    } catch (planParseErr) {
      const argsPreview = String(toolCall.function?.arguments || '').substring(0, 300);
      console.error('[generate-lesson] Failed to parse lesson plan arguments:', { argsPreview, error: planParseErr });
      await supabaseClient.from('lessons').update({
        status: 'failed',
        tts_error: 'PLANNER_ARGS_INVALID_JSON',
      }).eq('id', lessonId);
      return new Response(JSON.stringify({ error: SAFE_ERRORS.AI_FAILED, stage: 'planner_args_parse' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('[generate-lesson] Stage: planner_parse_ok');
    // Record plan_ready_at timestamp
    upsertPipelineMetrics(supabaseClient, lessonId, { plan_ready_at: new Date().toISOString() }).catch(() => {});
    console.log('Lesson plan created:', { 
      needsMultiple: lessonPlan.needs_multiple_lessons, 
      total: lessonPlan.total_lessons,
      usedComplexModel: isComplexTopic
    });

    // Step 3: Generate lesson content using author model
    const generateLessonContent = async (lessonTitle: string, lessonObjective: string, sequenceNum: number, totalInSeries: number) => {
      let systemPrompt: string;

      if (ageSpec) {
        // Sophistication-enabled: use spec-driven prompt
        systemPrompt = `You are an expert educational content creator for children.
Create engaging, age-appropriate ~${ageSpec.lessonDurationSeconds}-second mini-lessons.

${buildAgeSectionForPrompt(ageSpec)}

Write the entire output in ${contentLanguage} (${languageCode}).

CRITICAL VOICE & AUDIENCE RULES (MUST FOLLOW):
- The lesson script is spoken directly to the child by a friendly narrator
- ALWAYS address the learner as "you" (second person)
- You may occasionally use the child's nickname if provided, but the primary point of view is "you"
- DO NOT talk about "your child" or "their child" - that is parent-facing language
- DO NOT refer to the child in third person ("the child", "the kid") when giving instructions
- Speak directly to them: "You can...", "Let's try...", "Can you find..."

CRITICAL LANGUAGE REQUIREMENTS:
- Use ONLY words within the vocabulary tier described above — no scientific jargon or adult terminology
- Explain complex concepts using playful analogies kids can see, touch, or experience
  Example: "gravity" → "the invisible hug that keeps us on the ground"
  Example: "photosynthesis" → "plants eating sunlight for lunch"
- Keep sentences within the ${ageSpec.sentenceLengthRange[0]}-${ageSpec.sentenceLengthRange[1]} word range — this is a HARD ceiling
- ${ageSpec.repetitionStyle}
- NEVER switch to adult/scientific language mid-lesson`;
      } else {
        // Legacy path: hardcoded age band
        systemPrompt = `You are an expert educational content creator for young children aged ${ageBand}. 
Create engaging, age-appropriate 30-second mini-lessons that are fun and easy to understand.

Write the entire output in ${contentLanguage} (${languageCode}).

CRITICAL VOICE & AUDIENCE RULES (MUST FOLLOW):
- The lesson script is spoken directly to the child by a friendly narrator
- ALWAYS address the learner as "you" (second person)
- You may occasionally use the child's nickname if provided, but the primary point of view is "you"
- DO NOT talk about "your child" or "their child" - that is parent-facing language
- DO NOT refer to the child in third person ("the child", "the kid") when giving instructions
- Speak directly to them: "You can...", "Let's try...", "Can you find..."

CRITICAL LANGUAGE REQUIREMENTS:
- Use ONLY simple words a ${ageBand} year-old knows (no scientific jargon, no complex terms)
- Explain complex concepts using playful analogies kids can see/touch/experience
- Keep sentences SHORT (5-8 words max)
- Use repetition and rhythm for memory
- NEVER switch to adult/scientific language mid-lesson`;
      }

      if (totalInSeries > 1) {
        systemPrompt += `\n\nThis is lesson ${sequenceNum} of ${totalInSeries} in a series about "${translatedTopic}".`;
        if (sequenceNum > 1) {
          systemPrompt += ` Build upon previous lessons naturally, using same simple language.`;
        }
        // Phase 5: Add progression guidance when sophistication is enabled.
        // The difficulty_stage comes from the planner output (stored in lesson_outline).
        // For lesson 1 (generated inline), we read it from the planner result directly.
        systemPrompt += buildProgressionGuidance(ageSpec, sequenceNum, totalInSeries);
      }

      // Add child nickname and personalization rules
      systemPrompt += `\n\n=== CHILD NICKNAME AND PERSONALIZATION RULES (MUST FOLLOW) ===`;
      
      if (childNickname) {
        systemPrompt += `\nChild nickname: "${childNickname}"`;
        systemPrompt += `\n- Use this exact nickname naturally in the lesson 1-3 times (e.g., "${childNickname}, let's try this together!")`;
        systemPrompt += `\n- Do NOT wrap it in brackets or quotes; just use it in normal sentences`;
      } else {
        systemPrompt += `\nChild nickname: none`;
        systemPrompt += `\n- There is NO nickname for this child`;
        systemPrompt += `\n- Do NOT invent any name`;
      }
      
      // Add child gender context for pronouns and examples
      if (childGender === 'boy' || childGender === 'girl') {
        const pronouns = childGender === 'boy' ? 'he/him/his' : 'she/her/her';
        systemPrompt += `\n\n=== CHILD GENDER (USE FOR PRONOUNS AND EXAMPLES) ===
The child this lesson is for is a ${childGender}.
- Use ${pronouns} pronouns when referring to the child in third-person examples
- Choose examples and scenarios that feel relatable (this is a gentle preference, not a strict restriction)
- Do NOT stereotype — all topics are for all children regardless of gender`;
      }
      
      systemPrompt += `\n\nCRITICAL PLACEHOLDER RULES:
- NEVER output placeholder tokens like "[Child's Name]", "[child name]", "[kid's name]" or any similar square-bracket placeholders
- NEVER use "your child" in the kid-facing script
- If nickname is provided, use it naturally; if not, speak directly to the child using "you"
- Generic friendly terms like "buddy" or "friend" are okay if used sparingly`;
      
      // Add topic and parent blurbs with clear instructions (using translated versions)
      systemPrompt += `\n\n=== LESSON TOPIC AND PARENT BLURBS (MUST FOLLOW) ===`;
      
      systemPrompt += `\n\nParent request for this lesson:`;
      systemPrompt += `\n- Parent's description of what they want KidTok to teach: "${translatedTopic}"`;
      
      systemPrompt += `\n\nPersonalization for this lesson:`;
      systemPrompt += `\n- Interests blurb: "${translatedInterests || 'none'}"`;
      systemPrompt += `\n- Values and boundaries blurb: "${translatedValues || 'none'}"`;
      
      systemPrompt += `\n\n=== FAMILY VALUES AND BOUNDARIES (MUST FOLLOW - HIGHEST PRIORITY) ===
The parent may have provided a "values and boundaries" blurb for this lesson: "${translatedValues || 'none'}".
This may have been pre-filled from a saved child profile and/or typed just for this lesson. Treat it as the family's final instructions for what is allowed or not allowed.

CRITICAL RULES FOR VALUES/BOUNDARIES:
- If the values/boundaries blurb is not "none", you MUST extract and follow ALL restrictions mentioned.
- Common boundary examples and what they mean:
  * "avoid scary content" or "nothing scary" → NO monsters, dragons, villains, ghosts, demons, darkness used in a scary way, spooky things, danger, threats. Do not use the words "monster", "monsters", "dragon", "dragons", "ghost", "ghosts" anywhere in the lesson. Do not replace them with obvious scary substitutes like "beast", "creature", or "giant lizard".
  * "avoid monsters" or "avoid dragons" → NO monsters, dragons, creatures, beasts, scary animals or characters. Do not use the words "monster", "monsters", "dragon", or "dragons" anywhere in the lesson, even for cute or friendly characters.
  * "avoid violence" → NO fighting, hitting, weapons, conflict, battles.
  * "keep it gentle" → Use a soft, calm tone; avoid intense fear, shouting, or chaos.
  * "no magic" → NO wizards, spells, magical creatures, fantasy powers.
  * Religious/faith values → Respect mentioned beliefs; avoid contradicting them. If the parent explicitly mentions God or faith in the values blurb, you MUST include 1 simple, gentle line that reflects this family's perspective in a kid-friendly way, for example:
    - "Your family believes that God made this beautiful world."
    - "Your parents feel that God is close when you see nature."
    Always:
    - Present this as the family's belief, not as a universal fact for everyone.
    - Keep the tone kind and non-judgmental.
    - Do NOT criticize other beliefs or non-belief.
    If the parent does NOT mention God or faith at all, do not introduce religious content on your own.
- When in doubt, err on the side of caution: if something MIGHT violate a boundary, don't include it.
- These restrictions apply to ALL parts of the lesson: hook, teaching/explanations, examples, quiz questions, and any rewards or endings.

=== INSTRUCTIONS FOR USING TOPIC AND BLURBS (MUST FOLLOW) ===
- The parent's description of what they want KidTok to teach is always present. It defines the core teaching goal for this lesson.
- The parent may also have provided:
  - An "interests" blurb for this lesson (what the child likes).
  - A "values and boundaries" blurb for this lesson (what the family allows or prefers).
- These blurbs are OPTIONAL:
  - They may effectively be "none" if the parent didn't provide them.
  - They may have been pre-filled from a saved child profile and/or edited just for this lesson.
  - You do NOT need to care where they came from; treat them as the parent's final instructions for this lesson.
- If some or all blurbs are "none":
  - Still create a complete, age-appropriate lesson using the topic (and age band / child profile if available).
  - Do not assume there is something wrong; just proceed with the information you do have.
- When blurbs are present:
  - FIRST: Extract any boundaries/restrictions from the values/boundaries blurb - these are NON-NEGOTIABLE.
  - THEN: Summarize interests into themes for examples and personalization.
- Use interests to add fun personalization (e.g., if the child loves dinosaurs, use dino examples).
- Use values to shape tone and ensure content respects family preferences.
- Do NOT copy long sentences directly from the blurbs; rewrite them into natural, kid-friendly language.
- If any of these fields are "none", simply ignore them and proceed with what you have.
- The personalization should feel like a natural part of teaching, not awkwardly inserted.

=== USING INTERESTS FOR EXAMPLES (MUST FOLLOW) ===
- Use the "interests" blurb for this lesson as your single source of information about what this child likes. It may describe things like butterflies, trains, cars, swimming, dinosaurs, space, soccer, Lego, animals, etc.
- Look for specific, concrete interests in that blurb (for example: butterflies, trains, cars, swimming, dinosaurs, space, soccer, Lego, animals).
- FIRST, check all interests against the family's values and boundaries:
  - If an interest would clearly violate a boundary (for example, scary monsters when the parent says "avoid scary content"), do NOT use that interest at all.
- From the remaining safe interests:
  - Choose 1–2 interests that best fit the topic of this lesson.
  - When at least one safe, relevant interest exists, you MUST include at least one clear example, scene, or comparison using one of those interests in this lesson.
    - Example: If the child loves butterflies and the topic is nature, you might say: "Look at the little butterfly! It flaps its wings in nature."
    - Example: If the child loves swimming and the topic is counting, you might say: "You see 3 waves when you swim."
- Do NOT awkwardly cram every interest into every lesson:
  - It is better to use 1–2 interests in a natural way than to force many unrelated ones.
- If, after checking boundaries and topic, there are no safe or relevant interests, or the interests blurb is effectively "none":
  - Fall back to generic but kid-friendly examples that match the topic.`;
      
      systemPrompt += `\n=== END TOPIC AND PERSONALIZATION ===`;

      if (interest && !interestsForAI?.includes(interest)) {
        systemPrompt += `\n\nTheme: Use ${interest} related examples and imagery in SIMPLE, kid-friendly language.`;
      }

      const quizChoiceCount = ageSpec ? ageSpec.quizChoices : 3;
      const quizChoiceExamples = Array.from({ length: quizChoiceCount }, (_, i) => `"Choice ${i + 1}"`).join(', ');
      
      systemPrompt += `\n\nFormat your response as JSON with this structure:
{
  "hook_text": "A catchy 5-8 word phrase with rhythm or rhyme",
  "model_lines": ["Example 1", "Example 2", "Example 3"],
  "quiz_question": "A COMPLETE sentence question that tests understanding of the lesson",
  "quiz_choices": [${quizChoiceExamples}],
  "correct_index": 0,
  "reward_label": "Reward sticker name",
  "thumbnail_emoji": "One emoji representing the topic",
  "parent_recap_points": ["Knowledge point 1", "Knowledge point 2", "Knowledge point 3"]
}

CRITICAL QUIZ QUESTION RULES:
- quiz_question MUST be a COMPLETE, grammatically correct sentence
- The question MUST have a clear subject and verb
- The question should directly test something taught in the lesson

CRITICAL QUIZ CHOICES RULES:
- quiz_choices MUST be exactly ${quizChoiceCount} options
- Each choice MUST be a COMPLETE word or short phrase that directly answers the question
- One choice must be clearly correct, the others should be plausible but wrong
${ageSpec ? `- Quiz style: ${ageSpec.quizStyle}` : ''}

CRITICAL PARENT RECAP RULES:
- parent_recap_points MUST be 3 short bullets written FOR THE PARENT (third-person, e.g. "Your child learned…", "They now understand…", "They can name…").
- Each bullet summarizes the KNOWLEDGE the child gained — NOT the script lines the child heard.
- Do NOT copy or paraphrase model_lines verbatim. Translate "what was said TO the child" into "what the child now KNOWS".
- Each bullet ≤ 14 words, plain language, no emojis, no quotes.
- parent_recap_points MUST be written in ${contentLanguage} (${languageCode}) — the SAME language as model_lines, quiz_question, and quiz_choices. Do NOT default to English. If the lesson language is Polish, write the bullets in Polish; if Spanish, in Spanish; etc.

Guidelines:
- Use ONLY simple words appropriate for ${ageSpec ? `age ${ageSpec.age}` : `age ${ageBand}`}
- Make it playful and positive${ageSpec && ageSpec.age <= 6 ? ' with rhythm/rhyme when possible' : ''}
- Include 2-3 clear, concrete examples kids can visualize
- AVOID: vocabulary beyond the age tier above, scientific terms without kid-friendly analogies
- AVOID emojis: weapons, violence, scary faces, alcohol, adult content

IMPORTANT: The lesson title "${lessonTitle}" is already provided and should NOT be repeated or modified in the generated content.`;

      systemPrompt += ageSpec
        ? `\n\nREMINDER: No matter how complex the topic — ${ageSpec.promptFraming}`
        : `\n\nREMINDER: No matter how complex the topic, use language a ${ageBand} year-old can understand. Think: "How would I explain this to a preschooler?"`;

      // Safe logging with prompt preview (first 200 chars only, no PII)
      const safePromptPreview = systemPrompt.substring(0, 200).replace(/Child's nickname: \w+/g, 'Child\'s nickname: [REDACTED]');
      console.log(`Generating content for lesson ${sequenceNum}/${totalInSeries}`, {
        promptLength: systemPrompt.length,
        promptPreview: safePromptPreview + '...',
        hasPersonalization: !!(childNickname || interestsForAI || valuesForAI)
      });
      const contentResponse = await callGeminiChatCompletion({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Create a ${ageSpec ? ageSpec.lessonDurationSeconds : 30}-second lesson: "${lessonTitle}"\nObjective: ${lessonObjective}\nParent's topic: "${translatedTopic}"` }
        ],
        temperature: 0.8,
      });

      if (!contentResponse.ok) {
        const errorBody = await contentResponse.text().catch(() => 'unknown');
        console.error('[generate-lesson] Content generation API failed:', { 
          sequenceNum, 
          status: contentResponse.status,
          bodyPreview: errorBody.substring(0, 200),
        });
        throw new Error(`Content generation failed: ${contentResponse.status}`);
      }

      console.log(`[generate-lesson] Stage: content_generated for lesson ${sequenceNum}, parsing...`);
      const contentData = await contentResponse.json();
      // Record LLM usage for content generation
      if (contentData.usage) {
        recordLlmUsage(supabaseClient, lessonId, 'google/gemini-2.5-flash', contentData.usage).catch(() => {});
      }
      const content = contentData.choices?.[0]?.message?.content;
      
      if (!content) {
        console.error('[generate-lesson] No content in AI response:', {
          sequenceNum,
          dataPreview: JSON.stringify(contentData).substring(0, 300),
        });
        throw new Error(`No content in AI response for lesson ${sequenceNum}`);
      }
      
      const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      let parsedContent;
      try {
        parsedContent = JSON.parse(jsonContent);
      } catch (parseErr) {
        console.error('[generate-lesson] Failed to parse content JSON:', {
          sequenceNum,
          jsonPreview: jsonContent.substring(0, 300),
          error: parseErr,
        });
        throw new Error(`Content JSON parse failed for lesson ${sequenceNum}`);
      }
      
      // Apply output guardrails to catch any placeholder issues
      return sanitizeLessonContent(parsedContent, childNickname);
    };

    // Step 4: Handle multi-lesson or single lesson
    if (lessonPlan.needs_multiple_lessons && lessonPlan.total_lessons > 1) {
      // Create lesson series
      const estimatedTotalSeconds = lessonPlan.lessons.reduce((sum: number, l: any) => sum + (l.estimated_seconds || 30), 0);
      
      const { data: series, error: seriesError } = await supabaseClient
        .from('lesson_series')
        .insert({
          user_id: user.id,
          title: lessonPlan.series_title || translatedTopic,
          description: lessonPlan.series_description || `Learn ${translatedTopic} step by step`,
          topic: translationResult.originals.topic, // Original parent input preserved
          topic_localized: translatedTopic, // Translated for AI prompts
          age_band: ageBand,
          interest: interest || lessonInterestsNorm || profileInterestsNorm || null,
          total_lessons: lessonPlan.total_lessons,
          estimated_total_seconds: estimatedTotalSeconds,
          series_plan: lessonPlan.lessons,
          status: 'in_progress'
        })
        .select()
        .single();

      if (seriesError || !series) {
        logger.error('Error creating series');
        return new Response(JSON.stringify({ error: SAFE_ERRORS.SERVER_ERROR }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Series created:', series.id);

      // Track series creation event
      await trackMetricEvent(supabaseClient, user.id, 'series_created', lessonId, {
        series_id: series.id,
        total_lessons: lessonPlan.total_lessons,
        topic: topic,
        age_band: ageBand
      });

      // Update the existing first lesson with series info
      await supabaseClient
        .from('lessons')
        .update({
          series_id: series.id,
          sequence_number: 1,
          topic: lessonPlan.lessons[0].title,
          lesson_outline: lessonPlan.lessons[0],
          status: 'generating',
          parent_topic_original: parentTopicEnglish,
          parent_topic_localized: translatedTopic,
        })
        .eq('id', lessonId);

      // =========================================================================
      // TASK 1: Fetch lesson-1 TTS snapshot from DB (canonical source of truth)
      // =========================================================================
      // IMPORTANT:
      // Lesson 1's DB row is the canonical "series TTS template" at creation time.
      // Any new TTS-related columns added to the lessons table MUST be:
      //  1) Selected here, and
      //  2) Copied into remainingLessons below,
      // so that all lessons in a series start with identical TTS configuration.
      
      interface LessonTtsSettings {
        tts_provider: 'google' | 'elevenlabs' | null;
        tts_voice_name: string | null;
        tts_speaking_rate: number | null;
        tts_pitch: number | null;
        elevenlabs_voice_id: string | null;
        elevenlabs_model_id: string | null;
        elevenlabs_stability: number | null;
        elevenlabs_similarity_boost: number | null;
        elevenlabs_style: number | null;
        elevenlabs_use_speaker_boost: boolean | null;
      }
      
      // Helper to derive provider from row data (handles legacy null provider)
      function deriveTtsProviderFromRow(row: LessonTtsSettings): 'google' | 'elevenlabs' | null {
        if (row.tts_provider === 'google' || row.tts_provider === 'elevenlabs') {
          return row.tts_provider;
        }
        // Infer from data if provider is null (legacy rows)
        if (row.elevenlabs_voice_id) {
          return 'elevenlabs';
        }
        if (row.tts_voice_name) {
          return 'google';
        }
        return null;
      }
      
      const { data: firstLessonTtsRow, error: ttsSnapshotError } = await supabaseClient
        .from('lessons')
        .select(`
          tts_provider,
          tts_voice_name,
          tts_speaking_rate,
          tts_pitch,
          elevenlabs_voice_id,
          elevenlabs_model_id,
          elevenlabs_stability,
          elevenlabs_similarity_boost,
          elevenlabs_style,
          elevenlabs_use_speaker_boost,
          elevenlabs_speed,
          voice_intent_preset,
          language_code,
          video_template_id,
          video_render_profile,
          preset_id,
          preset_snapshot,
          preset_applied_by,
          preset_applied_at
        `)
        .eq('id', lessonId)
        .single();
      
      if (ttsSnapshotError || !firstLessonTtsRow) {
        console.error('[generate-lesson] Failed to load first lesson TTS settings', {
          lessonId,
          seriesId: series.id,
          error: ttsSnapshotError,
        });
        // INVARIANT: Do NOT proceed to create remainingLessons with unknown TTS config
        return new Response(JSON.stringify({ error: SAFE_ERRORS.SERVER_ERROR }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const derivedProvider = deriveTtsProviderFromRow(firstLessonTtsRow as LessonTtsSettings);
      
      console.log('[generate-lesson] First lesson TTS snapshot loaded', {
        lessonId,
        seriesId: series.id,
        derived_provider: derivedProvider,
        tts_voice_name: firstLessonTtsRow.tts_voice_name,
        elevenlabs_voice_id: firstLessonTtsRow.elevenlabs_voice_id,
      });

      // =========================================================================
      // TASK 2: Apply lesson-1 TTS snapshot to all remaining lessons
      // =========================================================================
      // NOTE:
      // We intentionally copy lesson 1's TTS settings into every new lesson in the series.
      // This makes lesson 1 the "initial series TTS template".
      // Later edits to lesson 1's TTS settings do NOT auto-update other lessons.
      // If per-lesson or dynamic series-level overrides are needed in the future,
      // they should be added as explicit features, not implicit behavior here.
      
      const remainingLessons = lessonPlan.lessons.slice(1).map((l: any) => ({
        user_id: user.id,
        child_profile_id: childProfileId || null,
        child_gender: childGender,
        series_id: series.id,
        sequence_number: l.sequence,
        topic: l.title,
        age_band: ageBand,
        interest: interest || lessonInterestsNorm || profileInterestsNorm || null,
        status: 'queued',
        lesson_outline: {
          title: l.title,
          objective: l.objective,
          estimated_seconds: l.estimated_seconds
        },
        // TTS configuration: immutable series-time snapshot from lesson 1
        tts_provider: derivedProvider ?? null,
        tts_voice_name: firstLessonTtsRow.tts_voice_name ?? null,
        tts_speaking_rate: firstLessonTtsRow.tts_speaking_rate ?? null,
        tts_pitch: firstLessonTtsRow.tts_pitch ?? null,
        elevenlabs_voice_id: firstLessonTtsRow.elevenlabs_voice_id ?? null,
        elevenlabs_model_id: firstLessonTtsRow.elevenlabs_model_id ?? null,
        elevenlabs_stability: firstLessonTtsRow.elevenlabs_stability ?? null,
        elevenlabs_similarity_boost: firstLessonTtsRow.elevenlabs_similarity_boost ?? null,
        elevenlabs_style: firstLessonTtsRow.elevenlabs_style ?? null,
        elevenlabs_use_speaker_boost: firstLessonTtsRow.elevenlabs_use_speaker_boost ?? null,
        elevenlabs_speed: firstLessonTtsRow.elevenlabs_speed ?? null,
        // Phase 1b: Copy voice intent preset from lesson 1
        voice_intent_preset: firstLessonTtsRow.voice_intent_preset ?? 'CALM_NARRATOR',
        // Copy language code from lesson 1
        language_code: firstLessonTtsRow.language_code ?? 'en',
        // Copy video settings from lesson 1
        video_template_id: firstLessonTtsRow.video_template_id ?? null,
        video_render_profile: firstLessonTtsRow.video_render_profile ?? null,
        // Copy preset/shot config from lesson 1 (per-lesson custom shots propagate to series)
        preset_id: firstLessonTtsRow.preset_id ?? null,
        preset_snapshot: firstLessonTtsRow.preset_snapshot ?? null,
        preset_applied_by: firstLessonTtsRow.preset_applied_by ?? null,
        preset_applied_at: firstLessonTtsRow.preset_applied_at ?? null,
        // English topic for music prompt (Lyria requires English)
        parent_topic_original: parentTopicEnglish,
        parent_topic_localized: translatedTopic,
      }));
      
      console.log('[generate-lesson] Creating remaining lessons with TTS snapshot', {
        seriesId: series.id,
        remainingCount: remainingLessons.length,
        ttsProvider: derivedProvider,
        googleVoice: firstLessonTtsRow.tts_voice_name,
        elevenLabsVoice: firstLessonTtsRow.elevenlabs_voice_id,
      });

      let createdLessons: any[] = [];
      if (remainingLessons.length > 0) {
        const { data, error: lessonsError } = await supabaseClient
          .from('lessons')
          .insert(remainingLessons)
          .select();

        if (lessonsError || !data) {
          logger.error('Error creating lessons');
          return new Response(JSON.stringify({ error: SAFE_ERRORS.SERVER_ERROR }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        createdLessons = data;
      }

      console.log('Generating content for lessons 1 and 2');

      // Generate content for lesson 1
      const lesson1Content = await generateLessonContent(
        lessonPlan.lessons[0].title,
        lessonPlan.lessons[0].objective,
        1,
        lessonPlan.total_lessons
      );

      await supabaseClient.from('script_plans').insert({
        lesson_id: lessonId,
        hook_text: lesson1Content.hook_text,
        model_lines: lesson1Content.model_lines,
        quiz_question: lesson1Content.quiz_question,
        quiz_choices: lesson1Content.quiz_choices,
        correct_index: lesson1Content.correct_index,
        reward_label: lesson1Content.reward_label,
        parent_recap_points: lesson1Content.parent_recap_points ?? null,
      });

      // ── AI camera planner (Phase C) ─────────────────────────────────────
      // Enrich preset_snapshot.camera_choreography with an LLM-planned per-shot
      // camera config. Skipped entirely when ENABLE_VIDEO_COST_SAVINGS=true OR
      // when global_defaults.ai_camera_planner.enabled !== true. Failure is
      // soft — we always retain whatever camera config was already on the row.
      try {
        const costSaving = (Deno.env.get('ENABLE_VIDEO_COST_SAVINGS') ?? '').toLowerCase() === 'true';
        const { data: cfgRow } = await supabaseClient
          .from('render_runtime_config')
          .select('config')
          .eq('id', 'global')
          .single();
        const aiPlanner = (cfgRow?.config as any)?.global_defaults?.ai_camera_planner;
        const plannerEnabled = !!aiPlanner?.enabled;
        if (plannerEnabled && !costSaving) {
          const { planCameraChoreography } = await import('../_shared/cameraPlanner.ts');
          const result = await planCameraChoreography({
            ageGroup: String(ageBand ?? ''),
            topic: String(lessonPlan.lessons[0].title ?? ''),
            scriptPlan: lesson1Content as any,
            language: 'en',
          }, { model: typeof aiPlanner?.model === 'string' ? aiPlanner.model : undefined });

          // Merge into existing preset_snapshot (preserve other keys).
          const { data: lessonRow } = await supabaseClient
            .from('lessons')
            .select('preset_snapshot, generation_meta')
            .eq('id', lessonId)
            .single();
          const existingPreset = (lessonRow?.preset_snapshot as Record<string, unknown> | null) ?? {};
          const existingGen = (lessonRow?.generation_meta as Record<string, unknown> | null) ?? {};
          await supabaseClient
            .from('lessons')
            .update({
              preset_snapshot: { ...existingPreset, camera_choreography: result.config },
              generation_meta: { ...existingGen, camera_plan_meta: result.meta },
            })
            .eq('id', lessonId);
          console.log('[generate-lesson] CAMERA_PLAN_PERSISTED', {
            lessonId,
            source: result.meta.source,
            planner_model: result.meta.planner_model,
            duration_ms: result.meta.duration_ms,
            fallback_reason: result.meta.fallback_reason ?? null,
          });
        } else {
          console.log('[generate-lesson] CAMERA_PLAN_SKIPPED', {
            lessonId,
            cost_saving: costSaving,
            planner_enabled: plannerEnabled,
          });
        }
      } catch (cameraErr) {
        console.error('[generate-lesson] CAMERA_PLAN_ERROR (non-fatal)', {
          lessonId,
          error: cameraErr instanceof Error ? cameraErr.message : String(cameraErr),
        });
      }

      // Record script_ready_at for first lesson in series
      upsertPipelineMetrics(supabaseClient, lessonId, { script_ready_at: new Date().toISOString() }).catch(() => {});
      // Runs in the background; does not delay lesson delivery.
      // Future auto-blocking hook is inside runSafetyCheck().
      runSafetyCheck(supabaseClient, lessonId, lesson1Content).catch(() => {});

      await supabaseClient.from('lessons').update({ 
        status: 'ready',
        thumbnail_emoji: lesson1Content.thumbnail_emoji || '📚'
      }).eq('id', lessonId);

      // Track lesson ready event
      await trackMetricEvent(supabaseClient, user.id, 'lesson_ready', lessonId, {
        topic: lessonPlan.lessons[0].title,
        age_band: ageBand,
        series_id: series.id,
        sequence_number: 1
      });

      // Generate TTS for lesson 1
      console.log('[generate-lesson] Stage: tts_enqueue_started', { lessonId, lessonNumber: 1 });
      if (isAsyncTtsEnabled()) {
        // Async mode: enqueue job to worker queue
        const { data: lesson1Row } = await supabaseClient
          .from('lessons')
          .select('tts_input_version, series_id')
          .eq('id', lessonId)
          .single();
        
        console.log('[generate-lesson] Calling enqueueTtsJobAndUpdateStatus', {
          lessonId,
          expectedInputVersion: lesson1Row?.tts_input_version ?? 1,
        });
        
        const enqueued = await enqueueTtsJobAndUpdateStatus(supabaseClient, {
          lessonId,
          userId: user.id,
          seriesId: lesson1Row?.series_id ?? series.id,
          requestedBy: 'edge:generate-lesson',
          expectedInputVersion: lesson1Row?.tts_input_version ?? 1,
        });
        
        console.log('[generate-lesson] TTS enqueue result:', { lessonId, enqueued });
        if (!enqueued) {
          console.error('[generate-lesson] TTS enqueue failed for lesson 1', { lessonId });
        }
      } else {
        // Sync mode: generate TTS inline
        await supabaseClient.from('lessons').update({ tts_status: 'processing', tts_error: null }).eq('id', lessonId);
        const tts1Result = await generateTTSForLesson(supabaseClient, lessonId);
        if (!tts1Result.success) {
          console.error('[generate-lesson] TTS generation failed for lesson 1', { lessonId, error: tts1Result.errorMessage });
          // Do NOT throw - lesson generation is still successful
        }
      }

      await supabaseClient.from('lesson_metrics').insert({
        lesson_id: lessonId,
        views: 0,
        hook_passed: 0,
        completed: 0,
        quiz_correct_first_try: 0,
        one_more_clicks: 0,
      });

      // Generate content for lesson 2 if it exists
      if (lessonPlan.total_lessons > 1 && createdLessons[0]) {
        const lesson2Id = createdLessons[0].id;
        const lesson2Content = await generateLessonContent(
          lessonPlan.lessons[1].title,
          lessonPlan.lessons[1].objective,
          2,
          lessonPlan.total_lessons
        );

        await supabaseClient.from('script_plans').insert({
          lesson_id: lesson2Id,
          hook_text: lesson2Content.hook_text,
          model_lines: lesson2Content.model_lines,
          quiz_question: lesson2Content.quiz_question,
          quiz_choices: lesson2Content.quiz_choices,
          correct_index: lesson2Content.correct_index,
          reward_label: lesson2Content.reward_label,
          parent_recap_points: lesson2Content.parent_recap_points ?? null,
        });

        // ── Safety check for lesson 2 (non-blocking) ──
        runSafetyCheck(supabaseClient, lesson2Id, lesson2Content).catch(() => {});

        await supabaseClient.from('lessons').update({ 
          status: 'ready',
          thumbnail_emoji: lesson2Content.thumbnail_emoji || '📚'
        }).eq('id', lesson2Id);

        // Track lesson ready event
        await trackMetricEvent(supabaseClient, user.id, 'lesson_ready', lesson2Id, {
          topic: lessonPlan.lessons[1].title,
          age_band: ageBand,
          series_id: series.id,
          sequence_number: 2
        });

        // Generate TTS for lesson 2
        if (isAsyncTtsEnabled()) {
          // Async mode: enqueue job to worker queue
          const { data: lesson2Row } = await supabaseClient
            .from('lessons')
            .select('tts_input_version, series_id')
            .eq('id', lesson2Id)
            .single();
          
          const enqueued = await enqueueTtsJobAndUpdateStatus(supabaseClient, {
            lessonId: lesson2Id,
            userId: user.id,
            seriesId: lesson2Row?.series_id ?? series.id,
            requestedBy: 'edge:generate-lesson',
            expectedInputVersion: lesson2Row?.tts_input_version ?? 1,
          });
          
          if (!enqueued) {
            console.error('[generate-lesson] TTS enqueue failed for lesson 2', { lessonId: lesson2Id });
          }
        } else {
          // Sync mode: generate TTS inline
          await supabaseClient.from('lessons').update({ tts_status: 'processing', tts_error: null }).eq('id', lesson2Id);
          const tts2Result = await generateTTSForLesson(supabaseClient, lesson2Id);
          if (!tts2Result.success) {
            console.error('[generate-lesson] TTS generation failed for lesson 2', { lessonId: lesson2Id, error: tts2Result.errorMessage });
            // Do NOT throw - lesson generation is still successful
          }
        }

        await supabaseClient.from('lesson_metrics').insert({
          lesson_id: lesson2Id,
          views: 0,
          hook_passed: 0,
          completed: 0,
          quiz_correct_first_try: 0,
          one_more_clicks: 0,
        });
      }

      console.log('Multi-lesson series generated successfully');

      return new Response(
        JSON.stringify({ 
          success: true,
          lessonId,
          seriesId: series.id,
          isMultiLesson: true,
          totalLessons: lessonPlan.total_lessons,
          scriptPlan: lesson1Content
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // Single lesson flow (original logic)
      const singleLesson = lessonPlan.lessons[0];
      const scriptPlan = await generateLessonContent(
        singleLesson.title,
        singleLesson.objective,
        1,
        1
      );

      await supabaseClient.from('script_plans').insert({
        lesson_id: lessonId,
        hook_text: scriptPlan.hook_text,
        model_lines: scriptPlan.model_lines,
        quiz_question: scriptPlan.quiz_question,
        quiz_choices: scriptPlan.quiz_choices,
        correct_index: scriptPlan.correct_index,
        reward_label: scriptPlan.reward_label,
        parent_recap_points: scriptPlan.parent_recap_points ?? null,
      });

      // Record script_ready_at for single lesson
      upsertPipelineMetrics(supabaseClient, lessonId, { script_ready_at: new Date().toISOString() }).catch(() => {});
      runSafetyCheck(supabaseClient, lessonId, scriptPlan).catch(() => {});

      await supabaseClient.from('lessons').update({ 
        status: 'ready',
        thumbnail_emoji: scriptPlan.thumbnail_emoji || '📚',
        topic: singleLesson.title,
        lesson_outline: singleLesson,
        parent_topic_original: parentTopicEnglish, // English topic for music prompt (Lyria requires English)
        parent_topic_localized: translatedTopic, // Translated for AI prompts
      }).eq('id', lessonId);

      // KB citations enrichment (best-effort, never blocks video pipeline).
      try {
        const { resolveCitationsForLesson } = await import("../_shared/developmentalKbCitations.ts");
        const seed = [
          singleLesson.title || topic,
          ...(typeof interest === "string" ? interest.split(/[,;]/) : []),
        ];
        await resolveCitationsForLesson({
          supabase: supabaseClient,
          lessonId,
          skillTags: seed,
          languageCode,
          ageBand,
          logger: { info: (e, p) => console.log(`[generate-lesson] ${e}`, p), warn: (e, p) => console.warn(`[generate-lesson] ${e}`, p) },
          tagSource: "planner",
        });
      } catch (e) {
        console.warn("[generate-lesson] VIDEO_LESSON_KB_ENRICH_FAILED", e instanceof Error ? e.message : String(e));
      }

      // Track lesson ready event
      await trackMetricEvent(supabaseClient, user.id, 'lesson_ready', lessonId, {
        topic: singleLesson.title,
        age_band: ageBand,
        is_single_lesson: true
      });

      // Generate TTS for single lesson
      console.log('[generate-lesson] Stage: tts_enqueue_started (single lesson)', { lessonId });
      if (isAsyncTtsEnabled()) {
        // Async mode: enqueue job to worker queue
        const { data: lessonRow } = await supabaseClient
          .from('lessons')
          .select('tts_input_version, series_id')
          .eq('id', lessonId)
          .single();
        
        console.log('[generate-lesson] Calling enqueueTtsJobAndUpdateStatus (single)', {
          lessonId,
          expectedInputVersion: lessonRow?.tts_input_version ?? 1,
        });
        
        const enqueued = await enqueueTtsJobAndUpdateStatus(supabaseClient, {
          lessonId,
          userId: user.id,
          seriesId: lessonRow?.series_id ?? null,
          requestedBy: 'edge:generate-lesson',
          expectedInputVersion: lessonRow?.tts_input_version ?? 1,
        });
        
        console.log('[generate-lesson] TTS enqueue result (single):', { lessonId, enqueued });
        if (!enqueued) {
          console.error('[generate-lesson] TTS enqueue failed', { lessonId });
        }
      } else {
        // Sync mode: generate TTS inline
        await supabaseClient.from('lessons').update({ tts_status: 'processing', tts_error: null }).eq('id', lessonId);
        const ttsResult = await generateTTSForLesson(supabaseClient, lessonId);
        if (!ttsResult.success) {
          console.error('[generate-lesson] TTS generation failed', { lessonId, error: ttsResult.errorMessage });
          // Do NOT throw - lesson generation is still successful
        }
      }

      await supabaseClient.from('lesson_metrics').insert({
        lesson_id: lessonId,
        views: 0,
        hook_passed: 0,
        completed: 0,
        quiz_correct_first_try: 0,
        one_more_clicks: 0,
      });

      console.log('Single lesson generated successfully:', lessonId);

      return new Response(
        JSON.stringify({ 
          success: true,
          lessonId,
          isMultiLesson: false,
          scriptPlan 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[generate-lesson] Unhandled error:', {
      message: errorMessage,
      stack: errorStack?.substring(0, 500),
    });
    
    // Attempt to mark lesson as failed with error details
    try {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        // Try to extract lessonId from the request body if possible
        // This may not work if the error happened before parsing
        const rawBody = await req.clone().json().catch(() => ({}));
        const lessonId = rawBody?.lessonId;
        
        if (lessonId) {
          await supabaseClient.from('lessons').update({
            status: 'failed',
            tts_error: `UNHANDLED_ERROR: ${errorMessage.substring(0, 150)}`,
          }).eq('id', lessonId);
          console.log('[generate-lesson] Marked lesson as failed:', { lessonId });
        }
      }
    } catch (updateErr) {
      console.error('[generate-lesson] Failed to update lesson status:', updateErr);
    }
    
    return new Response(
      JSON.stringify({ 
        error: SAFE_ERRORS.SERVER_ERROR,
        stage: 'unhandled_exception',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
