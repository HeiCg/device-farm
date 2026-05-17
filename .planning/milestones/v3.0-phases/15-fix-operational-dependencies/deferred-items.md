# Phase 15 — Deferred Items

Out-of-scope issues discovered during phase 15 plan execution. Tracked here for follow-up rather than auto-fixed (per GSD scope boundary rule).

## 2026-04-17 — Plan 15-03

Pre-existing `tsc --noEmit` errors unrelated to the correlation/telemetry plugins:

- `server/artifacts/recording-service.ts:169,177` — RecordingResult missing `errors` property
- `server/pipelines/schema.ts:17` — function call argument-count mismatch

These are unchanged by plan 15-03. Filed for a future maintenance plan (candidate: Phase 15 final cleanup plan, or a dedicated tech-debt plan).

## 2026-04-17 — Plan 15-06

Pre-existing `tsc --noEmit` errors unrelated to the plugin-reorder work:

- `server/bus/helpers.ts:72` — `RequestContext -> Record<string,unknown>` cast (shape-agnostic ALS reader ergonomics; introduced in plan 15-04)
- `server/bus/plugin.ts:135` — `asyncLocalStorage.run(Map, ...)` type vs `RequestContext` overload (onPersisted child store shape; introduced in plan 15-04)
- `server/events/__tests__/emit-helpers.spec.ts:32,57` — same `asyncLocalStorage.run(Map, ...)` issue in test code (plan 15-04)

Same class of issue as the bus/helpers debt — `@fastify/request-context`'s `RequestContext` interface is tighter than the plain-Map store shape the codebase uses for cross-queue ALS restoration. A future cleanup plan should either (a) widen the `RequestContext` interface or (b) switch the Map-shape stores to plain objects. Scope-boundary rule: 15-06 did not introduce or touch these files.

Plan 15-06 files (`server/index.ts`, `server/__tests__/plugin-order.spec.ts`) typecheck cleanly.
