import { describe, it, expect, vi } from 'vitest';
import {
  scanProcessesFromOutput,
  isZombieStat,
  isProcessAlive,
} from '../zombie-detector.js';

const PS_OUTPUT = `  PID STAT COMMAND
12345 UEs  /opt/homebrew/bin/qemu-system-aarch64 -avd android-1 -port 5554 -no-window
12346 Sl+  /opt/homebrew/bin/qemu-system-aarch64 -avd android-2 -port 5556 -no-window
12347 S    /usr/bin/node server.js
12348 Us+  /opt/homebrew/bin/qemu-system-aarch64 -avd android-3 -port 5558
99999 S+   /usr/local/bin/emulator @Pixel_7 -port 5560 -no-audio`;

describe('zombie-detector', () => {
  describe('scanProcessesFromOutput', () => {
    it('parses qemu/emulator lines and ignores non-emulator processes', () => {
      const procs = scanProcessesFromOutput(PS_OUTPUT);
      expect(procs).toHaveLength(4);
      expect(procs.map((p) => p.pid)).toEqual([12345, 12346, 12348, 99999]);
    });

    it('extracts pid, stat, port, and avdName correctly', () => {
      const procs = scanProcessesFromOutput(PS_OUTPUT);
      expect(procs[0]).toEqual({ pid: 12345, stat: 'UEs', port: 5554, avdName: 'android-1' });
      expect(procs[1]).toEqual({ pid: 12346, stat: 'Sl+', port: 5556, avdName: 'android-2' });
    });

    it('handles emulator lines without -avd flag', () => {
      const output = '  PID STAT COMMAND\n77777 Sl   /usr/local/bin/emulator -port 5570 -no-audio\n';
      const procs = scanProcessesFromOutput(output);
      expect(procs).toHaveLength(1);
      expect(procs[0]).toEqual({ pid: 77777, stat: 'Sl', port: 5570, avdName: null });
    });

    it('handles lines without -port flag', () => {
      const output = '55555 S  /path/to/qemu-system-aarch64 -avd test-device\n';
      const procs = scanProcessesFromOutput(output);
      expect(procs).toHaveLength(1);
      expect(procs[0]).toEqual({ pid: 55555, stat: 'S', port: null, avdName: 'test-device' });
    });

    it('returns empty array for empty input', () => {
      expect(scanProcessesFromOutput('')).toEqual([]);
    });

    it('skips the header line even if it contains emulator text', () => {
      const output = '  PID STAT COMMAND\n';
      expect(scanProcessesFromOutput(output)).toEqual([]);
    });
  });

  describe('isZombieStat', () => {
    it('returns true for stats containing "U"', () => {
      expect(isZombieStat('UEs')).toBe(true);
      expect(isZombieStat('Us+')).toBe(true);
      expect(isZombieStat('U')).toBe(true);
    });

    it('returns false for healthy stats', () => {
      expect(isZombieStat('Sl')).toBe(false);
      expect(isZombieStat('S+')).toBe(false);
      expect(isZombieStat('S')).toBe(false);
      expect(isZombieStat('Rl')).toBe(false);
    });
  });

  describe('isProcessAlive', () => {
    it('returns true when process.kill succeeds', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      expect(isProcessAlive(12345)).toBe(true);
      expect(spy).toHaveBeenCalledWith(12345, 0);
      spy.mockRestore();
    });

    it('returns false when process.kill throws', () => {
      const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      expect(isProcessAlive(12345)).toBe(false);
      spy.mockRestore();
    });
  });

  describe('integration: mixed zombie and healthy processes', () => {
    it('identifies zombie vs healthy processes from ps output', () => {
      const procs = scanProcessesFromOutput(PS_OUTPUT);
      const zombies = procs.filter((p) => isZombieStat(p.stat));
      const healthy = procs.filter((p) => !isZombieStat(p.stat));

      expect(zombies).toHaveLength(2);
      expect(zombies.map((z) => z.pid)).toEqual([12345, 12348]);
      expect(zombies.map((z) => z.port)).toEqual([5554, 5558]);
      expect(zombies.map((z) => z.avdName)).toEqual(['android-1', 'android-3']);

      expect(healthy).toHaveLength(2);
      expect(healthy.map((h) => h.pid)).toEqual([12346, 99999]);
    });

    it('collects zombie ports and avdNames like getZombieInfo would', () => {
      const procs = scanProcessesFromOutput(PS_OUTPUT);
      const ports = new Set<number>();
      const avdNames = new Set<string>();

      for (const proc of procs) {
        if (isZombieStat(proc.stat)) {
          if (proc.port !== null) ports.add(proc.port);
          if (proc.avdName !== null) avdNames.add(proc.avdName);
        }
      }

      expect(ports).toEqual(new Set([5554, 5558]));
      expect(avdNames).toEqual(new Set(['android-1', 'android-3']));
    });
  });
});
