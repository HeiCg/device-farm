/**
 * Phase 24 / Plan 24-03 — Maestro module factory (MOD-06).
 *
 * Builds the maestro module: AppiumService + HierarchyService +
 * DeviceInfoCollector + per-module TypedBus + persistEnvelope middleware
 * (8TH SAMPLE POINT) + makeMaestroEmitters + 1 deferred-to-onReady
 * subscriber (device.booted) + idempotent shutdown.
 *
 * DO NOT import this file from outside server/maestro/. The MOD-02
 * dep-cruiser rule `no-deep-imports-into-maestro-internal` (added in
 * Plan 24-00) enforces structurally. Public surface via index.ts barrel.
 *
 * 8TH SAMPLE POINT NOTE: persistEnvelope below is the 8th verbatim copy
 * (Phase 16 hooks → 18 lifecycle → 19 reporting → 20 pool → 21 artifacts
 *  → 22 streaming → 23 jobs → 24 maestro). Phase 27+ CONSOLIDATION
 * TRIGGER STILL OPEN — DEFERRED-24-B. Do NOT consolidate in this phase.
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import type { Database } from '../../db/index.js';
import type { AppConfig } from '../../config/schema.js';
import { events as eventsTable } from '../../db/schema.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';
import {
  maestroRegistry,
  makeMaestroEmitters,
  type MaestroRegistry,
  type MaestroEmitters,
} from '../events.js';
import { AppiumService } from './appium-service.js';
import { HierarchyService } from './hierarchy-service.js';
import { DeviceInfoCollector } from './device-info-collector.js';
import { makeDeviceBootedHandler } from './subscribers.js';

export interface CreateMaestroModuleDeps {
  fastify: FastifyInstance;
  db: Database;
  config: AppConfig;
  logger: pino.Logger;
}

export interface MaestroModule {
  appiumService: AppiumService;
  hierarchyService: HierarchyService;
  deviceInfoCollector: DeviceInfoCollector;
  emit: MaestroEmitters;
  bus: TypedBus<MaestroRegistry>;
  /**
   * Deferred to fastify.addHook('onReady', ...) inside plugin.ts.
   * Subscribes to device.booted on fastify.poolModule.bus (Pitfall 2 —
   * pool plugin decorates poolModule.bus at step 8; maestro plugin runs
   * at step 14; deferral keeps the wiring agnostic to plugin-order shifts).
   */
  registerSubscribers: () => Promise<void>;
  /**
   * Idempotent. Unsubscribes the device.booted handler + closes Appium
   * sessions. Safe to call twice (no extra unsub / close calls).
   */
  shutdown: () => Promise<void>;
}

export function createMaestroModule(deps: CreateMaestroModuleDeps): MaestroModule {
  const { fastify, db, config, logger } = deps;
  const log = logger.child({ module: 'maestro' });

  // (a) Construct services.
  const appiumService = new AppiumService(log, {
    serverUrl: (config as any).appium?.server_url ?? 'http://localhost:4723',
    sessionTimeoutMs: (config as any).appium?.session_timeout_ms ?? 300_000,
  });
  const hierarchyService = new HierarchyService(log, undefined, appiumService);
  const deviceInfoCollector = new DeviceInfoCollector(log);

  // (b) Per-module TypedBus<MaestroRegistry>.
  const bus = new TypedBus(maestroRegistry);

  // (c) persistEnvelope — 8TH SAMPLE POINT (verbatim from Phase 22
  // streaming/internal/module.ts:106-137). Phase 27+ consolidation trigger
  // OPEN per DEFERRED-24-B; do NOT consolidate in this phase.
  function persistEnvelope(envelope: Envelope): void {
    const ee = (bus as unknown as { ee: { emit: (name: string, env: Envelope) => void } }).ee;
    ee.emit(`${envelope.type}.envelope`, envelope);

    const entry = (maestroRegistry as Record<string, { persisted: boolean } | undefined>)[envelope.type];
    if (!entry || !entry.persisted) return; // both maestro events transient — short-circuit

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

  // (d) Emit helpers wired through persistEnvelope side-channel.
  const emit = makeMaestroEmitters(bus, persistEnvelope);

  // (e) Subscriber state — closure-captured for idempotent shutdown.
  let unsubscribeDeviceBooted: (() => void) | null = null;

  async function registerSubscribers(): Promise<void> {
    const poolModule = (fastify as FastifyInstance & {
      poolModule?: { bus: { on: (name: string, handler: (raw: unknown) => void) => () => void } };
    }).poolModule;
    if (!poolModule || !poolModule.bus) {
      log.warn(
        'registerSubscribers: fastify.poolModule.bus not decorated; device.booted subscriber not wired',
      );
      return;
    }

    const handler = makeDeviceBootedHandler({ fastify, deviceInfoCollector, emit, logger: log });
    unsubscribeDeviceBooted = poolModule.bus.on('device.booted', handler);
    log.info('Maestro subscriber registered on fastify.poolModule.bus (device.booted)');
  }

  async function shutdown(): Promise<void> {
    if (unsubscribeDeviceBooted) {
      unsubscribeDeviceBooted();
      unsubscribeDeviceBooted = null;
    }
    try {
      await appiumService.closeAllSessions();
    } catch (err) {
      log.warn({ err }, 'AppiumService.closeAllSessions failed during shutdown');
    }
    log.info('Maestro module shutdown complete');
  }

  return {
    appiumService,
    hierarchyService,
    deviceInfoCollector,
    emit,
    bus,
    registerSubscribers,
    shutdown,
  };
}
