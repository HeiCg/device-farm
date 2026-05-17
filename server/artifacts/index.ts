/**
 * Phase 21 / Plan 21-06 — Artifacts module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/artifacts/`.
 * `dependency-cruiser` rule `no-deep-imports-into-artifacts-internal` (added
 * to `.dependency-cruiser.cjs` in Phase 21 Plan 21-00) enforces the boundary
 * structurally — imports into `server/artifacts/internal/**` from outside
 * the module fail CI.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability.
 * Anything under `./internal/` is module-private and may change without notice.
 *
 * The ONLY allowed internal/ re-export line is the factory entry point per
 * MOD-06. Runtime + types exported from a single statement (inline `type`
 * modifier) so plan 21-06 verify script sees exactly ONE internal/ re-export
 * line (MOD-02 structural invariant). Matches Phase 18/19/20 1-line form,
 * stricter than Phase 16 hooks' 2-line form.
 */

// Fastify plugin (default export — matches Phase 15 substrate convention).
export { default as artifactsPlugin } from './plugin.js';

// Factory surface (MOD-06). ONE internal/ re-export line — MOD-02 structural invariant.
export { createArtifactsModule, type ArtifactsModule, type CreateArtifactsModuleDeps } from './internal/module.js';

// Back-compat class surfaces (preserved for existing consumers — Fastify
// decorators fastify.<X>Service are still read by server/jobs/job-service.ts
// for the Phase3Services interface until Phase 23 Jobs Keystone removes).
export { ArtifactService } from './artifact-service.js';
export type { CreateArtifactOpts } from './artifact-service.js';
export { RecordingService } from './recording-service.js';
export type { PlatformServices } from './recording-service.js';
export { ScreenshotService } from './screenshot-service.js';
export { MemoryService } from './memory-service.js';
export type { ExecFileFn } from './memory-service.js';

// Schemas + derived TS types (Phase 17 SPEC-06 unchanged).
export {
  artifactTypeSchema,
  artifactSummarySchema,
  artifactListSchema,
} from './schemas.js';
export type { ArtifactSummary } from './schemas.js';

// WebSocket schemas (Phase 17 Plan 17-02 unchanged).
export {
  artifactCreatedMessage,
  artifactMessageUnion,
} from './ws-schemas.js';
export type { ArtifactMessage } from './ws-schemas.js';

// Events surface (MOD-03 — Plan 21-02).
export {
  artifactsRegistry,
  ARTIFACTS_EVENT_NAMES,
  ARTIFACTS_AGGREGATE_ID,
  makeArtifactsEmitters,
  artifactCreatedPayload,
  recordingStartedPayload,
  recordingStoppedPayload,
} from './events.js';
export type {
  ArtifactsRegistry,
  ArtifactsEmitters,
  ArtifactsEventName,
} from './events.js';

// Queue surface (QUEUE-06 — Plan 21-03).
export {
  RECORDING_UPLOAD_QUEUE_NAME,
  recordingUploadPayloadSchema,
  registerArtifactsWorker,
} from './queue.js';
export type {
  RecordingUploadPayload,
  RegisterArtifactsWorkerDeps,
  ArtifactsWorkerRegistration,
} from './queue.js';
