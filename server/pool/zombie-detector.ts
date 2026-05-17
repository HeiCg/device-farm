/**
 * Zombie QEMU detector for macOS.
 * Detects qemu/emulator processes stuck in uninterruptible sleep ("U" in STAT).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  stat: string;
  port: number | null;
  avdName: string | null;
}

export interface ZombieInfo {
  ports: Set<number>;
  avdNames: Set<string>;
}

/**
 * Parse `ps axo pid,stat,command` output into ProcessInfo entries
 * for qemu/emulator processes.
 */
export function scanProcessesFromOutput(psOutput: string): ProcessInfo[] {
  const results: ProcessInfo[] = [];
  const lines = psOutput.split('\n');

  for (const line of lines) {
    if (!/qemu-system|emulator/i.test(line)) continue;
    // Skip the header
    if (/^\s*PID/i.test(line)) continue;

    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const stat = match[2];
    const command = match[3];

    // Extract port from `-port <number>`
    const portMatch = command.match(/-port\s+(\d+)/);
    const port = portMatch ? parseInt(portMatch[1], 10) : null;

    // Extract AVD name from `-avd <name>`
    const avdMatch = command.match(/-avd\s+(\S+)/);
    const avdName = avdMatch ? avdMatch[1] : null;

    results.push({ pid, stat, port, avdName });
  }

  return results;
}

/**
 * Returns true if the STAT column indicates uninterruptible sleep.
 * On macOS, "U" in the stat string means uninterruptible wait.
 */
export function isZombieStat(stat: string): boolean {
  return stat.includes('U');
}

/**
 * Scan running processes and return ports/AVD names held by zombies.
 */
export async function getZombieInfo(): Promise<ZombieInfo> {
  const procs = await scanProcesses();
  const ports = new Set<number>();
  const avdNames = new Set<string>();

  for (const proc of procs) {
    if (isZombieStat(proc.stat)) {
      if (proc.port !== null) ports.add(proc.port);
      if (proc.avdName !== null) avdNames.add(proc.avdName);
    }
  }

  return { ports, avdNames };
}

/**
 * Run `ps axo pid,stat,command` and parse output.
 */
export async function scanProcesses(): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['axo', 'pid,stat,command']);
    return scanProcessesFromOutput(stdout);
  } catch {
    return [];
  }
}

/**
 * Check if a process is alive via kill(pid, 0).
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the STAT column for a specific PID.
 */
export async function getProcessStat(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'stat=', '-p', String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
