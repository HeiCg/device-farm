// server/artifacts/ws-schemas.ts
// Phase 17 Plan 17-02 — WebSocket frame schemas for artifact notifications.
//
// Per-module colocated Zod schemas (MOD-03 pattern from Phase 16 pilot).
// Aggregated into contracts/ws-messages.ts for codegen.
import { z } from 'zod';

export const artifactCreatedMessage = z.object({
  type: z.literal('artifact.created'),
  correlationId: z.string().uuid(),
  jobId: z.string().uuid(),
  artifactId: z.string().uuid(),
  kind: z.enum(['recording', 'screenshot', 'memory', 'log']),
  sizeBytes: z.number().int().nonnegative(),
}).meta({ id: 'ArtifactCreatedMessage', description: 'New artifact persisted to storage' });

export const artifactMessageUnion = z.discriminatedUnion('type', [
  artifactCreatedMessage,
]);

export type ArtifactMessage = z.infer<typeof artifactMessageUnion>;
