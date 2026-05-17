/**
 * Queue module barrel — Phase 15 Plan 05.
 *
 * Re-exports the pg-boss Fastify plugin and the central `QUEUE_NAMES` registry so
 * consumers import from a single path (mirrors the `server/correlation/` and
 * `server/telemetry/` module shape established in plan 15-03).
 */
export { default as queuePlugin } from './plugin.js';
export { QUEUE_NAMES, isValidQueueName, type QueueName } from './names.js';
