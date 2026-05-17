/**
 * Phase 15 / Plan 15-04 — bus module barrel.
 *
 * Re-exports the plugin (default import) plus the primitives module authors
 * may need when constructing their own per-module registries and helpers
 * (Phase 16 pilot onward).
 */
export { default as busPlugin } from './plugin.js';
export { TypedBus } from './bus.js';
export { createEventHelpers } from './helpers.js';
export type { EventRegistry, EventRegistryEntry, PayloadOf } from './types.js';
