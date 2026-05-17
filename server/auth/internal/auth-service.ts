import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { apiKeys } from '../../db/schema.js';

const HASH_LEN = 64;
const SALT_LEN = 16;
const KEY_LEN = 32;
const PREFIX = 'df_';

/**
 * Phase 26 — matched API key row returned by validateKeyAndReturnRow.
 * Exposes JSONB `claims` column (Phase 26 migration 0026) for downstream
 * gating (requireAdmin checks claims.admin === true).
 */
export interface MatchedApiKey {
  id: string;
  name: string;
  claims: Record<string, unknown>;
}

export class AuthService {
  constructor(private readonly db: Database) {}

  /**
   * Generate a new API key with hash, salt, and prefix.
   * Pure function -- does NOT persist to DB.
   */
  generateKey(): { raw: string; hash: string; salt: string; prefix: string } {
    const rawBytes = randomBytes(KEY_LEN);
    const raw = PREFIX + rawBytes.toString('hex');
    const salt = randomBytes(SALT_LEN).toString('hex');
    const hash = scryptSync(raw, salt, HASH_LEN).toString('hex');
    const prefix = raw.substring(0, 8);

    return { raw, hash, salt, prefix };
  }

  /**
   * Phase 26 — validateKey extension that returns the matched row {id, name,
   * claims} or null on miss. Used by the bearer-auth callback to populate
   * request.apiKey + stamp ALS actor (TRACE-10 entry point #4) AND by
   * requireAdmin middleware to gate /admin/drain + admin-claim grants
   * (DEFERRED-23-A resolution).
   *
   * Preserves existing scryptSync timing-safe compare + revoked/expiresAt
   * filters + fire-and-forget lastUsedAt update.
   */
  async validateKeyAndReturnRow(rawKey: string): Promise<MatchedApiKey | null> {
    const prefix = rawKey.substring(0, 8);
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefix));

    if (rows.length === 0) return null;

    for (const row of rows) {
      if (row.revoked) continue;
      if (row.expiresAt && row.expiresAt < new Date()) continue;

      const computedHash = scryptSync(rawKey, row.keySalt, HASH_LEN);
      const storedHash = Buffer.from(row.keyHash, 'hex');

      if (
        computedHash.length === storedHash.length &&
        timingSafeEqual(computedHash, storedHash)
      ) {
        // Fire-and-forget lastUsedAt update (preserves legacy validateKey
        // behaviour; thenable to satisfy mock-test chain shape).
        this.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, row.id))
          .then(() => {})
          .catch(() => {});

        return {
          id: row.id,
          name: row.name,
          claims: (row.claims as Record<string, unknown> | null) ?? {},
        };
      }
    }

    return null;
  }

  /**
   * Back-compat shim — kept for any consumer (jobs/routes.ts requireAuth) that
   * just needs a boolean. Plan 26-03 routes the bearer-auth callback through
   * `validateKeyAndReturnRow` so request.apiKey is decorated for TRACE-10 +
   * requireAdmin downstream.
   */
  async validateKey(rawKey: string): Promise<boolean> {
    return (await this.validateKeyAndReturnRow(rawKey)) !== null;
  }

  /**
   * Create a new API key and persist to DB.
   * Returns the raw key exactly once.
   */
  async createKey(
    name: string,
    expiresAt?: Date,
  ): Promise<{ id: string; name: string; rawKey: string; prefix: string; createdAt: Date }> {
    const { raw, hash, salt, prefix } = this.generateKey();

    const [inserted] = await this.db
      .insert(apiKeys)
      .values({
        name,
        keyHash: hash,
        keySalt: salt,
        keyPrefix: prefix,
        expiresAt: expiresAt ?? null,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    return {
      id: inserted.id,
      name: inserted.name,
      rawKey: raw,
      prefix: inserted.keyPrefix,
      createdAt: inserted.createdAt,
    };
  }

  /**
   * List all API keys WITHOUT hash/salt.
   */
  async listKeys(): Promise<
    Array<{
      id: string;
      name: string;
      prefix: string;
      createdAt: Date;
      lastUsedAt: Date | null;
      expiresAt: Date | null;
      revoked: boolean;
    }>
  > {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revoked: apiKeys.revoked,
      })
      .from(apiKeys)
      .where(eq(apiKeys.revoked, false));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.keyPrefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revoked: row.revoked,
    }));
  }

  /**
   * Revoke an API key by ID. Throws if key not found.
   */
  async revokeKey(id: string): Promise<void> {
    const result = await this.db
      .update(apiKeys)
      .set({ revoked: true })
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });

    if (result.length === 0) {
      throw new Error(`API key not found: ${id}`);
    }
  }

  /**
   * Phase 26 — revokes a key + returns the matched row (so emit.keyRevoked
   * can populate keyName payload). Idempotent: revoking an already-revoked
   * or missing key returns null without throwing.
   */
  async revokeKeyAndReturnRow(id: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    const row = rows[0];
    if (!row || row.revoked) return null;
    await this.db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, id));
    return { id: row.id, name: row.name };
  }

  /**
   * Phase 26 — DEFERRED-23-A admin-claim grant via JSONB jsonb_set. Preserves
   * any other claim keys (jsonb_set merge semantics). Pass granted=false to
   * demote. Returns the post-update `claims` row (`{}` if row missing).
   */
  async grantAdminClaim(
    apiKeyId: string,
    granted: boolean,
  ): Promise<Record<string, unknown>> {
    // jsonb_set requires the new value to be JSONB; we cast a JS boolean.
    const newValue = granted ? sql`'true'::jsonb` : sql`'false'::jsonb`;
    await this.db
      .update(apiKeys)
      .set({
        claims: sql`jsonb_set(coalesce(${apiKeys.claims}, '{}'::jsonb), '{admin}', ${newValue}, true)`,
      })
      .where(eq(apiKeys.id, apiKeyId));
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId));
    return (rows[0]?.claims as Record<string, unknown> | undefined) ?? {};
  }
}
