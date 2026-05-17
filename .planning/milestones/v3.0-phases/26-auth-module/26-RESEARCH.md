# Phase 26: Auth Module — Research

**Researched:** 2026-05-08
**Domain:** ALS-stamped actor projection across persisted events; canonical Phase 16 module shape applied to `server/auth/`; Zod-everywhere on auth routes; `requireAdmin` claim middleware formalizing DEFERRED-23-A; `apiKeys.claims JSONB` Drizzle migration; bootstrap of admin claim and pg-boss worker actor stamping.
**Confidence:** HIGH — Phase 23/24/25 supply verbatim precedent for module shape, persistEnvelope pattern, dep-cruiser N-th rule, plugin-order.spec extension, lifecycle-ownership grep-guards. Source code for ALL surface areas (`server/auth/*`, `server/bus/helpers.ts`, `server/queue/plugin.ts`, `server/index.ts`, 9× `persistEnvelope` copies, `server/jobs/internal/routes.ts`) was read in full. fastify-zod-openapi v5.6.1 confirmed installed; v6 has not shipped (release page through March 2026 stops at 5.6.1). `@fastify/bearer-auth` v10 receives `(key, req)` in its `auth` callback — mutate `req` for ALS stamping is the documented pattern.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase Boundary:**
Restructure `server/auth/` into the canonical Phase 16 shape (`MODULE.md + barrel index.ts + events.ts + internal/ + tests-as-spec + createAuthModule(deps)`). Three additions:
1. **Zod on all auth routes** — POST /admin/keys (already partly done in Plan 17-01), GET /admin/keys, DELETE /admin/keys/:id; promote into `components.schemas` via `.meta({id:...})`.
2. **`auth.key.*` events** — `auth.key.created` and `auth.key.revoked`. Both persisted per TRACE-08. `aggregateType:'auth'`, `aggregateId:apiKeyId`. Payloads include `keyId`, `keyName`, `actor`, `revocationReason?`.
3. **TRACE-10 actor field** — every persisted event row's `actor` column resolves from ALS to one of 4 string forms: `user:{userId}`, `apikey:{apiKeyId}`, `system`, `cron`. The auth gate writes `actor:'apikey:{id}'` into ALS at request entry; boot-time emits stamp `system`; pg-boss worker handlers stamp `cron`.

**In scope:**
- New `server/auth/internal/` shape; barrel + factory + thin plugin.
- 2 new events `auth.key.created`, `auth.key.revoked` (both persisted).
- ALS context shape extension: `{correlationId, actor}`. `readAls('actor')` already exists in `server/bus/helpers.ts:65`; default to `'system'` when absent.
- All 9 existing `persistEnvelope` callsites already project `envelope.actor` to the events row (verified by grep on `actor: envelope.actor` — nothing to change there). What CHANGES is the **upstream emit path**: emitters need actor populated by ALS, which already happens in `createEventHelpers` line 94 (`actor: opts.actor ?? readAls('actor') ?? 'anonymous'`). The phase changes the DEFAULT from `'anonymous'` to `'system'` and ensures EVERY emit fiber has actor set.
- Auth gate (`auth-service.validateKey` or successor) writes `actor:'apikey:{id}'` into ALS at request entry.
- Boot-time emits in `server/index.ts` onReady wrap their work in `als.run({correlationId, actor:'system'}, ...)`.
- pg-boss worker handlers stamp `actor:'cron'` (already done in `server/queue/plugin.ts:199` — verified).
- 10th dep-cruiser rule `no-deep-imports-into-auth-internal`.
- plugin-order.spec additive block.
- `.test.ts → .spec.ts` renames (auth-plugin.test.ts + auth-service.test.ts = 2 renames).
- DEFERRED-22-D / DEFERRED-23-A admin claim formalization: `requireAdmin` middleware asserts `apiKey.claims?.admin === true`; gates `/admin/drain` + `/admin/drain/resume`. Schema: extend `apiKeys` with `claims JSONB DEFAULT '{}'` column.

**Out of scope:**
- OIDC / OAuth integration (DEFERRED-26-C).
- Multi-tenant scoping (v2 territory).
- Rate-limiting on auth endpoints.
- Audit log UI (Phase 27 events trace endpoint covers programmatic; Phase 29 owns UI).

### Claude's Discretion

- **`actor` schema shape:** flat string `"<type>:<id>"` for typed; bare for untyped. Persisted to existing `events.actor TEXT` column.
- **Wave structure:** mirror Phase 24/25 6-plan template (`26-00..26-05`).
- **`requireAdmin` middleware shape:** Fastify preHandler reading `request.apiKey?.claims?.admin === true`.
- **DEFERRED-26-A:** server-side update endpoint `POST /api/keys/:id/claims/admin` (Phase 26 owns); CLI flip `device-farm admin-grant <keyId>` (Phase 28 owns).
- **fastify-zod-openapi DEFERRED-17-A:** evaluate during Plan 26-03; either upgrade to v6 (not yet released — see Open Questions) or document continued deferral.

### Deferred Ideas (OUT OF SCOPE)

- **DEFERRED-26-A:** Bootstrap CLI command for first admin key — Phase 28 Go-side.
- **DEFERRED-26-B:** persistEnvelope consolidation across 9+ samples — Phase 27+.
- **DEFERRED-26-C:** OIDC / OAuth integration — v2 territory.
- **DEFERRED-26-D:** Audit log UI — Phase 29 owns.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **TRACE-10** | Campo `actor` populado de contexto de auth (userId / apiKeyId / "system" / "cron") via ALS. | §ALS Actor Stamping (entry points: validateKey extension at `server/auth/auth-service.ts:32`; boot-time wraps in `server/index.ts:151,168-190,194-205`; pg-boss workers already stamp `'cron'` at `server/queue/plugin.ts:199`). §Code Examples §1-4 give verbatim diff. |
| **MOD-01..09** (carry-forward) | Canonical module conventions (MODULE.md / barrel / events.ts / tests-as-spec / factory / runnable example / invariants / dep-cruiser rule). | §Architecture Patterns §Module Shape; §10th dep-cruiser rule mirroring rules 1-9 verbatim. |
| **ROADMAP §Phase 26 SC1** | Every auth route has Zod request + 200-response schemas; `auth.key.created` and `auth.key.revoked` events publish on bus with correct correlationId + actor populated. | §Existing Code: `key-routes.ts:33-50` (POST already done in Plan 17-01); GET + DELETE need upgrade. §Code Examples §5 (full route block). §events.ts shape mirrors maestro's 2-event registry. |
| **ROADMAP §Phase 26 SC2** | `actor` field on every persisted event resolves from ALS: `userId`/`apiKeyId` for authenticated; `"system"` for boot; `"cron"` for scheduled. | §ALS Actor Stamping (4 entry points enumerated). §Pitfall 2: ALS context bleed; §Pitfall 4: actor-default migration `anonymous → system`. |
| **ROADMAP §Phase 26 SC3** | A `GET /api/events?correlationId=X` trace-tree (Phase 27) shows meaningful `actor` values end-to-end. | Phase 26 lays the substrate; Phase 27 consumes it. §Open Question: confirm tooling agrees that `actor` column on events table is the single source of truth (already true per `server/db/schema.ts` events table). |
| **ROADMAP §Phase 26 SC4** | Auth module follows Phase 16 conventions; Nyquist passes; coverage delta ≤ −2pp. | §Validation Architecture; §Coverage Delta. |
| **DEFERRED-23-A / DEFERRED-22-D resolution** | `requireAdmin` middleware gates `/admin/drain` + `/admin/drain/resume`; admin claim schema lands. | §Admin Claim §Drizzle Migration; §Code Examples §6 (requireAdmin preHandler). |
</phase_requirements>

---

## Current State Analysis

### File-level inventory of `server/auth/`

| File | Size | Role | Phase 26 disposition |
|------|------|------|---------------------|
| `auth-service.ts` | 4.0KB | `AuthService` class: `generateKey`, `validateKey`, `createKey`, `listKeys`, `revokeKey`. Uses `scryptSync`; reads `apiKeys` table by prefix; updates `lastUsedAt` on success. **No actor concept yet.** | **MOVE** to `internal/`; EXTEND `validateKey` to return the full apiKey row (id + name + claims) so the caller (auth gate) can stamp ALS. |
| `auth-plugin.ts` | 1.2KB | Current Fastify plugin. Registers `@fastify/bearer-auth` with `auth: async (key) => fastify.authService.validateKey(key)`. **Does NOT capture which key matched.** | **REWRITE** as thin wirer (`createAuthModule(deps)` factory); change `auth` callback signature to `(key, req) => { … }` and stamp `req.apiKey` + ALS actor on success. |
| `key-routes.ts` | 2.1KB | 3 routes: POST /admin/keys (Zod via Plan 17-01 ✅); GET /admin/keys (no Zod); DELETE /admin/keys/:id (no Zod). | **MOVE** to `internal/`; ADD Zod request + 200-response schemas to GET + DELETE; promote into `components.schemas` via `.meta({id:...})`. |
| `__tests__/auth-plugin.test.ts` | 5.9K | Auth plugin behaviour tests; **inherited DEFERRED-17-A failure** (fastify-zod-openapi v5 `required`-emission bug). | **RENAME** `.test.ts → .spec.ts` (MOD-04). Either fix DEFERRED-17-A or carry forward (decision in Plan 26-03 — see Open Question). |
| `__tests__/auth-service.test.ts` | 6.3K | Pure unit tests for `AuthService` methods (generateKey, validateKey, etc). NOT inherited DEFERRED-17-A. | **RENAME** `.test.ts → .spec.ts` (MOD-04); EXTEND with claims-aware tests post Plan 26-03. |
| `MODULE.md` | — | NOT EXISTS | **NEW** — 9 H2 sections + Runnable Example. |
| `index.ts` (barrel) | — | NOT EXISTS | **NEW** — strict 1-line `export type * from './internal/module.js'` re-export per MOD-02. |
| `internal/` | — | NOT EXISTS | **NEW** — holds `module.ts` (factory), `auth-service.ts`, `key-routes.ts`, `actor.ts` (actor schema + helpers), `require-admin.ts` (middleware). |
| `events.ts` | — | NOT EXISTS | **NEW** — `authRegistry` with 2 events; `makeAuthEmitters`; `AUTH_EVENT_NAMES`; `AUTH_AGGREGATE_ID = uuidv5('auth', URL_NS)`. |

### ALS shape today (`server/bus/helpers.ts:65-77`)

```typescript
function readAls(key: 'correlationId' | 'currentEventId' | 'actor'): string | null {
  const store = asyncLocalStorage.getStore();
  if (!store) return null;
  let raw: unknown;
  if (store instanceof Map) {
    raw = store.get(key);
  } else if (typeof store === 'object') {
    raw = (store as Record<string, unknown>)[key];
  } else {
    return null;
  }
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
```

**Already supports `'actor'` key.** Both Map and object shapes handled. `createEventHelpers` line 94 reads it: `const actor = opts.actor ?? readAls('actor') ?? 'anonymous';`

**Phase 26 changes:**
1. The fallback default `'anonymous'` becomes `'system'` (TRACE-10 contract).
2. Every entry point that runs an emit MUST populate `actor` in ALS (validate this is true via 4 entry points enumerated below).

### `persistEnvelope` callsites (9 verbatim copies)

All 9 module factories (`hooks/lifecycle/reporting/pool/artifacts/streaming/jobs/maestro/pipelines/internal/module.ts`) project `envelope.actor` onto the events row at the same line shape:

```typescript
await db.insert(eventsTable).values({
  // ...
  actor: envelope.actor,    // ← already projecting; no change needed
  // ...
});
```

**Phase 26 does NOT touch these.** Consolidation is DEFERRED-25-A (Phase 27+ owns; will become 10TH SAMPLE POINT after Phase 26 adds auth-module's persistEnvelope copy).

### pg-boss worker actor stamping (`server/queue/plugin.ts:177-209`)

The `queue.work` wrapper already builds an ALS store with `actor: data.actor ?? 'cron'` on line 199. Verified working since Phase 18 (lifecycle migration). Phase 26 changes nothing here — the wrapper already does the right thing.

**Plan 26-02 just adds an assertion in lifecycle-ownership.spec** that this fallback exists (grep-guard against accidental deletion).

### Boot-time emits in `server/index.ts:151-208`

Block of `onReady` hook does:
- `app.pool.initPool()` — internally emits `device.state.changed`, `device.allocated`, etc (Phase 20).
- `app.hookExecutor.execute('device.booted', ...)` — fires hook events.
- Direct `db.insert(schema.devices)…` for sync.

**No explicit ALS context.** Currently the emits inside this onReady fiber resolve `actor` to `'anonymous'` via `createEventHelpers` fallback. Phase 26 must wrap this onReady block in:

```typescript
await asyncLocalStorage.run(
  { correlationId: randomUUID(), actor: 'system' },
  async () => { /* existing onReady body */ }
);
```

**See Code Example §3** for the diff.

### Auth gate: `validateKey` extension surface

Current `validateKey(rawKey: string): Promise<boolean>` returns boolean. `@fastify/bearer-auth` v10 calls it via:

```typescript
auth: async (key: string) => fastify.authService.validateKey(key)
```

**Phase 26 changes** the callback to capture which key matched:

```typescript
auth: async (key: string, req: FastifyRequest) => {
  const matched = await fastify.authService.validateKeyAndReturnRow(key);
  if (!matched) return false;
  // Stamp request + ALS for downstream consumers (route handlers, emitters).
  (req as any).apiKey = matched;        // exposes id, name, claims to handlers
  const store = asyncLocalStorage.getStore();
  if (store && !(store instanceof Map)) {
    (store as Record<string, unknown>).actor = `apikey:${matched.id}`;
  } else if (store instanceof Map) {
    store.set('actor', `apikey:${matched.id}`);
  }
  return true;
}
```

Note: `@fastify/bearer-auth` v10 (installed) `auth` callback receives `(key, req)` — confirmed via README and prior research. The `req` object can be mutated (decorate-request-style) as the documented pattern for "stash matched-key context".

**Why mutate ALS instead of just `req.apiKey`?** Because the bus emit happens deep inside service code that does NOT receive `req`. ALS is the only general substrate. We do BOTH so route handlers can also read `request.apiKey?.claims?.admin` directly (the requireAdmin middleware path).

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fastify/bearer-auth` | ^10.1.2 | Bearer token auth hook with `(key, req) => Promise<boolean>` callback | Already used; v10 supports the `req`-receiving callback signature needed for actor stamping |
| `@fastify/request-context` | ^6.2.1 | ALS via `asyncLocalStorage` | Substrate from Phase 15 |
| `fastify-zod-openapi` | ^5.6.1 | Zod request/response schemas → OpenAPI 3.1 spec | Phase 17 substrate; v5.6.1 latest released (no v6 yet) |
| `zod` | ^4.x | Schema definition | Phase 15 substrate |
| `drizzle-orm` | latest installed | DB query + migration | Phase 15 substrate |

### Don't Add — Use Existing

- **No new auth library.** `@fastify/bearer-auth` covers Bearer; OIDC/OAuth deferred to v2.
- **No JSON Web Token middleware.** Out of scope; api-key bearer is the only auth surface.

---

## Architecture Patterns

### Module Shape (canonical Phase 16-25 — verbatim)

```
server/auth/
├── MODULE.md                    # 9 H2 sections + Runnable Example (covered in Plan 26-05)
├── index.ts                     # 1-line strict barrel: `export type * from './internal/module.js'`
├── events.ts                    # authRegistry (2 events) + makeAuthEmitters + AUTH_EVENT_NAMES + AUTH_AGGREGATE_ID
├── plugin.ts                    # thin wirer: createAuthModule + decorate + bearer-auth wiring
└── internal/
    ├── module.ts                # createAuthModule(deps) factory (10TH persistEnvelope sample point)
    ├── auth-service.ts          # AuthService (extended: validateKeyAndReturnRow, grantAdminClaim)
    ├── key-routes.ts            # 3 routes (Zod everywhere) + 1 new: POST /admin/keys/:id/claims/admin
    ├── actor.ts                 # actorSchema + parseActor + actor type + helpers
    └── require-admin.ts         # requireAdmin preHandler middleware
└── __tests__/
    ├── auth-service.spec.ts     # MOD-04 rename + claims-aware extensions
    ├── auth-plugin.spec.ts      # MOD-04 rename (DEFERRED-17-A may persist — see OQ)
    ├── events.spec.ts           # auth.key.* registry + payload schemas (no DB)
    ├── module.spec.ts           # createAuthModule factory shape (mock deps, no DB)
    ├── subscriber.spec.ts       # DB-gated: auth.key.created/revoked persist with actor=apikey:xxx
    ├── contract.spec.ts         # DB-gated: Zod parse rejects malformed POST/DELETE/GET/POST claims
    ├── admin-claim.spec.ts      # DB-gated: /admin/drain returns 403 without claim, 200 with
    ├── als-actor.spec.ts        # DB-gated: 4 actor sources resolve correctly (apikey/user/system/cron)
    └── lifecycle-ownership.spec.ts  # grep-guards: zero plain `{correlationId}` ALS run blocks
```

### Pattern 1: ALS Actor Stamping at 4 Entry Points

**Source:** Phase 15 plan 06 + Phase 18 lifecycle (cron actor pattern) + Phase 23 jobs (drain endpoint).

| Entry Point | Today | Phase 26 stamp | File:Line |
|-------------|-------|----------------|-----------|
| **HTTP request (authenticated)** | `correlationPlugin` sets `correlationId`; `actor` not set → falls back to `'anonymous'` | Auth callback sets `actor:'apikey:{id}'` after key matches | `server/auth/plugin.ts` (auth callback) |
| **HTTP request (unauthenticated)** | `correlationPlugin` sets `correlationId`; `actor` not set → fallback | Default fallback in `createEventHelpers` changes `'anonymous' → 'system'` (single line in `server/bus/helpers.ts:94`) | `server/bus/helpers.ts:94` |
| **Boot-time onReady** | No ALS context | Wrap onReady body in `als.run({correlationId: randomUUID(), actor:'system'}, ...)` | `server/index.ts:151-208` |
| **pg-boss worker** | `actor:'cron'` already set (Phase 18) | NO CHANGE; verify via grep-guard in lifecycle-ownership.spec | `server/queue/plugin.ts:199` |

### Pattern 2: actor Schema (flat string)

```typescript
// server/auth/internal/actor.ts
import { z } from 'zod';

/**
 * TRACE-10 actor format — flat string `<type>:<id>` for typed actors,
 * bare string for untyped. Persisted to events.actor TEXT column.
 */
export const actorSchema = z.string().regex(
  /^(user:[a-z0-9-]+|apikey:[a-z0-9-]+|system|cron(:[a-z0-9-]+)?)$/,
  { message: 'actor must match user:<id> | apikey:<id> | system | cron[:<queue>]' }
);

export type Actor = z.infer<typeof actorSchema>;

export function asApiKeyActor(apiKeyId: string): Actor { return `apikey:${apiKeyId}`; }
export function asUserActor(userId: string): Actor { return `user:${userId}`; }
export const SYSTEM_ACTOR: Actor = 'system';
export const CRON_ACTOR: Actor = 'cron';
```

### Pattern 3: 10th dep-cruiser rule (verbatim mirror)

Append to `.dependency-cruiser.cjs` `forbidden` array (after rule 9 `no-deep-imports-into-pipelines-internal`):

```javascript
{
  name: 'no-deep-imports-into-auth-internal',
  comment: 'External callers must use the server/auth barrel — internal/* is private.',
  severity: 'error',
  from: { pathNot: '^server/auth/' },
  to:   { path:    '^server/auth/internal/' },
},
```

### Pattern 4: plugin-order.spec extension

Append to `server/__tests__/plugin-order.spec.ts` describe block (mirrors Phase 23/24/25 additive pattern):

```typescript
it('Phase 26: registers auth before websocket-plugin', async () => {
  const printed = app.printPlugins();
  const authIdx = printed.indexOf('auth');
  const wsIdx = wbIndex(printed, 'websocket-plugin');
  expect(authIdx).toBeGreaterThan(-1);
  expect(authIdx).toBeLessThan(wsIdx); // auth must come before WS so WS sub-routes inherit auth context
});
```

### Anti-Patterns to Avoid

- **Per-key ALS via `decorateRequest('apiKey', null)`:** Fastify's documented gotcha (search result note) — `decorateRequest` shares the prototype across all requests. Mutating `request.apiKey` directly inside the auth callback is the correct pattern. ALS is the cross-fiber substrate.
- **Threading `actor` parameter through service code:** Anti-pattern; the whole point of TRACE-10 is ALS-driven. Explicit `opts.actor` overrides exist (`createEventHelpers` line 94) only for tests and rare producer escape hatches.
- **Persisting raw API key to events.actor:** ONLY the apiKey **id** (UUID) goes into `actor:'apikey:{id}'`. Never the raw key (which would land in `events` table — security incident).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bearer token validation | Hand-rolled middleware | `@fastify/bearer-auth` v10 (already installed) | Provides `verifyBearerAuth` decorator + factory; addHook:false mode for selective application |
| Actor parsing/stamping | Custom regex per callsite | `actorSchema` (Phase 26 §Pattern 2) + `asApiKeyActor`/`asUserActor` helpers | Single source of truth for valid actor shapes; type-safe |
| pg-boss worker ALS restoration | Manual store rebuild per worker | `queue.work` wrapper at `server/queue/plugin.ts:177-209` (already does this) | Phase 18 substrate; restores `correlationId + currentEventId + actor` from `job.data` |
| Admin claim membership check | Inline `if (!apiKey?.claims?.admin)` per route | `requireAdmin` preHandler middleware (Phase 26 new) | Single point of enforcement; testable in isolation |
| OpenAPI emission | Hand-write OpenAPI YAML | `fastify-zod-openapi` `.meta({id:...})` promotion + `@fastify/swagger` `app.swagger()` | Phase 17 substrate; CLI + web codegen depend on it |

**Key insight:** Phase 26 is mostly assembly — every primitive (bearer auth, ALS, persistEnvelope, actor field on emit helpers, queue worker actor) already exists. The phase wires them and adds 2 new events + 1 column + 1 middleware. Build nothing from scratch.

---

## Common Pitfalls

### Pitfall 1: ALS Context Bleed Across Requests if Actor Not Reset

**What goes wrong:** If we `(store as object).actor = 'apikey:xxx'` inside the auth callback, AND the ALS store is the SAME object reference across the request fiber, `@fastify/request-context` v6 runs each request inside its own `asyncLocalStorage.run({...defaultStoreValues}, ...)`, so each request gets a FRESH store object. **Current behaviour is safe** because correlationPlugin (Phase 15) creates a new store object per request (verified via `node_modules/@fastify/request-context/index.js:` `defaultStoreValues` cloned per call).

**Why it could happen:** A future refactor that shares the store object (anti-pattern; e.g. attaching to a global ref) would leak.

**How to avoid:**
- Test in `als-actor.spec.ts`: 2 sequential requests, key-A then key-B; assert event emitted in request-2 has `actor:'apikey:B'` not `actor:'apikey:A'`.
- Grep-guard in `lifecycle-ownership.spec.ts`: assert `correlationPlugin` body still calls `requestContext.run` (or equivalent) per request.

**Warning signs:** Same actor on events from different concurrent requests. Use Vitest concurrent test with 2 different keys.

### Pitfall 2: Boot-Time Emit Ordering — db Plugin Must Register Before Boot-Time `als.run`

**What goes wrong:** `server/index.ts` onReady block emits via `app.pool.initPool` → `device.state.changed` → `persistEnvelope` → `db.insert(events)`. If we wrap onReady in `als.run({actor:'system', ...})`, the wrapping must happen AFTER `dbPlugin` is registered (Step 4 in `server/index.ts:69-70`). Plugin order asserts this; the onReady hook itself fires AFTER all plugins register, so this is safe. **The risk is ordering AT BOOT, not at register time.**

**Why it could happen:** A naïve refactor moves the `als.run` wrap to the `app.register(...)` body of an early plugin instead of `app.addHook('onReady', ...)`.

**How to avoid:**
- The wrap MUST go inside the `app.addHook('onReady', async () => { ... })` body — see `server/index.ts:151`. The onReady fires AFTER all plugins ready (Fastify lifecycle guarantee).
- Test in `als-actor.spec.ts`: simulate boot, assert events emitted during onReady have `actor:'system'`.

**Warning signs:** `actor` is null/anonymous on events emitted during `pool.initPool()` etc.

### Pitfall 3: pg-boss Worker correlationId Source — Fresh ALS per Job vs Inherit from envelope.correlationId

**What goes wrong:** Two valid models for correlationId scope on cron-fired jobs:
- **Option A (inherit):** Worker uses the correlationId stamped at `boss.send` time. Good for "follow-the-thread" tracing.
- **Option B (fresh):** Worker generates fresh UUID per job dispatch. Good for trace-isolation (Phase 18 `boss.schedule` already does Option B per `server/queue/plugin.ts:217-225` comment).

**Phase 26 decision:** **Option B for `schedule`-fired** (already implemented; do NOT change), **Option A for `send`-fired** (already implemented). The actor stamp is `'cron'` regardless. Phase 26 just verifies via grep-guard that:
- `queue.send` reads ALS actor and includes it in envelope (line 171: `actor:'system'` fallback) — already done.
- `queue.schedule` stamps `actor:'cron'` (line 222: `actor:'cron'` literal) — already done.
- `queue.work` restores actor (line 199: `actor: data.actor ?? 'cron'`) — already done.

**How to avoid:** Lock these via grep-guards in `lifecycle-ownership.spec.ts`. Do NOT introduce a 3rd model.

### Pitfall 4: Actor Default Migration `'anonymous' → 'system'`

**What goes wrong:** `createEventHelpers` line 94 fallback `actor: opts.actor ?? readAls('actor') ?? 'anonymous'` is wrong for Phase 26 — TRACE-10 mandates `'system'` as the boot/cron/no-context default.

**Why it could happen:** This was Phase 15's substrate decision; nobody has revisited it.

**How to avoid:** Plan 26-02 changes the literal `'anonymous' → 'system'` and asserts it via test. Schema regex includes `'system'` but NOT `'anonymous'` — so the actorSchema validation enforces this transitively (any event with `actor:'anonymous'` would fail Zod parse downstream → caught by `events.spec.ts`).

**Warning signs:** Pre-existing tests asserting `actor:'anonymous'` fail. **EXPECTED** — they need updating to `'system'`. Catalog them.

### Pitfall 5: `apiKeys.claims` JSONB Default `{}` vs `null`

**What goes wrong:** Drizzle migration `claims: jsonb('claims').default(sql\`'{}'\`)` ensures NEW rows get `{}`; **existing rows have `claims = NULL`**. The `requireAdmin` middleware MUST handle `null` defensively: `apiKey?.claims?.admin === true` (falsy on null).

**Why it could happen:** A naïve migration without `UPDATE ... SET claims = '{}'` for existing rows leaves them null.

**How to avoid:**
- Migration includes `UPDATE api_keys SET claims = '{}'::jsonb WHERE claims IS NULL;` AFTER the `ALTER TABLE ... ADD COLUMN` step.
- `requireAdmin` middleware uses optional-chaining: `request.apiKey?.claims?.admin === true`.
- Test in `admin-claim.spec.ts`: insert a row with `claims = NULL`, assert /admin/drain returns 403 (not 500).

### Pitfall 6: bearer-auth v10 `auth` Callback Synchronous-Side-Effects

**What goes wrong:** The mutation `(req as any).apiKey = matched` happens INSIDE the `auth` callback. If we ALSO mutate ALS via `asyncLocalStorage.getStore()` and bearer-auth (or any wrapper plugin) runs in a different fiber than the route handler, the ALS write could be visible only inside the auth fiber.

**Reality check:** `@fastify/bearer-auth` runs as a Fastify `onRequest` hook; same fiber as the route handler. `@fastify/request-context` registers its `asyncLocalStorage.run` at `onRequest` too. So the ALS write inside the auth callback IS visible to the route handler and downstream emit calls.

**How to avoid:** Test in `als-actor.spec.ts`: emit an event from within a route handler; assert the event has `actor:'apikey:{validated-id}'` not `'system'`. If this passes, fiber inheritance is correct.

**Warning signs:** Inside-route emits resolve to `'system'` instead of `'apikey:xxx'` — would mean ALS write didn't propagate; investigate fiber.

### Pitfall 7: DEFERRED-17-A `fastify-zod-openapi` v5 `required` Bug in auth-plugin.test.ts

**What goes wrong:** Phase 17 documented that `fastify-zod-openapi` v5.6.1 emits `required` as `[…]` array (correct OpenAPI 3.1) but the validator-compiler rejects request bodies that previously validated. `auth-plugin.test.ts` is one of 3 affected files.

**Phase 26 options:**
- **Resolve:** Upgrade to v6 — **NOT POSSIBLE** as of 2026-05-08. v6 is not released (release page shows v5.6.1 latest, dated March 2026).
- **Workaround:** Swap to `@fastify/zod` (different lib) — requires touching every route schema; out of scope.
- **Defer:** Carry forward DEFERRED-17-A; rename `auth-plugin.test.ts → .spec.ts` and either fix the test cases or keep them excluded.

**Recommended:** **DEFER**. Plan 26-05 documents the continuation in the new `26-deferred-items.md`; auth-plugin.test.ts likely renames and gets its DEFERRED-17-A failure mode REMOVED organically because the rewrite under Plan 26-03 changes the route schemas (POST already Zod-OpenAPI; GET + DELETE get added; the bug specifically affects POST schemas with `required` arrays). If after the rewrite the file passes, DEFERRED-17-A's footprint shrinks to 2 files (api/routes.test.ts + artifacts/artifact-routes.test.ts).

**Warning signs:** Plan 26-04 DB-gated subscriber.spec passes but Plan 26-05 Nyquist gate fails with auth-plugin.spec.ts errors. Catalog explicitly.

### Pitfall 8: events.actor Column Already Exists — Do NOT Migrate

**What goes wrong:** Phase 15 Plan 15-01 already created the `events.actor TEXT` column (verified via `server/db/schema.ts` events table — TRACE-07 satisfied). A Phase 26 plan that ALSO migrates this column would conflict.

**How to avoid:** The Drizzle migration in Phase 26 ONLY adds `apiKeys.claims`. It does NOT touch `events`. Verify by reviewing `server/db/schema.ts` events table before drafting the migration.

---

## Code Examples

### §1 — Extend `validateKey` to return the matched row (Plan 26-03)

**Source:** Refactor of `server/auth/auth-service.ts:32-64`. Adds new method; keeps `validateKey` for back-compat.

```typescript
// server/auth/internal/auth-service.ts (post-rewrite)
export interface MatchedApiKey {
  id: string;
  name: string;
  claims: Record<string, unknown>;
}

export class AuthService {
  // ... existing constructor + generateKey unchanged ...

  /**
   * Validates a raw key and returns the matched row (id, name, claims) or null.
   * Phase 26 — extends Phase 15 validateKey signature for actor stamping (TRACE-10)
   * + admin-claim gating (DEFERRED-23-A).
   */
  async validateKeyAndReturnRow(rawKey: string): Promise<MatchedApiKey | null> {
    const prefix = rawKey.substring(0, 8);
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, prefix));
    for (const row of rows) {
      if (row.revoked) continue;
      if (row.expiresAt && row.expiresAt < new Date()) continue;
      const computed = scryptSync(rawKey, row.keySalt, HASH_LEN);
      const stored = Buffer.from(row.keyHash, 'hex');
      if (computed.length === stored.length && timingSafeEqual(computed, stored)) {
        // Fire-and-forget lastUsedAt update.
        this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
          .then(() => {}).catch(() => {});
        return {
          id: row.id,
          name: row.name,
          claims: (row.claims as Record<string, unknown>) ?? {},
        };
      }
    }
    return null;
  }

  /** Back-compat — keep boolean shape for any consumer that doesn't need the row. */
  async validateKey(rawKey: string): Promise<boolean> {
    return (await this.validateKeyAndReturnRow(rawKey)) !== null;
  }
}
```

### §2 — Auth gate stamps ALS + request (Plan 26-03)

**Source:** Refactor of `server/auth/auth-plugin.ts:22-35` plus reference to `@fastify/bearer-auth` v10 `(key, req)` callback signature.

```typescript
// server/auth/plugin.ts (thin wirer post-rewrite)
import fp from 'fastify-plugin';
import bearerAuth from '@fastify/bearer-auth';
import { asyncLocalStorage } from '@fastify/request-context';
import { createAuthModule } from './internal/module.js';
import { asApiKeyActor } from './internal/actor.js';
import type { MatchedApiKey } from './internal/auth-service.js';

declare module 'fastify' {
  interface FastifyInstance { authModule: ReturnType<typeof createAuthModule>; }
  interface FastifyRequest { apiKey?: MatchedApiKey; }
}

export default fp(
  async (fastify) => {
    const authModule = createAuthModule({
      db: fastify.db,
      bus: fastify.bus,
      logger: fastify.log,
    });
    fastify.decorate('authModule', authModule);
    fastify.decorate('authService', authModule.authService);  // back-compat

    if (fastify.config.auth.enabled) {
      await fastify.register(bearerAuth, {
        keys: new Set<string>(),
        addHook: false,
        auth: async (key, req) => {
          const matched = await authModule.authService.validateKeyAndReturnRow(key);
          if (!matched) return false;
          // Decorate THIS request (not all requests via decorateRequest — see Pitfall 1).
          (req as { apiKey?: MatchedApiKey }).apiKey = matched;
          // Write actor into ALS so deep emits (no req access) resolve correctly.
          const store = asyncLocalStorage.getStore();
          if (store && !(store instanceof Map)) {
            (store as Record<string, unknown>).actor = asApiKeyActor(matched.id);
          } else if (store instanceof Map) {
            store.set('actor', asApiKeyActor(matched.id));
          }
          return true;
        },
        errorResponse: (err) => ({ error: err.message || 'Unauthorized' }),
        contentType: 'application/problem+json',
      });
    }
  },
  { name: 'auth', dependencies: ['config', 'db', 'event-bus'] },
);
```

### §3 — Wrap boot-time onReady in als.run (Plan 26-02)

**Source:** Refactor of `server/index.ts:151-208`.

```typescript
// server/index.ts onReady (post-Plan 26-02)
import { randomUUID } from 'node:crypto';
import { asyncLocalStorage } from '@fastify/request-context';

app.addHook('onReady', async () => {
  if (process.env.NODE_ENV === 'contracts') {
    app.log.info('NODE_ENV=contracts — skipping initPool / device.booted hooks');
    return;
  }

  // Phase 26 / TRACE-10: stamp `actor:'system'` on every event emitted during boot.
  // The fresh correlationId scopes a "boot session" trace tree.
  await asyncLocalStorage.run(
    { correlationId: randomUUID(), actor: 'system' } as never,
    async () => {
      app.log.info('Starting device farm initialization...');
      await app.pool.initPool();
      // ... existing onReady body unchanged (fires hooks, syncs DB) ...
    }
  );
});
```

### §4 — events.ts shape (Plan 26-01)

**Source:** Mirrors `server/maestro/events.ts` (2-event registry) verbatim shape.

```typescript
// server/auth/events.ts
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import { TypedBus } from '../bus/bus.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
export const AUTH_AGGREGATE_ID = uuidv5('auth', URL_NAMESPACE);

export const AUTH_EVENT_NAMES = {
  KEY_CREATED: 'auth.key.created',
  KEY_REVOKED: 'auth.key.revoked',
} as const;

export const authKeyCreatedPayload = z.object({
  keyId: z.string().uuid(),
  keyName: z.string(),
  prefix: z.string(),
  createdBy: z.string(),  // actor string (e.g. 'apikey:xxx' or 'system')
});

export const authKeyRevokedPayload = z.object({
  keyId: z.string().uuid(),
  keyName: z.string(),
  revokedBy: z.string(),  // actor string
  revocationReason: z.string().optional(),
});

export const authRegistry = {
  'auth.key.created': { schema: authKeyCreatedPayload, persisted: true, aggregateType: 'auth' },
  'auth.key.revoked': { schema: authKeyRevokedPayload, persisted: true, aggregateType: 'auth' },
} as const;

export type AuthRegistry = typeof authRegistry;
export type AuthEventName = typeof AUTH_EVENT_NAMES[keyof typeof AUTH_EVENT_NAMES];

export function makeAuthEmitters(
  bus: TypedBus<AuthRegistry>,
  persistEnvelope: (env: import('../events/envelope.js').Envelope) => void,
) {
  // mirrors makeMaestroEmitters shape — see server/maestro/events.ts
  return {
    keyCreated: (apiKeyId: string, payload: z.infer<typeof authKeyCreatedPayload>) =>
      /* createEventHelpers wired with onEmit:persistEnvelope */ undefined as never,
    keyRevoked: (apiKeyId: string, payload: z.infer<typeof authKeyRevokedPayload>) =>
      undefined as never,
  };
}
```

### §5 — Zod on GET /admin/keys + DELETE /admin/keys/:id (Plan 26-03)

**Source:** Extend pattern from `key-routes.ts:33-50` (POST already done in Plan 17-01).

```typescript
// server/auth/internal/key-routes.ts (post-rewrite)
const apiKeyListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revoked: z.boolean(),
}).meta({ id: 'ApiKeyListItem' });

const apiKeyListResponseSchema = z.array(apiKeyListItemSchema).meta({ id: 'ApiKeyListResponse' });

const apiKeyRevokeParamsSchema = z.object({ id: z.string().uuid() }).meta({ id: 'ApiKeyRevokeParams' });

// GET /admin/keys
fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'GET',
  url: '/admin/keys',
  schema: { response: { 200: apiKeyListResponseSchema } } satisfies FastifyZodOpenApiSchema,
  handler: async () => fastify.authService.listKeys(),
});

// DELETE /admin/keys/:id
fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'DELETE',
  url: '/admin/keys/:id',
  schema: {
    params: apiKeyRevokeParamsSchema,
    response: { 204: z.void() },
  } satisfies FastifyZodOpenApiSchema,
  handler: async (request, reply) => {
    const actor = readAls('actor') ?? 'system';
    const row = await fastify.authService.revokeKeyAndReturnRow(request.params.id);
    if (!row) return reply.status(404).send({ /* RFC 7807 */ });
    fastify.authModule.emit.keyRevoked(row.id, {
      keyId: row.id,
      keyName: row.name,
      revokedBy: actor,
    });
    return reply.status(204).send();
  },
});
```

### §6 — `requireAdmin` preHandler middleware (Plan 26-03)

**Source:** New file. Mirrors `requireAuth` pattern in `server/jobs/internal/routes.ts:87-104`.

```typescript
// server/auth/internal/require-admin.ts
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Phase 26 — Resolves DEFERRED-23-A. Asserts the matched apiKey carries
 * `claims.admin === true`. Use as a Fastify preHandler:
 *
 *   fastify.route({ ..., preHandler: [requireAuth, requireAdmin], ... });
 *
 * Depends on `request.apiKey` being decorated by the auth gate (server/auth/plugin.ts).
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = (req as { apiKey?: { claims?: Record<string, unknown> } }).apiKey;
  if (apiKey?.claims?.admin !== true) {
    reply.code(403).send({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'admin claim required',
    });
  }
}
```

### §7 — `apiKeys.claims` Drizzle migration (Plan 26-00)

**Source:** Mirrors Phase 23 `system_state` migration shape (`server/db/migrations/`).

```typescript
// server/db/schema.ts diff
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  keySalt: varchar('key_salt', { length: 64 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  // NEW Phase 26:
  claims: jsonb('claims').notNull().default(sql`'{}'::jsonb`),
});
```

```sql
-- server/db/migrations/0026_api_keys_claims.sql
ALTER TABLE api_keys ADD COLUMN claims JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Defensive: existing rows would have got DEFAULT '{}' on ALTER, but explicit
-- update guards against any pg quirk + makes intent grep-greppable.
UPDATE api_keys SET claims = '{}'::jsonb WHERE claims IS NULL;
```

### §8 — Gate `/admin/drain` on requireAdmin (Plan 26-03 — DEFERRED-23-A resolution)

**Source:** Edit `server/jobs/internal/routes.ts:106-110` and 185-190.

```typescript
// server/jobs/internal/routes.ts (post-edit)
import { requireAdmin } from '../../auth/index.js';   // via barrel — MOD-02 compliant

fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'POST',
  url: '/admin/drain',
  // Phase 26 resolves DEFERRED-23-A: chain requireAuth + requireAdmin.
  preHandler: [requireAuth as never, requireAdmin as never],
  schema: { /* unchanged */ } satisfies FastifyZodOpenApiSchema,
  handler: async (req, reply) => { /* unchanged */ },
});
// Same edit on /admin/drain/resume.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `validateKey(key) → boolean` (no row capture) | `validateKeyAndReturnRow(key) → MatchedApiKey \| null` (Phase 26) | Plan 26-03 | Auth gate gains key id + claims for ALS stamping + admin gating |
| `actor` defaults to `'anonymous'` (`bus/helpers.ts:94`) | `actor` defaults to `'system'` | Plan 26-02 | TRACE-10 contract; aligns boot/cron/no-context default with semantic intent |
| `auth.key.created/revoked` events not published | Both events published; both persisted | Plan 26-01 | Audit trail for security operations; consumed by Phase 27 trace endpoint |
| `apiKeys.claims` column does not exist | `claims JSONB DEFAULT '{}'` | Plan 26-00 (migration) + Plan 26-03 (route) | Admin gating lands; DEFERRED-23-A resolved |
| `/admin/drain` gated on any-valid-key | `/admin/drain` gated on `requireAdmin` (claims.admin === true) | Plan 26-03 | DEFERRED-23-A resolved; security posture improved (any leaked key no longer triggers production drain) |
| Auth module uses old `auth-service.ts + auth-plugin.ts + key-routes.ts` flat layout (no MODULE.md, no barrel, no internal/) | Canonical Phase 16 shape (MODULE.md + barrel + events.ts + internal/) | Plan 26-03 + 26-05 | LLM-readable; dep-cruiser enforces |

**Deprecated/outdated:**
- Returning `boolean` from `validateKey` — kept for back-compat in 26-03 but downstream Phase 27+ may drop it once no callers remain (only `auth-plugin.ts` calls it today, which is rewritten).
- `actor:'anonymous'` literal — actively prohibited by `actorSchema` regex (does NOT include `anonymous`). Any persisted event emitted before Phase 26 with `actor:'anonymous'` is grandfathered (column is TEXT, no FK); Phase 26's regex applies to NEW emits only.

---

## Validation Architecture

**Nyquist validation is ENABLED** (`.planning/config.json` `workflow.nyquist_validation: true`). This section is MANDATORY.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.x (already installed) |
| Config file | `vitest.config.ts` + `vitest.coverage.config.ts` (repo root) |
| Quick run command | `npx vitest run server/auth/__tests__/` |
| Full suite command | `npm test` |
| Coverage command | `npm run coverage` |
| Nyquist check | `npm run nyquist:check` (compares to `.planning/nyquist-baseline.json`; exits 1 if delta < −2pp) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACE-10 (apikey actor) | HTTP request with valid Bearer key emits event with `actor:'apikey:{id}'` | DB-gated integration | `npx vitest run server/auth/__tests__/als-actor.spec.ts -t "apikey actor"` | ❌ Wave 0 (new file) |
| TRACE-10 (system actor) | Boot-time emit during onReady carries `actor:'system'` | DB-gated integration | `npx vitest run server/auth/__tests__/als-actor.spec.ts -t "system actor"` | ❌ Wave 0 |
| TRACE-10 (cron actor) | pg-boss scheduled fire emits event with `actor:'cron'` | DB-gated integration | `npx vitest run server/auth/__tests__/als-actor.spec.ts -t "cron actor"` | ❌ Wave 0 (likely subscribes to existing lifecycle.* test pattern) |
| SC1 (auth.key.created emit) | POST /admin/keys emits `auth.key.created` to bus + persists event row | DB-gated integration | `npx vitest run server/auth/__tests__/subscriber.spec.ts -t "auth.key.created"` | ❌ Wave 0 |
| SC1 (auth.key.revoked emit) | DELETE /admin/keys/:id emits `auth.key.revoked` + persists | DB-gated integration | `npx vitest run server/auth/__tests__/subscriber.spec.ts -t "auth.key.revoked"` | ❌ Wave 0 |
| SC1 (Zod request) | POST /admin/keys with malformed body returns 400 | unit (no DB) | `npx vitest run server/auth/__tests__/contract.spec.ts -t "POST malformed"` | ❌ Wave 0 |
| SC1 (Zod response) | GET /admin/keys returns array matching `apiKeyListResponseSchema` | unit (no DB) | `npx vitest run server/auth/__tests__/contract.spec.ts -t "GET response shape"` | ❌ Wave 0 |
| DEFERRED-23-A (admin gate) | POST /admin/drain returns 403 with non-admin key | DB-gated integration | `npx vitest run server/auth/__tests__/admin-claim.spec.ts -t "drain forbidden without claim"` | ❌ Wave 0 |
| DEFERRED-23-A (admin allow) | POST /admin/drain returns 200 with admin claim | DB-gated integration | `npx vitest run server/auth/__tests__/admin-claim.spec.ts -t "drain allowed with claim"` | ❌ Wave 0 |
| MOD-01 (MODULE.md) | 9 H2 sections + Runnable Example | filesystem | `grep -c '^## ' server/auth/MODULE.md` (≥9) | ❌ Wave 5 (new file) |
| MOD-02 (barrel) | `server/auth/index.ts` exists with strict 1-line internal re-export | filesystem | `wc -l server/auth/index.ts` (≤3 lines incl. comment) | ❌ Wave 0 |
| MOD-02 (dep-cruiser) | Deep import into `server/auth/internal/` from outside fails CI | unit | `npm run dep-check` (fixture in 26-00) | ❌ Wave 0 |
| MOD-04 (.spec rename) | `auth-plugin.spec.ts`, `auth-service.spec.ts` exist (not .test.ts) | filesystem | `test -f server/auth/__tests__/auth-plugin.spec.ts && test -f server/auth/__tests__/auth-service.spec.ts` | ❌ Wave 5 (rename via git mv) |
| MOD-08 (invariants tests) | 1 test per Invariant in MODULE.md | unit | `npx vitest run server/auth/__tests__/module.spec.ts -t "Invariant"` (count) | ❌ Wave 0 |
| Plugin order | auth before websocket-plugin in printPlugins() | DB-gated | `npx vitest run server/__tests__/plugin-order.spec.ts -t "Phase 26"` | ✅ extends existing |
| Lifecycle ownership (no plain ALS) | Zero `als.run({correlationId:` blocks without `actor:` | filesystem grep | `npx vitest run server/auth/__tests__/lifecycle-ownership.spec.ts` | ❌ Wave 0 |
| Lifecycle ownership (cron actor) | `server/queue/plugin.ts:199` literal `data.actor ?? 'cron'` exists | filesystem grep | grep-guard in lifecycle-ownership.spec | ❌ Wave 0 |
| Nyquist gate | Coverage delta ≤ −2pp vs baseline | coverage | `npm run nyquist:check` | ✅ existing |

### Sampling Rate

- **Per task commit:** `npx vitest run server/auth/__tests__/` (fast — most are mock-based; DB-gated subset gated on `TEST_DATABASE_URL`).
- **Per wave merge:** `npm test` (full suite; respects DEFERRED-17-A exclusions).
- **Phase gate:** `npm run nyquist:check` green before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `server/auth/MODULE.md` — placeholder Wave 0; body Wave 5.
- [ ] `server/auth/index.ts` — strict barrel.
- [ ] `server/auth/events.ts` — placeholder Wave 0; body Wave 1.
- [ ] `server/auth/internal/module.ts` — throw-stub Wave 0; body Wave 3.
- [ ] `server/auth/internal/actor.ts` — actorSchema body Wave 1.
- [ ] `server/auth/internal/require-admin.ts` — body Wave 3.
- [ ] `server/db/migrations/0026_api_keys_claims.sql` — Wave 0.
- [ ] `server/auth/__tests__/events.spec.ts` — stub Wave 0; body Wave 1.
- [ ] `server/auth/__tests__/module.spec.ts` — Wave 3 (factory shape).
- [ ] `server/auth/__tests__/subscriber.spec.ts` — Wave 4 (DB-gated).
- [ ] `server/auth/__tests__/contract.spec.ts` — Wave 4 (Zod parse).
- [ ] `server/auth/__tests__/admin-claim.spec.ts` — Wave 4 (DB-gated).
- [ ] `server/auth/__tests__/als-actor.spec.ts` — Wave 4 (DB-gated; 4 actor sources).
- [ ] `server/auth/__tests__/lifecycle-ownership.spec.ts` — Wave 4 (grep-guards).
- [ ] `.dependency-cruiser.cjs` — 10th rule append Wave 0.
- [ ] `server/__tests__/plugin-order.spec.ts` — Phase 26 additive block Wave 5.
- [ ] `server/__tests__/_fixtures/auth-deep-import-fixture.ts` — dep-cruiser fixture Wave 0.
- [ ] `server/auth/__tests__/auth-plugin.test.ts` → `.spec.ts` rename — Wave 5 (`git mv`).
- [ ] `server/auth/__tests__/auth-service.test.ts` → `.spec.ts` rename — Wave 5 (`git mv`).

---

## Open Questions

1. **DEFERRED-17-A `fastify-zod-openapi` v6 status — resolve or carry forward?**
   - What we know: v5.6.1 is the latest released (March 2026); no v6 announcement on GitHub releases page.
   - What's unclear: Does v6 have an RC / beta tag we missed? Is the workaround documented in the issue tracker stable enough to apply?
   - Recommendation: **CARRY FORWARD as DEFERRED-26-E**. Plan 26-03 attempts a v5.6.1 → patched-fork or workaround; if no solid fix exists, document in deferred-items.md and re-target Phase 27+ (when the API aggregator phase has space to swap libraries holistically). The 3 inherited test files become 2 if the rewrite under 26-03 organically removes auth-plugin.test.ts from the failure set.

2. **Phase 27 events trace endpoint dependency on `auth.key.*` events**
   - What we know: SC3 says Phase 27's `GET /api/events?correlationId=…` must show meaningful actor values for auth → job flows.
   - What's unclear: Does Phase 27 need any specific projection beyond `actor` being correctly populated on the events row? (Probably not — column is on the table; trace endpoint just queries.)
   - Recommendation: Phase 26 lays the substrate; Phase 27 owns the endpoint. No cross-coordination needed beyond keeping `actor` column shape stable (TEXT, regex per actorSchema).

3. **Should `requireAdmin` middleware be in `server/auth/index.ts` barrel or `server/auth/internal/require-admin.ts`?**
   - Recommendation: Export from BARREL via `server/auth/index.ts` because cross-module consumers (jobs, future api aggregator) need it. Keep IMPLEMENTATION in `internal/` (dep-cruiser hides it). 1-line `export { requireAdmin } from './internal/require-admin.js';` is the canonical surface.

4. **Should the `validateKey` boolean back-compat shim be deleted?**
   - What we know: Only `auth-plugin.ts` calls `validateKey` today; that file is rewritten in 26-03.
   - Recommendation: KEEP the shim (1-line wrapper around `validateKeyAndReturnRow`). Cost is trivial; removing creates a breaking change for any test code that still references it. Phase 30 owns full deprecation if needed.

5. **POST /api/keys/:id/claims/admin route — exact shape?**
   - Recommendation: Mirror Phase 23 drain endpoint shape — Zod-validated body `{admin: boolean}`, 200 response `{success: true, claims: {...}}`, gated on `requireAdmin` (so only existing admins can grant new admin). This bootstraps via direct DB seed (the FIRST admin claim is set via SQL/migration or a one-shot script) — DEFERRED-26-A documents the full Go CLI path in Phase 28.

---

## Sources

### Primary (HIGH confidence — read directly)

- `server/auth/auth-service.ts` (4.0KB) — current AuthService class.
- `server/auth/auth-plugin.ts` (1.2KB) — current Fastify plugin shape.
- `server/auth/key-routes.ts` (2.1KB) — current 3 routes (POST already Zod via Plan 17-01).
- `server/auth/__tests__/auth-plugin.test.ts` (5.9K) — DEFERRED-17-A inheritance test file.
- `server/bus/helpers.ts:65-114` — `readAls` dual-shape + `createEventHelpers` actor fallback (line 94).
- `server/queue/plugin.ts:159-228` — `queue.send/work/schedule` ALS + actor stamping (verified `'cron'` literal at line 222 + `data.actor ?? 'cron'` fallback at line 199).
- `server/index.ts:151-208` — boot-time onReady block to wrap.
- `server/db/schema.ts:132-141` — `apiKeys` table (no `claims` column today).
- `server/jobs/internal/routes.ts:74-220` — `/admin/drain` + `requireAuth` shape + DEFERRED-23-A TODO comments.
- `server/maestro/internal/module.ts:64-110` — `persistEnvelope` 8th sample point reference.
- `server/pipelines/internal/module.ts:88-110` — 9th sample point reference.
- `.dependency-cruiser.cjs` rules 1-9 — verbatim mirror template for rule 10.
- `server/__tests__/plugin-order.spec.ts` — additive extension template.
- `server/pipelines/__tests__/lifecycle-ownership.spec.ts` — grep-guard pattern template.
- `.planning/REQUIREMENTS.md:71` — TRACE-10 spec text.
- `.planning/ROADMAP.md:273-282` — Phase 26 success criteria.
- `.planning/phases/22-streaming-module/deferred-items.md` — DEFERRED-22-D / DEFERRED-17-A inheritance.
- `.planning/phases/23-jobs-module-keystone/deferred-items.md` — DEFERRED-23-A admin claim spec.
- `.planning/phases/25-pipelines-module/deferred-items.md` — DEFERRED-25-A 9th-sample-point context for Phase 26 becoming 10TH.
- `.planning/phases/26-auth-module/26-CONTEXT.md` — locked decisions copied verbatim into User Constraints.
- `package.json` — `fastify-zod-openapi: ^5.6.1` + `@fastify/bearer-auth: ^10.1.2` + `@fastify/request-context: ^6.2.1`.
- `server/auth/key-routes.ts:33-50` — Plan 17-01's POST route Zod template.

### Secondary (MEDIUM confidence — verified WebFetch + GitHub README)

- [@fastify/bearer-auth v10 README](https://github.com/fastify/fastify-bearer-auth) — `auth: (key, req) => Promise<boolean>` callback signature; `addHook:false` mode for selective application; `req` mutation as documented pattern for stashing matched-key context.
- [Fastify Encapsulation docs](https://fastify.dev/docs/latest/Reference/Encapsulation/) — request decoration scoping per encapsulation context.
- [fastify-zod-openapi releases](https://github.com/samchungy/fastify-zod-openapi/releases) — confirms v5.6.1 is the latest released version (no v6); informs DEFERRED-17-A continued deferral.
- [Fastify help issue #10](https://github.com/fastify/help/issues/10) — confirms `decorateRequest` shares prototype across requests; inline mutation is the correct per-request pattern (informs Pitfall 1).

### Tertiary (LOW confidence — flagged for validation)

- WebSearch results on "fastify-zod-openapi v6 release 2026 required emission bug" — no specific bug-fix release found; informs Open Question 1 (carry forward DEFERRED-17-A).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep is already installed at the precise version cited; reading `node_modules/fastify-zod-openapi/package.json` directly confirmed v5.6.1.
- Architecture: HIGH — Phase 16-25 templates verbatim for module shape; Phase 23 keystone provides `/admin/drain` precedent; Phase 18 lifecycle provides cron actor precedent.
- Pitfalls: HIGH for Pitfalls 1-6, 8 (read directly from source). MEDIUM for Pitfall 7 (DEFERRED-17-A v6 status — relies on GitHub release page, dated March 2026; new v6 could land between research date and plan execution but unlikely given 5.6.1 was the most recent).
- ALS context flow: HIGH — read `server/bus/helpers.ts` + `server/queue/plugin.ts` + `server/index.ts` directly; verified actor stamping already exists at 3 of 4 entry points (cron, send, helpers fallback); only HTTP auth-gate stamp is genuinely new.

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (30 days — Phase 26 substrate is stable; no fast-moving deps).
