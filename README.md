# KidTok Classroom — multi-agent educational cartoon generator (Gemini + Google Cloud Agent Builder/ADK + Arize Phoenix MCP)

A frontend-only React app for parents and teachers: enter a topic and an age,
and a multi-agent backend generates an animated educational cartoon —
illustrated scenes, narration, captions — for kids ages 5–8.

The cartoon backend is a separate service. This app talks to it through a
single swappable HTTP module (`src/lib/agentApi.ts`) configured by one
environment variable.

## Architecture

_TBD._ High-level pipeline (see `/about` in the running app):

```
Orchestrator → Script → Scene Planner → Scene Images → Narration → Assembly → Quality Reviewer
```

Powered by Gemini + Google Cloud Agent Builder (ADK) + Arize Phoenix MCP.

## Setup

```bash
cp .env.example .env
# edit .env and set VITE_AGENT_API_URL to your agent server, e.g.
# VITE_AGENT_API_URL=https://kidtok-agents.example.com

bun install
bun run dev
```

The backend must expose:

- `POST /episodes` — body `{ topic, ageBand }` → `{ id }`
- `GET  /episodes/:id` — returns the episode manifest (see types in
  `src/lib/agentApi.ts`)
- `GET  /episodes` — returns a list of episodes

Drop the KidTok logo at `public/kidtok-logo.png`.

## Runtime compliance

_TBD._ Notes on data handling, content review, age-appropriate generation,
and audit logging will live here.
