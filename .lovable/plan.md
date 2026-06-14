## Goal
Block cartoon generation for signed-out visitors. Anyone (real Google account, `@kidtokai.com` / `@kidtok.co` mock accounts, or the demo mock users already in `AppHeader`) can generate once signed in — but a signed-out user must not be able to start an episode. This keeps generation tied to a user, which is the prerequisite for the child-profile + insights wiring we just shipped.

## Changes

### 1. `src/routes/index.tsx` — gate the submit flow
- Read `user` from `useAuth()` (already imported).
- In `submit()`, add an early guard right after the empty-topic check:
  - If `!user`: show a toast (`"Sign in to generate a cartoon."`), dispatch a `window` event `kidtok:open-signin`, and return without calling `createEpisode`.
- In the form render, when `!user`:
  - Keep the topic input visible (so the entered idea isn't lost) but disable it along with the sample-topic chips and the Generate button.
  - Replace the Generate button with a prominent **"Sign in to generate"** button that dispatches `kidtok:open-signin` on click.
  - Hide / collapse the child-profile carousel section and "Add child" form (these are per-account anyway) and show a short helper line: *"Sign in to save child profiles and personalize cartoons."*

### 2. `src/components/AppHeader.tsx` — open the sign-in dialog on request
- Add a `useEffect` that listens on `window` for `kidtok:open-signin` and sets `signInOpen` (the existing state controlling the auth Dialog) to `true`. Clean up on unmount.
- No visual change.

### 3. `src/routes/self-improvement.tsx` — consistency
- The page already requires data tied to a user; if `!user`, render a small "Sign in to see your child's progress" empty state with a button that dispatches `kidtok:open-signin`, instead of showing zeroed counters. (Light touch — no logic refactor.)

## Out of scope
- No backend changes (the agent service already requires a caller).
- No new auth providers — relies entirely on the existing Google + mock sign-in already wired in `AppHeader`.
- No route-level redirect / `_authenticated` layout move — keeping `/` crawlable for SEO; the gate is purely on the generation action.

## Verification
- Signed out on `/`: topic input accepts text, Generate button is replaced by **Sign in to generate**, clicking it opens the existing auth dialog. Submitting via Enter also opens the dialog and does not call the API (check Network).
- After mock sign-in: form unlocks, child profiles section appears, generation proceeds as before.
- `/self-improvement` signed out shows the sign-in CTA; signed in works unchanged.
