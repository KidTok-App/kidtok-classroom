## What's actually broken

Two real wiring gaps make John look like "0 cartoons, no insights":

1. **The server silently drops `childProfile`.** The last security pass added `sanitizeChildProfile()` in `agent-service/src/server.ts` that requires `name`, `interests`, AND `artStyle` to all be non-empty strings — otherwise the entire `childProfile` is discarded before the episode is created. John's profile likely has an empty `interests` or `artStyle` field, so every cartoon you made was stored with no `childProfile` at all. The self-improvement page filters on `e.childProfile?.name === "John"`, which then returns zero matches → "Cartoons Made: 0", no reviewer scores, no recent cartoons.

2. **The self-improving loop never sees the child.** `QualityReviewerAgent.improveScenePrompt()` (and the published Phoenix template change-summary) only gets `templateUsed`, `userSteerage`, and weakness telemetry. `childProfile` is passed into the *review* prompt but never into the *template improvement* prompt, so the new prompt versions aren't actually personalized toward John's interests / art style. That matches your "no insight is being taken seriously" suspicion.

A few smaller things compound this: the parent page silently swallows `listEpisodes` failures (so a 401 looks identical to "0 cartoons"), and the John filter is case-sensitive exact match on `name`.

## Fix

### 1. Stop dropping `childProfile` on the server
`agent-service/src/server.ts` — `sanitizeChildProfile`:
- Require only `name` (1–60 chars) and a valid `ageBand` (5–8).
- Keep `interests` / `artStyle` optional with the same length caps; default `artStyle` to `"crayon sketch"` when missing so downstream agents still get a usable value.
- Still strip dangerous tokens and enforce length caps (no regression on the prompt-injection finding).

### 2. Feed the child into the self-improving prompt loop
`agent-service/src/agents/QualityReviewerAgent.ts` — `improveScenePrompt`:
- Accept `childProfile` from `run()`.
- Add a `CHILD PROFILE CONTEXT` block to `userPromptParts` with name, age, interests, art style.
- Extend the system instruction so the improved template must keep the child's art style anchor and bake the interests into the visual cues, not just the narration.
- Include child name + interests in the persisted `changeSummary` so the Self-Improvement page can show *"Leaned the art toward John's dinos & knights"* in the "What's evolving next" card.
- Pass `childProfile` from `ClassroomOrchestrator` into the reviewer call sites (slides + video paths) — they already pass it for the run, just need to thread it into the improvement step.

`agent-service/src/agents/ScenePlannerAgent.ts`:
- Already uses `childProfile?.artStyle`, but also surface `childProfile.interests` as a `scene_personalization_hint` token when rendering the template so the planner produces interest-aware visual descriptions, not just art-style aware ones.

### 3. Make the parent page honest about what it found
`src/routes/self-improvement.tsx`:
- Normalize the filter: `e.childProfile?.name?.trim().toLowerCase() === activeChild.name.trim().toLowerCase()`.
- Track `episodesError` from the `listEpisodes` catch and render a small "Couldn't load cartoons — please sign in again." banner above the metric cards instead of showing 0.
- When `episodes.length > 0` but `childEpisodes.length === 0`, show an explicit hint card: *"We found N cartoons on your account but none are tagged for John yet. Make sure John is selected on the home page before generating."*
- When `latestPromptChange` exists, prefer rendering the new child-aware `changeSummary` directly instead of always rephrasing through `humanizePromptChange`, falling back to the humanizer only when the summary doesn't already mention the child.

### 4. Make new cartoons always tagged
`src/routes/index.tsx` — `submit()`:
- If `selectedChildIdx === null` but exactly one profile exists, default to it (with a toast: *"Tagging this cartoon for {name}"*).
- If multiple profiles exist and none is selected, block submit with an inline error rather than silently creating an untagged episode.

## Verification

1. Create a fresh cartoon with John selected → confirm the POST body, the stored Firestore doc, and the `GET /episodes` response all contain `childProfile.name = "John"`.
2. Reload `/self-improvement` → "Cartoons Made" reflects John's real count, reviewer score appears once the first review lands, "Recent cartoons" lists them.
3. After the reviewer publishes a new template, confirm the `changeSummary` mentions John / his interests and that the parent card renders the personalized sentence.
4. Sign out, hit `/self-improvement` → error banner appears instead of "0".

## Out of scope

- No new tables, no backfill of historical episodes that were saved without `childProfile` — they will continue to show only under "all cartoons" until regenerated.
- No changes to how `userSteerage` is captured or stored.
- No UI redesign of the Self-Improvement page beyond the two small banners called out above.