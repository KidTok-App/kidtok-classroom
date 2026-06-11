## Goal
Restrict the "🎬 Omni Movie" generation-mode button on the homepage so only the signed-in user with email `wiktor@kidtok.co` can use it. For everyone else (including signed-out judges), the button is visibly greyed out, non-interactive, and clearly labeled as a preview of upcoming (post-hackathon) work.

## Change (single file: `src/routes/index.tsx`)

1. Import `useAuth` from `@/lib/auth` and read `user`.
2. Compute `const canUseOmni = user?.email === "wiktor@kidtok.co";`.
3. Safety net: in the submit handler, if `generationMode === "video"` and `!canUseOmni`, force it back to `"slides"` before calling `createEpisode` (prevents any stale state from sneaking through).
4. Update the Omni Movie `<button>`:
   - `disabled={submitting || !canUseOmni}`
   - `aria-disabled` + `title="Coming soon — not part of the hackathon submission"` when locked
   - When `!canUseOmni`: apply greyed-out styling (`opacity-50 cursor-not-allowed grayscale`), skip the selected/hover styles, and swap the "Premium" badge for a "Coming soon" badge.
   - `onClick` becomes a no-op when locked (guard inside the handler) so it can't flip `generationMode` to `"video"`.

No changes to `CinematicVideoPlayer`, auth, backend, or the Classroom Slides path. The Slides flow remains the default and fully functional for judges.

## Why this approach
- Smallest possible diff: one file, presentation-layer only.
- Uses the existing `useAuth` user object already wired in `AppHeader`.
- Email check is a UI gate only (the user explicitly wants judges to *see* it exists); no security claim is made about the backend.
