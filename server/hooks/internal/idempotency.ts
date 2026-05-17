/**
 * Phase 16 / Plan 16-01 — Idempotency claim helper (EVENTS-06).
 *
 * `claimOperationKey` attempts to INSERT a row into `hook_runs` with the supplied
 * operationKey. If the row already exists (replay), `ON CONFLICT DO NOTHING` skips
 * the insert and `.returning()` returns `[]`. The caller treats zero-length return
 * as "replay detected — skip the hook run".
 *
 * Confirmed Drizzle behaviour (RESEARCH §Pitfall 2): .returning() on
 * onConflictDoNothing returns [] on conflict-skipped insert, [row] on fresh insert.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { hookRuns } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';

/**
 * Union the two Drizzle DB variants used in the codebase. Phase 15 plan 15-01
 * uses postgres-js driver; node-postgres is left in the union in case a sub-call
 * site reaches here with the other driver.
 */
export type DrizzleDb =
  | PostgresJsDatabase<typeof schema>
  | NodePgDatabase<typeof schema>;

export interface ClaimResult {
  claimed: boolean;
  operationKey: string;
}

export function buildOperationKey(triggerEventId: string, hookName: string): string {
  return `${triggerEventId}:${hookName}`;
}

export async function claimOperationKey(
  db: DrizzleDb,
  row: {
    operationKey: string;
    hookName: string;
    eventId: string;
  },
): Promise<ClaimResult> {
  const [inserted] = await db
    .insert(hookRuns)
    .values({
      operationKey: row.operationKey,
      hookName: row.hookName,
      eventId: row.eventId,
      status: 'running',
    })
    .onConflictDoNothing({ target: hookRuns.operationKey })
    .returning({ operationKey: hookRuns.operationKey });

  return { claimed: !!inserted, operationKey: row.operationKey };
}

export async function markHookRunStatus(
  db: DrizzleDb,
  operationKey: string,
  status: 'completed' | 'failed',
  opts: { exitCode?: number | null; durationMs: number },
): Promise<void> {
  await db.update(hookRuns)
    .set({
      status,
      exitCode: opts.exitCode ?? null,
      durationMs: opts.durationMs,
    })
    .where(eq(hookRuns.operationKey, operationKey));
}
