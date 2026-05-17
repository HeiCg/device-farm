/**
 * Telemetry module barrel — Phase 15 Plan 03.
 *
 * Re-exports the Fastify plugin AND the `alsMixin` so callers can import either the plugin
 * (for registration in plan 15-06) or the raw mixin (for `Fastify({ logger: { mixin } })`).
 */
export { default as telemetryPlugin, alsMixin } from './plugin.js';
