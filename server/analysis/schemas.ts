/**
 * Phase 37 Plan 37-01 — analysis Zod schemas.
 *
 * Wire format produced by `device-farm analyze <ipa>` (Go CLI) and
 * consumed by POST /api/builds/:id/skeleton + the web viewer at
 * /builds/[id]/skeleton.
 *
 * schema_version literal = 1 enables forward-compat — Wave 2+ bumps and
 * keeps a discriminated union for read backward-compat.
 *
 * Schemas use `.meta({id:...})` so fastify-zod-openapi promotes them to
 * components.schemas in openapi.json (consumed by web typegen).
 */

import { z } from 'zod';

export const skeletonScreenSchema = z
  .object({
    name: z.string(),
    source: z.enum(['objc_classlist', 'swift5_types', 'hermes_strings']),
    confidence: z.enum(['high', 'medium', 'low']),
    module: z.string().nullable().optional(),
  })
  .meta({ id: 'SkeletonScreen' });

export const deepLinkEntrySchema = z
  .object({
    scheme: z.string(),
    host: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    source: z.enum(['info_plist', 'associated_domains']),
  })
  .meta({ id: 'DeepLinkEntry' });

export const knownGapSchema = z
  .object({
    kind: z.string(),
    message: z.string(),
  })
  .meta({ id: 'KnownGap' });

export const skeletonPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    platform: z.literal('ios'),
    app: z.object({
      bundle_id: z.string(),
      version: z.string().nullable().optional(),
      executable: z.string().nullable().optional(),
    }),
    react_native_bundle: z
      .object({
        detected: z.boolean(),
        hermes: z.boolean(),
        bundle_path: z.string().nullable().optional(),
      })
      .nullable(),
    stats: z.object({
      total_classes: z.number().int().nonnegative(),
      total_swift_types: z.number().int().nonnegative(),
    }),
    candidate_screens: z.array(skeletonScreenSchema),
    deep_link_entries: z.array(deepLinkEntrySchema),
    known_gaps: z.array(knownGapSchema),
  })
  .meta({ id: 'SkeletonPayload' });

export const analysisResponseSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid().nullable(),
    buildArtifactId: z.string().uuid().nullable(),
    platform: z.enum(['android', 'ios']),
    payload: skeletonPayloadSchema,
    createdAt: z.string(),
  })
  .meta({ id: 'Analysis' });

export const analysisIngestResponseSchema = z
  .object({
    analysisId: z.string().uuid(),
  })
  .meta({ id: 'AnalysisIngestResponse' });

export const analysisProblemJsonSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
  })
  .meta({ id: 'AnalysisProblemJson' });

export type SkeletonPayload = z.infer<typeof skeletonPayloadSchema>;
export type SkeletonScreen = z.infer<typeof skeletonScreenSchema>;
export type DeepLinkEntry = z.infer<typeof deepLinkEntrySchema>;
export type KnownGap = z.infer<typeof knownGapSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
