---
trigger: model_decision
description: If touching TS, Dockerfiles, Cloud Run service config, Supabase, queues, env or config resolution, or deployment behavior.
---

**Deployment Safety**: Deployment safety guidelines for Cloud Run and databases.
  - All production code and config changes must remain compatible with Cloud Run deploys and Docker builds for both `kidtok-gateway` and `kidtok-worker`. No TypeScript compile failures or dependency/type mismatches.
  - Do not deploy to live traffic until the P9 verification gate passes. Earlier deploys must use `--no-traffic --tag=preview`.
  - Do not run `supabase db push` or any destructive Supabase command without explicit operator approval.
  - If touching TS, Dockerfiles, Cloud Run service config, queues, env or config resolution, or deployment behavior, run build/typecheck and report results before committing.