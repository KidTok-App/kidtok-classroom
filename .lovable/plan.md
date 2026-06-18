## What's actually going on

There are no broken edge functions here. This app doesn't use Supabase edge functions for the agent pipeline — cartoons go through the external `agent-service` (its `/api/agent/*` routes), and the "Save Active Steering" button doesn't talk to any backend at all. The two symptoms you saw have separate causes:

### 1. "100/10" badge (and a weird average)

The reviewer agent in `agent-service/src/agents/QualityReviewerAgent.ts` produces a score on a **0–100 scale** (`clamp(score, 0, 100)` at line 177; starts at 100 and subtracts penalties). The UI in `src/routes/self-improvement.tsx` hardcodes `/10`:

- line 500: `${avgScore}/10` (avg of 0–100 numbers, still labeled `/10`)
- line 616: `{ep.review.score}/10` → renders as `100/10`

Backend is the source of truth (notes already reference sub-scores like "8/10" for alignment, which is a different sub-metric). Fix is display-side: present review scores on a 0–100 scale.

### 2. "Cartoons made = 0" after selecting a child

The counter does NOT count insights — it counts episodes whose stored `childProfile.name` matches the selected child (self-improvement.tsx lines 244–248). Episodes only get `childProfile` attached if a child was selected at generation time (index.tsx line 258). So:

- Cartoons you generated before you had a child profile, or while "no child" was selected, were saved with `childProfile = undefined` and never match a per-child filter. They only appear under "All cartoons".
- Saving steering (the "Insights" textarea) has zero effect on this counter — steering is stored in `localStorage` under a single global key `kidtok_user_steerage`, not per-child, and is not a counted entity. The "Saved!" toast is truthful about the localStorage write but misleading about what it does.

This is a UX/data-attribution bug, not a database read bug. There is no row in any DB for "insights per child" today.

## Fix

### A. Reviewer score display (small, surgical — `src/routes/self-improvement.tsx`)

1. Line 500 "Reviewer score" card: render `${avgScore}/100`. Recompute `avgScore` rounding against the 0–100 scale (already correct math; just relabel).
2. Line 616 recent-cartoons badge: render `{ep.review.score}/100`.
3. Update the helper copy on the score card ("Our reviewer agent rates each finished cartoon…") to mention "out of 100" so parents read it correctly.

No backend change. Sub-metric mentions like "Alignment scored 8/10" inside reviewer notes stay as-is — those are genuinely 0–10 sub-scores.

### B. Per-child insights (so "saved" actually means something)

Right now steering is a single global string. Make it per-child so it shows up where you expect:

1. **Storage key becomes per-child** in self-improvement.tsx `saveSteerage` and the load `useEffect`:
   - `kidtok_user_steerage:<userId>:<childName>` when a child is active.
   - Fall back to a `…:default` key when "All cartoons" is selected.
   - On `activeChild` change, reload the textarea from the matching key.
2. **`index.tsx` reads the same per-child key** when building `storedSteerage`, using the currently selected child profile. Falls back to the default key if none.
3. **Toast copy** updates to "Saved insights for {child.name}. Cartoons made for {child.name} will use them." so the message reflects the actual scope.
4. **(Optional, behind the same edit)** Surface a small "Insights on file for {child.name}" line on the active-child banner (self-improvement.tsx around line 444) so the parent can see at a glance that something is persisted, separate from the cartoon counter.

This stays localStorage-only — no DB schema change, no edge function. The agent backend already accepts `userSteerage` per-episode and now feeds it into `ScriptAgent` / `ScenePlannerAgent`, so per-child steering will visibly steer the next cartoon for that child.

### C. Clarify the counter (tiny copy change, no logic change)

In the "Cartoons made" card (around line 487), when `totalForChild === 0` and `activeChild` is set, say:

> "No cartoons tagged for {child.name} yet. Make a new one with {child.name} selected and it'll show up here." 

So it's obvious the counter tracks generations, not saved insights, and that older untagged cartoons live under "All cartoons".

## Out of scope (intentionally)

- No migration of historical untagged episodes onto a child — that would require backend changes and risks mis-tagging. If you want that later, the right move is a one-off `PATCH /api/agent/episodes/:id` (already exists via `updateEpisodeChild`) triggered from the library page.
- No move of insights into the database. If you want insights to be cross-device per child, that's a separate, larger change (new table + GRANTs + RLS + a server fn). Say the word and I'll plan it.

## Verification

- Generate a cartoon with a child selected → counter for that child increments within ~5s (existing polling).
- Open a finished cartoon → score badge reads `<n>/100`, average card matches.
- Save insights with child A selected, switch to child B → textarea is empty (or shows B's own text), confirming per-child scoping. Switching back to A restores A's text.
- Generate a new cartoon for child A → its narration/visuals reflect A's saved insights (already wired through ScriptAgent/ScenePlannerAgent from the previous fix).
