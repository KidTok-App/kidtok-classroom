---
trigger: model_decision
description: When the user explicitly requests a standalone deliverable file (e.g. an update summary, status report, migration write-up, design note, or similar named output).
---

**Context Artifacts (`.agents/context/`)**: Save every requested standalone deliverable file (e.g. an update summary, status report, migration write-up, design note, or similar named output) into a `.agents/context/` folder at the repo. Do not mirror the agent's own working artifacts (implementation plans, task lists, walkthroughs, generated screenshots/recordings); those stay in default `brain/<UUID>/` store.
  - **Folder Layout**: Group each requested deliverable under a dated, human-readable subfolder so deliverables never collide:
    - `.agents/context/<YYYY-MM-DD>-<short-slug>/` — one folder per requested deliverable (e.g. `.agents/context/2026-05-29-auth-update-summary/`).
  - **Index File**: Maintain a flat `.agents/context/index.md` with one line per deliverable (date, slug, one-line description). Update it in the same change that adds the deliverable.
  - **Artifact Header**: Every mirrored markdown deliverable must start exactly with:

        # Context: <deliverable-name>
        Requested: <YYYY-MM-DD>
        Summary: <one-line description>

  - **Scope Guard**: `.agents/context/` at the repo root is the only location for these deliverables. Do not scatter copies elsewhere, and do not place anything here that the user did not request.
  - **Walkthrough Disclosure**: Surface the `.agents/context/` diff (new deliverable + `index.md` line) in the end-of-task walkthrough so it is reviewed alongside the code diff.