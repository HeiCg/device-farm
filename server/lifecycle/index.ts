/**
 * Phase 18 / Plan 18-04 — Lifecycle module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/lifecycle/`.
 * `dependency-cruiser` (rule `no-deep-imports-into-lifecycle-internal` added
 * in Phase 18 Plan 18-00) enforces the boundary structurally — imports into
 * `server/lifecycle/internal/**` from outside the module fail CI.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability.
 * Anything under `./internal/` is module-private and may change without notice.
 *
 * The ONLY allowed internal/ re-export is `createLifecycleModule` + the
 * `LifecycleModule` / `CreateLifecycleModuleDeps` types — the canonical
 * factory entry point per MOD-06. Matches Phase 16 hooks pilot pattern
 * (`server/hooks/index.ts:20-21`).
 */

// Fastify plugin (default export — matches Phase 15 substrate convention).
export { default as lifecyclePlugin } from './plugin.js';

// Factory surface (the v3.0 canonical way to instantiate the module).
// NOTE: Runtime + types exported from a single statement (inline `type`
// modifier) so plan 18-04 Task 4.2 verify script sees exactly ONE
// internal/ re-export line (MOD-02 structural invariant).
export { createLifecycleModule, type LifecycleModule, type CreateLifecycleModuleDeps } from './internal/module.js';

// Stats surface (back-compat with fastify.lifecycleStats decorator + /health endpoint).
export type { LifecycleStats } from './stats.js';

// Schemas + derived TS types (SPEC-01 / SPEC-03).
export {
  lifecycleJobPayloadSchema,
  compressionResultSchema,
  retentionResultSchema,
  diskPressureResultSchema,
} from './schemas.js';
export type {
  LifecycleJobPayload,
  CompressionResultParsed,
  RetentionResultParsed,
  DiskPressureResultParsed,
} from './schemas.js';

// Events surface (MOD-03).
export {
  lifecycleRegistry,
  LIFECYCLE_EVENT_NAMES,
  LIFECYCLE_AGGREGATE_ID,
  makeLifecycleEmitters,
  compressionCompletedPayload,
  retentionCompletedPayload,
  diskCheckedPayload,
  taskFailedPayload,
} from './events.js';
export type { LifecycleRegistry, LifecycleEmitters, LifecycleEventName } from './events.js';

// Queue surface (QUEUE-06).
export {
  LIFECYCLE_COMPRESS_DAILY_QUEUE_NAME,
  LIFECYCLE_RETENTION_DAILY_QUEUE_NAME,
  LIFECYCLE_DISK_HOURLY_QUEUE_NAME,
  COMPRESS_CRON,
  RETENTION_CRON,
  DISK_CRON,
  registerLifecycleSchedulesAndWorkers,
} from './queue.js';
export type {
  RegisterLifecycleSchedulesAndWorkersDeps,
  LifecycleQueueRegistration,
} from './queue.js';
