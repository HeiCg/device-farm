/**
 * Explorations module repo — Drizzle helpers with Zod row decoders (SPEC-04).
 *
 * Phase 35 Plan 35-01. ALL read paths apply `explorationRowSchema.parse(row)` /
 * `explorationScreenRowSchema.parse(row)` / `explorationTransitionRowSchema.parse(row)`
 * so a DB shape regression surfaces as a ZodError at boundary rather than
 * polluting downstream consumers (CLI / web / agent).
 *
 * Helpers:
 *   - insertExplorationRow — INSERT + returning + parse
 *   - getExploration       — SELECT by id + parse, null on not-found
 *   - getScreens           — SELECT by runId, ordered by bfsDepth then visitedAt
 *   - getTransitions       — SELECT by runId, ordered by bfsOrder
 *   - cancelExploration    — UPDATE status='cancelled' WHERE status='running'
 *                            (returns boolean — true when row mutated)
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type pino from 'pino';

import {
  explorations as explorationsTable,
  explorationScreens as screensTable,
  explorationTransitions as transitionsTable,
} from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import {
  explorationRowSchema,
  explorationScreenRowSchema,
  explorationTransitionRowSchema,
  type Exploration,
  type ExplorationScreen,
  type ExplorationTransition,
} from '../schemas.js';

export interface RepoDeps {
  db: Database;
  logger?: pino.Logger;
}

export interface InsertExplorationFields {
  deviceId: string;
  sessionId: string;
  appArtifactId: string;
  bundleId: string;
  platform: 'android' | 'ios';
  budgetTaps: number;
  budgetScreens: number;
  budgetSeconds: number;
  config: Record<string, unknown>;
  ownerApiKeyId?: string | null;
  ownerActor?: string | null;
}

/** INSERT explorations row, return Zod-validated typed row. */
export async function insertExplorationRow(
  deps: RepoDeps,
  fields: InsertExplorationFields,
): Promise<Exploration> {
  const [row] = await deps.db
    .insert(explorationsTable)
    .values({
      deviceId: fields.deviceId,
      sessionId: fields.sessionId,
      appArtifactId: fields.appArtifactId,
      bundleId: fields.bundleId,
      platform: fields.platform,
      status: 'queued',
      budgetTaps: fields.budgetTaps,
      budgetScreens: fields.budgetScreens,
      budgetSeconds: fields.budgetSeconds,
      config: fields.config,
      ownerApiKeyId: fields.ownerApiKeyId ?? null,
      ownerActor: fields.ownerActor ?? null,
    })
    .returning();
  return explorationRowSchema.parse(row);
}

export interface ExplorationListItem {
  id: string;
  bundleId: string;
  platform: 'android' | 'ios';
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  deviceId: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  screensCount: number;
}

/**
 * Phase 35 Plan 35-05 — list explorations for the dashboard list route.
 *
 * Ordered by `createdAt DESC` (most recent first). LEFT JOIN aggregates
 * `screens_count` as `count(exploration_screens.id)` so the list page
 * can render "12 screens" without a per-row fan-out fetch.
 *
 * Bounded to 100 rows — there's no pagination UI in Phase 35 (deferred
 * to a future phase that adds DataGrid).
 */
export async function listExplorations(
  deps: RepoDeps,
  opts: { limit?: number } = {},
): Promise<ExplorationListItem[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = await deps.db
    .select({
      id: explorationsTable.id,
      bundleId: explorationsTable.bundleId,
      platform: explorationsTable.platform,
      status: explorationsTable.status,
      deviceId: explorationsTable.deviceId,
      createdAt: explorationsTable.createdAt,
      startedAt: explorationsTable.startedAt,
      finishedAt: explorationsTable.finishedAt,
      screensCount: sql<number>`count(${screensTable.id})::int`,
    })
    .from(explorationsTable)
    .leftJoin(screensTable, eq(screensTable.runId, explorationsTable.id))
    .groupBy(explorationsTable.id)
    .orderBy(desc(explorationsTable.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    bundleId: r.bundleId,
    platform: r.platform as 'android' | 'ios',
    status: r.status as ExplorationListItem['status'],
    deviceId: r.deviceId,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string),
    startedAt: r.startedAt
      ? r.startedAt instanceof Date
        ? r.startedAt
        : new Date(r.startedAt as string)
      : null,
    finishedAt: r.finishedAt
      ? r.finishedAt instanceof Date
        ? r.finishedAt
        : new Date(r.finishedAt as string)
      : null,
    screensCount: Number(r.screensCount ?? 0),
  }));
}

/** SELECT exploration row by id. Returns null when not found. */
export async function getExploration(
  deps: RepoDeps,
  id: string,
): Promise<Exploration | null> {
  const rows = await deps.db
    .select()
    .from(explorationsTable)
    .where(eq(explorationsTable.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return explorationRowSchema.parse(rows[0]);
}

/** SELECT all screens for a run, ordered by bfsDepth then visitedAt. */
export async function getScreens(
  deps: RepoDeps,
  runId: string,
): Promise<ExplorationScreen[]> {
  const rows = await deps.db
    .select()
    .from(screensTable)
    .where(eq(screensTable.runId, runId))
    .orderBy(screensTable.bfsDepth, screensTable.visitedAt);
  return rows.map((r) => explorationScreenRowSchema.parse(r));
}

/** SELECT all transitions for a run, ordered by bfsOrder. */
export async function getTransitions(
  deps: RepoDeps,
  runId: string,
): Promise<ExplorationTransition[]> {
  const rows = await deps.db
    .select()
    .from(transitionsTable)
    .where(eq(transitionsTable.runId, runId))
    .orderBy(transitionsTable.bfsOrder);
  return rows.map((r) => explorationTransitionRowSchema.parse(r));
}

/**
 * UPDATE exploration status='cancelled' IFF currently 'running'.
 *
 * Returns true when a row was updated; false when the id doesn't exist OR
 * the exploration is not in the 'running' state. Routes map false → 404.
 *
 * Sets finishedAt=now() as a side effect — terminal status mirrors
 * status='complete'/'failed' bookkeeping.
 */
export async function cancelExploration(
  deps: RepoDeps,
  id: string,
): Promise<boolean> {
  const result = await deps.db
    .update(explorationsTable)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(
      and(eq(explorationsTable.id, id), eq(explorationsTable.status, 'running')),
    )
    .returning({ id: explorationsTable.id });
  return result.length > 0;
}
