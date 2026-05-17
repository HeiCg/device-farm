---
phase: 15-fix-operational-dependencies
plan: 01

subsystem: database

tags: [drizzle, drizzle-zod, zod, postgres, jsonb, events, event-sourcing]

# Dependency graph
requires:
  - phase: 15-fix-operational-dependencies
    provides: "Plan 15-00 installed drizzle-zod ^0.8.3 and pinned Node 22.12 / Zod ^4.3.6"
provides:
  - "events append-only table (10 cols + 4 non-PK indexes) in Drizzle schema"
  - "Committed initial drizzle migration: server/db/migrations/0000_add_events_table.sql"
  - "Shared envelopeSchema (z.looseObject + v: z.literal(1)) at server/events/envelope.ts"
  - "Row decoder reference pattern: decodeEventRow using drizzle-zod createSelectSchema"
  - "SPEC-04 spike green: jsonb semantic round-trip on jobs.metadata proven via deep-equal"
affects: [15-04 event-bus, 15-06 persist-middleware, 16-pilot hooks-module, 17-contracts, all future row decoders]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Row decoders use drizzle-zod createSelectSchema then project to shared envelope (snake_case DB → camelCase Drizzle → envelope field rename)"
    - "Zod 4 .looseObject (alias for .passthrough) for additive-only envelope forward-compat"
    - "Integration specs gate on TEST_DATABASE_URL via describe.skipIf"
    - "JSONB assertions use toEqual (deep-equal), never JSON.stringify (Postgres jsonb does not preserve key order)"
    - "drizzle-kit generate (not push) for committed events migration — audit trail for TRACE-07 event log table"

key-files:
  created:
    - "server/db/migrations/0000_add_events_table.sql"
    - "server/db/migrations/meta/0000_snapshot.json"
    - "server/db/migrations/meta/_journal.json"
    - "server/db/__tests__/events-schema.spec.ts"
    - "server/db/__tests__/events-decoder.spec.ts"
    - "server/db/__tests__/jsonb-roundtrip.spec.ts"
    - "server/events/envelope.ts"
    - "server/events/decoder.ts"
  modified:
    - "server/db/schema.ts (appended events pgTable + 4 indexes)"
    - "drizzle.config.ts (out dir: ./drizzle → ./server/db/migrations)"

key-decisions:
  - "Open Question #1 resolved: drizzle-zod ^0.8.3 + Zod ^4.3.6 + drizzle-orm ^0.45.1 compat confirmed; createSelectSchema(events) works without fallback"
  - "Migration output directory moved to server/db/migrations/ (from default ./drizzle) to colocate with schema.ts and match plan specification"
  - "payload column intentionally has no JSONB default (Pitfall #5 avoids drizzle-kit diff-churn); notNull enforces every row supplies payload"
  - "Plan 01 uses plain z.string().uuid() in the envelope (not branded IDs); branded tie-in lives in plan 04 bus wiring per plan 15-01 interfaces note"
  - "Initial migration snapshot (0000_) includes ALL 22 tables, not only events — drizzle-kit generate emits full-schema initial migration when no prior meta exists"
  - "Decoder test feeds Drizzle-shaped camelCase rows (what db.select returns), not snake_case DB rows — createSelectSchema produces camelCase shape"

patterns-established:
  - "Integration spec skip-with-reason: describe.skipIf(!HAS_DB) + console.warn on startup when TEST_DATABASE_URL unset"
  - "Per-test cleanup via insertedIds.push + afterEach delete; client.end in afterAll to prevent Vitest hangs"
  - "Decoder contract: raw DB row (after Drizzle select) → envelope fields via name-rename + Date→ISO conversion"

requirements-completed: [SPEC-04, TRACE-07]

# Metrics
duration: 11min
completed: 2026-04-17
---

# Phase 15 Plan 01: Events Table + Row Decoder + JSONB Spike Summary

**Append-only events Drizzle table with 4 indexes, reference row decoder (drizzle-zod + Zod 4 looseObject envelope), and SPEC-04 JSONB round-trip spike GREEN on jobs.metadata.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-17T14:59:28Z
- **Completed:** 2026-04-17T15:10:39Z
- **Tasks:** 3
- **Files created:** 8
- **Files modified:** 2

## Accomplishments

- `events` table committed to Drizzle schema with 10 columns and 4 non-PK indexes (correlation_id, event_type, occurred_at, aggregate composite). TRACE-07 satisfied.
- Generated SQL migration `0000_add_events_table.sql` (plus meta snapshot/journal) under `server/db/migrations/` — the first committed migration in the project. `drizzle-kit generate` emits full-schema initial snapshot, so this file contains all 22 tables and will anchor the migration chain going forward.
- Shared envelope schema (`server/events/envelope.ts`) with Zod 4 `z.looseObject` for additive forward-compat (SPEC-08) and `v: z.literal(1)` for future version union (SPEC-10).
- `decodeEventRow` reference decoder (`server/events/decoder.ts`) using `createSelectSchema(events)` from drizzle-zod — Open Question #1 resolved, no fallback needed. This is the template every future module row decoder will follow.
- SPEC-04 JSONB round-trip spike GREEN: nested objects, unicode, null, and array-of-objects round-trip on `jobs.metadata` via `expect(fetched).toEqual(input)` deep-equal. Postgres key-order semantics documented in-test.

## Task Commits

1. **Task 1.1 — events table + migration (TDD)**
   - `34463ef` test(15-01): add failing events-schema introspection spec (RED)
   - `8497ca4` feat(15-01): add events append-only table with 4 indexes (GREEN, includes drizzle.config.ts + generated migration)

2. **Task 1.2 — row decoder with drizzle-zod (TDD)**
   - `0b56fe3` test(15-01): add failing events-decoder spec (RED)
   - `d942305` feat(15-01): add events row decoder with drizzle-zod (GREEN, includes envelope.ts + decoder.ts + spec rewritten for Drizzle-shaped camelCase input)

3. **Task 1.3 — JSONB round-trip spike (test-only)**
   - `c9e368e` test(15-01): add jobs.metadata JSONB round-trip spike (SPEC-04)

**Plan metadata commit:** (pending — created at end-of-plan with SUMMARY + STATE + ROADMAP)

## Files Created/Modified

### Schema + Migration
- `server/db/schema.ts` — appended `events` pgTable with 10 columns (id, eventType, eventVersion, correlationId, causationId, aggregateType, aggregateId, payload, occurredAt, actor) + 4 indexes. `payload` intentionally has no jsonb default per Pitfall #5.
- `drizzle.config.ts` — `out: './server/db/migrations'` (was `./drizzle`) to colocate migrations with schema.
- `server/db/migrations/0000_add_events_table.sql` — full-schema initial migration including events table and all 22 other tables.
- `server/db/migrations/meta/0000_snapshot.json`, `server/db/migrations/meta/_journal.json` — drizzle-kit metadata for migration chain replay.

### Events module
- `server/events/envelope.ts` — shared `envelopeSchema` (Zod 4 `z.looseObject` + `v: z.literal(1)` + 10 fields).
- `server/events/decoder.ts` — `decodeEventRow(row)` via `createSelectSchema(events)` then project to envelope shape with `eventType → type` rename and `occurredAt Date → ISO string`.

### Tests
- `server/db/__tests__/events-schema.spec.ts` — 4 tests, DB introspection (information_schema.columns + pg_indexes) gated on TEST_DATABASE_URL.
- `server/db/__tests__/events-decoder.spec.ts` — 6 tests, in-memory unit: valid projection, rename, ZodError on malformed rows, looseObject tolerance.
- `server/db/__tests__/jsonb-roundtrip.spec.ts` — 4 tests, live DB insert/select on `jobs.metadata` with deep-equal assertions.

## Decisions Made

- **Open Question #1 resolved (drizzle-zod + Zod 4 compat):** runtime check via `createSelectSchema(events).parse(...)` succeeded with the installed stable versions (`drizzle-zod@0.8.3` + `zod@4.3.6` + `drizzle-orm@0.45.1`). Decoder uses the standard import path; no hand-typed fallback required. If a future bump breaks this, a fallback pattern lives in `decoder.ts` top-of-file comment citing RESEARCH §6.
- **Migration output directory relocated to `server/db/migrations/`** (from the default `./drizzle`). The plan explicitly specified this path; colocating migrations with the schema they describe reduces context-switch during review. `drizzle.config.ts` updated accordingly.
- **Initial migration is full-schema (all 22 tables), not events-only.** This is `drizzle-kit generate`'s correct behavior when no prior migration exists — it emits a snapshot. Future migrations will be incremental deltas. The migration is named `0000_add_events_table` per the plan's intent.
- **Decoder takes camelCase input (Drizzle-shaped), not snake_case (raw DB).** My first test draft fed snake_case rows; `createSelectSchema` produces camelCase (Drizzle column keys). The decoder's rename step (`eventType → type`) is at the envelope boundary, not a column-name projection. Test rewritten accordingly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] drizzle.config.ts out directory misaligned with plan**
- **Found during:** Task 1.1 (generate migration)
- **Issue:** Plan specifies migrations live in `server/db/migrations/` but `drizzle.config.ts` was configured with `out: './drizzle'`. Without fix, `drizzle-kit generate` would have emitted files to the wrong path.
- **Fix:** Edited `drizzle.config.ts` `out: './server/db/migrations'`.
- **Files modified:** `drizzle.config.ts`
- **Verification:** `drizzle-kit generate --name add_events_table` wrote SQL to `server/db/migrations/0000_add_events_table.sql` as expected.
- **Committed in:** `8497ca4` (Task 1.1 GREEN commit)

**2. [Rule 3 — Blocking] Decoder spec initial UUID samples failed strict v4 regex**
- **Found during:** Task 1.2 (run GREEN)
- **Issue:** First draft of `events-decoder.spec.ts` used placeholder UUIDs (e.g. `c0c0c0c0-dead-beef-0123-...`) that do not satisfy Zod 4's strict uuid format (which enforces correct version/variant bits).
- **Fix:** Replaced with real `crypto.randomUUID()` samples.
- **Files modified:** `server/db/__tests__/events-decoder.spec.ts`
- **Verification:** 6/6 decoder tests pass.
- **Committed in:** `d942305` (Task 1.2 GREEN commit).

**3. [Rule 3 — Blocking] Decoder spec wrong input shape (snake_case vs camelCase)**
- **Found during:** Task 1.2 (run GREEN, ZodError from eventRowSchema)
- **Issue:** First draft fed snake_case rows to `decodeEventRow` matching DB column names. But `createSelectSchema(events)` produces a **camelCase** Zod schema (matching Drizzle column keys), and `db.select()` returns camelCase rows. The decoder is the downstream-of-Drizzle step, not the raw-DB step.
- **Fix:** Rewrote test fixture `baseRow()` to return camelCase keys (`eventType`, `correlationId`, `occurredAt`, etc.); updated docstring to explain column-naming chain (DB snake → Drizzle camel → envelope field-name).
- **Files modified:** `server/db/__tests__/events-decoder.spec.ts`
- **Verification:** 6/6 decoder tests pass.
- **Committed in:** `d942305` (Task 1.2 GREEN commit).

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking)
**Impact on plan:** All three fixes were essential for the tests to compile/run correctly. No scope creep; scope remains tasks 1.1/1.2/1.3 exactly.

## Issues Encountered

- **Concurrent git activity detected during commits.** `git reflog` shows a concurrent commit (`3c73f40 test(15-02): ... compile-fail proof`) appearing during Task 1.1's commit attempts. No impact — my commits landed sequentially after this external work, and the 15-02/15-03 work is orthogonal to 15-01 (different files: `server/types/ids.ts`, `server/correlation/`).
- **Pre-existing typecheck errors** in `server/artifacts/recording-service.ts`, `server/correlation/__tests__/*.spec.ts`, and `server/pipelines/schema.ts` are OUT OF SCOPE for Plan 15-01 (unrelated files touched in parallel by 15-02/15-03 and pre-existing v2.0 debt). Logged to `.planning/phases/15-fix-operational-dependencies/deferred-items.md` for a later plan to address. Per deviation scope-boundary rule, I did not attempt to fix them here.

## TEST_DATABASE_URL Setup

All 3 spec files gate on `TEST_DATABASE_URL` (falling back to `DATABASE_URL`). To run the full suite locally:

```bash
createdb device_farm_test
DATABASE_URL="postgresql://localhost:5432/device_farm_test" npx drizzle-kit push
TEST_DATABASE_URL="postgresql://localhost:5432/device_farm_test" npx vitest run server/db/__tests__/
```

Without `TEST_DATABASE_URL`:
- `events-schema.spec.ts` → skips with `[events-schema.spec] SKIPPED: set TEST_DATABASE_URL to run`
- `jsonb-roundtrip.spec.ts` → skips with `[jsonb-roundtrip.spec] SKIPPED: set TEST_DATABASE_URL to run`
- `events-decoder.spec.ts` → runs (no DB required; purely in-memory Zod assertions)

Verified locally: 14/14 tests pass against `device_farm_test` on localhost Postgres.

## Deep-Equal Assertion Outcome

Real insert/select round-trip on `jobs.metadata` with:
```js
{ b: 2, a: 1, nested: {c: [1,2,3], d: {deep: true}}, arr: [{x: 1}, {y: 2}], unicode: 'café', nullField: null }
```
assertion `expect(fetched[0].metadata).toEqual(input)` **passes** — Postgres jsonb preserves semantic content (values, nesting, arrays, unicode) across round-trip. Key-order is NOT preserved (per §8.14), which is why we use `toEqual` not `JSON.stringify` equality.

## drizzle-zod Version Pin

- `drizzle-zod@0.8.3` (package.json `dependencies`, unchanged from Plan 15-00)
- `zod@4.3.6` (unchanged)
- `drizzle-orm@0.45.1` (unchanged)

Zod 4 compatibility confirmed by live test: `createSelectSchema(events).parse({...})` returned the expected shape with `eventVersion: number`, `occurredAt: Date`, `payload: unknown`. No fallback to hand-typed row schema needed; decoder.ts uses the standard import.

## Next Plan Readiness

- Plans 15-02 (branded IDs) and 15-03 (correlation plugin) have already landed (see `git log` 15-02/15-03 commits dated 2026-04-17). This plan's envelopeSchema uses plain `z.string().uuid()` but can be upgraded to branded schemas in plan 04's bus wiring per plan 15-01's `<interfaces>` guidance.
- `events` table is ready for plan 04 persist middleware to INSERT into. `decodeEventRow` is the reference pattern every future row decoder (plans for job, device, artifact, recording, pipeline modules) will follow.
- TRACE-07 satisfied (table + indexes exist). SPEC-04 satisfied (decoder exists + JSONB spike green).

## Self-Check: PASSED

All claims verified:
- `server/db/schema.ts` contains `export const events = pgTable('events'` (line 415)
- `server/db/migrations/0000_add_events_table.sql` exists and contains `CREATE TABLE "events"` + all 4 index statements
- `server/events/envelope.ts` exists with `z.looseObject` and `v: z.literal(1)`
- `server/events/decoder.ts` exists with `createSelectSchema(events)` and `export function decodeEventRow`
- All 6 commits exist: `34463ef`, `8497ca4`, `0b56fe3`, `d942305`, `c9e368e`, plus the upcoming final metadata commit
- All 14 tests pass when run against `device_farm_test` on localhost Postgres

---
*Phase: 15-fix-operational-dependencies*
*Plan: 01*
*Completed: 2026-04-17*
