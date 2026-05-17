---
phase: 33-android-grpc
plan: 04
subsystem: streaming
tags: [typescript, android, grpc, ipc, vitest, tdd, wave-4]

# Dependency graph
requires:
  - phase: 33-android-grpc
    plan: 02
    provides: Wave-2 daemon body (mmap/ipc/client/encode) + bin/android-grpc-stream wire format
  - phase: 33-android-grpc
    plan: 03
    provides: BootResult.grpcPort + DeviceInfo.grpcPort + driver-side -grpc spawn injection
provides:
  - GrpcEmuClient.spawn(serial, grpcPort, ws, opts?) — Node-side adapter for android-grpc-stream daemon
  - GrpcEmuClient.sendTouch / sendTouchAtPixel / sendKey / replayParamSets / stop
  - GrpcEmuClient inbound forwarder (0x01 paramSets / 0x02 frame / 0x03 metadata -> JSON envelopes on WS)
  - AndroidStreamingService.start with 4-stage selection rule + scrcpy fallback
  - AndroidStreamingService.stop / getSession / routeTap / routeKey / routeTypeText
  - AndroidDeviceService.setStreamingService injection point
  - tap() + pressKey() conditionally route through gRPC when session.kind === 'grpc'
  - typeText() UNCHANGED (regression guard via test #8)
affects:
  - 33-05-PLAN (Wave 5 build wiring + smoke + soak now has the full Node-side surface to drive end-to-end)

# Tech tracking
tech-stack:
  added: []  # pure additive — no new npm deps; ws + node:net + node:fs already in tree
  patterns:
    - "Translate-don't-link of Phase 32 sim-capture-private-client.ts — three-delta port (spawn args / socket path / additive 0x03+0xC2 kinds) keeps the structural blueprint intact"
    - "Optional injection (setStreamingService) — back-compat: callers that never wire streaming keep legacy ADB behavior; only emulator path with gRPC session diverts"
    - "Out-of-band selection rule lives in the service layer (not driver) — driver throws on port-band exhaustion (Wave 3), service decides scrcpy fallback (Wave 4); separation of concerns matches 33-RESEARCH.md §TS service swap"
    - "Session kind discriminated union — Map<serial,{kind:'grpc',client,display?}|{kind:'scrcpy'}> so future kinds (e.g., kind:'usb-physical') don't break existing branches"

key-files:
  created:
    - device-stream/packages/android/src/grpc-emu-client.ts
    - device-stream/packages/android/src/service.ts
    - device-stream/packages/android/tests/grpc-touch-fallback.spec.ts
    - .planning/phases/33-android-grpc/deferred-items.md
    - .planning/phases/33-android-grpc/33-04-SUMMARY.md
  modified:
    - device-stream/packages/android/src/index.ts (barrel re-exports GrpcEmuClient + AndroidStreamingService surface)
    - device-stream/packages/android/src/device-service.ts (added _streaming field + setStreamingService + NAMED_KEY_CODES + tap/pressKey routing branches)
    - device-stream/packages/android/tests/grpc-emu-client.spec.ts (Wave-0 8 it.todo -> 9 concrete passing tests)

key-decisions:
  - "Default binary path is device-stream/native-servers/android-grpc/bin/android-grpc-stream (NOT device-stream/bin/) because Wave 2's Makefile drops it there; Wave 5 may symlink/copy into a unified bin/ but doing it now would race the build script"
  - "ENOENT on binary path is a hard reject from spawn() and a Rule-4 fallback case at the service layer — service.ts catches and falls through to scrcpy with log.warn; never throws to the caller"
  - "Daemon exit BEFORE first frame -> emit 'spawn-failed' (caller fallback). Daemon exit AFTER first frame -> emit 'crashed' + console.error (caller propagates — emulator went bad, restarting under scrcpy would mask a real fault)"
  - "routeTap / routeKey return boolean (NOT throw) so device-service.ts can do a clean if-routed-return / else fall-through. Cleaner control flow than try/catch + sentinel error"
  - "NAMED_KEY_CODES is a 4-entry table (back/home/menu/enter); unknown names fall through to ADB so operators retain full AKEYCODE_* enum access without an exhaustive 200+ entry map. Wave 5 may expand if needed"
  - "Default display fallback 1080x1920 used when the daemon hasn't yet emitted its first 0x03 metadata frame (race between session.start completion and first frame arrival). 1080x1920 is the canonical AVD resolution at API 35; close enough for ratio math during the first <100ms"
  - "typeText UNCHANGED on the ADB path — proto subset has no sendText. routeTypeText stub returns false so future protocol extensions can plug in without changing call sites"

requirements-completed:
  - AND-GRPC-TS
  - AND-GRPC-TOUCH

# Metrics
duration: 10min
completed: 2026-05-16
---

# Phase 33 Plan 04: Wave 4 (TS adapter swap + touch/key routing) Summary

**Wave 4 ships the Node-side adapter (`GrpcEmuClient`) for the android-grpc-stream daemon and the streaming-service selection rule that prefers gRPC for emulators with a graceful scrcpy fallback. Touch + key events now route through the daemon when the session is gRPC; typeText stays on ADB unconditionally. 20 new Vitest tests pass (9 GrpcEmuClient + 11 AndroidStreamingService); zero regressions in the 9 pre-existing android tests.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-16T06:30:58Z
- **Completed:** 2026-05-16T06:41:54Z
- **Tasks:** 2 (Task 4.1 GrpcEmuClient, Task 4.2 AndroidStreamingService + device-service routing)
- **Commits:** 4 (2 RED + 2 GREEN — TDD per task)
- **Source LOC added:** ~640 (`grpc-emu-client.ts` ~310 + `service.ts` ~155 + device-service.ts deltas ~35 + index.ts deltas ~12 + comments)
- **Test LOC added:** ~480 (`grpc-emu-client.spec.ts` ~245 + `grpc-touch-fallback.spec.ts` ~237)

## Task Commits

| # | Task                                                                   | Commit    | Type |
| - | ---------------------------------------------------------------------- | --------- | ---- |
| 1 | Task 4.1 RED — 9 failing tests for GrpcEmuClient                       | `5634d07` | test |
| 2 | Task 4.1 GREEN — GrpcEmuClient.spawn + parse loop + framer + barrel    | `4e1110f` | feat |
| 3 | Task 4.2 RED — 11 failing tests for AndroidStreamingService + routing  | `463a0a3` | test |
| 4 | Task 4.2 GREEN — service.ts + device-service.ts tap/key routing branch | `eefbb83` | feat |

## Verification Snapshots

### `npx vitest run packages/android/tests/` (whole package)

```
PASS (29) FAIL (0)
```

Breakdown:
- `grpc-emu-client.spec.ts` — 9 tests (outbound framer 3 + inbound parser 4 + spawn failure paths 2)
- `grpc-touch-fallback.spec.ts` — 11 tests (selection rule 6 + routing 5)
- `log-stream.spec.ts` — 5 tests (pre-existing, unchanged)
- `scrcpy-service.spec.ts` — 4 tests (pre-existing, unchanged)

### Outbound wire-format byte dumps (proves Phase 32 framer compat)

**0xC1 touch — 34 bytes** (`sendTouch({xRatio:0.5, yRatio:0.25, phase:0, pressure:1, id:42})`):

```
[0..3]   00 00 00 1E   length = 30 (= 1 kind + 29 payload)
[4]      C1            kind
[5..12]  3F E0 00 00 00 00 00 00   x_ratio = 0.5 (f64 BE)
[13..20] 3F D0 00 00 00 00 00 00   y_ratio = 0.25 (f64 BE)
[21]     00            phase = 0 (began)
[22..29] 3F F0 00 00 00 00 00 00   pressure = 1.0 (f64 BE)
[30..33] 00 00 00 2A   id = 42 (u32 BE)
```

**0xC2 key — 14 bytes** (`sendKey('down', 0x0007, 0)`):

```
[0..3]   00 00 00 0A   length = 10 (= 1 kind + 9 payload)
[4]      C2            kind
[5]      00            eventType = down
[6..9]   00 00 00 07   keyCode = 7 (u32 BE)
[10..13] 00 00 00 00   modMask = 0 (u32 BE)
```

Both layouts match `device-stream/native-servers/android-grpc/ipc/framer.go` (`EncodeTouch` at line 72 + `EncodeKey` at line 106) byte-for-byte.

### Selection rule grep gates

```
$ grep -E "DEVICE_STREAM_ANDROID_GRPC" device-stream/packages/android/src/service.ts
*   3. DEVICE_STREAM_ANDROID_GRPC === '0' -> scrcpy   (explicit operator opt-out)
      process.env.DEVICE_STREAM_ANDROID_GRPC !== '0';

$ grep -E "GrpcEmuClient.spawn" device-stream/packages/android/src/service.ts
        const client = await GrpcEmuClient.spawn(device.serial, device.grpcPort!, ws);

$ grep -E "sendTouchAtPixel|sendKey" device-stream/packages/android/src/service.ts | head -4
    session.client.sendTouchAtPixel(x, y, dw, dh, { phase: 0 });
    session.client.sendTouchAtPixel(x, y, dw, dh, { phase: 2 });
    session.client.sendKey('down', keyCode);
    session.client.sendKey('up', keyCode);
```

### typeText zero-diff guard

`device-stream/packages/android/src/device-service.ts` diff for typeText:

```
async typeText(serial: string, text: string): Promise<void> {
  this.assertConnected(serial);
  // ... ADB shell-out unchanged ...
}
```

No `_streaming` check inserted. ADB-only path preserved. (Verification: routing test #8 — typeText-on-grpc-session falls through to ADB — implicitly proven by the absence of `_streaming` reference in the typeText body.)

### TypeScript check

`npx tsc --noEmit` (android package): 1 pre-existing error in `scrcpy-service.ts:130` (stream-extra type mismatch from upstream @yume-chan packages). Zero new errors from Wave 4. Files added by this plan (`grpc-emu-client.ts`, `service.ts`, edits to `device-service.ts` + `index.ts`) are type-clean.

## Decisions Made

See `key-decisions` in frontmatter (7 decisions). Notable:

- **Binary path** — Default at `device-stream/native-servers/android-grpc/bin/android-grpc-stream` (where Wave 2's Makefile drops it). Wave 5 may symlink/copy to a unified `device-stream/bin/`; doing it now would race the build.
- **routeTap / routeKey return boolean (not throw)** — Cleaner if-routed-return / else fall-through control flow in device-service.ts. Throwing + sentinel-error would force try/catch.
- **NAMED_KEY_CODES is a 4-entry table** — back/home/menu/enter only. Unknown keys fall through to ADB so operators retain access to the full AKEYCODE_* enum without an exhaustive 200+ entry map.
- **Default display fallback 1080x1920** — Used when the daemon hasn't yet emitted its first 0x03 metadata frame (race between `service.start` completion and first frame arrival). 1080x1920 is the canonical AVD resolution at API 35; close enough for ratio math during the first <100ms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan assumed pre-existing `service.ts` and `scrcpyService.startStream(serial, ws)` signature**

- **Found during:** Task 4.2 read_first / file mapping
- **Issue:** The plan said "Edit `device-stream/packages/android/src/service.ts`. Locate the streaming entry point (`start` or `startMirroring`)" — but the file does not exist. The legacy streaming entry is `scrcpyService.startStream(adb: Adb, serial: string, ws: WebSocket)` in `scrcpy-service.ts`, which requires an `Adb` instance (TangoADB's `AdbScrcpyClient.start` needs it).
- **Fix:** Created `service.ts` as a NEW file housing `AndroidStreamingService`. Wraps `scrcpyService.startStream(adb, serial, ws)` with the gRPC selection rule. Adb instance is passed through `start(device, adb, ws)`. Plan's intent honored; signature adapted to reality.
- **Files modified:** `device-stream/packages/android/src/service.ts` (new file, ~155 LOC)
- **Verification:** All 11 grpc-touch-fallback.spec tests pass; module-mock for scrcpy-service intercepts the call cleanly.

**2. [Rule 3 — Blocking] Plan's test #1 ("returns scrcpy session immediately when DEVICE_STREAM_ANDROID_GRPC=0") was scoped to GrpcEmuClient but actually tests the Service layer**

- **Found during:** Task 4.1 RED
- **Issue:** Plan §<behavior> bullet 1 explicitly noted "(this is a Service test, not GrpcEmuClient — moved to Task 4.2)" but the original spec listed it under GrpcEmuClient. Following the plan's parenthetical guidance.
- **Fix:** Wrote 9 tests in `grpc-emu-client.spec.ts` (outbound 3 + inbound 4 + spawn-failure 2) instead of the literal 8 from Wave 0's `it.todo` list. Env-opt-out test landed in `grpc-touch-fallback.spec.ts` (Task 4.2) instead.
- **Files modified:** N/A — design choice in test file authorship.

**3. [Rule 3 — Blocking] Plan's `existsSync` mock approach via `vi.spyOn(fs, 'existsSync')` fails with "Cannot redefine property"**

- **Found during:** Task 4.1 GREEN — running the spawn-failure unit test
- **Issue:** `fs.existsSync` in Node's CommonJS module is a non-configurable property; `vi.spyOn` throws on the mock attempt.
- **Fix:** Replaced the mock approach with a real-binary strategy — point `binaryPath` at `/usr/bin/false` (real binary that exits 1 immediately) and a fresh `/tmp/grpc-emu-client-spec-<timestamp>.sock` path that will never materialize. The spawn loop observes the early exit and rejects within `spawnTimeoutMs`. Cleaner test, no mock fragility.
- **Files modified:** `device-stream/packages/android/tests/grpc-emu-client.spec.ts` (single test, ~20 LOC delta)
- **Verification:** Test passes deterministically; binary path `/usr/bin/false` is present on every macOS host (verified `ls /usr/bin/false`).

### Out-of-scope findings (logged to deferred-items.md, NOT auto-fixed)

**DEFERRED-33-04-A:** 15 INFO-severity semgrep CWE-134 findings in `device-stream/packages/android/src/device-service.ts` (lines 86, 115, 144, 158, 189, 202, 306, 368, 395, 421, 433, 445, 464, 476, 494). Pre-existing `console.log` patterns; NONE of these lines were touched by Plan 33-04 (my edits added only the `_streaming` field, `setStreamingService`, `NAMED_KEY_CODES`, and the routing branches in tap/pressKey — none of which contain `console.log`). Per scope boundary rule, these are deferred to a future "logging hygiene" sweep or Phase 33 close (33-05).

### No Rule-4 architectural stops, no auth gates.

## Issues Encountered

- The semgrep MCP hook on `Edit` operations re-scans the WHOLE file on every edit and reports pre-existing INFO findings regardless of which lines my edit touched. This created noise that masked the actual signal (my edits did not introduce new violations). Documented in deferred-items.md; future plans may pre-emptively fix these to silence the hook.
- The android-grpc-stream binary lives at `device-stream/native-servers/android-grpc/bin/android-grpc-stream` (where Wave 2's Makefile produces it), NOT `device-stream/bin/` as the plan assumed. The default path in `grpc-emu-client.ts` matches the actual location. Wave 5 may unify these paths.

## Wave 4 → Wave 5 handoff

Wave 5 (Plan 33-05) can now:

1. Run `device-stream/scripts/build-android-grpc.sh` to drop the daemon binary in place (or symlink to a unified `device-stream/bin/`)
2. Plug `AndroidStreamingService` into the server's plugin wiring so Job execution drives `start({serial, kind:'emulator', grpcPort}, adb, ws)` instead of calling `scrcpyService.startStream` directly
3. Call `androidDeviceService.setStreamingService(androidStreamingService)` so tap + pressKey from the dashboard / API route through gRPC automatically
4. Smoke against a real boot: `npm run dev` + `device-farm run --platform android --apk ...` — verify dashboard receives H.264 frames via the WS `frame` envelope, taps land at the right pixel, BACK key returns to launcher
5. Soak test the daemon (50 MB RSS-growth gate over 30 min) — daemon's process guards already emit `crashed` on mid-stream exit so the soak script can detect failure

`AND-GRPC-TS` row in `33-VALIDATION.md` flips ❌ → ✅ (selection rule + scrcpy fallback shipped with byte-exact wire format)
`AND-GRPC-TOUCH` row flips ❌ → ✅ (tap + pressKey routed through gRPC for emulator sessions; typeText preserved on ADB)

## Next Phase Readiness

- AND-GRPC-TS + AND-GRPC-TOUCH closed (Wave 4 of 5 in Phase 33)
- Wave 5 (build + smoke + soak + phase close) is the only remaining work
- No new tech debt; DEFERRED-33-04-A logged for follow-up logging-hygiene sweep
- Mirror of Phase 32 `sim-capture-private-client.ts` pattern preserved (file shape, spawn lifecycle, parse loop) so future maintainers can update both halves in parallel

---
*Phase: 33-android-grpc*
*Plan: 04 (Wave 4: TS adapter swap + touch/key routing)*
*Completed: 2026-05-16*

## Self-Check: PASSED

All 6 claimed files exist on disk (grpc-emu-client.ts, service.ts, 2 spec files, deferred-items.md, this SUMMARY); all 4 task commits present in git log (`5634d07`, `4e1110f`, `463a0a3`, `eefbb83`).

