import { describe, it, expect, vi } from 'vitest';
import { ScrcpyService } from '../src/scrcpy-service.js';

describe('ScrcpyService runtime tuning stubs', () => {
  it('setBitrate stores the bitrate in queued targets', async () => {
    const svc = new ScrcpyService();
    await svc.setBitrate('emulator-5554', 8_000_000);
    expect(svc.getQueuedTargets('emulator-5554')).toEqual({ bitrate: 8_000_000 });
  });

  it('multiple setters merge per-serial', async () => {
    const svc = new ScrcpyService();
    await svc.setBitrate('emulator-5554', 4_000_000);
    await svc.setFps('emulator-5554', 30);
    await svc.setScale('emulator-5554', 0.5);
    const t = svc.getQueuedTargets('emulator-5554');
    expect(t?.bitrate).toBe(4_000_000);
    expect(t?.fps).toBe(30);
    expect(t?.maxSize).toBe(540);
  });

  it('targets are isolated per serial', async () => {
    const svc = new ScrcpyService();
    await svc.setBitrate('A', 1_000_000);
    await svc.setBitrate('B', 2_000_000);
    expect(svc.getQueuedTargets('A')?.bitrate).toBe(1_000_000);
    expect(svc.getQueuedTargets('B')?.bitrate).toBe(2_000_000);
  });

  it('forceIdr is a no-op and resolves cleanly', async () => {
    const svc = new ScrcpyService();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(svc.forceIdr('emulator-5554')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
