/**
 * Phase 16 / Plan 16-02 — Hooks module public barrel (MOD-02).
 *
 * This is the ONLY import surface for consumers outside `server/hooks/`.
 * `dependency-cruiser` (plan 16-03) enforces the rule structurally by denying
 * imports into `server/hooks/internal/**` from outside the module.
 *
 * Exports in this file are PUBLIC and subject to semver-ish stability. Anything
 * under `./internal/` is module-private and may change without notice.
 */

// Fastify plugin (default export matches phase 15 substrate convention: `import { busPlugin } ...`).
export { default as hooksPlugin } from './plugin.js';

// Public class surface (imperative API, preserved for back-compat consumers).
export { HookExecutor, HookError } from './hook-executor.js';
export type { HookContext, HookResult } from './hook-executor.js';

// Factory surface (the v3.0 canonical way to instantiate the module).
export { createHooksModule } from './internal/module.js';
export type { HooksModule, CreateHooksModuleDeps } from './internal/module.js';

// Schemas + derived TS types (SPEC-01 / SPEC-03).
export { hookDefinitionSchema } from './schemas.js';
export type { HookDefinition, HookEvent } from './schemas.js';

// Events surface (MOD-03).
export {
  hooksRegistry,
  HOOK_EVENT_NAMES,
  makeHookEmitters,
  hookScheduledPayload,
  hookCompletedPayload,
  hookFailedPayload,
  hookFailedRetryExhaustedPayload,
} from './events.js';
export type { HooksRegistry, HookEmitters, HookEventName } from './events.js';

// Queue surface (QUEUE-06).
export {
  HOOK_RUN_QUEUE_NAME,
  hookRunPayloadSchema,
  registerHookRunWorker,
} from './queue.js';
export type { HookRunPayload, RegisterHookRunWorkerDeps } from './queue.js';
