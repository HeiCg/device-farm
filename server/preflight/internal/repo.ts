/**
 * Phase 37 Plan 37-02 — preflight_runs repository (Drizzle).
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import type { RuleFinding } from './rules/types.js';

export interface CreatePreflightRunInput {
  platform: 'ios' | 'android';
  filename: string;
  fileSizeBytes: number;
  rulesVersion: string;
  status: 'pass' | 'pass_with_warnings' | 'blocked';
  blockers: RuleFinding[];
  warnings: RuleFinding[];
}

export interface PreflightRunRow {
  id: string;
  platform: 'ios' | 'android';
  filename: string;
  fileSizeBytes: number;
  rulesVersion: string;
  status: string;
  blockers: unknown;
  warnings: unknown;
  createdAt: Date;
}

export interface PreflightRepo {
  create(input: CreatePreflightRunInput): Promise<PreflightRunRow>;
  getById(id: string): Promise<PreflightRunRow | null>;
  listRecent(limit?: number): Promise<PreflightRunRow[]>;
}

export function createRepo(db: Database): PreflightRepo {
  return {
    async create(input) {
      const rows = await db
        .insert(schema.preflightRuns)
        .values({
          platform: input.platform,
          filename: input.filename,
          fileSizeBytes: input.fileSizeBytes,
          rulesVersion: input.rulesVersion,
          status: input.status,
          blockers: input.blockers as unknown,
          warnings: input.warnings as unknown,
        })
        .returning();
      const row = rows[0];
      return mapRow(row);
    },
    async getById(id) {
      const rows = await db
        .select()
        .from(schema.preflightRuns)
        .where(eq(schema.preflightRuns.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      return mapRow(rows[0]);
    },
    async listRecent(limit = 50) {
      const rows = await db
        .select()
        .from(schema.preflightRuns)
        .orderBy(desc(schema.preflightRuns.createdAt))
        .limit(limit);
      return rows.map(mapRow);
    },
  };
}

function mapRow(row: typeof schema.preflightRuns.$inferSelect): PreflightRunRow {
  return {
    id: row.id,
    platform: row.platform as 'ios' | 'android',
    filename: row.filename,
    fileSizeBytes: Number(row.fileSizeBytes),
    rulesVersion: row.rulesVersion,
    status: row.status,
    blockers: row.blockers,
    warnings: row.warnings,
    createdAt: row.createdAt,
  };
}
