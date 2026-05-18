import { z } from 'zod';

/**
 * Query schema for GET /api/jobs
 * metadata.* params are handled separately via buildMetadataFilters.
 */
export const listJobsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['queued', 'running', 'passed', 'failed', 'cancelled', 'timeout'])
    .optional(),
  platform: z.enum(['android', 'ios']).optional(),
  flowName: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

/**
 * Schema for the platform field in multipart job creation.
 */
export const createJobSchema = z.object({
  platform: z.enum(['android', 'ios']),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
