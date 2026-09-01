/**
 * @device-stream/profiler — backend-agnostic mobile profiling.
 *
 * A pure analysis core ({@link analyzeProfile}) over a normalized
 * {@link RawProfile} IR, a {@link ProfilerSession} lifecycle, and device-bound
 * capture backends (React Native via Metro CDP; native via xctrace / perfetto).
 *
 * Pipeline: createBackend → ProfilerSession.start → (interact) → stop →
 * analyzeProfile → BottleneckReport.
 */
export * from './types';
export { analyzeProfile, type AnalyzeOptions } from './analyze';
export { ProfilerSession } from './session';
export {
  createBackend,
  createReactProfilerBackend,
  createNativeProfilerBackend,
  BackendNotWiredError,
} from './backends/index';
