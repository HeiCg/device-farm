---
phase: 32-simulatorkit-bridge
plan: 04
subsystem: ios-simulator
tags: [typescript, eventemitter, ipc, af-unix, avcc, h264, nal-parsing, vitest, xcodebuild, xcodegen, postinstall, fallback, env-opt-out]

requires:
  - phase: 32-simulatorkit-bridge
    plan: 03
    provides: DSIpcServer Unix-socket framer + sim-capture-private daemon-mode (--udid <UDID> --socket <path>) + 0xC1 touch / 0xC9 quit / 0x01 paramSets / 0x02 AU / 0xFF error / 0x10 ack wire kinds
  - phase: 32-simulatorkit-bridge
    plan: 00
    provides: Wave-0 stub build-sim-capture-private.sh + postinstall.js + sim-capture-private-client.spec.ts placeholder (5 it.todo)

provides:
  - SimCapturePrivateClient (279-line Node-side IPC client): EventEmitter-shaped `frame` events matching CaptureService.startAvccCapture's existing AVCC contract; spawn(udid, opts) lifecycle waits for /tmp/device-stream-sim-<udid>.sock, opens SOCK_STREAM client, attaches rolling-buffer parser; fromConnectedSocket() test entry mirrors DSIpcServer.initWithConnectedFd:
  - CaptureService.startCapture gating: when format === 'avcc' AND DEVICE_STREAM_SIM_PRIVATE !== '0', tries SimCapturePrivateClient.spawn first; on throw, falls through to startAvccCapture unchanged. MJPEG path bypasses entirely.
  - sendTouch(x, y, phase, pressure, touchId): 34-byte 0xC1 control frame matching DSFramerDecodeTouchPayload's f64 BE x/y, u8 phase, f64 BE pressure, u32 BE touchId layout
  - NAL-unit-type inspection for 0x02 -> 'keyframe' | 'delta' decision (AVCC payload byte 4 & 0x1F; type 5 = IDR = keyframe, anything else = delta)
  - Production build pipeline: build-sim-capture-private.sh runs xcodegen generate + xcodebuild Release + stages binary at device-stream/bin/sim-capture-private with executable bit
  - Non-blocking postinstall hook: builds on darwin/arm64 by default; DEVICE_STREAM_SKIP_BUILD=1 opt-out; build failure prints warning but always exits 0 (runtime fallback covers missing-binary case)
  - CI matrix workflow: "Build sim-capture-private" step now fail-fast (Wave-0 stub-exit echo removed); smoke step retains soft-fail until Plan 32-05 lands smoke-sim-private.sh

affects:
  - Plan 32-05 (T-32.7): smoke can assume device-stream/bin/sim-capture-private exists on darwin/arm64 hosts that run `npm install` (postinstall built it). The TS adapter's spawn() + frame parsing + sendTouch are unit-tested; live smoke verifies the daemon-side wiring end-to-end.
  - Downstream consumers (stream-service.ts, gesture-service.ts): zero source changes required because the CaptureService 'frame' event envelope is preserved byte-for-byte (`{udid, kind, payload}` with AvccFrameKind).

tech-stack:
  added:
    - "Dynamic import inside CaptureService.startCapture (`await import('./sim-capture-private-client.js')`) — defers loading the private-bridge module until the AVCC path is taken AND env doesn't opt out, so env=0 callers never pay the resolve cost"
    - "vitest doMock + resetModules + dynamic re-import per test — required to swap SimCapturePrivateClient.spawn behavior (spy / throw) between the two CaptureService fallback tests without leaking state across tests"
    - "fromConnectedSocket(udid, proc, sock) test entry on SimCapturePrivateClient — direct constructor bypass for unit tests so the parse loop can be driven from a FakeSocket without filesystem or child_process involvement"
  patterns:
    - "Mirror-the-daemon framer: the Node-side parse loop reads the exact same [u32 BE length][u8 kind][payload] wire shape that DSIpcServer.writeFrameKind:payload: emits in IpcServer.mm (length = 1 + payload.length covers the kind byte). Wire compatibility is the contract."
    - "Envelope preservation under the hood: the new 'frame' emit shape `{udid, kind: AvccFrameKind, payload: Buffer}` matches startAvccCapture's existing emit shape exactly — stream-service.ts and gesture-service.ts require zero changes."
    - "Synthetic CaptureInstance.process for the private bridge: the bookkeeping map (this.captures) still tracks the session, but `process` is a fake ChildProcess-shaped object whose .kill() routes to SimCapturePrivateClient.stop(). stopCapture(deviceId) checks for an attached privateClient and short-circuits to client.stop() — no real SIGTERM of a fake child."

key-files:
  created:
    - device-stream/packages/ios-simulator/src/sim-capture-private-client.ts
  modified:
    - device-stream/packages/ios-simulator/src/capture-service.ts
    - device-stream/packages/ios-simulator/src/index.ts
    - device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts
    - device-stream/packages/ios-simulator/tests/capture-service.spec.ts
    - device-stream/scripts/build-sim-capture-private.sh
    - device-stream/scripts/postinstall.js
    - .github/workflows/sim-private-matrix.yml

key-decisions:
  - "Dynamic-import of sim-capture-private-client.js from capture-service.ts (rather than top-level require). When DEVICE_STREAM_SIM_PRIVATE=0 the module never loads, which (a) avoids unnecessary resolve cost for opt-out callers and (b) gives vitest a clean mock seam via vi.doMock + vi.resetModules — without dynamic import, the spec couldn't swap SimCapturePrivateClient.spawn behavior per test."
  - "fromConnectedSocket as a public-but-test-shaped entry. Same precedent as DSIpcServer.initWithConnectedFd: (Plan 32-03): the production path is .spawn(), but a non-test entry that wraps a pre-existing socket lets unit tests drive the parse loop with a FakeSocket EventEmitter. The surface is harmless to ship (a future plan might wire an inherited socket from a supervising process)."
  - "NAL-unit-type inspection for keyframe/delta classification, NOT 'first frame after paramSets'. The brief options were: (a) treat first 0x02 after 0x01 as keyframe, delta thereafter, or (b) inspect the AVCC payload's first NAL unit type byte (& 0x1F). Picked (b) because VT can emit multiple paramSets blobs over the life of a session (resolution change, force_idr) and option (a) would mis-label subsequent IDR frames as 'delta'. Option (b) is robust against any IDR cadence."
  - "Synthetic ChildProcess in CaptureInstance for the private-bridge owner. The captures map's process field is typed `ChildProcess`. Rather than widen the type union (which would touch every consumer), the private-bridge path installs a fake ChildProcess-shaped object whose only relevant method is .kill() — and stopCapture(deviceId) checks for an attached privateClient field first and routes there. Type-safe with one targeted `as unknown as ChildProcess` cast; downstream code unchanged."
  - "capture-service.spec.ts opts out via DEVICE_STREAM_SIM_PRIVATE=0 in beforeEach. The existing 6 AVCC-mode tests exercise the legacy sim-capture-avcc binary path. With the new gate defaulting ON, they would have tried the private bridge first → spawned a real sim-capture-private daemon under the test's mocked fs/child_process → hung on the never-appearing socket. Setting env=0 in beforeEach is the surgical fix; the tests' intent (AVCC binary argv shape, set_bitrate stdin, etc.) is preserved exactly."
  - "Non-blocking postinstall via unconditional process.exit(0). spawnSync's status is checked and logged on failure, but the process always exits 0. This matches the brief's requirement (`install is non-blocking on build failure`) AND the runtime contract (SimCapturePrivateClient.spawn detects missing binary and throws → CaptureService catches → falls through to startAvccCapture)."
  - "CI build step fail-fast, smoke step soft-fail. Plan 32-04 owns the build pipeline; Plan 32-05 owns the smoke script. Removing the `|| echo \"Wave 0 stub exit — expected\"` on the build step alone (leaving the smoke step's `|| echo \"smoke stub — expected to fail until T-32.7\"` intact) tightens the matrix exactly where this plan landed work."

patterns-established:
  - "EventEmitter-shaped clients for daemon-backed services (precedent: ScrcpyService in @device-stream/android). Future daemon-based capture backends should emit `{udid, kind: <SourceFrameKind>, payload: Buffer}` so the stream-service.ts adapter never changes."
  - "vi.doMock + vi.resetModules + dynamic re-import is the pattern for testing CaptureService's optional-private-bridge gate. Use this same scaffold when adding env-gated alternative backends in future phases."
  - "Synthetic-ChildProcess-in-captures-map for daemon-owner sessions. If a future plan adds a third capture backend (e.g. WDA-AVKit), use this same shape — install a fake .kill() and short-circuit stopCapture via an instance-attached client field."

requirements-completed:
  - SIM-PRIV-05   # Fallback path (env opt-out + spawn-failure) unit-tested in 2 new vitest cases
  - SIM-PRIV-REF  # TS-side framer round-trips the locked [u32 BE length][u8 kind][payload] wire format byte-for-byte vs IpcServer.mm

duration: 10min
completed: 2026-05-16
---

# Phase 32 Plan 04: TS Adapter (SimCapturePrivateClient) + Production Build Pipeline Summary

**Wave-4 production surface: SimCapturePrivateClient (279-line Node-side IPC client) implements the daemon-side wire format from Plan 32-03 byte-for-byte — same [u32 BE length][u8 kind][payload] envelope, same 0xC1 touch payload layout, same 0xC9 quit semantics — and exposes an EventEmitter `frame` event shaped exactly like CaptureService.startAvccCapture's existing emit. CaptureService.startCapture gates the private bridge behind `format === 'avcc' && DEVICE_STREAM_SIM_PRIVATE !== '0'`, falls through to startAvccCapture on spawn failure, and routes stopCapture(deviceId) through a per-session privateClient reference. 5 vitest cases replace Wave-0's 5 it.todo placeholders: framer round-trip (0x02 -> 'keyframe' via NAL type 5), 3-frame ordering (avcc/keyframe/delta), env=0 short-circuit, spawn-throws fallback, 0xC1 sendTouch byte-layout. The Wave-0 build-sim-capture-private.sh stub is gone — replaced by real xcodegen + xcodebuild Release flow that stages the binary at device-stream/bin/sim-capture-private. Postinstall hook builds unconditionally on darwin/arm64 but ALWAYS exits 0 on build failure (runtime fallback covers missing-binary). CI matrix's "Build" step is now fail-fast; smoke step still soft-fails until Plan 32-05. Build verified on this host: device-stream/bin/sim-capture-private (129 KB) prints usage on stdin-less invocation.**

## Performance

- **Duration:** 10 min (start 2026-05-16T00:50:49Z, end 2026-05-16T01:00:28Z)
- **Tasks:** 2 (Task 4.1 — TS adapter + spec; Task 4.2 — build script + postinstall + CI)
- **Files created:** 1 (`sim-capture-private-client.ts`, 279 lines)
- **Files modified:** 7 (capture-service.ts, index.ts, sim-capture-private-client.spec.ts, capture-service.spec.ts, build-sim-capture-private.sh, postinstall.js, sim-private-matrix.yml)
- **Tests:** 5 new (sim-capture-private-client.spec.ts, all green); 6 existing AVCC-mode tests adjusted to opt out of private bridge; full ios-simulator workspace remains 83/83 green
- **Binary built on this host:** `device-stream/bin/sim-capture-private` (129 KB, executable, --probe usage message confirmed)

## Accomplishments

- **`SimCapturePrivateClient` (sim-capture-private-client.ts)** — 279-line EventEmitter-shaped Node-side IPC client. `static async spawn(udid, opts?)` performs the full lifecycle: existence-check the daemon binary at `device-stream/bin/sim-capture-private`, unlink any stale `/tmp/device-stream-sim-<udid>.sock`, `child_process.spawn` the daemon with `--udid <UDID> --socket <path>` argv (matching Plan 32-03's daemon entry contract), poll for the socket file to appear (50ms tick, 5000ms default timeout, early-exit on child exit), then `net.createConnection(socketPath)` and wire up the parse loop. `static fromConnectedSocket(udid, proc, sock)` is the test-only / future-inherited-fd entry — same pattern as DSIpcServer.initWithConnectedFd: from Plan 32-03.

- **Parse loop** — Maintains a rolling Buffer. Reads `[u32 BE length][u8 kind][payload]` where `length` covers `kind + payload` (so `payload.length = length - 1`). Defensively caps `length` at 16 MiB and tears down on a malformed frame. Kind mapping:
  - `0x01` (avcC paramSets blob) → emit `frame` event with `kind: 'avcc'`. Marks paramSetsSeen=true.
  - `0x02` (AVCC AU) → inspect first NAL unit type via `payload[4] & 0x1F`. Type 5 = IDR slice → `'keyframe'`; anything else → `'delta'`. Robust against multiple paramSets blobs per session (e.g. force_idr restarts the IDR cadence).
  - `0xFF` (error) → emit `error` event with the UTF-8 payload as the Error message.
  - `0x10` (ack) → silently dropped.
  - unknown → console.warn but don't tear down.

- **`sendTouch(x, y, phase, pressure, touchId)`** — Writes the 34-byte 0xC1 control frame: 4-byte BE length field = 30 (covers 1 kind byte + 29 payload bytes), 1-byte kind = 0xC1, then 29-byte payload `[f64 BE x][f64 BE y][u8 phase][f64 BE pressure][u32 BE touchId]`. Layout matches `DSFramerDecodeTouchPayload` in IpcServer.mm byte-for-byte (verified by the touch unit test in this plan AND by the daemon-side IpcFramerTests.testDecodeControlTouchFrame from Plan 32-03).

- **`stop()`** — Idempotent teardown: send a polite 0xC9 quit frame so the daemon performs `bridge_detach()` + exit, then `sock.destroy()` then `SIGTERM` the child. Safe to call from exit handlers and from CaptureService fallback paths.

- **`CaptureService.startCapture` gating** — When `format === 'avcc' && process.env.DEVICE_STREAM_SIM_PRIVATE !== '0'`, performs `const { SimCapturePrivateClient } = await import('./sim-capture-private-client.js'); const client = await SimCapturePrivateClient.spawn(deviceId);` — wraps the result in a `CaptureInstance` whose `process` field is a fake-ChildProcess-shaped object and whose attached `privateClient` field carries the live client. `client.on('frame', e => this.emit('frame', e))` preserves the AVCC EventEmitter contract. On any throw from spawn(), logs a warning and falls through to `startAvccCapture(deviceId, options)`. MJPEG path bypasses the private bridge entirely (matches Plan 04 must_haves.truths).

- **`CaptureService.stopCapture` routing** — Checks for an attached `privateClient` on the CaptureInstance; if present, calls `client.stop()` directly and returns (no fake-process SIGTERM gymnastics). Otherwise unchanged.

- **`index.ts` export** — `SimCapturePrivateClient`, `SimCapturePrivateOptions`, `SimCapturePrivateFrameEvent` re-exported so package consumers can import the client directly if they want unit-test or low-level access.

- **`tests/sim-capture-private-client.spec.ts`** — 5 fully-implemented test cases (replacing 5 it.todo placeholders from Wave 0):
  1. `framer round-trips a 0x02 AU frame as a keyframe event (NAL type 5 = IDR)` — drives a FakeSocket with a single 1024-byte AVCC AU whose first NAL is type 5 (IDR). Asserts exactly one `frame` event with `kind: 'keyframe'` and a 1024-byte payload that equals the input.
  2. `emits frame events in order for paramSets + 2 AUs (avcc, keyframe, delta)` — concatenates 3 wire frames into a single chunk (paramSets + IDR-AU + non-IDR-AU). Asserts 3 events in order with kinds `['avcc', 'keyframe', 'delta']` and exact payload sizes.
  3. `skips the private bridge entirely when DEVICE_STREAM_SIM_PRIVATE=0` — sets env=0, `vi.doMock`s SimCapturePrivateClient with a `spawn` spy + mocks fs/child_process for the AVCC path. Asserts the spy was NEVER called and `cp.spawn` WAS called (AVCC path took over).
  4. `falls back to startAvccCapture when SimCapturePrivateClient.spawn throws` — `vi.doMock`s SimCapturePrivateClient with `spawn` that rejects. Asserts startCapture returns true (AVCC's stdout-frame resolved it) AND the spy was called exactly once AND `cp.spawn` was called.
  5. `writes a 34-byte 0xC1 control frame with normalized ratio coords` — calls `client.sendTouch(0.5, 0.5, 0, 1.0, 0)`. Asserts the captured socket.write buffer is exactly 34 bytes with the BE length field = 30, kind byte = 0xC1, and the 29-byte payload's f64 BE / u8 / f64 BE / u32 BE fields all match.

- **`build-sim-capture-private.sh` (Wave 0 stub replaced)** — Real xcodegen + xcodebuild flow. Pre-flights `$DEVELOPER_DIR` (overrides via env, defaults `/Applications/Xcode.app/Contents/Developer`) and `xcodegen` on PATH. Runs `xcodegen generate` then `xcodebuild -project sim-capture-private.xcodeproj -scheme sim-capture-private -configuration Release -derivedDataPath build -quiet build`. Copies `build/Build/Products/Release/sim-capture-private` to `device-stream/bin/sim-capture-private` with `chmod +x`. Final stdout: `built: <path>`.

- **`postinstall.js` (Wave 0 stub replaced)** — Three skip gates (`DEVICE_STREAM_SKIP_BUILD=1`, non-darwin, non-arm64). On supported host: `spawnSync('bash', [build-script-path], {stdio: 'inherit'})`. On non-zero exit: prints `[device-stream postinstall] sim-capture-private build failed (status=N) — install continues; fallback path will be used at runtime` and continues. Unconditional `process.exit(0)` at the end — npm install is never blocked.

- **`.github/workflows/sim-private-matrix.yml` — build step tightened** — Removed `|| echo "Wave 0 stub exit — expected"` suffix from the `Build sim-capture-private` step; renamed to drop the `(stub no-ops in Wave 0)` qualifier. Smoke step retains `|| echo "smoke stub — expected to fail until T-32.7"` until Plan 32-05 lands the real smoke script.

## Task Commits

1. **Task 4.1: SimCapturePrivateClient + CaptureService integration + 5 vitest cases** — `9b28ae9` (feat)
2. **Task 4.2: Real build-sim-capture-private.sh + non-blocking postinstall.js + CI build-step tighten** — `34eaccd` (chore)

**Plan metadata commit:** _pending_ (this SUMMARY + STATE.md + ROADMAP.md update).

## Files Created/Modified

### Created (1)

- `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` — 279 lines (≥ 150 must_haves min_lines). Node-side IPC client + EventEmitter `frame` events + sendTouch + idempotent stop. Wire format mirrors IpcServer.mm byte-for-byte.

### Modified (7)

- `device-stream/packages/ios-simulator/src/capture-service.ts` — `startCapture` gains a Phase-32 fast path: dynamic import + SimCapturePrivateClient.spawn under `format === 'avcc' && DEVICE_STREAM_SIM_PRIVATE !== '0'`, fall through to startAvccCapture on throw. `stopCapture` routes through `privateClient.stop()` when present.
- `device-stream/packages/ios-simulator/src/index.ts` — re-exports `SimCapturePrivateClient`, `SimCapturePrivateOptions`, `SimCapturePrivateFrameEvent`.
- `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` — replaced 5 it.todo placeholders with 5 fully-implemented test cases (all green).
- `device-stream/packages/ios-simulator/tests/capture-service.spec.ts` — added `DEVICE_STREAM_SIM_PRIVATE=0` opt-out in beforeEach so the existing 6 AVCC-mode tests keep exercising the legacy sim-capture-avcc binary path.
- `device-stream/scripts/build-sim-capture-private.sh` — removed `SIM_PRIVATE_WAVE0_STUB` guard; added preflight error messages; same xcodegen+xcodebuild Release flow that landed in the Wave-0 stub body, now unconditional.
- `device-stream/scripts/postinstall.js` — added `DEVICE_STREAM_SKIP_BUILD=1` opt-out env var, non-blocking on build failure (always `process.exit(0)`), clearer logging.
- `.github/workflows/sim-private-matrix.yml` — Build step renamed + made fail-fast (Wave-0 stub-exit echo removed).

## Decisions Made

(See `key-decisions` in frontmatter for the canonical list; expanded narrative for the two that drove the largest design choices:)

- **Dynamic-import inside startCapture (not top-level require)**. The `import('./sim-capture-private-client.js')` is the seam that makes the spec's `vi.doMock` + `vi.resetModules` pattern work. Top-level require would resolve the module before the test could swap it. Side benefit: env=0 callers never load the module, so the cost of the fallback gate is one `process.env` read and one boolean check — no parser allocations, no socket setup attempt.

- **NAL-unit-type inspection for keyframe/delta (not "first frame after paramSets")**. The plan's `<interfaces>` block offered two options; option (a) "treat first 0x02 after 0x01 as keyframe, delta thereafter" is fragile because VideoToolbox can re-emit paramSets mid-session (resolution change, force_idr handler). Option (b) "read NAL unit type from payload byte 4" is robust against any IDR cadence and is the standard H.264 convention. Implemented option (b) with `payload[4] & 0x1F` (the AVCC envelope's first NAL is at offset 4 because bytes 0..3 are the NAL length prefix).

- **Non-blocking postinstall via unconditional exit(0)**. The brief mandates `install is non-blocking on build failure`. spawnSync's non-zero status is logged but does NOT propagate. Runtime contract picks up the slack: `SimCapturePrivateClient.spawn()` checks `fs.existsSync(binaryPath)` and throws if missing → CaptureService.startCapture catches the throw and falls through to startAvccCapture. End user on a host where Xcode wasn't installed gets MJPEG (default) or the legacy AVCC binary — never a broken install.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan-literal test 5 byte count off by one**

- **Found during:** Task 4.1 (writing the sendTouch test)
- **Issue:** Plan acceptance literal said "writes a 33-byte buffer `[u32 BE 30][0xC1][f64 BE 0.5][f64 BE 0.5][0x00][f64 BE 1.0][u32 BE 0]`". Counting those: 4 (length) + 1 (kind) + 8 (x) + 8 (y) + 1 (phase) + 8 (pressure) + 4 (touchId) = 34 bytes, not 33. The length field value (30) is correct (1 kind + 29 payload = 30).
- **Fix:** Wrote test 5 with `expect(w.length).toBe(34)` and named it `writes a 34-byte 0xC1 control frame`. The wire shape, length field, and per-field byte offsets all match the daemon-side `DSFramerDecodeTouchPayload` in IpcServer.mm (which expects exactly 29 bytes of payload).
- **Files modified:** `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts`
- **Verification:** Test 5 passes; sendTouch implementation writes the exact 34-byte buffer the daemon's framer expects (cross-checked vs Plan 32-03's `testDecodeControlTouchFrame` which also uses 34 bytes total).
- **Committed in:** `9b28ae9` (Task 4.1)

**2. [Rule 1 — Bug] Existing capture-service.spec.ts regressed against the new private-bridge gate**

- **Found during:** Task 4.1 (running the full ios-simulator test suite after landing the CaptureService gating)
- **Issue:** The pre-existing 6 AVCC-mode tests in `capture-service.spec.ts` exercise the legacy sim-capture-avcc binary by mocking `fs.existsSync(() => true)` and `child_process.spawn(...)`. With the new gate defaulting ON (env not '0'), `startCapture` tried the private bridge first — which called `fs.existsSync('/.../bin/sim-capture-private')` (returned true under the test mock) and then `child_process.spawn(<binary>, ['--udid', 'UDID-X', '--socket', '/tmp/...'])` (captured by the test's spawned[] array as the first spawn instead of the AVCC binary spawn). 5 of the 6 tests then hung or failed because the test's spawn capture array contained the wrong first entry.
- **Fix:** Added `DEVICE_STREAM_SIM_PRIVATE=0` opt-out in capture-service.spec.ts's beforeEach (saved/restored prev value in afterEach). The 6 AVCC-mode tests now exercise the legacy binary path exclusively — exactly what they were originally designed to verify.
- **Files modified:** `device-stream/packages/ios-simulator/tests/capture-service.spec.ts`
- **Verification:** Full ios-simulator test suite 83/83 green after the fix.
- **Committed in:** `9b28ae9` (Task 4.1, combined with the gate impl + new spec)

**3. [Rule 2 — Missing critical] Plan-literal SimCapturePrivateClient lacked a test-shaped constructor**

- **Found during:** Task 4.1 (designing the framer unit tests)
- **Issue:** The plan literal showed `SimCapturePrivateClient.spawn(udid, opts)` as the only entry point. Spawn() does real `child_process.spawn`, real `fs.existsSync`, real `net.createConnection`. Unit tests for the parse loop alone (tests 1 + 2) need a way to drive the loop with a FakeSocket without filesystem / child_process / network involvement. Without a test entry, tests 1 + 2 would have required heavy mocking of node:fs + node:net + node:child_process AND coordinating their async callbacks — fragile and hard to read.
- **Fix:** Added `static fromConnectedSocket(udid, proc, sock)` — a non-test-shaped name that simply wraps the private constructor. Same precedent as DSIpcServer.initWithConnectedFd: from Plan 32-03 (test-only-shaped but production-safe; a future plan could legitimately wire an inherited socket from a supervising process). The framer tests construct via fromConnectedSocket() and drive the FakeSocket directly.
- **Files modified:** `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts`
- **Verification:** Tests 1 + 2 pass; the production .spawn() path is unchanged and unaffected.
- **Committed in:** `9b28ae9` (Task 4.1)

**4. [Rule 3 — Blocking] Fallback test 4 (`falls back when spawn fails`) timed out under fake timers**

- **Found during:** Task 4.1 (first run of the 5 specs — 4 passed, 1 timed out at 5s)
- **Issue:** Initial draft of test 4 used `vi.useFakeTimers()` + `vi.advanceTimersByTime(1100)` (same pattern as capture-service.spec.ts). But the flow is more complex than the existing AVCC tests: dynamic import of sim-capture-private-client → await spawn that throws → catch and fall through to startAvccCapture → spawn the AVCC fake → setTimeout-1000ms-resolves-true. Fake timers were advancing the clock BEFORE the dynamic import + thrown-spawn microtasks had drained, so startAvccCapture's setTimeout never registered when the time was advanced.
- **Fix:** Switched test 4 to real timers; instead of relying on the 1000ms fallback-resolve, emit a single AVCC keyframe frame on `avccProc.stdout` to trigger the `firstFrameResolved = true` path immediately. Yields one `setImmediate` before emitting so the dynamic-import + spawn-throws microtasks have a chance to drain.
- **Files modified:** `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts`
- **Verification:** Test 4 passes in 150ms; the assertion that `cp.spawn` was called (AVCC fallback took over) AND that `spawnSpy` was called exactly once (private bridge was attempted) both hold.
- **Committed in:** `9b28ae9` (Task 4.1)

**Total deviations:** 4 auto-fixed (1 plan-literal byte-count typo, 1 existing-test env-isolation regression, 1 missing-critical test entry on the SUT, 1 blocking test-timer-vs-microtask race).
**Impact on plan:** Shape preserved. All `files_modified` deliverables landed; the test entry (`fromConnectedSocket`) is strictly additive and consistent with Plan 32-03's precedent. The capture-service.spec.ts env opt-out is the minimum surgical change to keep existing tests green under the new gate.

## Issues Encountered

- **Vitest output filtering under rtk-tee.** `npx vitest run` showed `numTotalTests: 0` under the default tee pipeline. Ran via `rtk proxy npx vitest run ...` to bypass and see real reporter output. No functional impact — every test was actually executing; just the tee summary was stripping the verbose reporter. Documenting for future plan executions: when vitest report counts don't match expectations, retry via `rtk proxy` for the raw stream.
- **Spec discovery scope.** Vitest config at `device-stream/vitest.config.ts` includes `packages/**/tests/**/*.spec.ts` and excludes `**/node_modules/**`. Running from `packages/ios-simulator/` directly fails with "No test files found" because the include glob is relative to the device-stream root. Always run vitest from `device-stream/` cwd (or use the npm script `npm test -w @device-stream/ios-simulator` which sets the right config path).
- **xcodebuild warnings on this host.** Same as Plan 32-01 / 32-02 / 32-03: `building for macOS-13.0, but linking with dylib '@rpath/SimulatorKit.framework/Versions/A/SimulatorKit' which was built for newer version 14.0` (also for CoreSimulator). Warnings only, build succeeds. Plan 32-04's build script doesn't try to suppress them.

## Next Phase Readiness

- **Plan 32-05 (T-32.7) unblocked.** Smoke test command: `bin/sim-capture-private --udid <real-udid> --socket /tmp/test.sock &` then a Node test process that opens a SOCK_STREAM client to `/tmp/test.sock`, sends one 0xC1 touch, asserts ≥30 frames within 5s. The TS adapter (SimCapturePrivateClient) is the natural client for this smoke. Build script + postinstall guarantee the daemon binary is on disk for darwin/arm64 CI runners after `npm ci`.

- **Zero downstream changes required.** stream-service.ts, gesture-service.ts, and the server-side WebSocket broadcaster all consume CaptureService 'frame' events with the same `{udid, kind, payload}` envelope as before. The private-bridge path emits the same envelope shape (Plan 32-04 verified this in the TS adapter's parse loop). The server doesn't know — and doesn't need to know — that the underlying H.264 source switched from sim-capture-avcc to sim-capture-private.

- **External Dependencies Policy honored.** No new npm/Go/CocoaPods/SwiftPM dependencies. No kittyfarm/simvyn/revyl-cli/app-explorer/mobile-devtools linkage. All code is in-tree.

- **No regressions to Plans 32-00 / 32-01 / 32-02 / 32-03.** Plan 32-03's IpcFramerTests (4/4), Plan 32-01's DyldSymbolsTests (4/4), Plan 32-02's TouchInjectTests (4/4) all still pass. The daemon binary rebuilds clean. The new TS adapter + spec are strictly additive.

## Self-Check: PASSED

**Files on disk (8/8):**

- `device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` (created, 279 lines, ≥ 150 must_haves min_lines) — FOUND
- `device-stream/packages/ios-simulator/src/capture-service.ts` (modified — startCapture gating + stopCapture routing) — FOUND
- `device-stream/packages/ios-simulator/src/index.ts` (modified — SimCapturePrivateClient re-export) — FOUND
- `device-stream/packages/ios-simulator/tests/sim-capture-private-client.spec.ts` (modified — 5 it.todo → 5 real tests) — FOUND
- `device-stream/packages/ios-simulator/tests/capture-service.spec.ts` (modified — DEVICE_STREAM_SIM_PRIVATE=0 opt-out in beforeEach) — FOUND
- `device-stream/scripts/build-sim-capture-private.sh` (modified — Wave-0 stub guard removed) — FOUND
- `device-stream/scripts/postinstall.js` (modified — non-blocking on failure) — FOUND
- `.github/workflows/sim-private-matrix.yml` (modified — Build step fail-fast) — FOUND
- `device-stream/bin/sim-capture-private` (built on this host, 129 KB, executable) — FOUND (untracked; not committed, matches the existing convention where sim-capture-avcc IS tracked but build outputs aren't typically added mid-plan — leaving to future operational commit if desired)

**Task commits present in git history (2/2):** `9b28ae9` (Task 4.1), `34eaccd` (Task 4.2).

**Acceptance commands pass:**

- `cd device-stream && npx vitest run packages/ios-simulator/tests/sim-capture-private-client.spec.ts` → `Tests  5 passed (5)`
- `cd device-stream && npx vitest run packages/ios-simulator/tests/` → `Tests  83 passed (83)`
- `cd device-stream/packages/ios-simulator && npm run build` → tsc emits dist/ clean
- `bash device-stream/scripts/build-sim-capture-private.sh` → exit 0; `device-stream/bin/sim-capture-private` exists and is executable; `--probe`-less invocation prints usage
- `DEVICE_STREAM_SKIP_BUILD=1 node device-stream/scripts/postinstall.js` → exit 0 with skip message

**Grep acceptance counts (Task 4.1):**

- `wc -l device-stream/packages/ios-simulator/src/sim-capture-private-client.ts` → 279 (≥ 150)
- `grep -c "DEVICE_STREAM_SIM_PRIVATE" sim-capture-private-client.ts capture-service.ts` → 19 combined (≥ 2)
- `grep -c "SimCapturePrivateClient" capture-service.ts` → 2 (≥ 2)
- `grep -c "0xC1\|0xC9" sim-capture-private-client.ts` → 6 (≥ 2)
- `grep -c "writeDoubleBE\|readUInt32BE" sim-capture-private-client.ts` → 4 (≥ 3)
- `grep -c "nal_unit_type\|nalType\|& 0x1F" sim-capture-private-client.ts` → 4 (≥ 1)
- `grep -c "it.todo\|it.skip" sim-capture-private-client.spec.ts` → 0 (must be 0)
- `grep -c "it(" sim-capture-private-client.spec.ts` → 5 (≥ 5)

**Grep acceptance counts (Task 4.2):**

- `grep -c "xcodebuild\|xcodegen generate" device-stream/scripts/build-sim-capture-private.sh` → 2 (≥ 2)
- `grep -c "SIM_PRIVATE_WAVE0_STUB" device-stream/scripts/build-sim-capture-private.sh` → 0 (must be 0)
- `grep -c "process.exit(0)" device-stream/scripts/postinstall.js` → 2 (≥ 1)
- `grep -c "spawnSync" device-stream/scripts/postinstall.js` → 2 (≥ 1)
- `grep -c "Wave 0 stub exit" .github/workflows/sim-private-matrix.yml` for the "Build" step → 0 (the smoke step still has `expected to fail until T-32.7` per plan)

**No new external repo deps:** `grep -rE "kittyfarm|simvyn|revyl-cli|app-explorer|mobile-devtools" device-stream/packages/ios-simulator/{src,tests} device-stream/scripts` returns zero matches. No npm/SwiftPM/CocoaPods/Cartfile additions.

---
*Phase: 32-simulatorkit-bridge*
*Completed: 2026-05-16*
