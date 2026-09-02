import { describe, it, expect, vi } from 'vitest';
import { DeviceStreamSessionImpl } from '../src/session';
import type { Driver } from '../src/drivers/types';
import type { UIElement } from '../src/types';

function uiel(partial: Partial<UIElement>): UIElement {
  return { bounds: { x: 0, y: 0, width: 10, height: 10 }, enabled: true, selected: false, ...partial };
}

function fakeDriver(over: Partial<Driver> = {}): Driver {
  const base: Driver = {
    platform: 'android',
    serial: 'emulator-5554',
    tap: vi.fn(async () => {}),
    longPress: vi.fn(async () => {}),
    typeText: vi.fn(async () => {}),
    clearText: vi.fn(async () => {}),
    pressKey: vi.fn(async () => {}),
    swipe: vi.fn(async () => {}),
    screenSize: vi.fn(async () => ({ width: 400, height: 800 })),
    waitForIdle: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from('')),
    hierarchy: vi.fn(async () => []),
    openUrl: vi.fn(async () => {}),
    openDownloads: vi.fn(async () => {}),
    launchApp: vi.fn(async () => {}),
    stopApp: vi.fn(async () => {}),
    installApp: vi.fn(async () => {}),
    enableInstallByThirdParty: vi.fn(async () => {}),
    grantPermissions: vi.fn(async () => {}),
    setLocation: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { ...base, ...over };
}

function session(driver: Driver) {
  return new DeviceStreamSessionImpl(driver, {
    serial: driver.serial,
    platform: driver.platform,
    pollIntervalMs: 5,
  });
}

describe('WaitHandle.changeTo (B2)', () => {
  it('detects an in-place mutation of a NESTED element (flattened traversal)', async () => {
    // A nested tree: root container -> row -> status label that flips text.
    // The mutating element is NOT a root, so a root-only `tree.some` would miss it.
    const makeTree = (statusText: string): UIElement[] => [
      uiel({
        id: 'root',
        children: [
          uiel({
            id: 'row',
            children: [uiel({ id: 'status', text: statusText })],
          }),
        ],
      }),
    ];

    let reads = 0;
    const d = fakeDriver({
      hierarchy: vi.fn(async () => (++reads >= 2 ? makeTree('Done') : makeTree('Pending'))),
    });

    await expect(
      session(d)
        .awaitUntil({ id: 'status', text: 'Pending' }, { timeoutMs: 1000 })
        .changeTo({ id: 'status', text: 'Done' }),
    ).resolves.toBeUndefined();
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('times out when the nested element never changes', async () => {
    const tree: UIElement[] = [
      uiel({ id: 'root', children: [uiel({ id: 'status', text: 'Pending' })] }),
    ];
    const d = fakeDriver({ hierarchy: vi.fn(async () => tree) });

    await expect(
      session(d)
        .awaitUntil({ id: 'status', text: 'Pending' }, { timeoutMs: 40 })
        .changeTo({ id: 'status', text: 'Done' }),
    ).rejects.toThrow(/did not change to/);
  });
});
