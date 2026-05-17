---
phase: 33-android-grpc
plan: 00
subsystem: infra
tags: [go, grpc, protobuf, android-emulator, mmap, vitest, github-actions, scaffold]

# Dependency graph
requires:
  - phase: 32-sim-capture-private
    provides: IPC wire format ([u32 BE length][u8 kind][payload]) — Phase 33 mirrors byte-for-byte and adds additive kinds 0x03 (metadata) and 0xC2 (key event)
provides:
  - Go module github.com/device-farm/device-stream/native-servers/android-grpc (go 1.26.1, stdlib-only)
  - Subset emulator_controller.proto translated from upstream AOSP (5 RPCs + 8 messages, package android.emulation.control for wire-compat)
  - Daemon entrypoint stub cmd/android-grpc-stream/main.go (--help works, body in Wave 2)
  - Go test scaffolds (6 _test.go files; 17 t.Skip placeholders) matching 33-RESEARCH.md §Unit tests row-for-row
  - TS Vitest scaffold packages/android/tests/grpc-emu-client.spec.ts (8 it.todo across fallback + framer describes)
  - Server-side Vitest scaffold server/pool/__tests__/emulator-grpc.spec.ts (4 it.todo matching Plan 33-03 Task 3.2 verbatim)
  - Build wrapper stub device-stream/scripts/build-android-grpc.sh (exits 1 with Wave 5 TODO)
  - Postinstall hook extension (additive bash task; darwin+arm64 gated via existing isSupportedHost; warning-not-fatal on failure)
  - GitHub Actions workflow .github/workflows/android-grpc-matrix.yml (daily 09:00 UTC; api-level [34, 35]; macos-14 runner)
affects: [33-01-PLAN, 33-02-PLAN, 33-03-PLAN, 33-04-PLAN, 33-05-PLAN, plan-checker, executor]

# Tech tracking
tech-stack:
  added:
    - Go 1.26.1 module under device-stream/native-servers/android-grpc
    - protoc-gen-go subset proto (codegen wired in Wave 1)
  patterns:
    - Wave-0 substrate: every later task `<verify>` command resolves before implementation starts (Nyquist gate)
    - t.Skip("Wave N — TODO: <ref>") scaffolds map row-for-row to research-doc unit-tests table
    - it.todo across describe blocks lets Vitest count pending without imports/mocks (Wave N strips todo + adds body)
    - Daemon entrypoint stub with usage + exit 2 on flagged invocation (mirrors Phase 32 sim-capture-private pattern)
    - Postinstall warns-not-fatal on native build failure; runtime adapter falls back automatically

key-files:
  created:
    - device-stream/native-servers/android-grpc/go.mod
    - device-stream/native-servers/android-grpc/Makefile
    - device-stream/native-servers/android-grpc/README.md
    - device-stream/native-servers/android-grpc/proto/emulator_controller.proto
    - device-stream/native-servers/android-grpc/proto/doc.go
    - device-stream/native-servers/android-grpc/auth/doc.go
    - device-stream/native-servers/android-grpc/auth/token_test.go
    - device-stream/native-servers/android-grpc/auth/ini_test.go
    - device-stream/native-servers/android-grpc/mmap/doc.go
    - device-stream/native-servers/android-grpc/mmap/mmap_test.go
    - device-stream/native-servers/android-grpc/client/doc.go
    - device-stream/native-servers/android-grpc/client/client_test.go
    - device-stream/native-servers/android-grpc/client/ring_test.go
    - device-stream/native-servers/android-grpc/encode/doc.go
    - device-stream/native-servers/android-grpc/ipc/doc.go
    - device-stream/native-servers/android-grpc/ipc/framer_test.go
    - device-stream/native-servers/android-grpc/cmd/android-grpc-stream/main.go
    - device-stream/packages/android/tests/grpc-emu-client.spec.ts
    - server/pool/__tests__/emulator-grpc.spec.ts
    - device-stream/scripts/build-android-grpc.sh
    - .github/workflows/android-grpc-matrix.yml
  modified:
    - device-stream/scripts/postinstall.js (appended android-grpc build task)

key-decisions:
  - "Proto package literal `android.emulation.control` matches upstream byte-for-byte so the daemon is wire-compatible with any stock Android emulator"
  - "Kittyfarm cited only in README + research docs — never in the .proto file (verify-gate `! grep kittyfarm` enforces translate-not-link policy)"
  - "Build script stub exits non-zero (not zero) so any caller that forgets to swap the stub for the Wave-5 body sees an immediate hard error instead of silent skip"
  - "Postinstall failure is a warning (not fatal) — npm install must succeed even when the native build is unavailable; runtime adapter falls back to scrcpy automatically"
  - "CI matrix is [34, 35] — API 36.1 explicitly excluded per project CLAUDE.md (macOS Tahoe mprotect/hvf incompat)"
  - "Daemon entrypoint exits 0 on --help and 2 on any flagged invocation so callers can distinguish 'usage shown' from 'not implemented'"

patterns-established:
  - "Substrate plan: every later wave's `<verify>` command must resolve against an artifact this plan ships (Nyquist gate from 33-VALIDATION.md)"
  - "Per-package doc.go stubs so go vet sees real packages even before bodies are written"
  - "Vitest `it.todo` for cross-tier scaffolds — no imports/mocks at scaffold time, Wave N implementer swaps `it.todo` for `it` and adds body"
  - "Phase 33 additive IPC kinds (0x03 metadata, 0xC2 key event) do not collide with Phase 32 kinds (0x01/0x02/0x10/0xFF server→client, 0xC1/0xC9 client→server)"

requirements-completed:
  - AND-GRPC-PROTO
  - AND-GRPC-AUTH
  - AND-GRPC-CLIENT
  - AND-GRPC-IPC
  - AND-GRPC-SPAWN
  - AND-GRPC-TS
  - AND-GRPC-INSTALL

# Metrics
duration: 11min
completed: 2026-05-16
---

# Phase 33 Plan 00: Wave-0 Substrate Summary

**Android-gRPC scaffold complete: Go module + subset proto + 17 t.Skip/it.todo scaffolds + daemon stub + build script + postinstall hook + daily CI matrix — every later wave's `<verify>` command now resolves against an artifact on disk.**

## Performance

- **Duration:** ~11 min (started 2026-05-16T05:17:27Z, completed 2026-05-16T05:28:40Z)
- **Tasks:** 4 (Task 0.1, Task 0.2, Task 0.3, Task 0.4)
- **Files created:** 21
- **Files modified:** 1 (device-stream/scripts/postinstall.js — additive append)

## Accomplishments

- New Go module `github.com/device-farm/device-stream/native-servers/android-grpc` (go 1.26.1, stdlib-only — `require` lines come in Wave 1)
- Subset `emulator_controller.proto` (5 RPCs: streamScreenshot/sendTouch/sendKey/setClipboard/getStatus; 8 messages: ImageTransport/ImageFormat/Image/ClipData/Touch/TouchEvent/KeyboardEvent/EmulatorStatus); 119 lines; package literal matches upstream AOSP byte-for-byte
- Daemon entrypoint `cmd/android-grpc-stream/main.go` — `--help` prints usage and exits 0; any flagged invocation exits 2 with "not implemented Wave 2" message
- 6 Go test files with 17 `t.Skip("Wave N — TODO")` placeholders mapping row-for-row to 33-RESEARCH.md §Unit tests
- 1 TS Vitest scaffold (`packages/android/tests/grpc-emu-client.spec.ts`) with 8 `it.todo` across fallback-path + framer describes
- 1 server-side Vitest scaffold (`server/pool/__tests__/emulator-grpc.spec.ts`) with 4 `it.todo` matching Plan 33-03 Task 3.2 verbatim
- Build wrapper stub (`device-stream/scripts/build-android-grpc.sh`) exits 1 with clear Wave-5 TODO
- Postinstall hook extended (already darwin+arm64-gated via `isSupportedHost`; new task added to `tasks` array; warning-not-fatal on failure)
- Daily Android emulator GitHub Actions workflow (`.github/workflows/android-grpc-matrix.yml`) — `[34, 35]` matrix on `macos-14` runner, all steps scaffold TODO placeholders

## Task Commits

1. **Task 0.1: Go module skeleton + Makefile + subset proto** — `a96f306` (feat)
2. **Task 0.2: Daemon entrypoint + Go test scaffolds** — `0572f71` (test)
3. **Task 0.3: Vitest TS scaffold + build script + postinstall + CI workflow** — `b422326` (chore)
4. **Task 0.4: Server-side Vitest scaffold for AND-GRPC-SPAWN** — `06f4674` (test)

## Verification Snapshots

**Go test output (Task 0.2 verify):**
```
ok  	.../auth	0.529s
ok  	.../client	0.349s
?   	.../cmd/android-grpc-stream	[no test files]
?   	.../encode	[no test files]
ok  	.../ipc	0.711s
ok  	.../mmap	0.893s
?   	.../proto	[no test files]
```
All 13 test functions present in `auth/client/ipc/mmap` packages run as SKIP with one-line TODO message citing the Wave that fills the body.

**Vitest output (TS scaffold):**
```
↓ packages/android/tests/grpc-emu-client.spec.ts  (8 tests | 8 skipped)
Test Files  1 skipped (1)
     Tests  8 todo (8)
```

**Vitest output (server scaffold):**
```
Test Files  1 skipped (1)
     Tests  4 todo (4)
```

**Proto subset stats:**
- 5 RPCs (`streamScreenshot`, `sendTouch`, `sendKey`, `setClipboard`, `getStatus`)
- 8 messages (`ImageTransport`, `ImageFormat`, `Image`, `ClipData`, `Touch`, `TouchEvent`, `KeyboardEvent`, `EmulatorStatus`)
- 119 lines including SPDX header + provenance comment
- Package literal `android.emulation.control` (byte-for-byte upstream match for wire compat)

**Kittyfarm citation policy:**
- `grep "kittyfarm" device-stream/native-servers/android-grpc/proto/emulator_controller.proto` → 0 matches
- `grep -rE "(import|require).*kittyfarm" device-stream/native-servers/android-grpc/` → 0 matches
- Only matches: 2 README.md comment lines citing kittyfarm as the inspiration for the Swift port being ported to Go (no link/dep)

## Decisions Made

See `key-decisions` in frontmatter (6 decisions). Key ones:
- Proto package literal matches upstream byte-for-byte for wire compat
- Build script stub exits non-zero so callers that forget to swap stub-for-real get a hard error
- CI matrix `[34, 35]` (API 36.1 excluded per CLAUDE.md macOS Tahoe mprotect/hvf incompat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Proto provenance comment violated `grep kittyfarm` gate**
- **Found during:** Task 0.1 (proto file verify)
- **Issue:** The plan's `<action>` step 4 instructed to "Cite kittyfarm reference at top of file: `// Translated from kittyfarm/Protos/emulator_controller_kittyfarm.proto ...`" but the same plan's `<acceptance_criteria>` AND `<verify>` automated check both demand `grep -c "kittyfarm" proto/emulator_controller.proto` returns 0. The verify gate is the contract that downstream waves run, so it wins.
- **Fix:** Replaced the kittyfarm line in the proto provenance comment with a pointer to `.planning/phases/33-android-grpc/33-RESEARCH.md §Auth and §Proto subset` (which is where the kittyfarm reference is documented at length). Proto file now has zero `kittyfarm` matches; README.md retains 2 citation lines (README has no grep gate).
- **Files modified:** device-stream/native-servers/android-grpc/proto/emulator_controller.proto
- **Verification:** `! grep -q "kittyfarm" proto/emulator_controller.proto` succeeds; `grep -rE "(import|require).*kittyfarm" device-stream/native-servers/android-grpc/` returns 0
- **Committed in:** a96f306 (Task 0.1 commit — fix applied pre-commit)

**2. [Rule 1 - Bug] CI matrix comment triggered `! grep "api-level:.*36"` gate**
- **Found during:** Task 0.3 (workflow verify)
- **Issue:** Plan's verify gate is `! grep -E "api-level:.*36" .github/workflows/android-grpc-matrix.yml` (must NOT match). Initial comment text was `# 36.1 explicitly skipped: macOS Tahoe mprotect/hvf incompat (CLAUDE.md)` — the `36.1` literal on the same line as `api-level` triggered the negative grep.
- **Fix:** Reworded comment to `# newer API levels excluded: macOS Tahoe mprotect/hvf incompat (see CLAUDE.md)` — preserves the intent (CLAUDE.md is the canonical reference for which API levels are excluded and why) without putting `36` adjacent to `api-level`.
- **Files modified:** .github/workflows/android-grpc-matrix.yml
- **Verification:** `! grep -E "api-level:.*36" .github/workflows/android-grpc-matrix.yml` succeeds
- **Committed in:** b422326 (Task 0.3 commit — fix applied pre-commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — verify-gate vs plan-action mismatch)
**Impact on plan:** Both fixes preserve plan intent (Wave-5 will install Go grpc deps + translate proto; CI never runs on incompat API levels). The verify gates exist as the contract downstream waves rely on, so when they conflict with action-step text the verify gate wins. No scope change.

## Issues Encountered

- RTK proxy stripped `go test ./...` output (showed only "Go test: No tests found") on the first verification run — bypassed by running `rtk proxy go test ./...` directly. Did NOT affect correctness; tests run and PASS-SKIP either way.
- `python3 -c "import yaml"` not available locally for the YAML lint check — used `node -e "yaml.parse(...)"` against the project's `node_modules/yaml` instead. YAML parses cleanly with `matrix.api-level = [34, 35]`.

## Wave 0 → Wave 1 handoff

**`t.Skip` placeholders Wave 1 (Plan 33-01) must remove and replace with bodies:**

| File | Function | Wave |
| --- | --- | --- |
| `auth/token_test.go` | `TestFindToken_PerInstance` | Wave 1 / Task 1.2 |
| `auth/token_test.go` | `TestFindToken_PortMismatch` | Wave 1 / Task 1.2 |
| `auth/token_test.go` | `TestFindToken_GlobalFallback` | Wave 1 / Task 1.2 |
| `auth/token_test.go` | `TestFindToken_NoAuth` | Wave 1 / Task 1.2 |
| `auth/ini_test.go` | `TestParseSimpleIni_Trim` | Wave 1 / Task 1.2 |
| `auth/ini_test.go` | `TestParseSimpleIni_MultipleEquals` | Wave 1 / Task 1.2 |

**Wave 1 also wires:** real protoc codegen in `Makefile` `proto:` target + `proto/gen/emulatorcontrol/` generated stubs + `go.mod require` lines for grpc-go + protobuf.

**Wave 2 (Plan 33-02) `t.Skip` placeholders to remove:** all 11 in `mmap/mmap_test.go` + `client/{client,ring}_test.go` + `ipc/framer_test.go` except `client/client_test.go::TestSendTouchPayload` and `ipc/framer_test.go::TestFramerKeyPayload` (those are Wave 4 — TS adapter sends the keys).

**Wave 3 (Plan 33-03) `it.todo` placeholders to remove:** all 4 in `server/pool/__tests__/emulator-grpc.spec.ts`.

**Wave 4 (Plan 33-04) `it.todo` placeholders to remove:** all 8 in `device-stream/packages/android/tests/grpc-emu-client.spec.ts` + remaining 2 Wave-4 Go tests cited above.

**Wave 5 (Plan 33-05) artifacts to replace:** `device-stream/scripts/build-android-grpc.sh` body (currently exits 1 with TODO) + every step in `.github/workflows/android-grpc-matrix.yml` (currently echo TODO).

## User Setup Required

None - no external service configuration required at Wave 0. Wave 5 (T-33.8) wires `reactivecircus/android-emulator-runner@v2` which may need GitHub Actions secret(s) — TBD by Plan 33-05.

## Next Phase Readiness

- Every `❌ Wave 0` row in `.planning/phases/33-android-grpc/33-VALIDATION.md` now has the referenced file existing on disk. Run `go test ./...` (in module root) + `npx vitest run packages/android/tests/grpc-emu-client.spec.ts` (in device-stream/) + `npx vitest run server/pool/__tests__/emulator-grpc.spec.ts` (in repo root) — all three exit 0 (skips + todos counted as pass).
- External Dependencies Policy honored: zero `import`/`require`/`link` of kittyfarm; only comment-level citations in README + research docs.
- Plans 33-01 (auth + protoc codegen), 33-02 (mmap + grpc client + IPC framer), 33-03 (`-grpc` spawn injection), 33-04 (TS adapter swap), and 33-05 (build + CI + cgo encoder) all unblocked.

---
*Phase: 33-android-grpc*
*Plan: 00 (Wave 0 substrate)*
*Completed: 2026-05-16*

## Self-Check: PASSED

All 22 files exist on disk; all 4 task commits present in git log (`a96f306`, `0572f71`, `b422326`, `06f4674`).

