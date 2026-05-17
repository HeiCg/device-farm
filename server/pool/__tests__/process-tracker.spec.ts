import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessTracker } from '../process-tracker.js';
import pino from 'pino';

vi.mock('../zombie-detector.js', () => ({
  isProcessAlive: vi.fn().mockReturnValue(false),
  getProcessStat: vi.fn().mockResolvedValue(null),
  isZombieStat: vi.fn().mockReturnValue(false),
}));

function createLogger(): any {
  return pino({ level: 'silent' });
}

function createMockExecFile(responses: Record<string, { stdout: string; stderr: string }> = {}) {
  return vi.fn().mockImplementation(async (cmd: string, _args: string[]) => {
    if (responses[cmd]) return responses[cmd];
    return { stdout: '', stderr: '' };
  });
}

describe('ProcessTracker', () => {
  let tracker: ProcessTracker;
  let logger: any;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createLogger();
    tracker = new ProcessTracker(logger);
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    tracker.stop();
    killSpy.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('register / unregister', () => {
    it('register(deviceId, pid) stores the PID mapping', () => {
      tracker.register('device-1', 12345);
      const pids = tracker.getTrackedPids();
      expect(pids.get('device-1')).toBe(12345);
    });

    it('unregister(deviceId) removes the PID mapping', () => {
      tracker.register('device-1', 12345);
      tracker.unregister('device-1');
      const pids = tracker.getTrackedPids();
      expect(pids.has('device-1')).toBe(false);
    });
  });

  describe('killProcess', () => {
    it('sends SIGTERM to process group and returns KillResult', async () => {
      tracker.register('device-1', 12345);
      const promise = tracker.killProcess('device-1');

      // Advance past the 5s SIGKILL wait + 1s alive check
      await vi.advanceTimersByTimeAsync(6000);
      const result = await promise;

      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      expect(result).toEqual({ killed: true, isZombie: false });
    });

    it('unregisters after kill', async () => {
      tracker.register('device-1', 12345);
      const promise = tracker.killProcess('device-1');
      await vi.advanceTimersByTimeAsync(6000);
      await promise;

      const pids = tracker.getTrackedPids();
      expect(pids.has('device-1')).toBe(false);
    });

    it('handles ESRCH (process already dead) gracefully', async () => {
      tracker.register('device-1', 99999);
      killSpy.mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 'SIGTERM') {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = await tracker.killProcess('device-1');
      expect(result).toEqual({ killed: true, isZombie: false });
    });

    it('rethrows non-ESRCH errors', async () => {
      tracker.register('device-1', 99999);
      killSpy.mockImplementation(() => {
        const err: any = new Error('EPERM');
        err.code = 'EPERM';
        throw err;
      });

      await expect(tracker.killProcess('device-1')).rejects.toThrow('EPERM');
    });
  });

  describe('killAll', () => {
    it('kills all tracked process groups', () => {
      tracker.register('device-1', 11111);
      tracker.register('device-2', 22222);
      tracker.register('device-3', 33333);

      tracker.killAll();

      expect(killSpy).toHaveBeenCalledWith(-11111, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(-22222, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(-33333, 'SIGTERM');
    });
  });

  describe('scanOrphans', () => {
    it('finds emulator processes not in the tracked set', async () => {
      const psOutput = [
        '  PID  PGID STAT COMMAND',
        '10001 10001 Sl   /path/to/emulator -avd test',
        '10002 10002 Sl   /path/to/qemu-system-x86_64 -some-args',
        '10003 10003 S    /usr/bin/node server.js',
      ].join('\n');

      const mockExec = createMockExecFile({ ps: { stdout: psOutput, stderr: '' } });
      const trackerWithMock = new ProcessTracker(logger, mockExec);

      // Register 10001 as tracked, so only 10002 should be orphan
      trackerWithMock.register('device-1', 10001);

      const orphans = await trackerWithMock.scanOrphans();
      expect(orphans).toHaveLength(1);
      expect(orphans[0].pid).toBe(10002);
      expect(orphans[0].isZombie).toBe(false);
      expect(orphans.map(o => o.pid)).not.toContain(10001);
      expect(orphans.map(o => o.pid)).not.toContain(10003); // not an emulator process
    });

    it('skips child processes whose PGID matches a tracked PID', async () => {
      const psOutput = [
        '  PID  PGID STAT COMMAND',
        '10001 10001 Sl   /path/to/emulator -avd test',
        '10002 10001 Sl   /path/to/qemu-system-aarch64-headless -avd test',
        '10003 10003 Sl   /path/to/qemu-system-x86_64 -orphan',
      ].join('\n');

      const mockExec = createMockExecFile({ ps: { stdout: psOutput, stderr: '' } });
      const trackerWithMock = new ProcessTracker(logger, mockExec);

      // Track the emulator launcher (10001) — its child qemu (10002) shares PGID
      trackerWithMock.register('device-1', 10001);

      const orphans = await trackerWithMock.scanOrphans();
      // Only 10003 is a true orphan; 10002 is a child of tracked 10001
      expect(orphans).toHaveLength(1);
      expect(orphans[0].pid).toBe(10003);
    });

    it('returns empty array when ps fails', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('command not found'));
      const trackerWithMock = new ProcessTracker(logger, mockExec);

      const orphans = await trackerWithMock.scanOrphans();
      expect(orphans).toEqual([]);
    });

    it('detects zombie orphan', async () => {
      const { isZombieStat } = await import('../zombie-detector.js');
      const isZombieStatMock = isZombieStat as ReturnType<typeof vi.fn>;
      isZombieStatMock.mockImplementation((stat: string) => /Z|UEs/.test(stat));

      const psOutput = [
        '  PID  PGID STAT COMMAND',
        '20001 20001 UEs  /path/to/qemu-system-x86_64 -some-args',
        '20002 20002 Sl   /path/to/emulator -avd healthy',
      ].join('\n');

      const mockExec = createMockExecFile({ ps: { stdout: psOutput, stderr: '' } });
      const trackerWithMock = new ProcessTracker(logger, mockExec);

      const orphans = await trackerWithMock.scanOrphans();
      expect(orphans).toHaveLength(2);

      const zombie = orphans.find(o => o.pid === 20001)!;
      expect(zombie.stat).toBe('UEs');
      expect(zombie.isZombie).toBe(true);

      const healthy = orphans.find(o => o.pid === 20002)!;
      expect(healthy.stat).toBe('Sl');
      expect(healthy.isZombie).toBe(false);

      isZombieStatMock.mockReturnValue(false);
    });
  });

  describe('reapOrphans', () => {
    it('skips zombie processes', async () => {
      const psOutput = [
        '  PID  PGID STAT COMMAND',
        '30001 30001 Z    /path/to/qemu-system-x86_64 -zombie',
        '30002 30002 Sl   /path/to/emulator -avd normal',
      ].join('\n');

      const { isZombieStat } = await import('../zombie-detector.js');
      const isZombieStatMock = isZombieStat as ReturnType<typeof vi.fn>;
      isZombieStatMock.mockImplementation((stat: string) => stat.includes('Z'));

      const mockExec = createMockExecFile({ ps: { stdout: psOutput, stderr: '' } });
      const trackerWithMock = new ProcessTracker(logger, mockExec);

      const promise = trackerWithMock.reapOrphans();
      // Advance past the 5s SIGKILL escalation for the non-zombie orphan
      await vi.advanceTimersByTimeAsync(6000);
      await promise;

      // Should only kill the non-zombie (30002), not the zombie (30001)
      expect(killSpy).toHaveBeenCalledWith(30002, 'SIGTERM');
      expect(killSpy).not.toHaveBeenCalledWith(30001, 'SIGTERM');

      isZombieStatMock.mockReturnValue(false);
    });
  });

  // [Phase 20-03] Reaper describe block removed — Phase 20 migrated the
  // reaper from raw setInterval (ProcessTracker.startReaper) to pg-boss
  // schedule via server/pool/queue.ts registerPoolQueues. Coverage now lives
  // in server/pool/__tests__/module.spec.ts + lifecycle-ownership.spec.ts.
  // ProcessTracker.stop() is retained as a no-op for back-compat with
  // PoolManager.shutdown's historical call sequence.
});
