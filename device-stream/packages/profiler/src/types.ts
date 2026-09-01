/** What we are profiling. */
export type ProfilerKind = 'react' | 'native';

export type ProfilerState = 'idle' | 'recording' | 'stopped';

/** A normalized CPU sample, backend-agnostic (V8/Hermes, Instruments, Perfetto). */
export interface ProfileSample {
  function: string;
  file?: string;
  line?: number;
  /** Exclusive (self) time attributed to this function, ms. */
  selfMs: number;
  /** Inclusive (self + callees) time, ms. */
  totalMs: number;
}

/** A main-thread stall / UI hang. */
export interface HangEvent {
  startMs: number;
  durationMs: number;
  /** Innermost-first stack at the time of the hang. */
  stack: string[];
}

/**
 * Backend-agnostic intermediate representation. The device-bound backends
 * (Metro CDP, xctrace, adb perfetto) normalize their raw output into this so a
 * single {@link analyzeProfile} works across platforms.
 */
export interface RawProfile {
  kind: ProfilerKind;
  durationMs: number;
  samples: ProfileSample[];
  hangs?: HangEvent[];
}

export interface RankedFunction {
  function: string;
  file?: string;
  line?: number;
  selfMs: number;
  /** Share of total self time across all samples, 0–100, rounded. */
  selfPct: number;
}

export interface RankedHang {
  startMs: number;
  durationMs: number;
  topFrame: string;
}

export interface BottleneckReport {
  kind: ProfilerKind;
  durationMs: number;
  topFunctions: RankedFunction[];
  hangs: RankedHang[];
  summary: string;
}

/**
 * A capture backend records on a device and returns a normalized profile.
 * Implementations are device-bound (see ./backends) and intentionally thin so
 * the analysis layer stays pure and testable.
 */
export interface CaptureBackend {
  readonly kind: ProfilerKind;
  start(deviceId: string): Promise<void>;
  stop(): Promise<RawProfile>;
}
