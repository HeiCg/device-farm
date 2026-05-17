/**
 * Correlation module barrel — Phase 15 Plan 03.
 *
 * Re-exports the Fastify plugin plus the raw ALS primitives from `@fastify/request-context`
 * so consumers (queue worker wrapper in plan 05, telemetry mixin in plan 03 Task 3.2,
 * event bus causation wrapper in plan 04) import from a single module path.
 */
export { default as correlationPlugin } from './plugin.js';
export { requestContext, asyncLocalStorage } from '@fastify/request-context';
