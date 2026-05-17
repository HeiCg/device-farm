/**
 * Sessions REST Zod schemas — Phase 34 Plan 34-00.
 *
 * Ships the FULL body at substrate so Plan 34-01 routes.ts imports them
 * unchanged. Each schema calls `.meta({ id: '...' })` so fastify-zod-openapi
 * promotes them into `openapi.json components.schemas` (Phase 17 pattern).
 *
 * Schemas verbatim from 34-RESEARCH.md §REST Surface (lines ~160-231):
 *   - leaseRequestSchema  → POST /api/sessions body
 *   - leaseResponseSchema → POST /api/sessions 200 response
 *   - releaseParamsSchema → DELETE /api/sessions/:id params
 *   - releaseResponseSchema → DELETE /api/sessions/:id 200 response
 *   - listResponseSchema  → GET  /api/sessions 200 response
 */
import { z } from 'zod';

// ── Lease (POST /api/sessions) ──────────────────────────────────────

export const leaseRequestSchema = z
  .object({
    platform: z.enum(['android', 'ios']),
    deviceQuery: z
      .object({
        deviceId: z.string().uuid().optional(),
        name: z.string().optional(),
      })
      .optional(),
    ttlSeconds: z.number().int().min(60).max(3600).default(600),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'SessionLeaseRequest' });

export type LeaseRequest = z.infer<typeof leaseRequestSchema>;

export const leaseResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    deviceId: z.string().uuid(),
    deviceName: z.string(),
    platform: z.enum(['android', 'ios']),
    wsUrl: z.string().url(),
    leaseUntil: z.string().datetime(),
    ttlSeconds: z.number().int(),
  })
  .meta({ id: 'SessionLeaseResponse' });

export type LeaseResponse = z.infer<typeof leaseResponseSchema>;

// ── Release (DELETE /api/sessions/:id) ──────────────────────────────

export const releaseParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .meta({ id: 'SessionReleaseParams' });

export type ReleaseParams = z.infer<typeof releaseParamsSchema>;

export const releaseResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    released: z.literal(true),
    releasedAt: z.string().datetime(),
  })
  .meta({ id: 'SessionReleaseResponse' });

export type ReleaseResponse = z.infer<typeof releaseResponseSchema>;

// ── List (GET /api/sessions) ────────────────────────────────────────

export const listResponseSchema = z
  .object({
    sessions: z.array(
      z.object({
        sessionId: z.string().uuid(),
        deviceId: z.string().uuid(),
        deviceName: z.string(),
        platform: z.enum(['android', 'ios']),
        status: z.enum(['active', 'released', 'expired']),
        leaseUntil: z.string().datetime(),
        createdAt: z.string().datetime(),
        ownerActor: z.string().nullable(),
        metadata: z.record(z.string(), z.unknown()).nullable(),
      }),
    ),
  })
  .meta({ id: 'SessionListResponse' });

export type ListResponse = z.infer<typeof listResponseSchema>;
