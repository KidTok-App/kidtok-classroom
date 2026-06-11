
# KidTok Classroom — Build Plan

Frontend-only React/Vite/TS/Tailwind/shadcn app on TanStack Start. No Lovable Cloud, no Supabase, no AI SDKs. All backend calls go through one swappable HTTP module.

## Brand & Design System

- Update `src/styles.css` design tokens:
  - Primary: warm violet/purple (`oklch(~0.55 0.20 295)`) with a lighter `--primary-glow`.
  - Background: soft cream (`oklch(0.985 0.012 85)`).
  - Accent: KidTok yellow from logo (`#facc4a`-ish in oklch) for stars/confetti.
  - Foreground: deep navy from logo (`#1f2d4a`-ish).
  - Rounded: `--radius: 1rem` (rounded-2xl default).
- Typography: Nunito (display + body) via `<link>` in `__root.tsx`, registered as `--font-display` / `--font-body` in `@theme`.
- Subtle decorative SVG star/confetti components, used sparingly.
- Logo slot: `<img src="/kidtok-logo.png">` (file added later by user).

## Routes (file-based, TanStack)

- `src/routes/__root.tsx` — update head (title "KidTok Classroom", fonts, favicon link), keep Outlet. Add top nav with logo + links Home / Library / About. Includes env-missing banner if `VITE_AGENT_API_URL` is unset.
- `src/routes/index.tsx` — Home/Create.
- `src/routes/episode.$id.tsx` — Player.
- `src/routes/library.tsx` — Library grid.
- `src/routes/about.tsx` — Pipeline explainer.

Each route defines `head()` with its own title/description/og tags. Loaders use TanStack Query (`ensureQueryData` + `useSuspenseQuery`) for Library and Episode data; Home is a form (no loader).

## Backend Module

Single file `src/lib/agentApi.ts`:

```ts
const BASE = import.meta.env.VITE_AGENT_API_URL as string | undefined;
export const isApiConfigured = () => Boolean(BASE);
export type AgentStatus = "scripting"|"planning_scenes"|"generating_images"|"narrating"|"reviewing"|"ready"|"failed";
export type Scene = { index:number; imageUrl:string; audioUrl:string; caption:string; durationMs:number; animation:"kenburns-in"|"kenburns-out"|"pan-left"|"pan-right" };
export type Episode = { id:string; topic:string; ageBand:number; createdAt:string; status:AgentStatus; scenes?:Scene[]; error?:string };

export async function createEpisode(input:{topic:string; ageBand:number}): Promise<{id:string}> { ... POST `${BASE}/episodes` ... }
export async function getEpisode(id:string): Promise<Episode> { ... GET `${BASE}/episodes/${id}` ... }
export async function listEpisodes(): Promise<Episode[]> { ... GET `${BASE}/episodes` ... }
```

All fetches throw on non-2xx with friendly messages. No other file calls fetch directly.

## Pages

### 1. Home (`/`)
- Hero: KidTok logo, headline "What should we learn today?", subtext.
- Big rounded text input (topic), age band selector (5/6/7/8 as pill buttons), gradient "Create cartoon" button.
- Submit → `createEpisode` → `navigate({ to: "/episode/$id", params: { id } })`.
- Loading + error toast states.
- Decorative floating stars.

### 2. Player (`/episode/$id`)
- `useQuery` with 3s `refetchInterval` while status not in `ready|failed`.
- Status screen: animated bouncing star mascot + friendly per-status message ("Writing the script…", "Drawing scenes…", etc.) and a progress bar with the 6 phases.
- When `ready`: render `<CartoonPlayer scenes=...>`:
  - One `<img>` full-bleed with CSS classes `kenburns-in/out`, `pan-left/right` (defined as `@utility` keyframe animations in `styles.css`).
  - Single `<audio>` element; on `ended` → advance scene with 400ms crossfade (opacity transition layered images).
  - Caption overlay (large, high-contrast, rounded badge at bottom).
  - Controls: play/pause, replay-from-start, scene progress dots, mute toggle.
  - Autoplay first scene on ready (with a "Tap to start" fallback for mobile audio policy).
- Failed: friendly error + retry link to Home.

### 3. Library (`/library`)
- Grid (1 col mobile, 2 sm, 3 lg) of episode cards.
- Card: thumbnail (scene[0].imageUrl or placeholder), topic, "Age N" badge, date. Link to player.
- Empty state with CTA back to Home.

### 4. About (`/about`)
- Section explaining the pipeline.
- Horizontal diagram (HTML/CSS flex with arrow connectors) of 7 nodes: Orchestrator → Script → Scene Planner → Scene Images → Narration → Assembly → Quality Reviewer. Wraps to 2 rows on mobile.
- Footer line: "Powered by Gemini + Google Cloud Agent Builder (ADK) + Arize Phoenix".

## Shared Components

- `src/components/AppHeader.tsx` — logo + nav (Home, Library, About), mobile-friendly.
- `src/components/EnvBanner.tsx` — shown in __root when `!isApiConfigured()`.
- `src/components/CartoonPlayer.tsx` — the player engine.
- `src/components/StatusScreen.tsx` — friendly progress UI.
- `src/components/StarSparkle.tsx` — decorative SVG.

## Files to Add (non-code)

- `LICENSE` — full Apache-2.0 text.
- `README.md` — title "KidTok Classroom — multi-agent educational cartoon generator (Gemini + Google Cloud Agent Builder/ADK + Arize Phoenix MCP)" with placeholder sections: Architecture, Setup, Runtime compliance.
- `.env.example` with `VITE_AGENT_API_URL=`.

## Verification

- Build passes (`npm run build`).
- All routes render with no console errors.
- Env-missing banner appears when `VITE_AGENT_API_URL` unset; create/list calls show friendly error toasts instead of crashing.

## Technical Notes

- TanStack Query already wired in `src/router.tsx`; reuse `queryClient` from route context.
- Animations: define `@utility kenburns-in`, `kenburns-out`, `pan-left`, `pan-right` in `src/styles.css` with `@keyframes` (linear, ~scene duration controlled inline via `style={{ animationDuration: durationMs+"ms" }}`).
- Mobile-first: all layouts target small screens first; player is full-bleed with safe-area padding.
- No design directions tool needed — brand direction is fully specified by the existing KidTok logo and brief.
