/**
 * Auth module — Zod schema contract spec (Plan 26-03).
 *
 * No DB. No HTTP server. Pure Zod schema parse correctness — proves the route
 * schemas reject malformed inputs and accept valid ones. .meta({ id: ... })
 * promotion to OpenAPI components.schemas is exercised at runtime when
 * fastify-zod-openapi serialises the routes; verified at build time by
 * `npm run openapi:generate` (gated on DB availability — Plan 26-04 owns).
 *
 * Schemas are imported from the route file (single source of truth) so a
 * schema-shape drift in key-routes.ts fails this spec immediately.
 */
import { describe, it, expect } from 'vitest';

import {
  apiKeyCreateRequestSchema,
  apiKeyListItemSchema,
  apiKeyListResponseSchema,
  apiKeyRevokeParamsSchema,
  apiKeyGrantAdminParamsSchema,
  apiKeyGrantAdminBodySchema,
  apiKeyGrantAdminResponseSchema,
} from '../internal/key-routes.js';

describe('Phase 26 — auth route contract schemas (no DB)', () => {
  describe('apiKeyCreateRequestSchema', () => {
    it('accepts {name: "valid"}', () => {
      expect(() => apiKeyCreateRequestSchema.parse({ name: 'my-key' })).not.toThrow();
    });
    it('rejects empty name', () => {
      expect(() => apiKeyCreateRequestSchema.parse({ name: '' })).toThrow();
    });
    it('accepts optional expiresAt ISO datetime', () => {
      expect(() =>
        apiKeyCreateRequestSchema.parse({
          name: 'k',
          expiresAt: '2030-01-01T00:00:00Z',
        }),
      ).not.toThrow();
    });
  });

  describe('apiKeyListItemSchema', () => {
    const valid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'test',
      prefix: 'df_abc12',
      createdAt: '2026-05-15T00:00:00Z',
      lastUsedAt: null,
      expiresAt: null,
      revoked: false,
    };

    it('accepts valid item', () => {
      expect(() => apiKeyListItemSchema.parse(valid)).not.toThrow();
    });

    it('rejects missing prefix', () => {
      const { prefix: _drop, ...missing } = valid;
      void _drop;
      expect(() => apiKeyListItemSchema.parse(missing)).toThrow();
    });

    it('rejects non-uuid id', () => {
      expect(() => apiKeyListItemSchema.parse({ ...valid, id: 'not-a-uuid' })).toThrow();
    });
  });

  describe('apiKeyListResponseSchema', () => {
    it('accepts empty array', () => {
      expect(() => apiKeyListResponseSchema.parse([])).not.toThrow();
    });
    it('rejects array containing invalid item', () => {
      expect(() => apiKeyListResponseSchema.parse([{ bogus: 'field' }])).toThrow();
    });
  });

  describe('apiKeyRevokeParamsSchema', () => {
    it('accepts uuid', () => {
      expect(() =>
        apiKeyRevokeParamsSchema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' }),
      ).not.toThrow();
    });
    it('rejects non-uuid id', () => {
      expect(() => apiKeyRevokeParamsSchema.parse({ id: 'not-a-uuid' })).toThrow();
    });
  });

  describe('apiKeyGrantAdminParamsSchema', () => {
    it('accepts uuid id', () => {
      expect(() =>
        apiKeyGrantAdminParamsSchema.parse({
          id: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).not.toThrow();
    });
  });

  describe('apiKeyGrantAdminBodySchema', () => {
    it('accepts {admin: true}', () => {
      expect(() => apiKeyGrantAdminBodySchema.parse({ admin: true })).not.toThrow();
    });
    it('accepts {admin: false}', () => {
      expect(() => apiKeyGrantAdminBodySchema.parse({ admin: false })).not.toThrow();
    });
    it('rejects string "true" (must be boolean)', () => {
      expect(() => apiKeyGrantAdminBodySchema.parse({ admin: 'true' })).toThrow();
    });
  });

  describe('apiKeyGrantAdminResponseSchema', () => {
    it('accepts {success: true, claims: {...}}', () => {
      expect(() =>
        apiKeyGrantAdminResponseSchema.parse({
          success: true,
          claims: { admin: true },
        }),
      ).not.toThrow();
    });
    it('rejects success: false (literal true required)', () => {
      expect(() =>
        apiKeyGrantAdminResponseSchema.parse({ success: false, claims: {} }),
      ).toThrow();
    });
  });
});
