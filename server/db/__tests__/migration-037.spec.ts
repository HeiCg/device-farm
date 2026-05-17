/**
 * Phase 37 Plan 37-00 — migration 0011 introspection spec (DB-gated).
 *
 * Proves migration `0011_phase37_analyses_preflight_github.sql` applies all
 * three schema deltas to the live test DB:
 *   1. pipeline_runs has 6 new github_pr_* columns + composite partial index
 *   2. analyses table exists with the documented columns + FK + indexes
 *   3. preflight_runs table exists with the documented columns + indexes
 *
 * Skipped when TEST_DATABASE_URL/DATABASE_URL unset (matches the existing
 * DB-gated pattern from server/auth/__tests__/subscriber.spec.ts).
 *
 * Wave 1 (Plan 37-01..04) consumes these tables — this spec catches any
 * accidental schema drift before Wave 1 lands.
 */
import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB =
  typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn(
    '[db/migration-037.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run',
  );
}

describe.skipIf(!HAS_DB)(
  '[Phase 37-00] migration 0011 introspection (DB-gated)',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const client = postgres(TEST_DATABASE_URL!, { max: 2 });
    const db = drizzle(client);

    it('analyses table exists with expected columns', async () => {
      const cols = await db.execute<{ column_name: string; data_type: string }>(
        sql`SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'analyses'`,
      );
      const names = cols.map((c) => c.column_name).sort();
      expect(names).toEqual(
        ['build_artifact_id', 'created_at', 'id', 'job_id', 'payload', 'platform'].sort(),
      );
    });

    it('preflight_runs table exists with expected columns', async () => {
      const cols = await db.execute<{ column_name: string; data_type: string }>(
        sql`SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'preflight_runs'`,
      );
      const names = cols.map((c) => c.column_name).sort();
      expect(names).toEqual(
        [
          'blockers', 'created_at', 'file_size_bytes', 'filename', 'id',
          'platform', 'rules_version', 'status', 'warnings',
        ].sort(),
      );
    });

    it('pipeline_runs has 6 new github_pr_* columns', async () => {
      const cols = await db.execute<{ column_name: string }>(
        sql`SELECT column_name FROM information_schema.columns
            WHERE table_name = 'pipeline_runs'
              AND column_name LIKE 'github\\_%' ESCAPE '\\'`,
      );
      const names = cols.map((c) => c.column_name).sort();
      expect(names).toEqual(
        [
          'github_installation_id', 'github_pr_comment_id', 'github_pr_id',
          'github_pr_url', 'github_repo_name', 'github_repo_owner',
        ].sort(),
      );
    });

    it('pipeline_runs_github_pr_idx partial index exists', async () => {
      const rows = await db.execute<{ indexname: string }>(
        sql`SELECT indexname FROM pg_indexes
            WHERE tablename = 'pipeline_runs'
              AND indexname = 'pipeline_runs_github_pr_idx'`,
      );
      expect(rows.length).toBe(1);
    });

    it('analyses.job_id has ON DELETE SET NULL FK', async () => {
      const rows = await db.execute<{ delete_rule: string }>(
        sql`SELECT rc.delete_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.table_constraints tc
              ON rc.constraint_name = tc.constraint_name
            WHERE tc.table_name = 'analyses'
              AND tc.constraint_type = 'FOREIGN KEY'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.map((r) => r.delete_rule)).toContain('SET NULL');
    });

    afterAll(async () => {
      await client.end();
    });
  },
);
