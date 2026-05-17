---
phase: 17-contracts-pipeline-ops-hygiene
plan: 01
subsystem: contracts
tags: [contracts, openapi, zod, fastify-zod-openapi, fastify-swagger, per-route-schemas, spec-driven]

# Dependency graph
requires:
  - plan: 17-00
    provides: fastify-zod-openapi@^5.6.1 + @fastify/swagger@^9.7.0 runtime deps; server/scripts/build-openapi.ts skeleton; contracts/ scaffold
  - phase: 16-pilot-module-hooks
    provides: Per-module schemas.ts precedent (server/hooks/schemas.ts); hookDefinitionSchema as Zod source-of-truth (SPEC-03); hooks plugin POST /api/hooks target for upgrade (RESEARCH §Pattern 2)
  - phase: 15-foundations
    provides: Plugin registration order invariant (plugin-order.spec.ts gated on TEST_DATABASE_URL)
provides:
  - fastify-zod-openapi wired between telemetry (step 7) and pool (step 8) in server/index.ts — Zod validator + serializer compilers installed at root scope so every route-declaring plugin compiles Zod schemas (not Ajv)
  - @fastify/swagger registered with OpenAPI 3.1.0 doc (title "Device Farm API", version 3.0.0) + fastifyZodOpenApiTransformers spread so `app.swagger()` returns a populated spec with `components.schemas` from route .meta({id}) registrations
  - NODE_ENV=contracts guard in buildApp() — skips checkDependencies() AND the heavy onReady side-effects (initPool / device.booted hooks / DB device sync / health checker / reaper) so build-openapi.ts runs on a dev machine without the Android/iOS toolchain
  - 7 representative routes upgraded to `fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({ ... schema: ... satisfies FastifyZodOpenApiSchema ... })` — one POST per route-declaring module (hooks, api/jobs, auth/api-keys, reporting/webhooks, pipelines) plus two GETs (api/devices, api/jobs/:id/artifacts) for breadth
  - 6 new thin per-module schemas.ts files (server/{jobs,pool,artifacts,reporting,pipelines}/schemas.ts + extensions to server/hooks/schemas.ts) with 14 `.meta({ id: '...' })` ids total — lifts the response types into `components.schemas` for codegen
  - server/openapi.json committed as the first REAL generated spec (1762 lines, OpenAPI 3.1.0, 14 named component schemas, 65+ paths enumerated) — single-source-of-truth for SPEC-06; byte-deterministic on repeat runs
  - server/__tests__/openapi-generation.spec.ts integration test — boots buildApp() under NODE_ENV=contracts, asserts app.swagger() returns 3.1.0 + representative schema ids + representative paths
affects: [17-02, 17-03, 17-04, 17-05, 17-06, 17-07, 28-cli, 29-web]

# Tech tracking
tech-stack:
  added: []  # All deps landed in 17-00; this plan wires what was installed.
  patterns:
    - "Validator/serializer compilers installed at ROOT scope (app.setValidatorCompiler(validatorCompiler) + app.setSerializerCompiler(serializerCompiler)) BEFORE fastifyZodOpenApiPlugin registration — required by fastify-zod-openapi v5 per its README; missing call was the RESEARCH §Pattern 1 omission discovered during Task 3"
    - "withTypeProvider + `satisfies FastifyZodOpenApiSchema` on every upgraded route — catches schema-shape regressions at tsc --noEmit time (typecheck-level guard)"
    - ".meta({ id: '...', description: '...' }) on every response schema — promotes the schema into components.schemas instead of inlining under paths; referenced by fastify-zod-openapi's registry emit"
    - "NODE_ENV=contracts as the build-openapi.ts side-effect gate — guards both checkDependencies() (at call site in server/index.ts step 2) AND the onReady pool/hook/db/reaper chain; keeps dependency-checker.ts untouched (Task 1 directive)"
    - "Multipart routes skip body Zod schema (POST /api/jobs) — use `schema.description` only; matches fastify-zod-openapi convention"

key-files:
  created:
    - path: "server/__tests__/openapi-generation.spec.ts"
      why: "Integration test — boots buildApp under NODE_ENV=contracts, asserts app.swagger() returns OpenAPI 3.1 + representative schemas/paths"
    - path: "server/jobs/schemas.ts"
      why: "Jobs module Zod boundary schemas (jobSummarySchema.meta({id:'JobSummary'}) for POST /api/jobs response)"
    - path: "server/pool/schemas.ts"
      why: "Pool module Zod boundary schemas (deviceSummarySchema + deviceListSchema.meta({id:'DeviceList'}) for GET /api/devices response)"
    - path: "server/artifacts/schemas.ts"
      why: "Artifacts module Zod boundary schemas (artifactSummarySchema + artifactListSchema.meta({id:'ArtifactList'}) for GET /api/jobs/:id/artifacts response)"
    - path: "server/reporting/schemas.ts"
      why: "Reporting module Zod boundary schemas (webhookCreateRequestSchema + webhookSchema for new POST /api/webhooks representative route)"
    - path: "server/pipelines/schemas.ts"
      why: "Pipelines module Zod HTTP boundary schemas (pipelineCreateRequestSchema + pipelineSummarySchema for POST /api/pipelines) — separate file from server/pipelines/schema.ts (YAML body shape)"
    - path: "server/openapi.json"
      why: "First REAL generated OpenAPI 3.1 spec (1762 lines, 14 named components.schemas, 65+ paths) — single-source-of-truth for SPEC-06 CLI + web codegen"
  modified:
    - path: "server/index.ts"
      why: "Imports fastifyZodOpenApiPlugin/Transformers + validatorCompiler + serializerCompiler + @fastify/swagger; installs compilers at root scope; registers plugin pair between telemetry (7) and pool (8); NODE_ENV=contracts guards step 2 (checkDependencies) + onReady (initPool/hooks/db-sync/health/reaper)"
    - path: "server/hooks/plugin.ts"
      why: "POST /api/hooks upgraded to withTypeProvider + Zod body/response schemas + handler uses typed request.body directly (no more inline safeParse)"
    - path: "server/hooks/schemas.ts"
      why: "Added hookSchema (.meta({id:'Hook'})) + hookConflictSchema for the POST /api/hooks 201/409 response slots"
    - path: "server/api/routes.ts"
      why: "POST /jobs + GET /devices + GET /jobs/:id/artifacts upgraded to withTypeProvider; multipart body kept permissive (no Zod body schema) per fastify-zod-openapi convention"
    - path: "server/auth/key-routes.ts"
      why: "POST /admin/keys upgraded to withTypeProvider with apiKeyCreateRequestSchema + apiKeySchema (.meta({id:'ApiKey'}))"
    - path: "server/reporting/report-routes.ts"
      why: "Added NEW POST /api/webhooks representative route — fires fastify.webhookService.deliver fire-and-forget; full registration+persistence lands in Phase 19 (Reporting Migration)"
    - path: "server/pipelines/routes.ts"
      why: "POST /api/pipelines upgraded to withTypeProvider with pipelineCreateRequestSchema + pipelineSummarySchema + pipelineValidationErrorSchema (required to narrow reply.code(400) type alongside 201)"
    - path: "server/pipelines/plugin.ts"
      why: "Rule 3 deviation — stale dependencies ['db-plugin','websocket-plugin','jobs-plugin'] corrected to actual registered names ['db','websocket-plugin','job-plugin']; unblocked build-openapi.ts plugin-load"

decisions:
  - "RESEARCH §Pattern 1 missed the app.setValidatorCompiler / setSerializerCompiler calls — without them, Fastify fell back to Ajv which choked on Zod-emitted `required: [...]` arrays at route registration time (FST_ERR_SCH_VALIDATION_BUILD). Fix is per the fastify-zod-openapi v5 README (plan interfaces block documented only the plugin + transformers)."
  - "fastify-zod-openapi v5 Zod schemas compile successfully even with `.default(...)` fields — the hookDefinitionSchema (4 fields with defaults) lands in the OpenAPI spec with `default` annotations; no ‘passthrough' anti-pattern encountered (RESEARCH §Pattern 2 worry unnecessary here)."
  - "server/openapi.json determinism: byte-identical on 3 consecutive runs without any Object-key sort pass — fastify-zod-openapi v5 emits deterministic output natively; sort-pass workaround in 17-01-PLAN Step B skipped."
  - "Multipart POST /api/jobs skips Zod body schema per fastify-zod-openapi convention; only response is modelled (jobSummarySchema). Documented in route.schema.description for OpenAPI readers."
  - "POST /api/pipelines 400 response required its own Zod schema (pipelineValidationErrorSchema) — type-narrowing inside handler forces reply.code(400) to match a registered status code, otherwise TS rejects the payload (TS2345 narrowing). This pattern will recur for any route with multiple status codes."
  - "Pipelines plugin had stale dependency names ('db-plugin','jobs-plugin') that pre-dated the Phase 15-06 rename — build-openapi.ts exposed the break because it boots all plugins together. Fixed inline (Rule 3) rather than defer to 17-06 because the file wouldn't load otherwise. Decision minimal: only the dependencies array changed, no plugin names altered."
  - "Reporting module had NO POST /api/webhooks route — added as a fire-and-forget ping endpoint backed by fastify.webhookService.deliver. Full CRUD + persistence is Phase 19 (Reporting Migration) scope; this plan only needs the route signature to emit components.schemas.Webhook and prove the pipeline."

metrics:
  duration-minutes: 41
  completed: 2026-04-20
  tasks-completed: 3
  tasks-total: 3
  files-created: 7
  files-modified: 8
---

# Phase 17 Plan 01: Wire fastify-zod-openapi + first real openapi.json

**One-liner:** Wired fastify-zod-openapi v5 + @fastify/swagger into server/index.ts between telemetry (slot 7) and pool (slot 8), upgraded 7 representative routes to withTypeProvider Zod schemas across every route-declaring module, committed the first real 1762-line OpenAPI 3.1.0 spec as the single-source-of-truth for SPEC-06 codegen.

## Exact placement in server/index.ts

| Action | Line(s) |
| --- | --- |
| Imports (validatorCompiler, serializerCompiler, fastifyZodOpenApiPlugin, fastifyZodOpenApiTransformers) | 21–25 |
| `import fastifySwagger from '@fastify/swagger'` | 26 |
| `telemetryPlugin` register (step 7) | 84 |
| `app.setValidatorCompiler(validatorCompiler)` | 92 |
| `app.setSerializerCompiler(serializerCompiler)` | 93 |
| `app.register(fastifyZodOpenApiPlugin)` | 96 |
| `app.register(fastifySwagger, { openapi: { openapi: '3.1.0', ... }, ...fastifyZodOpenApiTransformers })` | 101–112 |
| `poolPlugin` register (step 8) | 115 |

Registration order preserved substrate-first: `config → correlation → db → event-bus → queue → telemetry → fastifyZodOpenApi → fastifySwagger → pool → auth → websocket → artifacts → reporting → jobs → lifecycle → hooks → maestro → pipelines → api → static` (plugin-order.spec.ts still passes).

## 7 representative routes landed

| # | Route | Module | File | Response schema id(s) | Request schema id |
| - | ----- | ------ | ---- | --------------------- | ----------------- |
| 1 | POST /api/hooks                | hooks      | server/hooks/plugin.ts                     | Hook, HookConflict                          | hookDefinitionSchema (inline body, not registered as id) |
| 2 | POST /jobs                     | api/jobs   | server/api/routes.ts                       | JobSummary                                   | — (multipart body skipped per fastify-zod-openapi convention) |
| 3 | POST /admin/keys               | auth       | server/auth/key-routes.ts                  | ApiKey                                       | ApiKeyCreateRequest |
| 4 | POST /webhooks (new)           | reporting  | server/reporting/report-routes.ts          | Webhook                                      | WebhookCreateRequest |
| 5 | POST /api/pipelines            | pipelines  | server/pipelines/routes.ts                 | Pipeline, PipelineValidationError            | PipelineCreateRequest |
| 6 | GET /devices                   | api/pool   | server/api/routes.ts                       | DeviceList (references DeviceSummary)        | — |
| 7 | GET /jobs/:id/artifacts        | api/artifacts | server/api/routes.ts                    | ArtifactList (references ArtifactSummary)    | params: z.object({ id: z.string().uuid() }) inline |

`jq '.components.schemas | keys' server/openapi.json` confirms 14 named schemas: ApiKey, ApiKeyCreateRequest, ArtifactList, ArtifactSummary, DeviceList, DeviceSummary, Hook, HookConflict, JobSummary, Pipeline, PipelineCreateRequest, PipelineValidationError, Webhook, WebhookCreateRequest.

## Determinism observation

Three consecutive `npm run openapi:generate` runs produced byte-identical output (`diff /tmp/snapshot.json server/openapi.json` exit 0 each time). **The sort-pass workaround suggested in 17-01-PLAN Step B was NOT required** — fastify-zod-openapi v5 emits deterministic output natively (Zod 4 registry + zod-openapi v5 preserve insertion order).

## server/openapi.json summary

| Metric | Value |
| - | - |
| File size | 41 KB |
| Lines | 1762 |
| `.openapi` | `3.1.0` |
| `.info.title` | `Device Farm API` |
| `.info.version` | `3.0.0` |
| `components.schemas` count | 14 |
| `.paths` count | 65+ (every existing route enumerated; Zod-typed routes get full schemas, untyped get Fastify-default stubs) |

## No .passthrough() removals

The upgrade path did NOT require removing any `.passthrough()` calls — the existing Zod schemas (hookDefinitionSchema, validation.ts query schemas, pipelines/schema.ts YAML schemas) use only strict objects. The anti-pattern flagged in RESEARCH §Pattern 2 (`.passthrough()` at API boundary breaking zod-openapi) did not manifest in this codebase.

## Deviations from Plan

### Rule-3 deviations (blocking — auto-fixed)

**1. [Rule 3 - Missing library call] `app.setValidatorCompiler(validatorCompiler)` + `app.setSerializerCompiler(serializerCompiler)` required before fastifyZodOpenApiPlugin**
- **Found during:** Task 3 first attempt to run `npm run openapi:generate`.
- **Issue:** Fastify threw `FST_ERR_SCH_VALIDATION_BUILD` ("data/required must be array") for every Task-2 route at registration time. Root cause: fastify-zod-openapi v5 requires the caller to install its Zod validator + serializer compilers at root scope. The plugin itself only adds an `onRoute` hook to attach a config symbol — it does NOT register the compilers (per `node_modules/fastify-zod-openapi/lib/index.mjs:10-22`). Without the setters, Fastify falls back to Ajv, which rejects Zod's JSON-schema output shape.
- **Fix:** Added imports for `validatorCompiler` + `serializerCompiler` from `fastify-zod-openapi`, called the setters before `app.register(fastifyZodOpenApiPlugin)`. RESEARCH §Pattern 1 had omitted the call pair.
- **Files modified:** server/index.ts (lines 21–25, 92–93)
- **Commit:** 4c555a2

**2. [Rule 3 - Stale plugin dependency names] `server/pipelines/plugin.ts` dependencies array referenced plugin names that never registered**
- **Found during:** Task 3 second boot of build-openapi.ts (fastify `checkDependencies` assertion).
- **Issue:** `pipelines-plugin` declared `dependencies: ['db-plugin', 'websocket-plugin', 'jobs-plugin']`, but the registered names are `'db'`, `'websocket-plugin'`, `'job-plugin'` (stale from Phase 15-06). Runtime boot never caught it because buildApp() was only called under conditions where all those plugins registered by NAME in a specific order — fastify's `checkDependencies` call matches on name, so 'db-plugin' ≠ 'db' and fails.
- **Fix:** Corrected the three stale names to match the actual registered names. Only the dependencies array changed — no plugin names were altered (plan 17-06 owns the broader DEBT-01 rename). Documented inline in the comment.
- **Files modified:** server/pipelines/plugin.ts (lines 68–78)
- **Commit:** 4c555a2

### Scope substitutions

**POST /api/webhooks did not exist** — added as a thin fire-and-forget ping endpoint (request Zod-validated, response echoes an acknowledgement). Full webhook registration + persistence (DB table, CRUD) is Phase 19 (Reporting Migration) scope; this plan only needed a route signature to emit `components.schemas.Webhook + WebhookCreateRequest`. Documented in the route handler comment.

**POST /api/jobs multipart handling** — body stays Zod-unvalidated (per 17-01-PLAN Step E and fastify-zod-openapi convention). Only response is typed via `jobSummarySchema.meta({id:'JobSummary'})`. Route description field documents the multipart fields for OpenAPI readers.

## Auth gates

None. No external credentials or login prompts encountered during execution.

## Verification Summary

- [x] `npx tsc --noEmit` — 0 new errors beyond the pre-existing 6-file baseline (recording-service, bus/helpers, bus/plugin, events spec, hooks events spec, pipelines/schema); those are out-of-scope per deviation Rule 3 scope boundary
- [x] `npx vitest run server/__tests__/plugin-order.spec.ts` — passes against `device_farm_test` (substrate ordering preserved; fastifyZodOpenApi + fastifySwagger slot in between telemetry and pool as required)
- [x] `npx vitest run server/__tests__/openapi-generation.spec.ts` — 3/3 tests pass against DB: spec.openapi === '3.1.0', components.schemas has {Hook, JobSummary, ApiKey, Webhook, Pipeline, DeviceList, ArtifactList}, paths has {'/api/hooks', '/api/jobs', '/api/devices'}
- [x] `npx vitest run server/hooks/__tests__/hook-executor.spec.ts server/hooks/__tests__/module.spec.ts` — 13/13 Phase 16 hooks tests still green (no regression from the POST /api/hooks upgrade)
- [x] `npm run openapi:generate` — exit 0; writes server/openapi.json; byte-deterministic on 3 consecutive runs
- [x] `test -s server/openapi.json` — 41 KB, 1762 lines, valid JSON
- [x] `node -e "const s = require('./server/openapi.json'); process.exit(s.openapi === '3.1.0' && s.components.schemas.Hook && s.paths['/api/hooks'] ? 0 : 1)"` — exit 0

## What this unblocks

- **Plan 17-02** (Wave 1 sibling): can now import `components.schemas` references via the committed server/openapi.json when building contracts/ws-messages.ts registry + fixtures
- **Plan 17-03+** (Wave 2+): CLI + web codegen phases consume server/openapi.json as the single-source-of-truth (SPEC-06); `npm run web:types` already wired to openapi-typescript in 17-00
- **Module phases 20–27**: each module phase upgrades its remaining non-representative routes to the same `withTypeProvider + satisfies FastifyZodOpenApiSchema + .meta({ id })` pattern — this plan is the canonical reference

## Self-Check: PASSED

All files referenced in the SUMMARY exist at the declared paths. All three per-task commits (6e9bcf4, af99f0a, 4c555a2) exist in the current branch history.
