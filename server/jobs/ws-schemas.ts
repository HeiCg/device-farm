// server/jobs/ws-schemas.ts
// Phase 17 Plan 17-02 — WebSocket frame schemas for /ws/jobs/:id channel.
//
// Per-module colocated Zod schemas (MOD-03 pattern from Phase 16 pilot).
// Downstream: contracts/ws-messages.ts aggregates these into wsMessageRegistry;
// server/scripts/build-openapi.ts emits contracts/ws-messages.json from that.
//
// Discriminator field: `type` (matches server envelope + Phase 15 event envelope).
//
// NOTE: Field shapes here match the planned forward-looking wire shape
// (correlationId + flattened payload), NOT the current runtime JobMessage
// interface in server/streaming/types.ts (which nests `data: unknown` under
// wsMessageType). Phase 22 (Streaming Module) is responsible for migrating
// the runtime broadcaster to emit these Zod-validated frames. This plan only
// ships SHAPES + fixtures + round-trip coverage for downstream codegen.
import { z } from 'zod';

export const jobLogMessage = z.object({
  type: z.literal('log'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  timestamp: z.string().datetime(),
}).meta({ id: 'JobLogMessage', description: 'Log line emitted by an executing job' });

export const jobStepMessage = z.object({
  type: z.literal('step'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  stepName: z.string(),
  status: z.enum(['running', 'passed', 'failed']),
}).meta({ id: 'JobStepMessage', description: 'Test step boundary' });

export const jobStatusMessage = z.object({
  type: z.literal('status'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: z.enum(['queued', 'allocated', 'running', 'completed', 'failed']),
}).meta({ id: 'JobStatusMessage', description: 'Job lifecycle state transition' });

export const jobMessageUnion = z.discriminatedUnion('type', [
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
]);

export type JobMessage = z.infer<typeof jobMessageUnion>;
