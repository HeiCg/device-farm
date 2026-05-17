# Phase 26: Auth Module - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Type:** Infrastructure phase (auto-skip discuss per autonomous workflow)

<domain>
## Phase Boundary

Restructure `server/auth/` into the canonical Phase 16 shape (`MODULE.md + barrel index.ts + events.ts + internal/ + tests-as-spec + createAuthModule(deps)`). Three additions:

1. **Zod on all auth routes**: Add Zod request + 200-response schemas to every route in `server/auth/key-routes.ts` (currently 2.1KB) using the project's `fastify-zod-openapi` provider (Phase 17 pattern). Routes are: API key CRUD (create/list/revoke).
2. **`auth.key.*` events**: 2 new events `auth.key.created` and `auth.key.revoked`. Both persisted per TRACE-08 (notable security events). aggregateType:`'auth'`, aggregateId:`apiKeyId`. Payloads include `keyId`, `keyName`, `actor`, `revocationReason?`.
3. **TRACE-10 actor field**: every persisted event row's `actor` column resolves from ALS to one of 4 string forms — `user:{userId}`, `apikey:{apiKeyId}`, `system`, `cron`. Authenticated HTTP requests populate ALS with `apikey:{id}` at the auth gate (`authService.validateKey` extension). Boot-time emits stamp `system`. pg-boss worker handlers stamp `cron`. Ad-hoc tests stamp whichever they want via `als.run({actor: 'system', ...}, ...)`.

In scope:
- New `server/auth/internal/` shape; barrel + factory + thin plugin.
- 2 new events `auth.key.created`, `auth.key.revoked` (both persisted); auth registry total = 2.
- ALS context shape extension: `{correlationId, actor}` (was `{correlationId}` plain object). Backwards-compatible — `readAls` returns `{correlationId, actor: actor ?? 'system'}` defaulting to system if absent.
- All existing `persistEnvelope` callsites in module factories project the actor onto the events row's `actor` column.
- Auth gate (`server/auth/internal/auth-service.ts:validateKey` or successor) writes `actor: 'apikey:{id}'` into ALS at request entry.
- Boot-time emits in `server/index.ts` and similar scripts wrap their `als.run({actor: 'system', ...}, ...)` block.
- pg-boss worker handlers stamp `actor: 'cron'` (or `actor: 'cron:{queueName}'` for traceability — planner decides).
- 10th dep-cruiser rule `no-deep-imports-into-auth-internal`.
- plugin-order.spec additive block.
- `.test.ts → .spec.ts` renames (auth-plugin.test.ts).
- Resolve DEFERRED-22-D auth claim formalization for `/admin/drain` (per Phase 23 deferred-items DEFERRED-23-A): add `requireAdmin` middleware that asserts `apiKey.claims?.admin === true`; gate `/admin/drain` on it. **Schema**: extend `apiKeys` table with a `claims JSONB DEFAULT '{}'` column; first key bootstrap sets `claims: {admin: true}`.

Out of scope:
- OIDC / OAuth integration — Phase 27+ if needed.
- Multi-tenant scoping — v2 territory.
- Rate-limiting on auth endpoints — Phase 27+ aggregator + middleware.
- Audit log UI — Phase 27 events trace endpoint covers this.

</domain>

<decisions>
## Implementation Decisions

### actor Schema Shape (TRACE-10)
- Format: **flat string** `"<type>:<id>"` for typed actors, **bare string** for untyped — `"user:{userId}"`, `"apikey:{apiKeyId}"`, `"system"`, `"cron"`. Persisted to `events.actor TEXT` column (already exists per Phase 15 schema).
- Zod schema in `server/auth/internal/actor.ts`: `actorSchema = z.string().regex(/^(user:[a-z0-9-]+|apikey:[a-z0-9-]+|system|cron(:[a-z0-9-]+)?)$/)`.
- ALS store extends from `{correlationId}` → `{correlationId, actor}` plain object. `readAls()` defaults missing actor to `'system'`.
- `persistEnvelope` middleware reads actor from ALS and projects it to events row.

### Admin Claim
- New JSONB column `apiKeys.claims` with `DEFAULT '{}'`.
- Drizzle migration: simple ALTER TABLE.
- `requireAdmin` middleware: throws 403 if `request.apiKey?.claims?.admin !== true`.
- `/admin/drain` route gate: chain `requireAdmin` middleware before existing handler.
- DEFERRED-26-A: bootstrap procedure for first admin key — for v3.0 land a CLI command `device-farm admin-grant <keyId>` that flips the claim. Phase 28 owns the Go side; Phase 26 owns the server-side update endpoint `POST /api/keys/:id/claims/admin`.

### Wave Structure (Claude's Discretion — copy from Phase 24/25)
Mirror 6-plan template:
- 26-00: Wave-0 substrate (events placeholder, queue.ts comment-only, internal/module.ts throw-stub, MODULE.md placeholder, index.ts barrel, dep-cruiser 10th rule, fixture, events.spec stub, apiKeys.claims migration, ALS shape extension placeholder).
- 26-01: events body — 2 auth events + emitters; actor schema body.
- 26-02: ALS actor stamp — `auth-service.validateKey` extension stamps actor; persistEnvelope projects to events.actor; lifecycle-ownership.spec readFileSync grep-guard zero plain `{correlationId}` ALS run blocks (must be `{correlationId, actor}`).
- 26-03: createAuthModule factory + Zod schema additions + thin plugin replacement + `requireAdmin` middleware + `/admin/drain` gate + `apiKeys.claims` route handler + actor stamping in pg-boss worker shells (cron actor).
- 26-04: DB-gated proofs — subscriber.spec (auth.key.created/revoked emit + persist with correct actor); contract.spec (Zod parsing rejects malformed auth requests); admin-claim.spec (`/admin/drain` returns 403 without admin claim, 200 with).
- 26-05: phase close — MODULE.md body + barrel + 1 .test→.spec rename + plugin-order.spec extension + deferred-items.md + Nyquist gate.

</decisions>

<code_context>
## Existing Code Insights

### Current auth module
- `server/auth/auth-service.ts` (4.0KB) — validateKey, key generation, listKeys, revokeKey.
- `server/auth/auth-plugin.ts` (1.2KB) — current plugin shape; replace with thin form.
- `server/auth/key-routes.ts` (2.1KB) — 2-3 routes; need Zod schemas added.
- `server/auth/__tests__/` — auth-plugin.test.ts exists; currently failing per inherited DEFERRED-17-A (fastify-zod-openapi v5 bug).
- NO `MODULE.md`, NO `index.ts` barrel, NO `internal/`, NO `events.ts`.

### ALS extension
- Current `bus/helpers.ts` `readAls` returns `{correlationId}`; extends to `{correlationId, actor}`.
- All `persistEnvelope` middleware copies (8 of them currently) read ALS and project to events row. Phase 26 extends each to also project actor.
- DEFERRED-22-E persistEnvelope consolidation still pending Phase 27+ — Phase 26 adds an extra projection field but does NOT trigger consolidation.

### Reference implementations
- Phase 25 pipelines (most recent + factory pattern).
- Phase 23 jobs (largest module — security-sensitive precedent for `/admin/drain` gate).
- Phase 17 contracts (fastify-zod-openapi + Zod request/response schema pattern).
- Phase 15 ALS plain-object shape pattern.

### Conventions enforced
- MOD-01..09; TRACE-06/-08/-10; EVENTS-03; Nyquist gate; dep-cruiser 10th rule; plugin-order.spec extension.

</code_context>

<specifics>
## Specific Ideas

- TRACE-10 is the SOLE direct REQ tracked for Phase 26.
- `actor` schema is intentionally flat string (NOT a typed union object) for compactness — events table already has the column as TEXT; round-trip is trivial.
- `auth.key.*` events both persist (TRACE-08 notable security events).
- Phase 26 finally absorbs the long-standing fastify-zod-openapi v5 `required`-emission bug (DEFERRED-17-A) by either upgrading the lib or swapping for a manual emit helper. Plan 26-03 owns this resolution OR explicitly documents continued deferral if blocked.

</specifics>

<deferred>
## Deferred Ideas

- **DEFERRED-26-A: Bootstrap procedure for first admin key** — `device-farm admin-grant <keyId>` CLI; Phase 28 Go-side, Phase 26 server-side endpoint.
- **DEFERRED-26-B: persistEnvelope consolidation across 8+ samples** — Phase 27+ owns; Phase 26 adds an actor-projection field, NOT a consolidation.
- **DEFERRED-26-C: OIDC / OAuth integration** — out of scope; v2 territory.
- **DEFERRED-26-D: Audit log UI** — Phase 27 events trace endpoint covers programmatic access; UI is Phase 29 web.

</deferred>
