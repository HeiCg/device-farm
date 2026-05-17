/**
 * Phase 37 Plan 37-02 — preflight module public barrel (MOD-02).
 *
 * Strict 1-line internal/ re-export + named exports of plugin + schemas/events.
 * NO `export *` (MOD-02 invariant).
 */

// MOD-02 strict 1-line internal/ re-export
export { createPreflightModule, type PreflightModule, type ScanInput, type ScanResult } from './internal/module.js';

// Plugin default export
export { default as preflightPlugin } from './plugin.js';

// Public schemas
export {
  preflightReportSchema,
  preflightBlockerSchema,
  preflightWarningSchema,
  type PreflightReport,
  type PreflightBlocker,
  type PreflightWarning,
} from './schemas.js';

// Public events
export {
  PREFLIGHT_EVENT_NAMES,
  PREFLIGHT_AGGREGATE_TYPE,
  preflightCompletedPayloadSchema,
  type PreflightCompletedPayload,
  type PreflightRegistry,
} from './events.js';
