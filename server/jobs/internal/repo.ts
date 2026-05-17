/**
 * Phase 23 Plan 23-03 — Jobs module repo (single SQL source of truth).
 *
 * All jobs route handlers go through this module. The leftJoin(devices)
 * projects deviceName at the data layer, so dropping deviceName from the
 * response schema cannot accidentally regress to "show UUID" — the join is
 * always applied (DEBT-02 / CLI-05).
 *
 * Phase 23 / Plan 23-04 will move job-service.ts SQL bodies that lookup
 * jobs (findJobById equivalent) into this file. This plan adds the join
 * variant + listJobs wrapper, both used by Plan 23-04's createJobsModule
 * + Plan 23-05's drain admission.
 */
import { eq, desc, and } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';

/**
 * Shape returned by findJobById / listJobs. NOT a Zod schema — internal
 * representation. Routes parse via jobResponseSchema after mapping
 * timestamps to ISO strings (see jobRowToResponse).
 */
export interface JobRow {
  id: string;
  status: string;
  platform: 'android' | 'ios';
  deviceId: string | null;
  deviceName: string | null;             // joined from devices.name; null when deviceId null
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
}

export interface ListJobsFilters {
  status?: string;
  platform?: 'android' | 'ios';
  limit?: number;                        // default 100
  offset?: number;                       // default 0
}

/**
 * Find a single job by id with its allocated device's name joined in.
 * Returns null when no row matches.
 */
export async function findJobById(db: Database, jobId: string): Promise<JobRow | null> {
  const rows = await db
    .select({
      id: schema.jobs.id,
      status: schema.jobs.status,
      platform: schema.jobs.platform,
      deviceId: schema.jobs.deviceId,
      deviceName: schema.devices.name,    // leftJoin column — null when deviceId is null
      metadata: schema.jobs.metadata,
      createdAt: schema.jobs.createdAt,
      startedAt: schema.jobs.startedAt,
      finishedAt: schema.jobs.finishedAt,
      errorMessage: schema.jobs.errorMessage,
    })
    .from(schema.jobs)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.jobs.deviceId))
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  return (rows[0] as JobRow | undefined) ?? null;
}

/**
 * List jobs with optional filters. Same leftJoin applied so deviceName is
 * always populated (DEBT-02 single source of truth).
 */
export async function listJobs(db: Database, filters: ListJobsFilters = {}): Promise<JobRow[]> {
  const where = [];
  if (filters.status) where.push(eq(schema.jobs.status, filters.status as never));
  if (filters.platform) where.push(eq(schema.jobs.platform, filters.platform));
  const whereClause = where.length > 0 ? and(...where) : undefined;

  const rows = await db
    .select({
      id: schema.jobs.id,
      status: schema.jobs.status,
      platform: schema.jobs.platform,
      deviceId: schema.jobs.deviceId,
      deviceName: schema.devices.name,
      metadata: schema.jobs.metadata,
      createdAt: schema.jobs.createdAt,
      startedAt: schema.jobs.startedAt,
      finishedAt: schema.jobs.finishedAt,
      errorMessage: schema.jobs.errorMessage,
    })
    .from(schema.jobs)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.jobs.deviceId))
    .where(whereClause as never)
    .orderBy(desc(schema.jobs.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
  return rows as JobRow[];
}

/**
 * Maps an internal JobRow to the API response shape (timestamps → ISO).
 * Called by routes (Plan 23-04) before jobResponseSchema.parse.
 */
export function jobRowToResponse(row: JobRow): {
  id: string;
  status: string;
  platform: 'android' | 'ios';
  deviceId: string | null;
  deviceName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
} {
  return {
    id: row.id,
    status: row.status,
    platform: row.platform,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    errorMessage: row.errorMessage,
  };
}
