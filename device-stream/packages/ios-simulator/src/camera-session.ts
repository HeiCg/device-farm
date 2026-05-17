/**
 * CameraSession — orchestrates the host-camera streaming pipeline for
 * one or more simulator UDIDs.
 *
 *   • `list()`              → spawns `sim-cam --list`, parses JSON.
 *   • `start(udid, opts)`   → installs the dylib, spawns a long-lived
 *                             sim-cam child per UDID. Emits `state`.
 *   • `stop(udid)`          → SIGTERM, await exit. Emits `state: idle`.
 *   • `setFlags(udid, ...)` → stash flags for the NEXT start. The
 *                             sim-cam binary takes no runtime IPC for
 *                             flags yet; flags ship via the frame
 *                             header from the sink writer.
 *   • `getInjectionEnv(udid)` → env vars the caller should set on the
 *                               next `simctl spawn` so the app loads
 *                               the VirtualCamera dylib.
 *
 * Ported from baguette (Apache-2.0):
 *   Sources/Baguette/Domain/Camera/CameraSession.swift
 *   Sources/Baguette/Infrastructure/Camera/CameraSession.swift
 */

import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import {
  type CameraDevice,
  type CameraFit,
  type CameraFlags,
  DEFAULT_CAMERA_FLAGS,
} from './camera-message.js';
import { VirtualCameraInstaller } from './virtual-camera-installer.js';

export type SpawnLike = typeof nodeSpawn;

export interface CameraSessionOptions {
  /** Path to the sim-cam binary. */
  simCamBinary?: string;
  /** Shared-memory file the dylib reads from. */
  shmPath?: string;
  /** Installer to use; defaults to a fresh `VirtualCameraInstaller`. */
  installer?: VirtualCameraInstaller;
  /** DI hook for tests. */
  spawn?: SpawnLike;
}

export interface CameraStartOptions {
  deviceUID: string;
  fit: CameraFit;
  mirror: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

export interface CameraStateEvent {
  udid: string;
  phase: 'idle' | 'streaming';
  device?: string;
  fps?: number;
}

interface ActiveSession {
  proc: ChildProcess;
  deviceUID: string;
  flags: CameraFlags;
}

const DEFAULT_SIMCAM_BINARY = path.resolve(
  __dirname,
  '../../../tools/sim-cam/.build/release/sim-cam'
);

const DEFAULT_SHM_PATH = '/tmp/SimCam.bgra';

export interface CameraSessionEvents {
  state: (event: CameraStateEvent) => void;
}

export class CameraSession extends EventEmitter {
  readonly simCamBinary: string;
  readonly shmPath: string;
  readonly installer: VirtualCameraInstaller;

  private readonly spawnFn: SpawnLike;
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(opts: CameraSessionOptions = {}) {
    super();
    this.simCamBinary = opts.simCamBinary ?? DEFAULT_SIMCAM_BINARY;
    this.shmPath = opts.shmPath ?? DEFAULT_SHM_PATH;
    this.installer = opts.installer ?? new VirtualCameraInstaller();
    this.spawnFn = opts.spawn ?? nodeSpawn;
  }

  // ---- public surface ----

  /** Enumerate host cameras via `sim-cam --list`. */
  list(): Promise<CameraDevice[]> {
    return new Promise<CameraDevice[]>((resolve, reject) => {
      const proc = this.spawnFn(this.simCamBinary, ['--list']);
      let stdout = '';
      let stderr = '';
      proc.stdout?.setEncoding('utf-8');
      proc.stderr?.setEncoding('utf-8');
      proc.stdout?.on('data', (chunk: string) => { stdout += chunk; });
      proc.stderr?.on('data', (chunk: string) => { stderr += chunk; });
      proc.on('error', (err) => reject(err));
      proc.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`sim-cam --list exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as CameraDevice[];
          if (!Array.isArray(parsed)) {
            reject(new Error('sim-cam --list did not return a JSON array'));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error(`sim-cam --list parse error: ${(err as Error).message}`));
        }
      });
    });
  }

  /**
   * Spawn a sim-cam child for `udid`, capturing from `deviceUID`. The
   * dylib is installed lazily on first call. No-op if `udid` is
   * already streaming.
   */
  async start(udid: string, opts: CameraStartOptions): Promise<void> {
    if (this.sessions.has(udid)) {
      return;
    }
    await this.installer.install();

    const args = [
      '--device-uid', opts.deviceUID,
      '--shm-path', this.shmPath,
    ];
    if (opts.width !== undefined) args.push('--width', String(opts.width));
    if (opts.height !== undefined) args.push('--height', String(opts.height));
    if (opts.fps !== undefined) args.push('--fps', String(opts.fps));

    const proc = this.spawnFn(this.simCamBinary, args);
    const flags: CameraFlags = { fit: opts.fit, mirror: opts.mirror };
    const session: ActiveSession = { proc, deviceUID: opts.deviceUID, flags };
    this.sessions.set(udid, session);

    proc.stderr?.setEncoding('utf-8');
    let errBuf = '';
    proc.stderr?.on('data', (chunk: string) => {
      errBuf += chunk;
      let idx: number;
      while ((idx = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, idx);
        errBuf = errBuf.slice(idx + 1);
        if (line.length === 0) continue;
        console.error('[sim-cam %s] %s', udid, line);
      }
    });

    proc.on('exit', (code, signal) => {
      const current = this.sessions.get(udid);
      if (current !== session) return;
      this.sessions.delete(udid);
      this.emit('state', {
        udid,
        phase: 'idle',
      } satisfies CameraStateEvent);
      if (code !== null && code !== 0) {
        console.error('[sim-cam %s] exited with code %d', udid, code);
      } else if (signal) {
        console.error('[sim-cam %s] exited with signal %s', udid, signal);
      }
    });

    proc.on('error', (err) => {
      const current = this.sessions.get(udid);
      if (current !== session) return;
      this.sessions.delete(udid);
      console.error('[sim-cam %s] spawn error: %s', udid, err.message);
      this.emit('state', { udid, phase: 'idle' } satisfies CameraStateEvent);
    });

    this.emit('state', {
      udid,
      phase: 'streaming',
      device: opts.deviceUID,
      fps: opts.fps,
    } satisfies CameraStateEvent);
  }

  /** SIGTERM the sim-cam child for `udid` and wait for it to exit. */
  async stop(udid: string): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session) return;

    return new Promise<void>((resolve) => {
      const onExit = () => {
        // The 'exit' handler installed in start() drops the session +
        // emits the state event; we just need to resolve.
        resolve();
      };
      session.proc.once('exit', onExit);
      try {
        session.proc.kill('SIGTERM');
      } catch {
        // already dead — the exit listener may not fire, force resolve.
        this.sessions.delete(udid);
        this.emit('state', { udid, phase: 'idle' } satisfies CameraStateEvent);
        resolve();
      }
    });
  }

  /**
   * Update display flags for an active session. Flags are stashed for
   * the next frame written (sim-cam itself reads stdin? — no, the
   * frame sink applies them). Currently a no-op on the wire because
   * sim-cam writes flag bits via the frame header; this method exists
   * so consumers can update preferences without restarting.
   */
  async setFlags(udid: string, opts: { fit?: CameraFit; mirror?: boolean }): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session) return;
    if (opts.fit !== undefined) session.flags.fit = opts.fit;
    if (opts.mirror !== undefined) session.flags.mirror = opts.mirror;
  }

  /**
   * Env vars to set on the next `simctl spawn` invocation. Returns
   * `{}` when no session is active for `udid`.
   */
  async getInjectionEnv(udid: string): Promise<Record<string, string>> {
    if (!this.sessions.has(udid)) return {};
    const installed = this.installer.current() ?? (await this.installer.install());
    return {
      SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: installed.installedPath,
    };
  }

  /** Snapshot of the current flags for `udid`, or defaults. */
  getFlags(udid: string): CameraFlags {
    const session = this.sessions.get(udid);
    return session ? { ...session.flags } : { ...DEFAULT_CAMERA_FLAGS };
  }

  /** Phase + active device for `udid`. */
  getPhase(udid: string): { phase: 'idle' | 'streaming'; device?: string } {
    const session = this.sessions.get(udid);
    if (!session) return { phase: 'idle' };
    return { phase: 'streaming', device: session.deviceUID };
  }

  /** Stop every active session — useful for graceful shutdown. */
  async stopAll(): Promise<void> {
    const udids = Array.from(this.sessions.keys());
    await Promise.all(udids.map((u) => this.stop(u)));
  }
}
