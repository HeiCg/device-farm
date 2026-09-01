import type { CaptureBackend, ProfilerKind, RawProfile } from '../types';

/**
 * Device-bound capture backends.
 *
 * These are the seams that connect the pure analysis core to real devices.
 * Each is intentionally thin: it records, then normalizes its native output
 * into a {@link RawProfile} that {@link analyzeProfile} consumes. The capture
 * mechanics (Metro CDP, xctrace, adb perfetto) require a live device/toolchain
 * and are wired in follow-up work; the contracts below pin down the shapes.
 */

export class BackendNotWiredError extends Error {
  constructor(public readonly backend: string, hint: string) {
    super(`${backend} capture is not wired yet. ${hint}`);
    this.name = 'BackendNotWiredError';
  }
}

/**
 * React Native profiler — connects to the Metro CDP target, injects the React
 * commit-capture hook, and starts Hermes/V8 CPU sampling. `stop()` collects the
 * CPU profile + commit tree and correlates them into a {@link RawProfile}.
 *
 * @param opts.metroUrl default http://localhost:8081
 */
export function createReactProfilerBackend(opts: { metroUrl?: string } = {}): CaptureBackend {
  const metroUrl = opts.metroUrl ?? 'http://localhost:8081';
  return {
    kind: 'react',
    async start(): Promise<void> {
      throw new BackendNotWiredError(
        'react-profiler',
        `Would attach to Metro CDP at ${metroUrl}, enable Profiler.start + React commit hook.`,
      );
    },
    async stop(): Promise<RawProfile> {
      throw new BackendNotWiredError('react-profiler', 'Would collect cpuProfile + commitTree and normalize.');
    },
  };
}

/**
 * Native profiler — iOS via `xcrun xctrace record` (Time Profiler + hangs),
 * Android via `adb shell perfetto`. `stop()` exports the trace and parses it
 * (Instruments XML / Perfetto WASM trace_processor) into a {@link RawProfile}.
 *
 * @param platform selects the recording backend.
 */
export function createNativeProfilerBackend(platform: 'ios' | 'android'): CaptureBackend {
  const tool = platform === 'ios' ? 'xctrace (Instruments)' : 'adb shell perfetto';
  return {
    kind: 'native',
    async start(): Promise<void> {
      throw new BackendNotWiredError('native-profiler', `Would start ${tool} recording.`);
    },
    async stop(): Promise<RawProfile> {
      const parser = platform === 'ios' ? 'Instruments XML' : 'Perfetto trace_processor (WASM)';
      throw new BackendNotWiredError('native-profiler', `Would export the trace and parse via ${parser}.`);
    },
  };
}

/** Pick a backend by kind. iOS/Android only matters for native. */
export function createBackend(kind: ProfilerKind, platform: 'ios' | 'android'): CaptureBackend {
  return kind === 'react' ? createReactProfilerBackend() : createNativeProfilerBackend(platform);
}
