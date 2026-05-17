/**
 * Phase 17 Plan 17-01 (SPEC-06) — Pipelines module Zod schemas for the
 * representative POST /api/pipelines route.
 *
 * Separate from server/pipelines/schema.ts (pipeline YAML body shape). These
 * are the HTTP boundary schemas for the OpenAPI emit — keep them THIN, full
 * per-route coverage lands in the pipelines module refactor phase.
 */
import { z } from 'zod';

/**
 * Request body for POST /api/pipelines — the existing route accepts
 * raw YAML (string) OR an object that gets JSON-stringified. We model it
 * permissively as a string for now; a full schema would require lifting
 * the YAML validators out of PipelineService.
 */
export const pipelineCreateRequestSchema = z.string().meta({
  id: 'PipelineCreateRequest',
  description: 'Raw YAML document defining the pipeline (name + stages + trigger)',
});

export const pipelineSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
}).meta({
  id: 'Pipeline',
  description: 'Result of a pipeline create operation — identifier only',
});

export type PipelineCreateRequest = z.infer<typeof pipelineCreateRequestSchema>;
export type PipelineSummary = z.infer<typeof pipelineSummarySchema>;
