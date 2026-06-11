---
trigger: always_on
---

**Secrets and Access**: Security regulations for Secret Manager and sensitive resources.
  - All runtime secrets live in Google Secret Manager and are accessed via the `kidtok-runtime` Service Account. Never hard-code secret values. Never write them to logs, commits, or generated files.
  - Existing Secret Manager entries are operator-managed. Do not recreate or rename them.
  - For role-restricted local testing, authenticate only as the designated test account using credentials sourced from Secret Manager or environment, never hard-coded. Never authenticate as any admin account. This is a hard block.
  - Use elevated access only when required by the active task. Do not authenticate for docs, rules, or unrelated edits.