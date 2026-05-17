import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { CameraSession, type CameraStateEvent } from '../src/camera-session.js';
import { VirtualCameraInstaller } from '../src/virtual-camera-installer.js';

interface FakeProc extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeProc(): FakeProc {
  const ee = new EventEmitter() as FakeProc;
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.stdin = new PassThrough();
  ee.kill = vi.fn((_sig?: NodeJS.Signals | number) => {
    // Emit exit asynchronously to mimic real child-process behaviour.
    setImmediate(() => ee.emit('exit', null, 'SIGTERM'));
    return true;
  });
  return ee;
}

describe('CameraSession', () => {
  let tmpRoot: string;
  let installer: VirtualCameraInstaller;

  function buildInstaller(): VirtualCameraInstaller {
    const srcDylib = `${tmpRoot}/VirtualCamera.dylib`;
    fs.writeFileSync(srcDylib, Buffer.from('test dylib bytes'));
    return new VirtualCameraInstaller({
      dylibPath: srcDylib,
      cacheRoot: `${tmpRoot}/cache`,
    });
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camsess-test-'));
    installer = buildInstaller();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('list() spawns sim-cam --list and parses the JSON array', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    const promise = session.list();
    await new Promise((r) => setImmediate(r));

    expect(spawn).toHaveBeenCalledWith('/fake/sim-cam', ['--list']);

    proc.stdout.write(JSON.stringify([
      { uid: 'CAM-1', name: 'FaceTime', modelID: 'apple:1', localizedName: 'FaceTime HD' },
      { uid: 'CAM-2', name: 'iPhone', modelID: 'apple:2', localizedName: 'iPhone Continuity' },
    ]));
    proc.emit('exit', 0, null);

    const devices = await promise;
    expect(devices).toHaveLength(2);
    expect(devices[0]!.uid).toBe('CAM-1');
    expect(devices[1]!.localizedName).toBe('iPhone Continuity');
  });

  it('list() rejects on non-zero exit', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    const promise = session.list();
    await new Promise((r) => setImmediate(r));
    proc.stderr.write('no cameras found\n');
    proc.emit('exit', 1, null);

    await expect(promise).rejects.toThrow(/exited with code 1/);
  });

  it('start() emits state: streaming and stop() emits state: idle', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    const events: CameraStateEvent[] = [];
    session.on('state', (e) => events.push(e));

    await session.start('UDID-A', {
      deviceUID: 'CAM-1',
      fit: 'fill',
      mirror: true,
      width: 1280,
      height: 720,
      fps: 30,
    });

    expect(spawn).toHaveBeenCalledWith('/fake/sim-cam', [
      '--device-uid', 'CAM-1',
      '--shm-path', '/tmp/SimCam.bgra',
      '--width', '1280',
      '--height', '720',
      '--fps', '30',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ udid: 'UDID-A', phase: 'streaming', device: 'CAM-1', fps: 30 });

    const stopPromise = session.stop('UDID-A');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    await stopPromise;

    expect(events.at(-1)).toMatchObject({ udid: 'UDID-A', phase: 'idle' });
    expect(session.getPhase('UDID-A')).toEqual({ phase: 'idle' });
  });

  it('start() is a no-op when the UDID is already streaming', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    await session.start('UDID-A', { deviceUID: 'CAM-1', fit: 'fit', mirror: false });
    await session.start('UDID-A', { deviceUID: 'CAM-2', fit: 'fit', mirror: false });

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('getInjectionEnv returns {} when idle and the dylib path when streaming', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    expect(await session.getInjectionEnv('UDID-A')).toEqual({});

    await session.start('UDID-A', { deviceUID: 'CAM-1', fit: 'fit', mirror: false });
    const env = await session.getInjectionEnv('UDID-A');
    expect(env.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES).toMatch(/VirtualCamera\.dylib$/);
    expect(fs.existsSync(env.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES!)).toBe(true);
  });

  it('setFlags() mutates the active session flags without restarting', async () => {
    const proc = makeFakeProc();
    const spawn = vi.fn().mockReturnValue(proc);
    const session = new CameraSession({
      simCamBinary: '/fake/sim-cam',
      installer,
      spawn: spawn as any,
    });

    await session.start('UDID-A', { deviceUID: 'CAM-1', fit: 'fit', mirror: false });
    expect(session.getFlags('UDID-A')).toEqual({ fit: 'fit', mirror: false });

    await session.setFlags('UDID-A', { fit: 'fill', mirror: true });
    expect(session.getFlags('UDID-A')).toEqual({ fit: 'fill', mirror: true });
    // Did not spawn a second child.
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
