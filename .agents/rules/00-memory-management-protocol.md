---
trigger: model_decision
description: Triggered on every session start (read index + GEMINI.md), on-demand when task keywords match memory entries, and on explicit user request for full audits or broad architectural changes.
---

**Memory Management Protocol (.memory/)**: Tiered memory management for `.memory/`. Read the index.
  - `.memory/` is the canonical, single source of durable project knowledge. Treat it as a knowledge base, **not** a context dump. Do NOT read everything at once, but follow the tier system below:
    - **Tier 1: On Every Session Start**: Read `.memory/index.md` only for entry one-liners and `GEMINI.md` for top-level conventions. Do not read individual entries yet.
    - **Tier 2: On Demand**: Read specific entries only when the task touches a topic listed in `.memory/index.md`. Match by keyword overlap, namespace relevance, or explicit user reference. Max 7 targeted entries, but if only 1 is sufficient then do that.
    - **Tier 3: Rare (Full Scans)**: Only scan the full vault on explicit user request (e.g., "audit memory") or during broad architectural changes affecting most files.
    - **Failure State**: If `.memory/index.md` is missing, stop and ask before fabricating one.
  - **Index File**: `.memory/index.md`: a flat one-liner index. This is the only file that grows with every entry.
  - **Durable Entries**: `.memory/<namespace>/<name>.md`: one durable entry per file. Namespaces must remain stable: `architecture/`, `features/`, `decisions/`, `operations/`, `migrations/`, `risks/`.
  - **Entry Header**: Every entry file must start exactly with:

        # Memory: <name>
        Updated: YYYY-MM-DD
        Namespace: <namespace>
        Keywords: <comma-separated retrieval hints>

  - Update or create entries only when a conversation produces a **durable fact** (e.g., architectural decisions, non-obvious constraints, finalized migration phases, confirmed risks, or stable contracts). Do not write for ephemeral chatter. Follow these steps each time when you have to update the memory:
    - **Step 1**: Update or create `.memory/<namespace>/<name>.md` and bump the `Updated:` date.
    - **Step 2**: Update or add the matching one-liner in `.memory/index.md`.
    - **Step 3**: Include the memory diff in the end-of-task walkthrough so it's reviewed alongside the code diff.
  - **Obsolete Files**: Delete the entry file and remove its index line in the same change. Never leave dangling index references.
  - **Duplicates**: Merge into the older filename, delete the newer file, and update the index.
  - **Policy Violations**: Skipping a durable update is a violation; you must surface it in the walkthrough.
  - **Secrets**: NEVER store secrets in `.memory/`. 
  - **Namespaces**: Never rename a namespace without sweeping the entire index in the same task.
  - **Core Bias**: Read often (the index), write sparingly (durable facts only).