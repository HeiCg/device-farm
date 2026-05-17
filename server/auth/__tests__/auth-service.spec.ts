import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../internal/auth-service.js';
import type { Database } from '../../db/index.js';

// ---- Mock DB helpers ----

function createMockDb() {
  // Insert chain: insert().values().returning()
  const mockReturning = vi.fn();
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // Update chain: update().set().where().returning()
  // For revokeKey: update().set({revoked:true}).where().returning()
  // For validateKey fire-and-forget: update().set({lastUsedAt}).where() -> thenable
  const mockUpdateReturning = vi.fn();
  const updateWhereResult = {
    returning: mockUpdateReturning,
    then: (resolve: any, reject?: any) => Promise.resolve([]).then(resolve, reject),
    catch: (fn: any) => Promise.resolve([]).catch(fn),
  };
  const mockUpdateWhere = vi.fn().mockReturnValue(updateWhereResult);
  const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  // Select chain: select().from().where()
  const mockSelectWhere = vi.fn();
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    db: {
      insert: mockInsert,
      update: mockUpdate,
      select: mockSelect,
    } as unknown as Database,
    mocks: {
      insert: mockInsert,
      values: mockValues,
      returning: mockReturning,
      update: mockUpdate,
      set: mockSet,
      updateWhere: mockUpdateWhere,
      updateReturning: mockUpdateReturning,
      select: mockSelect,
      selectFrom: mockSelectFrom,
      selectWhere: mockSelectWhere,
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new AuthService(mockDb.db);
  });

  describe('generateKey', () => {
    it('returns raw key starting with df_ prefix', () => {
      const result = service.generateKey();
      expect(result.raw).toMatch(/^df_/);
    });

    it('returns hash and salt as hex strings', () => {
      const result = service.generateKey();
      expect(result.hash).toMatch(/^[0-9a-f]+$/);
      expect(result.salt).toMatch(/^[0-9a-f]+$/);
    });

    it('returns prefix as first 8 chars of raw key', () => {
      const result = service.generateKey();
      expect(result.prefix).toBe(result.raw.substring(0, 8));
    });

    it('generates unique keys on each call', () => {
      const key1 = service.generateKey();
      const key2 = service.generateKey();
      expect(key1.raw).not.toBe(key2.raw);
    });
  });

  describe('validateKey', () => {
    it('returns true when key exists, is not revoked, and not expired', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: null,
          id: 'test-id',
        },
      ]);

      const result = await service.validateKey(keyData.raw);
      expect(result).toBe(true);
    });

    it('returns false for revoked key', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: true,
          expiresAt: null,
          id: 'test-id',
        },
      ]);

      const result = await service.validateKey(keyData.raw);
      expect(result).toBe(false);
    });

    it('returns false for expired key', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: new Date('2020-01-01'),
          id: 'test-id',
        },
      ]);

      const result = await service.validateKey(keyData.raw);
      expect(result).toBe(false);
    });

    it('returns false for non-existent key', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([]);

      const result = await service.validateKey('df_nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('createKey', () => {
    it('inserts into DB and returns key data with raw key', async () => {
      const now = new Date();
      mockDb.mocks.returning.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyPrefix: 'df_abcde',
          createdAt: now,
        },
      ]);

      const result = await service.createKey('test-key');
      expect(result).toMatchObject({
        id: 'uuid-1',
        name: 'test-key',
        prefix: 'df_abcde',
        createdAt: now,
      });
      expect(result.rawKey).toMatch(/^df_/);
    });
  });

  describe('listKeys', () => {
    it('returns keys without hash/salt but with prefix/name/timestamps', async () => {
      const now = new Date();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'key-1',
          keyPrefix: 'df_abc12',
          createdAt: now,
          lastUsedAt: null,
          expiresAt: null,
          revoked: false,
        },
      ]);

      const result = await service.listKeys();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'uuid-1',
        name: 'key-1',
        prefix: 'df_abc12',
        createdAt: now,
        lastUsedAt: null,
        expiresAt: null,
        revoked: false,
      });
      // Should NOT contain hash or salt
      expect(result[0]).not.toHaveProperty('keyHash');
      expect(result[0]).not.toHaveProperty('keySalt');
    });
  });

  describe('revokeKey', () => {
    it('sets revoked=true for existing key', async () => {
      mockDb.mocks.updateReturning.mockResolvedValueOnce([{ id: 'uuid-1' }]);

      await expect(service.revokeKey('uuid-1')).resolves.not.toThrow();
      expect(mockDb.mocks.set).toHaveBeenCalledWith({ revoked: true });
    });

    it('throws error for non-existent key', async () => {
      mockDb.mocks.updateReturning.mockResolvedValueOnce([]);

      await expect(service.revokeKey('nonexistent')).rejects.toThrow();
    });
  });

  // ---------- Phase 26 Plan 26-03 extensions (TDD) -----------------------------
  describe('validateKeyAndReturnRow (Phase 26)', () => {
    it('returns matched row {id, name, claims} on valid key', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: null,
          claims: { admin: true },
        },
      ]);

      const result = await service.validateKeyAndReturnRow(keyData.raw);
      expect(result).toEqual({
        id: 'uuid-1',
        name: 'test-key',
        claims: { admin: true },
      });
    });

    it('returns null for revoked key', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: true,
          expiresAt: null,
          claims: {},
        },
      ]);

      const result = await service.validateKeyAndReturnRow(keyData.raw);
      expect(result).toBeNull();
    });

    it('returns null for expired key', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: new Date('2020-01-01'),
          claims: {},
        },
      ]);

      const result = await service.validateKeyAndReturnRow(keyData.raw);
      expect(result).toBeNull();
    });

    it('returns null for non-existent key', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([]);

      const result = await service.validateKeyAndReturnRow('df_nonexistent');
      expect(result).toBeNull();
    });

    it('returns empty claims object when claims column is null/undefined', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: null,
          claims: null,
        },
      ]);

      const result = await service.validateKeyAndReturnRow(keyData.raw);
      expect(result).toEqual({
        id: 'uuid-1',
        name: 'test-key',
        claims: {},
      });
    });
  });

  describe('validateKey back-compat shim (Phase 26)', () => {
    it('returns true when validateKeyAndReturnRow returns row', async () => {
      const keyData = service.generateKey();
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        {
          id: 'uuid-1',
          name: 'test-key',
          keyHash: keyData.hash,
          keySalt: keyData.salt,
          revoked: false,
          expiresAt: null,
          claims: {},
        },
      ]);
      expect(await service.validateKey(keyData.raw)).toBe(true);
    });

    it('returns false when validateKeyAndReturnRow returns null', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([]);
      expect(await service.validateKey('df_missing')).toBe(false);
    });
  });

  describe('revokeKeyAndReturnRow (Phase 26)', () => {
    it('returns {id, name} and flips revoked=true on existing un-revoked key', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        { id: 'uuid-1', name: 'test-key', revoked: false },
      ]);

      const result = await service.revokeKeyAndReturnRow('uuid-1');
      expect(result).toEqual({ id: 'uuid-1', name: 'test-key' });
      expect(mockDb.mocks.set).toHaveBeenCalledWith({ revoked: true });
    });

    it('returns null for non-existent key', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([]);
      const result = await service.revokeKeyAndReturnRow('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for already-revoked key (idempotent)', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        { id: 'uuid-1', name: 'test-key', revoked: true },
      ]);
      const result = await service.revokeKeyAndReturnRow('uuid-1');
      expect(result).toBeNull();
    });
  });

  describe('grantAdminClaim (Phase 26)', () => {
    it('returns updated claims after granting admin', async () => {
      // First call (update) — returns void; second call (select) returns row.
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        { id: 'uuid-1', claims: { admin: true } },
      ]);
      const result = await service.grantAdminClaim('uuid-1', true);
      expect(result).toEqual({ admin: true });
    });

    it('returns updated claims after revoking admin (granted=false)', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([
        { id: 'uuid-1', claims: { admin: false } },
      ]);
      const result = await service.grantAdminClaim('uuid-1', false);
      expect(result).toEqual({ admin: false });
    });

    it('returns empty object when row not found post-update', async () => {
      mockDb.mocks.selectWhere.mockResolvedValueOnce([]);
      const result = await service.grantAdminClaim('uuid-missing', true);
      expect(result).toEqual({});
    });
  });
});
