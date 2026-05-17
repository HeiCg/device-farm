---
phase: 33-android-grpc
plan: 01
subsystem: infra
tags: [go, grpc, protobuf, codegen, android-emulator, auth, tdd, wave-1]

# Dependency graph
requires:
  - phase: 33-android-grpc
    plan: 00
    provides: Go module skeleton + subset emulator_controller.proto + 6 t.Skip auth test scaffolds — Wave 1 fills the bodies
provides:
  - Idempotent `make proto` target wired to protoc-gen-go v1.36.11 + protoc-gen-go-grpc v1.6.2
  - Generated EmulatorControllerClient interface (5 RPCs) at proto/gen/emulatorcontrol/emulator_controller_grpc.pb.go
  - Generated message types (Image, ImageFormat, TouchEvent, KeyboardEvent, ClipData, EmulatorStatus, ...) at proto/gen/emulatorcontrol/emulator_controller.pb.go
  - auth.FindToken(grpcPort) (string, error) — kittyfarm 3-step lookup port
  - auth.parseSimpleIni — flat INI parser handling multi-`=` values
  - google.golang.org/grpc v1.81.1 + google.golang.org/protobuf v1.36.11 added to go.mod
affects:
  - 33-02-PLAN (Wave 2 can now `import pb "...android-grpc/proto/gen/emulatorcontrol"` + `import "...android-grpc/auth"`)
  - 33-03-PLAN, 33-04-PLAN, 33-05-PLAN (downstream waves unblocked)

# Tech tracking
tech-stack:
  added:
    - google.golang.org/grpc v1.81.1 (Go gRPC runtime)
    - google.golang.org/protobuf v1.36.11 (protobuf runtime + emptypb transitively)
    - protoc 34.1 (homebrew, build-time only — not a runtime dep)
    - protoc-gen-go (latest, build-time)
    - protoc-gen-go-grpc v1.6.2 (build-time)
  patterns:
    - Generated stubs committed in-tree (AOSP precedent + Wave 0 decision)
    - paths=source_relative with output dir matching go_package path so codegen is fully self-contained and idempotent
    - check-tools Makefile prerequisite gates `make proto` with actionable install instructions
    - kittyfarm citations live in `//` comments only — zero `import`/`require` lines (External Dependencies Policy)
    - TDD RED → GREEN split commits (e6eba26 tests-fail → 5fef094 tests-pass) so blame shows the test→impl handshake

key-files:
  created:
    - device-stream/native-servers/android-grpc/auth/ini.go
    - device-stream/native-servers/android-grpc/auth/token.go
    - device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol/emulator_controller.pb.go
    - device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol/emulator_controller_grpc.pb.go
    - device-stream/native-servers/android-grpc/go.sum
  modified:
    - device-stream/native-servers/android-grpc/Makefile (replaced Wave 0 stub `proto:` target with real protoc invocation + check-tools gate)
    - device-stream/native-servers/android-grpc/go.mod (added grpc + protobuf deps)
    - device-stream/native-servers/android-grpc/auth/ini_test.go (replaced 2 t.Skip with 3 real tests)
    - device-stream/native-servers/android-grpc/auth/token_test.go (replaced 4 t.Skip with 4 real tests)

key-decisions:
  - "Set Makefile PROTO_OUT to proto/gen/emulatorcontrol (not just proto/gen) so paths=source_relative output lands in the directory matching the go_package option — keeps codegen one-shot and idempotent"
  - "Provenance/SPDX header lives in the .proto source file only, NOT in generated .pb.go files (editing generated files would break idempotency)"
  - "TDD RED commit kept separate from GREEN — preserves the 'tests fail without impl' proof in git history; refactor step skipped (impl already minimal)"
  - "ENOENT on either lookup path is non-fatal: perInstanceToken returns ('', nil) when running/ doesn't exist so globalToken can run; globalToken returns ('', nil) when ~/.emulator_console_auth_token doesn't exist so FindToken returns ('', nil) overall — matches kittyfarm's 'auth-disabled emulator' semantics"
  - "Linux path divergence (~/.android/avd/running/) noted as TODO(phase-37+) — Phase 33 is macOS-only per CLAUDE.md"

requirements-completed:
  - AND-GRPC-PROTO
  - AND-GRPC-AUTH

# Metrics
duration: 15min
completed: 2026-05-16
---

# Phase 33 Plan 01: Wave 1 (auth + protoc codegen) Summary

**Wave 1 complete: protoc codegen wired into `make proto` producing EmulatorControllerClient with all 5 RPCs (StreamScreenshot, SendTouch, SendKey, SetClipboard, GetStatus); auth.FindToken implements kittyfarm's 3-step lookup (per-instance pid_*.ini → global ~/.emulator_console_auth_token → empty) — all 7 unit tests pass under -race; codegen is fully idempotent.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 (Task 1.1 protoc + Task 1.2 auth TDD)
- **Commits:** 3 (1 feat for codegen + 1 test for RED + 1 feat for GREEN)
- **Generated LOC:** ~1,352 (emulator_controller.pb.go 1060 + emulator_controller_grpc.pb.go 292)
- **Source LOC:** 102 (auth/token.go 78 + auth/ini.go 24)

## Accomplishments

### Task 1.1 — `make proto` codegen + EmulatorController stubs

- Installed `protobuf 34.1` (homebrew), `protoc-gen-go` (latest), `protoc-gen-go-grpc v1.6.2`
- Replaced Wave 0 stub `proto:` target with real `protoc -I proto --go_out=$(PROTO_OUT) ... --go-grpc_out=$(PROTO_OUT) ... emulator_controller.proto`
- Added `check-tools` prerequisite gate with actionable install instructions
- `make proto` now produces:
  - `proto/gen/emulatorcontrol/emulator_controller.pb.go` (1060 LOC — Image, ImageFormat, TouchEvent, KeyboardEvent, ClipData, EmulatorStatus, ImageTransport, Touch, plus enum + descriptor tables)
  - `proto/gen/emulatorcontrol/emulator_controller_grpc.pb.go` (292 LOC — EmulatorControllerClient interface + NewEmulatorControllerClient constructor + EmulatorControllerServer interface)
- Added `google.golang.org/grpc v1.81.1` and `google.golang.org/protobuf v1.36.11` to go.mod (emptypb pulled transitively)
- Idempotency verified: `make proto && git diff --exit-code proto/gen/` → clean

### Task 1.2 — auth.FindToken + parseSimpleIni (TDD)

- RED: 7 new test cases (4 FindToken + 3 parseSimpleIni) — all fail at build time (`undefined: FindToken/parseSimpleIni`) — commit `e6eba26`
- GREEN: ~102 LOC across `auth/token.go` + `auth/ini.go` — all 7 tests pass — commit `5fef094`
- Tests use `t.Setenv("HOME", t.TempDir())` for filesystem isolation — zero coupling to developer's real `~/Library/Caches`
- `FindToken` implements kittyfarm's 3-step lookup with ENOENT-safe fallback chain
- `parseSimpleIni` correctly handles values containing `=` (split on FIRST `=` only via `strings.IndexByte`)

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Task 1.1: `make proto` codegen wired + generated stubs committed in-tree | `df64d6e` | feat |
| 2 | Task 1.2 RED: failing auth tests | `e6eba26` | test |
| 3 | Task 1.2 GREEN: FindToken + parseSimpleIni implementation | `5fef094` | feat |

## Verification Snapshots

### Generated EmulatorControllerClient signatures

```go
type EmulatorControllerClient interface {
    StreamScreenshot(ctx context.Context, in *ImageFormat, opts ...grpc.CallOption) (grpc.ServerStreamingClient[Image], error)
    SendTouch(ctx context.Context, in *TouchEvent, opts ...grpc.CallOption) (*emptypb.Empty, error)
    SendKey(ctx context.Context, in *KeyboardEvent, opts ...grpc.CallOption) (*emptypb.Empty, error)
    SetClipboard(ctx context.Context, in *ClipData, opts ...grpc.CallOption) (*emptypb.Empty, error)
    GetStatus(ctx context.Context, in *emptypb.Empty, opts ...grpc.CallOption) (*EmulatorStatus, error)
}
```

All 5 methods Phase 33 needs are present with idiomatic Go gRPC client signatures.

### `go test -race -v ./auth/...`

```
=== RUN   TestParseSimpleIni_Trim
--- PASS: TestParseSimpleIni_Trim (0.00s)
=== RUN   TestParseSimpleIni_MultipleEquals
--- PASS: TestParseSimpleIni_MultipleEquals (0.00s)
=== RUN   TestParseSimpleIni_IgnoresEmptyAndCommentLines
--- PASS: TestParseSimpleIni_IgnoresEmptyAndCommentLines (0.00s)
=== RUN   TestFindToken_PerInstance
--- PASS: TestFindToken_PerInstance (0.00s)
=== RUN   TestFindToken_PortMismatch
--- PASS: TestFindToken_PortMismatch (0.00s)
=== RUN   TestFindToken_GlobalFallback
--- PASS: TestFindToken_GlobalFallback (0.00s)
=== RUN   TestFindToken_NoAuth
--- PASS: TestFindToken_NoAuth (0.00s)
PASS
ok  	.../android-grpc/auth	1.258s
```

7 PASS / 0 FAIL / 0 SKIP — no t.Skip lines remain in auth/*_test.go.

### `make proto && git diff --exit-code proto/gen/`

Exits 0 — re-running codegen produces zero git diff (idempotent).

### `make test` (whole module)

```
ok  	.../auth      0.429s
ok  	.../client    0.759s
?   	.../cmd/android-grpc-stream    [no test files]
?   	.../encode                     [no test files]
ok  	.../ipc       1.095s
ok  	.../mmap      1.445s
?   	.../proto                      [no test files]
?   	.../proto/gen/emulatorcontrol  [no test files]
```

`auth` tests run real bodies (Wave 1); `client`/`ipc`/`mmap` still t.Skip per Wave 0 (Wave 2 will fill).

### Kittyfarm-citation policy

```
$ grep -rE "import.*kittyfarm" device-stream/native-servers/android-grpc/
(no output — zero imports)
```

All kittyfarm mentions live in `//` doc comments referencing file paths + line numbers. External Dependencies Policy honored.

## Cross-reference: AndroidEmulatorAuth.swift → auth/token.go

| kittyfarm Swift | Go port |
|---|---|
| `metadata(forGRPCPort:)` lines 44-65 (dispatch + cache) | `FindToken(grpcPort int)` (cache deferred — Wave 1 spec doesn't require it; downstream client may add) |
| `perInstanceToken(forGRPCPort:)` lines 67-79 (glob + match) | `perInstanceToken(grpcPort int)` |
| `globalToken` lines 81-89 (trimmed read) | `globalToken()` |
| Inline INI parser lines 90-100 | `parseSimpleIni(data []byte)` in `auth/ini.go` |

## Decisions Made

See `key-decisions` in frontmatter (5 decisions). Key ones:

- PROTO_OUT must end at `emulatorcontrol/` (not just `gen/`) so `paths=source_relative` lands files at the path matching the go_package declaration
- Provenance/SPDX header stays in `.proto` source, never in generated `.pb.go` files (preserves idempotency)
- TDD RED/GREEN commits kept separate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Initial `make proto` placed files at module root, not under `proto/gen/`**

- **Found during:** Task 1.1 first `make proto` run
- **Issue:** The plan's `<action>` step 2 Makefile draft used `--go_out=. --go_opt=paths=source_relative` with `-I proto`. With `paths=source_relative`, protoc strips the `-I` prefix and writes the .pb.go alongside its source-relative path under `--go_out`. So `-I proto` + `--go_out=.` placed files at `./emulator_controller.pb.go` (module root), NOT at `./proto/gen/emulatorcontrol/emulator_controller.pb.go` as the plan's acceptance criteria required.
- **Fix:** Changed Makefile to `--go_out=$(PROTO_OUT) --go-grpc_out=$(PROTO_OUT)` where `PROTO_OUT := proto/gen/emulatorcontrol`. Now `paths=source_relative` writes to the directory matching the `go_package` option, producing exactly the file paths the plan + downstream waves expect.
- **Files modified:** `device-stream/native-servers/android-grpc/Makefile`
- **Verification:** `ls proto/gen/emulatorcontrol/` shows both `.pb.go` files; `git diff --exit-code proto/gen/` after re-run is clean; `go build ./...` exits 0
- **Committed in:** `df64d6e` (fix applied pre-commit; plan-action draft was the discrepancy)

**2. [Rule 3 - Blocking] `protoc-gen-go` + `protoc-gen-go-grpc` not on PATH after `go install`**

- **Found during:** Task 1.1 `check-tools` invocation
- **Issue:** `go install ...@latest` installed the binaries to `$HOME/go/bin/` but that directory was not on the executor's PATH. `which protoc-gen-go` returned "not found" so `make proto` failed at the `check-tools` gate.
- **Fix:** Prepended `$HOME/go/bin` to `PATH` for the executor session (`export PATH="$PATH:$HOME/go/bin"`). Documented this in the Makefile's `check-tools` error message ("run `go install ...@latest`") so future invocations see the actionable hint. No code change beyond what was already in the plan.
- **Files modified:** None (PATH-only fix in executor environment)
- **Verification:** `which protoc-gen-go protoc-gen-go-grpc` resolves both
- **Note:** CI workflow (added in Wave 5) will use `go install ...@latest` + add `$HOME/go/bin` to PATH explicitly; this is a runner-setup concern, not a Makefile concern

---

**Total deviations:** 2 auto-fixed (1 Rule-3 blocking — Makefile output dir; 1 Rule-3 blocking — PATH for go install bins). No architectural changes; no Rule-4 stops.

## Issues Encountered

- Initial `protoc` invocation succeeded with exit 0 but produced no `.pb.go` files because `--go_out=.` with `paths=source_relative` placed them at module root (where they're not under any Go package the rest of the module imports). Caught immediately by `ls proto/gen/emulatorcontrol/` returning empty.
- `go install ...@latest` doesn't add to PATH automatically — typical Go dev env quirk. Added one `export PATH` for the session; CI/Wave 5 will own the persistent install.

## Wave 1 → Wave 2 handoff

Wave 2 (Plan 33-02) can now:

```go
import (
    pb   "github.com/device-farm/device-stream/native-servers/android-grpc/proto/gen/emulatorcontrol"
    auth "github.com/device-farm/device-stream/native-servers/android-grpc/auth"
)

// Build a gRPC client to a running emulator
tok, err := auth.FindToken(grpcPort)  // empty string ok (auth-disabled)
conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
client := pb.NewEmulatorControllerClient(conn)
stream, err := client.StreamScreenshot(ctx, &pb.ImageFormat{...})
```

**Wave 2 t.Skip placeholders to remove (per Plan 33-00 SUMMARY handoff table):**
- `mmap/mmap_test.go` (2 placeholders)
- `client/client_test.go` (3 placeholders — except `TestSendTouchPayload` which is Wave 4)
- `client/ring_test.go` (1 placeholder)
- `ipc/framer_test.go` (3 placeholders — except `TestFramerKeyPayload` which is Wave 4)

## User Setup Required

None — Wave 1 is local-only (codegen + pure Go auth). Future CI runners need `protoc` + the two Go plugins on PATH; this is documented in the Makefile `check-tools` error messages and will be wired explicitly in Wave 5's `.github/workflows/android-grpc-matrix.yml`.

## Next Phase Readiness

- AND-GRPC-PROTO row in `33-VALIDATION.md` flips from ❌ Wave 0 to ✅ Wave 1 (proto generates, all 5 RPCs present, idempotent)
- AND-GRPC-AUTH row in `33-VALIDATION.md` flips from ❌ Wave 0 to ✅ Wave 1 (FindToken passes 4/4 cases under -race)
- Plans 33-02, 33-03, 33-04, 33-05 explicitly unblocked. Wave 2's gRPC client can import the generated `EmulatorControllerClient` and `auth.FindToken` directly.

---
*Phase: 33-android-grpc*
*Plan: 01 (Wave 1: auth + protoc codegen)*
*Completed: 2026-05-16*

## Self-Check: PASSED

All 6 claimed files exist on disk (auth/token.go, auth/ini.go, both generated .pb.go files, go.sum, 33-01-SUMMARY.md). All 3 task commits present in git log (`df64d6e`, `e6eba26`, `5fef094`).
