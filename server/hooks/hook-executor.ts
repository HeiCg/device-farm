/**
 * Phase 16 / Plan 16-02 — Back-compat re-export.
 *
 * The HookExecutor class body moved to `./internal/hook-executor.ts` as part of the
 * module refactor (MOD-02: public code re-exported from `index.ts`, module-private code
 * lives under `internal/`). This file stays at the original path so existing imports
 * (`server/index.ts`, `server/hooks/plugin.ts`, `server/hooks/queue.ts`, etc.) continue
 * to resolve without code churn. Phase 20+ can migrate consumers to import from
 * `./index.js` (the canonical public barrel) and delete this shim.
 */
export {
  HookExecutor,
  HookError,
} from './internal/hook-executor.js';

export type {
  HookContext,
  HookResult,
  HookEvent,
  HookDefinition,
} from './internal/hook-executor.js';
