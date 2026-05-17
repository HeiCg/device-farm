# Phase 33 — Deferred Items

Items deferred from Phase 33 (Android gRPC EmulatorController). Each carries the originating plan and a target phase / disposition.

---

## DEFERRED-33-A — Linux gRPC token path

- **Source:** Plan 33-01 / `33-RESEARCH.md` §Pitfall 6.
- **Description:** Linux emulator writes `~/.android/avd/running/pid_*.ini` (not `~/Library/Caches/TemporaryItems/avd/running/...`). The Go `auth/token.go` returns `""` on linux which means the daemon cannot dial the gRPC service on a linux host.
- **Target:** Phase 37+ when linux host support becomes a priority.
- **Workaround:** `// TODO(phase-37+)` comment in `auth/token.go`; v1 returns `""` on linux → TS adapter falls back to scrcpy via `AndroidStreamingService` selection rule.

## DEFERRED-33-B — Physical Android over gRPC

- **Source:** Phase 33 scope (`33-BRIEF.md` §Out section).
- **Description:** Physical Android devices have no `EmulatorController` gRPC service. They MUST use scrcpy.
- **Target:** Phase 36 (Wireless Physical Android) may revisit IF a tunnel exposes the emulator's gRPC service on a physical device — extremely unlikely.
- **Workaround:** `AndroidStreamingService.start` checks `device.kind === 'emulator'` before attempting the gRPC path; physical devices route straight to scrcpy.

## DEFERRED-33-C — Audio capture via gRPC

- **Source:** `33-CONTEXT.md` §Deferred Ideas.
- **Description:** The `EmulatorController` proto does not expose an audio stream cleanly. Audio capture stays on the ADB-bridged path.
- **Target:** Future phase if/when the Android emulator team ships a `streamAudio` RPC; otherwise audio remains ADB-bridged.

## DEFERRED-33-D — Anti-frame-loss backpressure

- **Source:** `33-CONTEXT.md` §Deferred Ideas + `33-RESEARCH.md` §Borrow problem.
- **Description:** The 2-slot MMAP ring with copy-on-borrow handles burst load, but under sustained backpressure frames may drop silently.
- **Target:** Phase 36/37 if profiling reveals it matters in practice; v1 ships without explicit backpressure signaling.

## DEFERRED-33-E — `device-farm doctor` check for android-grpc-stream

- **Source:** `33-RESEARCH.md` Open Question #4.
- **Description:** `device-farm doctor` (`cli/cmd/doctor.go`) currently checks for `java`, `adb`, `emulator`, `avdmanager`, `maestro`, and the server. It does NOT check for the `android-grpc-stream` binary or that it `--probe`s cleanly.
- **Target:** Phase 28 CLI Refactor (already in the backlog).

## DEFERRED-33-F — Bitrate / FPS / scale adaptation

- **Source:** `33-RESEARCH.md` Open Question #5.
- **Description:** `scrcpy-service.ts` has `setBitrate` / `setFps` / `setScale` stubs. The gRPC path has no-op stubs; real implementation requires plumbing the values into the encoder config + maybe `EmulatorController.SetDisplayConfiguration`.
- **Target:** Phase 34 Session API may need them for tunable streams.

## DEFERRED-33-G — Linux libx264 cgo bridge

- **Source:** Plan 33-02 / `encode/encoder_fallback.go`.
- **Description:** Darwin VideoToolbox encoder is the only working path in v1. The linux `x264` build tag exists but the body is unimplemented.
- **Target:** Phase 37+ Linux host support.

## DEFERRED-33-H — Zombie-aware grpcPort reclaim

- **Source:** Plan 33-03 / `server/pool/android/emulator.ts`.
- **Description:** The zombie detector currently scans the 5554-band console ports only. If a zombie emulator holds a gRPC port (8554-8650), `allocateGrpcPort` may try to reuse it.
- **Target:** Probably never matters in practice (fresh boots pick free ports); defer until a real collision is observed.

---

## DEFERRED-33-04-A — semgrep CWE-134 INFO findings in device-service.ts

(Carried over from Plan 33-04 SUMMARY.)

**Discovered:** Plan 33-04 Wave 4 execution (semgrep post-tool-cli-scan).

**Issue:** 15 INFO-severity findings of CWE-134 "Use of Externally-Controlled Format String" in `device-stream/packages/android/src/device-service.ts` at lines 73, 102, 124, 138, 158, 171, 275, 337, 364, 390, 402, 414, 433, 445, 463.

Pattern is `` console.log(`Failed to ... ${serial}:`, error) `` — string concatenation feeds `console.log`'s first arg.

**Scope:** Pre-existing. NONE of the flagged lines were touched by Plan 33-04 (the edit added the `_streaming` field + `setStreamingService` method + `NAMED_KEY_CODES` + routing branches in `tap` / `pressKey`, no log statements).

**Risk:** INFO severity, internal stack-trace logs only, no external attacker input on these specific call paths (all are catch-block error reporters with internal `error` objects).

**Resolution:** Defer to a follow-up cleanup pass — convert the 15 callsites to `` console.log('%s', `Failed... ${serial}`, error) `` or use a structured logger. Could be a single one-shot grep-replace if/when the project adopts pino-style logging package-wide.

**Owner:** Future "logging hygiene" sweep (not in scope for Phase 33).

## DEFERRED-33-06-A — grpcPort reconciliation for already-running emulators

**Source:** Plan 33-06 / `server/pool/pool-manager.ts:initPool` (alreadyHealthy branch, lines ~136-140).

**Description:** When PoolManager detects an emulator is already running at server startup (`alreadyHealthy === true`), it reuses the live process and skips `driver.boot()`. Because no fresh boot occurs, no gRPC port is allocated, and `device.grpcPort` stays `null`. The AndroidStreamingService selection rule will then fall back to scrcpy for these devices (gRPC requires `device.grpcPort != null`).

**Proper fix:** Parse `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` (the same INI file used for token discovery in `device-stream/native-servers/android-grpc/auth/`) to recover the `grpc.port` value from the live emulator process and assign it to `device.grpcPort`. Out of scope for the Plan 33-06 gap closure; tracked here for a future enhancement (or a Phase 38+ "session resumption" effort).

**Workaround:** Restart the emulator (server shutdown + boot, or `device-farm replaceDevice`) to take the fresh-boot path and pick up a freshly-allocated gRPC port. After restart, `device.grpcPort` flows end-to-end via the three boot sites fixed in Plan 33-06 (`initPool` fresh-boot loop, `allocate` per-job reboot, `replaceDevice` zombie replacement).

**Target:** Future "session resumption" / pool-state-reconciliation phase.
