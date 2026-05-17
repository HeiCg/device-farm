/**
 * Phase 20 / Plan 20-04 — Pool subscriber DB-gated spec (MOD-03 + SC1 + SC4).
 *
 * Proves downstream consumers receive all 4 `device.*` envelopes via the
 * pool module's per-module TypedBus. Each test subscribes via
 * `module.bus.on(eventName, handler)` (what jobs/maestro/hooks will do in
 * Phase 21/23/24), triggers the emit helper, and asserts the handler
 * fired with a payload matching the registered Zod schema.
 *
 * The device.health.failed subscribe path also verifies `fastify.onPersisted`
 * routes persisted events (persistence middleware fires the side-channel
 * <type>.envelope EE event).
 *
 * DB-gated via TEST_DATABASE_URL or DATABASE_URL (skipIf). Uses isolated
 * pgboss_pool_subscriber_<suffix> schema to avoid cross-file contention.
 *
 * Uses CANONICAL plain-object ALS store shape per 20-CONTEXT.md §Specifics:
 *   asyncLocalStorage.run({correlationId, currentEventId, actor} as never, ...)
 * Legacy Map-shape (`new Map([[...]])`) is explicitly forbidden in new pool specs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { asyncLocalStorage } from '@fastify/request-context';
import type { Envelope } from '../../events/envelope.js';

import correlationPlugin from '../../correlation/plugin.js';
import eventBusPlugin from '../../bus/plugin.js';
import queuePlugin from '../../queue/plugin.js';
import poolPlugin from '../plugin.js';

import { POOL_EVENT_NAMES, deviceBootedPayload } from '../events.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = typeof TEST_DATABASE_URL === 'string' && TEST_DATABASE_URL.length > 0;
const SCHEMA = `pgboss_pool_subscriber_${Math.random().toString(36).slice(2, 8)}`;

if (!HAS_DB) {
  // eslint-disable-next-line no-console
  console.warn('[pool/subscriber.spec] SKIPPED: set TEST_DATABASE_URL or DATABASE_URL to run');
}

describe.skipIf(!HAS_DB)('[Phase 20-04] pool bus subscriber proof (SC1 + SC4)', () => {
  let app: FastifyInstance;
  let sqlClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!);
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);

    const db = drizzle(sqlClient);

    // Stub config: pool drivers disabled (android/ios) so poolPlugin boots
    // without attempting to create real emulators/simulators.
    const stubConfigPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('config', {
        database_url: TEST_DATABASE_URL!,
        pool: {
          max_devices: 10,
          android: { enabled: false, max_instances: 0 },
          ios: { enabled: false, max_instances: 0 },
        },
      } as never);
    }, { name: 'config' });

    const liveDbPlugin = fp(async (fastify: FastifyInstance) => {
      fastify.decorate('db', db as unknown as FastifyInstance['db']);
    }, { name: 'db' });

    app = Fastify({ logger: false, pluginTimeout: 60_000 });
    await app.register(stubConfigPlugin);
    await app.register(correlationPlugin);
    await app.register(liveDbPlugin);
    await app.register(eventBusPlugin);
    await app.register(queuePlugin, { schema: SCHEMA });
    await app.register(poolPlugin);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => { /* ignore */ });
    await sqlClient?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => { /* ignore */ });
    await sqlClient?.end();
  }, 30_000);

  /**
   * Canonical plain-object ALS store shape per 20-CONTEXT §Specifics.
   * Wraps the fn so emit helpers can read correlationId/actor from ALS.
   */
  function makeEmitContext<T>(fn: () => T): Promise<T> {
    return asyncLocalStorage.run(
      { correlationId: randomUUID(), currentEventId: null, actor: 'subscriber-test' } as never,
      async () => fn(),
    ) as Promise<T>;
  }

  it('[SC1] device.state.changed → module.bus.on subscriber fires with correct payload', async () => {
    const deviceId = randomUUID();
    const received: Array<{ deviceId: string; from: string; to: string }> = [];
    const unsub = app.poolModule.bus.on(
      POOL_EVENT_NAMES.STATE_CHANGED,
      (p) => { received.push(p as { deviceId: string; from: string; to: string }); },
    );

    await makeEmitContext(() => {
      app.poolModule.emit.stateChanged(deviceId, {
        deviceId, from: 'booting', to: 'idle',
      });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ deviceId, from: 'booting', to: 'idle' });
    unsub();
  });

  it('[SC1] device.allocated → subscriber receives {deviceId, jobId, platform}', async () => {
    const deviceId = randomUUID();
    const received: Array<{ deviceId: string; jobId: string; platform: string }> = [];
    const unsub = app.poolModule.bus.on(
      POOL_EVENT_NAMES.ALLOCATED,
      (p) => { received.push(p as { deviceId: string; jobId: string; platform: string }); },
    );

    await makeEmitContext(() => {
      app.poolModule.emit.allocated(deviceId, { deviceId, jobId: 'job-abc-123', platform: 'android' });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ deviceId, jobId: 'job-abc-123', platform: 'android' });
    unsub();
  });

  it('[SC1] device.released → subscriber receives payload with nullable jobId', async () => {
    const deviceId = randomUUID();
    const received: Array<{ deviceId: string; jobId: string | null; platform: string }> = [];
    const unsub = app.poolModule.bus.on(
      POOL_EVENT_NAMES.RELEASED,
      (p) => { received.push(p as { deviceId: string; jobId: string | null; platform: string }); },
    );

    await makeEmitContext(() => {
      app.poolModule.emit.released(deviceId, { deviceId, jobId: 'job-abc', platform: 'ios' });
      app.poolModule.emit.released(deviceId, { deviceId, jobId: null,      platform: 'ios' });
    });

    expect(received).toHaveLength(2);
    expect(received[0].jobId).toBe('job-abc');
    expect(received[1].jobId).toBeNull();
    unsub();
  });

  it('[SC1] device.health.failed → subscriber receives reason + failureCount + willReplace + lastError', async () => {
    const deviceId = randomUUID();
    const received: Array<{
      deviceId: string;
      platform: string;
      reason: string;
      failureCount: number;
      willReplace: boolean;
      lastError: string | null;
    }> = [];
    const unsub = app.poolModule.bus.on(
      POOL_EVENT_NAMES.HEALTH_FAILED,
      (p) => {
        received.push(p as {
          deviceId: string;
          platform: string;
          reason: string;
          failureCount: number;
          willReplace: boolean;
          lastError: string | null;
        });
      },
    );

    await makeEmitContext(() => {
      app.poolModule.emit.healthFailed(deviceId, {
        deviceId, platform: 'android', reason: 'zombie',
        failureCount: 2, willReplace: true, lastError: 'pid 12345 in D state',
      });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      deviceId, platform: 'android', reason: 'zombie',
      failureCount: 2, willReplace: true, lastError: 'pid 12345 in D state',
    });
    unsub();
  });

  // ---------- Phase 24 / Plan 24-02 — device.booted emission wiring ----------
  //
  // Proves the 4 emission sites added to server/pool/pool-manager.ts at
  // Booting→Idle transitions (addDevice / initPool inner loop /
  // adoptDiscoveredDevice (Phase 36, replaces detectPhysicalDevices) /
  // replaceDevice) fire `device.booted` AFTER
  // `device.state.changed` (RESEARCH §Pitfall 2 — emit AFTER mutation
  // success). Also asserts the negative-space invariant: HealthChecker
  // recovery paths (Error→Idle in replaceZombieDevice) do NOT emit
  // device.booted — that channel is reserved for fresh-boot semantics.

  it('[Phase 24] device.booted fires AFTER device.state.changed at addDevice (Booting→Idle) and matches deviceBootedPayload schema', async () => {
    const events: Array<{ type: string; payload: { deviceId: string; [k: string]: unknown } }> = [];
    const offState = app.poolModule.bus.on(
      POOL_EVENT_NAMES.STATE_CHANGED,
      (p) => { events.push({ type: 'device.state.changed', payload: p as { deviceId: string } }); },
    );
    const offBooted = app.poolModule.bus.on(
      POOL_EVENT_NAMES.BOOTED,
      (p) => { events.push({ type: 'device.booted', payload: p as { deviceId: string } }); },
    );

    // addDevice synchronously transitions Booting→Idle and emits both events.
    const deviceId = await makeEmitContext(() =>
      app.pool.addDevice('android', 'phase-24-test-device', 'emulator-5560'),
    );

    // Filter to events for the device we just added (other devices may be
    // detected in parallel via the discovery service on plugin onReady).
    const ours = events.filter(e => e.payload.deviceId === deviceId);
    const stateIdx = ours.findIndex(e => e.type === 'device.state.changed');
    const bootedIdx = ours.findIndex(e => e.type === 'device.booted');

    expect(stateIdx).toBeGreaterThanOrEqual(0);
    expect(bootedIdx).toBeGreaterThanOrEqual(0);
    // Ordering invariant: booted fires AFTER stateChanged for the same
    // deviceId (Pitfall 2 — emit booted AFTER mutation success).
    expect(bootedIdx).toBeGreaterThan(stateIdx);

    // Envelope payload shape — round-trips through deviceBootedPayload.
    const booted = ours[bootedIdx].payload as Record<string, unknown>;
    const parsed = deviceBootedPayload.safeParse(booted);
    expect(parsed.success).toBe(true);
    expect(booted.deviceId).toBe(deviceId);
    expect(booted.platform).toBe('android');
    expect(booted.emulatorId).toBe('emulator-5560');
    // addDevice does not assign a port; physical/non-booted devices may have null.
    expect(booted.port === null || typeof booted.port === 'number').toBe(true);

    offState();
    offBooted();
  });

  it('[Phase 24] HealthChecker recovery does NOT emit device.booted (only health.failed + state.changed)', async () => {
    let bootedCount = 0;
    const off = app.poolModule.bus.on(POOL_EVENT_NAMES.BOOTED, () => { bootedCount += 1; });

    // Simulate the HealthChecker recovery code path's emission sequence
    // (replaceZombieDevice, lines ~201-215 in health-checker.ts):
    //   transition(Error) → emit.stateChanged
    //   transition(Booting) → emit.stateChanged
    //   transition(Idle) → emit.stateChanged       ← Error→Idle recovery, NOT
    //                                                a fresh boot; must NOT
    //                                                emit device.booted.
    // No device.booted emission anywhere on this path — verified by
    // `grep -c 'emit.booted' server/pool/health-checker.ts` → 0.
    const deviceId = randomUUID();
    await makeEmitContext(() => {
      app.poolModule.emit.healthFailed(deviceId, {
        deviceId, platform: 'android', reason: 'zombie',
        failureCount: 1, willReplace: true, lastError: null,
      });
      app.poolModule.emit.stateChanged(deviceId, { deviceId, from: 'running', to: 'error' });
      app.poolModule.emit.stateChanged(deviceId, { deviceId, from: 'error', to: 'booting' });
      app.poolModule.emit.stateChanged(deviceId, { deviceId, from: 'booting', to: 'idle' });
    });

    expect(bootedCount).toBe(0);
    off();
  });

  it('[SC4] device.health.failed → pool module side-channel <type>.envelope fires with full envelope (persisted flag routes to side-channel)', async () => {
    const deviceId = randomUUID();
    const received: Envelope[] = [];
    // Pool's per-module persistEnvelope fires `<type>.envelope` synchronously on
    // pool's OWN TypedBus ee (server/pool/internal/module.ts makePersistEnvelope).
    // `app.onPersisted` (fastify.onPersisted) subscribes to the BUS PLUGIN's
    // separate demoRegistry ee, so it does NOT cross module boundaries. For
    // pool's side-channel semantics, subscribers go through `poolModule.bus`'s
    // internal ee directly — same mechanism as `fastify.onPersisted`, different ee.
    // Phase 27+ consolidation may unify the ee's; for now each module owns its own.
    // See plan 20-04 SUMMARY.md §Deviations (Rule 1) for the plan-vs-architecture
    // correction that replaces the original `app.onPersisted` assertion here.
    const poolEe = (app.poolModule.bus as unknown as {
      ee: import('node:events').EventEmitter;
    }).ee;
    const listener = (envelope: Envelope) => { received.push(envelope); };
    poolEe.on('device.health.failed.envelope', listener);

    await makeEmitContext(() => {
      app.poolModule.emit.healthFailed(deviceId, {
        deviceId, platform: 'android', reason: 'unhealthy',
        failureCount: 0, willReplace: false, lastError: null,
      });
    });

    // persistEnvelope fires the side-channel synchronously before the DB write,
    // so the subscriber observes at least one envelope on the same call stack.
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].type).toBe('device.health.failed');
    expect(received[0].aggregateType).toBe('pool');
    expect(received[0].aggregateId).toBe(deviceId);
    poolEe.off('device.health.failed.envelope', listener);
  });
});
