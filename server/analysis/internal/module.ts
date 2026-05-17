/**
 * Phase 37 Plan 37-01 — analysis module factory (MOD-06).
 *
 * Replaces the Plan 37-00 Wave 0 stub. Shape mirrors Phase 35 explorations:
 *   - per-module TypedBus<AnalysisRegistry>
 *   - persistEnvelope closure (13th persistEnvelope sample point —
 *     DEFERRED-26-B continues; Phase 27+ owns consolidation)
 *   - emit helpers via makeAnalysisEmitters(bus, persistEnvelope)
 *   - repo facade: { create, getByJobId, getById }
 *
 * The decorator type on fastify.analysisModule is the non-null shape now —
 * Wave 0 used `... | null`. Wave 1 always returns a real module; callers
 * can safely assume the surface is present once analysisPlugin registers.
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { TypedBus } from '../../bus/bus.js';
import type { Database } from '../../db/index.js';
import type { Envelope } from '../../events/envelope.js';
import { events as eventsTable } from '../../db/schema.js';

import {
  analysisRegistry,
  makeAnalysisEmitters,
  type AnalysisRegistry,
  type AnalysisEmitters,
} from '../events.js';
import * as repo from './repo.js';
import type { CreateAnalysisInput, AnalysisRow } from './repo.js';

export interface AnalysisModuleDeps {
  fastify: FastifyInstance;
  db?: Database;
  bus?: TypedBus<AnalysisRegistry>;
  logger: pino.Logger;
}

export interface AnalysisModule {
  readonly bus: TypedBus<AnalysisRegistry>;
  readonly emit: AnalysisEmitters;
  readonly repo: {
    create(input: CreateAnalysisInput): Promise<{ id: string }>;
    getByJobId(jobId: string): Promise<AnalysisRow | null>;
    getById(id: string): Promise<AnalysisRow | null>;
  };
}

/**
 * 13th persistEnvelope sample point (DEFERRED-26-B continues). Mirror
 * Phase 35 shape verbatim with analysisRegistry substitution. Only emits
 * events whose registry entry has `persisted: true` — analysis.ingested
 * is currently false (derivable from analyses table), so this routine
 * functions as a side-channel envelope emit only.
 */
function makePersistEnvelope(deps: {
  db: Database;
  bus: TypedBus<AnalysisRegistry>;
  logger: pino.Logger;
}) {
  const ee = (deps.bus as unknown as { ee: import('node:events').EventEmitter }).ee;
  return function persistEnvelope(envelope: Envelope): void {
    ee.emit(`${envelope.type}.envelope`, envelope);
    const entry = analysisRegistry[envelope.type as keyof AnalysisRegistry];
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
        deps.logger.error({ err, envelope }, 'Failed to persist analysis event');
      }
    })();
  };
}

export function createAnalysisModule(deps: AnalysisModuleDeps): AnalysisModule {
  const { fastify } = deps;
  const db = deps.db ?? fastify.db;
  const logger = deps.logger.child({ module: 'analysis' });
  if (!db) {
    throw new Error('createAnalysisModule: db dependency required');
  }
  const bus = deps.bus ?? new TypedBus<AnalysisRegistry>(analysisRegistry);
  const persistEnvelope = makePersistEnvelope({ db, bus, logger });
  const emit = makeAnalysisEmitters(bus, persistEnvelope);

  return {
    bus,
    emit,
    repo: {
      create: (input) => repo.create(db, input),
      getByJobId: (jobId) => repo.getByJobId(db, jobId),
      getById: (id) => repo.getById(db, id),
    },
  };
}
