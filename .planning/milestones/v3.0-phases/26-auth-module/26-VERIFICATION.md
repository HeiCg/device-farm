---
phase: 26-auth-module
verified: 2026-05-15T00:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 26: Auth Module Verification Report

**Phase Goal:** Add Zod to API-key routes, publish `auth.key.*` events, and populate the `actor` field on event envelopes from the authenticated context via ALS.
**Verified:** 2026-05-15
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every auth route has Zod request + 200-response schemas | VERIFIED | `key-routes.ts` uses `FastifyZodOpenApiTypeProvider` + `satisfies FastifyZodOpenApiSchema` on POST /admin/keys, GET /admin/keys, DELETE /admin/keys/:id, POST /api/keys/:id/claims/admin |
| 2 | `auth.key.created` and `auth.key.revoked` events publish on bus with correct correlationId + actor | VERIFIED | `events.ts` has `persisted: true` on both entries; `module.ts` wires `makeAuthEmitters(moduleBus, persistEnvelope)` as 10th sample point; `key-routes.ts` calls `emit.keyCreated` / `emit.keyRevoked`; `subscriber.spec.ts` proves bus emit + DB persist with `actor='apikey:<id>'` |
| 3 | `actor` on every persisted event resolves from ALS: `apikey:<id>` for HTTP auth, `system` for boot, `cron` for scheduled | VERIFIED | `plugin.ts` stamps `asApiKeyActor(matched.id)` into ALS store on bearer auth; `server/index.ts:173-174` wraps onReady in `asyncLocalStorage.run({correlationId, actor:'system'})`; `queue/plugin.ts:199` has `actor: data.actor ?? 'cron'`; `bus/helpers.ts:100` fallback is now `'system'` (not `'anonymous'`) |
| 4 | Auth module follows Phase 16 conventions (MODULE.md 9 sections, barrel, events.ts, factory, tests-as-spec) | VERIFIED | `MODULE.md` has 10 H2 sections (Purpose through Runnable Example); `index.ts` barrel exports factory + requireAdmin + full events surface + actor surface; `events.ts` has typed registry; `createAuthModule` factory in `internal/module.ts`; all test files are `.spec.ts` (0 `.test.ts` remaining) |
| 5 | `requireAdmin` middleware gates `/admin/drain` + `/admin/drain/resume` | VERIFIED | `server/jobs/internal/routes.ts:109,187` chain `[requireAuth as never, requireAdmin as never]`; `requireAdmin` imported from `../../auth/index.js` (MOD-02 barrel compliant) |
| 6 | `apiKeys.claims` JSONB column exists with defensive migration | VERIFIED | `server/db/schema.ts:159` has `claims: jsonb('claims').notNull().default(sql\`'{}'::jsonb\`)`; `server/db/migrations/0005_api_keys_claims.sql` has both ALTER TABLE + UPDATE defensive statement |
| 7 | 10th dep-cruiser rule fires on deep import into `server/auth/internal/` | VERIFIED | `.dependency-cruiser.cjs:188` has `no-deep-imports-into-auth-internal` rule; `__fixtures__/dep-cruiser/bad-auth-deep-import.ts` exists; `server/hooks/__tests__/dep-cruiser.spec.ts:537` has `[MOD-02 auth extension]` it-block |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/auth/events.ts` | 2 events stub + full body | VERIFIED | AUTH_EVENT_NAMES (2 keys), authRegistry with persisted:true on both, makeAuthEmitters, AUTH_AGGREGATE_ID |
| `server/auth/internal/module.ts` | createAuthModule factory (10th persistEnvelope) | VERIFIED | Full implementation, not a stub; persistEnvelope projects envelope.actor; 104 lines |
| `server/auth/internal/actor.ts` | actorSchema + 4 helpers | VERIFIED | actorSchema regex, Actor type, asApiKeyActor, asUserActor, SYSTEM_ACTOR, CRON_ACTOR |
| `server/auth/internal/auth-service.ts` | validateKeyAndReturnRow + claims support | VERIFIED | validateKeyAndReturnRow returns MatchedApiKey with id/name/claims; back-compat validateKey preserved |
| `server/auth/internal/key-routes.ts` | Zod on all 4 routes + emit calls | VERIFIED | FastifyZodOpenApiTypeProvider on all routes; emit.keyCreated and emit.keyRevoked called |
| `server/auth/internal/require-admin.ts` | requireAdmin preHandler | VERIFIED | Returns 403 RFC 7807 when claims.admin !== true |
| `server/auth/MODULE.md` | 9 H2 sections + Runnable Example | VERIFIED | 10 headings including Runnable Example; Purpose through Dependencies confirmed |
| `server/auth/index.ts` | Full surface barrel | VERIFIED | Exports createAuthModule, requireAdmin, authRegistry, actorSchema and all related types |
| `server/auth/plugin.ts` | Thin wirer with bearer-auth ALS stamping | VERIFIED | 89 lines; registers bearerAuth with addHook:false; auth callback stamps ALS actor |
| `server/auth/__tests__/events.spec.ts` | EVENTS-03 registry shape | VERIFIED | Exists; tests AUTH_EVENT_NAMES and authRegistry |
| `server/auth/__tests__/subscriber.spec.ts` | DB-gated emit + persist proof | VERIFIED | Asserts auth.key.created/revoked emit to bus and persist with actor='apikey:<id>' |
| `server/auth/__tests__/admin-claim.spec.ts` | /admin/drain 403/200 gate | VERIFIED | Tests non-admin 403, admin 200, NULL claims 403, /admin/drain/resume, POST claims/admin |
| `server/auth/__tests__/als-actor.spec.ts` | 4 actor sources (TRACE-10) | VERIFIED | Tests apikey, system fallback, system explicit, cron actor |
| `server/auth/__tests__/contract.spec.ts` | Zod parse rejects malformed | VERIFIED | Tests POST/GET/DELETE/claims-admin schemas for accept/reject |
| `server/auth/__tests__/lifecycle-ownership.spec.ts` | Grep-guards on ALS patterns | VERIFIED | Guards anonymous→system migration; onReady wrap; cron actor byte-stable |
| `server/auth/__tests__/actor.spec.ts` | actorSchema regex validation | VERIFIED | Tests valid/invalid actors; rejects 'anonymous' |
| `server/auth/__tests__/module.spec.ts` | Factory shape (no DB) | VERIFIED | 8 tests proving MOD-06 factory shape, emit surface, persistEnvelope |
| `server/auth/__tests__/auth-plugin.spec.ts` | Renamed from .test.ts | VERIFIED | Exists; DEFERRED-26-E noted in deferred-items.md |
| `server/auth/__tests__/auth-service.spec.ts` | Renamed from .test.ts | VERIFIED | Exists; import updated post-mv |
| `server/db/schema.ts` (apiKeys.claims) | JSONB column with default | VERIFIED | Line 159: `claims: jsonb('claims').notNull().default(sql\`'{}'::jsonb\`)` |
| `server/db/migrations/0005_api_keys_claims.sql` | ALTER TABLE + UPDATE | VERIFIED | Both statements present; naming differs from plan (0005 not 0026 — DB already had prior migrations) |
| `.dependency-cruiser.cjs` | 10th rule no-deep-imports-into-auth-internal | VERIFIED | Rule at line 188 |
| `__fixtures__/dep-cruiser/bad-auth-deep-import.ts` | Fixture firing rule 10 | VERIFIED | File exists |
| `server/hooks/__tests__/dep-cruiser.spec.ts` | [MOD-02 auth extension] block | VERIFIED | it-block at line 537 |
| `server/__tests__/plugin-order.spec.ts` | Phase 26 additive block (6 assertions) | VERIFIED | Lines 404-453 with 6 Phase 26 dep-order + structural + MODULE.md count assertions |
| `server/index.ts` (onReady ALS wrap) | asyncLocalStorage.run with actor:'system' | VERIFIED | Lines 168-174 wrap onReady in system actor context |
| `server/bus/helpers.ts` (actor default) | 'anonymous' → 'system' | VERIFIED | Line 100: `readAls('actor') ?? 'system'`; no 'anonymous' in production code |
| `server/jobs/internal/routes.ts` (drain gate) | requireAdmin on /admin/drain | VERIFIED | Lines 109, 187 chain requireAdmin; imported from auth barrel |
| `.planning/phases/26-auth-module/deferred-items.md` | 5 Phase 26 deferrals | VERIFIED | DEFERRED-26-A through E documented |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `auth/plugin.ts` bearer-auth callback | `asyncLocalStorage` actor stamp | `asApiKeyActor(matched.id)` written to ALS store | WIRED | Lines 61-67 write to both Map and object shape stores |
| `server/index.ts` onReady | `asyncLocalStorage.run` with actor:'system' | Wraps entire initPool body | WIRED | Lines 173-174 confirmed |
| `key-routes.ts` POST /admin/keys | `emit.keyCreated` | Optional-chained invocation with payload | WIRED | Lines 124-132 |
| `key-routes.ts` DELETE /admin/keys/:id | `emit.keyRevoked` | Optional-chained invocation with payload | WIRED | Lines 183-190 |
| `module.ts` `persistEnvelope` | `events.actor` column | `actor: envelope.actor` at DB insert | WIRED | Line 79 in module.ts |
| `bus/helpers.ts` createEventHelpers | ALS actor read | `readAls('actor') ?? 'system'` | WIRED | Line 100 |
| `queue/plugin.ts` queue.work | cron actor stamp | `actor: data.actor ?? 'cron'` | WIRED | Line 199 (pre-existing from Phase 18, verified unchanged) |
| `server/jobs/internal/routes.ts` /admin/drain | `requireAdmin` middleware | preHandler chain `[requireAuth, requireAdmin]` | WIRED | Lines 109, 187; imported via auth barrel |
| `server/auth/index.ts` barrel | `requireAdmin` from internal/ | `export { requireAdmin } from './internal/require-admin.js'` | WIRED | Line 18 |
| `.dependency-cruiser.cjs` rule 10 | `bad-auth-deep-import.ts` fixture | dep-cruiser.spec.ts it-block triggers rule | WIRED | Spec line 537 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TRACE-10 | 26-00..26-04 | `actor` field populated from auth context via ALS | SATISFIED | 4 entry points wired: HTTP bearer (apikey:<id>), boot-time (system), no-context fallback (system), pg-boss worker (cron); als-actor.spec.ts proves all 4 sources |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `server/auth/__tests__/auth-plugin.spec.ts` | DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug inherited (DEFERRED-26-E) | Info | Does not block phase goal; documented in deferred-items.md; v6 not released as of 2026-05-15 |
| `server/db/migrations/0005_api_keys_claims.sql` | Migration named 0005 not 0026 as planned | Info | Naming is cosmetic; Drizzle sequences by generation order; content is correct |

No blocker anti-patterns. No `TODO`/`FIXME`/`PLACEHOLDER` patterns in production code. No `return null` / `return {}` stubs. `'anonymous'` literal is absent from all unguarded production TypeScript files.

---

### Human Verification Required

None. All success criteria are verifiable programmatically.

SC3 ("A `GET /api/events?correlationId=…` trace-tree result shows meaningful `actor` values end-to-end") is explicitly deferred to Phase 27 (API Aggregator) per ROADMAP and CONTEXT.md. Phase 26 lays the substrate only; the endpoint is out of scope.

---

### Gaps Summary

No gaps. All 7 observable truths are verified, all required artifacts exist and are substantive, all key links are wired, TRACE-10 is satisfied, and no blocker anti-patterns exist.

The phase achieved its stated goal: Zod is present on all API-key routes, `auth.key.created` and `auth.key.revoked` events publish on the bus with correct actor, and the `actor` field populates from ALS at all 4 entry points. The auth module follows canonical Phase 16 conventions. Nyquist gate passed per STATE.md roll-up.

---

_Verified: 2026-05-15_
_Verifier: Claude (gsd-verifier)_
