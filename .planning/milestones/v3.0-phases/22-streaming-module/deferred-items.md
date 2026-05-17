# Phase 22 Streaming Module — Deferred Items Catalog

**Phase closed:** 2026-05-08
**Inherited from:** Phase 15 (tsc errors), Phase 17 (test failures); carried forward unchanged.
**New deferrals from Phase 22:** 6 items targeting Phase 23 / 27 / 29.

---

## Inherited (pre-existing, NOT introduced by Phase 22)

### DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug (3 test files)

**Files failing:** `server/api/__tests__/routes.test.ts`, `server/artifacts/__tests__/artifact-routes.test.ts`, `server/auth/__tests__/auth-plugin.test.ts`

**Failure:** fastify-zod-openapi v5 emits `required` fields with array representation instead of object; validator-compiler rejects request bodies that previously validated. Root cause documented in Phase 17 VERIFICATION.md.

**Resolution planned:** Phase 29 Web Refactor + Phase 30 Test Migration Cleanup. Either upgrade fastify-zod-openapi to v6 (if/when released with bug fix) or swap for `@fastify/zod` / manual OpenAPI emit.

**Impact on Phase 22:** None. Phase 22 adds zero new HTTP routes; does not touch fastify-zod-openapi surface.

### DEFERRED-15-A: 6 Phase 15 Map-vs-RequestContext tsc errors

**Files:** assorted — `server/bus/helpers.ts`, `server/queue/plugin.ts`, related subscribers.

**Failure:** TypeScript strict-mode errors related to the ALS store shape migration from Map to plain-object (Phase 15/20 pattern). Functional runtime unaffected (`readAls` helper is dual-shape tolerant).

**Resolution planned:** Phase 26 (Auth Module) or Phase 30 (Test Migration Cleanup) — whichever lands the final ALS shape cleanup.

**Impact on Phase 22:** None. All Phase 22 specs use plain-object ALS shape; errors don't increase.

---

## New Phase 22 deferrals

### DEFERRED-22-A: DevicePreviewManager envelope wrapping

**Context:** Binary base64 frames on `/ws/devices/:id/preview` don't fit the Zod envelope shape. Phase 22 scope was job-channel envelope (TRACE-06 primary requirement); device preview kept its existing wire format unchanged.

**Resolution planned:** Phase 29 Web Refactor WEB-03 ("Schemas Zod de WS messages compartilhados server↔web"). When the web client migrates to shared Zod schemas, device preview may gain a structured metadata envelope alongside the binary frame OR the binary frame may stay as-is with out-of-band metadata.

**Impact if not addressed:** Web dev tools can't grep device-preview frames by correlationId (only job-channel frames are trackable). Acceptable trade-off for Phase 22 scope.

### DEFERRED-22-B: Shared wsEnvelopeSchema with web client

**Context:** Phase 22 defined `wsEnvelopeSchema` at `server/streaming/internal/ws-schemas.ts` + exported via barrel. Web client today parses frames with its own ad-hoc logic.

**Resolution planned:** Phase 29 WEB-03 — either relative imports from server tree OR npm workspace package. Web client calls `wsEnvelopeSchema.safeParse()` on every frame + drops malformed with a structured console warning.

**Impact if not addressed:** Web client may silently render malformed frames if server ships a buggy envelope builder. Phase 22 server-side safeParse drop path protects clients from ever SEEING malformed frames, so this is a belt-and-suspenders concern only.

### DEFERRED-22-C: WS replay semantics beyond 200-message ring buffer

**Context:** `JobBroadcaster` ring buffer holds max 200 messages/job. Reconnecting clients get the last 200. For long-running jobs (1 hour+ with 10-100 log lines/sec), early history is lost.

**Resolution planned:** OUT OF SCOPE — v2 requirement territory (OBS-01 / ER-01 in REQUIREMENTS.md). Structured logging + persisted `job.completed` event in events table covers operator debug use cases. Client-side replay is a nice-to-have, not a contract requirement.

**Impact if not addressed:** None. Users who need full history read the maestro.log artifact file.

### DEFERRED-22-D: SC2 stricter reading — replace this.jobBroadcaster!.cleanup with job.cleanup.requested event

**Context:** `server/jobs/job-service.ts` line ~479 retains a single `this.jobBroadcaster!.cleanup(job.id)` call via `setTimeout(..., 5000)` to free the ring buffer 5s after job finish. SC2 ("no producer calls broadcaster.emit directly") is about EMIT, not cleanup — so strictly admissible. MODULE.md §Non-Goals documents + `lifecycle-ownership.spec.ts` asserts count <= 1.

**Resolution planned:** Phase 23 Jobs Keystone will rewrite `executeJob` as a saga with an explicit `job.cleanup.requested` bus event. Streaming module subscriber listens → calls `broadcaster.cleanup(jobId)` internally. Zero `jobBroadcaster` references in job-service.ts.

**Impact if not addressed:** Cosmetic only. SC2 non-violation explicitly documented; grep-guard locks count at 1.

### DEFERRED-22-E: 6TH SAMPLE POINT persistEnvelope consolidation

**Context:** `server/streaming/internal/module.ts` lines ~80-110 contain a verbatim `persistEnvelope(envelope)` middleware copy — the 6th identical implementation across modules (Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming). Phase 15 ADR-001 foresaw this; consolidation waits for enough samples to inform the shared helper signature.

**Resolution planned:** Phase 27+ API Aggregator & Events API → extract to `server/bus/persist-envelope.ts`; all 6 module factories call the shared helper with their registry.

**Impact if not addressed:** 6 copies of ~30 lines each = ~180 LOC of duplication. Refactor risk localized — if persistence policy changes, all 6 need touching. Acceptable given the samples-before-abstraction discipline.

### DEFERRED-22-F: Cross-module type imports in server/jobs/job-service.ts

**Context:** `server/jobs/job-service.ts` retains `import type { JobBroadcaster } from '../streaming/internal/job-broadcaster.js'` + `import type { DevicePreviewManager } from '../streaming/internal/device-preview.js'`. Technically these are deep imports into streaming/internal/ from outside server/streaming/. Dep-cruiser tsPreCompilationDeps option excludes type-only imports by default so the rule does not fire.

**Resolution planned:** Phase 23 Jobs Keystone removes entirely when it rewrites executeJob to use the streaming module via `fastify.streamingModule.*` decorators only (no direct class references).

**Impact if not addressed:** Structural coupling between jobs and streaming/internal/. Refactor risk: a breaking change to JobBroadcaster constructor signature would cascade into job-service.ts. Low practical risk since JobBroadcaster signature is stable (post-Phase-22).

---

## Close-out metadata

- All deferred items were known BEFORE Phase 22 close — no surprises surfaced during Plan 22-05 or 22-06 execution.
- Nyquist delta check PASSED (Plan 22-05 Task 5.4); `.planning/nyquist-baseline.json` unchanged.
- Phase 22 specs: 10 total (5 renamed MOD-04 + events.spec + module.spec + subscriber.spec + correlation.spec + envelope.spec + lifecycle-ownership.spec + plugin-order.spec extension = across 2 directories).
- 7 plans, 7 waves (0-6).
- Close date: 2026-05-08.
