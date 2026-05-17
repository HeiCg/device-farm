---
phase: 17-contracts-pipeline-ops-hygiene
plan: 04
subsystem: contracts
tags: [go, go-jsonschema, json-schema, codegen, zod, discriminated-union, cli, adr-003]

# Dependency graph
requires:
  - phase: 17-contracts-pipeline-ops-hygiene
    provides: contracts/ws-messages.json (Plan 17-03) + ADR-003 (Plan 17-00)
provides:
  - cli/internal/types/generated.go — 43 Go types from 7 WS schemas
  - cli/internal/types/unions.go — hand-rolled JobMessage discriminator wrapper
  - scripts/extract-ws-schemas.mjs — flattener adapter for go-jsonschema
  - `make -C cli types` + `make -C cli types-check` (CI drift guard)
  - Green Go round-trip test suite against all 4 canonical WS fixtures
  - Dual-lane harness complete (TS + Go both proven field-lossless)
affects: [phase-22-streaming, phase-28-cli-refactor, phase-23-jobs]

# Tech tracking
tech-stack:
  added:
    - github.com/atombender/go-jsonschema@v0.23.0 (dev tool, go install)
    - github.com/go-viper/mapstructure/v2 v2.5.0 (transitive via generated.go)
  patterns:
    - Adapter-script bridge between Zod registry emission and legacy JSON Schema
      tooling (scripts/extract-ws-schemas.mjs — rewrite refs + strip hostile
      keywords)
    - Discriminator-peek + switch pattern for Go-side discriminated unions
      (hand-rolled wrapper; generated structs decode flat payloads)
    - `make types-check` CI drift guard: regenerate then `git diff --quiet`

key-files:
  created:
    - scripts/extract-ws-schemas.mjs
    - cli/internal/types/generated.go
    - cli/internal/types/unions.go
    - cli/internal/types/generated_test.go
  modified:
    - cli/Makefile
    - cli/go.mod
    - cli/go.sum

key-decisions:
  - "scripts/extract-ws-schemas.mjs rewrites __shared#/$defs/* refs to #/definitions/* (go-jsonschema cannot resolve the non-standard __shared# fragment uri)"
  - "Extractor strips `format: date-time` so timestamps decode as plain string, not time.Time (go-jsonschema v0.23 emits `type SchemaN time.Time` which drops time.Time.UnmarshalJSON via named-type aliasing)"
  - "Use `definitions` (draft-07 keyword) instead of `$defs` in the extracted document for broader tool compatibility; go-jsonschema handles both"
  - "Hand-rolled unions.go scope limited to JobMessage (log/step/status); Pool (preview/device.state) and Artifact (artifact.created) channels are single-variant and decode directly through their generated structs"
  - "go-jsonschema invoked via `-p types -o internal/types/generated.go` (not the `--schema-output URI=FILENAME` syntax from the plan — simpler and sufficient when there is only one output file)"
  - "Makefile `types` target runs `go mod tidy` after codegen so the generator's transitive deps (mapstructure) land in go.mod automatically on first run"

patterns-established:
  - "Extractor-adapter pattern: committed generator output is reversible, input schemas are owned by producers — keeps contracts/ws-messages.json as canonical source"
  - "TDD round-trip test: decode fixture → re-marshal → normalize via map → compare (tolerant of JSON key ordering)"
  - "Unknown-discriminator = hard error (ADR-003 Consequences): Go wrapper never silently drops frames the server added after the CLI was built"

requirements-completed: [CLI-01, CLI-02, CLI-03]

# Metrics
duration: 10min
completed: 2026-04-20
---

# Phase 17 Plan 04: Go Codegen Pipeline Summary

**Zod → OpenAPI-shaped JSON Schema → go-jsonschema → hand-rolled discriminator wrapper — dual-lane harness (TS frames.spec 13 tests + Go generated_test 5 tests) proven field-lossless against all 4 canonical WS fixtures.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-20T20:45:18Z
- **Completed:** 2026-04-20T20:55:00Z
- **Tasks:** 5 (one TDD task → RED + GREEN commits = 6 commits total for task work, +1 metadata)
- **Files created:** 4 (extractor, generated, unions, test)
- **Files modified:** 3 (Makefile, go.mod, go.sum)

## Accomplishments

- **CLI-01 closed:** `make -C cli types` regenerates `cli/internal/types/generated.go` from `contracts/ws-messages.json`. 43 Go types emitted from 7 WS schemas + 36 shared ref-targets. Package builds clean under `go build ./...`.
- **CLI-02 closed:** `make -C cli types-check` target runs the generator and exits non-zero if the committed `generated.go` drifts from the freshly-produced output. Ready for CI wiring.
- **CLI-03 closed:** `cli/internal/types/unions.go` implements the ADR-003-locked `JobMessage` discriminator wrapper (discriminator peek → switch → typed pointer). Unknown discriminators hard-error per ADR-003 Consequences.
- **Dual-lane proof:** Go round-trip test decodes all 4 canonical `contracts/ws-fixtures/*.sample.json` files through the generated types + union wrapper without field loss. TS lane (`server/websocket/__tests__/frames.spec.ts`, 13 tests) remains green. End-to-end Zod → OpenAPI → Go pipeline verified.

## Task Commits

1. **Task 1: scripts/extract-ws-schemas.mjs** — `353cede` (feat)
2. **Task 2: cli/Makefile types + types-check** — `412d72b` (chore)
3. **Task 3: generate cli/internal/types/generated.go** — `1844e3e` (feat)
4. **Task 4: cli/internal/types/unions.go (ADR-003)** — `6209606` (feat)
5. **Task 5 RED: generated_test.go round-trip suite** — `41ff1ba` (test)
6. **Task 5 GREEN: strip format:date-time in extractor** — `20e5fa8` (fix)

**Plan metadata:** landed in the final commit alongside STATE.md + ROADMAP.md updates.

## Files Created/Modified

- `scripts/extract-ws-schemas.mjs` — Node ESM adapter: normalizes `contracts/ws-messages.json` (Zod 4 registry shape with `schemas.*` + `__shared.$defs.*`) into a flat draft-2020-12 document with unified `definitions` table and local `#/definitions/*` refs. Strips `format: date-time` to keep timestamps as `string` on the Go side.
- `cli/Makefile` — adds `types` + `types-check` targets; extends `.PHONY`; preserves all existing targets (`build`, `test`, `test-race`, `install`, `clean`); captures `REPO_ROOT` via `$(shell cd .. && pwd)` so targets work from both `make -C cli` and inside `cli/`.
- `cli/internal/types/generated.go` — 949 lines of generator output (43 types). Includes per-field required-field validation + enum/pattern regex checks from go-jsonschema's auto-emitted `UnmarshalJSON` methods. Marked `DO NOT EDIT` (linguist-generated=true already set in Plan 17-00).
- `cli/internal/types/unions.go` — hand-rolled `JobMessage` struct (Type + Log/Step/Status pointers) with discriminator-peek `UnmarshalJSON` and variant-dispatch `MarshalJSON`. 90 lines.
- `cli/internal/types/generated_test.go` — 143-line test suite: `TestJobMessageRoundTrip` (3 subtests) + `TestDevicePreviewDecode` + `TestUnknownDiscriminator`.
- `cli/go.mod` / `cli/go.sum` — gained `github.com/go-viper/mapstructure/v2 v2.5.0` via `go mod tidy` (transitive dep of generated validators).

## Decisions Made

- **`#/definitions/` over `#/$defs/` in extracted doc.** Both work with go-jsonschema, but `definitions` is the older draft-07 keyword supported by more tools; future-proofs the extractor against tool changes.
- **Ref-rewriting instead of schema merge.** The extractor preserves each named schema's structure (just relocates refs) rather than inlining shared defs. Keeps the output readable and each schema independently identifiable in the `definitions` table.
- **Strip `format: date-time` in the adapter, not the Zod schemas.** Zod-side `z.iso.datetime()` (or equivalent) keeps TS-side validation strict; the adapter is the one-way bridge, so stripping a single problematic JSON Schema annotation there is cheaper than altering producer schemas.
- **`make types` runs `go mod tidy` automatically.** First-time regeneration pulls in go-jsonschema's transitive `mapstructure` dep without manual intervention; subsequent idempotent runs are no-ops.
- **Scope of unions.go kept minimal.** Only `JobMessage` (3 variants) gets a hand-rolled wrapper. `DevicePreviewMessage`, `DeviceStateMessage`, `ArtifactCreatedMessage` each have a single `type` literal — decoded directly into their generated structs with no wrapper needed. Reduces maintenance surface: one wrapper to evolve, not three.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stripped `format: date-time` in extractor so timestamps stay `string`**
- **Found during:** Task 5 (RED phase of TDD)
- **Issue:** go-jsonschema v0.23 maps `format: date-time` to `type SchemaN time.Time`. Named-type aliasing a struct type in Go drops the aliased type's JSON methods, so `time.Time.UnmarshalJSON` is NOT inherited. The default decoder then fails with `cannot unmarshal string into Go struct field Plain.timestamp of type types.Schema5`. Two tests failed (log variant + device-preview).
- **Fix:** Added a post-processing step in `scripts/extract-ws-schemas.mjs` that walks the `sharedDefs` and deletes `format: 'date-time'`. The co-emitted `pattern:` regex (full RFC-3339 from Zod 4) still enforces wire-shape validation.
- **Files modified:** `scripts/extract-ws-schemas.mjs`, `cli/internal/types/generated.go` (regenerated)
- **Verification:** `cd cli && go test ./internal/types/... -v -count=1` green across all 5 assertions; dual-lane harness still green (TS 13 tests + Go 5 tests).
- **Committed in:** `20e5fa8` (Task 5 GREEN commit)

**2. [Rule 3 - Blocking] Installed go-jsonschema locally; adjusted Makefile invocation syntax**
- **Found during:** Task 3 (generator run)
- **Issue:** `go-jsonschema` was not on PATH (`which go-jsonschema` → not found). The plan suggested `go install github.com/atombender/go-jsonschema/cmd/go-jsonschema@latest` but upstream moved the binary entry point — that path no longer exists. Also, the plan's `--schema-output=default=<path>` flag syntax does not match v0.23's actual `URI=FILENAME` format when there is no explicit root `$id`.
- **Fix:** (a) `go install github.com/atombender/go-jsonschema@latest` (top-level module path — binary now lands at `~/go/bin/go-jsonschema`). (b) Makefile target uses the simpler `-p types -o internal/types/generated.go $(WS_SCHEMAS)` invocation which achieves the same single-file output without the URI-mapping dance. (c) Invoked `make types` with `PATH="$HOME/go/bin:$PATH"` for this run; the Makefile itself relies on user PATH configuration and documents the install step in a comment.
- **Files modified:** `cli/Makefile`
- **Verification:** `make -C cli types` succeeds end-to-end; `make -C cli types-check` reports no drift.
- **Committed in:** `412d72b` (Task 2 commit, Makefile shape)

---

**Total deviations:** 2 auto-fixed (1 bug in generator output, 1 blocking install/invocation-syntax issue)
**Impact on plan:** Both auto-fixes preserve the plan's intent. The date-time fix is essential for round-trip correctness — without it the must-haves truth "decodes all 4 fixtures without field loss" fails. The Makefile syntax adjustment is a lower-friction path to the same output file.

## Issues Encountered

- **Zod 4 emission shape surprise.** `contracts/ws-messages.json` used `schemas: {...}` at top level with a sibling `__shared.$defs.*` bucket holding ref-targets, and refs written as `__shared#/$defs/schemaN` (non-standard JSON Schema fragment). The plan anticipated a `$defs`- or `definitions`-keyed shape. The extractor accepts all three input shapes and rewrites the `__shared#` refs — documented inline with Zod 4's observed behaviour (2026-04-20).
- **go-jsonschema's Schema<N> naming for shared refs.** The generator emits `type Schema0 string` (with const-value validation), `type Schema5 string` (timestamp), etc., for each shared def. This makes the struct fields' types feel opaque (`CorrelationId Schema1` instead of `CorrelationId string`), but it *does* preserve the const/enum/pattern constraints at decode time via per-type `UnmarshalJSON`. Ergonomic tradeoff accepted — we could rename via `--struct-name-from-title` but the shared defs don't carry title annotations. Phase 28 (CLI refactor) can revisit.

## User Setup Required

None — `go install github.com/atombender/go-jsonschema@latest` is the one-time developer environment setup, documented as a comment in the `types` target. CI equivalents will install via the same `go install` step.

## Next Phase Readiness

- **Plan 17-08 (final Phase 17 plan) unblocked.** Phase 17 Contracts Pipeline is one plan short of complete (17-04 done here, 17-08 remaining per STATE.md).
- **Phase 22 Streaming Module will consume unions.go.** When the broadcaster migrates to the flat payload shape (correlationId + per-variant payloads), the Go CLI already has the matching discriminator wrapper — no round-trip work needed on the Go side.
- **Phase 28 CLI Refactor inherits a stable type surface.** Adding a new WS variant is a 4-step recipe (documented in unions.go's header comment): update schemas → add fixture → add union arm → add test case.
- **CI drift guard (`make types-check`) ready to wire.** A `.github/workflows/*.yml` step invoking `make -C cli types-check` would catch any drift between `contracts/ws-messages.json` changes and the committed Go types.

## Self-Check: PASSED

All 6 committed files verified on disk:
- scripts/extract-ws-schemas.mjs
- cli/Makefile
- cli/internal/types/generated.go
- cli/internal/types/unions.go
- cli/internal/types/generated_test.go
- .planning/phases/17-contracts-pipeline-ops-hygiene/17-04-SUMMARY.md

All 6 commit hashes verified in git log:
- 353cede (Task 1), 412d72b (Task 2), 1844e3e (Task 3), 6209606 (Task 4),
  41ff1ba (Task 5 RED), 20e5fa8 (Task 5 GREEN)

---
*Phase: 17-contracts-pipeline-ops-hygiene*
*Completed: 2026-04-20*
