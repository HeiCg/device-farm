import { describe, it, expect, vi } from 'vitest';
import { Transport } from '../src/transport.js';

describe('Transport', () => {
  it('tap() emits a tap envelope including screen size', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.setScreenSize(438, 954);
    t.tap({ x: 219, y: 478 });
    expect(send).toHaveBeenCalledWith({
      type: 'tap', x: 219, y: 478, duration: 0.05, width: 438, height: 954,
    });
  });

  it('button() emits a button envelope', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.button({ type: 'button', button: 'home' });
    expect(send).toHaveBeenCalledWith({ type: 'button', button: 'home' });
  });

  it('touchDown() with one finger emits touch1-down', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.setScreenSize(438, 954);
    t.touchDown([{ x: 100, y: 200 }]);
    expect(send).toHaveBeenCalledWith({
      type: 'touch1-down', x: 100, y: 200, width: 438, height: 954,
    });
  });

  it('forceIdr() emits a force_idr control envelope', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.forceIdr();
    expect(send).toHaveBeenCalledWith({ type: 'force_idr' });
  });

  it('touchDown() with two fingers emits touch2-down with x1/y1/x2/y2', () => {
    const send = vi.fn();
    const t = new Transport({ send });
    t.setScreenSize(438, 954);
    t.touchDown([{ x: 100, y: 200 }, { x: 300, y: 400 }]);
    expect(send).toHaveBeenCalledWith({
      type: 'touch2-down',
      x1: 100, y1: 200,
      x2: 300, y2: 400,
      width: 438, height: 954,
    });
  });
});
