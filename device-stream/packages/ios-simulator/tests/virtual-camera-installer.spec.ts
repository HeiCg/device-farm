import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VirtualCameraInstaller } from '../src/virtual-camera-installer.js';

describe('VirtualCameraInstaller', () => {
  let tmpRoot: string;
  let srcDylib: string;
  let srcBytes: Buffer;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vci-test-'));
    srcDylib = path.join(tmpRoot, 'VirtualCamera.dylib');
    srcBytes = Buffer.from('dummy dylib payload — ' + Math.random());
    fs.writeFileSync(srcDylib, srcBytes);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('installs the dylib at <cacheRoot>/<sha256>/VirtualCamera.dylib and returns the path + hash', async () => {
    const cacheRoot = path.join(tmpRoot, 'cache');
    const installer = new VirtualCameraInstaller({ dylibPath: srcDylib, cacheRoot });
    const result = await installer.install();

    const expectedHash = crypto.createHash('sha256').update(srcBytes).digest('hex');
    expect(result.sha256).toBe(expectedHash);
    expect(result.installedPath).toBe(
      path.join(cacheRoot, expectedHash, 'VirtualCamera.dylib')
    );
    expect(fs.existsSync(result.installedPath)).toBe(true);
    const installedBytes = fs.readFileSync(result.installedPath);
    expect(installedBytes.equals(srcBytes)).toBe(true);
  });

  it('is idempotent — second install() does not rewrite the existing file', async () => {
    const cacheRoot = path.join(tmpRoot, 'cache');
    const installer = new VirtualCameraInstaller({ dylibPath: srcDylib, cacheRoot });
    const first = await installer.install();

    // Tamper with the installed file in place; the second install() should
    // see the existing path and skip the copy (content-addressed contract).
    fs.writeFileSync(first.installedPath, Buffer.from('tampered'));
    const second = await installer.install();
    expect(second.installedPath).toBe(first.installedPath);
    expect(second.sha256).toBe(first.sha256);
    // Memoised — bytes on disk stay as we left them.
    expect(fs.readFileSync(second.installedPath).toString()).toBe('tampered');
  });

  it('writes into a fresh cacheRoot (mkdirs the hash subdir)', async () => {
    const cacheRoot = path.join(tmpRoot, 'nested', 'cache', 'dir');
    const installer = new VirtualCameraInstaller({ dylibPath: srcDylib, cacheRoot });
    const result = await installer.install();
    expect(fs.existsSync(result.installedPath)).toBe(true);
  });

  it('throws when the source dylib is missing', async () => {
    const installer = new VirtualCameraInstaller({
      dylibPath: path.join(tmpRoot, 'does-not-exist.dylib'),
      cacheRoot: path.join(tmpRoot, 'cache'),
    });
    await expect(installer.install()).rejects.toThrow();
  });

  it('current() returns null until install() has been called', async () => {
    const installer = new VirtualCameraInstaller({
      dylibPath: srcDylib,
      cacheRoot: path.join(tmpRoot, 'cache'),
    });
    expect(installer.current()).toBeNull();
    await installer.install();
    expect(installer.current()).not.toBeNull();
  });
});
