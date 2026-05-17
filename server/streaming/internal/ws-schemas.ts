// server/streaming/ws-schemas.ts
// Phase 22 Plan 22-01 — Strict WS envelope schema (TRACE-06).
//
// Tightens the Phase 17 Plan 17-02 placeholder by:
//   - Removing .loose() (strict shape; SPEC-08 additive rule applies to `payload`, not envelope).
//   - Making v: z.literal(1) REQUIRED (not optional).
//   - Adding ts: z.string().datetime() for wire-time.
//   - Adding payload: z.unknown() — replaces JobMessage.data; type-narrowed by callers.
//
// Per-module colocated Zod schemas (MOD-03 pattern from Phase 16 pilot).
// Aggregated into contracts/ws-messages.ts for codegen by Phase 17 pipeline;
// Phase 29 (Web Refactor) will share with web client via WEB-03.
//
// Every job-channel WS frame on /ws/jobs/:id uses this shape (TRACE-06). Device
// preview frames on /ws/devices/:id/preview remain base64 binary (out of scope
// per CONTEXT §Deferred Ideas — binary frames don't fit Zod envelopes).
//
// Why no .passthrough() either? The Phase 17 placeholder used .loose() for
// forward-compat; Phase 22 tightens to strict because the envelope IS the
// contract boundary. Per-event-type payload extensions live in the `payload`
// field, not at envelope level. Additions go INSIDE payload (new keys are
// additive there per SPEC-08), envelope structure stays stable.
import { z } from 'zod';

/**
 * Strict envelope for every job-channel WS frame.
 *
 * Field wire shape (example for a log event):
 *   {
 *     "type": "log",
 *     "correlationId": "7f4c3e90-2c8f-47c1-9c8a-3d3c8f7e4a12",
 *     "v": 1,
 *     "ts": "2026-04-22T19:47:12.138Z",
 *     "payload": { "line": "Running flow: login.yaml", "stream": "stdout" }
 *   }
 *
 * `type` enumerates the message shape — matches existing JobMessage.type values
 * ('log' | 'step' | 'metrics' | 'status') but kept as z.string().min(1) here
 * to allow forward-compat with Phase 23 saga event additions without touching
 * this schema. Subscribers narrow via discriminated union on `type` when they
 * parse `payload`.
 *
 * `correlationId` is read from ALS at envelope-build time by the streaming
 * subscriber (plan 22-02). TRACE-06 requirement: every WS frame carries the
 * correlationId of the originating request/queue-job so a developer can grep
 * server logs to trace a single UI event back to its source.
 *
 * `v: z.literal(1)` — SPEC-10 envelope-of-envelope discriminated-union
 * migration preparation. When v2 envelope shape eventually ships (if ever),
 * the union is `z.discriminatedUnion('v', [v1Schema, v2Schema])` and clients
 * parse accordingly. For now v1 is the only shape.
 *
 * `ts` (not `timestamp`) — shorter form saves bytes on the wire; each WS frame
 * can fire 10-100/sec during a running job. Naming aligns with the bus
 * envelope's `occurredAt` field which is set at emit time; `ts` here is set
 * at envelope-build time inside the subscriber (microsecond-level skew is
 * acceptable for UI display).
 *
 * `payload: z.unknown()` — NOT the full JobMessage (which had type+data+timestamp
 * fields). The envelope's top-level `type` supersedes `JobMessage.type`, and
 * `payload` carries only the `data` portion. Avoids double-encoding the type
 * discriminator. Callers (CLI + web) narrow via discriminated union when they
 * parse `payload` per `type`.
 */
export const wsEnvelopeSchema = z.object({
  type:          z.string().min(1),
  correlationId: z.string().uuid(),
  v:             z.literal(1),
  ts:            z.string().datetime(),
  payload:       z.unknown(),
}).meta({
  id: 'WsEnvelope',
  description: 'Strict envelope for every job-channel WS frame (TRACE-06). Phase 22.',
});

export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;
