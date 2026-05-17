/**
 * Phase 25 / Plan 25-05 — Pipelines module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/pipelines/`.
 * The dep-cruiser rule `no-deep-imports-into-pipelines-internal` (added in
 * Phase 25 Plan 25-00 as the 9th forbidden rule) enforces structurally —
 * imports into `server/pipelines/internal/**` from outside the module fail CI.
 *
 * Re-exports inside this barrel from `./internal/*` are at the module
 * BOUNDARY and do NOT violate the rule (the rule fires only for paths
 * matching `pathNot: '^server/pipelines/'` — i.e. external imports).
 *
 * MOD-02 strict invariant: the FIRST non-comment line is the 1-line
 * `./internal/module.js` factory re-export (the canonical MOD-06 entry
 * point). Other internal/ re-exports (back-compat classes) are permitted
 * because they cross the boundary inward-out (e.g. plugin.ts holds typed
 * references to PipelineService).
 */

// MOD-02 strict: 1-line internal re-export FIRST (canonical factory surface, MOD-06).
export { createPipelinesModule, type PipelinesModule, type CreatePipelinesModuleDeps } from './internal/module.js';

// Fastify plugin (default — Phase 15 substrate convention).
export { default as pipelinesPlugin } from './plugin.js';

// Back-compat class surfaces (decorators on fastify still consume these for
// existing routes + tests + plugin internals). Re-exporting from internal/
// is allowed at the barrel — see file header.
export { PipelineService, ConcurrencyDeferredError } from './internal/service.js';
export { PipelineScheduler } from './internal/scheduler.js';
export { PipelineBroadcaster } from './internal/broadcaster.js';
export { SecretsService } from './internal/secrets.js';
export { GitService } from './internal/git-service.js';

// Events surface (MOD-03 — Plan 25-01).
export {
  PIPELINE_EVENT_NAMES,
  PIPELINE_RUN_AGGREGATE_ID,
  PIPELINE_RUN_AGGREGATE_TYPE,
  PIPELINE_SCHEDULE_AGGREGATE_TYPE,
  pipelinesRegistry,
  makePipelinesEmitters,
  pipelineRunStartedPayload,
  pipelineStageAdvancedPayload,
  pipelineRunCompletedPayload,
  pipelineRunFailedPayload,
  pipelineScheduleUpsertedPayload,
} from './events.js';
export type {
  PipelineEventName,
  PipelinesRegistry,
  PipelinesEmitters,
} from './events.js';

// Queue surface (QUEUE-06 — Plan 25-01).
export {
  PIPELINE_SCHEDULED_EXECUTE_QUEUE_NAME,
  pipelineScheduledExecutePayloadSchema,
  registerPipelineScheduledExecuteQueue,
  registerPipelineScheduledExecuteWorker,
  upsertPipelineSchedule,
  removePipelineSchedule,
} from './queue.js';
export type { PipelineScheduledExecutePayload } from './queue.js';
