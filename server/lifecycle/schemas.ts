/**
 * Phase 18 / Plan 18-00 — Lifecycle module Zod source-of-truth (SPEC-01, SPEC-03).
 *
 * Declares:
 *   - lifecycleJobPayloadSchema — queue payload shape (QUEUE-06: validated both sides).
 *   - compressionResultSchema / retentionResultSchema / diskPressureResultSchema — task results.
 *   - Inferred TS types for each (z.infer).
 *
 * The task body interfaces in compression-task.ts / retention-task.ts /
 * disk-pressure-task.ts are preserved for back-compat; these Zod shapes are
 * the parse-at-boundary source-of-truth per SPEC-02 (events.ts + queue.ts
 * will import from here).
 */
import { z } from 'zod';

// ---------- Queue payload ----------

/**
 * Payload enqueued on every lifecycle.*.daily/hourly fire.
 *
 * Kind-tag is currently informational (the queue name already disambiguates
 * which task runs). Included so consumer-side logs can filter by task without
 * parsing the queue name.
 */
export const lifecycleJobPayloadSchema = z.object({
  kind: z.enum(['compression', 'retention', 'disk-pressure']),
  triggeredAt: z.string().datetime(),
});

export type LifecycleJobPayload = z.infer<typeof lifecycleJobPayloadSchema>;

// ---------- Task result schemas ----------
// These mirror the existing TS interfaces in the three task files.
// Zod versions exist so the events.ts payloads can validate-at-boundary.

export const compressionResultSchema = z.object({
  compressed: z.number().int().nonnegative(),
  savedBytes: z.number().int().nonnegative(),
});
export type CompressionResultParsed = z.infer<typeof compressionResultSchema>;

export const retentionResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
  freedBytes: z.number().int().nonnegative(),
});
export type RetentionResultParsed = z.infer<typeof retentionResultSchema>;

export const diskPressureResultSchema = z.object({
  currentUsageBytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  freedBytes: z.number().int().nonnegative(),
});
export type DiskPressureResultParsed = z.infer<typeof diskPressureResultSchema>;
