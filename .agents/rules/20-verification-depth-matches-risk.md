---
trigger: always_on
---

**Verification Depth Matches Risk**: Automated verification and risk-based validation rules.
  - For TypeScript, runtime logic, workers, schemas, migrations, queues/jobs, external interfaces, Docker/Cloud Run config, or critical settings: run typecheck and build in the affected package; run relevant unit and integration tests; report exact commands and outputs; add or update tests when behavior changes.
  - For small localized patches: inspect the directly affected files, apply the long-term viable, but surgical durable fix, run the narrowest relevant typecheck or test. Do not run full suites unless required by the scope of the update.
  - For docs-only, prompt-only, or rule-only edits: directly verify the touched files and any index that references them. Do not run build or tests.
  - Every phase boundary must pass: `npm run typecheck` and `npm run build` in both `worker-service/gateway` and `worker-service/worker`, and a wiring inventory plus no-orphans check.