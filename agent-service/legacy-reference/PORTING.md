# Legacy reference — porting map

The original KidTok production modules that lived in this folder were ported
into the shipped service at `agent-service/src/`. Files that referenced
non-Google vendors (forbidden by the hackathon runtime mandate) were deleted
from this folder after their reusable logic was extracted; the porting map
below records where everything went. Git history retains the originals.

| Legacy module | Ported to | What was reused |
|---|---|---|
| `generate-lesson.ts` (deleted) | `src/agents/ScriptAgent.ts` | System-prompt voice/audience/language rules, age-band handling, placeholder rules |
| `lessonAuthoringHelpers.ts` | `src/agents/ScriptAgent.ts` (`sanitizeScriptText`) | Placeholder/`your child` output guardrail |
| `safetyCheckAgent.ts` | `src/legacy/safetyCheck.ts` | Hard-fail category patterns, category-trumps gate, classifier prompt + schema, temperature-0 call shape |
| `assetPromptPlannerAgent.ts` | `src/agents/ScenePlannerAgent.ts` | Planner input shaping (script → visual planning context) |
| `scaffoldTemplating.ts` (deleted) | `src/legacy/scaffoldTemplating.ts` | `applyScaffold`, `assertNoUnresolvedTokens`, `UnresolvedScaffoldTokenError` (verbatim) |
| `dynamicPromptContext.ts` (deleted) | `src/legacy/ageSpecs.ts` | `AGE_VISUAL_SPECS` for ages 5/6/7/8, `resolveAge`, age labels |
| `aiPromptSanitizer.ts` | `src/legacy/promptSanitizer.ts` | LLM prompt-safety rewriter system prompt, response schema, call shape |
| `imageProviderClient.ts` (deleted) | `src/legacy/promptSanitizer.ts` + `src/clients/gemini.ts` | Deterministic people-noun scrub, progressive retry prompts, Gemini image `:generateContent` request/response shapes (`inlineData` parsing), backoff |
| `vertexRouting.ts` (deleted) | `src/legacy/vertexRouting.ts` | Endpoint policy table, `buildVertexUrl`, thinking-config payloads |
| `visualSafetyGate.ts` (deleted) | `src/clients/imageSafety.ts` | Gate semantics (fail-open on infra errors, throw on positive unsafe), MIME sniffing |
| `visualAssetSafetyClient.ts` (deleted) | `src/clients/imageSafety.ts` | Verdict shape, safe-fallback pattern; remote classifier replaced by a direct Gemini multimodal call |
| `compiler.ts` (deleted) | `src/legacy/narrationCompiler.ts` | Narration cleaning, parameter clamping, Chirp handling — Google branch ONLY (all other vendor paths deleted) |
| `providers.ts` (deleted) | `src/clients/google.ts` | Google TTS synthesis (now via the official client + ADC) — Google branch ONLY |
