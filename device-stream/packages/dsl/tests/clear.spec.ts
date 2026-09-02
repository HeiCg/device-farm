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
  return new DeviceStreamSessionImpl(driver, { serial: driver.serial, platform: driver.platform });
}

describe('ElementHandle.clear (B1)', () => {
  it('taps the field then clears via clearText, never pressing BACK', async () => {
    const el = uiel({ id: 'search', text: 'hello' });
    const d = fakeDriver({ hierarchy: vi.fn(async () => [el]) });

    await session(d).get({ id: 'search' }).clear();

    expect(d.tap).toHaveBeenCalledTimes(1);
    expect(d.clearText).toHaveBeenCalledTimes(1);
    // The old implementation fired pressKey('back') 50× — assert it never happens.
    expect(d.pressKey).not.toHaveBeenCalled();
    for (const call of (d.pressKey as any).mock.calls) {
      expect(call[0]).not.toBe('back');
    }
  });
});
