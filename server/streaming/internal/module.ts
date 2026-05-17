/**
 * Phase 22 / Plan 22-02 — Streaming module factory (MOD-06).
 *
 * Builds the streaming module: JobBroadcaster + DevicePreviewManager +
 * per-module TypedBus + persistEnvelope middleware + makeStreamingEmitters +
 * 3 deferred-to-onReady bus subscribers + idempotent shutdown.
 *
 * DO NOT import this file from outside server/streaming/. The MOD-02
 * dep-cruiser rule `no-deep-imports-into-streaming-internal` (added in
 * Plan 22-00 to .dependency-cruiser.cjs) enforces the boundary. Public
 * surface is exposed via server/streaming/index.ts barrel (expanded in
 * Plan 22-05).
 *
 * Factory dependencies follow Phase 21 artifacts shape — fastify (for
 * onReady / onClose / decorators + jobsModule access), db (for
 * persistEnvelope middleware; short-circuits on persisted:false but
 * kept for future-proof per RESEARCH §Plugin Dependencies), config
 * (unused today but kept for symmetry + Phase 29 envelope config),
 * logger (child('streaming') per MOD-07).
 *
 * 6TH SAMPLE POINT NOTE: the persistEnvelope middleware below is the 6th
 * verbatim copy of the same pattern (Phase 16 hooks + Phase 18 lifecycle +
 * Phase 19 reporting + Phase 20 pool + Phase 21 artifacts). Phase 27+
 * CONSOLIDATION TRIGGER STILL OPEN. Do NOT consolidate in this phase.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { eq } from 'drizzle-orm';

import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';
import { events as eventsTable, jobs as jobsTable } from '../../db/schema.js';

import { TypedBus } from '../../bus/bus.js';
import type { EventRegistry } from '../../bus/types.js';
import type { Envelope } from '../../events/envelope.js';
import { asyncLocalStorage } from '@fastify/request-context';

import { JobBroadcaster } from './job-broadcaster.js';
import { DevicePreviewManager } from './device-preview.js';
import { wsEnvelopeSchema, type WsEnvelope } from './ws-schemas.js';
import { parseLogcatLine, type ParsedLogcat } from '../../jobs/log-parsing.js';
import {
  streamingRegistry,
  type StreamingRegistry,
  makeStreamingEmitters,
  type StreamingEmitters,
} from '../events.js';

export interface CreateStreamingModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface StreamingModule {
  jobBroadcaster: JobBroadcaster;
  devicePreview: DevicePreviewManager;
  emit: StreamingEmitters;
  bus: TypedBus<StreamingRegistry>;
  /**
   * Deferred to fastify.addHook('onReady', ...) inside plugin.ts.
   * Subscribes to job.log / job.step / job.status on fastify.jobsModule.bus.
   * Pitfall 2 — streaming plugin registers at step 10 < jobs plugin at step 13;
   * fastify.jobsModule is not decorated at plugin-body time.
   */
  registerSubscribers: () => Promise<void>;
  /**
   * Idempotent. Unsubscribes all 3 bus handlers + clears any lifecycle state.
   * Called from plugin.ts onClose hook.
   */
  shutdown: () => Promise<void>;
}

/**
 * Read a string from ALS across BOTH store shapes (plain object / Map).
 * Mirrors `readAls` in server/bus/helpers.ts (kept local to avoid exporting
 * from the bus helpers module).
 */
function readCorrelationIdFromAls(): string | null {
  const store = asyncLocalStorage.getStore();
  if (!store) return null;
  let raw: unknown;
  if (store instanceof Map) {
    raw = store.get('correlationId');
  } else if (typeof store === 'object') {
    raw = (store as unknown as Record<string, unknown>)['correlationId'];
  } else {
    return null;
  }
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function createStreamingModule(deps: CreateStreamingModuleDeps): StreamingModule {
  const { fastify, db, config: _config, logger } = deps;
  const log = logger.child({ module: 'streaming' });

  // (a) Construct infra primitives.
  const jobBroadcaster = new JobBroadcaster();
  const devicePreview = new DevicePreviewManager(log as pino.Logger);

  // (b) Construct per-module TypedBus<StreamingRegistry>.
  const bus = new TypedBus(streamingRegistry);

  // (c) persistEnvelope middleware (6TH SAMPLE POINT — verbatim shape;
  //     Phase 27+ consolidation trigger. Do NOT extract in this phase.).
  function persistEnvelope(envelope: Envelope): void {
    // Fire side-channel for subscribers that listen on `${type}.envelope`.
    const ee = (bus as unknown as { ee: { emit: (name: string, env: Envelope) => void } }).ee;
    ee.emit(`${envelope.type}.envelope`, envelope);

    // Short-circuit if this event type isn't persisted (ws.frame.dropped is NOT persisted).
    const entry = (streamingRegistry as Record<string, { persisted: boolean } | undefined>)[envelope.type];
    if (!entry || !entry.persisted) return;

    // Fire-and-forget insert into events table. Errors logged but do not
    // crash the emitter (bus.emit MUST NOT throw on persistence failure).
    void (async () => {
      try {
        await db.insert(eventsTable).values({
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
        log.error({ err, envelopeId: envelope.id, eventType: envelope.type }, 'persistEnvelope failed');
      }
    })();
  }

  // (d) Construct emit helpers wired through persistEnvelope side-channel.
  const emit = makeStreamingEmitters(bus, persistEnvelope);

  // (e) Subscriber state — closure-captured for idempotent shutdown.
  let unsubscribeJobLog: (() => void) | null = null;
  let unsubscribeJobStep: (() => void) | null = null;
  let unsubscribeJobStatus: (() => void) | null = null;
  // Phase 23 Plan 23-04 — DEFERRED-22-D resolution.
  let unsubscribeJobCleanup: (() => void) | null = null;

  // Phase 31 Plan 31-01 (SC1) — first-crash detection gate. A crashed job
  // emits 50-200 lines matching crash markers (stack trace lines all contain
  // `AndroidRuntime`). Without a gate we would fire 50 DB UPDATEs + 50
  // crash-detected events. This Set ensures exactly ONE fire per jobId.
  // Cleared on `job.cleanup.requested` (Phase 23 saga signal) below.
  const firstCrashSeen = new Set<string>();

  /**
   * Pull the raw logcat line out of a job.log payload.
   *
   * The job.log bus event payload is `{jobId, data}` where `data` may be:
   *   - a plain string (legacy producers)
   *   - `{line: string, stream?: string}` (Phase 22+ canonical shape;
   *     correlation.spec at line 148 + 174 use this)
   *   - some other object with no `line` field (e.g., binary fragments) —
   *     returns '' so the parser is invoked on an empty string and returns
   *     null (no crash detection, no false positive)
   */
  function extractRawLine(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'line' in data) {
      const candidate = (data as { line?: unknown }).line;
      if (typeof candidate === 'string') return candidate;
    }
    return '';
  }

  /**
   * Enrich the original payload with parsed metadata when the parser matched.
   * Preserves the shape existing consumers see (string stays string, object
   * stays object) — we only add a `parsed` field on objects, or wrap the
   * legacy string form into `{line, parsed}` when parsing succeeds.
   *
   * If the parser returned null, the original payload is passed through
   * unchanged. This keeps non-logcat lines (scrcpy output, brief-format
   * logs) on the wire exactly as before — backwards compatibility intact.
   */
  function enrichLogPayload(data: unknown, parsed: ParsedLogcat | null): unknown {
    if (parsed === null) return data;
    if (typeof data === 'string') {
      return { line: data, parsed };
    }
    if (data && typeof data === 'object') {
      return { ...(data as Record<string, unknown>), parsed };
    }
    return data;
  }

  const makeHandler = (eventType: 'step' | 'status') =>
    (payload: { jobId: string; data: unknown }) => {
      // Read correlationId from ALS at handler time. Same mechanism
      // createEventHelpers uses at emit time — but TypedBus.emit fires
      // payload-only to bus.on subscribers (no envelope side-channel here),
      // so the subscriber MUST re-read from ALS.
      const correlationId = readCorrelationIdFromAls() ?? randomUUID();

      const candidate = {
        type: eventType,
        correlationId,
        v: 1 as const,
        ts: new Date().toISOString(),
        payload: payload.data,
      };

      const parsed = wsEnvelopeSchema.safeParse(candidate);
      if (!parsed.success) {
        log.warn(
          { err: parsed.error.format(), candidate },
          'ws.frame.dropped: wsEnvelopeSchema.safeParse failed',
        );
        emit.frameDropped(payload.jobId, {
          jobId: payload.jobId,
          eventType,
          reason: 'safeParse-failed',
          zodError: parsed.error.message,
        });
        return; // Drop — never send malformed to client
      }

      jobBroadcaster.emit(payload.jobId, parsed.data as WsEnvelope);
    };

  /**
   * Phase 31 Plan 31-01 — Log handler with parser enrichment + first-crash gate.
   *
   * Flow:
   *   1. Extract raw line; invoke pure parseLogcatLine
   *   2. Enrich payload with `parsed` metadata (if parser matched)
   *   3. Build + validate the standard `log` WS envelope (existing Phase 22 path)
   *   4. On first crash detection per jobId:
   *      - Mark jobId in firstCrashSeen
   *      - Fire-and-forget `jobs.failure_class = 'crash'` UPDATE (Phase 23
   *        saga pattern — no await; errors logged but never thrown)
   *      - Emit a separate `crash-detected` envelope on the same broadcaster
   *
   * Subsequent crash markers for the same jobId pass through enrichment but
   * skip the gate (no duplicate DB writes, no duplicate crash-detected events).
   */
  function handleLog(payload: { jobId: string; data: unknown }): void {
    const correlationId = readCorrelationIdFromAls() ?? randomUUID();
    const ts = new Date().toISOString();

    const rawLine = extractRawLine(payload.data);
    const parsedLine = rawLine.length > 0 ? parseLogcatLine(rawLine) : null;
    const enriched = enrichLogPayload(payload.data, parsedLine);

    const candidate = {
      type: 'log' as const,
      correlationId,
      v: 1 as const,
      ts,
      payload: enriched,
    };

    const validated = wsEnvelopeSchema.safeParse(candidate);
    if (!validated.success) {
      log.warn(
        { err: validated.error.format(), candidate },
        'ws.frame.dropped: wsEnvelopeSchema.safeParse failed',
      );
      emit.frameDropped(payload.jobId, {
        jobId: payload.jobId,
        eventType: 'log',
        reason: 'safeParse-failed',
        zodError: validated.error.message,
      });
      return;
    }

    jobBroadcaster.emit(payload.jobId, validated.data as WsEnvelope);

    // First-crash gate
    if (parsedLine?.isCrash && !firstCrashSeen.has(payload.jobId)) {
      firstCrashSeen.add(payload.jobId);

      // (a) Fire-and-forget DB update (Phase 23 saga pattern — never await;
      // errors logged but never thrown, NEVER block the WS frame).
      void (async () => {
        try {
          await db
            .update(jobsTable)
            .set({ failureClass: 'crash' })
            .where(eq(jobsTable.id, payload.jobId));
        } catch (err) {
          log.error(
            { err, jobId: payload.jobId },
            'failed to set failure_class=crash',
          );
        }
      })();

      // (b) Emit a separate crash-detected envelope. Re-uses the broadcaster
      // and shares correlationId+ts with the log envelope above so the dashboard
      // can correlate the badge to the exact crash line.
      const crashCandidate = {
        type: 'crash-detected' as const,
        correlationId,
        v: 1 as const,
        ts,
        payload: { firstLine: rawLine },
      };
      const crashValidated = wsEnvelopeSchema.safeParse(crashCandidate);
      if (crashValidated.success) {
        jobBroadcaster.emit(payload.jobId, crashValidated.data as WsEnvelope);
      } else {
        log.warn(
          { err: crashValidated.error.format(), jobId: payload.jobId },
          'crash-detected envelope failed safeParse',
        );
      }
    }
  }

  // (f) registerSubscribers — deferred to onReady inside plugin.ts.
  async function registerSubscribers(): Promise<void> {
    // fastify.jobsModule is decorated by server/jobs/plugin.ts at step 13;
    // streaming plugin registers at step 10. If called from plugin body
    // this would throw; caller (plugin.ts) wraps in fastify.addHook('onReady').
    const jobsModule = (
      fastify as FastifyInstance & {
        jobsModule?: { bus: TypedBus<EventRegistry> };
      }
    ).jobsModule;
    if (!jobsModule || !jobsModule.bus) {
      log.warn(
        'registerSubscribers: fastify.jobsModule.bus not decorated; skipping — Phase 23 will add decoration',
      );
      return;
    }

    unsubscribeJobLog = jobsModule.bus.on(
      'job.log' as never,
      handleLog as never,
    );
    unsubscribeJobStep = jobsModule.bus.on(
      'job.step' as never,
      makeHandler('step') as never,
    );
    unsubscribeJobStatus = jobsModule.bus.on(
      'job.status' as never,
      makeHandler('status') as never,
    );

    // Phase 23 Plan 23-04 — DEFERRED-22-D resolved: replace setTimeout-based
    // broadcaster.cleanup with bus subscription. Jobs emits this from the
    // saga subscriber on job.completed and job.failed.
    //
    // Phase 31 Plan 31-01 — also clear the firstCrashSeen entry for this
    // jobId (safe whether or not the job ever crashed; Set.delete is no-op
    // on missing keys). Prevents memory growth across long-lived processes.
    unsubscribeJobCleanup = jobsModule.bus.on(
      'job.cleanup.requested' as never,
      ((payload: { jobId: string }) => {
        firstCrashSeen.delete(payload.jobId);
        try {
          jobBroadcaster.cleanup(payload.jobId);
        } catch (err) {
          log.warn({ err, jobId: payload.jobId }, 'jobBroadcaster.cleanup failed');
        }
      }) as never,
    );

    log.info(
      'Streaming subscribers registered on fastify.jobsModule.bus (job.log/step/status/cleanup.requested)',
    );
  }

  // (g) shutdown — idempotent. Unsub 3 handlers + null out references.
  async function shutdown(): Promise<void> {
    if (unsubscribeJobLog) {
      unsubscribeJobLog();
      unsubscribeJobLog = null;
    }
    if (unsubscribeJobStep) {
      unsubscribeJobStep();
      unsubscribeJobStep = null;
    }
    if (unsubscribeJobStatus) {
      unsubscribeJobStatus();
      unsubscribeJobStatus = null;
    }
    if (unsubscribeJobCleanup) {
      unsubscribeJobCleanup();
      unsubscribeJobCleanup = null;
    }
    log.info('Streaming module shutdown complete');
  }

  return {
    jobBroadcaster,
    devicePreview,
    emit,
    bus,
    registerSubscribers,
    shutdown,
  };
}
