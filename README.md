# KidTok Classroom  📺 ✨

**Type a topic, pick an age, get a narrated educational cartoon — generated end-to-end by a six-agent AI pipeline.**

KidTok Classroom turns a parent's request like *"why do volcanoes erupt"* into a five-scene illustrated, narrated mini-episode for kids ages 5–8. A React frontend polls a REST API while a central **ClassroomOrchestrator** drives six specialized sub-agents through scripting, scene planning, image generation, narration, assembly, and an automated quality review that closes the loop by improving its own prompts.

**Runtime mandate:** the shipped backend uses **Google services** (Gemini via Vertex AI, Cloud Text-to-Speech, Firestore, Cloud Storage) **plus Arize Phoenix** (OpenInference tracing + MCP server).

---

## Repo layout

| Path | What it is |
|---|---|
| `/` (root) | React + Vite frontend (built with Lovable). Polls the agent service via `src/lib/agentApi.ts`. |
| `agent-service/` | The multi-agent backend (Node 22 + TypeScript, strict). This is where everything below lives. |

## Quickstart

```bash
cd agent-service
npm ci
npm run build        # tsc --strict, zero errors
npm run smoke        # full offline pipeline test (fake providers, no credentials needed)
```

Run against real services (Google Cloud + Phoenix):

```bash
cp .env.example .env             # fill in every value
gcloud auth application-default login
npm start                        # or: npm run dev

# in another shell — runs 2 episodes and prints the manifest + prompt-loop evidence
npm run e2e
```

Docker:

```bash
docker build -t kidtok-agent-service ./agent-service
docker run -p 8080:8080 --env-file agent-service/.env kidtok-agent-service
```

Point the frontend at the service: set `VITE_AGENT_API_URL=http://localhost:8080` and run the Vite dev server from the repo root.

## API (consumed by `src/lib/agentApi.ts`)

| Route | Behavior |
|---|---|
| `POST /episodes` `{ topic, ageBand }` | `201 { id, episodeId }` — pipeline runs async in-process; Firestore doc tracks status |
| `GET /episodes/:id` | `{ id, topic, ageBand, createdAt, status, title?, scenes?, review?, error? }` |
| `GET /episodes` | All episodes, newest first |
| `GET /healthz` | Liveness + mode info |

Statuses: `scripting → planning_scenes → generating_images → narrating → reviewing → ready | failed`.
Each scene: `{ index, imageUrl, audioUrl, caption, durationMs, animation }` with animations cycling `kenburns-in / pan-left / kenburns-out / pan-right`.

## Architecture

```mermaid
flowchart TB
    FE["React frontend<br/>(src/lib/agentApi.ts polling)"] -->|"POST /episodes · GET /episodes/:id"| API["Express API<br/>(Cloud Run-ready container)"]
    API --> ORCH["ClassroomOrchestrator<br/>(gemini-3-flash via Vertex AI)"]

    subgraph PIPELINE["Sequential sub-agents (never call each other)"]
        direction TB
        A1["1 · ScriptAgent<br/>age-banded 5-scene script + safety check"]
        A2["2 · ScenePlannerAgent<br/>visual descriptions via Phoenix prompt template"]
        A3["3 · SceneImageAgent<br/>sanitize → gemini-2.5-flash-image → safety gate"]
        A4["4 · NarrationAgent<br/>Cloud TTS child voice + durationMs"]
        A5["5 · AssemblyAgent<br/>manifest + animation cycle"]
        A6["6 · QualityReviewerAgent<br/>span analysis → review → prompt improvement"]
        A1 --> A2 --> A3 --> A4 --> A5 --> A6
    end

    ORCH --> PIPELINE

    subgraph GOOGLE["Google Cloud"]
        VERTEX["Vertex AI<br/>Gemini text + image"]
        TTS["Cloud Text-to-Speech"]
        FS[("Firestore<br/>episode docs")]
        GCS[("Cloud Storage<br/>PNG + MP3, public URLs")]
    end

    A1 -.-> VERTEX
    A2 -.-> VERTEX
    A3 -.-> VERTEX
    A4 -.-> TTS
    ORCH --> FS
    A3 --> GCS
    A4 --> GCS

    subgraph PHOENIX["Arize Phoenix (partner)"]
        TRACES["OpenInference traces<br/>project kidtok-classroom"]
        PROMPTS["Prompt management<br/>kidtok-scene-prompt"]
    end

    ORCH ==>|"OTLP /v1/traces<br/>root span carries episodeId"| TRACES
    MCP["Phoenix MCP server<br/>@arizeai/phoenix-mcp (stdio side-channel)"]
    A2 <-->|"get-latest-prompt / upsert-prompt (seed)"| MCP
    A6 <-->|"get-spans + upsert-prompt"| MCP
    MCP <--> TRACES
    MCP <--> PROMPTS
```

### The self-improvement loop (partner integration, real at runtime)

1. Every pipeline stage runs inside an **OpenInference** span exported to **Phoenix** (`PHOENIX_HOST/v1/traces`, project `kidtok-classroom`); the root span carries `episodeId`.
2. Before planning scenes, **ScenePlannerAgent** fetches the latest `kidtok-scene-prompt` template through the **Phoenix MCP server** (`get-latest-prompt`), seeding it from the legacy template (`upsert-prompt`) on first run.
3. After assembly, **QualityReviewerAgent** retrieves *this episode's* spans via MCP (`get-spans`), evaluates stage latencies, image retries, and caption/narration alignment, writes `review: { score, notes }` to Firestore, and — when it detects a scene-prompt weakness — publishes an improved template version via `upsert-prompt`.
4. The **next episode's** ScenePlannerAgent picks up the improved version (logged with version ids; compare `review.promptVersionUsed` across episodes).

---

## 🌟 Premium V2 Features (Hackathon Upgrades)

To deliver true product-market polish and maximize our scoring potential, we have implemented three high-impact premium features directly into the core user experience:

### 1. 🧒 Child Profiles & Deep Personalization (Closed-Loop)
Instead of generic age bands, parents can now create **Child Profiles** (e.g., *Zosia, age 5, interests: dinosaurs, volcanoes, and cookies, visual art style: crayon sketch*). This feeds directly into our multi-agent pipeline:
* **ScriptAgent**: Reads the `childProfile` payload. It addresses the child directly by name (at least twice—as an onboarding hook and a joyful recap) and dynamically weaves their interests into the educational story (e.g., explaining volcanoes using dinosaur comparisons or cookie baking).
* **ScenePlannerAgent**: Captures the favorite art style of the child (crayon sketch, claymation, retro cartoon, or watercolor) and overrides the `GLOBAL_CARTOON_STYLE` token dynamically so all downstream illustrations match their aesthetic preference.
* **QualityReviewerAgent**: Evaluates how well the generated content aligned with the child's profile and scores the **Personalization Fit**, exporting these custom telemetry metrics back to Arize Phoenix.

### 2. 📊 AI Self-Improvement Portal (`/self-improvement`)
We moved our developer dashboard away from the home screen into a dedicated portal accessible from the profile avatar menu. It splits into two tailored views:
* **👪 Parent Mode (Aesthetic & Emotional)**: Displays high-level clarity, safety, and pacing indicators (e.g., *98.4% Success Rate*) alongside an **Interactive AI Self-Correction Log** demonstrating how agent self-critique translates to cartoon refinements.
* **💻 Developer Mode (Advanced Diagnostic)**: Displays raw average latencies, prompt retries, active safety filter rates, and hosts the **Active Prompt-Steering Panel** (which saves developer instructions to `localStorage` to guide future reviews). It also features a **Prompt Version History Timeline** with a native **Longest Common Subsequence (LCS)** word-by-word visual difference algorithm that beautifully highlights prompt additions in green and removals in red directly in the browser!

### 3. 🎵 Synced Background Audio Bed (Lyria 3 Inspired)
To elevate the audio polish to true broadcast-cartoon quality, we integrated a gentle, loopable playtime background melody. This audio bed is:
* Hard-locked to an ultra-soft bed volume level (`0.08`) so it sits comfortably beneath the narrator's voice-over.
* Synchronized perfectly with the primary voice-over's Play, Pause, Mute, and Scene Transition controls in the custom video player.

### Orchestration engine: ADK with a documented fallback

The primary engine uses the official **Google Agent Development Kit for TypeScript** (`@google/adk` 1.2.0): each LLM-backed role is a named ADK `LlmAgent` definition (`script_agent`, `scene_planner_agent`, `safety_check_agent`, `prompt_sanitizer_agent`, `review_alignment_agent`, `review_prompt_improvement_agent`) executed through the ADK `InMemoryRunner` with Gemini served by Vertex (`GOOGLE_GENAI_USE_VERTEXAI=true`). The ClassroomOrchestrator remains the single coordinator — sub-agents never call each other.

Set `ORCHESTRATOR_ENGINE=rest` to switch to the **fallback** path (same architecture, plain TypeScript pipeline calling Vertex `:generateContent` REST directly — ported from the legacy client). Both engines share the same provider interfaces, agents, tracing, and MCP integration. Deterministic stages (image generation, TTS, storage, assembly) call Google APIs directly in both engines; Phoenix MCP is reached through a minimal MCP stdio client (`@modelcontextprotocol/sdk`) spawning the pinned `@arizeai/phoenix-mcp` package from `node_modules`.

## Runtime mandate verification

| Mandate | Evidence (file : line) |
|---|---|
| (a) **Gemini invoked via Vertex AI / Agent Platform** | `agent-service/src/legacy/vertexRouting.ts:59` (`buildVertexUrl` → `*aiplatform.googleapis.com`); `agent-service/src/clients/gemini.ts:116` (text `:generateContent`) and `:172` (image `:generateContent`, `inlineData` parse); `agent-service/src/clients/adkLlm.ts:57` (ADK `LlmAgent` on Gemini) + `agent-service/src/config.ts:82` (`GOOGLE_GENAI_USE_VERTEXAI=true` pinned) |
| (b) **ADK agent definitions** (primary) / documented fallback | `agent-service/src/clients/adkLlm.ts:18` (`import { LlmAgent, InMemoryRunner } from "@google/adk"`), `:57` (`new LlmAgent({...})` named definitions), `:74` (`new InMemoryRunner`), `:91` (`runner.runAsync`). Fallback: `agent-service/src/clients/gemini.ts:106` (`VertexRestTextLlm`), selected at `agent-service/src/index.ts` via `ORCHESTRATOR_ENGINE` |
| (c) **Phoenix MCP tools invoked at runtime** | `agent-service/src/clients/phoenixMcp.ts:109-127` (spawn `@arizeai/phoenix-mcp` + MCP `connect`), `:175` (`get-latest-prompt`), `:198` (`upsert-prompt`, `model_provider: GOOGLE`), `:220` (`get-spans`). Call sites: `agent-service/src/agents/ScenePlannerAgent.ts:84-86` (fetch/seed) and `agent-service/src/agents/QualityReviewerAgent.ts:205` (spans) + `:285` (publish improved prompt) |
| OpenInference tracing → Phoenix | `agent-service/src/tracing.ts:56-57` (OTLP exporter → `PHOENIX_HOST/v1/traces`), `:46` (project resource attribute), root span `episodeId`: `agent-service/src/orchestrator/ClassroomOrchestrator.ts` (`runEpisode`) |
| Google Cloud TTS / Firestore / Cloud Storage only | `agent-service/src/clients/google.ts:12` (Firestore), `:44` (Cloud Storage), `:67-74` (Cloud TTS `synthesizeSpeech`) |

### Hosted Live Environment

* **Live Cloud Run API Endpoint**: `https://kidtok-classroom-agent-298496420007.europe-west1.run.app`
* **Live Assets Bucket (GCS)**: `gs://kidtok-classroom-assets-f6622a7c` (Objects served publicly via standard HTTPS URLs)
* **Active LLM Brain**: `gemini-2.5-flash` via Vertex AI (configured dynamically)
* **Active Image Maker**: `gemini-2.5-flash-image` via Vertex AI (configured dynamically)
* **Arize Phoenix Project**: `kidtok-classroom`

#### Sample API Verification Curl

You can verify the live service's operational status and Firestore backend connection by fetching the list of successfully generated classroom episodes:

```bash
curl -X GET "https://kidtok-classroom-agent-298496420007.europe-west1.run.app/episodes"
```

Expected response format (showing the list of active episodes and metadata stored in Firestore Native):
```json
{
  "value": [
    {
      "id": "bfb471f3-396e-411d-9435-2bec467b2ad9",
      "topic": "why do volcanoes erupt",
      "status": "ready"
    }
  ],
  "Count": 2
}
```

**Dependency audit** (`npm ls --depth=0` in `agent-service/`, all Google / Arize / OpenTelemetry / protocol / utility packages — no other AI, TTS, DB, queue, or cloud vendor):

```
kidtok-agent-service@1.0.0
├── @arizeai/openinference-semantic-conventions@2.5.0
├── @arizeai/phoenix-mcp@2.3.7
├── @google-cloud/firestore@7.11.6
├── @google-cloud/storage@7.21.0
├── @google-cloud/text-to-speech@6.4.1
├── @google/adk@1.2.0
├── @modelcontextprotocol/sdk@1.29.0
├── @opentelemetry/api@1.9.1
├── @opentelemetry/exporter-trace-otlp-proto@0.57.2
├── @opentelemetry/resources@1.30.1
├── @opentelemetry/sdk-trace-base@1.30.1
├── @opentelemetry/sdk-trace-node@1.30.1
├── @opentelemetry/semantic-conventions@1.41.1
├── @types/cors@2.8.19
├── @types/express@4.17.25
├── @types/node@22.19.21
├── cors@2.8.6
├── express@4.22.2
├── google-auth-library@9.15.1
├── music-metadata@11.13.0
├── tsx@4.22.4
├── typescript@5.9.3
└── zod@4.4.3
```

> **Transitive-dependency note:** the partner package `@arizeai/phoenix-mcp` → `@arizeai/phoenix-client` declares cross-provider SDKs (`@anthropic-ai/sdk`, `openai`) for Phoenix's own prompt-to-SDK translation helpers, so those names appear in `package-lock.json` as transitive metadata of the **partner's** tool. The shipped KidTok code contains **zero imports or calls** to them (verified by grep across `agent-service/` source), no credentials for those providers exist in the environment, and no code path invokes them. Every LLM / image / TTS call in this service goes to Google endpoints exclusively.

## Verification status

- ✅ `npm run build` — zero TypeScript errors (strict mode, `noUncheckedIndexedAccess`).
- ✅ `npm run smoke` — full offline pipeline run (fake providers): two episodes through the live HTTP API; verified the status flow, exactly 5 scenes with image+audio+duration, animation cycling, reviewer span retrieval (15 spans), weakness detection, prompt improvement, and **episode 2 picking up the new prompt version** (`fake-v1 → fake-v2`).
- ✅ Phoenix MCP server boot — the pinned `@arizeai/phoenix-mcp@2.3.7` was spawned from `node_modules` over stdio and its tool list verified: `get-latest-prompt`, `upsert-prompt`, `get-spans` all present (this server version exposes trace data via `get-spans`; it has no separate `list-traces` tool).
- ✅ Forbidden-vendor sweep — `grep -ri` across `agent-service/` shipped code (`src/`, `Dockerfile`, `.env.example`, configs, docs) finds zero references to any non-Google AI/TTS/DB/queue/cloud vendor; legacy-reference files that mentioned them were stripped to compliance stubs after porting (see `agent-service/legacy-reference/PORTING.md`). The only remaining occurrences anywhere are lockfile metadata of the partner's own MCP package (see the transitive-dependency note above).
- ✅ Real-credential E2E (`npm run e2e`) — **Successfully completed on Cloud Run!** Pointed at `https://kidtok-classroom-agent-zlar3vdo5a-ew.a.run.app`. Ran Episode 1 ("why do volcanoes erupt") and Episode 2 ("how do rainbows form"), validated all 5 scenes for both, verified public GCS image/audio paths and metadata, and successfully verified the Phoenix prompt-management version pickup loop (`UHJvbXB0VmVyc2lvbjox` → `UHJvbXB0VmVyc2lvbjoz`).

## Deployment notes (for the deployment pipeline)

- The container is Cloud Run-shaped: stateless, `$PORT`, ADC-based auth. Grant the runtime service account: `roles/aiplatform.user`, `roles/datastore.user`, `roles/storage.objectAdmin` (on the bucket), and Cloud TTS access.
- Public asset serving expects the bucket to allow public reads (uniform bucket-level access + `allUsers: roles/storage.objectViewer`, or non-uniform ACLs — the uploader handles both).
- Firestore must exist in Native mode; the `episodes` collection needs a single-field index on `createdAt` (descending) — auto-created by default settings.
- `gemini-3-flash` and `gemini-2.5-flash-image` must be enabled for the project; model ids are env-overridable (`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`).
- Phoenix: any reachable instance works (`PHOENIX_HOST` + `PHOENIX_API_KEY`); traces land in project `kidtok-classroom`.
- Frontend: set `AGENT_API_URL` to the deployed service URL. CORS is open by design (demo).
