# @device-stream/profiler

Backend-agnostic mobile profiling. A **pure analysis core** (CPU hotspots + UI hangs) over a normalized profile IR, a session lifecycle, and device-bound capture backends for React Native (Metro CDP) and native (Xcode Instruments / Android Perfetto).

## Why

Streaming and control tell you *what* the app is doing; profiling tells you *why it's slow*. This package gives the farm (and an MCP agent) a uniform `start → stop → analyze` pipeline whose analysis is identical across platforms because every backend normalizes its raw output into the same `RawProfile` IR.

## Status

- ✅ **Analysis core** — `analyzeProfile`, `ProfilerSession`, the `RawProfile` IR, and the `CaptureBackend` contract are implemented and unit-tested.
- 🚧 **Capture backends** — `createReactProfilerBackend` (Metro CDP) and `createNativeProfilerBackend` (`xctrace` / `adb shell perfetto`) are the device-bound seams. They define the contract and throw `BackendNotWiredError` until the capture mechanics (CDP session, trace export, Perfetto WASM `trace_processor`) are wired in.

## Pipeline

```ts
import { createBackend, ProfilerSession, analyzeProfile } from '@device-stream/profiler';

const session = new ProfilerSession(createBackend('react', 'android'), 'emulator-5554');

await session.start();
// …drive the app (e.g. via @device-stream/dsl) to exercise the slow path…
const raw = await session.stop();          // RawProfile (normalized samples + hangs)

const report = analyzeProfile(raw, { topN: 10 });
console.log(report.summary);
// "react profile over 1000ms: hottest is renderList (List.tsx:12) at 400ms (50% of CPU). 2 hang(s), worst 250ms in renderList."
```

## Concepts

### `RawProfile` (the IR)

Backends normalize into this; analysis only ever sees this shape.

```ts
interface ProfileSample { function: string; file?: string; line?: number; selfMs: number; totalMs: number; }
interface HangEvent    { startMs: number; durationMs: number; stack: string[]; }  // innermost-first
interface RawProfile   { kind: 'react' | 'native'; durationMs: number; samples: ProfileSample[]; hangs?: HangEvent[]; }
```

### `analyzeProfile(raw, opts?)` → `BottleneckReport`

Pure. Aggregates self time per function (merging duplicate samples), ranks the hottest with their **% of total CPU**, ranks the longest hangs with their innermost frame, and builds a one-line summary. Handles empty profiles without dividing by zero.

```ts
interface BottleneckReport {
  kind: 'react' | 'native';
  durationMs: number;
  topFunctions: { function: string; file?: string; line?: number; selfMs: number; selfPct: number }[];
  hangs: { startMs: number; durationMs: number; topFrame: string }[];
  summary: string;
}
```

`opts.topN` (default 15) and `opts.topHangs` (default 10) bound the report.

### `ProfilerSession`

A guarded `idle → recording → stopped` state machine around one backend. Holds `deviceId` and `kind` for ownership checks (one profiler of a given kind per device). `start()` twice throws; `stop()` before `start()` throws.

### `CaptureBackend` (the seam)

```ts
interface CaptureBackend {
  readonly kind: 'react' | 'native';
  start(deviceId: string): Promise<void>;
  stop(): Promise<RawProfile>;
}
```

- **React** (`createReactProfilerBackend({ metroUrl })`) — attaches to the Metro CDP target, enables CPU sampling + a React commit-capture hook, and on `stop()` correlates the CPU profile with the commit tree into a `RawProfile`.
- **Native** (`createNativeProfilerBackend('ios' | 'android')`) — iOS records via `xcrun xctrace` (Time Profiler + hangs) and parses the Instruments XML; Android records via `adb shell perfetto` and parses the `.pftrace` with the Perfetto `trace_processor` (WASM, in-process).

Wiring a backend means implementing `start`/`stop` to produce a `RawProfile` — the analysis layer needs no changes.

## Architecture

```
src/
├── index.ts              # public surface
├── types.ts              # RawProfile IR, BottleneckReport, CaptureBackend
├── analyze.ts            # analyzeProfile (pure: hotspots + hangs + summary)
├── session.ts            # ProfilerSession lifecycle
└── backends/
    └── index.ts          # createReactProfilerBackend / createNativeProfilerBackend (seams)
```

## License

MIT
