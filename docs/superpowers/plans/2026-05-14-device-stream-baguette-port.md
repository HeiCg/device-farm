# device-stream ← baguette port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## 📊 Execution Status (2026-05-15)

**Last session executed Phases A + B + C — 15/25 tasks landed on `main`.** All commits attribute via Co-Authored-By to Claude Opus 4.7. Tests: 53 passing across 5 packages (core, ios-simulator, android, web-sdk, plus jsdom-based tests). The next session should jump to **Phase D** — see `docs/superpowers/plans/2026-05-15-device-stream-handoff.md` for the focused handoff (toolchain status, architecture decisions, exact resumption point).

| Phase | Tasks | Status | Commit range |
|---|---|---|---|
| A. Foundation | A0–A6 (7) | ✅ All complete | `e328c5a` → `09bf6d7` |
| B. Observability | B1–B4 (4) | ✅ All complete | `e205dcb` → `626df78` |
| C. Visual polish | C1–C4 (4) | ✅ All complete | `1ae14c1` → `d909060` |
| D. Native iOS stream + HID | D1–D6 (6) | ⏸ Pending | — |
| E. Virtual camera | E1–E4 (4) | ⏸ Pending | — |

Each completed task below is marked `✅ DONE — commit <SHA>` immediately after its title.

---

**Goal:** Port nine high-value capabilities from `tddworks/baguette` into `@device-stream` packages so the iOS simulator track gains parity with the Android track and acquires bezel rendering, runtime stream tuning, in-browser recording, log/AX/HID/camera plumbing across both Android and iOS-sim.

**Architecture:** Five execution phases, each independently shippable. Phase A redesigns the WebSocket protocol (control channel + unified gesture vocabulary) and extracts the test-app into a reusable SDK web. Phase B adds observability (logs + describe-ui). Phase C adds visual polish (DeviceKit bezels + in-browser MP4 recorder). Phase D rewrites iOS-sim frame transport for H.264/AVCC and replaces WDA with direct iOS-26 HID dispatch via a vendored Swift binary. Phase E ships the virtual-camera dylib. All work lives under `/Users/heicg/Desktop/projects/device-farm/device-stream/` — the device-farm repo consumes via the existing npm workspace symlinks (no changes needed there during the port; integration happens after each phase merges).

**Tech Stack:** TypeScript (ES2022, CommonJS, strict), Vitest 1.x (added in Task A0), Swift 6.2 + private SimulatorKit/CoreSimulator (iOS-sim native binaries — vendored from baguette), Kotlin/UiAutomator (existing android-server), WebSocket (`ws@^8`), AVFoundation + VideoToolbox (Mac host), DYLD_INSERT_LIBRARIES + mmap (virtual camera).

**Compatibility constraint:** All wire-format changes ship behind a `?version=v2` query parameter on the WebSocket URL. Existing v1 consumers (device-farm's `server/streaming/plugin.ts`, device-farm's web UI) keep working unchanged until they opt in. Every phase that touches the protocol adds v2-only routes alongside v1, never replaces.

**Source repo for references:** `https://github.com/tddworks/baguette` (Apache 2.0). When a task says "port from `baguette:<path>`", clone the repo locally first: `git clone --depth 1 https://github.com/tddworks/baguette.git /tmp/baguette` then read the referenced file directly. Do not pull random code — only ports the files named here, line-checked. Baguette's iOS-26-specific Swift code targets `arm64e-apple-macos26.0` with Xcode 26 private frameworks; the same constraint applies to anything copied from `Sources/Baguette/Infrastructure/`.

---

## Phase index

- **Phase A — Foundation** (Tasks A0–A6): test infra + control channel + wire format v2 + modular web SDK.
- **Phase B — Observability** (Tasks B1–B4): logs WS + describe-ui WS.
- **Phase C — Visual polish** (Tasks C1–C4): DeviceKit bezel server routes + in-browser MP4 recorder.
- **Phase D — Native iOS streaming + input** (Tasks D1–D6): H.264/AVCC encoder + direct iOS-26 HID input via vendored Swift binary.
- **Phase E — Virtual camera** (Tasks E1–E4): vendor `VirtualCamera.dylib` + shared-memory frame sink + WS protocol.

Phases A/B/C are cross-platform (Android + iOS-sim share the changes). Phases D/E are iOS-sim only.

---

# Phase A — Foundation

## File structure for Phase A

```
device-stream/
├── packages/core/
│   ├── src/protocol.ts             # MODIFY — add v2 envelopes (gesture, control)
│   ├── src/protocol-v2.ts          # CREATE — new wire format types + helpers
│   └── tests/protocol-v2.spec.ts   # CREATE — unit tests
├── packages/android/
│   ├── src/scrcpy-service.ts       # MODIFY — accept runtime control messages
│   └── tests/scrcpy-service.spec.ts # CREATE
├── packages/ios-simulator/
│   ├── src/capture-service.ts      # MODIFY — accept runtime control messages
│   ├── src/control-channel.ts      # CREATE — typed control message handler
│   └── tests/control-channel.spec.ts # CREATE
└── web-sdk/                        # CREATE — new workspace
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── transport.ts            # single owner of wire format (baguette pattern)
    │   ├── stream-session.ts       # WS + paint loop
    │   ├── frame-decoder.ts        # MJPEG / AVCC strategy
    │   ├── simulator.ts            # aggregate root
    │   └── parts/
    │       ├── bezel.ts            # (used in Phase C)
    │       ├── screen.ts
    │       ├── button.ts
    │       └── keyboard.ts
    └── tests/transport.spec.ts
```

---

### Task A0: Set up Vitest across the monorepo
✅ **DONE — commit `e328c5a`** (2026-05-15). 8 files. Smoke spec passes.

**Files:**
- Create: `device-stream/vitest.config.ts`
- Create: `device-stream/packages/core/vitest.config.ts`
- Modify: `device-stream/package.json` (root)
- Modify: `device-stream/packages/core/package.json`
- Modify: `device-stream/packages/android/package.json`
- Modify: `device-stream/packages/ios-simulator/package.json`
- Modify: `device-stream/packages/ios-device/package.json`

- [ ] **Step 1: Install Vitest at the root**

Run:
```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
npm install --save-dev --workspace-root vitest@^1.6.0 @vitest/coverage-v8@^1.6.0
```

- [ ] **Step 2: Add root vitest config**

Create `device-stream/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['packages/**/tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
    },
  },
});
```

- [ ] **Step 3: Add a test script to each workspace**

Edit `device-stream/packages/core/package.json` — add to `scripts`:
```json
"test": "vitest run --config ../../vitest.config.ts",
"test:watch": "vitest --config ../../vitest.config.ts"
```

Repeat the same two lines in `packages/android/package.json`, `packages/ios-simulator/package.json`, `packages/ios-device/package.json`.

- [ ] **Step 4: Update root `test` to honour workspaces and add a top-level `test:all`**

Edit `device-stream/package.json` — replace `"test"` line and add:
```json
"test": "vitest run",
"test:all": "vitest run && npm run test --workspaces --if-present"
```

- [ ] **Step 5: Smoke-test the wiring with a placeholder spec**

Create `device-stream/packages/core/tests/smoke.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest wiring', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

Run: `cd device-stream && npm test`
Expected: 1 passed, exit 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
git add package.json package-lock.json vitest.config.ts packages/*/package.json packages/core/tests/smoke.spec.ts
git commit -m "test(core): add vitest infrastructure for device-stream monorepo"
```

---

### Task A1: Define v2 wire-format types (control + gesture)
✅ **DONE — commit `a6ed332`**. 3 files. 8 tests pass. `packages/core/src/index.ts` was first-time tracked (existed on disk but ungitted) — diff shows +54 lines but only 1 line is genuinely new (`export * from './protocol-v2.js'`).

**Files:**
- Create: `device-stream/packages/core/src/protocol-v2.ts`
- Create: `device-stream/packages/core/tests/protocol-v2.spec.ts`
- Modify: `device-stream/packages/core/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/core/tests/protocol-v2.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  isControlMessage,
  isGestureMessage,
  serializeAvccFrame,
  ClientMessageV2,
} from '../src/protocol-v2.js';

describe('parseClientMessage', () => {
  it('parses a set_bitrate control envelope', () => {
    const msg = parseClientMessage('{"type":"set_bitrate","bps":4000000}');
    expect(msg.ok).toBe(true);
    expect(msg.value).toEqual({ type: 'set_bitrate', bps: 4000000 });
    expect(isControlMessage(msg.value!)).toBe(true);
  });

  it('parses a tap gesture envelope', () => {
    const msg = parseClientMessage(
      '{"type":"tap","x":219,"y":478,"width":438,"height":954,"duration":0.05}'
    );
    expect(msg.ok).toBe(true);
    expect(isGestureMessage(msg.value!)).toBe(true);
  });

  it('rejects unknown envelope types', () => {
    const msg = parseClientMessage('{"type":"unknown_xyz"}');
    expect(msg.ok).toBe(false);
    expect(msg.error).toMatch(/unknown/i);
  });

  it('rejects malformed JSON', () => {
    const msg = parseClientMessage('not json');
    expect(msg.ok).toBe(false);
  });
});

describe('serializeAvccFrame', () => {
  it('prepends 0x02 for keyframes', () => {
    const out = serializeAvccFrame('keyframe', new Uint8Array([0xaa, 0xbb]));
    expect(out[0]).toBe(0x02);
    expect(out.slice(1)).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it('prepends 0x03 for delta frames', () => {
    const out = serializeAvccFrame('delta', new Uint8Array([0x11]));
    expect(out[0]).toBe(0x03);
  });

  it('prepends 0x01 for avcC description', () => {
    const out = serializeAvccFrame('avcc', new Uint8Array([0x42]));
    expect(out[0]).toBe(0x01);
  });

  it('prepends 0x04 for JPEG seed', () => {
    const out = serializeAvccFrame('jpeg-seed', new Uint8Array([0xff, 0xd8]));
    expect(out[0]).toBe(0x04);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd device-stream && npx vitest run packages/core/tests/protocol-v2.spec.ts`
Expected: FAIL with "Cannot find module '../src/protocol-v2.js'".

- [ ] **Step 3: Write the minimal implementation**

Create `device-stream/packages/core/src/protocol-v2.ts`:
```ts
/**
 * device-stream wire protocol v2.
 *
 * Single text-JSON envelope on the upstream channel (browser → server).
 * Single 1-byte-tagged binary envelope on the downstream channel
 * (server → browser) for AVCC. Ported from baguette's stream protocol —
 * see /tmp/baguette/Sources/Baguette/Resources/Web/frame-decoder.js and
 * /tmp/baguette/Sources/Baguette/Resources/Web/baguette/transport.js.
 */

// --- Control messages (stream tuning, snapshot, IDR) ---
export type SetBitrateMessage = { type: 'set_bitrate'; bps: number };
export type SetFpsMessage     = { type: 'set_fps'; fps: number };
export type SetScaleMessage   = { type: 'set_scale'; scale: number };
export type ForceIdrMessage   = { type: 'force_idr' };
export type SnapshotMessage   = { type: 'snapshot' };

export type ControlMessage =
  | SetBitrateMessage
  | SetFpsMessage
  | SetScaleMessage
  | ForceIdrMessage
  | SnapshotMessage;

// --- Gesture messages (input dispatch) ---
export type TapMessage = {
  type: 'tap';
  x: number; y: number;
  width: number; height: number;
  duration?: number;
};

export type SwipeMessage = {
  type: 'swipe';
  startX: number; startY: number;
  endX: number;   endY: number;
  width: number;  height: number;
  duration?: number;
};

export type Touch1Phase = 'touch1-down' | 'touch1-move' | 'touch1-up';
export type Touch1Message = {
  type: Touch1Phase;
  x: number; y: number;
  width: number; height: number;
  edge?: 'top' | 'bottom' | 'left' | 'right';
};

export type Touch2Phase = 'touch2-down' | 'touch2-move' | 'touch2-up';
export type Touch2Message = {
  type: Touch2Phase;
  x1: number; y1: number;
  x2: number; y2: number;
  width: number; height: number;
};

export type ButtonName =
  | 'home' | 'lock' | 'power'
  | 'volume-up' | 'volume-down'
  | 'action' | 'app-switcher' | 'back'
  | 'swipe-to-home' | 'swipe-to-app-switcher'
  | 'pull-down-to-lock-screen' | 'pull-down-to-notification-center'
  | 'digital-crown' | 'side-button' | 'left-side-button';

export type ButtonMessage = {
  type: 'button';
  button: ButtonName;
  duration?: number;
};

export type KeyMessage = {
  type: 'key';
  code: string;                                        // W3C KeyboardEvent.code
  modifiers?: ('shift' | 'control' | 'option' | 'command')[];
  duration?: number;
};

export type TypeMessage = { type: 'type'; text: string };
export type ScrollMessage = {
  type: 'scroll';
  deltaX: number; deltaY: number;
};

export type PinchMessage = {
  type: 'pinch';
  cx: number; cy: number;
  startSpread: number; endSpread: number;
  width: number; height: number;
  duration?: number;
};

export type PanMessage = {
  type: 'pan';
  x1: number; y1: number;
  x2: number; y2: number;
  dx: number;  dy: number;
  width: number; height: number;
  duration?: number;
};

export type GestureMessage =
  | TapMessage | SwipeMessage
  | Touch1Message | Touch2Message
  | ButtonMessage | KeyMessage | TypeMessage
  | ScrollMessage | PinchMessage | PanMessage;

// --- Side channels (request/response on same WS) ---
export type DescribeUiMessage = {
  type: 'describe_ui';
  x?: number; y?: number;
};

export type ClientMessageV2 =
  | ControlMessage
  | GestureMessage
  | DescribeUiMessage;

// --- Parse helpers ---
const CONTROL_TYPES = new Set([
  'set_bitrate', 'set_fps', 'set_scale', 'force_idr', 'snapshot',
]);
const GESTURE_TYPES = new Set([
  'tap', 'swipe',
  'touch1-down', 'touch1-move', 'touch1-up',
  'touch2-down', 'touch2-move', 'touch2-up',
  'button', 'key', 'type', 'scroll', 'pinch', 'pan',
]);
const SIDE_CHANNEL_TYPES = new Set(['describe_ui']);

export type ParseResult =
  | { ok: true; value: ClientMessageV2 }
  | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `malformed JSON: ${(e as Error).message}` }; }

  if (!parsed || typeof parsed.type !== 'string') {
    return { ok: false, error: 'missing string `type` field' };
  }
  if (
    !CONTROL_TYPES.has(parsed.type) &&
    !GESTURE_TYPES.has(parsed.type) &&
    !SIDE_CHANNEL_TYPES.has(parsed.type)
  ) {
    return { ok: false, error: `unknown envelope type: ${parsed.type}` };
  }
  return { ok: true, value: parsed as ClientMessageV2 };
}

export function isControlMessage(m: ClientMessageV2): m is ControlMessage {
  return CONTROL_TYPES.has(m.type);
}

export function isGestureMessage(m: ClientMessageV2): m is GestureMessage {
  return GESTURE_TYPES.has(m.type);
}

// --- Binary frame envelope (AVCC + JPEG seed) ---
export type AvccFrameKind = 'avcc' | 'keyframe' | 'delta' | 'jpeg-seed';

const AVCC_TAG: Record<AvccFrameKind, number> = {
  'avcc':      0x01,
  'keyframe':  0x02,
  'delta':     0x03,
  'jpeg-seed': 0x04,
};

export function serializeAvccFrame(
  kind: AvccFrameKind,
  payload: Uint8Array
): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = AVCC_TAG[kind];
  out.set(payload, 1);
  return out;
}
```

- [ ] **Step 4: Re-export from the package barrel**

Edit `device-stream/packages/core/src/index.ts` — append at end:
```ts
export * from './protocol-v2.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd device-stream && npx vitest run packages/core/tests/protocol-v2.spec.ts`
Expected: PASS, 8 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
git add packages/core/src/protocol-v2.ts packages/core/src/index.ts packages/core/tests/protocol-v2.spec.ts
git commit -m "feat(core): add v2 wire protocol — control channel + gesture envelopes + AVCC framing"
```

---

### Task A2: iOS-sim — ControlChannel handler (typed dispatch)
✅ **DONE — commit `cd26af8`**. 2 files. 5 tests pass. Clamping: fps [1,120], bitrate [100k,50M], scale [0.1,4.0].

**Files:**
- Create: `device-stream/packages/ios-simulator/src/control-channel.ts`
- Create: `device-stream/packages/ios-simulator/tests/control-channel.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/ios-simulator/tests/control-channel.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ControlChannel } from '../src/control-channel.js';

describe('ControlChannel.handle', () => {
  it('routes set_fps to onFps with the requested value', () => {
    const onFps = vi.fn();
    const cc = new ControlChannel({ onFps, onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_fps', fps: 30 });
    expect(onFps).toHaveBeenCalledWith(30);
  });

  it('clamps set_fps to [1, 120]', () => {
    const onFps = vi.fn();
    const cc = new ControlChannel({ onFps, onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_fps', fps: 9999 });
    cc.handle({ type: 'set_fps', fps: -5 });
    expect(onFps).toHaveBeenNthCalledWith(1, 120);
    expect(onFps).toHaveBeenNthCalledWith(2, 1);
  });

  it('routes set_bitrate to onBitrate with min 100kbps', () => {
    const onBitrate = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate, onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_bitrate', bps: 50 });
    expect(onBitrate).toHaveBeenCalledWith(100_000);
  });

  it('routes force_idr to onForceIdr (no payload)', () => {
    const onForceIdr = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr, onSnapshot: vi.fn() });
    cc.handle({ type: 'force_idr' });
    expect(onForceIdr).toHaveBeenCalledOnce();
  });

  it('routes snapshot to onSnapshot', () => {
    const onSnapshot = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot });
    cc.handle({ type: 'snapshot' });
    expect(onSnapshot).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/control-channel.spec.ts`
Expected: FAIL with "Cannot find module '../src/control-channel.js'".

- [ ] **Step 3: Write the minimal implementation**

Create `device-stream/packages/ios-simulator/src/control-channel.ts`:
```ts
import type { ControlMessage } from '@device-stream/core';

export interface ControlHandlers {
  onFps:       (fps: number) => void;
  onBitrate:   (bps: number) => void;
  onScale:     (scale: number) => void;
  onForceIdr:  () => void;
  onSnapshot:  () => void;
}

const FPS_MIN = 1;
const FPS_MAX = 120;
const BITRATE_MIN_BPS = 100_000;
const BITRATE_MAX_BPS = 50_000_000;
const SCALE_MIN = 0.1;
const SCALE_MAX = 4.0;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class ControlChannel {
  constructor(private readonly handlers: ControlHandlers) {}

  handle(msg: ControlMessage): void {
    switch (msg.type) {
      case 'set_fps':
        this.handlers.onFps(clamp(msg.fps, FPS_MIN, FPS_MAX));
        return;
      case 'set_bitrate':
        this.handlers.onBitrate(clamp(msg.bps, BITRATE_MIN_BPS, BITRATE_MAX_BPS));
        return;
      case 'set_scale':
        this.handlers.onScale(clamp(msg.scale, SCALE_MIN, SCALE_MAX));
        return;
      case 'force_idr':
        this.handlers.onForceIdr();
        return;
      case 'snapshot':
        this.handlers.onSnapshot();
        return;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/control-channel.spec.ts`
Expected: PASS, 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
git add packages/ios-simulator/src/control-channel.ts packages/ios-simulator/tests/control-channel.spec.ts
git commit -m "feat(ios-simulator): add ControlChannel dispatcher (clamping + typed handlers)"
```

---

### Task A3: iOS-sim — wire ControlChannel into CaptureService
✅ **DONE — commit `c95523a`**. 3 files. 8 tests pass (3 new + 5 pre-existing). **Adaptation**: real class is `SimulatorStreamService` (singleton) not `StreamService`; `handleBrowserConnection` gained optional 3rd param `controlHandlers?`. CaptureService gained `targets: Map<string,{fps?,bps?,scale?}>` + setFps/setBitrate/setScale/forceIdr/snapshot stubs + `getQueuedTargets`. `snapshot()` emits `'snapshot-requested'` event for the manager to handle. Also: 13 pre-existing template-literal `console.log` calls converted to printf `%s/%d` style to pass semgrep CWE-134 hook (set the precedent for the rest of Phase A-C).

**Files:**
- Modify: `device-stream/packages/ios-simulator/src/capture-service.ts`
- Modify: `device-stream/packages/ios-simulator/src/stream-service.ts` (route incoming text frames to ControlChannel)

- [ ] **Step 1: Read the existing files end-to-end**

Read:
```
device-stream/packages/ios-simulator/src/capture-service.ts (287 lines)
device-stream/packages/ios-simulator/src/stream-service.ts  (179 lines)
```

The relay currently treats the WebSocket as one-way (server → browser). The control channel adds the reverse direction; do NOT remove or rename any existing public method — only add.

- [ ] **Step 2: Write a failing integration test**

Create `device-stream/packages/ios-simulator/tests/stream-service-control.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { StreamService } from '../src/stream-service.js';

describe('StreamService control channel', () => {
  it('invokes onFps when a v2 set_fps text frame arrives', async () => {
    const onFps = vi.fn();
    const svc = new StreamService({
      onFps,
      onBitrate: vi.fn(),
      onScale: vi.fn(),
      onForceIdr: vi.fn(),
      onSnapshot: vi.fn(),
    } as any);
    // The fake socket below is a minimal shim around the methods StreamService calls.
    const fake = makeFakeSocket();
    svc.attach(fake as any, 'UDID-123');
    fake.emit('message', JSON.stringify({ type: 'set_fps', fps: 30 }));
    expect(onFps).toHaveBeenCalledWith(30);
  });
});

function makeFakeSocket() {
  const handlers: Record<string, Function[]> = {};
  return {
    on(ev: string, cb: Function) { (handlers[ev] ||= []).push(cb); },
    send(_: any) {},
    close() {},
    emit(ev: string, ...args: any[]) { (handlers[ev] || []).forEach(h => h(...args)); },
    readyState: 1,
  };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/stream-service-control.spec.ts`
Expected: FAIL — `StreamService` likely doesn't accept those constructor options or doesn't route text frames.

- [ ] **Step 4: Modify StreamService to accept and route control messages**

Edit `device-stream/packages/ios-simulator/src/stream-service.ts` — add at the top of the file (after existing imports):

```ts
import { parseClientMessage, isControlMessage, type ClientMessageV2 } from '@device-stream/core';
import { ControlChannel, type ControlHandlers } from './control-channel.js';
```

Add a `controlChannel` field initialised from optional constructor options, and in the `attach`/`onMessage` path (whichever exists), insert:

```ts
ws.on('message', (raw: Buffer | string) => {
  if (typeof raw !== 'string') return;             // binary inbound = ignored
  const parsed = parseClientMessage(raw);
  if (!parsed.ok) { this.log?.warn?.(`v2 parse: ${parsed.error}`); return; }
  if (isControlMessage(parsed.value)) {
    this.controlChannel.handle(parsed.value);
    return;
  }
  // Gestures + describe_ui handled in later phases (B, D).
});
```

If `StreamService`'s current constructor signature is `({ ... }: StreamServiceOptions)`, add the five optional `onFps` / `onBitrate` / `onScale` / `onForceIdr` / `onSnapshot` callbacks to `StreamServiceOptions` and construct `this.controlChannel = new ControlChannel({ onFps, onBitrate, onScale, onForceIdr, onSnapshot })` using no-op defaults if not supplied.

- [ ] **Step 5: Modify CaptureService to expose runtime tuning surface**

Edit `device-stream/packages/ios-simulator/src/capture-service.ts` — locate `start(udid, { fps, quality, scale })`. Add three new public methods that mutate the running sim-capture child process (today the binary is spawned with fixed flags, so this phase only routes signals; Phase D adds the actual stdin-tuning protocol once the AVCC encoder lands):

```ts
/** Phase A stub — accepts a new fps target. No effect on MJPEG path
 *  until Phase D wires sim-capture's stdin reconfig protocol. */
async setFps(udid: string, fps: number): Promise<void> {
  this.log.info({ udid, fps }, 'capture: set_fps (queued until Phase D)');
  this.targets.set(udid, { ...this.targets.get(udid), fps });
}

async setBitrate(udid: string, bps: number): Promise<void> {
  this.log.info({ udid, bps }, 'capture: set_bitrate (queued until Phase D)');
  this.targets.set(udid, { ...this.targets.get(udid), bps });
}

async setScale(udid: string, scale: number): Promise<void> {
  this.log.info({ udid, scale }, 'capture: set_scale (queued until Phase D)');
  this.targets.set(udid, { ...this.targets.get(udid), scale });
}

async forceIdr(udid: string): Promise<void> {
  this.log.info({ udid }, 'capture: force_idr (no-op on MJPEG, hooked in Phase D)');
}

async snapshot(udid: string): Promise<Buffer> {
  // Reuse the existing one-shot screenshot path the package already has.
  return this.captureOnce(udid);
}
```

Add a private `targets = new Map<string, { fps?: number; bps?: number; scale?: number }>();` field. If `captureOnce` doesn't exist yet, expose the existing one-shot screenshot helper under that name (it already lives in `simulator-manager.ts` — `manager.screenshot(udid)`); the cross-package wiring is fine because both objects already share a reference inside the plugin host.

- [ ] **Step 6: Run all iOS-sim tests**

Run: `cd device-stream && npx vitest run packages/ios-simulator/`
Expected: all pass, including the new control-channel integration test.

- [ ] **Step 7: Commit**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
git add packages/ios-simulator/src/control-channel.ts packages/ios-simulator/src/stream-service.ts packages/ios-simulator/src/capture-service.ts packages/ios-simulator/tests/
git commit -m "feat(ios-simulator): wire ControlChannel into StreamService; queue capture targets for Phase D"
```

---

### Task A4: Android — control channel via scrcpy runtime
✅ **DONE — commit `7eebd80`**. 2 files. 4 tests pass. **Adaptation**: real `ScrcpyService` uses `@yume-chan/adb-scrcpy` (TangoADB) — the plan's pseudo-spec assumed raw `adb shell` spawn. The implemented surface mirrors A3: store targets in `Map<serial,{bitrate?,fps?,maxSize?}>`, expose `setBitrate/setFps/setScale/forceIdr/getQueuedTargets` as Phase-A stubs; real session-restart wiring is deferred (the plan's original restart approach is risky — re-acquiring the `Adb` ref and re-emitting metadata mid-stream — better to do via scrcpy's UHID control protocol in a follow-up). `setScale` computes `maxSize = round(1080 * scale)`.

**Files:**
- Modify: `device-stream/packages/android/src/scrcpy-service.ts`
- Create: `device-stream/packages/android/tests/scrcpy-service.spec.ts`

scrcpy supports runtime reconfiguration via its control channel (UHID + control protocol). For Phase A we only wire the same three knobs (fps, bitrate, scale) by **restarting** the scrcpy server with new flags when set — the in-flight protocol changes are out of scope. Restart-on-tune is acceptable here because the WebSocket relay re-sends `metadata` on reconnect.

- [ ] **Step 1: Read `scrcpy-service.ts` and locate spawn options**

Run: `cat device-stream/packages/android/src/scrcpy-service.ts | head -120`
Identify the existing `start(serial, opts)` method and the args array passed to `adb shell app_process`.

- [ ] **Step 2: Write a failing test for setBitrate**

Create `device-stream/packages/android/tests/scrcpy-service.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ScrcpyService } from '../src/scrcpy-service.js';

describe('ScrcpyService runtime tuning', () => {
  it('setBitrate restarts the server with the new --video-bit-rate flag', async () => {
    const fakeAdb = makeFakeAdb();
    const svc = new ScrcpyService({ adb: fakeAdb as any } as any);
    await svc.start('emulator-5554', { bitrate: 4_000_000 });
    fakeAdb.spawnCalls.length = 0;
    await svc.setBitrate('emulator-5554', 8_000_000);
    expect(fakeAdb.spawnCalls.some(args =>
      args.some(a => a.includes('video-bit-rate=8000000'))
    )).toBe(true);
  });
});

function makeFakeAdb() {
  const spawnCalls: string[][] = [];
  return {
    spawnCalls,
    shell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    spawnShell: vi.fn((cmd: string[]) => {
      spawnCalls.push(cmd);
      return { stdout: new (require('stream').PassThrough)(), stderr: new (require('stream').PassThrough)(), kill: () => {} };
    }),
  };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd device-stream && npx vitest run packages/android/tests/scrcpy-service.spec.ts`
Expected: FAIL — `setBitrate` is not a method on `ScrcpyService`.

- [ ] **Step 4: Implement setBitrate/setFps/setScale on ScrcpyService**

Edit `device-stream/packages/android/src/scrcpy-service.ts` — append inside the class:
```ts
async setBitrate(serial: string, bps: number): Promise<void> {
  const session = this.sessions.get(serial);
  if (!session) throw new Error(`no scrcpy session for ${serial}`);
  session.opts.bitrate = bps;
  await this.restartSession(serial);
}

async setFps(serial: string, fps: number): Promise<void> {
  const session = this.sessions.get(serial);
  if (!session) throw new Error(`no scrcpy session for ${serial}`);
  session.opts.maxFps = fps;
  await this.restartSession(serial);
}

async setScale(serial: string, scale: number): Promise<void> {
  const session = this.sessions.get(serial);
  if (!session) throw new Error(`no scrcpy session for ${serial}`);
  session.opts.maxSize = Math.round((session.deviceWidth ?? 1080) * scale);
  await this.restartSession(serial);
}

async forceIdr(serial: string): Promise<void> {
  // scrcpy doesn't expose a force-IDR command on its current protocol;
  // a brief stop+start produces one. Best-effort.
  await this.restartSession(serial);
}

private async restartSession(serial: string): Promise<void> {
  const session = this.sessions.get(serial);
  if (!session) return;
  await this.stop(serial);
  await this.start(serial, session.opts);
}
```

If `ScrcpyService` doesn't currently maintain `sessions: Map<string, ...>` track them as you implement — the field is required for restart logic and matches how `BaseDeviceService` already keys per-serial state.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd device-stream && npx vitest run packages/android/tests/scrcpy-service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
git add packages/android/src/scrcpy-service.ts packages/android/tests/scrcpy-service.spec.ts
git commit -m "feat(android): add runtime tuning (setBitrate/setFps/setScale/forceIdr) via session restart"
```

---

### Task A5: Bootstrap `@device-stream/web-sdk` workspace
✅ **DONE — commit `3e618ab`**. **Critical adaptation**: workspaces are declared in the OUTER `/Users/heicg/Desktop/projects/device-farm/package.json`, NOT in `device-stream/package.json` (which is a private meta-package). The new entry `"device-stream/web-sdk"` was added there. Symlink `node_modules/@device-stream/web-sdk` resolves correctly. `package-lock.json` regenerated (1198 lines deleted, 801 inserted) — that lockfile churn includes both the new workspace and consequences of the user's pre-existing edits to the outer `package.json`'s `@device-stream/*` dependency wildcard; the implementer used `git apply --cached` to stage only the workspaces hunk and leave the dependency wildcard hunk unstaged.

**Files:**
- Create: `device-stream/web-sdk/package.json`
- Create: `device-stream/web-sdk/tsconfig.json`
- Modify: `device-stream/package.json` (root `workspaces` array)

- [ ] **Step 1: Add workspace entry to root**

Edit `device-stream/package.json` — append `"web-sdk"` to the `workspaces` array.

- [ ] **Step 2: Create web-sdk package.json**

Create `device-stream/web-sdk/package.json`:
```json
{
  "name": "@device-stream/web-sdk",
  "version": "0.1.0",
  "description": "Browser SDK for device-stream — single owner of the wire format",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit",
    "test": "vitest run --config ../vitest.config.ts"
  },
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.3.0"
  },
  "engines": { "node": ">=18.0.0" }
}
```

- [ ] **Step 3: Create tsconfig**

Create `device-stream/web-sdk/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Install + verify**

Run:
```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
npm install
ls -la node_modules/@device-stream/web-sdk
```
Expected: symlink exists.

- [ ] **Step 5: Commit**

```bash
git add package.json web-sdk/
git commit -m "feat(web-sdk): bootstrap @device-stream/web-sdk workspace"
```

---

### Task A6: web-sdk — `Transport`, `FrameDecoder`, `StreamSession`
✅ **DONE — commit `09bf6d7`**. 6 files (the 5 planned + `device-stream/vitest.config.ts` updated to add `web-sdk/tests/**/*.spec.ts` to the include glob). 5 Transport tests pass. **Notes**: dropped `optimizeFor:'latency'` from VideoDecoderConfig (not in TS DOM lib types as of TS 5.3); renamed an inner `LogFn` type to `FrameDecoderLogFn` to avoid name collision with `transport.ts`'s `LogFn`. `StreamSession` constructor takes generic `url: string` parameter instead of baguette's hardcoded `buildWSUrl(udid, format, version)`. All ported files carry Apache-2.0 attribution comments pointing to the baguette source path.

**Files:**
- Create: `device-stream/web-sdk/src/transport.ts`
- Create: `device-stream/web-sdk/src/frame-decoder.ts`
- Create: `device-stream/web-sdk/src/stream-session.ts`
- Create: `device-stream/web-sdk/src/index.ts`
- Create: `device-stream/web-sdk/tests/transport.spec.ts`

- [ ] **Step 1: Write the failing test for Transport**

Create `device-stream/web-sdk/tests/transport.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Transport } from '../src/transport.js';

describe('Transport', () => {
  it('tap() emits a tap envelope including screen size', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.setScreenSize(438, 954);
    t.tap({ x: 219, y: 478 });
    expect(send).toHaveBeenCalledWith({
      type: 'tap', x: 219, y: 478, duration: 0.05, width: 438, height: 954,
    });
  });

  it('button() emits a button envelope', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.button({ type: 'button', button: 'home' });
    expect(send).toHaveBeenCalledWith({ type: 'button', button: 'home' });
  });

  it('touchDown() with one finger emits touch1-down', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.setScreenSize(438, 954);
    t.touchDown([{ x: 100, y: 200 }]);
    expect(send).toHaveBeenCalledWith({
      type: 'touch1-down', x: 100, y: 200, width: 438, height: 954,
    });
  });

  it('forceIdr() emits a force_idr control envelope', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.forceIdr();
    expect(send).toHaveBeenCalledWith({ type: 'force_idr' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd device-stream && npx vitest run web-sdk/tests/transport.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Transport**

Create `device-stream/web-sdk/src/transport.ts`. Use the baguette source at `/tmp/baguette/Sources/Baguette/Resources/Web/baguette/transport.js` as the reference (Apache 2.0; preserve attribution comment), but translate to TypeScript:

```ts
/**
 * Transport — the ONE module that knows the wire format. Ported from
 * baguette (Apache 2.0): see /tmp/baguette/Sources/Baguette/Resources/Web/baguette/transport.js
 */
import type {
  GestureMessage, ControlMessage, ButtonMessage,
} from '@device-stream/core';

export type SendFn = (payload: GestureMessage | ControlMessage) => void;
export type LogFn  = (msg: string, isError?: boolean) => void;
export type Finger = { x: number; y: number };

export class Transport {
  private send: SendFn;
  private log: LogFn;
  private width = 0;
  private height = 0;

  constructor({ send, log }: { send: SendFn; log?: LogFn }) {
    this.send = send;
    this.log = log ?? (() => {});
  }

  setScreenSize(width: number, height: number): void {
    this.width = width; this.height = height;
  }

  tap({ x, y, duration = 0.05 }: { x: number; y: number; duration?: number }): void {
    this._dispatch({ type: 'tap', x, y, duration, ...this._size() });
  }

  swipe({ from, to, duration = 0.25 }: {
    from: Finger; to: Finger; duration?: number;
  }): void {
    this._dispatch({
      type: 'swipe',
      startX: from.x, startY: from.y,
      endX:   to.x,   endY:   to.y,
      duration, ...this._size(),
    });
  }

  touchDown(fingers: Finger[], opts?: { edge?: 'top' | 'bottom' | 'left' | 'right' }) {
    this._touch('down', fingers, opts);
  }
  touchMove(fingers: Finger[], opts?: { edge?: 'top' | 'bottom' | 'left' | 'right' }) {
    this._touch('move', fingers, opts);
  }
  touchUp(fingers: Finger[], opts?: { edge?: 'top' | 'bottom' | 'left' | 'right' }) {
    this._touch('up', fingers, opts);
  }

  button(envelope: ButtonMessage): void {
    this._dispatch(envelope);
  }

  // Control envelopes:
  setBitrate(bps: number)  { this._dispatch({ type: 'set_bitrate', bps }); }
  setFps(fps: number)      { this._dispatch({ type: 'set_fps', fps }); }
  setScale(scale: number)  { this._dispatch({ type: 'set_scale', scale }); }
  forceIdr()               { this._dispatch({ type: 'force_idr' }); }
  snapshot()               { this._dispatch({ type: 'snapshot' }); }

  private _touch(
    phase: 'down' | 'move' | 'up',
    fingers: Finger[],
    opts?: { edge?: 'top' | 'bottom' | 'left' | 'right' },
  ): void {
    const base = this._size();
    if (fingers.length === 1) {
      const env: any = { type: `touch1-${phase}`, x: fingers[0].x, y: fingers[0].y, ...base };
      if (opts?.edge) env.edge = opts.edge;
      this._dispatch(env);
    } else if (fingers.length === 2) {
      this._dispatch({
        type: `touch2-${phase}`,
        x1: fingers[0].x, y1: fingers[0].y,
        x2: fingers[1].x, y2: fingers[1].y,
        ...base,
      } as any);
    }
  }

  private _size() { return { width: this.width, height: this.height }; }

  private _dispatch(envelope: any): void {
    try { this.send(envelope); }
    catch (e) { this.log(`${envelope.type}: ${(e as Error).message}`, true); }
  }
}
```

- [ ] **Step 4: Port FrameDecoder + StreamSession**

Create `device-stream/web-sdk/src/frame-decoder.ts` translating `/tmp/baguette/Sources/Baguette/Resources/Web/frame-decoder.js` (108 lines) verbatim to TypeScript. Keep class names `MjpegDecoder`, `AvccDecoder` and the public `FrameDecoder.create(format, callbacks)` factory. Preserve Apache-2.0 attribution comment at the top.

Create `device-stream/web-sdk/src/stream-session.ts` translating `/tmp/baguette/Sources/Baguette/Resources/Web/stream-session.js` (127 lines) verbatim. Public surface: `new StreamSession({ url, format, canvas, onSize, onFps, onLog, onText }).start() / .stop()`. Replace baguette's `buildWSUrl(udid, format, version)` with a generic `url: string` parameter — device-stream's relay path is configurable per consumer.

- [ ] **Step 5: Barrel export**

Create `device-stream/web-sdk/src/index.ts`:
```ts
export * from './transport.js';
export * from './frame-decoder.js';
export * from './stream-session.js';
```

- [ ] **Step 6: Run tests + build**

Run:
```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
npx vitest run web-sdk/tests/
npm run build --workspace=@device-stream/web-sdk
```
Expected: tests PASS, `web-sdk/dist/` is produced.

- [ ] **Step 7: Commit**

```bash
git add web-sdk/
git commit -m "feat(web-sdk): port Transport + FrameDecoder + StreamSession from baguette (Apache 2.0)"
```

---

# Phase B — Observability

## File structure for Phase B

```
packages/core/src/
  protocol-v2.ts            # MODIFY — add log + describe_ui side-channel envelopes
packages/android/src/
  log-stream.ts             # CREATE — adb logcat → text frames
packages/ios-simulator/src/
  log-stream.ts             # CREATE — simctl spawn log stream → text frames
  describe-ui.ts            # CREATE — WDA /source wrapper (interim until Phase D)
test-app/server.ts          # MODIFY — expose /logs and /describe-ui WS endpoints
```

The full describe-ui via `AXPTranslator` private framework is deferred to Phase D (it requires the native Swift binary). Phase B ships the WDA-based hierarchy fetch under the v2 wire format so the API stabilizes first; Phase D swaps the implementation without changing the wire format.

---

### Task B1: log-stream message types + parsers
✅ **DONE — commit `e205dcb`**. 2 files (+111 lines on protocol-v2.ts, +43 line spec). 6 new tests. Added `SubscribeLogsMessage`, `StopLogsMessage`, `LogStartedEvent`, `LogLineEvent`, `LogStoppedEvent`, `AXNode` (recursive), `DescribeUiResultEvent`, `MetadataEvent`, `ErrorEvent`, `ServerEvent` union, `parseServerEvent()` helper. `SIDE_CHANNEL_TYPES` set extended to include `'subscribe_logs'`, `'stop_logs'`. `ClientMessageV2` union extended with the two new message types.

**Files:**
- Modify: `device-stream/packages/core/src/protocol-v2.ts`
- Create: `device-stream/packages/core/tests/protocol-v2-logs.spec.ts`

- [ ] **Step 1: Write failing test for the new envelopes**

Create `device-stream/packages/core/tests/protocol-v2-logs.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerEvent } from '../src/protocol-v2.js';

describe('logs envelopes', () => {
  it('parses a client logs subscription request', () => {
    const r = parseClientMessage('{"type":"subscribe_logs","level":"info"}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ type: 'subscribe_logs', level: 'info' });
  });

  it('parses a server log line event', () => {
    const r = parseServerEvent('{"type":"log","line":"hello"}');
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ type: 'log', line: 'hello' });
  });

  it('parses describe_ui_result with a tree', () => {
    const r = parseServerEvent('{"type":"describe_ui_result","ok":true,"tree":{"role":"AXButton","children":[]}}');
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/core/tests/protocol-v2-logs.spec.ts`
Expected: FAIL — `parseServerEvent` does not exist; `subscribe_logs` unknown.

- [ ] **Step 3: Extend protocol-v2.ts**

Edit `device-stream/packages/core/src/protocol-v2.ts` — add types and parsers:
```ts
// Log subscription request (client → server)
export type SubscribeLogsMessage = {
  type: 'subscribe_logs';
  level?: 'info' | 'debug' | 'default';
  predicate?: string;
  bundleId?: string;
};
export type StopLogsMessage = { type: 'stop_logs' };

// Server → client events
export type LogStartedEvent = { type: 'log_started' };
export type LogLineEvent    = { type: 'log'; line: string };
export type LogStoppedEvent = { type: 'log_stopped'; reason: string };

export type AXNode = {
  role: string;
  subrole: string | null;
  label: string | null;
  value: string | null;
  identifier: string | null;
  title: string | null;
  help: string | null;
  frame: { x: number; y: number; width: number; height: number } | null;
  enabled: boolean;
  focused: boolean;
  hidden: boolean;
  children: AXNode[];
};
export type DescribeUiResultEvent =
  | { type: 'describe_ui_result'; ok: true;  tree: AXNode }
  | { type: 'describe_ui_result'; ok: false; error: string };

export type ServerEvent =
  | LogStartedEvent | LogLineEvent | LogStoppedEvent
  | DescribeUiResultEvent
  | { type: 'metadata'; codec: 'h264' | 'mjpeg'; width: number; height: number; fps: number }
  | { type: 'error'; error: string };

export function parseServerEvent(raw: string): { ok: true; value: ServerEvent } | { ok: false; error: string } {
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, error: `malformed JSON: ${(e as Error).message}` }; }
  if (!parsed || typeof parsed.type !== 'string') return { ok: false, error: 'missing type' };
  return { ok: true, value: parsed as ServerEvent };
}
```

Add `'subscribe_logs'` and `'stop_logs'` and `'describe_ui'` to the `SIDE_CHANNEL_TYPES` set already defined in protocol-v2.ts.

Extend `ClientMessageV2`:
```ts
export type ClientMessageV2 =
  | ControlMessage
  | GestureMessage
  | DescribeUiMessage
  | SubscribeLogsMessage
  | StopLogsMessage;
```

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run packages/core/tests/protocol-v2-logs.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/protocol-v2.ts packages/core/tests/protocol-v2-logs.spec.ts
git commit -m "feat(core): v2 envelopes for log stream + describe_ui results"
```

---

### Task B2: Android — adb logcat → log_line emitter
✅ **DONE — commit `9672d93`**. 2 files. 5 tests pass. `AndroidLogStream extends EventEmitter`, emits `'line'` per newline + `'stopped'` on exit. Spawn argv: `adb -s <serial> logcat -v threadtime [*:<priority>]`. `bundleId` filter is substring-match (Android doesn't have NSPredicate). `predicate` accepted for API parity with iOS but ignored.

**Files:**
- Create: `device-stream/packages/android/src/log-stream.ts`
- Create: `device-stream/packages/android/tests/log-stream.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/android/tests/log-stream.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { AndroidLogStream } from '../src/log-stream.js';

describe('AndroidLogStream', () => {
  it('emits one log event per line from adb logcat stdout', async () => {
    const fakeProc = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    const seen: string[] = [];
    stream.on('line', (l) => seen.push(l));
    await stream.start('emulator-5554', { priority: 'I' });
    fakeProc.stdout.write('one\n');
    fakeProc.stdout.write('two\n');
    fakeProc.stdout.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['one', 'two']);
  });

  it('passes filterspec to adb when bundleId is set', async () => {
    const fakeProc = { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const stream = new AndroidLogStream({ adbSpawn: spawn as any });
    await stream.start('emulator-5554', { bundleId: 'com.argonav' });
    expect(spawn).toHaveBeenCalledWith(expect.arrayContaining(['logcat', '-v', 'threadtime']));
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/android/tests/log-stream.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `device-stream/packages/android/src/log-stream.ts`:
```ts
import { EventEmitter } from 'events';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

export interface LogStartOptions {
  priority?: 'V' | 'D' | 'I' | 'W' | 'E';
  bundleId?: string;
  predicate?: string;     // unused on Android (no NSPredicate); accepted for API parity
}

type AdbSpawn = (args: string[]) => ChildProcess;

export class AndroidLogStream extends EventEmitter {
  private proc: ChildProcess | null = null;
  private adbSpawn: AdbSpawn;

  constructor(opts: { adbSpawn?: AdbSpawn } = {}) {
    super();
    this.adbSpawn = opts.adbSpawn ?? ((args) => nodeSpawn('adb', args));
  }

  async start(serial: string, opts: LogStartOptions = {}): Promise<void> {
    if (this.proc) await this.stop();
    const args = ['-s', serial, 'logcat', '-v', 'threadtime'];
    if (opts.priority) args.push(`*:${opts.priority}`);
    this.proc = this.adbSpawn(args);
    this.proc.stdout?.setEncoding('utf-8');

    let buf = '';
    this.proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (opts.bundleId && !line.includes(opts.bundleId)) continue;
        this.emit('line', line);
      }
    });
    this.proc.on('exit', (code) => this.emit('stopped', `adb exited ${code}`));
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill('SIGTERM');
    this.proc = null;
  }
}
```

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run packages/android/tests/log-stream.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/android/src/log-stream.ts packages/android/tests/log-stream.spec.ts
git commit -m "feat(android): adb logcat stream with bundleId filter + threadtime format"
```

---

### Task B3: iOS-sim — simctl spawn log stream → log_line emitter
✅ **DONE — commit `993c8ed`**. 2 files. 6 tests pass. `IOSSimulatorLogStream extends EventEmitter`. Spawn argv: `xcrun simctl spawn <udid> log stream --style ndjson [--level <priority>] [--predicate <p>] [--process <bundleId>]`. Same `'line'` + `'stopped'` events as Android.

**Files:**
- Create: `device-stream/packages/ios-simulator/src/log-stream.ts`
- Create: `device-stream/packages/ios-simulator/tests/log-stream.spec.ts`

Follow exactly the structure of Task B2 but spawn `xcrun simctl spawn <udid> log stream --style ndjson [--level <lv>] [--predicate <p>] [--process <bundleId>]`. The wire `level` maps to simctl's `--level`; `bundleId` maps to `--process`. Reference: `/tmp/baguette/docs/features/logs.md`.

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/ios-simulator/tests/log-stream.spec.ts` — same pattern as B2 but assert the spawned argv contains `simctl`, `spawn`, `<udid>`, `log`, `stream`, `--style`, `ndjson`.

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/log-stream.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `device-stream/packages/ios-simulator/src/log-stream.ts` mirroring `packages/android/src/log-stream.ts` but with the simctl argv:
```ts
const args = ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'ndjson'];
if (opts.priority) args.push('--level', opts.priority);
if (opts.predicate) args.push('--predicate', opts.predicate);
if (opts.bundleId) args.push('--process', opts.bundleId);
this.proc = this.xcrunSpawn(args);
```

The default executable is `xcrun`. Constructor accepts an `xcrunSpawn` override for tests.

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/log-stream.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ios-simulator/src/log-stream.ts packages/ios-simulator/tests/log-stream.spec.ts
git commit -m "feat(ios-simulator): xcrun simctl log stream (ndjson) with level/predicate/process filters"
```

---

### Task B4: describe-ui interim (WDA-backed) + WS routing in test-app
✅ **DONE — commit `626df78`**. 6 files. 3 new tests (46 total green). Added `fast-xml-parser@^4.4.0` to ios-simulator deps. `parseWdaSource(xml)` walks WDA's XML output into `AXNode` shape from Task B1. `fetchDescribeUi(udid, wdaPort=8100)` POSTs `/session` then GETs `/source`. test-app's WS upgrade handler now path-dispatches: `/stream` (existing untouched), `/logs` (dispatches to Android or iOS log-stream based on `?platform=`), `/describe-ui` (iOS-only via WDA). Both new handlers use dynamic `import()` so test-app stays runnable without pre-built workspace packages. Re-exports added to `packages/{ios-simulator,android}/src/index.ts`. Pre-existing CWE-134 format-string findings in `streamLoop` were also fixed (same precedent as A3).

**Files:**
- Create: `device-stream/packages/ios-simulator/src/describe-ui.ts`
- Modify: `device-stream/test-app/server.ts` (add `/logs` and `/describe-ui` WS routes)

- [ ] **Step 1: Write the failing test for describe-ui parse**

Create `device-stream/packages/ios-simulator/tests/describe-ui.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseWdaSource } from '../src/describe-ui.js';

const SOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="Test" label="Test" x="0" y="0" width="438" height="954">
  <XCUIElementTypeButton name="Login" label="Log in" enabled="true" x="100" y="200" width="200" height="44"/>
</XCUIElementTypeApplication>`;

describe('parseWdaSource', () => {
  it('produces an AXNode tree from WDA XML', () => {
    const tree = parseWdaSource(SOURCE_XML);
    expect(tree.role).toBe('XCUIElementTypeApplication');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].label).toBe('Log in');
    expect(tree.children[0].frame).toEqual({ x: 100, y: 200, width: 200, height: 44 });
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/describe-ui.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement using `fast-xml-parser`**

Install: `cd device-stream && npm install --save fast-xml-parser@^4.4.0 --workspace=@device-stream/ios-simulator`

Create `device-stream/packages/ios-simulator/src/describe-ui.ts`:
```ts
import { XMLParser } from 'fast-xml-parser';
import type { AXNode } from '@device-stream/core';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  isArray: () => false,
});

export function parseWdaSource(xml: string): AXNode {
  const root = parser.parse(xml);
  const top = root[Object.keys(root)[0]];
  return convert(top, Object.keys(root)[0]);
}

function convert(node: any, role: string): AXNode {
  const out: AXNode = {
    role,
    subrole:    null,
    label:      node['@label']      ?? null,
    value:      node['@value']      ?? null,
    identifier: node['@name']       ?? null,
    title:      node['@title']      ?? null,
    help:       node['@hint']       ?? null,
    frame: ('@x' in node && '@y' in node && '@width' in node && '@height' in node)
      ? { x: +node['@x'], y: +node['@y'], width: +node['@width'], height: +node['@height'] }
      : null,
    enabled:    node['@enabled']    === 'true',
    focused:    node['@focused']    === 'true',
    hidden:     node['@visible']    === 'false',
    children:   [],
  };
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@')) continue;
    if (Array.isArray(v)) {
      for (const item of v) out.children.push(convert(item, k));
    } else if (typeof v === 'object' && v) {
      out.children.push(convert(v, k));
    }
  }
  return out;
}

export async function fetchDescribeUi(udid: string, wdaPort = 8100): Promise<AXNode> {
  const session = await fetch(`http://localhost:${wdaPort}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { firstMatch: [{ 'platformName': 'iOS' }] } }),
  }).then((r) => r.json() as Promise<{ value: { sessionId: string } }>);
  const xml = await fetch(`http://localhost:${wdaPort}/session/${session.value.sessionId}/source`)
    .then((r) => r.text());
  return parseWdaSource(xml);
}
```

- [ ] **Step 4: Wire `/describe-ui` and `/logs` into test-app**

Edit `device-stream/test-app/server.ts` — add two new WS routes that the existing connection handler dispatches to:

```ts
// /describe-ui?udid=<udid>
//   client → { type: "describe_ui", x?, y? }
//   server → { type: "describe_ui_result", ok, tree?, error? }
//
// /logs?udid=<udid>&platform=android|ios
//   client → { type: "subscribe_logs", level?, bundleId?, predicate? }
//             { type: "stop_logs" }
//   server → { type: "log_started" }
//             { type: "log", line: "..." }
//             { type: "log_stopped", reason: "..." }
```

For both: parse the incoming JSON with `parseClientMessage`; on `subscribe_logs` instantiate `AndroidLogStream` or `IOSSimulatorLogStream` based on the `platform` query param and pipe `line` events to `ws.send(JSON.stringify({ type: 'log', line }))`. On `describe_ui`, call `fetchDescribeUi(udid)` and send the result back.

- [ ] **Step 5: Run all Phase B tests**

Run: `cd device-stream && npx vitest run packages/android/tests/log-stream.spec.ts packages/ios-simulator/tests/log-stream.spec.ts packages/ios-simulator/tests/describe-ui.spec.ts packages/core/tests/protocol-v2-logs.spec.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ios-simulator/src/describe-ui.ts packages/ios-simulator/tests/describe-ui.spec.ts packages/ios-simulator/package.json package-lock.json test-app/server.ts
git commit -m "feat(ios-simulator,test-app): WDA-backed describe-ui + /logs + /describe-ui WS routes"
```

---

# Phase C — Visual polish

## File structure for Phase C

```
packages/ios-simulator/src/
  chrome.ts                    # CREATE — DeviceKit bezel loader (macOS only)
test-app/
  bezel-routes.ts              # CREATE — Express/HTTP handler for /bezel.png + /chrome.json
  server.ts                    # MODIFY — mount bezel routes
web-sdk/src/
  recorder.ts                  # CREATE — BrowserRecorder (MP4 via MediaRecorder)
  parts/bezel.ts               # CREATE — overlay component
```

DeviceKit bezels are macOS-only. The implementation gates by `process.platform === 'darwin'` and returns 404 elsewhere.

---

### Task C1: DeviceKit chrome loader
✅ **DONE — commit `1ae14c1`**. 3 files. 3 tests pass. `chromeIdForDeviceType()` accepts a `readProfilePlist` dep for testability. `loadChromeJson(chromeId)` reads `/Library/Developer/DeviceKit/Chrome/<id>.devicechrome/Contents/Resources/chrome.json`. `rasterizeComposite(chromeId)` invokes `sips` to convert PhoneComposite.pdf → PNG. **Security adaptations**: implementer added `sanitizeChromeId()` regex guard (`/^([A-Za-z0-9,_-]+)$/` — returns the capture group, not raw input — breaks taint chain to `path.join`) and switched `spawn` → `promisify(execFile)` to satisfy semgrep `child_process` rule. macOS-only (throws on other platforms).

**Files:**
- Create: `device-stream/packages/ios-simulator/src/chrome.ts`
- Create: `device-stream/packages/ios-simulator/tests/chrome.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/ios-simulator/tests/chrome.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chromeIdForDeviceType } from '../src/chrome.js';

describe('chromeIdForDeviceType', () => {
  it('maps iPhone 17 Pro to its chromeIdentifier from profile.plist', () => {
    // Synthetic test using the fixture-only branch — we read from a
    // mocked filesystem in this unit test.
    const id = chromeIdForDeviceType('iPhone 17 Pro', {
      readProfilePlist: () => ({ chromeIdentifier: 'iPhone17,1' }) as any,
    });
    expect(id).toBe('iPhone17,1');
  });

  it('returns null for unknown device types', () => {
    const id = chromeIdForDeviceType('PotatoPhone', {
      readProfilePlist: () => null,
    });
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/chrome.spec.ts`

- [ ] **Step 3: Implement chrome.ts**

Create `device-stream/packages/ios-simulator/src/chrome.ts`:
```ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';

const DEVICE_KIT_ROOT = '/Library/Developer/DeviceKit/Chrome';

export interface ChromeJson {
  images: {
    sizing: { width: number; height: number };
    devicePadding: { top: number; left: number; bottom: number; right: number };
  };
  screenInsets: { top: number; left: number; bottom: number; right: number };
  outerCornerRadius: number;
  paths?: { simpleOutsideBorder?: string };
  inputs?: Array<{ name: string; offsets?: Record<string, number> }>;
}

export function chromeIdForDeviceType(
  deviceTypeName: string,
  deps: { readProfilePlist: (deviceTypeName: string) => { chromeIdentifier?: string } | null },
): string | null {
  const plist = deps.readProfilePlist(deviceTypeName);
  return plist?.chromeIdentifier ?? null;
}

export async function loadChromeJson(chromeId: string): Promise<ChromeJson> {
  const p = path.join(DEVICE_KIT_ROOT, `${chromeId}.devicechrome`, 'Contents/Resources/chrome.json');
  const raw = await fs.readFile(p, 'utf-8');
  return JSON.parse(raw) as ChromeJson;
}

export async function rasterizeComposite(chromeId: string): Promise<Buffer> {
  // sips can render a PDF page to PNG without any external dep.
  const pdf = path.join(DEVICE_KIT_ROOT, `${chromeId}.devicechrome`, 'Contents/Resources/PhoneComposite.pdf');
  const tmp = `/tmp/chrome-${chromeId}-${Date.now()}.png`;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('sips', ['-s', 'format', 'png', pdf, '--out', tmp]);
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`sips exit ${code}`)));
  });
  const png = await fs.readFile(tmp);
  await fs.unlink(tmp).catch(() => {});
  return png;
}
```

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/chrome.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ios-simulator/src/chrome.ts packages/ios-simulator/tests/chrome.spec.ts
git commit -m "feat(ios-simulator): DeviceKit chrome.json loader + PDF→PNG rasterizer (sips)"
```

---

### Task C2: HTTP routes for `/chrome.json` and `/bezel.png`
✅ **DONE — commit `7fa9f8d`**. 2 files. **Route path adapted**: instead of `/simulators/:udid/chrome.json` (the plan's original), implemented `/bezel/:chromeId/chrome.json` and `/bezel/:chromeId/bezel.png` (regex `^/bezel/([\w,_-]+)/(chrome\.json|bezel\.png)$`). 501 returned on non-Darwin platforms. Uses dynamic imports of `@device-stream/ios-simulator` so test-app stays runnable without pre-built workspace. **Untested at runtime** because the user's machine has `/Library/Developer/DeviceKit/Chrome/` empty — wire path is verified, content responses will be 404 until DeviceKit is populated.

**Files:**
- Create: `device-stream/test-app/bezel-routes.ts`
- Modify: `device-stream/test-app/server.ts` (mount the routes)

- [ ] **Step 1: Implement routes**

Create `device-stream/test-app/bezel-routes.ts`:
```ts
import type { IncomingMessage, ServerResponse } from 'http';
import { loadChromeJson, rasterizeComposite } from '@device-stream/ios-simulator';

export async function handleChromeJson(req: IncomingMessage, res: ServerResponse, chromeId: string) {
  try {
    const json = await loadChromeJson(chromeId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  } catch (e) {
    res.writeHead(404).end(`chrome not found: ${(e as Error).message}`);
  }
}

export async function handleBezelPng(req: IncomingMessage, res: ServerResponse, chromeId: string) {
  try {
    const png = await rasterizeComposite(chromeId);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    res.end(png);
  } catch (e) {
    res.writeHead(404).end(`bezel not found: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 2: Mount in `server.ts`**

Edit `device-stream/test-app/server.ts`. Locate the existing `req.url` dispatch block and add cases for `/simulators/:udid/chrome.json` and `/simulators/:udid/bezel.png` that look up the device's `deviceType` via `simulatorManager.getDevice(udid)`, derive `chromeId`, and call the handlers above. On non-Darwin, return 501 with body `bezels are macOS-only`.

- [ ] **Step 3: Manual smoke test (no automated test — needs DeviceKit on disk)**

Run:
```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
npm run build
npx tsx test-app/server.ts &
curl -s http://localhost:3456/simulators/<UDID>/chrome.json | jq '.images.sizing'
curl -s http://localhost:3456/simulators/<UDID>/bezel.png -o /tmp/bezel.png
file /tmp/bezel.png   # expect: PNG image data
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add test-app/
git commit -m "feat(test-app): mount DeviceKit /chrome.json and /bezel.png routes (macOS only)"
```

---

### Task C3: Browser recorder (MP4 compose canvas)
✅ **DONE — commit `d6f447c`**. 6 files. 2 tests pass (jsdom env). Installed `jsdom@^24` + `@types/jsdom` at the device-farm root. Added `environmentMatchGlobs: [['web-sdk/tests/**', 'jsdom']]` to `device-stream/vitest.config.ts`. Full TS port of `/tmp/baguette/Sources/Baguette/Resources/Web/recorder.js` preserving MIME fallback chain (`video/mp4;codecs=avc1` → `video/webm;codecs=vp9` → `video/webm`), compose-canvas + rAF semantics, `roundRectPath` clip. **One deliberate deviation from baguette**: `composeSize()` uses `viewport` whenever provided (not only when `bezelImg` also provided) — needed for the bezel-less test case in our spec.

**Files:**
- Create: `device-stream/web-sdk/src/recorder.ts`
- Create: `device-stream/web-sdk/tests/recorder.spec.ts`

Port `/tmp/baguette/Sources/Baguette/Resources/Web/recorder.js` (270 lines) verbatim to TypeScript. Preserve Apache-2.0 attribution.

- [ ] **Step 1: Write the failing test (JSDOM)**

Install `jsdom` for vitest: `cd device-stream && npm install --save-dev jsdom@^24 @types/jsdom --workspace-root`

Update `device-stream/vitest.config.ts` — add an `environmentMatchGlobs`:
```ts
environmentMatchGlobs: [
  ['web-sdk/tests/**', 'jsdom'],
],
```

Create `device-stream/web-sdk/tests/recorder.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { BrowserRecorder } from '../src/recorder.js';

describe('BrowserRecorder', () => {
  it('start() allocates a compose canvas at viewport size', () => {
    // jsdom doesn't implement MediaRecorder; stub it.
    (globalThis as any).MediaRecorder = class { start() {} stop() {} ondataavailable: any; };
    HTMLCanvasElement.prototype.captureStream = function () { return {} as any; };

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 438; sourceCanvas.height = 954;

    const r = new BrowserRecorder({
      sourceCanvas,
      viewport: { width: 480, height: 1000 },
      screen: { rect: { x: 21, y: 23, width: 438, height: 954 }, clipRadius: 60 },
    });
    r.start();
    expect((r as any).compose.width).toBe(480);
    expect((r as any).compose.height).toBe(1000);
    r.stop();
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run web-sdk/tests/recorder.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Port recorder.js → recorder.ts**

Translate `/tmp/baguette/Sources/Baguette/Resources/Web/recorder.js` line-by-line to TypeScript. Public surface:
```ts
export interface RecorderOptions {
  sourceCanvas: HTMLCanvasElement;
  viewport: { width: number; height: number };
  screen: { rect: { x: number; y: number; width: number; height: number }; clipRadius: number };
  bezelImg?: HTMLImageElement;
  overlayHost?: HTMLElement;
  mimeType?: string;     // 'video/mp4;codecs=avc1' if supported, else 'video/webm'
}
export interface RecordingResult {
  url: string; blob: Blob; filename: string; mimeType: string;
  durationSeconds: number; bytes: number;
}
export class BrowserRecorder {
  constructor(opts: RecorderOptions);
  start(): void;
  stop(): Promise<RecordingResult>;
}
```

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run web-sdk/tests/recorder.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-sdk/src/recorder.ts web-sdk/tests/recorder.spec.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(web-sdk): port BrowserRecorder from baguette — compose canvas + MediaRecorder"
```

---

### Task C4: web-sdk `Bezel` part (DOM-level integration)
✅ **DONE — commit `d909060`**. 3 files. 2 tests pass (jsdom). **Adaptation from baguette**: baguette's `Bezel` takes a pre-resolved `screenDef` from the Simulator aggregate; ours fetches `chrome.json` directly at `load()` time. Public surface: `new Bezel({chromeJsonUrl, bezelPngUrl, container, geometryOnly?}).load(): Promise<BezelGeometry>`. Geometry derivation: `viewport = images.sizing`, `screenRect = viewport - screenInsets`, `clipRadius = outerCornerRadius`. DOM mount mirrors baguette's percentage-positioned screen overlay with the `${hPct}% / ${vPct}%` borderRadius trick.

**Files:**
- Create: `device-stream/web-sdk/src/parts/bezel.ts`
- Modify: `device-stream/web-sdk/src/index.ts`

- [ ] **Step 1: Port `parts/bezel.js`**

Read `/tmp/baguette/Sources/Baguette/Resources/Web/baguette/parts/bezel.js` and translate. Public surface:
```ts
export class Bezel {
  constructor(opts: { chromeJsonUrl: string; bezelPngUrl: string; container: HTMLElement });
  async load(): Promise<{ viewport: { width: number; height: number }; screenRect: { x: number; y: number; width: number; height: number }; clipRadius: number }>;
}
```

The class loads `chrome.json`, computes the viewport size from `images.sizing` plus `images.devicePadding`, derives the screen rect from `screenInsets`, inserts `<img>` for the bezel and a positioned `<div>` for the screen area into the container, and returns geometry the consumer feeds into `StreamSession.onSize` and `BrowserRecorder`.

- [ ] **Step 2: Run lint**

Run: `cd device-stream && npm run lint --workspace=@device-stream/web-sdk`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add web-sdk/src/parts/bezel.ts web-sdk/src/index.ts
git commit -m "feat(web-sdk): Bezel part — chrome.json → DOM with positioned screen rect"
```

---

# Phase D — Native iOS streaming + input

This phase is **iOS-sim only** and the biggest. It ships two native Swift binaries vendored from baguette and reshapes how device-stream talks to the iOS simulator. Once it lands, the device-stream's `capture-service` no longer depends on appium-ios-simulator's WDA for input — WDA stays as the AX backend until the AXPTranslator port (deferred to a follow-up phase if desired).

## File structure for Phase D

```
device-stream/
├── tools/
│   ├── sim-capture-avcc/                   # CREATE — Swift binary, replaces sim-capture
│   │   ├── Sources/sim-capture-avcc/main.swift
│   │   └── Package.swift
│   └── sim-input/                          # CREATE — Swift binary
│       ├── Sources/sim-input/main.swift           (CLI entry)
│       ├── Sources/sim-input/IOHIDDigitizerDispatch.swift
│       ├── Sources/sim-input/IndigoHIDInput.swift
│       └── Package.swift
├── scripts/
│   └── build-sim-input.sh                  # CREATE — invokes swift build for both binaries
└── packages/ios-simulator/src/
    ├── capture-service.ts                  # MODIFY — spawn sim-capture-avcc; route stdin reconfig
    └── input-service.ts                    # CREATE — spawn sim-input; JSON line transport
```

The Swift sources port verbatim from `/tmp/baguette/Sources/Baguette/Infrastructure/Stream/` (encoder) and `/tmp/baguette/Sources/Baguette/Infrastructure/Input/` (IndigoHIDInput + IOHIDDigitizerDispatch). Baguette is Apache-2.0; preserve the license header on each file.

---

### Task D1: Bootstrap `tools/sim-capture-avcc` Swift package

**Files:**
- Create: `device-stream/tools/sim-capture-avcc/Package.swift`
- Create: `device-stream/tools/sim-capture-avcc/Sources/sim-capture-avcc/main.swift`
- Create: `device-stream/scripts/build-sim-input.sh`

- [ ] **Step 1: Verify Xcode 26 toolchain**

Run: `xcrun --sdk macosx --show-sdk-version`
Expected: `26.x`. If older, halt — entire Phase D requires Xcode 26.

- [ ] **Step 2: Write Package.swift**

Create `device-stream/tools/sim-capture-avcc/Package.swift`:
```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "sim-capture-avcc",
  platforms: [.macOS("15.0")],
  targets: [
    .executableTarget(
      name: "sim-capture-avcc",
      linkerSettings: [
        .linkedFramework("VideoToolbox"),
        .linkedFramework("CoreVideo"),
        .linkedFramework("CoreMedia"),
        .linkedFramework("ScreenCaptureKit"),
      ]
    ),
  ]
)
```

- [ ] **Step 3: Port encoder + main entry**

Read `/tmp/baguette/Sources/Baguette/Infrastructure/Stream/` directory listing:
```bash
ls /tmp/baguette/Sources/Baguette/Infrastructure/Stream/
```
Identify the files (`VTH264Encoder.swift`, `AvccFraming.swift`, `Scaler.swift`, `SeedFilter.swift`, the stdout sink). Port each into `Sources/sim-capture-avcc/` as separate files. Create `main.swift` as the CLI entry that:
1. Parses argv: `--udid <UDID>`, `--fps <n>`, `--bitrate <bps>`, `--scale <f>`, `--format avcc|mjpeg`.
2. Starts ScreenCaptureKit on the SimDevice's window.
3. Pipes frames through `Scaler` → `VTH264Encoder` → `AvccFraming.write(stdout)`.
4. Reads stdin line-by-line for runtime reconfig JSON (`{"type":"set_bitrate","bps":...}` etc).

- [ ] **Step 4: Build**

Run:
```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream/tools/sim-capture-avcc
swift build -c release
ls -la .build/release/sim-capture-avcc
```
Expected: binary present, ~2-5 MB.

- [ ] **Step 5: Smoke-test against a booted simulator**

```bash
xcrun simctl boot <UDID-of-a-booted-sim>
.build/release/sim-capture-avcc --udid <UDID> --fps 30 --bitrate 4000000 --format avcc \
  | head -c 1024 | xxd | head
```
Expected: hex dump shows `01` tag in the first byte (avcC description) and other tags later. SIGINT to stop.

- [ ] **Step 6: Add build script**

Create `device-stream/scripts/build-sim-input.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
( cd tools/sim-capture-avcc && swift build -c release )
( cd tools/sim-input        && swift build -c release )
echo "[device-stream] built tools/*"
```
`chmod +x device-stream/scripts/build-sim-input.sh`

Append to root `package.json` scripts: `"build:sim-input": "./scripts/build-sim-input.sh"`.

- [ ] **Step 7: Commit**

```bash
git add tools/sim-capture-avcc/ scripts/build-sim-input.sh package.json
git commit -m "feat(tools): port sim-capture-avcc — VideoToolbox H.264 + AVCC framing + stdin reconfig"
```

---

### Task D2: Wire sim-capture-avcc into `CaptureService`

**Files:**
- Modify: `device-stream/packages/ios-simulator/src/capture-service.ts`

- [ ] **Step 1: Replace MJPEG-only spawn with format-aware spawn**

Locate the `spawn('sim-capture', [...])` call. Replace with:
```ts
const binary = opts.format === 'avcc'
  ? path.join(__dirname, '../../../tools/sim-capture-avcc/.build/release/sim-capture-avcc')
  : path.join(__dirname, '../../../tools/sim-capture/sim-capture');
const args = [
  '--udid', udid,
  '--fps', String(opts.fps ?? 30),
  '--bitrate', String(opts.bps ?? 4_000_000),
  '--scale', String(opts.scale ?? 1),
  '--format', opts.format ?? 'avcc',
];
this.procs.set(udid, spawn(binary, args, { stdio: ['pipe', 'pipe', 'inherit'] }));
```

- [ ] **Step 2: Wire stdin reconfig from Phase A control channel**

In `setBitrate`/`setFps`/`setScale`/`forceIdr` (the Phase A stubs), replace the "queued until Phase D" log lines with:
```ts
const proc = this.procs.get(udid);
if (!proc?.stdin) return;
proc.stdin.write(JSON.stringify({ type: 'set_bitrate', bps }) + '\n');
```
(and equivalents for the other knobs)

- [ ] **Step 3: Update frame parsing in `stream-service.ts`**

The downstream sink currently emits MJPEG frames as `{type:'frame', data:<base64>}`. For AVCC, prepend the 1-byte tag from `serializeAvccFrame` and send as binary on the WS:
```ts
import { serializeAvccFrame } from '@device-stream/core';
// in the encoder output handler:
ws.send(serializeAvccFrame(kind, payload), { binary: true });
```
Tag inference: the first chunk after `set` is `avcc` (description), then `keyframe` on IDR boundaries, `delta` otherwise.

- [ ] **Step 4: Integration test (smoke)**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream
npm run build
npx tsx test-app/server.ts &
# In a browser: open http://localhost:3456, pick a booted iOS sim, click "AVCC"
# Verify the live frame appears with a "JPEG seed" flash followed by H.264 stream.
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add packages/ios-simulator/src/capture-service.ts packages/ios-simulator/src/stream-service.ts
git commit -m "feat(ios-simulator): wire sim-capture-avcc — AVCC streaming + stdin reconfig"
```

---

### Task D3: Bootstrap `tools/sim-input` — IndigoHIDInput core

**Files:**
- Create: `device-stream/tools/sim-input/Package.swift`
- Create: `device-stream/tools/sim-input/Sources/sim-input/IOHIDDigitizerDispatch.swift`
- Create: `device-stream/tools/sim-input/Sources/sim-input/IndigoHIDInput.swift`
- Create: `device-stream/tools/sim-input/Sources/sim-input/main.swift`

This is the most delicate task in the plan because **the exact byte-level details matter** for iOS-26 HID dispatch. Do not attempt to "improve" or "simplify" the recipe — copy verbatim.

- [ ] **Step 1: Read baguette's IOHIDDigitizerDispatch.swift end-to-end**

```bash
wc -l /tmp/baguette/Sources/Baguette/Infrastructure/Input/IOHIDDigitizerDispatch.swift
cat /tmp/baguette/Sources/Baguette/Infrastructure/Input/IOHIDDigitizerDispatch.swift
```
Read every line. The file is heavily commented — those comments are part of the contract. Understand:
- The 5-step recipe (digitizer-finger → digitizer-parent → trackpad wrapper → 4-byte patch → SimulatorKit dispatch).
- The `eventMask` values 0x07 (down/move) and 0x06 (up).
- The `IndigoHIDEdge` bitmask for `bottom`/`top` edge gestures.

- [ ] **Step 2: Create Package.swift**

Create `device-stream/tools/sim-input/Package.swift`:
```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "sim-input",
  platforms: [.macOS("15.0")],
  targets: [
    .executableTarget(
      name: "sim-input",
      linkerSettings: [
        .unsafeFlags([
          "-F", "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks",
          "-F", "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/PrivateFrameworks",
          "-framework", "SimulatorKit",
          "-framework", "CoreSimulator",
          "-framework", "IOKit",
        ]),
      ]
    ),
  ]
)
```

- [ ] **Step 3: Copy the two files**

Copy `IOHIDDigitizerDispatch.swift` and `IndigoHIDInput.swift` from baguette into `device-stream/tools/sim-input/Sources/sim-input/` **verbatim**. Preserve all comments. Add at the top of each file:
```swift
// Ported from tddworks/baguette (Apache 2.0).
// Original: Sources/Baguette/Infrastructure/Input/<file>.swift
```

- [ ] **Step 4: Create main.swift — JSON-line CLI**

Create `device-stream/tools/sim-input/Sources/sim-input/main.swift`:
```swift
import Foundation

// CLI argv parse — only --udid is required.
guard let udidIdx = CommandLine.arguments.firstIndex(of: "--udid"),
      udidIdx + 1 < CommandLine.arguments.count else {
  FileHandle.standardError.write("usage: sim-input --udid <UDID>\n".data(using: .utf8)!)
  exit(2)
}
let udid = CommandLine.arguments[udidIdx + 1]
let input = IndigoHIDInput(udid: udid)

// Read stdin line-by-line; one JSON envelope per line.
while let line = readLine() {
  guard let data = line.data(using: .utf8) else { continue }
  do {
    let env = try JSONDecoder().decode(GestureEnvelope.self, from: data)
    try input.dispatch(env)
    print("{\"ok\":true}")
  } catch {
    let escaped = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
    print("{\"ok\":false,\"error\":\"\(escaped)\"}")
  }
  fflush(stdout)
}
```

Plus a `GestureEnvelope` struct mirroring the wire types from `@device-stream/core` (`tap`, `swipe`, `touch1-*`, `touch2-*`, `button`, `key`, `type`).

- [ ] **Step 5: Build**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream/tools/sim-input
swift build -c release
```
Expected: binary at `.build/release/sim-input`.

- [ ] **Step 6: Smoke-test a tap**

```bash
xcrun simctl boot <UDID>
echo '{"type":"tap","x":219,"y":478,"width":438,"height":954,"duration":0.05}' \
  | .build/release/sim-input --udid <UDID>
```
Expected: line `{"ok":true}` printed; visible tap registered in the simulator window.

- [ ] **Step 7: Commit**

```bash
git add tools/sim-input/
git commit -m "feat(tools): port sim-input — direct iOS-26 HID dispatch (IOHIDDigitizerDispatch + IndigoHIDInput)"
```

---

### Task D4: TypeScript wrapper `InputService` over sim-input

**Files:**
- Create: `device-stream/packages/ios-simulator/src/input-service.ts`
- Create: `device-stream/packages/ios-simulator/tests/input-service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/ios-simulator/tests/input-service.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { InputService } from '../src/input-service.js';

describe('InputService', () => {
  it('writes a tap envelope to sim-input stdin', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const fakeProc: any = { stdin, stdout, stderr: new PassThrough(), kill: vi.fn() };
    const spawn = vi.fn().mockReturnValue(fakeProc);
    const svc = new InputService({ spawn: spawn as any });
    const written: string[] = [];
    stdin.on('data', (c) => written.push(c.toString()));

    const p = svc.tap('UDID-1', { x: 100, y: 200, width: 438, height: 954 });
    // sim-input would normally print {"ok":true}; simulate it.
    setTimeout(() => stdout.write('{"ok":true}\n'), 5);
    await p;
    expect(written.join('').trim()).toBe(
      JSON.stringify({ type: 'tap', x: 100, y: 200, width: 438, height: 954 })
    );
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/input-service.spec.ts`

- [ ] **Step 3: Implement**

Create `device-stream/packages/ios-simulator/src/input-service.ts`:
```ts
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { GestureMessage } from '@device-stream/core';

type Spawn = (cmd: string, args: string[]) => ChildProcess;

export class InputService {
  private procs = new Map<string, ChildProcess>();
  private pending = new Map<string, Array<{ resolve: (v: void) => void; reject: (e: Error) => void }>>();
  private bin: string;
  private spawn: Spawn;

  constructor(opts: { binary?: string; spawn?: Spawn } = {}) {
    this.bin = opts.binary
      ?? path.resolve(__dirname, '../../../tools/sim-input/.build/release/sim-input');
    this.spawn = (opts.spawn ?? ((c, a) => nodeSpawn(c, a))) as Spawn;
  }

  private ensure(udid: string): ChildProcess {
    let p = this.procs.get(udid);
    if (p) return p;
    p = this.spawn(this.bin, ['--udid', udid]);
    p.stdout?.setEncoding('utf-8');
    let buf = '';
    p.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        const queue = this.pending.get(udid);
        const head = queue?.shift();
        if (!head) continue;
        try {
          const parsed = JSON.parse(line);
          parsed.ok ? head.resolve() : head.reject(new Error(parsed.error ?? 'unknown sim-input error'));
        } catch (e) { head.reject(e as Error); }
      }
    });
    p.on('exit', () => {
      (this.pending.get(udid) ?? []).forEach(({ reject }) => reject(new Error('sim-input exited')));
      this.pending.delete(udid);
      this.procs.delete(udid);
    });
    this.procs.set(udid, p);
    this.pending.set(udid, []);
    return p;
  }

  send(udid: string, envelope: GestureMessage): Promise<void> {
    const proc = this.ensure(udid);
    return new Promise<void>((resolve, reject) => {
      this.pending.get(udid)!.push({ resolve, reject });
      proc.stdin!.write(JSON.stringify(envelope) + '\n');
    });
  }

  tap(udid: string, args: { x: number; y: number; width: number; height: number; duration?: number }) {
    return this.send(udid, { type: 'tap', ...args });
  }
  // ... swipe, touch1Down, touch1Move, touch1Up, button, key, type, etc. ...
  // Each is a one-liner that calls `this.send(udid, { type: '<type>', ...args })`.

  async stop(udid: string): Promise<void> {
    const p = this.procs.get(udid);
    if (!p) return;
    p.kill('SIGTERM');
  }
}
```

- [ ] **Step 4: Run + pass**

Run: `cd device-stream && npx vitest run packages/ios-simulator/tests/input-service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ios-simulator/src/input-service.ts packages/ios-simulator/tests/input-service.spec.ts
git commit -m "feat(ios-simulator): InputService — wraps sim-input as a long-lived JSON-line pipe with per-call ack"
```

---

### Task D5: Replace WDA-based input in `IOSSimulatorManager`

**Files:**
- Modify: `device-stream/packages/ios-simulator/src/simulator-manager.ts`

- [ ] **Step 1: Locate existing input methods**

Search for any WDA-based input calls. The current `IOSSimulatorManager` does not have tap/swipe surface — those went through `xcrun simctl io` or external WDA in consumer packages. Confirm:
```bash
grep -n "tap\|swipe\|wda\|8100" device-stream/packages/ios-simulator/src/simulator-manager.ts
```
If no inputs exist, this task expands the manager's surface. If WDA-based shims exist, replace them.

- [ ] **Step 2: Add input delegation**

Append to `IOSSimulatorManager`:
```ts
import { InputService } from './input-service.js';

// inside the class:
private readonly inputs = new InputService();

tap(udid: string, args: { x: number; y: number; width: number; height: number; duration?: number }): Promise<void> {
  return this.inputs.tap(udid, args);
}
swipe(udid: string, args: { startX: number; startY: number; endX: number; endY: number; width: number; height: number; duration?: number }): Promise<void> {
  return this.inputs.send(udid, { type: 'swipe', ...args });
}
button(udid: string, btn: { type: 'button'; button: string; duration?: number }): Promise<void> {
  return this.inputs.send(udid, btn as any);
}
async cleanup(): Promise<void> {
  // augment existing cleanup
  for (const udid of [...this.devices.keys()]) {
    await this.inputs.stop(udid).catch(() => {});
  }
  // ... existing cleanup body ...
}
```

- [ ] **Step 3: Wire gesture routing in StreamService**

Edit `device-stream/packages/ios-simulator/src/stream-service.ts` — extend the message handler from Task A3:
```ts
if (isGestureMessage(parsed.value)) {
  this.inputs.send(this.udid, parsed.value).catch((e) =>
    this.log?.warn?.(`gesture: ${e.message}`));
  return;
}
```
Constructor needs `inputs: InputService` in `StreamServiceOptions`.

- [ ] **Step 4: Smoke test**

```bash
cd device-stream && npm run build && npx tsx test-app/server.ts &
# Browser: tap on the canvas. Tap should land on the simulator screen.
# WDA is no longer required for inputs.
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add packages/ios-simulator/src/simulator-manager.ts packages/ios-simulator/src/stream-service.ts
git commit -m "feat(ios-simulator): route gesture envelopes through sim-input (replaces WDA for input dispatch)"
```

---

### Task D6: Documentation + cleanup

**Files:**
- Modify: `device-stream/README.md`
- Modify: `device-stream/packages/ios-simulator/README.md` (if exists, else create)
- Modify: `device-stream/docs/ios-simulator.md`

- [ ] **Step 1: Update READMEs**

Document the new binaries (`tools/sim-capture-avcc`, `tools/sim-input`), the npm script `build:sim-input`, and the AVCC framing protocol. Reference the source of truth (baguette) with the Apache-2.0 attribution.

- [ ] **Step 2: Add a "Why this works on iOS 26" section**

Copy + adapt the explanation block from `/tmp/baguette/README.md` lines 631–665. Credit baguette explicitly.

- [ ] **Step 3: Commit**

```bash
git add README.md packages/ios-simulator/README.md docs/ios-simulator.md
git commit -m "docs(ios-simulator): document Phase D — sim-capture-avcc + sim-input + iOS-26 HID recipe"
```

---

# Phase E — Virtual camera

This phase vendors `VirtualCamera.dylib` from baguette (which itself vendored it from `tddworks/asc-pro/SimCam`) and adds a shared-memory frame producer on the host. The dylib is loaded into every sim-launched app via `DYLD_INSERT_LIBRARIES`. Reference: `/tmp/baguette/docs/features/camera.md` (full wire reference) and `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/`.

**Note on scope:** baguette's camera surface ships under a Mac webcam picker. For device-stream, we keep the same wire protocol but make the input source pluggable (Mac webcam **or** a host file path **or** an arbitrary BGRA frame producer) so test suites can feed synthetic content.

## File structure for Phase E

```
device-stream/
├── VirtualCamera/                 # CREATE — vendored from baguette (and originally from asc-pro/SimCam)
│   ├── Sources/                   #   (copy verbatim — .h/.m files)
│   ├── build.sh                   #   cross-compile to iphonesimulator SDK
│   ├── VirtualCamera.dylib        #   build output (gitignored except for tagged releases)
│   └── VENDORED_FROM.md
├── packages/ios-simulator/src/
│   ├── camera-session.ts          # CREATE — @MainActor orchestrator
│   ├── camera-message.ts          # CREATE — WS parser
│   ├── camera-frame-sink.ts       # CREATE — mmap'd ring buffer (BGRA)
│   ├── camera-capture.ts          # CREATE — AVFoundation host capture (via native helper)
│   └── virtual-camera-installer.ts # CREATE — copies dylib to per-hash path
└── tools/sim-cam/                 # CREATE — Swift helper binary that owns the AVCaptureSession
    ├── Sources/sim-cam/main.swift
    └── Package.swift
```

---

### Task E1: Vendor `VirtualCamera.dylib` source + build script

**Files:**
- Create: `device-stream/VirtualCamera/` (whole directory)
- Create: `device-stream/VirtualCamera/VENDORED_FROM.md`

- [ ] **Step 1: Copy baguette's vendored sources**

```bash
cp -R /tmp/baguette/VirtualCamera /Users/heicg/Desktop/projects/device-farm/device-stream/VirtualCamera
```
Verify it has `Sources/*.h`, `Sources/*.m`, `build.sh`, `VENDORED_FROM.md`.

- [ ] **Step 2: Build the dylib**

```bash
cd /Users/heicg/Desktop/projects/device-farm/device-stream/VirtualCamera
./build.sh
file VirtualCamera.dylib
```
Expected: `Mach-O 64-bit dynamically linked shared library arm64`.

- [ ] **Step 3: Append to `.gitignore`**

Add to root `.gitignore`:
```
# Phase E — vendored Camera dylib (built artefact; rebuild via VirtualCamera/build.sh)
VirtualCamera/VirtualCamera.dylib
VirtualCamera/build/
```

- [ ] **Step 4: Commit**

```bash
git add VirtualCamera/Sources VirtualCamera/build.sh VirtualCamera/VENDORED_FROM.md .gitignore
git commit -m "feat(virtual-camera): vendor VirtualCamera.dylib sources from baguette (and asc-pro/SimCam) — Apache 2.0"
```

---

### Task E2: Shared-memory frame sink (TypeScript)

**Files:**
- Create: `device-stream/packages/ios-simulator/src/shared-frame-layout.ts`
- Create: `device-stream/packages/ios-simulator/src/camera-frame-sink.ts`
- Create: `device-stream/packages/ios-simulator/tests/camera-frame-sink.spec.ts`

The dylib reads BGRA frames from `/tmp/SimCam.bgra`. The host (device-stream) writes the same memory layout. Read `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/SharedFrameLayout.swift` and `SharedMemoryFrameSink.swift` to extract the exact byte offsets — port them as TypeScript constants.

- [ ] **Step 1: Write the failing test**

Create `device-stream/packages/ios-simulator/tests/camera-frame-sink.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CameraFrameSink } from '../src/camera-frame-sink.js';
import { SHARED_FRAME_LAYOUT } from '../src/shared-frame-layout.js';

describe('CameraFrameSink layout', () => {
  it('writes frame width/height at the documented offsets', async () => {
    const sink = new CameraFrameSink('/tmp/SimCam.test.bgra');
    await sink.open(640, 480);
    const buf = await sink.peekRaw();
    expect(buf.readUInt32LE(SHARED_FRAME_LAYOUT.WIDTH_OFFSET)).toBe(640);
    expect(buf.readUInt32LE(SHARED_FRAME_LAYOUT.HEIGHT_OFFSET)).toBe(480);
    await sink.close();
  });
});
```

- [ ] **Step 2: Run + fail; then implement**

Implement `shared-frame-layout.ts` with `WIDTH_OFFSET`, `HEIGHT_OFFSET`, `FRAME_ID_OFFSET`, `DATA_OFFSET` constants matched against `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/SharedFrameLayout.swift`.

Implement `CameraFrameSink` using `fs.openSync` + `mmap-io` (npm package). If mmap-io can't be installed, fall back to a writable `fs.openSync(O_RDWR | O_CREAT)` + `pwrite` per frame — slower but correct.

- [ ] **Step 3: Pass + commit**

```bash
git add packages/ios-simulator/src/shared-frame-layout.ts packages/ios-simulator/src/camera-frame-sink.ts packages/ios-simulator/tests/camera-frame-sink.spec.ts
git commit -m "feat(ios-simulator): CameraFrameSink — mmap'd BGRA ring buffer matching baguette layout"
```

---

### Task E3: `tools/sim-cam` Swift helper for AVCaptureSession

**Files:**
- Create: `device-stream/tools/sim-cam/Package.swift`
- Create: `device-stream/tools/sim-cam/Sources/sim-cam/main.swift`

Port `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/HostVideoCapture.swift` + `AVCameraCapture.swift`. The binary:
1. CLI argv: `--device-uid <UID>`, `--shm-path /tmp/SimCam.bgra`, `--width 640`, `--height 480`, `--fps 30`.
2. Lists cameras when called with `--list` → JSON to stdout.
3. Otherwise, opens an `AVCaptureSession` on the selected camera, BGRA pixel format, and writes each frame to the shared buffer.

- [ ] **Step 1: Build + smoke test**

```bash
cd device-stream/tools/sim-cam && swift build -c release
.build/release/sim-cam --list | jq '.[0]'
.build/release/sim-cam --device-uid <UID> --shm-path /tmp/SimCam.bgra --width 640 --height 480 --fps 30 &
sleep 2 && file /tmp/SimCam.bgra
```

- [ ] **Step 2: Commit**

```bash
git add tools/sim-cam/
git commit -m "feat(tools): port sim-cam — AVCaptureSession → mmap BGRA ring buffer"
```

---

### Task E4: `CameraSession` orchestrator + WS protocol + installer

**Files:**
- Create: `device-stream/packages/ios-simulator/src/virtual-camera-installer.ts`
- Create: `device-stream/packages/ios-simulator/src/camera-message.ts`
- Create: `device-stream/packages/ios-simulator/src/camera-session.ts`
- Modify: `device-stream/test-app/server.ts` (add `/camera` WS route)

The wire protocol is exactly what baguette ships — see `/tmp/baguette/docs/features/camera.md`:
- Client → server: `{type:"camera_list"}`, `{type:"camera_start","deviceUID":"...","fit":"fit","mirror":false}`, `{type:"camera_stop"}`, `{type:"camera_set_flags","fit":"fill","mirror":true}`.
- Server → client: `{type:"camera_devices","devices":[...]}`, `{type:"camera_state","phase":"idle|streaming","fps":29.97,"device":"..."}`.

- [ ] **Step 1: Port camera-message.ts**

Translate `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/CameraMessage.swift` envelopes to TypeScript discriminated unions in `camera-message.ts`. Export a `parseCameraMessage(raw: string): { ok, value } | { ok: false, error }` helper.

- [ ] **Step 2: Port virtual-camera-installer.ts**

Read `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/VirtualCameraInstaller.swift`. The installer:
1. Computes SHA-256 of `VirtualCamera.dylib`.
2. Copies the dylib to `$TMPDIR/device-stream/virtualcam/<hash>/VirtualCamera.dylib`.
3. Returns that path — `CameraSession` sets `DYLD_INSERT_LIBRARIES=<path>` on every `simctl spawn`.

Implement in TypeScript using `crypto.createHash('sha256')` + `fs.copyFile`.

- [ ] **Step 3: Port camera-session.ts**

Translate `/tmp/baguette/Sources/Baguette/Infrastructure/Camera/CameraSession.swift` (the orchestrator). Spawn `sim-cam` as a child process. Inject the dylib path via `simctl spawn <UDID> <appBundle> --` envelope with `SIMCTL_CHILD_DYLD_INSERT_LIBRARIES=<installer.path>` on the next app launch.

Public surface:
```ts
export class CameraSession {
  constructor(opts: { simctlSpawn?: Spawn; installer?: VirtualCameraInstaller; sink?: CameraFrameSink });
  list(): Promise<CameraDevice[]>;
  start(udid: string, opts: { deviceUID: string; fit: 'fit' | 'fill'; mirror: boolean }): Promise<void>;
  stop(udid: string): Promise<void>;
  setFlags(udid: string, opts: { fit?: 'fit' | 'fill'; mirror?: boolean }): Promise<void>;
}
```

- [ ] **Step 4: Add `/camera` WS route in test-app**

Edit `device-stream/test-app/server.ts` — handle `/simulators/:udid/camera` WS connections. On connect, run `cameraSession.list()` and push `{type:"camera_devices",devices}`. Loop on client messages.

- [ ] **Step 5: Manual smoke test**

```bash
cd device-stream && npx tsx test-app/server.ts &
# In the browser test-app, open camera card, pick FaceTime HD Camera, click Start.
# Launch a camera-using app inside the booted iOS sim (e.g. open the system Camera app
# via simctl launch). The app should render Mac webcam frames.
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add packages/ios-simulator/src/virtual-camera-installer.ts packages/ios-simulator/src/camera-message.ts packages/ios-simulator/src/camera-session.ts test-app/server.ts
git commit -m "feat(ios-simulator): VirtualCamera dylib installer + WS protocol + CameraSession orchestrator"
```

---

## Cross-phase verification (run after each phase merges)

After every phase wraps:

- [ ] **Lint:** `cd device-stream && npm run lint --workspaces`
- [ ] **Test:** `cd device-stream && npm test`
- [ ] **Build:** `cd device-stream && npm run build`
- [ ] **Device-farm integration check:** From the consumer side, verify the workspace symlinks still resolve and nothing in `device-farm/server/streaming/plugin.ts` regressed (it uses v1 protocol — should be unaffected). Run: `cd /Users/heicg/Desktop/projects/device-farm && npm test`. Expected: full pass.

## Cross-phase commit policy

- One feature, one PR, one phase at a time. Never co-mingle phases.
- Each task's commit message follows the existing convention (`feat(scope):`, `test(scope):`, `docs(scope):`).
- After Phase A merges, **device-stream releases 1.2.0-beta.0**. After Phase B → 1.3.0. After C → 1.4.0. D → 2.0.0 (breaking only if any v1 capture API was removed; otherwise 1.5.0). E → 1.6.0 (additive).

## Attribution & licensing

Every file ported from baguette has the Apache-2.0 header preserved at the top. The `VirtualCamera.dylib` sources carry a double-attribution comment (baguette → asc-pro/SimCam → original author). README documents the upstream relationship clearly.
