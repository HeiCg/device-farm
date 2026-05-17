/**
 * Phase 23 Plan 23-04 — Jobs module public barrel (MOD-02).
 *
 * Strict 1-line internal/ re-export pattern (Phase 18+ canonical). Other
 * exports come from non-internal files (events.ts, queue.ts, schemas.ts).
 * No `export *` (MOD-02 invariant).
 */

// MOD-02 strict 1-line internal/ re-export
export { createJobsModule, type JobsModule, type CreateJobsModuleDeps } from './internal/module.js';

// Public events surface (no internal/)
export {
  JOB_EVENT_NAMES,
  jobsRegistry,
  makeJobsEmitters,
  type JobsRegistry,
  type JobsEmitters,
  type JobEventName,
} from './events.js';

// Public queue surface
export {
  JOB_EXECUTE_QUEUE_NAME,
  type JobExecutePayload,
} from './queue.js';

// Public schemas
export {
  jobStatusSchema,
  platformSchema,
  jobSummarySchema,
  jobResponseSchema,
  type JobSummary,
  type JobResponse,
} from './schemas.js';

// Back-compat class (Phase 24+ may delete)
export { JobService } from './job-service.js';

// Plugin default export
export { default as jobsPlugin } from './plugin.js';
