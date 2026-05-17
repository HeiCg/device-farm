/**
 * Phase 20 / Plan 20-03 — Lifecycle ownership spec (SC2 proof).
 *
 * Proves:
 *   - server/index.ts no longer starts/stops healthChecker or reaper (grep assertion)
 *   - module.registerWorkersAndSubscribers starts healthChecker + device.reap schedule
 *   - module.shutdown stops healthChecker + offWorks reaper worker
 *   - No hybrid state — pool owns both lifecycles
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { pino } from 'pino';

import { createPoolModule } from '../internal/module.js';
import { ProcessTracker } from '../process-tracker.js';

const silentLogger = pino({ level: 'silent' });
const INDEX = readFileSync('server/index.ts', 'utf8');

describe('[Phase 20-03] pool lifecycle ownership (SC2)', () => {
  it('[SC2 grep-guard] server/index.ts does NOT call healthChecker.start or startReaper', () => {
    expect(INDEX).not.toMatch(/app\.healthChecker\.start\b/);
    expect(INDEX).not.toMatch(/startReaper\b/);
  });

  it('[SC2 grep-guard] server/index.ts does NOT call healthChecker.stop or processTracker.stop directly', () => {
    expect(INDEX).not.toMatch(/app\.healthChecker\.stop\(\)/);
    expect(INDEX).not.toMatch(/app\.processTracker\.stop\(\)/);
  });

  it('[SC2 grep-guard] server/index.ts does NOT log "Health checker started" or "Process reaper started"', () => {
    expect(INDEX).not.toContain('Health checker started');
    expect(INDEX).not.toContain('Process reaper started');
    expect(INDEX).not.toContain('Health checker stopped');
    expect(INDEX).not.toContain('Process reaper stopped');
  });

  it('[SC2] module.registerWorkersAndSubscribers + shutdown preserve healthChecker lifecycle symmetry', async () => {
    const fastify: any = {
      boss: { createQueue: vi.fn().mockResolvedValue(undefined), offWork: vi.fn().mockResolvedValue(undefined) },
      queue: { schedule: vi.fn().mockResolvedValue(undefined), work: vi.fn().mockResolvedValue('w-1'), send: vi.fn() },
      log: silentLogger,
    };
    const processTracker = new ProcessTracker(silentLogger);
    vi.spyOn(processTracker, 'reapOrphans').mockResolvedValue(undefined);
    const module = createPoolModule({
      fastify, db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) } as never,
      config: { pool: { android: { enabled: false, max_instances: 0 }, ios: { enabled: false, max_instances: 0 } } } as never,
      logger: silentLogger, processTracker,
    });
    const startSpy = vi.spyOn(module.healthChecker, 'start');
    const stopSpy  = vi.spyOn(module.healthChecker, 'stop');

    await module.registerWorkersAndSubscribers();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(30_000);

    await module.shutdown();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(fastify.boss.offWork).toHaveBeenCalledWith('w-1');
  });

  it('[SC2] pool plugin declares dependencies: config, db, queue, event-bus', () => {
    const PLUGIN = readFileSync('server/pool/plugin.ts', 'utf8');
    expect(PLUGIN).toMatch(/dependencies:\s*\[\s*'config'\s*,\s*'db'\s*,\s*'queue'\s*,\s*'event-bus'\s*\]/);
  });
});
