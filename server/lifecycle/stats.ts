/**
 * Phase 18 / Plan 18-02 — Lifecycle module stats interface extraction.
 *
 * `LifecycleStats` was originally declared inline in server/lifecycle/lifecycle-plugin.ts
 * (lines 9-13). Plan 18-02 extracted it into this standalone file so both the
 * queue.ts registration factory AND the plan-18-03 module factory /
 * plugin.ts can import the same type without duplicate declarations. Plan 18-03
 * deleted `lifecycle-plugin.ts` — this file is now the single source of truth.
 */
import type { CompressionResult } from './compression-task.js';
import type { RetentionResult } from './retention-task.js';
import type { DiskPressureResult } from './disk-pressure-task.js';

export interface LifecycleStats {
  lastCompressionRun: { timestamp: string; result: CompressionResult } | null;
  lastRetentionRun: { timestamp: string; result: RetentionResult } | null;
  lastDiskCheck: { timestamp: string; result: DiskPressureResult } | null;
}
