/**
 * Phase 24 / Plan 24-03 — createMaestroModule factory tests (MOD-06).
 *
 * 10 no-DB tests proving:
 *   - 7-key return shape
 *   - 3 services constructed via the right classes
 *   - bus uses maestroRegistry shape (2 entries)
 *   - emit.hierarchyFetched + emit.deviceInfoCollected are functions
 *   - registerSubscribers no-op when fastify.poolModule is undefined
 *   - registerSubscribers subscribes to device.booted on poolModule.bus when decorated
 *   - shutdown is idempotent (double-call no-throw)
 *   - shutdown calls appiumService.closeAllSessions
 *   - device.booted handler invokes deviceInfoCollector.collect with payload args
 *   - device.booted handler emits deviceInfoCollected after collect resolves
 *
 * Mocks Fastify + db + config + logger + poolModule.bus via vi.fn().
 */
import { describe, it, expect, vi } from 'vitest';
import { createMaestroModule } from '../internal/module.js';
import { AppiumService } from '../internal/appium-service.js';
import { HierarchyService } from '../internal/hierarchy-service.js';
import { DeviceInfoCollector } from '../internal/device-info-collector.js';

function makeMockDeps(opts: { withPoolModule?: boolean } = {}) {
  const busHandlers = new Map<string, (raw: unknown) => void>();
  const poolBus = {
    on: vi.fn((name: string, handler: (raw: unknown) => void) => {
      busHandlers.set(name, handler);
      return () => busHandlers.delete(name);
    }),
  };
  const fastify: any = {
    pool: { getDeviceMap: vi.fn(() => new Map()) },
    ...(opts.withPoolModule ? { poolModule: { bus: poolBus } } : {}),
  };
  const db: any = { insert: vi.fn(() => ({ values: vi.fn(async () => {}) })) };
  const config: any = { appium: { server_url: 'http://localhost:4723' } };
  const logger: any = {
    child: vi.fn(() => logger),
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  };
  return { fastify, db, config, logger, busHandlers, poolBus };
}

describe('createMaestroModule (Plan 24-03)', () => {
  it('returns 7-key shape', () => {
    const deps = makeMockDeps();
    const module = createMaestroModule(deps);
    expect(Object.keys(module).sort()).toEqual(
      ['appiumService', 'bus', 'deviceInfoCollector', 'emit', 'hierarchyService', 'registerSubscribers', 'shutdown'].sort(),
    );
  });

  it('constructs the 3 services', () => {
    const deps = makeMockDeps();
    const module = createMaestroModule(deps);
    expect(module.appiumService).toBeInstanceOf(AppiumService);
    expect(module.hierarchyService).toBeInstanceOf(HierarchyService);
    expect(module.deviceInfoCollector).toBeInstanceOf(DeviceInfoCollector);
  });

  it('bus uses maestroRegistry shape (2 entries)', () => {
    const deps = makeMockDeps();
    const module = createMaestroModule(deps);
    expect(Object.keys((module.bus as any).registry)).toHaveLength(2);
  });

  it('emit.hierarchyFetched + emit.deviceInfoCollected are functions', () => {
    const deps = makeMockDeps();
    const module = createMaestroModule(deps);
    expect(typeof module.emit.hierarchyFetched).toBe('function');
    expect(typeof module.emit.deviceInfoCollected).toBe('function');
  });

  it('registerSubscribers is no-op when fastify.poolModule is undefined', async () => {
    const deps = makeMockDeps({ withPoolModule: false });
    const module = createMaestroModule(deps);
    await expect(module.registerSubscribers()).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('poolModule.bus not decorated'),
    );
  });

  it('registerSubscribers subscribes to device.booted when poolModule.bus is decorated', async () => {
    const deps = makeMockDeps({ withPoolModule: true });
    const module = createMaestroModule(deps);
    await module.registerSubscribers();
    expect(deps.poolBus.on).toHaveBeenCalledWith('device.booted', expect.any(Function));
  });

  it('shutdown is idempotent', async () => {
    const deps = makeMockDeps({ withPoolModule: true });
    const module = createMaestroModule(deps);
    await module.registerSubscribers();
    await expect(module.shutdown()).resolves.toBeUndefined();
    await expect(module.shutdown()).resolves.toBeUndefined();
  });

  it('shutdown calls appiumService.closeAllSessions', async () => {
    const deps = makeMockDeps();
    const module = createMaestroModule(deps);
    const spy = vi.spyOn(module.appiumService, 'closeAllSessions').mockResolvedValue(undefined as any);
    await module.shutdown();
    expect(spy).toHaveBeenCalled();
  });

  it('device.booted handler calls deviceInfoCollector.collect with payload args', async () => {
    const deps = makeMockDeps({ withPoolModule: true });
    const module = createMaestroModule(deps);
    const collectSpy = vi.spyOn(module.deviceInfoCollector, 'collect')
      .mockResolvedValue({ osVersion: '14', model: 'Pixel 6' } as any);
    await module.registerSubscribers();
    const handler = deps.busHandlers.get('device.booted')!;
    await handler({
      deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      platform: 'android',
      emulatorId: 'emulator-5554',
      port: 5554,
    });
    expect(collectSpy).toHaveBeenCalledWith('android', 'emulator-5554', 5554);
  });

  it('device.booted handler emits deviceInfoCollected after collect resolves', async () => {
    const deps = makeMockDeps({ withPoolModule: true });
    const module = createMaestroModule(deps);
    vi.spyOn(module.deviceInfoCollector, 'collect')
      .mockResolvedValue({ osVersion: '14', model: 'Pixel 6' } as any);
    const emitSpy = vi.spyOn(module.emit, 'deviceInfoCollected');
    await module.registerSubscribers();
    const handler = deps.busHandlers.get('device.booted')!;
    const deviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await handler({
      deviceId,
      platform: 'android',
      emulatorId: 'emulator-5556',
      port: 5556,
    });
    expect(emitSpy).toHaveBeenCalledWith(
      deviceId,
      expect.objectContaining({ deviceId, osVersion: '14', model: 'Pixel 6' }),
    );
  });
});
