/**
 * Action → primitive dispatch routing — Phase 34 Plan 34-02.
 *
 * Pure unit tests with stubbed ActionContext (no Fastify, no DB, no real
 * device). Each test asserts the exact call args reaching the injected
 * primitive (androidDevice / iosExecFileAsync / adbExecFileAsync / services).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  dispatch,
  ResolverError,
  type ActionContext,
  type ResolveTargetResult,
} from '../internal/actions.js';

// ---------- Helpers ----------

interface StubBundle {
  ctx: ActionContext;
  androidDevice: {
    tap: ReturnType<typeof vi.fn>;
    typeText: ReturnType<typeof vi.fn>;
    swipe: ReturnType<typeof vi.fn>;
    pressKey: ReturnType<typeof vi.fn>;
    launchApp: ReturnType<typeof vi.fn>;
  };
  iosExecFileAsync: ReturnType<typeof vi.fn>;
  adbExecFileAsync: ReturnType<typeof vi.fn>;
  screenshotService: { captureOnce: ReturnType<typeof vi.fn> };
  recordingService: {
    startRecording: ReturnType<typeof vi.fn>;
    stopRecording: ReturnType<typeof vi.fn>;
  };
  hierarchyService: { getHierarchy: ReturnType<typeof vi.fn> };
  artifactService: { resolveArtifactPath: ReturnType<typeof vi.fn> };
  jobExecutor: { installApk: ReturnType<typeof vi.fn> };
  resolver: { resolve: ReturnType<typeof vi.fn> };
  fetchScreenshotBytes: ReturnType<typeof vi.fn>;
}

function makeCtx(opts: {
  platform?: 'android' | 'ios';
  serial?: string;
  udid?: string;
  resolverResult?: ResolveTargetResult;
  resolverThrows?: Error;
} = {}): StubBundle {
  const platform = opts.platform ?? 'android';
  const androidDevice = {
    tap: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    swipe: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    launchApp: vi.fn(async () => undefined),
  };
  const iosExecFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const adbExecFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const screenshotService = {
    captureOnce: vi.fn(async () => ({
      id: randomUUID(),
      url: 'http://localhost/artifacts/shot.png',
      width: 1080,
      height: 1920,
    })),
  };
  const recordingService = {
    startRecording: vi.fn(async () => undefined),
    stopRecording: vi.fn(async () => undefined),
  };
  const hierarchyService = {
    getHierarchy: vi.fn(async () => '<hierarchy>...</hierarchy>'),
  };
  const artifactService = {
    resolveArtifactPath: vi.fn(async () => '/tmp/app.apk'),
  };
  const jobExecutor = {
    installApk: vi.fn(async () => undefined),
  };
  const resolver = {
    resolve: vi.fn(async (): Promise<ResolveTargetResult> => {
      if (opts.resolverThrows) throw opts.resolverThrows;
      return opts.resolverResult ?? { x: 100, y: 200, confidence: 0.9 };
    }),
  };
  const fetchScreenshotBytes = vi.fn(async () => Buffer.from('png-bytes'));

  const ctx: ActionContext = {
    session: {
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      platform,
      actor: `apikey:${randomUUID()}`,
      serial: platform === 'android' ? (opts.serial ?? 'emulator-5554') : undefined,
      udid: platform === 'ios' ? (opts.udid ?? 'AAAA-BBBB-CCCC') : undefined,
    },
    androidDevice,
    iosExecFileAsync,
    adbExecFileAsync,
    screenshotService,
    recordingService,
    hierarchyService,
    artifactService,
    jobExecutor,
    resolver,
    fetchScreenshotBytes,
  };

  return {
    ctx,
    androidDevice,
    iosExecFileAsync,
    adbExecFileAsync,
    screenshotService,
    recordingService,
    hierarchyService,
    artifactService,
    jobExecutor,
    resolver,
    fetchScreenshotBytes,
  };
}

const newId = () => randomUUID();

// ---------- Tests ----------

describe('Android dispatch routing', () => {
  let bundle: StubBundle;
  beforeEach(() => { bundle = makeCtx({ platform: 'android' }); });

  it('tap → androidDevice.tap(serial, x, y)', async () => {
    await dispatch({ id: newId(), type: 'tap', x: 540, y: 960 }, bundle.ctx);
    expect(bundle.androidDevice.tap).toHaveBeenCalledTimes(1);
    expect(bundle.androidDevice.tap).toHaveBeenCalledWith('emulator-5554', 540, 960);
  });

  it('type → androidDevice.typeText(serial, text)', async () => {
    await dispatch({ id: newId(), type: 'type', text: 'hello' }, bundle.ctx);
    expect(bundle.androidDevice.typeText).toHaveBeenCalledWith('emulator-5554', 'hello');
  });

  it('swipe → androidDevice.swipe with default durationMs=500', async () => {
    const env = await import('../internal/protocol.js').then((m) =>
      m.clientEnvelope.parse({ id: newId(), type: 'swipe', x1: 0, y1: 0, x2: 10, y2: 100 }),
    );
    await dispatch(env, bundle.ctx);
    expect(bundle.androidDevice.swipe).toHaveBeenCalledWith('emulator-5554', 0, 0, 10, 100, 500);
  });

  it.each([
    ['home', 'KEYCODE_HOME'],
    ['back', 'KEYCODE_BACK'],
    ['enter', 'KEYCODE_ENTER'],
    ['volup', 'KEYCODE_VOLUME_UP'],
    ['voldown', 'KEYCODE_VOLUME_DOWN'],
    ['power', 'KEYCODE_POWER'],
    ['menu', 'KEYCODE_MENU'],
    ['recent', 'KEYCODE_APP_SWITCH'],
  ] as const)('key:%s → androidDevice.pressKey(serial, %s)', async (code, name) => {
    await dispatch({ id: newId(), type: 'key', code }, bundle.ctx);
    expect(bundle.androidDevice.pressKey).toHaveBeenCalledWith('emulator-5554', name);
  });

  it('launchApp → androidDevice.launchApp(serial, bundleId)', async () => {
    await dispatch({ id: newId(), type: 'launchApp', bundleId: 'com.example.app' }, bundle.ctx);
    expect(bundle.androidDevice.launchApp).toHaveBeenCalledWith('emulator-5554', 'com.example.app');
  });

  it('uninstallApp → adbExecFileAsync("adb", ["-s", serial, "uninstall", bundleId])', async () => {
    await dispatch({ id: newId(), type: 'uninstallApp', bundleId: 'com.example.app' }, bundle.ctx);
    expect(bundle.adbExecFileAsync).toHaveBeenCalledWith(
      'adb',
      ['-s', 'emulator-5554', 'uninstall', 'com.example.app'],
    );
  });

  it('screenshot → screenshotService.captureOnce → ack result has artifactId+url+width+height', async () => {
    const result = await dispatch({ id: newId(), type: 'screenshot' }, bundle.ctx) as {
      artifactId: string; url: string; width: number; height: number;
    };
    expect(bundle.screenshotService.captureOnce).toHaveBeenCalledWith(
      bundle.ctx.session.deviceId, 'android',
    );
    expect(result.artifactId).toMatch(/[0-9a-f-]{36}/);
    expect(result.url).toBe('http://localhost/artifacts/shot.png');
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });

  it('screenRecord(start=true) → recordingService.startRecording', async () => {
    await dispatch({ id: newId(), type: 'screenRecord', start: true }, bundle.ctx);
    expect(bundle.recordingService.startRecording).toHaveBeenCalledWith(
      bundle.ctx.session.deviceId, 'android',
    );
    expect(bundle.recordingService.stopRecording).not.toHaveBeenCalled();
  });

  it('screenRecord(start=false) → recordingService.stopRecording', async () => {
    await dispatch({ id: newId(), type: 'screenRecord', start: false }, bundle.ctx);
    expect(bundle.recordingService.stopRecording).toHaveBeenCalled();
    expect(bundle.recordingService.startRecording).not.toHaveBeenCalled();
  });

  it('installApp → artifactService.resolveArtifactPath then jobExecutor.installApk(serial, path)', async () => {
    const artifactId = newId();
    await dispatch({ id: newId(), type: 'installApp', artifactId }, bundle.ctx);
    expect(bundle.artifactService.resolveArtifactPath).toHaveBeenCalledWith(artifactId);
    expect(bundle.jobExecutor.installApk).toHaveBeenCalledWith('emulator-5554', '/tmp/app.apk');
  });

  it('ping → returns null (no primitive call)', async () => {
    const result = await dispatch({ id: newId(), type: 'ping' }, bundle.ctx);
    expect(result).toBe(null);
    expect(bundle.androidDevice.tap).not.toHaveBeenCalled();
  });
});

// ---------- iOS path tests ----------

describe('iOS dispatch routing (xcrun simctl shell-out)', () => {
  let bundle: StubBundle;
  beforeEach(() => { bundle = makeCtx({ platform: 'ios', udid: 'UDID-1234' }); });

  it('tap → iosExecFileAsync("xcrun", ["simctl","io",udid,"touch",x,y])', async () => {
    await dispatch({ id: newId(), type: 'tap', x: 100, y: 200 }, bundle.ctx);
    expect(bundle.iosExecFileAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'io', 'UDID-1234', 'touch', '100', '200'],
    );
  });

  it('type → "input text" arg preserves spaces/special chars without shell interpolation', async () => {
    await dispatch({ id: newId(), type: 'type', text: 'foo; rm -rf /' }, bundle.ctx);
    expect(bundle.iosExecFileAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'io', 'UDID-1234', 'input', 'text', 'foo; rm -rf /'],
    );
  });

  it('launchApp → iosExecFileAsync("xcrun", ["simctl","launch",udid,bundleId])', async () => {
    await dispatch({ id: newId(), type: 'launchApp', bundleId: 'com.example.ios' }, bundle.ctx);
    expect(bundle.iosExecFileAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'launch', 'UDID-1234', 'com.example.ios'],
    );
  });

  it('uninstallApp → iosExecFileAsync("xcrun", ["simctl","uninstall",udid,bundleId])', async () => {
    await dispatch({ id: newId(), type: 'uninstallApp', bundleId: 'com.example.ios' }, bundle.ctx);
    expect(bundle.iosExecFileAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'uninstall', 'UDID-1234', 'com.example.ios'],
    );
  });

  it('installApp → resolveArtifactPath then iosExecFileAsync("xcrun", ["simctl","install",udid,path])', async () => {
    bundle.artifactService.resolveArtifactPath.mockResolvedValueOnce('/tmp/app.app');
    await dispatch({ id: newId(), type: 'installApp', artifactId: newId() }, bundle.ctx);
    expect(bundle.iosExecFileAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'install', 'UDID-1234', '/tmp/app.app'],
    );
  });
});

// ---------- tapByDescription / resolver tests ----------

describe('tapByDescription resolver flow', () => {
  it('captures screenshot + hierarchy, calls resolver, recurses as tap', async () => {
    const bundle = makeCtx({
      platform: 'android',
      resolverResult: { x: 250, y: 480, confidence: 0.92 },
    });
    await dispatch({ id: newId(), type: 'tapByDescription', target: 'Sign In' }, bundle.ctx);

    // Screenshot + hierarchy were fetched
    expect(bundle.screenshotService.captureOnce).toHaveBeenCalledWith(
      bundle.ctx.session.deviceId, 'android',
    );
    expect(bundle.hierarchyService.getHierarchy).toHaveBeenCalledWith(
      bundle.ctx.session.deviceId, 'android',
    );

    // Resolver received the right request
    expect(bundle.resolver.resolve).toHaveBeenCalledTimes(1);
    const req = bundle.resolver.resolve.mock.calls[0][0];
    expect(req.target).toBe('Sign In');
    expect(req.platform).toBe('android');
    expect(req.screenWidth).toBe(1080);
    expect(req.screenHeight).toBe(1920);
    expect(Buffer.isBuffer(req.screenshot)).toBe(true);

    // Recursion produced a real tap at the resolved point
    expect(bundle.androidDevice.tap).toHaveBeenCalledWith('emulator-5554', 250, 480);
  });

  it('throws ResolverError when confidence < 0.5', async () => {
    const bundle = makeCtx({
      platform: 'android',
      resolverResult: { x: 100, y: 200, confidence: 0.3 },
    });
    await expect(
      dispatch({ id: newId(), type: 'tapByDescription', target: 'Maybe' }, bundle.ctx),
    ).rejects.toBeInstanceOf(ResolverError);
    expect(bundle.androidDevice.tap).not.toHaveBeenCalled();
  });

  it('propagates ResolverError thrown directly by the resolver (stub default until 34-03)', async () => {
    const bundle = makeCtx({
      platform: 'android',
      resolverThrows: new ResolverError('resolver not yet wired'),
    });
    await expect(
      dispatch({ id: newId(), type: 'tapByDescription', target: 'X' }, bundle.ctx),
    ).rejects.toBeInstanceOf(ResolverError);
  });
});

// ---------- Missing-context guards ----------

describe('ActionContext guards', () => {
  it('throws when android serial missing', async () => {
    const bundle = makeCtx({ platform: 'android', serial: '' });
    bundle.ctx.session.serial = undefined;
    await expect(
      dispatch({ id: newId(), type: 'tap', x: 1, y: 2 }, bundle.ctx),
    ).rejects.toThrow(/missing android serial/);
  });

  it('throws when ios udid missing', async () => {
    const bundle = makeCtx({ platform: 'ios' });
    bundle.ctx.session.udid = undefined;
    await expect(
      dispatch({ id: newId(), type: 'tap', x: 1, y: 2 }, bundle.ctx),
    ).rejects.toThrow(/missing ios udid/);
  });
});
