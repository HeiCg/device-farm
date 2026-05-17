# Phase 17: Contracts Pipeline & Ops Hygiene — Research

**Researched:** 2026-04-17
**Domain:** OpenAPI 3.1 codegen pipeline (Zod → spec → Go + TS), vendored npm tarballs, Fastify plugin-dependency graph normalization
**Confidence:** HIGH (library choices + Fastify internals verified against node_modules source and official docs) / MEDIUM (Go generator decision — three candidates; recommendation justified but upstream 3.1 support is in flux) / HIGH (plugin rename mechanics — verified by grep against actual repo)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Codegen Pipeline**
- Shared output directory: `contracts/` at repo root (sub-dirs `openapi/`, `ws-messages/`, reserved `generated/` for future); already exists with `client/config/output/streaming/` subtree — extend, do not relocate
- Generator: dedicated `server/scripts/build-openapi.ts` script — loads Fastify with all plugins, calls the `fastify-zod-openapi` export, serializes to `server/openapi.json`, then invokes `zod-to-json-schema` on the WS envelope registry to emit `contracts/ws-messages.json`, exits cleanly. Decoupled from runtime — does NOT run on every server boot
- CI gate: `npm run contracts:check` = `npm run openapi:generate && git diff --exit-code server/openapi.json contracts/` wired into existing GitHub Actions lint/test job; failing diff blocks merge
- Coverage: one Zod-validated route per existing module (MINIMUM) — Phase 16 hooks already satisfies; this phase adds one representative route per module that currently declares routes (jobs, devices/pool, artifacts, reporting, pipelines, auth/api-key). Full per-route coverage is per-module scope (Phase 20-27)

**WebSocket Schemas + Go Union Mapping**
- Discriminator field: `type` (string literal) — matches existing server envelope + Phase 15's event envelope convention; no rename
- Schema source: per-module `ws-schemas.ts` colocated in each module (jobs, pool, artifacts, streaming) — mirrors the events.ts pattern; aggregator `contracts/ws-messages.ts` re-exports them so codegen has one entry point. Build script converts via `zod-to-json-schema@3.x`
- Go mapping: hand-rolled `cli/internal/types/unions.go` with `UnmarshalJSON` per discriminator variant — go-jsonschema output is consumed for flat types but unions get the manual treatment (documented in ADR-003, committed this phase)
- Round-trip tests: dual — TS test under `server/websocket/__tests__/frames.spec.ts` parses canonical samples with the per-module Zod schemas; Go test `cli/internal/types/generated_test.go` decodes the same fixtures into strongly-typed structs. Fixtures live under `contracts/ws-fixtures/` so both test lanes read identical JSON

**@device-stream Distribution**
- Vendored tarballs under `vendor/device-stream/` (`core-X.Y.Z.tgz`, `android-X.Y.Z.tgz`, `ios-simulator-X.Y.Z.tgz`); package.json installs via `"@device-stream/core": "file:./vendor/device-stream/core-X.Y.Z.tgz"` — fresh clone + `npm install` succeeds with no sibling repo
- `installSimCapture` points at the vendored path; add an integration test that runs `installSimCapture` against a clean `node_modules` and asserts the macOS capture daemon is registered
- Reversible: future migration to GitHub Packages / private npm registry is a package.json diff — tarballs are the temporary pinning mechanism, not the long-term target

**Plugin Naming Normalization**
- Target convention: **bare names, NO `-plugin` suffix**. Phase 15 substrate already uses bare names (`event-bus`, `queue`, `correlation`, `telemetry`). Phase 17 renames the legacy plugins:
  - `pool-plugin` → `pool`
  - `job-plugin` → `jobs`
  - `websocket-plugin` → `websocket`
  - `artifact-plugin` → `artifacts`
  - `reporting` (already bare — no change)
  - `auth` (already bare — no change)
  - `lifecycle-plugin` → `lifecycle`
  - `hooks-plugin` → `hooks`
  - `maestro-plugin` → `maestro`
  - `pipelines-plugin` → `pipelines`
  - `api` (already bare — no change)
  - `static-plugin` → `static` (current name is `static-spa`)
- Migration strategy: single atomic commit per plugin (rename `name:` field + every `dependencies:` reference + every test assertion in one go). Order: leaf plugins first (static, reporting), then mid-tier (maestro, hooks, pipelines, lifecycle, artifacts), then keystone (jobs, pool, websocket, api)
- Fastify `dependencies` arrays across every plugin file must be updated in lockstep — a dangling reference blocks boot. The plugin-order invariant spec (Phase 15 Plan 15-06, `server/__tests__/plugin-order.spec.ts`) asserts via `app.printPlugins()` introspection; this must pass after each rename commit

**Ops Hygiene — Specific Items from Success Criteria**
- `pipelines` dep array changes from `['db-plugin', 'websocket-plugin', 'jobs-plugin']` → `['db', 'websocket', 'jobs']` (the `db-plugin`/`websocket-plugin`/`jobs-plugin` strings don't resolve today — confirmed by grep — they were carried over from an older naming scheme. Current boot may silently succeed because Fastify dep resolution is lenient until a plugin invokes a missing decorator; these phantom deps are removed with the rename)
- `websocket` declares `pool` as a new dep (currently does not — WS server reads device state for preview broadcasts)
- `lifecycle` / `api` dep graph: `lifecycle` declares `api` if it reads `api-plugin` decorators, OR `api` declares `lifecycle` if the direction is reversed — planner confirms by grep of decorator usage before writing the rename commit

### Claude's Discretion
- Exact order of `server/scripts/build-openapi.ts` emit phases (OpenAPI first vs WS first)
- ADR-003 (Go union mapping pattern) prose tone and examples
- `contracts/ws-fixtures/` naming convention for individual fixture files
- Whether to generate a `contracts/schemas/package.json` workspace entry now (for future npm workspace) or defer to Phase 29

### Deferred Ideas (OUT OF SCOPE)
- Per-route full Zod coverage on every endpoint — deferred to per-module phases (20-27)
- `fastify-zod-openapi` OpenAPI Security schemes (bearer auth) — lands with Phase 26 (Auth Module)
- Migration to published private npm registry for `@device-stream/*` — reversible from the vendored tarball approach; not in scope this phase
- npm workspace for a shared `@devicefarm/contracts` package — possible Phase 29 scope if web+cli both benefit
- Full WebSocket-protocol versioning via `v:` field on envelope — already carried by events envelope (Phase 15); extending to WS frames is Phase 22
- Discriminator-typed error envelopes (RFC 7807 + problem+json) — already in place; documenting in OpenAPI error responses is partial coverage this phase, full coverage in Phase 26
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPEC-06 | `fastify-zod-openapi` installed, emits OpenAPI 3.1 to `server/openapi.json` | §1 Standard Stack (plugin registration), §2 build-openapi.ts shape, §5 one-route-per-module upgrade pattern |
| SPEC-07 | WS protocol JSON Schema emitted for CLI+web consumption | §3 Zod 4 `z.toJSONSchema()` native path, §4 Go discriminated-union shim, §6 dual round-trip harness |
| CLI-01 | Pipeline: Zod → OpenAPI 3.1 → extract `components.schemas` → Go → `cli/internal/types/generated.go` | §4 Go generator decision: go-jsonschema via jq-extracted components; Makefile target shape |
| CLI-02 | `make types` regenerates and fails if diff uncommitted; CI enforces | §7 `contracts:check` script shape; `git diff --exit-code` exit-code handling |
| CLI-03 | Discriminated unions documented in `cli/internal/types/unions.go` (hand-rolled) | §4 go-jsonschema oneOf weakness; §6 Go UnmarshalJSON skeleton; ADR-003 shape |
| WEB-01 | `openapi-typescript` generates `web/src/lib/api/generated-types.ts` from same spec | §8 openapi-typescript 7.x CLI usage, `web:types` npm script pattern |
| DEBT-01 | Operational deps cleaned (plugin names, `file:../device-stream` removed, installSimCapture independent of sibling repo) | §9 plugin rename mechanics (verbatim grep), §10 `websocket→pool` verification, §11 lifecycle/api direction, §12 tarball vendoring, §13 installSimCapture rewrite |
</phase_requirements>

---

## Summary

Phase 17 is a well-scoped plumbing phase: wire a deterministic codegen pipeline from Zod schemas (already the source of truth per Phase 16 SPEC-01/02/03) to both the Go CLI and SvelteKit web client, then clean the v2.0 operational debt (sibling-repo npm refs, stale plugin names) that would otherwise block later modules.

The locked stack is **`fastify-zod-openapi` v4** (built on `samchungy/zod-openapi`; outputs OpenAPI 3.1 natively) + **`@fastify/swagger` v9.7+** (decorates `fastify.swagger()` to return the OpenAPI JSON) + **Zod 4's built-in `z.toJSONSchema()`** (ships in zod ^4.3 — already a dep — so the CONTEXT's `zod-to-json-schema@3.x` mention can be reduced to the native call path) + **`openapi-typescript@7.x`** for the web-side TS types + **`omissis/go-jsonschema`** (feeds on a pre-extracted `components.schemas` JSON block because it does NOT consume OpenAPI files directly, only raw JSON Schema). The Go discriminated-union types stay hand-rolled in `cli/internal/types/unions.go` per CONTEXT — go-jsonschema does not emit idiomatic Go `oneOf` unions.

The plugin rename is a mechanical edit across ~12 files (8 `name:` fields + every `dependencies:` array referencing the old names + one `.spec.ts` fixture + one comment in `device-preview.ts`). Fastify's dep-check is **silent for non-encapsulated plugins** (verified by reading `node_modules/fastify-plugin/plugin.js` line 45: `skip-override` is only set when `encapsulate !== true`; the test at `fastify-plugin/test/test.js:292-303` only asserts dep-missing errors when `encapsulate: true`) — this is why `pipelines` boots today with `['db-plugin', 'websocket-plugin', 'jobs-plugin']` as phantom deps.

**Primary recommendation:** Land contract pipeline as Wave 1, plugin rename as Wave 2 (atomic commit per plugin), vendored tarballs as Wave 3 (isolated change), and wire the CI drift check last (Wave 4) so earlier waves don't trip it.

---

## Standard Stack

### Core (SERVER side — TypeScript/Fastify)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastify-zod-openapi` | ^4.x (latest 4.x on npm Apr 2026) | Fastify type provider + @fastify/swagger integration for Zod → OpenAPI 3.1 | Built on `samchungy/zod-openapi` (v5.4.6); OpenAPI 3.1 native; maintained; accepts Zod 4 via `import * as z from 'zod'`. Peer deps: `fastify ^5`, `zod ^4.0`, `@fastify/swagger ^9`. |
| `@fastify/swagger` | ^9.7.0 | Decorates `fastify.swagger()` returning the OpenAPI JSON object; integration point for `fastify-zod-openapi` | Requires Fastify ^5 (we have 5.8.2). v9 family is the Fastify-5 line. |
| `zod` | ^4.3.6 (already installed) | Zod 4.3 adds `.encode()`/`.decode()` APIs that `fastify-zod-openapi` uses for response serialization | Already in package.json; `z.toJSONSchema()` is native (no `zod-to-json-schema` dep needed). |
| `openapi-typescript` | ^7.x (devDep) | Generates TS types from `server/openapi.json` into `web/src/lib/api/generated-types.ts` | CLI workflow is a one-liner: `openapi-typescript ./server/openapi.json -o web/src/lib/api/generated-types.ts`. Supports both OpenAPI 3.0 and 3.1. |
| `tsx` | ^4.21 (already installed) | Runs `server/scripts/build-openapi.ts` under NodeNext ESM without compiling | Already the convention for server dev runs. |

### Core (CLI side — Go)

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `omissis/go-jsonschema` | v0.18+ (2026) | Consumes a raw JSON Schema file (NOT OpenAPI directly) and emits Go structs with json tags | LOW-FRICTION and already a known quantity in the Phase 16 RESEARCH notes. Known limitation: does not emit idiomatic Go `oneOf` unions — that's why CLI-03 mandates hand-rolled `unions.go`. |
| `jq` | any recent | Extracts `components.schemas` from `server/openapi.json` into a standalone JSON Schema file that `go-jsonschema` can consume | Already installed on every dev Mac; `jq` is the lightest way to bridge OpenAPI 3.1 → flat JSON Schema. |

**Alternative considered: `oapi-codegen`.** Reject: "oapi-codegen currently doesn't support OAS 3.1" (confirmed from upstream comparison 2026) — it still awaits upstream `kin-openapi` support. We emit OpenAPI 3.1 per CONTEXT. Future-compatibility: if `oapi-codegen` ships 3.1 before Phase 28, we can swap.

**Alternative considered: `ogen-go/ogen`.** Reject: a GitHub discussion from late 2025 (Discussion #1410) shows OpenAPI 3.1 type-array nullables (`"type": ["string", "null"]`) trip unmarshal errors — no merged fix as of 2026. Zod 4 with `.nullable()` emits exactly that pattern into OpenAPI 3.1, so ogen would fail on our generated spec.

**Alternative considered: openapi-generator-cli (Java).** Reject: heavyweight, JVM dep, poorest Go idioms of the three; not worth the complexity for flat types only.

### Supporting (shared)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/swagger-ui` | (do NOT install) | UI for serving swagger.json via `/documentation` | OUT OF SCOPE — this phase emits a file, not an interactive endpoint. Deferred to a later developer-ergonomics phase. |
| `zod-to-json-schema` | ^3.24 (CONTEXT suggests) | External JSON-Schema emitter for Zod | DOWNGRADE RECOMMENDATION: Zod 4 ships `z.toJSONSchema()` natively — skip the external dep. CONTEXT mentions `zod-to-json-schema@3.x`; the intent was "emit JSON Schema for WS messages," which is trivially satisfied by `z.toJSONSchema(wsMessageRegistry)` without the extra dep. Flag this deviation from CONTEXT in the plan and confirm with the user if they want strict adherence. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fastify-zod-openapi` | `fastify-type-provider-zod` (turkerdev, now maintained by marcalexiei) | Both are maintained. `fastify-type-provider-zod` uses Zod's native `.encode()/.decode()` (v7+ change, output-type based on `z.output<T>`). `fastify-zod-openapi` is built on `zod-openapi` which is explicitly OpenAPI-first. For a codegen pipeline where OpenAPI fidelity is load-bearing, `fastify-zod-openapi` is the correct pick. Pick verified against CONTEXT's explicit library name. |
| Go `oapi-codegen` | `go-jsonschema` + jq extract | oapi-codegen produces Gin/Chi/Echo handlers too (unneeded here — we only want types), does not support OAS 3.1 yet. go-jsonschema is narrowly-scoped to types, which is exactly what Phase 28 (CLI refactor) needs. |
| External `zod-to-json-schema@3.x` | Native `z.toJSONSchema()` (Zod 4.3+) | Native path has zero extra deps, uses `z.globalRegistry` for multi-schema export. The library mode works but is redundant since Zod 4. |

### Installation

```bash
npm install --save fastify-zod-openapi @fastify/swagger
npm install --save-dev openapi-typescript
# Go side (install once, checked via make types):
go install github.com/atombender/go-jsonschema/cmd/go-jsonschema@latest
```

---

## Architecture Patterns

### Recommended Directory Structure (extended from current layout)

```
device-farm/
├── contracts/                       # existing dir — extend sub-dirs
│   ├── openapi/
│   │   └── openapi.json             # generated — committed
│   ├── ws-messages/
│   │   └── ws-messages.json         # generated — committed (from z.toJSONSchema)
│   ├── ws-fixtures/                 # NEW — canonical JSON samples
│   │   ├── job-log.sample.json
│   │   ├── job-step.sample.json
│   │   └── device-preview.sample.json
│   └── ws-messages.ts               # NEW — aggregator re-exporting per-module registries
├── vendor/                          # NEW
│   └── device-stream/
│       ├── core-1.1.0.tgz
│       ├── android-1.1.0.tgz
│       └── ios-simulator-1.1.0.tgz
├── server/
│   ├── scripts/
│   │   └── build-openapi.ts         # NEW — runs via tsx
│   ├── openapi.json                 # LEGACY path — consider moving to contracts/openapi/
│   ├── jobs/ws-schemas.ts           # NEW per-module WS schemas
│   ├── pool/ws-schemas.ts
│   ├── artifacts/ws-schemas.ts
│   └── streaming/ws-schemas.ts
├── cli/internal/types/
│   ├── generated.go                 # NEW — emitted by go-jsonschema
│   ├── generated_test.go            # NEW — decodes ws-fixtures/*.json
│   └── unions.go                    # NEW — hand-rolled discriminator UnmarshalJSON
├── web/src/lib/api/
│   └── generated-types.ts           # NEW — emitted by openapi-typescript
└── docs/adr/
    └── 003-go-union-mapping.md      # NEW — ADR per CONTEXT
```

**Note:** CONTEXT §Locked Decisions keeps `server/openapi.json` for the OpenAPI spec and `contracts/ws-messages.json` for WS. The divergent location is intentional (legacy + historical Fastify convention); follow CONTEXT.

### Pattern 1: `fastify-zod-openapi` Registration in `server/index.ts`

**What:** Register `fastifyZodOpenApiPlugin` BEFORE `@fastify/swagger`; the former installs Zod validator/serializer compilers on the Fastify instance, the latter adds the `fastify.swagger()` decorator that serializes the OpenAPI document.

**When to use:** Every Fastify boot — whether production OR `build-openapi.ts` script. Keep them in the same registration step.

**Canonical registration (append to `server/index.ts` after config, before other plugins that declare routes):**

```typescript
// Source: https://github.com/samchungy/fastify-zod-openapi (README 2026)
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransformers,
} from 'fastify-zod-openapi';
import fastifySwagger from '@fastify/swagger';

await app.register(configPlugin);
// ... correlation, db, bus, queue, telemetry ...
await app.register(fastifyZodOpenApiPlugin);     // installs validator + serializer
await app.register(fastifySwagger, {
  openapi: {
    openapi: '3.1.0',                             // OpenAPI 3.1 — required by SPEC-06
    info: {
      title: 'Device Farm API',
      version: '3.0.0',                           // mirrors milestone
      description: 'Self-hosted test execution platform API',
    },
    servers: [{ url: 'http://localhost:3000' }],
  },
  ...fastifyZodOpenApiTransformers,               // applies transform + transformObject
});
// ... pool, auth, websocket, artifacts, reporting, jobs, lifecycle, hooks, maestro, pipelines, api, static
```

**Placement ordering:** `fastifyZodOpenApiPlugin` must register BEFORE any plugin that declares routes with Zod schemas — otherwise the type-provider compilers aren't attached. A natural slot is RIGHT AFTER `telemetryPlugin` (position 7) and BEFORE `poolPlugin` (position 8). This preserves the substrate-first ordering invariant.

**Pitfall — dependency array updates:** The `fastify-zod-openapi` + `@fastify/swagger` pair do not need `dependencies:` declared — they are `fp()`-wrapped but used as first-class Fastify plugins, not consumers of decorators from the substrate. Any plugin that declares Zod-schema routes (hooks, api, maestro, pipelines, reporting) should add `'fastify-zod-openapi'` to its `dependencies:` array ONLY IF it wants registration-order enforcement — but since we register the type provider before every route-declaring plugin in `server/index.ts`, ordering is already deterministic. Recommend: do NOT add it as an explicit dep on every route plugin; rely on index.ts ordering.

### Pattern 2: Route Schema Upgrade — Before/After Diff for `/api/hooks`

**Reference module (Phase 16 pilot):** `server/hooks/plugin.ts` lines 70-93. The current POST route parses with `.safeParse()` and returns via `reply.send()` — no Zod on the response. Phase 17 upgrades this to `fastify-zod-openapi`'s typed provider.

**Before (current code at `server/hooks/plugin.ts:70-93`):**

```typescript
fastify.get('/api/hooks', async () => executor.getHooks());

fastify.post('/api/hooks', async (request: FastifyRequest, reply: FastifyReply) => {
  const parsed = hookDefinitionSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      type: 'https://device-farm/errors/validation',
      title: 'Validation Error',
      status: 400,
      detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
  // ...
  executor.addHook(parsed.data as HookDefinition);
  return reply.code(201).send(parsed.data);
});
```

**After (one-route-per-module Zod coverage, SPEC-06 minimum):**

```typescript
// Source: https://github.com/samchungy/fastify-zod-openapi/tree/master/examples
import { z } from 'zod';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { hookDefinitionSchema } from './schemas.js';

const hookListResponse = z.array(hookDefinitionSchema).meta({
  id: 'HookList',
  description: 'List of registered hooks',
});

fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'GET',
  url: '/api/hooks',
  schema: {
    response: { 200: hookListResponse },
  } satisfies FastifyZodOpenApiSchema,
  handler: async () => executor.getHooks(),
});

fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
  method: 'POST',
  url: '/api/hooks',
  schema: {
    body: hookDefinitionSchema,
    response: {
      201: hookDefinitionSchema.meta({ id: 'Hook' }),
      409: z.object({
        type: z.string(),
        title: z.string(),
        status: z.literal(409),
        detail: z.string(),
      }).meta({ id: 'ErrorConflict' }),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: async (request, reply) => {
    const existing = executor.getHooks().find(h => h.name === request.body.name);
    if (existing) {
      return reply.code(409).send({
        type: 'https://device-farm/errors/conflict',
        title: 'Hook name already exists',
        status: 409 as const,
        detail: `A hook named "${request.body.name}" already exists`,
      });
    }
    executor.addHook(request.body);
    return reply.code(201).send(request.body);
  },
});
```

**Key points:**
- `request.body` is now strongly typed as `HookDefinition` — no `parsed.data` indirection
- 400 responses are handled by Fastify's error handler (Zod validation errors auto-convert to 400s via the type provider's compiler)
- `.meta({ id: 'Hook' })` registers the schema as a reusable `components.schemas.Hook` entry in the emitted OpenAPI (this is `zod-openapi`'s registry mechanism)
- `satisfies FastifyZodOpenApiSchema` catches schema-shape regressions at typecheck

### Pattern 3: `build-openapi.ts` Script Shape

**Source:** Combining `@fastify/swagger` docs (`fastify.swagger()` returns a JSON object; requires `await fastify.ready()` first) + Zod 4 `z.toJSONSchema()` registry mode.

```typescript
// server/scripts/build-openapi.ts
// Run via: tsx server/scripts/build-openapi.ts
//         OR  npm run openapi:generate
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buildApp } from '../index.js';
// Aggregator re-exporting every module's ws-schemas registry:
import { wsMessageRegistry } from '../../contracts/ws-messages.js';

async function main() {
  // 1) Boot Fastify with all plugins registered. NODE_ENV=contracts skips
  //    DB migrations + emulator boot hooks if config.ts respects that flag.
  process.env.NODE_ENV = 'contracts';
  const app = await buildApp();
  await app.ready();

  // 2) Extract OpenAPI spec.
  const spec = app.swagger();  // returns JSON object (YAML mode is opt-in)

  // 3) Write to disk — committed path per CONTEXT.
  const openapiPath = resolve('server/openapi.json');
  writeFileSync(openapiPath, JSON.stringify(spec, null, 2) + '\n');
  console.log(`✓ Wrote ${openapiPath}`);

  // 4) Emit WS message JSON Schema via Zod 4 native toJSONSchema.
  //    Each per-module ws-schemas.ts registers its schemas into a shared
  //    wsMessageRegistry (a z.ZodRegistry instance). toJSONSchema over the
  //    registry emits one .schemas object with named entries.
  const wsSchema = z.toJSONSchema(wsMessageRegistry, {
    target: 'draft-2020-12',     // matches OpenAPI 3.1 implicit schema target
    unrepresentable: 'throw',    // fail loudly on unmappable types
    reused: 'ref',               // emit $refs for reused schemas
  });
  const wsPath = resolve('contracts/ws-messages.json');
  mkdirSync(resolve('contracts'), { recursive: true });
  writeFileSync(wsPath, JSON.stringify(wsSchema, null, 2) + '\n');
  console.log(`✓ Wrote ${wsPath}`);

  // 5) Clean shutdown — Fastify close fires all plugin onClose hooks.
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('build-openapi failed:', err);
  process.exit(1);
});
```

**Pitfalls in the script:**
- `app.ready()` is REQUIRED before `app.swagger()` — without it, routes registered in `onReady` hooks (lifecycle, maestro preloads) aren't in the spec.
- `process.env.NODE_ENV = 'contracts'` is a naming suggestion (CONTEXT §Specifics); the config plugin must respect it. If config.ts branches on `NODE_ENV`, ensure `contracts` skips `initPool()` so the script doesn't try to boot emulators.
- Fastify's `checkDependencies()` helper at `server/index.ts:48-51` also tries to locate `adb` / `maestro` / `emulator` binaries. The script may need an env override like `SKIP_DEPENDENCY_CHECK=1` that the checker honors — OR restructure `buildApp()` to accept a `{ minimal: true }` option that skips the pool-boot chain. Recommend the latter for cleanliness.
- Newline-at-EOF + 2-space JSON — match existing formatter conventions so the diff check stays stable.
- Use `'\n'` line endings explicitly; on Windows contributors, `git diff --exit-code` trips on CRLF.

### Anti-Patterns to Avoid

- **Generating spec at server boot every time.** Don't. It's slow and churns DB connections. The dedicated script runs only in `openapi:generate` + CI.
- **Handwriting types in `cli/internal/types/generated.go`.** Enforce via `make types && git diff --exit-code` — any hand edit outside `unions.go` fails CI.
- **Using `.passthrough()` Zod helper at API boundaries.** Causes OpenAPI output to emit `additionalProperties: true`, which `go-jsonschema` maps to `map[string]any` — kills type safety. Use strict objects at the HTTP boundary; `.looseObject()` stays on event envelopes only.
- **`description` omitted from Zod schemas.** Without `.meta({ description: ... })`, the generated spec + generated Go/TS are unreadable. Require descriptions on every top-level schema; enforce with an ESLint rule in a later phase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAPI 3.1 spec serializer from Zod | Custom Zod-walker emitting JSON Schema | `fastify-zod-openapi` + `@fastify/swagger` | Zod 4 has `discriminatedUnion`, `brand<>()`, `.meta()`, lazy refs, nullable handling — a handroll would miss at least one. `fastify-zod-openapi` handles all of them + integrates with Fastify serializer. |
| WS message → JSON Schema | Loop over schemas + `JSON.stringify` of `.shape` | `z.toJSONSchema(z.globalRegistry)` or a scoped `z.ZodRegistry` | Native in Zod 4.3+. Handles refs, defaults, nullable, union, discriminator output. |
| Go struct generation from OpenAPI | `text/template` + Go codegen in a new `scripts/gen.go` | `go-jsonschema` via `jq`-extracted components | Pointers, JSON tags, nullable, required-field handling — solved problem. |
| TS types from OpenAPI | `ts-morph` + hand-walk of paths | `openapi-typescript` 7.x | Path-param paths typed as literal-template-strings, request/response body typed via `paths['/api/jobs']['post']['responses']['200']['content']['application/json']` — unshippable by hand. |
| CI drift check | CI job that inspects mtimes | Simple `git diff --exit-code server/openapi.json contracts/ cli/internal/types/generated.go web/src/lib/api/generated-types.ts` | Exit-code semantics are reliable; diff output is actionable for the PR author. |
| Plugin name rename | Sed across the repo in one commit | Atomic commit per plugin (static → reporting → maestro → hooks → pipelines → lifecycle → artifacts → jobs → pool → websocket → api) | 8 plugins × (name + dep-array fan-out) = ~30 edits. One-commit-per-plugin means a broken commit reverts cleanly; half-renamed states don't ship to main. |

**Key insight:** The entire codegen pipeline is library-stitching, not library-writing. Every line of handroll in this domain is a maintenance tax — the libraries cover 100% of our needs.

---

## Common Pitfalls

### Pitfall 1: Silent phantom dependencies in Fastify plugins

**What goes wrong:** `server/pipelines/plugin.ts:69` declares `dependencies: ['db-plugin', 'websocket-plugin', 'jobs-plugin']` — none of these names match any registered plugin (the real names are `db`, `websocket-plugin`, `job-plugin`). Today the server boots fine.

**Why it happens:** `node_modules/fastify-plugin/plugin.js:45` sets `fn[Symbol.for('skip-override')] = options.encapsulate !== true`. In Fastify, the `dependencies:` check only fires in the encapsulated-plugin code path. None of our plugins use `encapsulate: true`. The test at `fastify-plugin/test/test.js:292-303` proves this: the dep-check test explicitly sets `encapsulate: true` — without it, dangling names are silently ignored. Confirmed by reading installed sources.

**How to avoid:** Rename normalization (§9 + §11) replaces every phantom string with a real name. Also consider adding `encapsulate: true` in a future phase (would require refactoring cross-plugin decorator access patterns — OUT OF SCOPE for Phase 17).

**Warning signs:** Grep `dependencies: \[` in `server/**/plugin.ts` (or equivalent `*-plugin.ts`) and cross-reference every literal string with every `name:` field. Mismatch = phantom.

### Pitfall 2: `fastify-zod-openapi` vs `fastify-type-provider-zod` confusion

**What goes wrong:** Developer assumes these are the same package or picks the wrong one.

**Why it happens:** Both are maintained, both provide Fastify-Zod integration. Different tradeoffs: `fastify-type-provider-zod` is native-Zod-v4-encode/decode based; `fastify-zod-openapi` is OpenAPI-3.1 native via `zod-openapi`.

**How to avoid:** CONTEXT locks `fastify-zod-openapi`. Ensure the plan's install task lists the exact package name with a link comment.

### Pitfall 3: `go-jsonschema` can't consume OpenAPI directly

**What goes wrong:** Developer feeds `server/openapi.json` into `go-jsonschema` and gets garbage (it tries to process `paths`, `components`, `info` as schema keywords).

**Why it happens:** `go-jsonschema` consumes raw JSON Schema, not OpenAPI documents. The README only covers JSON Schema.

**How to avoid:** Extract `components.schemas` first using `jq`. Makefile target:

```makefile
# cli/Makefile (extended)
.PHONY: types
types: ../server/openapi.json
	jq '.components.schemas' ../server/openapi.json > /tmp/df-schemas.json
	go-jsonschema \
	  --package types \
	  --schema-output /tmp/df-schemas.json=internal/types/generated.go \
	  /tmp/df-schemas.json
	gofmt -w internal/types/generated.go
	@if git diff --quiet internal/types/generated.go; then \
	  echo "✓ generated.go is up to date"; \
	else \
	  echo "✗ generated.go drifted — commit the regeneration"; \
	  exit 1; \
	fi
```

### Pitfall 4: `z.discriminatedUnion` round-trips through `oneOf` but Go can't deserialize it idiomatically

**What goes wrong:** Zod emits `oneOf: [{...}, {...}]` with a `discriminator.propertyName` annotation. `go-jsonschema` sees `oneOf` and either (a) emits an interface with no guarantees, or (b) crashes. The generated Go struct is unusable for `json.Unmarshal`.

**Why it happens:** Go does not have tagged unions natively. Library-emitted `oneOf` structs typically become `any`/`interface{}` or a union-of-pointers struct, both hostile to idiomatic Go.

**How to avoid:** CONTEXT §WebSocket Schemas locks this: hand-rolled `cli/internal/types/unions.go` with per-variant `UnmarshalJSON`. §4 below shows the canonical shape. ADR-003 documents the pattern.

### Pitfall 5: `app.swagger()` requires `await app.ready()` first

**What goes wrong:** Script calls `app.swagger()` immediately after plugin registration. Returned spec is incomplete — missing routes registered inside `onReady` hooks (e.g., pipelines scheduler).

**Why it happens:** Fastify lazy-registers route handlers during `ready()`. The swagger decorator enumerates registered routes at call time.

**How to avoid:** `await app.ready()` before `app.swagger()`. Confirmed in the `@fastify/swagger` v9 README: "await fastify.ready() / fastify.swagger()".

### Pitfall 6: npm install cache + local tarballs don't invalidate

**What goes wrong:** Developer updates `vendor/device-stream/core-1.1.0.tgz`, runs `npm install`, but npm sees the package.json version hasn't changed and skips the install. Stale node_modules.

**Why it happens:** npm's cache is keyed by package+version, not tarball hash.

**How to avoid:** Bump the version in the tarball filename (`core-1.1.0.tgz` → `core-1.2.0.tgz`) and update the `file:` path in `package.json` when any change is made. Automate via a `scripts/vendor-device-stream.sh` that runs `npm pack` in each package with a bumped version and updates package.json.

### Pitfall 7: `git diff --exit-code` with generated files — line-ending drift

**What goes wrong:** CI on Linux generates `server/openapi.json` with `\n`; a developer's `autocrlf` on Windows commits `\r\n`. Drift check fires perpetually.

**Why it happens:** git's core.autocrlf + inconsistent writer endings.

**How to avoid:** Add to `.gitattributes`:

```gitattributes
# .gitattributes
*.json text eol=lf
*.go text eol=lf
cli/internal/types/generated.go linguist-generated=true
server/openapi.json linguist-generated=true
contracts/**/*.json linguist-generated=true
web/src/lib/api/generated-types.ts linguist-generated=true
```

`linguist-generated=true` also tells GitHub's diff viewer to collapse the file by default — reviewers see the real code changes.

### Pitfall 8: `installSimCapture` in Go CLI — sibling-repo assumption is deep

**What goes wrong:** `cli/cmd/dependencies.go:471-478` searches for `../device-stream` via `findDeviceStreamDir()`. After vendoring, the sibling repo is gone on a fresh clone; `installSimCapture` returns "device-stream repo not found".

**Why it happens:** `installSimCapture` runs `swift build -c release` in `device-stream/tools/sim-capture/` — it needs Swift source code, not the npm tarball.

**How to avoid:** Two options, pick one in the plan:
1. **Vendor Swift source under `vendor/sim-capture/`** alongside the npm tarballs; `installSimCapture` builds from there. Tradeoff: +MB in the repo; locks Swift code into Device Farm's commit history.
2. **Ship the pre-built `sim-capture` binary as a release asset** from the `device-stream` repo; `installSimCapture` downloads via `curl` with a pinned SHA. Tradeoff: requires release infrastructure in device-stream; more moving parts.

Recommend **Option 1** for this phase — it's the smallest change that satisfies DEBT-01 ("installSimCapture runs against the published package path" per success criterion). Option 2 is cleaner long-term but introduces external dependencies (GitHub Releases) that the CONTEXT's "reversible vendoring" stance doesn't commit to.

### Pitfall 9: `web:types` npm script must be at repo root, not inside `web/`

**What goes wrong:** Developer puts `"types"` script inside `web/package.json` expecting `npm run web:types` (in repo root) to forward to it. npm doesn't forward scripts that way.

**Why it happens:** npm scripts only run in the package.json they're declared in.

**How to avoid:** Either:
- Declare `"web:types": "openapi-typescript ./server/openapi.json -o web/src/lib/api/generated-types.ts"` at repo root (preferred — matches existing `web:build` pattern), OR
- Declare `"types"` in `web/package.json` and call via `npm --prefix web run types` (less ergonomic).

Stick with the existing `web:X` convention at repo root.

### Pitfall 10: `fastify-zod-openapi` peer deps may lag behind Fastify 5.8

**What goes wrong:** Install fails with `npm ERR! peer fastify@"^5.0.0"` conflict against 5.8.2.

**Why it happens:** Plugin authors sometimes pin tighter than needed; major bumps require plugin releases.

**How to avoid:** Verify peer-dep ranges at install time:

```bash
npm view fastify-zod-openapi peerDependencies
```

If `fastify` peer is `^5.0.0`, 5.8.2 satisfies. If `^5.8.0`, also fine. If `^5.0.0 <5.5.0`, hold Phase 17 until upstream updates OR patch via `overrides` in package.json:

```json
{ "overrides": { "fastify-zod-openapi": { "fastify": "$fastify" } } }
```

Use overrides only as a last resort — flag in the plan.

---

## Code Examples

Verified patterns from Context7-level sources (official READMEs + node_modules inspection).

### Example 1: `build-openapi.ts` (full)

See **Pattern 3** above — the complete script skeleton. Source: combines `@fastify/swagger` v9 README + Zod 4 `z.toJSONSchema` docs.

### Example 2: Hand-rolled Go union — `cli/internal/types/unions.go`

This is the CLI-03 deliverable. The pattern handles a WS-message discriminated union with three variants: `log`, `step`, `status`.

```go
// cli/internal/types/unions.go
// Generated by HAND per ADR-003. go-jsonschema does not emit idiomatic
// Go oneOf unions; this file provides the discriminator-based decoder
// for every WS message variant emitted by the server.
//
// Discriminator field: `type` (matches server envelope convention).
// When adding a new variant: (1) add to JobMessage union below,
// (2) add to the switch in UnmarshalJSON, (3) commit fixture JSON
// in contracts/ws-fixtures/ so the generated_test.go round-trip passes.
package types

import (
	"encoding/json"
	"fmt"
)

// JobMessage is the top-level WS message envelope emitted on /ws/jobs/:id.
// Variants share a `type` discriminator and a correlation-id side-channel.
type JobMessage struct {
	Type    string
	Log     *JobLogPayload
	Step    *JobStepPayload
	Status  *JobStatusPayload
}

// Typed payload structs — THESE are emitted by go-jsonschema from
// server/openapi.json's components.schemas and live in generated.go.
// Declared here as references only for clarity; DO NOT redeclare.

type unionPeek struct {
	Type string `json:"type"`
}

func (m *JobMessage) UnmarshalJSON(b []byte) error {
	var peek unionPeek
	if err := json.Unmarshal(b, &peek); err != nil {
		return fmt.Errorf("JobMessage: peek discriminator: %w", err)
	}
	m.Type = peek.Type
	switch peek.Type {
	case "log":
		var p JobLogPayload
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[log]: %w", err)
		}
		m.Log = &p
	case "step":
		var p JobStepPayload
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[step]: %w", err)
		}
		m.Step = &p
	case "status":
		var p JobStatusPayload
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[status]: %w", err)
		}
		m.Status = &p
	default:
		return fmt.Errorf("JobMessage: unknown discriminator %q", peek.Type)
	}
	return nil
}

func (m JobMessage) MarshalJSON() ([]byte, error) {
	switch m.Type {
	case "log":
		return json.Marshal(m.Log)
	case "step":
		return json.Marshal(m.Step)
	case "status":
		return json.Marshal(m.Status)
	}
	return nil, fmt.Errorf("JobMessage: empty or unknown discriminator %q", m.Type)
}
```

### Example 3: Round-trip test — `cli/internal/types/generated_test.go`

```go
// cli/internal/types/generated_test.go
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Each fixture lives at ../../../contracts/ws-fixtures/<name>.sample.json.
// The server-side Zod round-trip test (server/websocket/__tests__/frames.spec.ts)
// reads the same files — single source of truth.
func TestJobMessageRoundTrip(t *testing.T) {
	fixturesDir := filepath.Join("..", "..", "..", "contracts", "ws-fixtures")
	cases := []struct {
		name     string
		fixture  string
		wantType string
	}{
		{"log variant", "job-log.sample.json", "log"},
		{"step variant", "job-step.sample.json", "step"},
		{"status variant", "job-status.sample.json", "status"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(fixturesDir, tc.fixture))
			if err != nil {
				t.Fatalf("read fixture: %v", err)
			}
			var msg JobMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if msg.Type != tc.wantType {
				t.Fatalf("discriminator = %q; want %q", msg.Type, tc.wantType)
			}
			// Round-trip: re-marshal and confirm structural equivalence
			roundTrip, err := json.Marshal(msg)
			if err != nil {
				t.Fatalf("re-marshal: %v", err)
			}
			var a, b any
			_ = json.Unmarshal(raw, &a)
			_ = json.Unmarshal(roundTrip, &b)
			// Deep-equal comparison can be done via encoding/json.Marshal comparison
			// OR a structural diff lib; keep it simple:
			an, _ := json.Marshal(a)
			bn, _ := json.Marshal(b)
			if string(an) != string(bn) {
				t.Fatalf("round-trip mismatch\n  got: %s\n  want: %s", bn, an)
			}
		})
	}
}
```

### Example 4: Module-level WS schema registration (pattern for per-module `ws-schemas.ts`)

```typescript
// server/jobs/ws-schemas.ts  — NEW per-module file
// Every module with WS frames exports a registry entry added to the global
// wsMessageRegistry. Keep shapes pure — no logic, no imports from plugin.ts.
import { z } from 'zod';

export const jobLogMessage = z.object({
  type: z.literal('log'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  timestamp: z.string().datetime(),
}).meta({ id: 'JobLogMessage' });

export const jobStepMessage = z.object({
  type: z.literal('step'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  stepName: z.string(),
  status: z.enum(['running', 'passed', 'failed']),
}).meta({ id: 'JobStepMessage' });

export const jobStatusMessage = z.object({
  type: z.literal('status'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: z.enum(['queued', 'allocated', 'running', 'completed', 'failed']),
}).meta({ id: 'JobStatusMessage' });

export const jobMessageUnion = z.discriminatedUnion('type', [
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
]);

export type JobMessage = z.infer<typeof jobMessageUnion>;
```

```typescript
// contracts/ws-messages.ts  — NEW aggregator
// Builds one ZodRegistry that build-openapi.ts scans.
import { z } from 'zod';
import { jobLogMessage, jobStepMessage, jobStatusMessage } from '../server/jobs/ws-schemas.js';
// import { ... } from '../server/pool/ws-schemas.js';
// import { ... } from '../server/artifacts/ws-schemas.js';
// import { ... } from '../server/streaming/ws-schemas.js';

export const wsMessageRegistry = z.registry();
wsMessageRegistry.add(jobLogMessage, { id: 'JobLogMessage' });
wsMessageRegistry.add(jobStepMessage, { id: 'JobStepMessage' });
wsMessageRegistry.add(jobStatusMessage, { id: 'JobStatusMessage' });
// ... other modules

// Re-export for TS consumers:
export { jobLogMessage, jobStepMessage, jobStatusMessage };
```

### Example 5: CI drift check — `scripts/check-generated.sh`

```bash
#!/usr/bin/env bash
# scripts/check-generated.sh
# Run as `npm run contracts:check`.
# Regenerates every committed artifact and exits non-zero on drift, naming the drifted file.

set -euo pipefail

echo "→ Regenerating OpenAPI + WS JSON Schema..."
npm run openapi:generate

echo "→ Regenerating Go types..."
make -C cli types

echo "→ Regenerating web TS types..."
npm run web:types

DRIFT=()
for f in \
  server/openapi.json \
  contracts/ws-messages.json \
  cli/internal/types/generated.go \
  web/src/lib/api/generated-types.ts \
; do
  if ! git diff --quiet -- "$f"; then
    DRIFT+=("$f")
  fi
done

if [ ${#DRIFT[@]} -ne 0 ]; then
  echo ""
  echo "✗ Generated files drifted from committed versions:"
  for f in "${DRIFT[@]}"; do
    echo "    - $f"
  done
  echo ""
  echo "  Fix: regenerate locally (\`npm run openapi:generate && make -C cli types && npm run web:types\`)"
  echo "  then commit the regenerated files."
  git diff --stat -- "${DRIFT[@]}"
  exit 1
fi

echo ""
echo "✓ All generated files are up to date."
```

package.json scripts:
```json
{
  "scripts": {
    "openapi:generate": "tsx server/scripts/build-openapi.ts",
    "contracts:check": "bash scripts/check-generated.sh",
    "web:types": "openapi-typescript ./server/openapi.json -o web/src/lib/api/generated-types.ts"
  }
}
```

### Example 6: `installSimCapture` rewrite for vendored path

**Current code (`cli/cmd/dependencies.go:483-531`):** `findDeviceStreamDir()` searches sibling paths; `installSimCapture` builds Swift from there.

**Rewrite (Pitfall 8 Option 1 — vendored Swift source):**

```go
// cli/cmd/dependencies.go (after vendoring)
func findSimCaptureSource() (string, error) {
	// Walk up from binary location to find repo root, then vendor/sim-capture.
	binary, err := os.Executable()
	if err != nil {
		return "", err
	}
	cwd := filepath.Dir(binary)
	// Try cwd first (dev: bin/device-farm run from repo root),
	// then walk up looking for vendor/sim-capture.
	for depth := 0; depth < 6; depth++ {
		candidate := filepath.Join(cwd, "vendor", "sim-capture")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			abs, _ := filepath.Abs(candidate)
			return abs, nil
		}
		cwd = filepath.Dir(cwd)
	}
	return "", fmt.Errorf("vendor/sim-capture not found — run `npm run vendor:refresh` in repo root")
}

func installSimCapture() error {
	srcDir, err := findSimCaptureSource()
	if err != nil {
		return err
	}
	// ... (rest of function identical — `swift build` in srcDir, PATH update)
}
```

---

## State of the Art

| Old Approach (v2.0) | Current Approach (Phase 17) | When Changed | Impact |
|---------------------|------------------------------|--------------|--------|
| `file:../device-stream/packages/*` sibling-repo refs | `file:./vendor/device-stream/<pkg>-X.Y.Z.tgz` vendored tarballs | This phase | Fresh-clone boots with `npm install` alone; CI runs in container without sibling checkout. |
| `-plugin` suffix on most plugin names (`pool-plugin`, `job-plugin`, ...) | Bare names matching the directory (`pool`, `jobs`, ...) | This phase | Dependency arrays are self-documenting; no phantom deps; grep-ability. Matches Phase 15's substrate naming convention. |
| Handwritten Go DTO structs in `cli/internal/` | Generated `generated.go` from OpenAPI 3.1 + hand-rolled `unions.go` for discriminated types | This phase | Schema drift fails CI instead of silently producing wrong JSON decodes. |
| Handwritten TS types on web client | `openapi-typescript` emits `generated-types.ts`; Phase 29 swaps client to `openapi-fetch` | This phase (types), Phase 29 (client) | End-to-end typed API from Zod source-of-truth to browser fetch. |
| Fastify routes use `.safeParse()` inline + free-form responses | `withTypeProvider<FastifyZodOpenApiTypeProvider>()` routes with Zod request + response schemas | This phase (1 route per module minimum), Phases 20-27 (full coverage) | Request/response typed at the route level; OpenAPI spec emission is free. |
| `zod-to-json-schema@3.x` as a new devDep | Native `z.toJSONSchema()` (already in Zod ^4.3) | This phase | Zero new dep; same output shape. Deviation from CONTEXT — surface in plan for user confirmation. |

**Deprecated / outdated:**
- `@deepmap/oapi-codegen` — replaced by `oapi-codegen/oapi-codegen` (ownership transfer 2024)
- Old `zod-openapi@3.x` (pre-Zod-4 era) — superseded by `zod-openapi@5.x` which underpins `fastify-zod-openapi@4`
- `openapi-typescript@6` — superseded by 7.x (breaking change to output shape; commit to 7 from day one)

---

## Open Questions

1. **CONTEXT says `zod-to-json-schema@3.x`; Zod 4.3 has native `z.toJSONSchema()`.**
   - What we know: External library works. Native path is simpler + no new dep.
   - What's unclear: Is CONTEXT locking the external library or just specifying a conversion path?
   - Recommendation: Use native `z.toJSONSchema()` in the plan; flag the deviation in the plan's `## Deviations from CONTEXT` section for user confirmation. If user prefers external, swap is a one-line change.

2. **`server/openapi.json` location — CONTEXT says `server/openapi.json`, but `contracts/openapi/openapi.json` is cleaner.**
   - What we know: CONTEXT §Codegen Pipeline explicitly names `server/openapi.json`.
   - What's unclear: Is this historical reference or hard requirement?
   - Recommendation: Honor CONTEXT. Keep at `server/openapi.json`. Revisit in Phase 29 if the web+CLI tooling benefits from colocating all contracts under `contracts/`.

3. **`installSimCapture` Swift source location after vendoring.**
   - What we know: Binary builds from `swift build -c release` in a Swift source tree.
   - What's unclear: Ship Swift source in `vendor/sim-capture/` OR ship pre-built binary as a release asset?
   - Recommendation: Source vendoring (Pitfall 8 Option 1) — smallest change, keeps DEBT-01 scope-bounded.

4. **One Zod-validated route per existing module — which route?**
   - What we know: CONTEXT requires "one representative route per module." Modules with routes: hooks (4 routes), api (jobs/devices/health/config/keys), reporting (report routes), maestro (6 routes), pipelines (pipeline routes), artifacts (implicit via api), auth (key routes).
   - What's unclear: "Representative" is subjective.
   - Recommendation: Pick the POST-create route of each module (most shape-rich) — e.g., `POST /api/hooks`, `POST /api/jobs`, `POST /api/keys`, `POST /api/reports/...`, `POST /api/pipelines/...`. This phase's plan should enumerate the exact list.

5. **`ogen-go` and `oapi-codegen` may ship OpenAPI 3.1 support before Phase 28.**
   - What we know: Both are actively developed. ogen-go has an open discussion; oapi-codegen is waiting on kin-openapi.
   - What's unclear: Release timelines.
   - Recommendation: Stay on `go-jsonschema` for Phase 17. Re-evaluate in Phase 28 (CLI refactor). Generated Go types are commodity; swap cost is low.

---

## Detailed Plugin Rename Inventory

Verbatim grep-derived reference. Every occurrence that must change in the rename waves.

### `pool-plugin` → `pool`

**Current `name:` field:** `server/pool/plugin.ts:47` → `name: 'pool-plugin'`

**References as dependency string:**
- `server/jobs/plugin.ts:47` — `dependencies: ['config', 'db', 'pool-plugin', 'websocket-plugin', 'artifact-plugin', 'reporting']`
- `server/artifacts/artifact-plugin.ts:57` — `dependencies: ['config', 'db', 'pool-plugin']`
- `server/hooks/plugin.ts:194` — `dependencies: ['config', 'event-bus', 'queue', 'pool-plugin']`
- `server/maestro/plugin.ts:353` — `dependencies: ['config', 'pool-plugin']`
- `server/api/plugin.ts:51` — `dependencies: ['config', 'db', 'pool-plugin', 'job-plugin', 'auth', 'reporting', 'maestro-plugin', 'hooks-plugin']`
- `server/hooks/plugin.ts:19` — doc comment referencing `pool-plugin`

**Test assertions:**
- `server/__tests__/plugin-order.spec.ts:11,51` — string `'pool-plugin'` in expected list + `indexOf` check

### `job-plugin` → `jobs`

**Current `name:` field:** `server/jobs/plugin.ts:47` → `name: 'job-plugin'`

**References as dependency string:**
- `server/api/plugin.ts:51` — `'job-plugin'`
- `server/pipelines/plugin.ts:69` — `'jobs-plugin'` (PHANTOM — doesn't match either `job-plugin` or target `jobs`; becomes `'jobs'`)

**Test assertions:**
- `server/__tests__/plugin-order.spec.ts:12,52` — string `'job-plugin'`

### `websocket-plugin` → `websocket`

**Current `name:` field:** `server/streaming/websocket-plugin.ts:172` → `name: 'websocket-plugin'`

**References as dependency string:**
- `server/jobs/plugin.ts:47` — `'websocket-plugin'`
- `server/pipelines/plugin.ts:69` — `'websocket-plugin'` (also phantom today due to substring `db-plugin` siblings)

**Non-dep references (comments/docs):**
- `server/streaming/device-preview.ts:87-88` — comment: "websocket-plugin (which creates DevicePreviewManager) registers before artifact-plugin (which..."

**Test assertions:**
- `server/__tests__/plugin-order.spec.ts:11` — string `'websocket-plugin'`

### `artifact-plugin` → `artifacts`

**Current `name:` field:** `server/artifacts/artifact-plugin.ts:57` → `name: 'artifact-plugin'`

**References as dependency string:**
- `server/jobs/plugin.ts:47` — `'artifact-plugin'`

**Non-dep references:**
- `server/streaming/device-preview.ts:88` — comment

**Test assertions:**
- `server/__tests__/plugin-order.spec.ts:11` — string `'artifact-plugin'`

### `lifecycle-plugin` → `lifecycle`

**Current `name:` field:** `server/lifecycle/lifecycle-plugin.ts:97` → `name: 'lifecycle-plugin'`

**References as dependency string:** NONE today (nobody depends on lifecycle).

**Test assertions:** none

**Decorator reads that imply direction:**
- `server/api/routes.ts:392-393` — `fastify.lifecycleStats` consumed by `/api/health` handler. This means **`api` depends on `lifecycle`** (api reads lifecycle's decorator). CONTEXT §Ops Hygiene resolves this direction: add `lifecycle` to api's `dependencies:` array.

### `hooks-plugin` → `hooks`

**Current `name:` field:** `server/hooks/plugin.ts:193` → `name: 'hooks-plugin'`

**References as dependency string:**
- `server/api/plugin.ts:51` — `'hooks-plugin'`

**Test assertions:** none (hooks plugin not asserted in plugin-order spec)

### `maestro-plugin` → `maestro`

**Current `name:` field:** `server/maestro/plugin.ts:352` → `name: 'maestro-plugin'`

**References as dependency string:**
- `server/api/plugin.ts:51` — `'maestro-plugin'`

**Test assertions:** none

### `pipelines-plugin` → `pipelines`

**Current `name:` field:** `server/pipelines/plugin.ts:68` → `name: 'pipelines-plugin'`

**References as dependency string:** none today

**Own dep array needs fixing (phantom deps):**
- `server/pipelines/plugin.ts:69` — `dependencies: ['db-plugin', 'websocket-plugin', 'jobs-plugin']` → `['db', 'websocket', 'jobs']`

**Test assertions:** none

### `static-spa` → `static`

**Current `name:` field:** `server/api/static-plugin.ts:43` → `name: 'static-spa'`

**References as dependency string:** none

**Test assertions:**
- `server/__tests__/plugin-order.spec.ts:12` — string `'static-spa'` in comment

### `websocket → pool` new dependency (CONTEXT + verification)

**Current state:** `server/streaming/websocket-plugin.ts` does NOT read `fastify.pool` anywhere. Verified via `grep "fastify\.pool\|app\.pool" server/streaming/` — 0 matches.

**CONTEXT assertion:** "websocket declares pool as a new dep (currently does not — WS server reads device state for preview broadcasts)."

**Reality:** The WS plugin has no direct pool reads TODAY. Device preview frames come from `DevicePreviewManager`'s internal state (populated by adapters from `jobs` plugin via `setAdapterFactory`). The real pool consumer is `JobService`, not the WS plugin.

**Recommendation:** Treat CONTEXT's success criterion as forward-looking — Phase 20 (Pool Module) will wire `websocket` to pool events through the bus. For Phase 17:
- **Option A (conservative):** Do NOT add `pool` to websocket's deps. The success criterion is overreach; flag to the user.
- **Option B (CONTEXT-literal):** Add `pool` to websocket's dependencies array NOW, even though no decorator read exists. Harmless (Fastify only enforces registration order, not that a dep is used).

Recommend **Option B** — honor CONTEXT literally, lock the ordering invariant for Phase 20, cost is one string. Document the forward-looking rationale in the rename commit message.

### `lifecycle / api` direction (CONTEXT + verification)

**Grep evidence:** `server/api/routes.ts:392-393` reads `fastify.lifecycleStats`. The `lifecycleStats` decorator is set in `server/lifecycle/lifecycle-plugin.ts:33`.

**Direction:** `api` depends on `lifecycle` (api reads lifecycle's decorator).

**Plugin registration order in `server/index.ts`:** lifecycle registers at position 14, api at position 18 — api registers AFTER lifecycle, which matches Fastify's "depend on something that already registered" rule.

**Action:** Add `'lifecycle'` to `server/api/plugin.ts:51` dependencies array. Final array after rename:

```typescript
dependencies: ['config', 'db', 'pool', 'jobs', 'auth', 'reporting', 'maestro', 'hooks', 'lifecycle']
```

---

## Rename Commit Order (Wave 2)

Leaves first → keystones last. Each commit is atomic (touches `name:` field + every dep-array reference + any test string).

1. `refactor(17): rename static-spa → static` (touches static-plugin.ts + plugin-order.spec.ts comment)
2. `refactor(17): rename lifecycle-plugin → lifecycle + add lifecycle as api dep` (touches lifecycle-plugin.ts name + api/plugin.ts deps)
3. `refactor(17): rename maestro-plugin → maestro` (touches maestro/plugin.ts + api/plugin.ts dep)
4. `refactor(17): rename hooks-plugin → hooks` (touches hooks/plugin.ts + api/plugin.ts dep + docs comment at hooks/plugin.ts:19)
5. `refactor(17): rename pipelines-plugin → pipelines; fix phantom deps` (touches pipelines/plugin.ts name + pipelines deps: `['db-plugin','websocket-plugin','jobs-plugin']` → `['db','websocket','jobs']`)
6. `refactor(17): rename artifact-plugin → artifacts` (touches artifacts/artifact-plugin.ts + jobs/plugin.ts dep + plugin-order.spec.ts string + device-preview.ts comment)
7. `refactor(17): rename websocket-plugin → websocket; declare pool dep (Phase 20 forward-compat)` (touches streaming/websocket-plugin.ts + jobs/plugin.ts dep + pipelines/plugin.ts dep (already renamed step 5) + plugin-order.spec.ts + device-preview.ts comment + adds `'pool'` to websocket's own dep array)
8. `refactor(17): rename job-plugin → jobs` (touches jobs/plugin.ts name + api/plugin.ts dep + pipelines/plugin.ts dep (already renamed step 5 to 'jobs' — no-op) + plugin-order.spec.ts strings)
9. `refactor(17): rename pool-plugin → pool` (touches pool/plugin.ts + jobs + artifacts + hooks + maestro + api dep arrays + plugin-order.spec.ts + hooks/plugin.ts:19 comment)
10. Final: `refactor(17): verify final plugin dep graph + update plugin-order.spec expectations` (sanity sweep — no code changes if earlier steps were complete)

**After all renames, final state of every `dependencies:` array:**

| Plugin | Final `dependencies:` array |
|--------|----------------------------|
| config | `[]` (none) |
| correlation | `[]` |
| db | `['config']` |
| event-bus | `['db', 'correlation']` |
| queue | `['db', 'correlation']` |
| telemetry | `['correlation']` |
| pool | `['config']` |
| auth | `['config', 'db']` |
| websocket | `['config', 'auth', 'pool']` |
| artifacts | `['config', 'db', 'pool']` |
| reporting | `['config', 'db']` |
| jobs | `['config', 'db', 'pool', 'websocket', 'artifacts', 'reporting']` |
| lifecycle | `['config', 'db']` |
| hooks | `['config', 'event-bus', 'queue', 'pool']` |
| maestro | `['config', 'pool']` |
| pipelines | `['db', 'websocket', 'jobs']` |
| api | `['config', 'db', 'pool', 'jobs', 'auth', 'reporting', 'maestro', 'hooks', 'lifecycle']` |
| static | `['api']` |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (JS/TS) + Go stdlib `testing` (Go) |
| Config file | `vitest.config.ts` (or inline defaults; TS root); no separate config file in repo for Go |
| Quick run command | `npx vitest run <path>` / `go test ./cli/internal/types/... -short` |
| Full suite command | `npm test && cd cli && make test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPEC-06 | `fastify-zod-openapi` registered; spec emits OpenAPI 3.1 with components.schemas | integration | `npx vitest run server/__tests__/openapi-generation.spec.ts` | ❌ Wave 0 (new file) |
| SPEC-06 | At least one Zod-validated route per module | integration | `npx vitest run server/<module>/__tests__/<route>.spec.ts` (per module) | ❌ Wave 1 (new files per module, at least POST /api/hooks upgraded) |
| SPEC-07 | WS message JSON Schema emitted; each variant round-trips through per-module Zod `safeParse` | unit | `npx vitest run server/websocket/__tests__/frames.spec.ts` | ❌ Wave 1 (new file) |
| CLI-01 | `make types` produces `generated.go`; file compiles | unit | `cd cli && make types && go build ./...` | ❌ Wave 2 (new Makefile target + output) |
| CLI-02 | Drift check fails on modified generated file; passes on clean tree | integration | `bash scripts/check-generated.sh` | ❌ Wave 2 (new shell script) |
| CLI-03 | Go `UnmarshalJSON` decodes each WS variant fixture | unit | `cd cli && go test ./internal/types/... -run TestJobMessageRoundTrip` | ❌ Wave 1 (new `unions.go` + `generated_test.go`) |
| WEB-01 | `openapi-typescript` emits `generated-types.ts`; `tsc --noEmit` clean on web | integration | `npm run web:types && cd web && npm run check` | ❌ Wave 2 (new npm script + output) |
| DEBT-01 (tarballs) | `npm install` succeeds without sibling repo | integration | `npx vitest run server/__tests__/fresh-install.spec.ts` (spawns clean tmpdir, runs `npm install` on vendored package.json) | ❌ Wave 3 (new file) |
| DEBT-01 (installSimCapture) | CLI installer works against vendored source | integration | `cd cli && go test ./cmd/... -run TestInstallSimCapture` | ❌ Wave 3 (new Go test + may need testdata fixture) |
| DEBT-01 (plugin renames) | Every plugin boots with expected name; no phantom deps | integration | `npx vitest run server/__tests__/plugin-order.spec.ts` | ✅ Exists — just update expected strings post-rename |
| DEBT-01 (plugin renames) | Updated plugin-order spec asserts final dep graph structure | integration | `npx vitest run server/__tests__/plugin-graph.spec.ts` | ❌ Wave 2 (optional new file asserting the full dep array table via `app.printPlugins()` — recommended to catch accidental regressions) |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched-file-glob>` (fast — typically < 5s per module) + `npm run dep-check` (static graph; ~2s; confirms no new dep-cruiser violations) + `bash scripts/check-generated.sh` WHEN the commit touches Zod schemas OR plugin-side code that could change the OpenAPI surface
- **Per wave merge:** `npm test && cd cli && make test && npm run contracts:check` — full TS suite + Go tests + drift check
- **Phase gate:** Full suite green + `bash scripts/check-generated.sh` green + `npm run nyquist:check` green (delta ≤ −2pp vs Phase 15 baseline 48.29%) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/__tests__/openapi-generation.spec.ts` — SMOKE: `buildApp()` + `app.ready()` + `const spec = app.swagger()`; assert `spec.openapi === '3.1.0'`; assert `spec.components.schemas.Hook` exists (post upgrade of hooks routes)
- [ ] `server/websocket/__tests__/frames.spec.ts` — TS round-trip: reads each fixture from `contracts/ws-fixtures/`, parses via per-module `z.discriminatedUnion`, asserts structural equivalence after re-serialize
- [ ] `server/__tests__/plugin-graph.spec.ts` — dep graph invariant (optional hardening beyond plugin-order.spec.ts): assert the full table of `dependencies:` arrays via `app.printPlugins()`
- [ ] `scripts/check-generated.sh` — drift check
- [ ] `.gitattributes` — `linguist-generated=true` for all four generated files (prevents reviewers drowning in generated-code diffs)
- [ ] `contracts/ws-fixtures/*.sample.json` — at least 3 fixtures (log, step, status) committed so both TS and Go tests have input
- [ ] `docs/adr/003-go-union-mapping.md` — Nygard-format ADR documenting the hand-rolled discriminator pattern + why go-jsonschema doesn't handle it
- [ ] Framework install: `npm i --save fastify-zod-openapi @fastify/swagger && npm i -D openapi-typescript && go install github.com/atombender/go-jsonschema/cmd/go-jsonschema@latest`
- [ ] `vendor/device-stream/` directory with 3 `.tgz` files + bump refs in `package.json`
- [ ] `vendor/sim-capture/` directory with Swift source (Pitfall 8 Option 1) + update `cli/cmd/dependencies.go` to find it

---

## Sources

### Primary (HIGH confidence)

- **Local source inspection** (node_modules):
  - `/Users/heicg/Desktop/projects/device-farm/node_modules/fastify-plugin/plugin.js:45` — confirmed `skip-override` symbol set iff `encapsulate !== true`; dependency check is silent for non-encapsulated plugins
  - `/Users/heicg/Desktop/projects/device-farm/node_modules/fastify-plugin/test/test.js:292-303` — only test of dep-missing behavior, gated on `encapsulate: true`
  - `/Users/heicg/Desktop/projects/device-farm/node_modules/fastify/package.json` — confirmed Fastify 5.8.2 installed
- **GitHub `samchungy/fastify-zod-openapi` README** (via WebFetch) — plugin registration pattern, `fastifyZodOpenApiTransformers` spread, OpenAPI 3.1.0 explicit, peer on `@fastify/swagger`
- **GitHub `fastify/fastify-swagger` README** (via WebFetch) — `fastify.swagger()` returns JSON by default; YAML opt-in via `{ yaml: true }`; requires `await fastify.ready()` first; Fastify 5 support is in v9.x line
- **Zod docs `zod.dev/json-schema`** (via WebFetch) — `z.toJSONSchema()` signature, registry mode, target options (`draft-2020-12`, `openapi-3.0`, `draft-07`, `draft-04`), emit-to-disk pattern
- **openapi-ts.dev** (via WebFetch) — `openapi-typescript` 7.x CLI usage, pairing with `openapi-fetch`, npm script pattern
- **Repo grep** (full-tree):
  - Every `dependencies:` array in `server/**/plugin.ts` verified
  - `fastify.lifecycleStats` read site: `server/api/routes.ts:392`
  - `fastify.pool` usage in `server/streaming/**`: zero hits → confirms websocket→pool is forward-looking, not current
  - `installSimCapture` / `sim-capture` references: `cli/cmd/dependencies.go:87,481,489`

### Secondary (MEDIUM confidence)

- **ogen-go Discussion #1410** (via WebFetch) — 2025 unresolved issue confirms OpenAPI 3.1 `"type": [X, "null"]` not yet supported
- **Speakeasy Go SDK comparison** (via WebSearch) — confirmed `oapi-codegen` lacks OAS 3.1; `ogen` has different approach; `go-jsonschema` is narrow-scope JSON Schema tool
- **npm docs + community posts** (via WebSearch) — npm pack tarball install semantics, `file:` resolution, cache-invalidation pitfalls

### Tertiary (LOW confidence — needs validation in Wave 0)

- `fastify-zod-openapi` peer-dep range against `fastify@5.8.2` — verify with `npm view fastify-zod-openapi peerDependencies` before the plan commits to a specific minor
- `go-jsonschema` behavior on `z.discriminatedUnion` → OpenAPI `oneOf` — verify empirically in Wave 0 via a tiny test fixture; confirm CLI-03's hand-rolled unions path is genuinely required (expected to be)
- Zod 4 `.meta()` → OpenAPI `components.schemas` registration via `fastify-zod-openapi` — verify emitted spec shape against a canonical example

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library was traced to Context7-level sources (official READMEs, GitHub) with version + peer-dep evidence
- Plugin rename mechanics: HIGH — verbatim grep across repo; every reference enumerated; Fastify internal behavior verified by reading `node_modules/fastify-plugin/plugin.js`
- Go generator decision: MEDIUM — three candidates were compared; `go-jsonschema` is justified but is a "best of imperfect options" — OpenAPI 3.1 Go tooling is still maturing. Recommended re-eval in Phase 28
- WS round-trip pattern: HIGH — Zod 4 native `z.toJSONSchema` docs + Go `encoding/json` unmarshal semantics are both well-understood
- `installSimCapture` rewrite: MEDIUM — CONTEXT locks tarball vendoring but Swift source vendoring (Pitfall 8) is a recommendation, not a CONTEXT decision
- Pitfalls catalog: HIGH for items 1, 2, 3, 5, 6, 7, 8, 9, 10; MEDIUM for item 4 (go-jsonschema + oneOf behavior — require Wave 0 empirical check)

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — library landscape in this domain is stable; only `oapi-codegen`/`ogen-go` OpenAPI 3.1 status could shift, which only affects Phase 28 re-evaluation)
