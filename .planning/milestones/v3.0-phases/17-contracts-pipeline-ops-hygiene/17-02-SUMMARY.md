---
phase: 17-contracts-pipeline-ops-hygiene
plan: 02
subsystem: infra
tags: [contracts, websocket, zod, zod-registry, discriminated-union, fixtures, codegen, ws-schemas]

# Dependency graph
requires:
  - phase: 17-contracts-pipeline-ops-hygiene
    provides: "Plan 17-00 scaffolded contracts/ws-fixtures/ + wrote server/scripts/build-openapi.ts with TODO(17-02) marker locating the WS emit block to be un-commented once the aggregator exists"
  - phase: 16-pilot-module-hooks
    provides: "Per-module schemas.ts + events.ts precedent (ws-schemas.ts lands as a peer); __tests__/ colocation; SPEC-03 z.infer-derived types pattern"
  - phase: 15-foundations
    provides: "Zod 4.3.6 runtime (native z.registry + .meta({id:...}) + z.discriminatedUnion); Vitest 4.x test runner"
provides:
  - Per-module WebSocket Zod schemas colocated in each module that emits WS frames — server/jobs/ws-schemas.ts, server/pool/ws-schemas.ts, server/artifacts/ws-schemas.ts, server/streaming/ws-schemas.ts
  - 7 variant schemas registered under z.registry() in contracts/ws-messages.ts — JobLogMessage / JobStepMessage / JobStatusMessage / DevicePreviewMessage / DeviceStateMessage / ArtifactCreatedMessage / WsEnvelope
  - 3 per-module discriminated unions (jobMessageUnion, poolMessageUnion, artifactMessageUnion) for module-local dispatch; 1 aggregate anyWsMessage union for generic dispatchers (Phase 22 streaming)
  - 4 canonical fixtures under contracts/ws-fixtures/ (job-log, job-step, job-status, device-preview) — dual-lane round-trip harness inputs
  - TS lane round-trip canary server/websocket/__tests__/frames.spec.ts (13 tests pass) — validates parse + JSON.stringify → parse equality + cross-variant discriminator rejection
  - Single entry point (contracts/ws-messages.ts) that 17-03 (Go codegen) and 17-04 (web TS codegen) can import; activates the commented-out WS emit block in server/scripts/build-openapi.ts (un-commenting itself deferred to 17-03 Task 1 per plan directive)
affects: [17-03, 17-04, 17-05, 17-06, 17-07, 22-streaming, 28-cli, 29-web]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-module ws-schemas.ts colocation (MOD-03) — peer of events.ts + schemas.ts from Phase 16 pilot; one schema file per module that emits WS frames"
    - "Central aggregator (contracts/ws-messages.ts) pattern with z.registry() — single import path for codegen consumers (17-03 Go, 17-04 TS) instead of scattered module imports"
    - "Canonical fixture convention: contracts/ws-fixtures/<variant-name>.sample.json — 2-space indent + trailing newline + plausible UUIDs + ISO-8601 datetimes; dual TS + Go test lanes read the same files"
    - "Round-trip canary spec: per-variant Zod safeParse + discriminated-union dispatch + JSON.stringify → JSON.parse equality + cross-variant rejection — catches schema/fixture drift before codegen touches the bytes"
    - "Forward-looking wire shape vs. runtime shape — Zod schemas mirror the planned Phase 22 frame envelope (correlationId + flat payload) rather than the current runtime JobMessage interface (server/streaming/types.ts nests data: unknown). Phase 22 is responsible for migrating the broadcaster; this plan ships SHAPES + fixtures only."

key-files:
  created:
    - "server/jobs/ws-schemas.ts (47 lines; 3 variants + union + z.infer type)"
    - "server/pool/ws-schemas.ts (28 lines; 2 variants + union + type)"
    - "server/artifacts/ws-schemas.ts (21 lines; 1 variant + union + type)"
    - "server/streaming/ws-schemas.ts (22 lines; generic wsEnvelopeSchema with .loose())"
    - "contracts/ws-messages.ts (66 lines; z.registry aggregator with 7 entries + anyWsMessage union + re-exports)"
    - "contracts/ws-fixtures/job-log.sample.json (7 lines)"
    - "contracts/ws-fixtures/job-step.sample.json (8 lines)"
    - "contracts/ws-fixtures/job-status.sample.json (6 lines)"
    - "contracts/ws-fixtures/device-preview.sample.json (7 lines)"
    - "server/websocket/__tests__/frames.spec.ts (123 lines; 13 tests in 3 describe blocks)"
  modified: []

key-decisions:
  - "Zod schemas mirror the forward-looking wire shape (correlationId + flattened payload per RESEARCH §Example 4) rather than the current runtime JobMessage interface in server/streaming/types.ts (which nests `data: unknown` under a wsMessageType discriminator). Plan explicitly scopes to SHAPES + fixtures only; Phase 22 (Streaming Module) migrates the broadcaster to emit these Zod-validated frames. A NOTE block in server/jobs/ws-schemas.ts records the divergence so the Phase 22 author cannot miss it."
  - "server/websocket/__tests__/ created as the new home for this test. The WS plugin currently lives at server/streaming/websocket-plugin.ts, but a dedicated server/websocket/ directory anticipates Phase 22's Streaming Module extraction and keeps the test file out of any module's internal/ dir (dep-cruiser rules from 16-03 are unaffected)."
  - "WS emit block in server/scripts/build-openapi.ts stays commented out — un-commenting is DEFERRED to 17-03 Task 1 per plan's explicit directive (`Do NOT un-comment the WS emit block in build-openapi.ts yet`). This preserves the Go-side consumer activating the producer sequencing."
  - "No Rule 1-4 deviations required. Plan executed exactly as written — RESEARCH §Example 4 skeletons for jobs/pool/artifacts/streaming ws-schemas.ts and contracts/ws-messages.ts landed verbatim; 4 fixtures match their schemas on first write; TS round-trip spec passed all 13 tests on first run."

patterns-established:
  - "ws-schemas.ts naming convention — peer of events.ts + schemas.ts (established by Phase 16 pilot). Every future module that emits WS frames (Phase 22 streaming, Phase 23 jobs) adds one ws-schemas.ts with variants + discriminated-union + z.infer type."
  - ".meta({id: '...', description: '...'}) tag on every variant — unlocks z.registry() aggregation + Zod 4 native z.toJSONSchema() emission. Description is optional but encouraged for generated schema readability."
  - "Canonical fixture per variant under contracts/ws-fixtures/<name>.sample.json — the dual-lane (TS Vitest + Go `go test`) round-trip harness reads these same files so drift between lanes is impossible."
  - "Round-trip test shape: per-variant safeParse + discriminated-union dispatch + JSON.stringify → JSON.parse equality + at least 1 cross-variant rejection case. Proves the discriminator isn't accidentally losing signal AND the schemas are complete at the wire-format level."

requirements-completed: [SPEC-07]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 17 Plan 17-02: WebSocket Zod Schemas + Canonical Fixtures + TS Round-Trip Canary Summary

**Per-module ws-schemas.ts (jobs/pool/artifacts/streaming) + contracts/ws-messages.ts aggregator with z.registry (7 variants) + 4 canonical fixtures + server/websocket/__tests__/frames.spec.ts (13 tests) — TS lane of the dual round-trip harness green; Go lane lands in 17-03.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-20T18:48:03Z
- **Completed:** 2026-04-20T18:53:47Z
- **Tasks:** 3 (all three plan tasks completed atomically)
- **Files created:** 10 (4 ws-schemas.ts + 1 aggregator + 4 fixtures + 1 test)
- **Files modified:** 0

## Accomplishments

- Shipped the complete WS schema surface for Phase 17 Wave 1 — every module that emits WS frames now has a colocated ws-schemas.ts with Zod 4 discriminated unions and .meta({id:...}) tags, satisfying SPEC-07's "JSON Schema exported for WS protocol" requirement.
- Locked contracts/ws-messages.ts as the single import path for 17-03 (Go codegen) + 17-04 (web TS codegen) — 7 registered variants covering the 3 existing WS channels (jobs, device preview, artifact notifications) plus a generic envelope for Phase 22.
- Dual-lane round-trip harness (TS lane) is green — 13 tests pass against the 4 canonical fixtures with zero tweaks needed. The schema shapes in RESEARCH §Example 4 matched the fixture shapes on first write (no schema or fixture corrections required).
- Zero new typecheck errors — `npx tsc --noEmit` stayed at the 8-error baseline inherited from Phase 16 (tracked in deferred-items.md).

## Task Commits

Each task committed atomically:

1. **Task 1: Ship per-module ws-schemas.ts for jobs + pool + artifacts + streaming** — `07f8892` (feat)
2. **Task 2: Ship contracts/ws-messages.ts aggregator + canonical fixtures** — `b2f17f2` (feat)
3. **Task 3: Round-trip spec — frames.spec.ts parses + re-serializes every fixture** — `e99dcf5` (test)

_Plan metadata commit follows after this SUMMARY lands._

## Files Created/Modified

### Created

- `server/jobs/ws-schemas.ts` — jobLogMessage, jobStepMessage, jobStatusMessage variants; jobMessageUnion discriminated on `type`; `JobMessage` derived via z.infer; 3 .meta({id:...}) tags
- `server/pool/ws-schemas.ts` — devicePreviewMessage, deviceStateMessage variants; poolMessageUnion; `PoolMessage` type; 2 .meta({id:...}) tags
- `server/artifacts/ws-schemas.ts` — artifactCreatedMessage variant; artifactMessageUnion; `ArtifactMessage` type; 1 .meta({id:...}) tag
- `server/streaming/ws-schemas.ts` — wsEnvelopeSchema with `.loose()` (extra fields preserved for Phase 22 extension); `WsEnvelope` type; 1 .meta({id:...}) tag
- `contracts/ws-messages.ts` — z.registry aggregator; 7 add() calls (JobLogMessage, JobStepMessage, JobStatusMessage, DevicePreviewMessage, DeviceStateMessage, ArtifactCreatedMessage, WsEnvelope); re-exports each imported schema; anyWsMessage discriminated union; `AnyWsMessage` type
- `contracts/ws-fixtures/job-log.sample.json` — canonical `log` frame sample
- `contracts/ws-fixtures/job-step.sample.json` — canonical `step` frame sample
- `contracts/ws-fixtures/job-status.sample.json` — canonical `status` frame sample (status=`completed`)
- `contracts/ws-fixtures/device-preview.sample.json` — canonical `preview` frame sample (tiny 1px base64 PNG)
- `server/websocket/__tests__/frames.spec.ts` — 13 Vitest tests in 3 describe blocks (jobs, pool, cross-variant rejection); safeParse + union dispatch + round-trip equality + discriminator safety

### Modified

None.

## Decisions Made

1. **Zod schemas mirror the forward-looking wire shape, not the current runtime shape.** RESEARCH §Example 4 specifies flat schemas (`correlationId + jobId + level + message + timestamp` per variant), but the existing `server/streaming/types.ts` still defines a Phase 22 TODO shape (`JobMessage { type, data: unknown, timestamp }` with nested payload). The plan explicitly says "This plan does NOT wire schemas into runtime WS handlers (Phase 22 does that) — it only ships SHAPES + fixtures + round-trip coverage so downstream codegen works." A NOTE block in `server/jobs/ws-schemas.ts` records the divergence so the Phase 22 author cannot miss it when migrating the broadcaster. The 4 canonical fixtures also use the forward-looking shape.
2. **server/websocket/__tests__/ is a net-new directory for the round-trip spec.** The WS runtime plugin currently lives at `server/streaming/websocket-plugin.ts`. Creating `server/websocket/__tests__/` anticipates Phase 22's Streaming Module extraction and keeps the test file OUT of any existing module's `internal/` dir (dep-cruiser rules from Plan 16-03 are unaffected — the new test file imports from `../../jobs/ws-schemas.js` and `../../pool/ws-schemas.js`, both of which are at the module root, not under internal/).
3. **WS emit block in `server/scripts/build-openapi.ts` STAYS commented out.** The plan's Task 3 action explicitly says "Do NOT un-comment the WS emit block in build-openapi.ts yet — the sibling 17-03 plan will verify the Go lane reads contracts/ws-messages.json." Uncommenting is reserved for 17-03 Task 1 so the Go-side consumer activates the producer, preserving consumer-driven change discipline.
4. **Runtime broadcaster shape did not match RESEARCH §Example 4.** RESEARCH's schemas assume flat `{type, correlationId, jobId, level, message, timestamp}` frames, but `server/streaming/types.ts` still uses the pre-v3.0 nested `{type, data: unknown, timestamp}` envelope. Since this plan ships SHAPES for downstream codegen (not runtime wiring), the Zod schemas followed RESEARCH §Example 4 verbatim — the schemas become the forward contract that Phase 22 will retrofit the runtime to match. No fixture or schema corrections were needed because the round-trip test exercises only the fixture-schema pair, not the runtime broadcaster.
5. **`.loose()` on wsEnvelopeSchema does NOT break round-trip equivalence** — the test suite does not parse any fixture through the envelope schema (every canonical fixture has a concrete `type` literal, so it's parsed via the variant schema or discriminated union). If a future variant were added without a per-variant schema, the envelope would strip nothing because `.loose()` preserves unknown keys on parse AND `JSON.stringify` emits them back. The envelope is latent infrastructure for Phase 22.

## Deviations from Plan

None — plan executed exactly as written. RESEARCH §Example 4 skeletons for jobs/pool/artifacts/streaming ws-schemas.ts and contracts/ws-messages.ts landed verbatim; 4 fixtures match their schemas on first write; TS round-trip spec passed all 13 tests on first run.

## Issues Encountered

### `contracts/ws-messages/` directory pre-existing from Plan 17-00 vs. `contracts/ws-messages.ts` file in this plan

- Plan 17-00 scaffolded `contracts/ws-messages/` as a directory (with `.gitkeep`) reserved for emitted JSON output. Plan 17-02 adds `contracts/ws-messages.ts` as a file alongside it. Filesystem accepts both (directory name `ws-messages/` is distinct from file name `ws-messages.ts`); no collision. `contracts/ws-messages/.gitkeep` remains untouched and will house `ws-messages.json` after 17-03 activates the build-openapi emit block. Verified by `ls contracts/` showing both entries coexist.

### RESEARCH skeleton shape vs. runtime `JobMessage` divergence

- The Zod schemas and fixtures follow RESEARCH §Example 4's forward-looking wire shape. The current runtime `server/streaming/types.ts` still declares `JobMessage { type, data: unknown, timestamp }` (nested payload, no correlationId at the envelope level). This is intentional per plan scope (Phase 22 migrates runtime); noted in `server/jobs/ws-schemas.ts` header so the Phase 22 author catches it.

### Pre-existing typecheck errors (baseline preserved)

- `npx tsc --noEmit` reports 8 errors before and after this plan's work — unchanged. All 8 are Phase 15/16 baseline carry-overs tracked in `.planning/phases/17-contracts-pipeline-ops-hygiene/deferred-items.md`. Zero new errors introduced by the 4 ws-schemas.ts files, the aggregator, or the test.

## Full List of Variant Schemas Shipped

| Schema id                | Variant discriminator  | Module location            | Registered in wsMessageRegistry |
| ------------------------ | ---------------------- | -------------------------- | ------------------------------- |
| `JobLogMessage`          | `type: 'log'`          | server/jobs/ws-schemas.ts  | yes                             |
| `JobStepMessage`         | `type: 'step'`         | server/jobs/ws-schemas.ts  | yes                             |
| `JobStatusMessage`       | `type: 'status'`       | server/jobs/ws-schemas.ts  | yes                             |
| `DevicePreviewMessage`   | `type: 'preview'`      | server/pool/ws-schemas.ts  | yes                             |
| `DeviceStateMessage`     | `type: 'device.state'` | server/pool/ws-schemas.ts  | yes                             |
| `ArtifactCreatedMessage` | `type: 'artifact.created'` | server/artifacts/ws-schemas.ts | yes                         |
| `WsEnvelope`             | (generic `type: string`, `.loose()`) | server/streaming/ws-schemas.ts | yes                |

## Fixture Naming Convention Adopted

- Path: `contracts/ws-fixtures/<variant-name>.sample.json`
- Variant-name = kebab-case of the logical frame type: `job-log`, `job-step`, `job-status`, `device-preview`
- 2-space indent, trailing newline
- UUID conventions: all fixtures share `correlationId: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` (UUID v4 format — emphasizes that multiple frames in one logical flow share the same correlation id); job fixtures share `jobId: 11111111-2222-4333-8444-555555555555`; device fixture has its own `deviceId: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`. All are plausible UUID v4 shapes (correct version/variant nibbles) so Zod `z.string().uuid()` parses them cleanly.
- Timestamps are ISO-8601 with ms precision (`2026-04-17T14:23:01.123Z`) matching `z.string().datetime()`

## Plan for Un-commenting the WS Emit Block

- Deferred to Plan 17-03 Task 1 per this plan's explicit directive.
- Activation steps when 17-03 lands:
  1. Edit `server/scripts/build-openapi.ts`:
     - Remove `// TODO(17-02):` prefix from the `import { wsMessageRegistry } ...` line
     - Uncomment the 8-line WS JSON-Schema emit block (lines ~38-45)
     - Remove `void z` and `void mkdirSync` anchors (now used for real)
  2. Run `npm run openapi:generate` — should emit `contracts/ws-messages.json` alongside `server/openapi.json`
  3. Go test `cli/internal/types/generated_test.go` (landed by 17-03) reads the same 4 fixtures under `contracts/ws-fixtures/` — Go lane should be green once the codegen consumes the JSON Schema emitted from `wsMessageRegistry`

## Next Phase Readiness

- **Ready for Plan 17-03** (Go codegen). The aggregator, 7 registry entries, and 4 fixtures are in place. 17-03 Task 1 un-comments the WS emit block → `npm run openapi:generate` writes `contracts/ws-messages.json` → `go-jsonschema` + the hand-rolled `cli/internal/types/unions.go` (pattern locked in ADR-003) consume it. 17-03 also adds the Go round-trip test (`cli/internal/types/generated_test.go`) that reads the same 4 fixtures this plan just landed — when both lanes pass, the dual harness is complete.
- **Ready for Plan 17-04** (web TS codegen). `openapi-typescript` can import types from `contracts/ws-messages.ts` re-exports once the path is wired.
- **Ready for Phase 22** (Streaming Module migration). The ws-schemas.ts files are the forward contract the broadcaster will adopt; the NOTE block in `server/jobs/ws-schemas.ts` tells the Phase 22 author exactly what to retrofit.
- **No blockers.**

## Self-Check: PASSED

Verified:
- Created files on disk: `server/jobs/ws-schemas.ts`, `server/pool/ws-schemas.ts`, `server/artifacts/ws-schemas.ts`, `server/streaming/ws-schemas.ts`, `contracts/ws-messages.ts`, `contracts/ws-fixtures/{job-log,job-step,job-status,device-preview}.sample.json`, `server/websocket/__tests__/frames.spec.ts` — all present.
- Commits exist in git log: `07f8892` (Task 1), `b2f17f2` (Task 2), `e99dcf5` (Task 3) — all verified via `git log --oneline`.
- Plan verification block: 4 per-module ws-schemas.ts present; contracts/ws-messages.ts present; 4 fixtures present; typecheck at baseline (8 errors, 0 regressions); 13/13 Vitest tests pass in frames.spec.ts; hooks regression suite green (22 passed / 2 skipped); server/__tests__/ (2 skipped, pre-existing).

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*
