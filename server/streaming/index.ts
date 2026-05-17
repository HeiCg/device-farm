/**
 * Phase 22 / Plan 22-05 — Streaming module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/streaming/`.
 * `dependency-cruiser` rule `no-deep-imports-into-streaming-internal` (added
 * to `.dependency-cruiser.cjs` in Plan 22-00) enforces the boundary
 * structurally — imports into `server/streaming/internal/**` from outside
 * the module fail CI.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability.
 * Anything under `./internal/` is module-private and may change without notice.
 *
 * NOTE on MOD-02 'strict 1-line internal/' convention: Phase 18/19/20/21
 * artifacts/pool/reporting/lifecycle modules had top-level service files
 * (ArtifactService at server/artifacts/artifact-service.ts etc.) so their
 * barrels re-exported from top-level, with ONE internal/module.js
 * re-export for the factory (the strict-1-line rule). Phase 22 has NO
 * top-level service files — JobBroadcaster + DevicePreviewManager + types
 * + ws-schemas all live UNDER internal/ (Plan 22-02 git mv). The barrel
 * therefore has MULTIPLE internal/* re-exports for back-compat surfaces.
 * This is ALLOWED per the dep-cruiser rule (the rule fires only on
 * `from: { pathNot: '^server/streaming/' }` outside imports; barrel-internal
 * re-exports are WITHIN the module scope). The strict-1-line invariant
 * relaxes to 'ONE internal/module.js re-export for the MOD-06 factory
 * surface' (see the `createStreamingModule` export line below).
 */

// Fastify plugin (default export — matches Phase 15 substrate convention).
export { default as streamingPlugin } from './plugin.js';

// MOD-06 factory surface. ONE `internal/module.js` re-export line (strict).
export { createStreamingModule } from './internal/module.js';
export type { StreamingModule, CreateStreamingModuleDeps } from './internal/module.js';

// Back-compat class surfaces (preserved for existing consumers — Fastify
// decorators fastify.jobBroadcaster + fastify.devicePreview are still read
// by server/jobs/job-service.ts (buffer cleanup call + devicePreview start/stop)
// until Phase 23 Jobs Keystone + Phase 29 Web Refactor remove).
export { JobBroadcaster } from './internal/job-broadcaster.js';
export { DevicePreviewManager } from './internal/device-preview.js';

// Envelope schema + type (Phase 22 TRACE-06 contract; Phase 29 WEB-03
// will share with web client via generated contract artifact).
export { wsEnvelopeSchema } from './internal/ws-schemas.js';
export type { WsEnvelope } from './internal/ws-schemas.js';

// Back-compat WS message types (pre-Phase-22 JobMessage shape and data
// sub-types). New consumers should use WsEnvelope + narrowed payload via
// discriminated union. Legacy back-compat until Phase 29 WEB-03.
export type {
  WsMessageType,
  JobMessage,
  DevicePreviewMessage,
  LogData,
  StepData,
  MetricsData,
  StatusData,
  ArtifactType,
} from './internal/types.js';

// Events surface (MOD-03 — Plan 22-01).
export {
  streamingRegistry,
  STREAMING_EVENT_NAMES,
  STREAMING_AGGREGATE_ID,
  makeStreamingEmitters,
  wsFrameDroppedPayload,
} from './events.js';
export type {
  StreamingRegistry,
  StreamingEmitters,
  StreamingEventName,
} from './events.js';
