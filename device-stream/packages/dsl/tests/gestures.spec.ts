import { describe, it, expect, vi } from 'vitest';
import { DeviceStreamSessionImpl } from '../src/session';
import type { Driver } from '../src/drivers/types';
import type { UIElement } from '../src/types';
import { ElementNotFoundError } from '../src/types';

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

describe('Session.swipe', () => {
  it('delegates raw coordinates to the driver', async () => {
    const d = fakeDriver();
    await session(d).swipe({ fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 250 });
    expect(d.swipe).toHaveBeenCalledWith(1, 2, 3, 4, 250);
  });
});

describe('Session.scroll', () => {
  it('scroll("down") swipes from lower to upper across screen center', async () => {
    const d = fakeDriver();
    await session(d).scroll('down');
    // 400x800 screen, default distance 0.6 centered at 0.5 -> y 640 -> 160, x 200
    expect(d.swipe).toHaveBeenCalledWith(200, 640, 200, 160, 300);
  });

  it('scroll("right") swipes from right to left across screen middle', async () => {
    const d = fakeDriver();
    await session(d).scroll('right');
    expect(d.swipe).toHaveBeenCalledWith(320, 400, 80, 400, 300);
  });
});

describe('Session.waitForIdle', () => {
  it('delegates to the driver with the given timeout', async () => {
    const d = fakeDriver();
    await session(d).waitForIdle(1234);
    expect(d.waitForIdle).toHaveBeenCalledWith(1234);
  });
});

describe('Session.scrollUntilVisible', () => {
  it('returns immediately when already present without scrolling', async () => {
    const target = uiel({ text: 'Buy', visible: true });
    const d = fakeDriver({ hierarchy: vi.fn(async () => [target]) });
    const found = await session(d).scrollUntilVisible({ text: 'Buy' });
    expect(found.text).toBe('Buy');
    expect(d.swipe).not.toHaveBeenCalled();
  });

  it('scrolls until the element appears, settling between scrolls', async () => {
    let calls = 0;
    const target = uiel({ text: 'Buy', visible: true });
    const d = fakeDriver({
      hierarchy: vi.fn(async () => (++calls >= 3 ? [target] : [])),
    });
    const found = await session(d).scrollUntilVisible({ text: 'Buy' }, { direction: 'down' });
    expect(found.text).toBe('Buy');
    expect((d.swipe as any).mock.calls.length).toBe(2); // appeared on the 3rd hierarchy read
    expect(d.waitForIdle).toHaveBeenCalled();
  });

  it('throws ElementNotFoundError after exhausting maxScrolls', async () => {
    const d = fakeDriver({ hierarchy: vi.fn(async () => []) });
    await expect(
      session(d).scrollUntilVisible({ text: 'Nope' }, { maxScrolls: 4 }),
    ).rejects.toBeInstanceOf(ElementNotFoundError);
    expect((d.swipe as any).mock.calls.length).toBe(4);
  });
});
