/**
 * Phase 24 / Plan 24-05 — Maestro module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/maestro/`.
 * The dep-cruiser rule `no-deep-imports-into-maestro-internal` (added in
 * Phase 24 Plan 24-00 as the 8th forbidden rule) enforces structurally —
 * imports into `server/maestro/internal/**` from outside the module fail CI.
 *
 * Re-exports inside this barrel from `./internal/*` are at the module
 * BOUNDARY and do NOT violate the rule (the rule fires only for paths
 * matching `pathNot: '^server/maestro/'` — i.e. external imports).
 *
 * MOD-02 strict invariant: ONE re-export from `./internal/module.js`
 * (the factory entry point per MOD-06). Other internal/ re-exports
 * (back-compat classes) are permitted because they cross the boundary
 * inward-out (e.g. routes.ts holds typed references to HierarchyService).
 */

// Fastify plugin (default — Phase 15 substrate convention).
export { default as maestroPlugin } from './plugin.js';

// MOD-06 factory surface. ONE `internal/module.js` re-export line (strict).
export {
  createMaestroModule,
  type MaestroModule,
  type CreateMaestroModuleDeps,
} from './internal/module.js';

// Back-compat class surfaces (decorators on fastify still consume these
// for routes and any pre-Phase-24 caller). Re-exporting from internal/
// is allowed at the barrel — see file header.
export { HierarchyService } from './internal/hierarchy-service.js';
export type { HierarchySource, HierarchyNode, HierarchyResult } from './internal/hierarchy-service.js';
export { AppiumService } from './internal/appium-service.js';
export { DeviceInfoCollector } from './internal/device-info-collector.js';

// Events surface (MOD-03 — Plan 24-01).
export {
  maestroRegistry,
  MAESTRO_EVENT_NAMES,
  MAESTRO_AGGREGATE_ID,
  makeMaestroEmitters,
  maestroHierarchyFetchedPayload,
  maestroDeviceInfoCollectedPayload,
} from './events.js';
export type {
  MaestroRegistry,
  MaestroEmitters,
  MaestroEventName,
} from './events.js';
