import { describe, it, expect, vi } from 'vitest';
import { ControlChannel } from '../src/control-channel.js';

describe('ControlChannel.handle', () => {
  it('routes set_fps to onFps with the requested value', () => {
    const onFps = vi.fn();
    const cc = new ControlChannel({ onFps, onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_fps', fps: 30 });
    expect(onFps).toHaveBeenCalledWith(30);
  });

  it('clamps set_fps to [1, 120]', () => {
    const onFps = vi.fn();
    const cc = new ControlChannel({ onFps, onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_fps', fps: 9999 });
    cc.handle({ type: 'set_fps', fps: -5 });
    expect(onFps).toHaveBeenNthCalledWith(1, 120);
    expect(onFps).toHaveBeenNthCalledWith(2, 1);
  });

  it('routes set_bitrate to onBitrate with min 100kbps', () => {
    const onBitrate = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate, onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot: vi.fn() });
    cc.handle({ type: 'set_bitrate', bps: 50 });
    expect(onBitrate).toHaveBeenCalledWith(100_000);
  });

  it('routes force_idr to onForceIdr (no payload)', () => {
    const onForceIdr = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr, onSnapshot: vi.fn() });
    cc.handle({ type: 'force_idr' });
    expect(onForceIdr).toHaveBeenCalledOnce();
  });

  it('routes snapshot to onSnapshot', () => {
    const onSnapshot = vi.fn();
    const cc = new ControlChannel({ onFps: vi.fn(), onBitrate: vi.fn(), onScale: vi.fn(), onForceIdr: vi.fn(), onSnapshot });
    cc.handle({ type: 'snapshot' });
    expect(onSnapshot).toHaveBeenCalledOnce();
  });
});
