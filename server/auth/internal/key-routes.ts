/**
 * Auth module — API key admin routes (Phase 17 substrate; Phase 26 Plan 26-03
 * extends with full Zod typing on GET/DELETE, NEW POST /api/keys/:id/claims/admin
 * with requireAdmin gate, and emit.keyCreated / emit.keyRevoked invocations on
 * POST + DELETE success).
 *
 * .meta({ id: '...' }) promotes schemas into openapi.json components.schemas
 * for typed Go + web client codegen.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type {
  FastifyZodOpenApiTypeProvider,
  FastifyZodOpenApiSchema,
} from 'fastify-zod-openapi';

import { readAls } from '../../bus/helpers.js';
import type { Actor } from './actor.js';
import { requireAdmin } from './require-admin.js';

// ---------- Schemas (promoted via .meta({ id: ... }) -------------------------

const apiKeyCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(255),
    expiresAt: z.string().datetime().optional(),
  })
  .meta({
    id: 'ApiKeyCreateRequest',
    description: 'Request body for POST /api/admin/keys',
  });

const apiKeySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    rawKey: z.string(),
    prefix: z.string(),
    createdAt: z.date(),
  })
  .meta({
    id: 'ApiKey',
    description: 'Newly created API key — rawKey is returned exactly once',
  });

const apiKeyListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    prefix: z.string(),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revoked: z.boolean(),
  })
  .meta({ id: 'ApiKeyListItem' });

const apiKeyListResponseSchema = z
  .array(apiKeyListItemSchema)
  .meta({ id: 'ApiKeyListResponse' });

const apiKeyRevokeParamsSchema = z
  .object({ id: z.string().uuid() })
  .meta({ id: 'ApiKeyRevokeParams' });

const apiKeyGrantAdminParamsSchema = z
  .object({ id: z.string().uuid() })
  .meta({ id: 'ApiKeyGrantAdminParams' });

const apiKeyGrantAdminBodySchema = z
  .object({ admin: z.boolean() })
  .meta({ id: 'ApiKeyGrantAdminBody' });

const apiKeyGrantAdminResponseSchema = z
  .object({
    success: z.literal(true),
    claims: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'ApiKeyGrantAdminResponse' });

const problemJsonSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
  })
  .meta({ id: 'ProblemJson' });

// Export-for-test surface (contract.spec re-imports; route file stays the
// single source of truth at runtime).
export {
  apiKeyCreateRequestSchema,
  apiKeySchema,
  apiKeyListItemSchema,
  apiKeyListResponseSchema,
  apiKeyRevokeParamsSchema,
  apiKeyGrantAdminParamsSchema,
  apiKeyGrantAdminBodySchema,
  apiKeyGrantAdminResponseSchema,
};

// ---------- Routes -----------------------------------------------------------

export async function keyRoutes(fastify: FastifyInstance) {
  // POST /admin/keys — create new API key (Phase 17 Plan 17-01 typed).
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/admin/keys',
    schema: {
      body: apiKeyCreateRequestSchema,
      response: { 201: apiKeySchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const { name, expiresAt } = request.body;
      const result = await fastify.authService.createKey(
        name,
        expiresAt ? new Date(expiresAt) : undefined,
      );
      // Phase 26 SC1 — emit auth.key.created. actor resolves from ALS via
      // createEventHelpers automatically; createdBy payload mirrors so the
      // event row stays self-describing.
      try {
        const authModule = (fastify as { authModule?: { emit?: { keyCreated?: (id: string, payload: unknown) => void } } }).authModule;
        authModule?.emit?.keyCreated?.(result.id, {
          keyId: result.id,
          keyName: result.name,
          prefix: result.prefix,
          createdBy: ((readAls('actor') ?? 'system') as Actor),
        });
      } catch (err) {
        fastify.log.warn({ err }, 'emit.keyCreated failed (non-fatal)');
      }
      return reply.status(201).send(result);
    },
  });

  // GET /admin/keys — list keys (Phase 26 — Zod typed; lastUsedAt/expiresAt
  // serialised as ISO strings, prefix re-projected from listKeys output).
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/admin/keys',
    schema: {
      response: { 200: apiKeyListResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async () => {
      const rows = await fastify.authService.listKeys();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
        revoked: r.revoked,
      }));
    },
  });

  // DELETE /admin/keys/:id — revoke + emit auth.key.revoked on success.
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'DELETE',
    url: '/admin/keys/:id',
    schema: {
      params: apiKeyRevokeParamsSchema,
      response: { 404: problemJsonSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const params = request.params;
      const row = await fastify.authService.revokeKeyAndReturnRow(params.id);
      if (!row) {
        return reply
          .status(404)
          .type('application/problem+json')
          .send({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            detail: `API key ${params.id} not found or already revoked`,
          });
      }
      try {
        const authModule = (fastify as { authModule?: { emit?: { keyRevoked?: (id: string, payload: unknown) => void } } }).authModule;
        authModule?.emit?.keyRevoked?.(row.id, {
          keyId: row.id,
          keyName: row.name,
          revokedBy: ((readAls('actor') ?? 'system') as Actor),
        });
      } catch (err) {
        fastify.log.warn({ err }, 'emit.keyRevoked failed (non-fatal)');
      }
      return reply.status(204).send();
    },
  });

  // POST /api/keys/:id/claims/admin — DEFERRED-23-A: gated on requireAdmin.
  // Phase 28 will provide CLI surface (DEFERRED-26-A). First admin bootstrapped
  // via SQL per docs/runbooks/admin-bootstrap.md.
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/api/keys/:id/claims/admin',
    preHandler: [requireAdmin as never],
    schema: {
      params: apiKeyGrantAdminParamsSchema,
      body: apiKeyGrantAdminBodySchema,
      response: { 200: apiKeyGrantAdminResponseSchema },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request, reply) => {
      const params = request.params;
      const body = request.body;
      const claims = await fastify.authService.grantAdminClaim(params.id, body.admin);
      return reply.status(200).send({ success: true as const, claims });
    },
  });
}
