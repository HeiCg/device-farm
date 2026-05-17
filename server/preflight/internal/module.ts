/**
 * Phase 37 Plan 37-02 Wave 1 — preflight module factory.
 *
 * Wires:
 *   - per-module TypedBus<PreflightRegistry>
 *   - persistEnvelope closure (13th persistEnvelope duplication site —
 *     DEFERRED-26-B continues through Phase 27+ consolidation tracker)
 *   - emit helpers via makePreflightEmitters(bus, persistEnvelope)
 *   - repo (Drizzle CRUD on preflight_runs)
 *   - scan(input): parse → run rules → persist → emit
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

import { TypedBus } from '../../bus/bus.js';
import type { Database } from '../../db/index.js';
import type { Envelope } from '../../events/envelope.js';
import { events as eventsTable } from '../../db/schema.js';

import {
  preflightRegistry,
  makePreflightEmitters,
  type PreflightRegistry,
  type PreflightEmitters,
} from '../events.js';
import { createRepo, type PreflightRepo, type PreflightRunRow } from './repo.js';
import { parseIPA } from './parsers/ipa.js';
import { parseAPK } from './parsers/apk.js';
import { runRules, type PreflightReport } from './rule-engine.js';

export interface PreflightModuleDeps {
  fastify: FastifyInstance;
  db?: Database;
  bus?: TypedBus<PreflightRegistry>;
  logger?: pino.Logger;
}

export interface ScanInput {
  filePath: string;
  filename: string;
  platform: 'ios' | 'android';
}

export interface ScanResult {
  runId: string;
  report: PreflightReport;
  row: PreflightRunRow;
}

export interface PreflightModule {
  readonly bus: TypedBus<PreflightRegistry>;
  readonly emit: PreflightEmitters;
  readonly repo: PreflightRepo;
  scan(input: ScanInput): Promise<ScanResult>;
}

function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<PreflightRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = preflightRegistry[envelope.type as keyof PreflightRegistry];
    if (!entry || !entry.persisted) return;

    void (async () => {
      try {
        await deps.db.insert(eventsTable).values({
          id: envelope.id,
          eventType: envelope.type,
          eventVersion: envelope.v,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? undefined,
          aggregateType: envelope.aggregateType,
          aggregateId: envelope.aggregateId,
          payload: envelope.payload as unknown,
          occurredAt: new Date(envelope.occurredAt),
          actor: envelope.actor,
        });
      } catch (err) {
        deps.logger.error({ err, envelope }, 'Failed to persist preflight event');
      }
    })();
  };
}

export async function createPreflightModule(
  deps: PreflightModuleDeps,
): Promise<PreflightModule> {
  const { fastify } = deps;
  const db = deps.db ?? fastify.db;
  const logger = (deps.logger ?? (fastify.log as unknown as pino.Logger)).child({
    module: 'preflight',
  });

  if (!db) {
    throw new Error('createPreflightModule: db dependency is required');
  }

  const bus = deps.bus ?? new TypedBus<PreflightRegistry>(preflightRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger });
  const emit = makePreflightEmitters(bus, persistEnvelope);
  const repo = createRepo(db);

  async function scan(input: ScanInput): Promise<ScanResult> {
    const ext = extname(input.filename).toLowerCase();
    const bundle = ext === '.ipa'
      ? await parseIPA(input.filePath)
      : await parseAPK(input.filePath);
    const report = runRules(bundle, input.platform);
    const stat = await fs.stat(input.filePath).catch(() => ({ size: 0 }));
    const row = await repo.create({
      platform: input.platform,
      filename: input.filename,
      fileSizeBytes: stat.size,
      rulesVersion: report.rules_version,
      status: report.status,
      blockers: report.blockers,
      warnings: report.warnings,
    });
    emit.completed(row.id, {
      preflightRunId: row.id,
      status: report.status,
      rulesVersion: report.rules_version,
      blockerCount: report.blockers.length,
      warningCount: report.warnings.length,
    });
    return { runId: row.id, report, row };
  }

  return { bus, emit, repo, scan };
}
