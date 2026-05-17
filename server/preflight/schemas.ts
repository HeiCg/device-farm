/**
 * Phase 37 Plan 37-00 Wave 0 — preflight report Zod schemas.
 *
 * The scanner output (Wave 1) is validated against these schemas before
 * persistence into `preflight_runs`. The `status` discriminator drives the
 * UI red/yellow/green badge.
 */

import { z } from 'zod';

export const preflightBlockerSchema = z.object({
  rule_id: z.string(),
  message: z.string(),
  location: z.string().nullable().optional(),
});

export const preflightWarningSchema = z.object({
  rule_id: z.string(),
  message: z.string(),
  location: z.string().nullable().optional(),
});

export const preflightReportSchema = z.object({
  status: z.enum(['pass', 'pass_with_warnings', 'blocked']),
  rules_version: z.string(),
  platform: z.enum(['ios', 'android']),
  blockers: z.array(preflightBlockerSchema),
  warnings: z.array(preflightWarningSchema),
});

export type PreflightBlocker = z.infer<typeof preflightBlockerSchema>;
export type PreflightWarning = z.infer<typeof preflightWarningSchema>;
export type PreflightReport = z.infer<typeof preflightReportSchema>;
