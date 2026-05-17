import { createReadStream } from 'node:fs';
import { access, constants, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FastifyZodOpenApiTypeProvider, FastifyZodOpenApiSchema } from 'fastify-zod-openapi';
import { z } from 'zod';
import yaml from 'js-yaml';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createHttpError } from './error-handler.js';
import { listJobsQuerySchema } from './validation.js';
import { jobSummarySchema } from '../jobs/schemas.js';
import { bootOptionsSchema, type BootOptionsInput } from '../config/schema.js';
import { deviceListSchema } from '../pool/schemas.js';
import { artifactListSchema } from '../artifacts/schemas.js';
import {
  encodeCursor,
  buildCursorWhere,
  buildMetadataFilters,
  buildMetadataSQL,
  buildPaginatedResponse,
  type CursorData,
} from './pagination.js';

/**
 * Job-related routes: POST/GET/DELETE /jobs, /jobs/:id, /jobs/:id/logs, /jobs/:id/artifacts
 */
export async function jobRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /jobs - Create a new job via multipart upload.
   * Files: YAML flow files
   * Fields: metadata (JSON string), platform (string)
   */
  /**
   * Phase 17 Plan 17-01 — POST /api/jobs upgraded to withTypeProvider.
   *
   * Multipart body stays permissive (no Zod `body` schema) per
   * fastify-zod-openapi convention + Step E of 17-01-PLAN Task 2 —
   * request fields are still parsed via `request.parts()` below.
   * Only the response schema is Zod-validated for components.schemas.JobSummary.
   */
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'POST',
    url: '/jobs',
    schema: {
      description: 'Create a new job via multipart upload (flows + metadata + optional APK). Request body is multipart/form-data — not Zod-modelled per fastify-zod-openapi convention.',
      response: {
        201: jobSummarySchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
    const files: Array<{ filename: string; content: string }> = [];
    let metadata: Record<string, unknown> = {};
    let platform = '';
    let env: Record<string, string> | undefined;
    let apkPath: string | undefined;
    let filePaths: string[] | undefined;
    let bootOptions: BootOptionsInput | undefined;

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'apk') {
            // Save APK to temp directory
            const buf = await part.toBuffer();
            const apkDir = '/tmp/device-farm/apks';
            await mkdir(apkDir, { recursive: true });
            // Use a temp name; will be renamed after job ID is known
            const tempName = `upload-${Date.now()}-${part.filename}`;
            apkPath = join(apkDir, tempName);
            await writeFile(apkPath, buf);
          } else {
            const buf = await part.toBuffer();
            const content = buf.toString('utf-8');
            // Validate YAML syntax (Maestro flows use multi-document YAML with --- separators)
            try {
              yaml.loadAll(content);
            } catch {
              throw createHttpError(400, `Invalid YAML in file: ${part.filename}`, 'VALIDATION_ERROR');
            }
            files.push({ filename: part.filename, content });
          }
        } else {
          // Field part
          if (part.fieldname === 'metadata') {
            try {
              metadata = JSON.parse(part.value as string);
            } catch {
              throw createHttpError(400, 'Invalid JSON in metadata field', 'VALIDATION_ERROR');
            }
          } else if (part.fieldname === 'platform') {
            platform = part.value as string;
          } else if (part.fieldname === 'env') {
            try {
              env = JSON.parse(part.value as string);
            } catch {
              throw createHttpError(400, 'Invalid JSON in env field', 'VALIDATION_ERROR');
            }
          } else if (part.fieldname === 'filePaths') {
            try {
              filePaths = JSON.parse(part.value as string);
            } catch {
              throw createHttpError(400, 'Invalid JSON in filePaths field', 'VALIDATION_ERROR');
            }
          } else if (part.fieldname === 'boot_options') {
            // Phase 31 / Plan 31-03 / SC3 — per-job emulator boot options.
            let raw: unknown;
            try {
              raw = JSON.parse(part.value as string);
            } catch {
              throw createHttpError(400, 'Invalid JSON in boot_options field', 'VALIDATION_ERROR');
            }
            try {
              bootOptions = bootOptionsSchema.parse(raw);
            } catch {
              throw createHttpError(400, 'Invalid shape in boot_options field', 'VALIDATION_ERROR');
            }
          }
        }
      }

      // Apply original relative paths (busboy strips directory prefixes from filenames)
      if (filePaths && filePaths.length === files.length) {
        for (let i = 0; i < files.length; i++) {
          files[i].filename = filePaths[i];
        }
      }
    } catch (err: any) {
      if (err.statusCode) throw err;
      throw createHttpError(400, err.message, 'VALIDATION_ERROR');
    }

    // Validate platform
    if (!platform || (platform !== 'android' && platform !== 'ios')) {
      throw createHttpError(400, 'platform field is required and must be "android" or "ios"', 'VALIDATION_ERROR');
    }

    // Phase 37 Plan 37-04 — parallel-deploy cap check (Pitfall 9). When the
    // job metadata declares mode='parallel-deploy', validate the parallelism
    // against config.pool.<platform>.max_parallelism BEFORE enqueueing.
    // Throws RFC 7807 problem+json errors via createHttpError so the error
    // handler (server/api/error-handler.ts) renders the safe response shape
    // — no direct user-input interpolation into reply.send().
    if ((metadata as { mode?: string }).mode === 'parallel-deploy') {
      const platformKey = platform as 'android' | 'ios';
      const rawParallelism = (metadata as { parallelism?: unknown }).parallelism;
      const requested = typeof rawParallelism === 'number' && Number.isInteger(rawParallelism)
        ? rawParallelism
        : NaN;
      const cap = fastify.config.pool[platformKey].max_parallelism;
      if (!Number.isFinite(requested) || requested < 2) {
        throw createHttpError(
          400,
          'parallel-deploy mode requires metadata.parallelism as integer >= 2',
          'VALIDATION_ERROR',
        );
      }
      if (requested > cap) {
        // Retry-After is conveyed via the createHttpError options bag — the
        // error handler reads `retryAfterSeconds` and renders the header.
        // No direct reply.send of user-influenced data here (XSS-safe).
        throw createHttpError(
          503,
          `parallelism exceeds platform cap (cap=${cap}); raise pool.${platformKey}.max_parallelism`,
          'PARALLELISM_EXCEEDED',
          { retryAfterSeconds: 60 },
        );
      }
    }

    try {
      const job = await fastify.jobService.createJob({ files, metadata, platform: platform as 'android' | 'ios', env, apkPath, bootOptions });
      return reply.code(201).send(job);
    } catch (err: any) {
      if (err.code === 'QUEUE_FULL') {
        reply.header('retry-after', '30');
      }
      throw err;
    }
    },
  });

  /**
   * GET /jobs - List jobs with cursor pagination and filters.
   */
  fastify.get('/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawQuery = request.query as Record<string, string>;
    const parsed = listJobsQuerySchema.parse(rawQuery);
    const { cursor, limit, status, platform } = parsed;

    // Build WHERE conditions
    const conditions: any[] = [];

    if (status) {
      conditions.push(eq(schema.jobs.status, status));
    }
    if (platform) {
      conditions.push(eq(schema.jobs.platform, platform));
    }

    // Metadata filters
    const metaFilters = buildMetadataFilters(rawQuery);
    if (metaFilters.length > 0) {
      conditions.push(...buildMetadataSQL(metaFilters));
    }

    // Cursor filter
    if (cursor) {
      conditions.push(buildCursorWhere(cursor));
    }

    // Build query
    let query = fastify.db
      .select()
      .from(schema.jobs);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const rows = await (query as any)
      .orderBy(desc(schema.jobs.createdAt), desc(schema.jobs.id))
      .limit(limit + 1);

    const result = buildPaginatedResponse(rows, limit, (item: any) =>
      encodeCursor({ createdAt: item.createdAt, id: item.id }),
    );

    return result;
  });

  /**
   * GET /jobs/:id - Get job details with steps inline.
   */
  fastify.get('/jobs/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const jobRows = await fastify.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
      .limit(1);

    if (jobRows.length === 0) {
      throw createHttpError(404, `Job ${id} not found`, 'NOT_FOUND');
    }

    const job = jobRows[0];

    // Fetch steps
    const steps = await fastify.db
      .select()
      .from(schema.jobSteps)
      .where(eq(schema.jobSteps.jobId, id))
      .orderBy(schema.jobSteps.stepIndex);

    return {
      ...job,
      steps,
    };
  });

  /**
   * GET /jobs/:id/logs - Get raw Maestro output.
   */
  fastify.get('/jobs/:id/logs', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const jobRows = await fastify.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
      .limit(1);

    if (jobRows.length === 0) {
      throw createHttpError(404, `Job ${id} not found`, 'NOT_FOUND');
    }

    return { logs: jobRows[0].maestroOutput ?? '' };
  });

  /**
   * GET /jobs/:id/artifacts - List all artifacts for a job.
   *
   * Phase 17 Plan 17-01 — upgraded to withTypeProvider.
   * Response promoted into components.schemas.ArtifactList.
   */
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/jobs/:id/artifacts',
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: artifactListSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async (request) => {
      return fastify.artifactService.listByJob(request.params.id);
    },
  });

  /**
   * GET /jobs/:id/artifacts/:artifactId - Download an artifact file.
   */
  fastify.get('/jobs/:id/artifacts/:artifactId', async (
    request: FastifyRequest<{ Params: { id: string; artifactId: string } }>,
    reply: FastifyReply,
  ) => {
    const { id, artifactId } = request.params;

    const artifact = await fastify.artifactService.getById(artifactId);
    if (!artifact) {
      throw createHttpError(404, `Artifact ${artifactId} not found`, 'NOT_FOUND');
    }

    // Ownership check: artifact must belong to the requested job
    if (artifact.jobId !== id) {
      throw createHttpError(404, `Artifact ${artifactId} not found for job ${id}`, 'NOT_FOUND');
    }

    // Check file exists on disk
    try {
      await access(artifact.filePath, constants.R_OK);
    } catch {
      throw createHttpError(404, `Artifact file missing on disk: ${artifact.fileName}`, 'NOT_FOUND');
    }

    reply.header('Content-Type', artifact.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
    return reply.send(createReadStream(artifact.filePath));
  });

  /**
   * DELETE /jobs/:id - Cancel a job.
   */
  fastify.delete('/jobs/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      await fastify.jobService.cancelJob(id);
    } catch (err: any) {
      if (err.code === 'NOT_FOUND' || err.message?.includes('not found')) {
        throw createHttpError(404, `Job ${id} not found`, 'NOT_FOUND');
      }
      throw err;
    }

    return { status: 'cancelled' };
  });
}

/**
 * Device-related routes: GET /devices, POST /devices/:id/restart
 */
export async function deviceRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /devices - List all devices.
   *
   * Phase 17 Plan 17-01 — upgraded to withTypeProvider.
   * Response promoted into components.schemas.DeviceList.
   */
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().route({
    method: 'GET',
    url: '/devices',
    schema: {
      response: {
        200: deviceListSchema,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: async () => {
      return fastify.pool.getDevices();
    },
  });

  /**
   * POST /devices/:id/restart - Restart a device.
   */
  fastify.post('/devices/:id/restart', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const device = fastify.pool.getDevice(id);
    if (!device) {
      throw createHttpError(404, `Device ${id} not found`, 'NOT_FOUND');
    }

    // Trigger restart in background via driver
    const driver = fastify.pool.getDriver(device.platform);
    if (driver) {
      // Fire and forget restart
      const deviceMap = fastify.pool.getDeviceMap();
      const rawDevice = deviceMap.get(id);
      if (rawDevice) {
        Promise.resolve().then(async () => {
          try {
            await driver.shutdown(device.emulatorId);
            const result = await driver.boot(device.emulatorId);
            rawDevice.port = result.port;
            rawDevice.pid = result.pid;
          } catch (err: any) {
            request.log?.error?.({ deviceId: id, error: err.message }, 'Device restart failed');
          }
        });
      }
    }

    return { status: 'restarting' };
  });
}

/**
 * Config route: GET /config -- returns sanitized server configuration.
 */
export async function configRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/config', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const config = fastify.config;

    // Return sanitized config -- exclude database_url (contains credentials)
    return {
      server: {
        host: config.server.host,
        port: config.server.port,
      },
      pool: {
        max_devices: config.pool.max_devices,
        android: {
          enabled: config.pool.android.enabled,
          max_instances: config.pool.android.max_instances,
          headless: config.pool.android.headless,
          api_level: config.pool.android.api_level,
          device_profile: config.pool.android.device_profile,
          ram_mb: config.pool.android.ram_mb,
        },
        ios: {
          enabled: config.pool.ios.enabled,
          max_instances: config.pool.ios.max_instances,
          runtime: config.pool.ios.runtime,
          device_type: config.pool.ios.device_type,
        },
      },
      storage: {
        artifacts: {
          path: config.storage.artifacts.path,
          retention_days: config.storage.artifacts.retention_days,
          compress_after_days: config.storage.artifacts.compress_after_days,
          format: config.storage.artifacts.format,
          max_storage_gb: config.storage.artifacts.max_storage_gb,
        },
        logs: {
          path: config.storage.logs.path,
          retention_days: config.storage.logs.retention_days,
        },
      },
      jobs: {
        timeout_minutes: config.jobs.timeout_minutes,
        max_queue_size: config.jobs.max_queue_size,
        cleanup_completed_after_days: config.jobs.cleanup_completed_after_days,
      },
      auth: {
        enabled: config.auth.enabled,
      },
    };
  });
}

/**
 * Health route: GET /health
 */
export async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const response: Record<string, unknown> = {
      status: 'ok',
      uptime: process.uptime(),
      devices: fastify.pool.getDevices(),
      queue: fastify.jobService.getQueueDepth(),
    };

    // Include lifecycle stats if the lifecycle plugin is registered
    if (fastify.lifecycleStats) {
      const ls = fastify.lifecycleStats;
      response.lifecycle = {
        lastCompression: ls.lastCompressionRun
          ? { at: ls.lastCompressionRun.timestamp, ...ls.lastCompressionRun.result }
          : null,
        lastRetention: ls.lastRetentionRun
          ? { at: ls.lastRetentionRun.timestamp, ...ls.lastRetentionRun.result }
          : null,
        lastDiskCheck: ls.lastDiskCheck
          ? { at: ls.lastDiskCheck.timestamp, ...ls.lastDiskCheck.result }
          : null,
      };
    }

    return response;
  });
}
