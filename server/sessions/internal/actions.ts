/**
 * Session action dispatch — Phase 34 Plan 34-02.
 *
 * `dispatch(envelope, ctx)` is the central switch that routes each parsed
 * client envelope (per RESEARCH §Action Dispatch lines 339-401) into the
 * platform-specific primitive (android/ios) or service call (screenshot,
 * record, install, resolver).
 *
 * Design:
 *   - ActionContext interface lists every external dependency. Tests inject
 *     stubs; production wiring lives in `ws.ts` `buildActionContext` helper.
 *   - All Android paths go through `dispatch-android.ts` wrappers (never
 *     direct `tangoAdbService` calls — keeps the test injection point clean).
 *   - All iOS paths use `execFileAsync` (argv-based) in `dispatch-ios.ts`,
 *     never shell-interpreted commands.
 *   - `tapByDescription` calls the injected resolver, then recurses via a
 *     direct `dispatch(...)` call with a synthetic tap envelope sharing the
 *     SAME id (so the eventual ack still echoes the user's original id).
 *   - `installApp` resolves the artifact id to a local path then calls the
 *     platform installer (adb install / simctl install).
 *   - `screenshot` returns `{artifactId, url, width, height}` as the ack
 *     result so the caller can fetch/display it.
 *   - `screenRecord` returns null — the recording artifact is finalized on
 *     stop and surfaced via the separate `screenRecord:false` envelope or
 *     an emitted `event` (Phase 35 will refine).
 *   - The switch ends with `assertNever(envelope)` so adding a 12th client
 *     variant without a dispatch case becomes a TS compile error.
 */
import type { AndroidDeviceService } from '@device-stream/android';

import type { ClientEnvelope } from './protocol.js';
import {
  androidTap,
  androidType,
  androidSwipe,
  androidKey,
  androidLaunch,
  androidUninstall,
} from './dispatch-android.js';
import {
  iosTap,
  iosType,
  iosSwipe,
  iosKey,
  iosLaunch,
  iosInstall,
  iosUninstall,
  type IosExecFileAsync,
} from './dispatch-ios.js';

// ---------- Resolver surface (real body in Plan 34-03) ----------

export interface ResolveTargetRequest {
  target: string;
  screenshot: Buffer;
  hierarchy: string;
  platform: 'android' | 'ios';
  screenWidth: number;
  screenHeight: number;
}

export interface ResolveTargetResult {
  x: number;
  y: number;
  confidence: number;
}

/** Thrown by the resolver (or actions.ts) when confidence < 0.5 OR the
 * resolver itself failed. WS handler maps this to `{type:'error', code:'resolver_failed'}`. */
export class ResolverError extends Error {
  readonly point?: ResolveTargetResult;
  constructor(message: string, point?: ResolveTargetResult) {
    super(message);
    this.name = 'ResolverError';
    this.point = point;
  }
}

// ---------- ActionContext ----------

export interface ActionContext {
  session: {
    sessionId: string;
    deviceId: string;
    platform: 'android' | 'ios';
    actor: string;
    /** iOS simulator udid — populated when platform==='ios'. */
    udid?: string;
    /** Android adb serial (`emulator-5554` etc.) — populated when platform==='android'. */
    serial?: string;
    /** Last known screen dimensions; resolver path uses them. */
    screenWidth?: number;
    screenHeight?: number;
  };
  androidDevice: Pick<
    AndroidDeviceService,
    'tap' | 'typeText' | 'swipe' | 'pressKey' | 'launchApp'
  >;
  /** iOS execFileAsync wrapper — promisified `node:child_process.execFile`. */
  iosExecFileAsync: IosExecFileAsync;
  /** ADB execFileAsync wrapper — Android uninstall path + future shell-outs. */
  adbExecFileAsync: IosExecFileAsync;
  /** Capture a single screenshot artifact for this device. */
  screenshotService: {
    captureOnce(deviceId: string, platform: 'android' | 'ios'): Promise<{
      id: string; url: string; width: number; height: number;
    }>;
  };
  /** Start/stop a recording artifact for this device. */
  recordingService: {
    startRecording(deviceId: string, platform: 'android' | 'ios'): Promise<void>;
    stopRecording(deviceId: string, platform: 'android' | 'ios'): Promise<void>;
  };
  /** Pull the UI hierarchy XML/JSON for the device. */
  hierarchyService: {
    getHierarchy(deviceId: string, platform: 'android' | 'ios'): Promise<string>;
  };
  /** Resolve an artifact id to a local path (for installApp). */
  artifactService: {
    resolveArtifactPath(artifactId: string): Promise<string>;
  };
  /** Android-only APK installer (adb install -r -t). */
  jobExecutor: {
    installApk(serial: string, apkPath: string): Promise<void>;
  };
  /** NL target resolver — stub throws ResolverError until Plan 34-03 wires the real backend. */
  resolver: {
    resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult>;
  };
  /** Helper to fetch the screenshot bytes by URL (resolver feeds bytes to the model). */
  fetchScreenshotBytes(url: string): Promise<Buffer>;
}

// ---------- assertNever helper ----------

function assertNever(value: never): never {
  throw new Error(`Unhandled dispatch case: ${JSON.stringify(value)}`);
}

// ---------- dispatch() ----------

export async function dispatch(envelope: ClientEnvelope, ctx: ActionContext): Promise<unknown> {
  switch (envelope.type) {
    // 1. ping — heartbeat; result is null, the WS handler will emit `pong`
    //    rather than `ack` for ping (per RESEARCH §WS Protocol — ping/pong is
    //    a distinct shape from action ack). We still return null here so the
    //    caller can decide.
    case 'ping':
      return null;

    // 2. tap — coordinate tap
    case 'tap':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidTap({ androidDevice: ctx.androidDevice, serial, x: envelope.x, y: envelope.y });
      } else {
        const udid = requireUdid(ctx);
        await iosTap({ execFileAsync: ctx.iosExecFileAsync, udid, x: envelope.x, y: envelope.y });
      }
      return null;

    // 3. tapByDescription — NL-resolver path
    case 'tapByDescription': {
      const screenshot = await ctx.screenshotService.captureOnce(ctx.session.deviceId, ctx.session.platform);
      const screenshotBytes = await ctx.fetchScreenshotBytes(screenshot.url);
      const hierarchy = await ctx.hierarchyService.getHierarchy(ctx.session.deviceId, ctx.session.platform);
      const point = await ctx.resolver.resolve({
        target: envelope.target,
        screenshot: screenshotBytes,
        hierarchy,
        platform: ctx.session.platform,
        screenWidth: screenshot.width,
        screenHeight: screenshot.height,
      });
      if (point.confidence < 0.5) {
        throw new ResolverError(
          `resolver returned low confidence ${point.confidence.toFixed(3)} for target "${envelope.target}"`,
          point,
        );
      }
      // Recurse via synthetic tap envelope — re-use the SAME id so the eventual
      // ack still references the user's original message id.
      return dispatch({ id: envelope.id, type: 'tap', x: point.x, y: point.y }, ctx);
    }

    // 4. type — type text
    case 'type':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidType({ androidDevice: ctx.androidDevice, serial, text: envelope.text });
      } else {
        const udid = requireUdid(ctx);
        await iosType({ execFileAsync: ctx.iosExecFileAsync, udid, text: envelope.text });
      }
      return null;

    // 5. swipe — directional swipe
    case 'swipe':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidSwipe({
          androidDevice: ctx.androidDevice, serial,
          x1: envelope.x1, y1: envelope.y1, x2: envelope.x2, y2: envelope.y2,
          durationMs: envelope.durationMs,
        });
      } else {
        const udid = requireUdid(ctx);
        await iosSwipe({
          execFileAsync: ctx.iosExecFileAsync, udid,
          x1: envelope.x1, y1: envelope.y1, x2: envelope.x2, y2: envelope.y2,
          durationMs: envelope.durationMs,
        });
      }
      return null;

    // 6. key — hardware key press
    case 'key':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidKey({ androidDevice: ctx.androidDevice, serial, code: envelope.code });
      } else {
        const udid = requireUdid(ctx);
        await iosKey({ execFileAsync: ctx.iosExecFileAsync, udid, code: envelope.code });
      }
      return null;

    // 7. screenshot — capture artifact + return descriptor on ack.result
    case 'screenshot': {
      const artifact = await ctx.screenshotService.captureOnce(ctx.session.deviceId, ctx.session.platform);
      return {
        artifactId: artifact.id,
        url: artifact.url,
        width: artifact.width,
        height: artifact.height,
      };
    }

    // 8. screenRecord — start/stop recording; ack.result=null in both cases
    case 'screenRecord':
      if (envelope.start) {
        await ctx.recordingService.startRecording(ctx.session.deviceId, ctx.session.platform);
      } else {
        await ctx.recordingService.stopRecording(ctx.session.deviceId, ctx.session.platform);
      }
      return null;

    // 9. installApp — resolve artifact path then install
    case 'installApp': {
      const path = await ctx.artifactService.resolveArtifactPath(envelope.artifactId);
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await ctx.jobExecutor.installApk(serial, path);
      } else {
        const udid = requireUdid(ctx);
        await iosInstall({ execFileAsync: ctx.iosExecFileAsync, udid, appPath: path });
      }
      return null;
    }

    // 10. launchApp — bundle id launch
    case 'launchApp':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidLaunch({ androidDevice: ctx.androidDevice, serial, bundleId: envelope.bundleId });
      } else {
        const udid = requireUdid(ctx);
        await iosLaunch({ execFileAsync: ctx.iosExecFileAsync, udid, bundleId: envelope.bundleId });
      }
      return null;

    // 11. uninstallApp — bundle id uninstall
    case 'uninstallApp':
      if (ctx.session.platform === 'android') {
        const serial = requireSerial(ctx);
        await androidUninstall({
          execFileAsync: ctx.adbExecFileAsync, serial, bundleId: envelope.bundleId,
        });
      } else {
        const udid = requireUdid(ctx);
        await iosUninstall({ execFileAsync: ctx.iosExecFileAsync, udid, bundleId: envelope.bundleId });
      }
      return null;

    // Exhaustiveness check — TS compile error if a new envelope variant is added
    // without a matching case. Runtime fallback also throws.
    default:
      return assertNever(envelope);
  }
}

// ---------- helpers ----------

function requireSerial(ctx: ActionContext): string {
  if (!ctx.session.serial) {
    throw new Error(`session ${ctx.session.sessionId}: missing android serial in ActionContext`);
  }
  return ctx.session.serial;
}

function requireUdid(ctx: ActionContext): string {
  if (!ctx.session.udid) {
    throw new Error(`session ${ctx.session.sessionId}: missing ios udid in ActionContext`);
  }
  return ctx.session.udid;
}
