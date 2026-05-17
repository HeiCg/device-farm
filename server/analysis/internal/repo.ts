/**
 * Phase 37 Plan 37-01 — analysis repo (Drizzle CRUD).
 *
 * Single source of truth for `analyses` table reads/writes. Mirror shape:
 * server/jobs/internal/repo.ts.
 */

import { desc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import type { SkeletonPayload } from '../schemas.js';

export interface CreateAnalysisInput {
  jobId: string | null;
  buildArtifactId: string | null;
  platform: 'android' | 'ios';
  payload: SkeletonPayload;
}

export interface AnalysisRow {
  id: string;
  jobId: string | null;
  buildArtifactId: string | null;
  platform: 'android' | 'ios';
  payload: SkeletonPayload;
  createdAt: Date;
}

/** INSERT analyses row; returns the new id. */
export async function create(
  db: Database,
  input: CreateAnalysisInput,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.analyses)
    .values({
      jobId: input.jobId,
      buildArtifactId: input.buildArtifactId,
      platform: input.platform,
      payload: input.payload as unknown,
    })
    .returning({ id: schema.analyses.id });
  if (!row?.id) {
    throw new Error('analyses INSERT returned no row');
  }
  return { id: row.id };
}

/**
 * Fetch the most recent analysis for a given job/build identifier. Pass
 * the build id (which is the jobId in v3.0) — Plan 37-01 reuses jobs.id
 * as the build identifier since build_artifacts is not yet a first-class
 * table.
 */
export async function getByJobId(
  db: Database,
  jobId: string,
): Promise<AnalysisRow | null> {
  const rows = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.jobId, jobId))
    .orderBy(desc(schema.analyses.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    jobId: r.jobId,
    buildArtifactId: r.buildArtifactId,
    platform: r.platform as 'android' | 'ios',
    payload: r.payload as SkeletonPayload,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string),
  };
}

/** Lookup by analysis id. Used by the GET /api/analyses/:id route variant. */
export async function getById(
  db: Database,
  id: string,
): Promise<AnalysisRow | null> {
  const rows = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    jobId: r.jobId,
    buildArtifactId: r.buildArtifactId,
    platform: r.platform as 'android' | 'ios',
    payload: r.payload as SkeletonPayload,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string),
  };
}
