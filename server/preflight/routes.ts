/**
 * Phase 37 Plan 37-02 Wave 1 — preflight routes.
 *
 *   POST /api/preflight       multipart .ipa or .apk → PreflightReport
 *   GET  /api/preflight/:id   read persisted run
 *
 * Errors follow RFC 7807 problem+json (matching the rest of the API):
 *   { type, title, status }
 *
 * Multipart parsing uses @fastify/multipart (registered globally by the api
 * plugin). When `module` is null (Wave 0 plugin path) the route still
 * registers but always returns 503.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { promises as fs, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

import type { PreflightModule } from './internal/module.js';

export interface PreflightRoutesDeps {
  module: PreflightModule;
}

function problem(reply: FastifyReply, status: number, type: string, title: string) {
  reply.code(status);
  reply.header('content-type', 'application/problem+json');
  return { type, title, status };
}

export function registerPreflightRoutes(
  app: FastifyInstance,
  deps: PreflightRoutesDeps,
): void {
  app.post('/api/preflight', async (req, reply) => {
    // Pull the first multipart file part.
    let file: Awaited<ReturnType<typeof req.file>>;
    try {
      file = await req.file();
    } catch (err) {
      return problem(
        reply,
        400,
        'about:blank#missing-file',
        'No multipart file uploaded',
      );
    }
    if (!file) {
      return problem(
        reply,
        400,
        'about:blank#missing-file',
        'No multipart file uploaded',
      );
    }
    const ext = extname(file.filename).toLowerCase();
    if (ext !== '.ipa' && ext !== '.apk') {
      // Drain stream so multipart parser does not hang.
      try { file.file.resume(); } catch { /* ignore */ }
      return problem(
        reply,
        400,
        'about:blank#unsupported-extension',
        'Only .ipa or .apk files are accepted',
      );
    }

    const tmpPath = join(tmpdir(), `preflight-${randomUUID()}${ext}`);
    try {
      await pipeline(file.file, createWriteStream(tmpPath));

      // If @fastify/multipart truncated the upload (over its limits), surface 413.
      if (file.file.truncated) {
        return problem(
          reply,
          413,
          'about:blank#payload-too-large',
          'Uploaded file exceeded the configured size limit',
        );
      }

      const platform: 'ios' | 'android' = ext === '.ipa' ? 'ios' : 'android';
      const result = await deps.module.scan({
        filePath: tmpPath,
        filename: file.filename,
        platform,
      });
      return result.report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/malformed|invalid zip|end of central directory/i.test(msg)) {
        return problem(
          reply,
          400,
          'about:blank#malformed-archive',
          'Could not parse archive',
        );
      }
      req.log.error({ err }, 'preflight scan failed');
      return problem(reply, 500, 'about:blank#scan-error', 'Preflight scan failed');
    } finally {
      try { await fs.rm(tmpPath, { force: true }); } catch { /* ignore */ }
    }
  });

  app.get<{ Params: { id: string } }>('/api/preflight/:id', async (req, reply) => {
    const row = await deps.module.repo.getById(req.params.id);
    if (!row) {
      return problem(reply, 404, 'about:blank#not-found', 'Preflight run not found');
    }
    return row;
  });
}
