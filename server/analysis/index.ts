/**
 * Phase 37 Plan 37-01 — analysis module barrel (MOD-02).
 *
 * Strict 1-line internal/ re-export FIRST, then plugin/schemas/events
 * surface. NO `export *`.
 */

// MOD-02 strict 1-line internal/ re-export
export { createAnalysisModule, type AnalysisModule } from './internal/module.js';

// Plugin default export wrapper
export { default as analysisPlugin } from './plugin.js';

// Public schemas surface
export {
  skeletonPayloadSchema,
  skeletonScreenSchema,
  deepLinkEntrySchema,
  knownGapSchema,
  analysisResponseSchema,
  analysisIngestResponseSchema,
  analysisProblemJsonSchema,
  type SkeletonPayload,
  type SkeletonScreen,
  type DeepLinkEntry,
  type KnownGap,
  type AnalysisResponse,
} from './schemas.js';

// Public events surface
export {
  ANALYSIS_EVENT_NAMES,
  ANALYSIS_AGGREGATE_TYPE,
  analysisIngestedPayloadSchema,
  type AnalysisIngestedPayload,
  type AnalysisRegistry,
  type AnalysisEmitters,
} from './events.js';
