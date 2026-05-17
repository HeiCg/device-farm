---
phase: 17-contracts-pipeline-ops-hygiene
plan: 03
subsystem: infra
tags: [contracts, websocket, zod, json-schema, toJSONSchema, draft-2020-12, codegen, build-openapi]

# Dependency graph
requires:
  - phase: 17-contracts-pipeline-ops-hygiene
    provides: "Plan 17-00 scaffolded build-openapi.ts with commented-out WS emit block + TODO(17-02) marker; Plan 17-02 landed contracts/ws-messages.ts aggregator exporting wsMessageRegistry with 7 .add() entries (JobLogMessage/JobStepMessage/JobStatusMessage/DevicePreviewMessage/DeviceStateMessage/ArtifactCreatedMessage/WsEnvelope); Plan 17-01 activated the fastify-zod-openapi pipeline so npm run openapi:generate boots end-to-end"
  - phase: 15-foundations
    provides: "Zod 4.3.6 native z.toJSONSchema(registry, {...}) API with target: 'draft-2020-12', unrepresentable: 'throw', reused: 'ref' options"
provides:
  - "contracts/ws-messages.json as a tracked, generated artifact — 12,764 bytes / 417 lines / JSON Schema draft-2020-12 for all 7 WS variants emitted via z.toJSONSchema(wsMessageRegistry)"
  - "Activated WS emission path in server/scripts/build-openapi.ts — single `npm run openapi:generate` run now produces BOTH server/openapi.json AND contracts/ws-messages.json"
  - "Byte-deterministic generator output verified across 3 consecutive regenerations (file mtime updates but bytes identical, diff exits 0)"
  - "Extended build-openapi smoke test with 4 source-level assertions locking the activation state (import live + z.toJSONSchema call present + no TODO(17-02) marker + no void z/void mkdirSync anchors)"
  - "Consumer-ready input for Plan 17-04 Go codegen — go-jsonschema will read contracts/ws-messages.json and emit Go structs for the CLI WebSocket consumer"
affects: [17-04, 22-streaming, 28-cli, 29-web]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generated artifact commit convention: contracts/*.json is machine-produced, flagged `linguist-generated=true` in .gitattributes, committed alongside the generator source change — byte-determinism makes the commit diff reviewable and the file a tracked consumer input"
    - "Consumer-driven activation sequencing — Plan 17-02 shipped the aggregator but left the emit block commented out; Plan 17-03 (the first downstream consumer) un-comments it in a single atomic change that also commits the first generated output. Zero intermediate states where generator runs but output is stale/missing."
    - "Dual-artifact build script — one npm run invocation emits ALL generated contract files (server/openapi.json from fastify-zod-openapi + contracts/ws-messages.json from Zod registry). Future consumers add emit blocks to the same script rather than spawning parallel scripts."

key-files:
  created:
    - "contracts/ws-messages.json (417 lines; JSON Schema draft-2020-12 emission of wsMessageRegistry with 7 variants under top-level `schemas` key)"
  modified:
    - "server/scripts/build-openapi.ts (header rewritten; TODO(17-02) marker removed; wsMessageRegistry import activated; 8-line WS emit block uncommented; void z/void mkdirSync anchors deleted — done in commit 5c8ee58 before this session)"
    - "server/scripts/__tests__/build-openapi.spec.ts (+28 lines; new `describe('build-openapi.ts source')` block with 4 source-level assertions)"

key-decisions:
  - "Regenerator target DB is device_farm_test (not device_farm_dev per plan suggestion) — device_farm_dev doesn't exist on this host. device_farm_test is the canonical Vitest target DB used throughout Phase 15 setup and is equivalent for contract generation purposes (NODE_ENV=contracts + app.ready() short-circuits all side-effecting init). Documented for future-self: any dev-class Postgres DB works; the generator uses the DB only for plugin boot order, never for data."
  - "Byte-determinism verified empirically across 3 separate regenerations (16:17 initial, 16:23 second, 16:33 third) — all produced byte-identical 12,764-byte output. Confirms Plan 17-01's observation (fastify-zod-openapi v5 preserves insertion order natively) extends to Zod 4 z.toJSONSchema(registry, {target: 'draft-2020-12', reused: 'ref'}) emission: registry iteration order + JSON.stringify with null/2 suffices for stable output."
  - "Top-level emission shape is `{ schemas: { JobLogMessage, JobStepMessage, ... } }` — NOT `{ $defs: { ... } }` as the plan's acceptance criteria accommodated with an either/or clause. Zod 4 z.toJSONSchema(registry) uses `schemas` key when given a registry input; `$defs` shape only appears for reused inline refs within a single schema's output. Both shapes satisfy the acceptance criteria (all 7 ids present as string matches)."
  - "Smoke test assertions are source-level grep-equivalents (readFileSync + toContain/toMatch) rather than behavioral (which would require DB + buildApp boot). Source-level locking is load-bearing: it prevents future refactors from silently re-commenting the emit block or reintroducing TODO markers, without adding a 30s CI step. Behavioral coverage comes from 17-04 Go codegen consuming the emitted file — if the emit block regresses, 17-04 fails its regenerate spec."
  - "No Rule 1-4 deviations. Plan's Task 1 had already landed in a prior session (commit 5c8ee58 on 2026-04-20 16:07, before this re-execution); this session verified that commit's acceptance criteria still pass, then completed Tasks 2 + 3 atomically against the existing activated source."

patterns-established:
  - "Contract file generation always runs through a single `npm run openapi:generate` entry point that boots the live Fastify app (NODE_ENV=contracts guard), reads the Zod registries via z.toJSONSchema, and writes each artifact with `JSON.stringify(schema, null, 2) + '\\n'` for byte-stable output."
  - "Generated JSON artifacts under contracts/ are committed (linguist-generated=true marks them as noise in code review but they remain grep-able/diffable) — treat them as build outputs that happen to live in git, not source inputs. Never hand-edit; regenerate via the build script."
  - "When adding a new generated-artifact emit block, write both the activation commit AND the first generated-output commit in the same session. Leaving an activated generator without its first committed output creates a stale-file race where CI emits slightly different output than local."

requirements-completed: [SPEC-07]

# Metrics
duration: 32min
completed: 2026-04-20
---

# Phase 17 Plan 17-03: WS JSON Schema Emission Activation Summary

**contracts/ws-messages.json committed as a tracked generated artifact (12,764 bytes / 417 lines / 7 WS variants in draft-2020-12 JSON Schema) emitted via z.toJSONSchema(wsMessageRegistry) from build-openapi.ts; byte-deterministic across 3 regenerations; smoke test extended with 4 source-level activation-state assertions.**

## Performance

- **Duration:** 32 min (includes initial session attempt 16:07 + resume session 16:22-16:39; actual coding time ~10 min)
- **Started:** 2026-04-20T20:07:19Z (Task 1 commit 5c8ee58 landed in prior session)
- **Completed:** 2026-04-20T20:39:17Z (Task 3 commit 1452e8a)
- **Tasks:** 3 (all three plan tasks completed atomically)
- **Files created:** 1 (contracts/ws-messages.json)
- **Files modified:** 2 (build-openapi.ts in prior session; build-openapi.spec.ts in this session)

## Accomplishments

- Activated WS JSON Schema emission in `server/scripts/build-openapi.ts` — TODO(17-02) marker removed, `wsMessageRegistry` import uncommented, `z.toJSONSchema(...)` + `writeFileSync(wsPath, ...)` emit block live, obsolete `void z` / `void mkdirSync` anchors deleted (commit 5c8ee58, prior session).
- Regenerated `contracts/ws-messages.json` via `npm run openapi:generate` against device_farm_test DB — 12,764 bytes / 417 lines / 7 named WS variants under top-level `schemas` key; committed as tracked file (commit 341a5ea).
- Verified byte-determinism empirically across 3 separate regenerations (16:17, 16:23, 16:33 on 2026-04-20) — all produced identical output. `diff /tmp/ws-messages.first.json contracts/ws-messages.json` exited 0 on every comparison.
- Extended `server/scripts/__tests__/build-openapi.spec.ts` with a new `describe('build-openapi.ts source')` block carrying 4 source-level assertions that lock the activation state (commit 1452e8a).
- All 5 tests in the smoke suite pass green (1 original `main()` AsyncFunction assertion + 4 new source-level assertions). Runtime: 1.11s.

## Task Commits

Each task was committed atomically:

1. **Task 1: Uncomment WS emit block in build-openapi.ts** — `5c8ee58` (feat) — landed in prior session before rate-limit interruption
2. **Task 2: Run openapi:generate and commit contracts/ws-messages.json** — `341a5ea` (feat)
3. **Task 3: Update build-openapi.spec.ts to assert WS emit path** — `1452e8a` (test)

**Plan metadata:** [pending — this SUMMARY.md + STATE.md + ROADMAP.md]

## Files Created/Modified

- `contracts/ws-messages.json` — **created** — Generated JSON Schema draft-2020-12 artifact; 417 lines; top-level shape `{ schemas: { JobLogMessage, JobStepMessage, JobStatusMessage, DevicePreviewMessage, DeviceStateMessage, ArtifactCreatedMessage, WsEnvelope } }`; consumed by Plan 17-04 Go codegen.
- `server/scripts/build-openapi.ts` — **modified in prior session (commit 5c8ee58)** — Header rewritten to describe dual-artifact output; `// TODO(17-02):` marker removed from import line 14; 8-line WS emit block at lines 34-44 uncommented; `void z;` + `void mkdirSync;` anchor lines deleted.
- `server/scripts/__tests__/build-openapi.spec.ts` — **modified** — Added `readFileSync` + `resolve` imports and new `describe('build-openapi.ts source')` block with 4 `it()` assertions: (a) wsMessageRegistry import matches regex, (b) `z.toJSONSchema(wsMessageRegistry` + `writeFileSync(wsPath,` + `resolve('contracts/ws-messages.json')` string matches, (c) no `TODO(17-02)` marker present, (d) no `void z;` or `void mkdirSync;` anchors present. Original `main()` AsyncFunction assertion preserved.

## Decisions Made

- **Regenerator DB target:** Used `device_farm_test` (not plan-suggested `device_farm_dev`) because `device_farm_dev` doesn't exist on this host; `device_farm_test` is the canonical Phase 15 Vitest DB. For `NODE_ENV=contracts` generation the DB is only touched during plugin boot (no data reads), so any Postgres DB with the schema works.
- **Emission shape is `{ schemas: {...} }` not `{ $defs: {...} }`:** Zod 4 `z.toJSONSchema(registry, {...})` uses `schemas` as the container key when given a registry (vs. `$defs` for inline-reused refs within a single schema). Plan acceptance criteria accepted either shape; all 7 WS variant ids present as top-level grep matches regardless.
- **Smoke test is source-level, not behavioral:** Assertions use `readFileSync` + `toContain` / `toMatch` to inspect `server/scripts/build-openapi.ts` source text. This avoids DB dependency and a 30s boot in CI; behavioral coverage comes from 17-04 Go codegen regenerating from the emitted file (any regression in the emit block would fail 17-04's codegen spec).
- **No Rule 1-4 deviations triggered.** Plan executed as written; no bugs, missing critical functionality, blockers, or architectural decisions surfaced.

## Deviations from Plan

None - plan executed exactly as written.

The only execution note is session continuity: a prior session interrupted by API rate-limit had already landed Task 1's activation commit (`5c8ee58`) but did not commit the generated `contracts/ws-messages.json` or extend the smoke test. This session verified Task 1's acceptance criteria still pass against the committed source, then completed Tasks 2 + 3 atomically.

## Issues Encountered

- **Initial `DATABASE_URL=postgresql://localhost/device_farm_dev` from plan failed** — the plan's suggested DB name `device_farm_dev` doesn't exist on this host. Resolved by listing available DBs via `psql -d postgres -c "SELECT datname FROM pg_database"` and switching to `device_farm_test` (the standard Phase 15 Vitest DB). Zero code changes needed; only the DATABASE_URL env var differed for the regeneration commands.

## User Setup Required

None - this plan only regenerates a tracked artifact and extends a unit test. No external services, credentials, or manual configuration required.

## Next Phase Readiness

- **Plan 17-04 (Go codegen) is unblocked.** `contracts/ws-messages.json` is tracked in git with all 7 WS variant schemas, byte-deterministic across regenerations, and consumable by go-jsonschema. The Go CLI WebSocket consumer now has a concrete input schema.
- **SPEC-07 "JSON Schema do protocolo WebSocket exportado em build" is fully closed** — generator activated, artifact emitted + tracked, byte-determinism verified, test-locked against regression. Phase 17 requirements index can mark SPEC-07 complete.
- **Phase 22 (Streaming Module) foundation remains intact** — the forward-looking wire shape (correlationId + flat payload) encoded in contracts/ws-messages.ts from 17-02 is now also locked into contracts/ws-messages.json. When Phase 22 migrates the broadcaster to emit these frames, the generated Go types (17-04) and TS types (17-05) will already match.
- **No outstanding blockers for the rest of Phase 17 (17-04 Go codegen + 17-08 final wrap).**

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*

## Self-Check: PASSED

- FOUND: contracts/ws-messages.json
- FOUND: server/scripts/build-openapi.ts
- FOUND: server/scripts/__tests__/build-openapi.spec.ts
- FOUND: .planning/phases/17-contracts-pipeline-ops-hygiene/17-03-SUMMARY.md
- FOUND: commit 5c8ee58 (Task 1)
- FOUND: commit 341a5ea (Task 2)
- FOUND: commit 1452e8a (Task 3)
