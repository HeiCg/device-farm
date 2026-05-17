# android-grpc

Go daemon that bridges the Android Emulator gRPC `EmulatorController` service
(plus an MMAP image transport) into the Device-Stream IPC wire protocol
inherited from Phase 32 `sim-capture-private`. Functionally analogous to
kittyfarm's `GRPCFrameService.swift`, ported to Go for the Android side.

## Build

```bash
make proto       # Wave 1 wires protoc-gen-go (stub today)
make build       # produces bin/android-grpc-stream
```

## Test

```bash
make test        # short tests (skipped scaffolds today; Waves 1-4 fill bodies)
make test-race   # race-detector run
```

## Environment

| Variable                       | Default | Effect                                                                           |
| ------------------------------ | ------- | -------------------------------------------------------------------------------- |
| `DEVICE_STREAM_ANDROID_GRPC`   | unset   | When `0`, Node never spawns the daemon — scrcpy path is used unconditionally.    |
| `ANDROID_EMULATOR_HOME`        | auto    | Override emulator instance root (per-instance `pid_*.ini` auth-token discovery). |
| `ANDROID_SDK_HOME`             | auto    | Global fallback for `~/.emulator_console_auth_token`.                            |

## Phase 33 status

- **Wave 0 (this scaffold):** module skeleton, subset proto file, daemon `--help` stub, `_test.go` scaffolds with `t.Skip("Wave N — TODO")`.
- **Wave 1:** auth-token discovery + protoc codegen.
- **Wave 2:** mmap reader + bufconn gRPC client + IPC framer.
- **Wave 3:** server-side `-grpc <port>` spawn injection.
- **Wave 4:** TypeScript adapter swap (`GrpcEmuClient`).
- **Wave 5:** Build wiring (`build-android-grpc.sh`) + daily CI matrix + VideoToolbox cgo encoder.

Subset proto is a TRANSLATION of the upstream AOSP `emulator_controller.proto`
(see provenance comment at top of `proto/emulator_controller.proto`). The
kittyfarm Swift port is referenced as inspiration only — no link/dep.
