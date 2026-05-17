# Phase 26 Auth Module — Deferred Items Catalog

**Phase closed:** 2026-05-15
**Inherited from:** Phase 15 (tsc errors), Phase 17 (test failures); carried forward unchanged.
**New deferrals from Phase 26:** 5 items targeting Phase 27+ / 28 / future.

---

## Inherited (pre-existing, NOT introduced by Phase 26)

### DEFERRED-15-A: Map-vs-RequestContext typecheck errors

**Files:** assorted — `server/bus/helpers.ts`, `server/queue/plugin.ts`,
related subscribers + `server/events/__tests__/emit-helpers.spec.ts` +
`server/hooks/__tests__/events.spec.ts`.

**Failure:** TypeScript strict-mode errors related to the ALS store shape
migration from Map to plain-object (Phase 15/20 pattern). Functional
runtime unaffected (`readAls` helper is dual-shape tolerant). 9 of the
24 current tsc errors trace to this class.

**Resolution planned:** Phase 27+ (when the final ALS shape cleanup lands).

**Impact on Phase 26:** None. All Phase 26 specs use plain-object ALS
shape; baseline tsc error count unchanged at 24 across Phases 15-26.

### DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug (non-auth scope)

**Files affected (still pending):** `server/api/__tests__/routes.test.ts`,
`server/artifacts/__tests__/artifact-routes.test.ts`.

**Failure:** fastify-zod-openapi v5.6.1 emits `required` fields with array
representation instead of object; validator-compiler rejects request
bodies that previously validated. Root cause documented in Phase 17
VERIFICATION.md.

**Resolution planned:** Phase 27+ API Aggregator (fastify-zod-openapi v6
upgrade or swap to `@fastify/zod`). v6 was NOT released through
2026-05-08 — the holistic library upgrade lands in Phase 27+ when the
API aggregator phase can swap libraries module-wide.

**Code marker:** Test files retain `.test.ts` suffix (not `.spec.ts`) as
a side-marker that they are pre-existing exclusions.

**Phase 26 carve-out:** `auth-plugin.spec.ts` was renamed `.test.ts →
.spec.ts` in Plan 26-05 Task 5.2; its failures (now triggered by missing
`event-bus` plugin dep in the test harness rather than the v5 `required`
bug) are tracked separately as DEFERRED-26-E below — the carry-forward
scope for the non-auth files (api/routes.test.ts + artifacts/artifact-routes.test.ts)
continues unchanged.

---

## New Phase 26 deferrals (5)

### DEFERRED-26-A: Bootstrap CLI for first admin claim

**Status:** Phase 26 ships:
- Server-side route `POST /api/keys/:id/claims/admin` (Plan 26-03) gated
  on `requireAdmin` preHandler (so subsequent admins are granted via
  HTTP, not SQL).
- Operator SQL bootstrap runbook at `docs/runbooks/admin-bootstrap.md`
  (Plan 26-03) — the one-shot procedure to flip the FIRST admin claim
  via direct DB UPDATE (chicken-and-egg: no existing admin can call the
  route).

**Owner:** Phase 28 CLI Refactor. Adds `device-farm admin-grant
<keyId>` Go subcommand that wraps POST `/api/keys/:id/claims/admin` for
operator ergonomics.

**Why not Phase 26?** Phase 26 is the server-side auth module migration.
The CLI surface is owned by Phase 28; cross-tier work bundled there
keeps the auth phase scope-bounded.

### DEFERRED-26-B: persistEnvelope 10TH SAMPLE POINT consolidation (supersedes DEFERRED-25-A)

**Status:** The 10-line `persistEnvelope` middleware in
`server/auth/internal/module.ts` is the 10th verbatim copy across:

- `server/hooks/internal/module.ts` (Phase 16)
- `server/lifecycle/internal/module.ts` (Phase 18)
- `server/reporting/internal/module.ts` (Phase 19)
- `server/pool/internal/module.ts` (Phase 20)
- `server/artifacts/internal/module.ts` (Phase 21)
- `server/streaming/internal/module.ts` (Phase 22)
- `server/jobs/internal/module.ts` (Phase 23)
- `server/maestro/internal/module.ts` (Phase 24)
- `server/pipelines/internal/module.ts` (Phase 25)
- `server/auth/internal/module.ts` (Phase 26 — THIS sample)

Pattern is locked-in (10 verbatim instances); consolidation requires
touching 10 modules atomically + extracting to
`server/bus/persist-envelope.ts`.

**Owner:** Phase 27+ API Aggregator. Replace 10 duplicates with imports.

**Why not Phase 26?** Phase 26 is module-migration scope; consolidation
is a tree-wide refactor that's safer post-keystone. Each module
extraction (16-26) had higher leverage than the consolidation itself.
Phase 25 documented this same trigger at the 9TH sample point under
DEFERRED-25-A (now superseded by THIS entry).

### DEFERRED-26-C: OIDC / OAuth integration

**Status:** Phase 26 keeps Bearer API keys as the sole auth surface.
The `actorSchema` regex already accepts `user:<id>` literals for forward
compatibility — when OIDC lands, `user.*` events become consumable
without a schema change.

**Owner:** v2 / future feature phase. Out of scope per CONTEXT and
explicitly listed in MODULE.md §Non-Goals.

**Why not Phase 26?** v3.0 milestone scope is the spec-driven refactor
of existing v2.0 surfaces, not new auth surfaces. OIDC requires session
storage decisions, JWT vs cookie, refresh-rotation policy — feature work
that belongs in a dedicated phase.

### DEFERRED-26-D: Audit log UI

**Status:** Phase 26 ships the audit substrate — `auth.key.created` +
`auth.key.revoked` events persist to the `events` table with TRACE-10
actor populated. Phase 27 (events trace API) exposes them programmatically
via `GET /api/events?correlationId=...&aggregateType=auth`.

**Owner:** Phase 29 Web Refactor. Ships the dashboard view that consumes
the Phase 27 endpoint and renders the audit trail (filter by actor,
date range, event type).

**Why not Phase 26?** UI consumption is the web refactor's domain. Phase
26's audit trail is queryable via direct SQL today (see MODULE.md
Runnable Example psql snippet) — operators have an out-of-band path.

### DEFERRED-26-E: fastify-zod-openapi v5 `required`-emission bug — auth-plugin.spec carve-out

**Status:** Plan 26-05 Task 5.2 renamed
`server/auth/__tests__/auth-plugin.test.ts → auth-plugin.spec.ts`. The
8 tests in this file fail post-rename, but the failure mode has shifted:

- **Pre-Plan-26-03:** failure root cause was the inherited Phase 17
  `fastify-zod-openapi` v5 `required`-emission bug (DEFERRED-17-A).
- **Post-Plan-26-03:** the plugin's dependencies array extended from
  `['config', 'db']` to `['config', 'db', 'event-bus']`. The test
  harness in `auth-plugin.spec.ts` does NOT register an `event-bus`
  plugin, so all 8 tests fail with
  `dependency 'event-bus' of plugin 'auth' is not registered`.

Same failure count (8 → 8); different mechanism.

**Outcome of 26-05 rename:** auth-plugin.spec.ts continues to fail with
8 tests blocked. Documented here as carry-forward; production code +
auth-service.spec.ts (25 unit tests green) are unaffected. The plan
literal said: "Body NOT edited in this plan; DEFERRED-26-E entry in
deferred-items.md retargets to Phase 27+ when API aggregator can swap
libraries holistically."

**Owner:** Phase 27+ API Aggregator. Two paths exist:
1. Upgrade fastify-zod-openapi to v6 (NOT released through 2026-05-08;
   awaiting upstream release).
2. Rewrite the harness to register a minimal `event-bus` fake plugin —
   trivial fix (~20 lines) but the test body still hits the v5
   `required` bug on POST /admin/keys schema validation, so harness fix
   alone is insufficient.

**Why not Phase 26?** Plan literal in 26-05 explicitly forbids touching
the test body or harness — `auth-plugin.spec.ts` rename is mechanical
(MOD-04 closure) only.

**Supersedes:** DEFERRED-17-A scope for `server/auth/__tests__/auth-plugin.spec.ts`
specifically. The broader DEFERRED-17-A carry-forward continues unchanged
for `server/api/__tests__/routes.test.ts` and
`server/artifacts/__tests__/artifact-routes.test.ts`.

---

Total: 5 Phase 26-specific deferrals + 2 carry-forwards = 7 tracked items at Phase 26 close.

Phase 27 API Aggregator + Events API unblocked. Phase 27+ owns
DEFERRED-26-B persistEnvelope consolidation (10TH SAMPLE POINT) +
DEFERRED-26-E auth-plugin.spec harness fix or library upgrade. Phase
28 CLI owns DEFERRED-26-A admin-grant subcommand. Phase 29 Web owns
DEFERRED-26-D audit log UI. v2 territory owns DEFERRED-26-C OIDC.
