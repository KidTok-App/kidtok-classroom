## Goal

Move the local-only pieces of KidTok Classroom into Lovable Cloud so each parent's child profiles, insights, and cartoon library follow them across devices/browsers, and make sure every Phoenix-driven self-improvement (reviewer score → prompt revision) is preserved per-child and shared across all signed-in users on the same instance.

## Two systems, two stores — both stay

- **Lovable Cloud (Supabase)** owns *user-owned* data: child profiles, per-child insights, episode index, optional saved-cartoon library.
- **Arize Phoenix** stays the source of truth for *prompt evolution*: every reviewer-proposed prompt revision is published to a versioned prompt in Phoenix, retrievable by name. Cloud does NOT duplicate this — it just records which Phoenix `promptVersionUsed` produced each episode so the UI can show "this cartoon was made with prompt v7".

This split matches what's already half-built: Phoenix handles prompt history (`agent-service/src/clients/phoenixMcp.ts`, `server.ts:248`), and the agent service already writes `review.promptVersionUsed` onto each episode.

## Phase 1 — Schema (one migration)

After Cloud is enabled, add four tables, all RLS-scoped to the signed-in parent.

```sql
-- 1. child_profiles: replaces kidtok_child_profiles localStorage key
create table public.child_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  age_band int not null,
  interests text not null default '',
  art_style text not null default 'crayon sketch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- 2. child_insights: replaces kidtok_user_steerage localStorage key
create table public.child_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  child_name text,                       -- null = parent's "default" bucket
  insights_text text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, child_name)
);

-- 3. user_preferences: small KV for things like last_selected_child
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_selected_child text,
  updated_at timestamptz not null default now()
);

-- 4. episodes_index: thin pointer from a user to their agent-service episodes.
--    The cartoon itself stays in agent-service (Mongo/whatever it uses today);
--    this table only records ownership + the Phoenix prompt version used,
--    so listEpisodes() can be a proper user-scoped query instead of "trust the
--    backend's auth header".
create table public.episodes_index (
  episode_id text primary key,           -- agent-service id
  user_id uuid not null references auth.users(id) on delete cascade,
  child_name text,
  topic text not null,
  age_band int not null,
  status text not null,
  prompt_version_used text,              -- Phoenix version, e.g. "v7"
  review_score int,                      -- 0-100
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.episodes_index (user_id, created_at desc);
create index on public.episodes_index (user_id, child_name);
```

GRANTs + RLS for each (canonical pattern — `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`, `GRANT ALL … TO service_role`, RLS policies scoped to `auth.uid() = user_id`). No `anon` grants — everything is parent-owned.

A small `update_updated_at` trigger on the three tables that have `updated_at`.

## Phase 2 — Server functions (TanStack `createServerFn`, NOT edge functions)

All in `src/lib/` so they're client-safe to import. Each uses `requireSupabaseAuth`.

- `src/lib/profiles.functions.ts`
  - `listChildProfiles()`
  - `upsertChildProfile({ name, ageBand, interests, artStyle })`
  - `deleteChildProfile({ name })`
  - `setLastSelectedChild({ name | null })`
  - `getLastSelectedChild()`
- `src/lib/insights.functions.ts`
  - `getInsights({ childName? })` — returns `{ insights_text }` for that child or the user's default bucket
  - `saveInsights({ childName?, insightsText })`
- `src/lib/episodes-index.functions.ts`
  - `listMyEpisodes()` — returns rows joined with a fresh agent-service fetch for status/review
  - `recordEpisode({ episodeId, childName, topic, ageBand })` — called immediately after `createEpisode` resolves so a row exists even before generation finishes
  - `updateEpisodeStatus({ episodeId, status, promptVersionUsed?, reviewScore? })` — called by the agent-service webhook (next phase)

## Phase 3 — Agent service → Cloud bridge for the self-improvement loop

So Phoenix improvements are remembered cross-user, the agent service has to tell Cloud which prompt version produced each finished cartoon. Today it writes that into its own episode doc only.

Add one public webhook in this repo:

- `src/routes/api/public/agent-webhook.ts` — HMAC-verified (`AGENT_WEBHOOK_SECRET`), accepts `{ episodeId, userId, status, promptVersionUsed, reviewScore }` and upserts into `episodes_index` via `supabaseAdmin`. Loaded inside the handler (`await import('@/integrations/supabase/client.server')`).

In `agent-service/src/agents/QualityReviewerAgent.ts`, after `store.update(...)` succeeds, POST to that webhook with the HMAC signature. Failure to POST does not fail the cartoon — it logs and retries with a small in-process backoff.

Net effect: every prompt revision the reviewer pushes to Phoenix is already global by virtue of Phoenix being a shared service; the webhook just makes it visible in the per-user UI ("your last cartoon for Mila used prompt v8, which the reviewer just improved to v9").

## Phase 4 — Wire the frontend off localStorage

Convert the three reads/writes in `src/routes/index.tsx` and `src/routes/self-improvement.tsx`:

- Child profiles list and "last selected" → `useQuery(profilesQueryOptions)` from `listChildProfiles` + `getLastSelectedChild`.
- Insights textarea → `useQuery` on `getInsights({ childName })`, `useMutation` on `saveInsights`.
- Episodes list on Self-Improvement → `listMyEpisodes` (which calls the agent service internally and merges with `episodes_index`).

Each `useEffect` that currently calls `localStorage.getItem/setItem` for these keys gets deleted. The existing polling + focus refresh stay, but now hit the server fn.

**One-time client-side migration** (runs once per device, behind a `kidtok_cloud_migrated:<userId>` flag): on first authenticated load, push any local `kidtok_child_profiles:<userId>`, `kidtok_user_steerage:*` keys into Cloud via the new mutations, then delete the local keys. This means existing users don't lose anything.

## Phase 5 — Phoenix configuration sanity check

The agent service already speaks Phoenix MCP. For the self-improvement loop to work in deployed Cloud:

- `agent-service` env in production needs `PHOENIX_HOST`, `PHOENIX_API_KEY` (already supported per `phoenixMcp.ts:148-149`).
- Prompt scoping (`agent-service/src/lib/promptScoping.ts`) is already child-aware — confirm the per-child name (`kidtok-scene-prompt--<slug>`) matches what `getPromptHistory` queries in the Self-Improvement UI. No code change expected, just verification.
- Add a small "Phoenix status" line to the Developer view of `self-improvement.tsx` that surfaces `getPromptHistory().length` so it's obvious the connection is live.

## Phase 6 — Verification

1. Sign in on browser A, add child "Mila", save insights, generate cartoon → see counter increment.
2. Sign in same account on browser B → child "Mila" and her insights appear with no localStorage involvement.
3. Generate cartoon for Mila on B → reviewer pushes a new Phoenix prompt version; both browsers see the new "Latest tune · v<n>" entry within 5s (polling already in place).
4. Sign in as a different parent → child list and insights are empty (RLS confirmed); but if they generate a cartoon, the Phoenix prompts already evolved by parent #1 (global versions) are what scripts/scene-planner use — i.e. the cross-user "memory" of self-improvement works.
5. Hit `/api/public/agent-webhook` without a signature → 401. With a bad signature → 401. With a valid signature → row upsert.

## Out of scope (explicit)

- Moving the cartoon media itself off the agent service. Not needed for the request; would be a separate, much larger migration.
- Replacing Phoenix with a Cloud-native prompt registry. Phoenix already gives us versioned prompts + scoring loop; building a parallel one in Cloud would just create drift.
- Per-user OAuth for Phoenix. The agent service uses a single workspace Phoenix instance — prompt evolution is intentionally shared across users so every parent benefits from every reviewer pass.

## Order of work once Cloud is enabled

1. Confirm Cloud enabled, then run the Phase-1 migration.
2. Ship server fns (Phase 2). No UI yet — just deploy and smoke-test.
3. Add the webhook + agent-service POST (Phase 3). Verify with a single test cartoon.
4. Switch the two routes off localStorage with the migration shim (Phase 4).
5. Verify against the Phase-6 checklist.

Tell me when Cloud is enabled and I'll run step 1.
