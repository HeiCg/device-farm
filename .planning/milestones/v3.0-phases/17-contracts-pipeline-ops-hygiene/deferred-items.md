# Deferred Items — Phase 17

Out-of-scope issues discovered during plan execution. Not fixed because they're
pre-existing and don't affect the plan's contract-pipeline work.

## Pre-existing Typecheck Errors (discovered during Plan 17-00)

`npx tsc --noEmit` reports 8 errors in 6 files at plan-17-00 start. All errors
pre-date Plan 17-00 — they originate from uncommitted working-tree
modifications and from the Phase 16 baseline (STATE.md documents 7 prior
top-level errors in `artifacts/`, `bus/`, `pipelines/`).

Files with pre-existing errors (count of errors in parens):
- `server/artifacts/recording-service.ts` (2) — uncommitted working-tree changes
- `server/bus/helpers.ts` (1) — Phase 16 baseline, RequestContext index-signature
- `server/bus/plugin.ts` (1) — Phase 16 baseline, Map shape vs RequestContext
- `server/events/__tests__/emit-helpers.spec.ts` (2) — Phase 16 baseline
- `server/hooks/__tests__/events.spec.ts` (1) — Phase 16 baseline
- `server/pipelines/schema.ts` (1) — Phase 16 baseline

Plan 17-00 changes (package.json scripts + 3 new deps + scaffolds + skeleton +
ADR-003) introduce **0** new typecheck errors. Verified by diffing errors
before/after working-tree changes.

These errors will be addressed either:
- By the owning feature plan (e.g. Phase 13 recording pipeline for
  `recording-service.ts`)
- By the `@fastify/request-context` shape-compatibility cleanup already tracked
  as Phase 15 deferred work (STATE.md)

No blocker for Phase 17 plans 17-01..17-07.
