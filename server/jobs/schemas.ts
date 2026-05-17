/**
 * Phase 17 Plan 17-01 (SPEC-06) — Jobs module Zod schemas.
 * Phase 23 Plan 23-03 — Extended with jobResponseSchema for full job rows
 * (CLI-05 / DEBT-02). Adds 'allocated' to jobStatusSchema (saga state).
 */
import { z } from 'zod';

/**
 * Phase 23 Plan 23-03 — extends to 7 values; 'allocated' covers the saga
 * step between queued and running (set by jobs subscriber on
 * device.allocated). Backwards-compatible — existing rows have one of the
 * 6 prior values.
 */
export const jobStatusSchema = z.enum([
  'queued',
  'allocated',                          // Phase 23 saga state
  'running',
  'passed',
  'failed',
  'cancelled',
  'timeout',
]);

export const platformSchema = z.enum(['android', 'ios']);

/**
 * Original 3-field summary kept for the POST /api/jobs response (creating a
 * job returns id+status+platform — full row not yet populated).
 */
export const jobSummarySchema = z.object({
  id: z.string().uuid(),
  status: jobStatusSchema,
  platform: platformSchema,
}).meta({
  id: 'JobSummary',
  description: 'Job identifier + initial queued state returned by POST /api/jobs',
});

export type JobSummary = z.infer<typeof jobSummarySchema>;

/**
 * Phase 23 Plan 23-03 — Full job response shape (CLI-05 / DEBT-02).
 *
 * deviceName is populated by the repo-level leftJoin(devices) — see
 * server/jobs/internal/repo.ts. Nullable when deviceId is null (job not
 * yet allocated). Non-empty string when deviceId is set.
 *
 * Cross-field refinement enforces: `deviceId IS NULL XOR deviceName IS NOT NULL`.
 * Drizzle leftJoin returns deviceName: null when no matching device row;
 * the refinement catches misuse where a route handler maps the row but
 * forgets to project the joined column.
 *
 * `.meta({id:'Job'})` emits as `components.schemas.Job` via fastify-zod-openapi
 * (Phase 17 contract pipeline). The contract-devicename.spec.ts asserts the
 * OpenAPI artifact has `deviceName` in `properties` — dropping it in any
 * future plan mechanically blocks CI.
 *
 * Note on .refine() and OpenAPI: fastify-zod-openapi emits the field
 * shape (deviceName: string|null) but the cross-field constraint is NOT
 * expressible in JSON Schema (known limitation). Zod enforces at runtime;
 * OpenAPI just shows the field. Acceptable per RESEARCH §Pattern 5.
 */
export const jobResponseSchema = z.object({
  id: z.string().uuid(),
  status: jobStatusSchema,
  platform: platformSchema,
  deviceId: z.string().uuid().nullable(),
  deviceName: z.string().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
}).refine(
  (j) => j.deviceId == null || (j.deviceName !== null && j.deviceName.length > 0),
  {
    message: 'deviceName must be non-empty when deviceId is present',
    path: ['deviceName'],
  },
).meta({
  id: 'Job',
  description: 'Full job record including allocated device name (joined from devices.name)',
});

export type JobResponse = z.infer<typeof jobResponseSchema>;

/**
 * Phase 37 Plan 37-04 Wave 1 Track D — parallel-deploy job spec.
 *
 * Submitted via POST /api/jobs with the multipart field
 *   metadata = JSON.stringify({mode:'parallel-deploy', parallelism:3, ...})
 *
 * The route handler enforces the per-platform cap (Pitfall 9) by reading
 * `config.pool.<platform>.max_parallelism` and returning 503 + Retry-After
 * when `parallelism` exceeds it. Schema-level min/max (1..20) is a hard
 * upper bound that catches obvious misuse before the cap check fires.
 */
export const parallelDeployJobMetadataSchema = z.object({
  mode: z.literal('parallel-deploy'),
  parallelism: z.number().int().min(2).max(20),
  /**
   * When true, the input-broadcaster mirrors tap/key/text events from the
   * primary session to all N parallel sessions. Defaults to false — pure
   * fan-out deploy without input mirroring.
   */
  broadcastInput: z.boolean().default(false),
});

export type ParallelDeployJobMetadata = z.infer<typeof parallelDeployJobMetadataSchema>;
