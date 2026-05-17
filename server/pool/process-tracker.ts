import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import { isProcessAlive, getProcessStat, isZombieStat } from './zombie-detector.js';

type ExecFileFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile: ExecFileFn = promisify(nodeExecFile);

export interface OrphanInfo {
  pid: number;
  stat: string;
  isZombie: boolean;
}

export interface KillResult {
  killed: boolean;
  isZombie: boolean;
}

export class ProcessTracker {
  private readonly pids: Map<string, number> = new Map();
  private readonly logger: pino.Logger;
  private readonly execFile: ExecFileFn;

  constructor(logger: pino.Logger, execFile?: ExecFileFn) {
    this.logger = logger.child({ component: 'process-tracker' });
    this.execFile = execFile ?? defaultExecFile;
  }

  register(deviceId: string, pid: number): void {
    this.pids.set(deviceId, pid);
    this.logger.info({ deviceId, pid }, 'Registered process');
  }

  unregister(deviceId: string): void {
    this.pids.delete(deviceId);
    this.logger.info({ deviceId }, 'Unregistered process');
  }

  getTrackedPids(): Map<string, number> {
    return new Map(this.pids);
  }

  async killProcess(deviceId: string): Promise<KillResult> {
    const pid = this.pids.get(deviceId);
    if (pid === undefined) {
      this.logger.warn({ deviceId }, 'No PID found for device');
      return { killed: false, isZombie: false };
    }

    try {
      process.kill(-pid, 'SIGTERM');
      this.logger.info({ deviceId, pid }, 'Sent SIGTERM to process group');
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        this.logger.info({ deviceId, pid }, 'Process already dead');
        this.unregister(deviceId);
        return { killed: true, isZombie: false };
      } else {
        this.logger.error({ deviceId, pid, error: err.message }, 'Failed to kill process');
        throw err;
      }
    }

    // Wait 5s then escalate to SIGKILL
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      process.kill(-pid, 'SIGKILL');
      this.logger.info({ deviceId, pid }, 'Sent SIGKILL to process group');
    } catch {
      // Process already dead -- expected after SIGTERM
    }

    // Verify death after SIGKILL
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (isProcessAlive(pid)) {
      // Check if zombie
      const stat = await getProcessStat(pid);
      if (stat && isZombieStat(stat)) {
        this.logger.warn({ deviceId, pid, stat }, 'Process is zombie (uninterruptible sleep)');
        this.unregister(deviceId);
        return { killed: false, isZombie: true };
      }
      // Alive but not zombie — unusual
      this.logger.warn({ deviceId, pid }, 'Process still alive after SIGKILL');
      this.unregister(deviceId);
      return { killed: false, isZombie: false };
    }

    this.unregister(deviceId);
    return { killed: true, isZombie: false };
  }

  killAll(): void {
    for (const [deviceId] of this.pids) {
      const pid = this.pids.get(deviceId);
      if (pid === undefined) continue;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch (err: any) {
        if (err.code !== 'ESRCH') {
          this.logger.error({ deviceId, pid, error: err.message }, 'Failed to kill process');
        }
      }
      // Schedule SIGKILL escalation
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }
    this.pids.clear();
  }

  async scanOrphans(): Promise<OrphanInfo[]> {
    const trackedPids = new Set(this.pids.values());
    const orphans: OrphanInfo[] = [];

    try {
      // Use pgid to identify children of tracked emulator processes.
      // Emulators are spawned with detached:true, so the tracked PID is
      // the process group leader — child qemu processes share the same PGID.
      const { stdout } = await this.execFile('ps', ['axo', 'pid,pgid,stat,command']);
      const lines = stdout.split('\n');

      for (const line of lines) {
        if (/qemu-system|emulator|Android[/ ]emulator/i.test(line)) {
          const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+/);
          if (!match) continue;
          const pid = parseInt(match[1], 10);
          const pgid = parseInt(match[2], 10);
          const stat = match[3];
          // Skip if the PID itself is tracked, or if its process group leader is tracked
          if (!isNaN(pid) && !trackedPids.has(pid) && !trackedPids.has(pgid)) {
            orphans.push({ pid, stat, isZombie: isZombieStat(stat) });
          }
        }
      }
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Failed to scan for orphan processes');
    }

    // Scan for orphan iOS simulators
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await this.execFile('xcrun', ['simctl', 'list', 'devices', '-j']);
        const data = JSON.parse(stdout);
        for (const runtime of Object.values(data.devices) as any[]) {
          for (const device of runtime) {
            if (device.state === 'Booted') {
              this.logger.debug({ udid: device.udid, name: device.name }, 'Found booted simulator');
            }
          }
        }
      } catch {
        // xcrun not available (non-macOS) or no simulators
      }
    }

    return orphans;
  }

  async reapOrphans(): Promise<void> {
    const orphans = await this.scanOrphans();
    let zombieCount = 0;

    for (const orphan of orphans) {
      if (orphan.isZombie) {
        zombieCount++;
        this.logger.warn({ pid: orphan.pid, stat: orphan.stat }, 'Skipping zombie orphan (unkillable)');
        continue;
      }

      try {
        process.kill(orphan.pid, 'SIGTERM');
        this.logger.info({ pid: orphan.pid }, 'Sent SIGTERM to orphan emulator process');
      } catch (err: any) {
        if (err.code !== 'ESRCH') {
          this.logger.error({ pid: orphan.pid, error: err.message }, 'Failed to kill orphan');
        }
        continue;
      }

      // Escalate to SIGKILL after 5s
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        process.kill(orphan.pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }

    if (zombieCount > 0) {
      this.logger.warn({ zombieCount }, 'Zombie orphan processes detected (require reboot to clear)');
    }
  }

  /**
   * No-op retained for back-compat — Phase 20: reaper moved to pg-boss
   * (server/pool/queue.ts). The schedule is drained by `poolModule.shutdown`
   * via `fastify.boss.offWork`. PoolManager.shutdown still calls this method
   * to keep its historical call sequence stable.
   */
  stop(): void {
    // Phase 20: reaper moved to pg-boss (server/pool/queue.ts). No interval to clear.
  }
}
