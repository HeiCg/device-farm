/**
 * Resolves the bundled `VirtualCamera.dylib`, fingerprints it by
 * SHA-256, and places a copy at
 *   `<cacheRoot>/<sha256>/VirtualCamera.dylib`.
 *
 * The caller arms each booted simulator with
 *   `SIMCTL_CHILD_DYLD_INSERT_LIBRARIES=<installedPath>`
 * via `xcrun simctl spawn` env propagation.
 *
 * Idempotent — if the hashed path already exists we skip the copy. The
 * path is content-addressed, so a hit implies the bytes match.
 *
 * Ported from baguette (Apache-2.0):
 *   Sources/Baguette/Infrastructure/Camera/VirtualCameraInstaller.swift
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface VirtualCameraInstallerOptions {
  /** Override the source dylib path (default: ../../../VirtualCamera/VirtualCamera.dylib). */
  dylibPath?: string;
  /** Override the cache root (default: $TMPDIR/device-stream/virtualcam). */
  cacheRoot?: string;
}

export interface InstallResult {
  /** Path to the installed dylib — pass as `DYLD_INSERT_LIBRARIES`. */
  installedPath: string;
  /** SHA-256 of the source dylib bytes. */
  sha256: string;
}

const DEFAULT_DYLIB_PATH = path.resolve(
  __dirname,
  '../../../VirtualCamera/VirtualCamera.dylib'
);

const DEFAULT_CACHE_ROOT = path.join(os.tmpdir(), 'device-stream', 'virtualcam');

export class VirtualCameraInstaller {
  readonly dylibPath: string;
  readonly cacheRoot: string;

  /** Memoised install result — `install()` re-resolves on cache miss but
   * skips the hash + copy when the same instance has already installed. */
  private cached: InstallResult | null = null;

  constructor(opts: VirtualCameraInstallerOptions = {}) {
    this.dylibPath = opts.dylibPath ?? DEFAULT_DYLIB_PATH;
    this.cacheRoot = opts.cacheRoot ?? DEFAULT_CACHE_ROOT;
  }

  /**
   * Read the source dylib, compute its SHA-256, copy it to
   * `<cacheRoot>/<sha256>/VirtualCamera.dylib` if it isn't already
   * there. Returns the installed path + hash.
   *
   * @throws if the source dylib is missing or unreadable.
   */
  async install(): Promise<InstallResult> {
    if (this.cached && fs.existsSync(this.cached.installedPath)) {
      return this.cached;
    }
    const bytes = await fs.promises.readFile(this.dylibPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const buildDir = path.join(this.cacheRoot, sha256);
    const installedPath = path.join(buildDir, 'VirtualCamera.dylib');

    if (!fs.existsSync(installedPath)) {
      await fs.promises.mkdir(buildDir, { recursive: true });
      await fs.promises.writeFile(installedPath, bytes, { mode: 0o755 });
    }

    this.cached = { installedPath, sha256 };
    return this.cached;
  }

  /** The most recent install result, or null if `install()` was never called. */
  current(): InstallResult | null {
    return this.cached;
  }
}
