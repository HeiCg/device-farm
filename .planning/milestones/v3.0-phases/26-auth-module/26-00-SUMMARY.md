---
phase: 26
plan: 00
subsystem: server/auth/
tags: [substrate, wave-0, auth, mod-02, trace-10, dep-cruiser, drizzle-migration]
dependency_graph:
  requires:
    - server/bus/types.ts (EventRegistry)
    - server/db/schema.ts (apiKeys table)
    - .dependency-cruiser.cjs (existing 9 module rules)
  provides:
    - server/auth/events.ts (AUTH_EVENT_NAMES + AUTH_AGGREGATE_TYPE + empty registry stub)
    - server/auth/internal/module.ts (createAuthModule throw-stub)
    - server/auth/internal/actor.ts (actorSchema + Actor type + 4 helpers)
    - server/auth/MODULE.md (Purpose-only placeholder)
    - server/auth/index.ts (MOD-02 strict 1-line barrel)
    - server/auth/__tests__/events.spec.ts (EVENTS-03 shape stub)
    - server/db/migrations/0005_api_keys_claims.sql (apiKeys.claims JSONB column)
    - .dependency-cruiser.cjs rule 10 (no-deep-imports-into-auth-internal)
    - __fixtures__/dep-cruiser/bad-auth-deep-import.ts
  affects:
    - server/db/schema.ts (apiKeys gains claims column)
    - server/hooks/__tests__/dep-cruiser.spec.ts (10 it-blocks now)
tech-stack:
  added: []
  patterns:
    - Phase 16 module shape Wave-0 substrate (9th repeat: Phase 18-25 + 26)
    - drizzle-kit generate auto-numbered migration (sequential 0005, NOT plan-literal 0026)
    - dep-cruiser fixture/rule/spec triplet (mirrors Phase 18-25 verbatim with auth substitution)
key-files:
  created:
    - server/auth/events.ts
    - server/auth/internal/module.ts
    - server/auth/internal/actor.ts
    - server/auth/MODULE.md
    - server/auth/index.ts
    - server/auth/__tests__/events.spec.ts
    - server/db/migrations/0005_api_keys_claims.sql
    - server/db/migrations/meta/0005_snapshot.json
    - __fixtures__/dep-cruiser/bad-auth-deep-import.ts
  modified:
    - server/db/schema.ts (apiKeys.claims JSONB column appended)
    - server/db/migrations/meta/_journal.json (idx 5 / tag 0005_api_keys_claims appended)
    - .dependency-cruiser.cjs (rule 10 + comment block extension)
    - server/hooks/__tests__/dep-cruiser.spec.ts (auth extension it-block + AUTH_FIXTURE const)
decisions:
  - "Migration filename: kept drizzle-kit auto-numbered '0005_api_keys_claims.sql' instead of plan-literal '0026_api_keys_claims.sql' (Rule 1 deviation — see below)"
  - "claims column: jsonb NOT NULL DEFAULT '{}'::jsonb (Pitfall 5 defensive UPDATE included in migration)"
  - "actorSchema regex: flat string format `<type>:<id>`; deliberately excludes 'anonymous' (TRACE-10 default migrates to 'system' in 26-02)"
  - "Wave 0 ships actor.ts at substrate level (full body, not stub) so Plan 26-02 grep-guards can importing actorSchema literal"
metrics:
  duration_minutes: 9
  completed_date: 2026-05-08
  tasks: 3
  tests_added: 1
  files_created: 9
  files_modified: 4
---

# Phase 26 Plan 00: Auth Module Wave 0 Substrate Summary

Wave 0 substrate landed for Phase 26 Auth Module — apiKeys.claims JSONB migration, 10th dep-cruiser rule, 6 module-shape stubs, and actorSchema body shipped at substrate level for downstream grep-guards. Plans 26-01..26-05 unblocked.

## Plan Objective

Ship scaffolding that plans 26-01..26-05 depend on WITHOUT touching any runtime file in `server/auth/` (auth-service.ts, auth-plugin.ts, key-routes.ts STAY at current locations). Mirrors Phase 25 Plan 25-00 sequencing exactly with `pipelines → auth` substitution + Drizzle migration addition.

## Execution Outcomes

### Files Created (9)

1. `server/auth/events.ts` — `AUTH_EVENT_NAMES` (2 keys: `auth.key.created`, `auth.key.revoked`) + `AUTH_AGGREGATE_TYPE='auth'` const + `AuthEventName` type + empty `authRegistry` stub satisfying `EventRegistry`. Full body lands in 26-01.
2. `server/auth/internal/module.ts` — 8-line `createAuthModule` throw-stub for dep-cruiser rule 10 resolvable target. Real body in 26-03.
3. `server/auth/internal/actor.ts` — FULL body: `actorSchema` regex (`/^(user:[a-z0-9-]+|apikey:[a-z0-9-]+|system|cron(:[a-z0-9-]+)?)$/`) + `Actor` type + `asApiKeyActor` / `asUserActor` / `SYSTEM_ACTOR='system'` / `CRON_ACTOR='cron'` exports. Substrate-level so 26-02 grep-guards can import.
4. `server/auth/MODULE.md` — Purpose-only placeholder (full 9-section body lands in 26-05).
5. `server/auth/index.ts` — MOD-02 strict 1-line internal/ re-export: `export { createAuthModule, type AuthModule } from './internal/module.js';`.
6. `server/auth/__tests__/events.spec.ts` — 1-test EVENTS-03 shape stub (asserts 2 dotted past-tense names; expands to 4+ tests in 26-01).
7. `server/db/migrations/0005_api_keys_claims.sql` — `ALTER TABLE "api_keys" ADD COLUMN "claims" jsonb DEFAULT '{}'::jsonb NOT NULL` + defensive `UPDATE ... WHERE claims IS NULL` (Pitfall 5).
8. `server/db/migrations/meta/0005_snapshot.json` — drizzle-kit emitted snapshot (24 tables, api_keys 10 columns).
9. `__fixtures__/dep-cruiser/bad-auth-deep-import.ts` — fires rule 10 via `@ts-expect-error` import from `../../server/auth/internal/module.js`.

### Files Modified (4)

1. `server/db/schema.ts` — `apiKeys` pgTable extended with `claims: jsonb('claims').notNull().default(sql\`'{}'::jsonb\`)` as final field. `jsonb` already imported (used by other tables); no other column edits.
2. `server/db/migrations/meta/_journal.json` — drizzle-kit appended idx 5 / tag `0005_api_keys_claims` automatically.
3. `.dependency-cruiser.cjs` — comment block header extended with rule 10 paragraph; new rule body inserted after rule 9 (pipelines), before `no-direct-bus-emit-outside-events-ts`. Mirrors rule 9 verbatim with `pipelines→auth` substitution.
4. `server/hooks/__tests__/dep-cruiser.spec.ts` — `AUTH_FIXTURE` const declared; new it-block `[MOD-02 auth extension]` appended after `[MOD-02 pipelines extension]` block. Mirrors rule-9 two-pass err+json pattern verbatim.

### apiKeys Table — 10 Columns Now (was 9)

| Column      | Type    | Default       | Notes                                |
| ----------- | ------- | ------------- | ------------------------------------ |
| id          | uuid    | gen_random_uuid() | PK                                |
| name        | varchar(255) | (req)    |                                      |
| keyHash     | varchar(255) | (req)    |                                      |
| keySalt     | varchar(64)  | (req)    |                                      |
| keyPrefix   | varchar(12)  | (req)    |                                      |
| createdAt   | timestamptz | now()      |                                      |
| lastUsedAt  | timestamptz | null       |                                      |
| expiresAt   | timestamptz | null       |                                      |
| revoked     | boolean | false         |                                      |
| **claims**  | **jsonb** | **'{}'::jsonb** | **Phase 26 — DEFERRED-23-A admin claim substrate** |

### Dep-cruiser Rules Count

- Forbidden module rules: **10** (was 9)
- Direct bus-emit rule: 1 (unchanged)
- Total forbidden rules: **11**

### Tests Run + Green

- `npx vitest run server/auth/__tests__/events.spec.ts` — 1/1 pass (~117ms)
- `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` — 10/10 pass (~9.8s; was 9/9)
- Combined wave run — 11/11 pass (~9.5s)
- `npx tsc --noEmit` — 37 pre-existing errors (unchanged from baseline; ZERO new on Wave 0 files)
- `npm run dep-check` — 3 pre-existing violations (artifacts→streaming/internal; documented out-of-scope per Plan 23-04). Rule 10 contributes 0 NEW (fixture lives in `__fixtures__/` outside `includeOnly:'^server/'`).

### Plans Unblocked

- **26-01** events body — 2 payload schemas (authKeyCreatedPayload, authKeyRevokedPayload), `makeAuthEmitters` factory, TRACE-08 persistence flags both true.
- **26-02** ALS actor stamp — boot-time `als.run({correlationId, actor:'system'}, ...)` wrap, `bus/helpers.ts:94` default literal `'anonymous' → 'system'`, lifecycle-ownership.spec readFileSync grep-guards (importing actorSchema from substrate).
- **26-03** factory + Zod + thin plugin — `createAuthModule(deps)`, `validateKeyAndReturnRow`, `requireAdmin` middleware, `/admin/drain` + `/admin/drain/resume` gates, `POST /admin/keys/:id/claims/admin` route.
- **26-04** DB-gated proofs — subscriber.spec, contract.spec, admin-claim.spec, als-actor.spec, lifecycle-ownership.spec.
- **26-05** phase close — MODULE.md 9-section body, barrel back-compat surface, `.test→.spec` renames, plugin-order.spec extension, deferred-items.md, Nyquist gate.

### Commits

| Task | Commit  | Description                                                              |
| ---- | ------- | ------------------------------------------------------------------------ |
| 0.1  | 087270f | feat(26-00): add apiKeys.claims jsonb column + drizzle migration         |
| 0.2  | 93960aa | feat(26-00): add auth module Wave 0 substrate stubs                      |
| 0.3  | 51fa361 | feat(26-00): add 10th dep-cruiser rule no-deep-imports-into-auth-internal |

## Confirmation: NO Runtime Auth Files Edited

```bash
git diff 087270f^..51fa361 -- server/auth/auth-service.ts server/auth/auth-plugin.ts server/auth/key-routes.ts
# (empty)
```

`server/auth/auth-service.ts`, `server/auth/auth-plugin.ts`, `server/auth/key-routes.ts` STAY at top-level locations and bodies UNCHANGED. `git mv` into `internal/` happens in Plan 26-03. NO `npm install`. NO edits to `package.json`. NO emission wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration filename mismatch with drizzle-kit sequential numbering**

- **Found during:** Task 0.1
- **Issue:** Plan literal mandated `0026_api_keys_claims.sql` (matching phase number). drizzle-kit generates migrations with sequential numbering keyed on `_journal.json` `idx`. Existing migrations are `0000..0004`; renaming the emitted file to `0026_*` would create a journal index gap (idx 5 has tag `0026_api_keys_claims` but file ordinal `0026` does not match idx `5`). drizzle's migrator sorts files by their numeric prefix and matches against journal `idx`; mismatch breaks the migration runner at server boot.
- **Fix:** Kept drizzle-emitted name `0005_api_keys_claims.sql` (drizzle naturally emitted clean canonical suffix without a random adjective — no rename needed). Updated all references (this SUMMARY, schema.ts comment, journal idx 5).
- **Files modified:** `server/db/schema.ts` (comment refers to `0005_api_keys_claims.sql`), `server/db/migrations/0005_api_keys_claims.sql`, `server/db/migrations/meta/_journal.json` (auto-emitted by drizzle-kit), `server/db/migrations/meta/0005_snapshot.json` (auto-emitted)
- **Acceptance criteria adjustment:** Plan's `test -f server/db/migrations/0026_api_keys_claims.sql` rewritten as `test -f server/db/migrations/0005_api_keys_claims.sql` — same semantic check (the plan's chosen literal was prescriptive but operationally incompatible with drizzle's required behavior).
- **Commit:** 087270f

## Authentication Gates

None encountered.

## Self-Check: PASSED

- [x] `server/auth/events.ts` — exists
- [x] `server/auth/internal/module.ts` — exists
- [x] `server/auth/internal/actor.ts` — exists
- [x] `server/auth/MODULE.md` — exists
- [x] `server/auth/index.ts` — exists
- [x] `server/auth/__tests__/events.spec.ts` — exists
- [x] `server/db/migrations/0005_api_keys_claims.sql` — exists
- [x] `__fixtures__/dep-cruiser/bad-auth-deep-import.ts` — exists
- [x] Commit 087270f — found
- [x] Commit 93960aa — found
- [x] Commit 51fa361 — found
