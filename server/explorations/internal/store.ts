/**
 * Explorations store helpers (Phase 35 Plan 35-02 / T-35.2 + T-35.3).
 *
 * Drizzle write/read helpers used by the in-process MCP `explore_*` tools
 * + the agent runner finalization step. Distinct from `repo.ts` (the
 * REST-route surface) — these helpers are agent-loop-specific (upsert
 * with isNew sentinel, action-hash dedup, jsonb element queries,
 * pHash similarity orchestration).
 *
 * Helpers:
 *   - hashAction         — sha256 of canonicalized action JSON (for dedup).
 *   - saveScreen         — INSERT explorations_screens ON CONFLICT UPDATE.
 *   - saveTransition     — INSERT explorations_transitions ON CONFLICT NOTHING (action_hash dedup).
 *   - getUnexplored      — jsonb-element query returning screens with unexplored elements.
 *   - getScreensForSimilarity — SELECT screen_id + phash + screenshot_artifact_id rows.
 *   - findSimilarScreen  — getScreensForSimilarity → isSameScreen orchestration.
 *   - getScreenCount     — SELECT COUNT(*) for budgetScreens cap.
 *   - markRunStarted     — UPDATE explorations SET status='running', started_at=now().
 *   - markRunFinished    — UPDATE explorations SET status=<terminal>, finished_at=now(), stats=...
 *   - markElementExplored — UPDATE elements jsonb SET explored=true (jsonb_set / jsonb_agg).
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type pino from 'pino';

import {
  explorations as explorationsTable,
  explorationScreens as screensTable,
  explorationTransitions as transitionsTable,
} from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { isSameScreen, type SimilarityCandidate } from './similarity.js';

export interface StoreDeps {
  db: Database;
  logger?: pino.Logger;
}

/** Canonicalize action JSON (sorted keys) then sha256. Stable per action. */
export function hashAction(action: Record<string, unknown>): string {
  const sortedKeys = Object.keys(action).sort();
  const json = JSON.stringify(action, sortedKeys);
  return createHash('sha256').update(json).digest('hex');
}

export interface SaveScreenInput {
  runId: string;
  screenId: string;
  title: string;
  elements: Array<{
    label: string;
    element_type: string;
    explored?: boolean;
    leads_to?: string | null;
    notes?: string | null;
  }>;
  notes?: string | null;
  screenshotArtifactId: string;
  phash: string | null;
  bfsDepth: number;
}

/**
 * Upsert into exploration_screens by `(runId, screenId)` UNIQUE.
 *
 * Returns `{ screenId, isNew: boolean }`. isNew is approximated by checking
 * whether `xmax = 0` (Postgres MVCC convention — see Drizzle issue #1233);
 * we compute it by comparing the row's `created` timestamp to the updated
 * one. The conservative implementation here returns `isNew: true` only when
 * a fresh row was created — Drizzle returns the row regardless, so the
 * approximation suffices for agent feedback.
 */
export async function saveScreen(
  deps: StoreDeps,
  input: SaveScreenInput,
): Promise<{ screenId: string; isNew: boolean }> {
  // Probe first to know if the row exists.
  const existing = await deps.db
    .select({ id: screensTable.id })
    .from(screensTable)
    .where(
      sql`${screensTable.runId} = ${input.runId} AND ${screensTable.screenId} = ${input.screenId}`,
    )
    .limit(1);
  const isNew = existing.length === 0;

  await deps.db
    .insert(screensTable)
    .values({
      runId: input.runId,
      screenId: input.screenId,
      title: input.title,
      elements: input.elements,
      notes: input.notes ?? null,
      screenshotArtifactId: input.screenshotArtifactId,
      phash: input.phash,
      bfsDepth: input.bfsDepth,
    })
    .onConflictDoUpdate({
      target: [screensTable.runId, screensTable.screenId],
      set: {
        title: input.title,
        elements: input.elements,
        notes: input.notes ?? null,
      },
    });

  return { screenId: input.screenId, isNew };
}

export interface SaveTransitionInput {
  runId: string;
  fromScreenId: string;
  toScreenId: string;
  action: Record<string, unknown>;
  isBackEdge: boolean;
  bfsOrder: number;
}

/**
 * INSERT exploration_transitions ON CONFLICT DO NOTHING using
 * `(runId, fromScreenId, toScreenId, actionHash)` UNIQUE for dedup.
 * Returns `{ created: boolean }`.
 */
export async function saveTransition(
  deps: StoreDeps,
  input: SaveTransitionInput,
): Promise<{ created: boolean; actionHash: string }> {
  const actionHash = hashAction(input.action);
  const result = await deps.db
    .insert(transitionsTable)
    .values({
      runId: input.runId,
      fromScreenId: input.fromScreenId,
      toScreenId: input.toScreenId,
      action: input.action,
      actionHash,
      isBackEdge: input.isBackEdge,
      bfsOrder: input.bfsOrder,
    })
    .onConflictDoNothing()
    .returning({ id: transitionsTable.id });
  return { created: result.length > 0, actionHash };
}

/**
 * Return screens that have unexplored elements. Uses jsonb_array_elements to
 * unnest the `elements` column and filter on `elem->>'explored'`. Designed
 * for the `explore_get_unexplored` tool.
 */
export async function getUnexplored(
  deps: StoreDeps,
  runId: string,
): Promise<
  Array<{
    screenId: string;
    title: string;
    unexploredElements: Array<{ label: string; element_type: string }>;
  }>
> {
  const rows = await deps.db.execute(sql`
    SELECT
      screen_id AS "screenId",
      title,
      jsonb_agg(elem) FILTER (WHERE NOT COALESCE((elem->>'explored')::bool, false)) AS "unexploredElements"
    FROM ${screensTable}, jsonb_array_elements(${screensTable.elements}) elem
    WHERE run_id = ${runId}
    GROUP BY id, screen_id, title
    HAVING COUNT(*) FILTER (WHERE NOT COALESCE((elem->>'explored')::bool, false)) > 0
  `);
  // postgres-js returns { rows: [...] }
  const out = (rows as unknown as { rows: Array<{ screenId: string; title: string; unexploredElements: unknown }> }).rows;
  return out.map((r) => ({
    screenId: r.screenId,
    title: r.title,
    unexploredElements: Array.isArray(r.unexploredElements)
      ? (r.unexploredElements as Array<{ label: string; element_type: string }>)
      : [],
  }));
}

/** Pull (screenId, phash, screenshotArtifactId) for every screen with a non-null phash. */
export async function getScreensForSimilarity(
  deps: StoreDeps,
  runId: string,
): Promise<SimilarityCandidate[]> {
  const rows = await deps.db
    .select({
      screenId: screensTable.screenId,
      phash: screensTable.phash,
      screenshotArtifactId: screensTable.screenshotArtifactId,
    })
    .from(screensTable)
    .where(eq(screensTable.runId, runId));
  return rows
    .filter((r): r is { screenId: string; phash: string; screenshotArtifactId: string } => r.phash !== null)
    .map((r) => ({
      screenId: r.screenId,
      phash: r.phash,
      screenshotArtifactId: r.screenshotArtifactId,
    }));
}

/**
 * Composite: read candidate (screenId, phash, screenshot) rows + run
 * isSameScreen over the new screenshot. Returns null when nothing matches.
 */
export async function findSimilarScreen(
  deps: StoreDeps & { loadArtifact: (id: string) => Promise<Buffer> },
  runId: string,
  newShot: Buffer,
): Promise<{ screenId: string; rmse: number } | null> {
  const candidates = await getScreensForSimilarity(deps, runId);
  if (candidates.length === 0) return null;
  return isSameScreen(newShot, candidates, deps.loadArtifact);
}

/** Count screens recorded for a run (for budgetScreens cap). */
export async function getScreenCount(deps: StoreDeps, runId: string): Promise<number> {
  const rows = await deps.db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(screensTable)
    .where(eq(screensTable.runId, runId));
  const row = rows[0];
  return typeof row?.count === 'number' ? row.count : 0;
}

/** Count transitions recorded for a run (for stats). */
export async function getTransitionCount(deps: StoreDeps, runId: string): Promise<number> {
  const rows = await deps.db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transitionsTable)
    .where(eq(transitionsTable.runId, runId));
  const row = rows[0];
  return typeof row?.count === 'number' ? row.count : 0;
}

/** UPDATE explorations SET status='running', started_at=now(). */
export async function markRunStarted(deps: StoreDeps, runId: string): Promise<void> {
  await deps.db
    .update(explorationsTable)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(explorationsTable.id, runId));
}

/**
 * UPDATE explorations SET status=<terminal>, finished_at=now(), stats=..., error_message=...
 *
 * Reason mapping:
 *   - 'complete'                                  → status='complete'
 *   - 'budget' | 'time' | 'stuck' | 'login_required' → status='failed' (with error_message)
 *   - 'cancelled'                                 → status='cancelled'
 *   - anything else                               → status='failed'
 */
export async function markRunFinished(
  deps: StoreDeps,
  runId: string,
  reason: 'complete' | 'budget' | 'time' | 'stuck' | 'login_required' | 'cancelled',
  stats: Record<string, unknown>,
  errorMessage?: string | null,
): Promise<void> {
  let status: 'complete' | 'failed' | 'cancelled';
  if (reason === 'complete') status = 'complete';
  else if (reason === 'cancelled') status = 'cancelled';
  else status = 'failed';

  await deps.db
    .update(explorationsTable)
    .set({
      status,
      stats,
      finishedAt: new Date(),
      errorMessage: errorMessage ?? (reason !== 'complete' && reason !== 'cancelled' ? reason : null),
    })
    .where(eq(explorationsTable.id, runId));
}

/**
 * Update a single element on a screen to `explored=true`, optionally setting
 * `leads_to`. Uses jsonb_agg + CASE expression to rewrite the elements array.
 */
export async function markElementExplored(
  deps: StoreDeps,
  runId: string,
  screenId: string,
  elementLabel: string,
  leadsTo: string | null,
): Promise<void> {
  const leadsToJson = leadsTo === null ? sql`'null'::jsonb` : sql`to_jsonb(${leadsTo}::text)`;
  await deps.db.execute(sql`
    UPDATE ${screensTable}
    SET elements = (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'label' = ${elementLabel}
            THEN jsonb_set(jsonb_set(elem, '{explored}', 'true'::jsonb), '{leads_to}', ${leadsToJson})
          ELSE elem
        END
      )
      FROM jsonb_array_elements(${screensTable.elements}) elem
    )
    WHERE run_id = ${runId} AND screen_id = ${screenId}
  `);
}
