# Phase 17: Contracts Pipeline & Ops Hygiene - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 17 locks the v3.0 contract pipeline (Zod → OpenAPI 3.1 → Go + TypeScript codegen) so that every subsequent module phase (20-27) produces schemas that automatically flow into CLI and Web typed clients, AND clears the v2.0 operational tech debt that would otherwise block later work. Concrete deliverables: `fastify-zod-openapi` wired with at least one Zod-validated route per existing module; `server/scripts/build-openapi.ts` emits `server/openapi.json` + `contracts/ws-messages.json`; Go + TS codegen targets consume those outputs and commit regenerated files; CI drift check (`npm run contracts:check`) fails on drift. `@device-stream/*` is vendored via tarballs under `vendor/device-stream/` so fresh-clone + `npm install` succeeds without a sibling repo. Plugin naming normalizes: every Fastify plugin strips the `-plugin` suffix (`pool`, `jobs`, `websocket`, `artifacts`, `reporting`, `lifecycle`, `hooks`, `maestro`, `pipelines`, `api`, `static`) so downstream dependency arrays reference consistent names. Phase 17 does NOT migrate any module's business logic or complete full-route Zod coverage — per-module expansion happens in its own phase (20-27).

</domain>

<decisions>
## Implementation Decisions

### Codegen Pipeline
- Shared output directory: `contracts/` at repo root (sub-dirs `openapi/`, `ws-messages/`, reserved `generated/` for future); already exists with `client/config/output/streaming/` subtree — extend, do not relocate
- Generator: dedicated `server/scripts/build-openapi.ts` script — loads Fastify with all plugins, calls the `fastify-zod-openapi` export, serializes to `server/openapi.json`, then invokes `zod-to-json-schema` on the WS envelope registry to emit `contracts/ws-messages.json`, exits cleanly. Decoupled from runtime — does NOT run on every server boot
- CI gate: `npm run contracts:check` = `npm run openapi:generate && git diff --exit-code server/openapi.json contracts/` wired into existing GitHub Actions lint/test job; failing diff blocks merge
- Coverage: one Zod-validated route per existing module (MINIMUM) — Phase 16 hooks already satisfies; this phase adds one representative route per module that currently declares routes (jobs, devices/pool, artifacts, reporting, pipelines, auth/api-key). Full per-route coverage is per-module scope (Phase 20-27)

### WebSocket Schemas + Go Union Mapping
- Discriminator field: `type` (string literal) — matches existing server envelope + Phase 15's event envelope convention; no rename
- Schema source: per-module `ws-schemas.ts` colocated in each module (jobs, pool, artifacts, streaming) — mirrors the events.ts pattern; aggregator `contracts/ws-messages.ts` re-exports them so codegen has one entry point. Build script converts via `zod-to-json-schema@3.x`
- Go mapping: hand-rolled `cli/internal/types/unions.go` with `UnmarshalJSON` per discriminator variant — go-jsonschema output is consumed for flat types but unions get the manual treatment (documented in ADR-003, committed this phase)
- Round-trip tests: dual — TS test under `server/websocket/__tests__/frames.spec.ts` parses canonical samples with the per-module Zod schemas; Go test `cli/internal/types/generated_test.go` decodes the same fixtures into strongly-typed structs. Fixtures live under `contracts/ws-fixtures/` so both test lanes read identical JSON

### @device-stream Distribution
- Vendored tarballs under `vendor/device-stream/` (`core-X.Y.Z.tgz`, `android-X.Y.Z.tgz`, `ios-simulator-X.Y.Z.tgz`); package.json installs via `"@device-stream/core": "file:./vendor/device-stream/core-X.Y.Z.tgz"` — fresh clone + `npm install` succeeds with no sibling repo
- `installSimCapture` points at the vendored path; add an integration test that runs `installSimCapture` against a clean `node_modules` and asserts the macOS capture daemon is registered
- Reversible: future migration to GitHub Packages / private npm registry is a package.json diff — tarballs are the temporary pinning mechanism, not the long-term target

### Plugin Naming Normalization
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
  - `static-plugin` → `static`
- Migration strategy: single atomic commit per plugin (rename `name:` field + every `dependencies:` reference + every test assertion in one go). Order: leaf plugins first (static, reporting), then mid-tier (maestro, hooks, pipelines, lifecycle, artifacts), then keystone (jobs, pool, websocket, api)
- Fastify `dependencies` arrays across every plugin file must be updated in lockstep — a dangling reference blocks boot. The plugin-order invariant spec (Phase 15 Plan 15-06, `server/__tests__/plugin-order.spec.ts`) asserts via `app.printPlugins()` introspection; this must pass after each rename commit

### Ops Hygiene — Specific Items from Success Criteria
- `pipelines` dep array changes from `['db-plugin', 'websocket-plugin', 'jobs-plugin']` → `['db', 'websocket', 'jobs']` (the `db-plugin`/`websocket-plugin`/`jobs-plugin` strings don't resolve today — confirmed by grep — they were carried over from an older naming scheme. Current boot may silently succeed because Fastify dep resolution is lenient until a plugin invokes a missing decorator; these phantom deps are removed with the rename)
- `websocket` declares `pool` as a new dep (currently does not — WS server reads device state for preview broadcasts)
- `lifecycle` / `api` dep graph: `lifecycle` declares `api` if it reads `api-plugin` decorators, OR `api` declares `lifecycle` if the direction is reversed — planner confirms by grep of decorator usage before writing the rename commit

### Claude's Discretion
- Exact order of `server/scripts/build-openapi.ts` emit phases (OpenAPI first vs WS first)
- ADR-003 (Go union mapping pattern) prose tone and examples
- `contracts/ws-fixtures/` naming convention for individual fixture files
- Whether to generate a `contracts/schemas/package.json` workspace entry now (for future npm workspace) or defer to Phase 29

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Zod 4 already a dep; per-module schemas exist in `server/config/`, `server/hooks/schemas.ts` (Phase 16 pilot), `server/events/envelope.ts`
- Fastify plugin substrate already registered in dependency order (`server/index.ts`) — rename does not change registration order
- `contracts/` directory exists at repo root — extend sub-dirs without relocating
- Go CLI already consumes JSON from HTTP responses via hand-rolled structs — the generated types drop in as a replacement
- Existing `maestro` + `api-key` routes already use `z.object(...)` body parsing — lifting them to `fastify-zod-openapi` is additive
- `package.json` already has `drizzle-kit`, `vitest`, `eslint-plugin-local-rules` dev deps — ADR-003 + codegen scripts fit the same pattern

### Established Patterns
- Per-module `schemas.ts` + `events.ts` (Phase 16 precedent) — ws-schemas.ts slots in as a peer for modules that emit WS frames
- Dedicated scripts under `scripts/` (e.g., `scripts/capture-nyquist.mjs` from Phase 15 Plan 15-09) — `server/scripts/build-openapi.ts` follows the same form
- ADR index at `docs/adr/` with `NNN-slug.md` naming — ADR-003 is reserved
- ESM imports with `.js` specifiers — codegen scripts use `tsx` or `ts-node` with the same NodeNext resolution
- Plugin-order invariant spec (Phase 15 Plan 15-06) asserts dependency graph via `app.printPlugins()` — the rename commits must keep this spec green

### Integration Points
- `server/index.ts` plugin registration — no order change, only `name:` references inside each plugin file
- `package.json` scripts — add `openapi:generate`, `contracts:check`, `web:types`; add `fastify-zod-openapi`, `zod-to-json-schema`, `openapi-typescript` dev deps
- `cli/Makefile` — add `types` target invoking `go-jsonschema`; confirm `go test ./internal/types/...` runs in CI
- `web/package.json` scripts — add `types` script invoking `openapi-typescript contracts/openapi/openapi.json`
- `server/__tests__/plugin-order.spec.ts` — update expected plugin-name list when renames land

</code_context>

<specifics>
## Specific Ideas

- Vendored tarballs live under `vendor/device-stream/` (NOT `server/vendor/`) so the path is shared by server + CLI code that may eventually consume
- `contracts/ws-fixtures/` uses naming `<type>.sample.json` (e.g., `log.sample.json`, `step.sample.json`) — both TS and Go tests glob the same files
- `server/scripts/build-openapi.ts` runs with `NODE_ENV=contracts` and a minimal Fastify boot (skip DB migrations) — uses a flag on the config plugin
- Plugin rename commits use conventional commit format: `refactor(17): rename pool-plugin → pool` — each in its own atomic commit so revert is one-op
- `installSimCapture` integration test shells out to `npm install @device-stream/ios-simulator` in a `tmpdir/` with a minimal package.json, then asserts the binary landed

</specifics>

<deferred>
## Deferred Ideas

- Per-route full Zod coverage on every endpoint — deferred to per-module phases (20-27)
- `fastify-zod-openapi` OpenAPI Security schemes (bearer auth) — lands with Phase 26 (Auth Module)
- Migration to published private npm registry for `@device-stream/*` — reversible from the vendored tarball approach; not in scope this phase
- npm workspace for a shared `@devicefarm/contracts` package — possible Phase 29 scope if web+cli both benefit
- Full WebSocket-protocol versioning via `v:` field on envelope — already carried by events envelope (Phase 15); extending to WS frames is Phase 22
- Discriminator-typed error envelopes (RFC 7807 + problem+json) — already in place; documenting in OpenAPI error responses is partial coverage this phase, full coverage in Phase 26

</deferred>
