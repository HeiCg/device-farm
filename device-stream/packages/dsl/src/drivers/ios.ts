import type { HardwareKey, IOSKind, IOSPrivacyService, ScreenshotOptions, UIElement } from '../types';
import { runCmd, simctl } from '../shell';
import { NotSupportedOnPlatformError } from '../types';
import type { Driver } from './types';
import { parseWdaSource } from '../selectors/wda-xml';

export interface IOSDriverOptions {
  serial: string;
  kind?: IOSKind;
  wdaUrl?: string;
  sessionId?: string;
  /** Per-request WDA HTTP timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Retries on network error / 5xx / invalid-session (default 3). */
  retries?: number;
}

/** Default per-request WDA timeout. */
const DEFAULT_WDA_TIMEOUT_MS = 30_000;
/** Default retry attempts on transient WDA failures. */
const DEFAULT_WDA_RETRIES = 3;
/** Base backoff between WDA retries (ms); grows linearly with the attempt. */
const WDA_BACKOFF_MS = 200;
/** Idle poll interval for {@link IOSDriver.waitForIdle} (ms). */
const WDA_IDLE_POLL_MS = 150;
/** Cap on the fallback sleep when WDA `/source` can't be read (ms). */
const WDA_IDLE_SLEEP_CAP_MS = 350;

/** An HTTP error carrying the WDA status code so retry logic can branch on it. */
class WdaHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WdaHttpError';
  }
}

/** Whether a WDA response body signals a stale/invalid session that we can recreate. */
function isInvalidSessionBody(body: string): boolean {
  return /invalid session id|session does not exist|session is either terminated/i.test(body);
}

/**
 * `xcrun simctl privacy` accepts a small set of TCC services. We translate
 * Android-style permission strings ("android.permission.CAMERA") into the
 * matching iOS service when the caller passes a list, so the same
 * `ds.grantPermissions(pkg, perms)` call works for both platforms.
 */
const ANDROID_TO_IOS_PRIVACY: Record<string, IOSPrivacyService> = {
  'android.permission.CAMERA': 'camera',
  'android.permission.RECORD_AUDIO': 'microphone',
  'android.permission.READ_CONTACTS': 'contacts',
  'android.permission.WRITE_CONTACTS': 'contacts',
  'android.permission.READ_CALENDAR': 'calendar',
  'android.permission.WRITE_CALENDAR': 'calendar',
  'android.permission.ACCESS_FINE_LOCATION': 'location',
  'android.permission.ACCESS_COARSE_LOCATION': 'location',
  'android.permission.ACCESS_BACKGROUND_LOCATION': 'location-always',
  'android.permission.READ_EXTERNAL_STORAGE': 'photos',
  'android.permission.READ_MEDIA_IMAGES': 'photos',
  'android.permission.READ_MEDIA_VIDEO': 'photos',
  'android.permission.WRITE_EXTERNAL_STORAGE': 'photos-add',
  'android.permission.ACTIVITY_RECOGNITION': 'motion',
};

export class IOSDriver implements Driver {
  readonly platform = 'ios' as const;
  readonly serial: string;
  readonly kind: IOSKind;
  private readonly wdaUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private sessionId: string | undefined;
  /** Emit the "scale ignored on iOS" warning at most once per driver. */
  private scaleWarned = false;

  constructor(opts: IOSDriverOptions) {
    this.serial = opts.serial;
    this.kind = opts.kind ?? 'simulator';
    this.wdaUrl = (opts.wdaUrl ?? 'http://localhost:8100').replace(/\/$/, '');
    this.sessionId = opts.sessionId;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_WDA_TIMEOUT_MS;
    this.retries = opts.retries ?? DEFAULT_WDA_RETRIES;
  }

  private async ensureSession(force = false): Promise<string> {
    if (this.sessionId && !force) return this.sessionId;
    // The create-session call rides the same resilient transport (timeout +
    // retry on network error / 5xx) but must NOT attempt session recovery —
    // there is no session yet, and doing so would recurse.
    const res = await this.wdaRequest(
      '/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: { alwaysMatch: { 'appium:udid': this.serial } } }),
      },
      { recoverSession: false },
    );
    const data = await res.json() as { value?: { sessionId?: string }; sessionId?: string };
    const sid = data.value?.sessionId ?? data.sessionId;
    if (!sid) throw new Error('WDA did not return a session id');
    this.sessionId = sid;
    return sid;
  }

  private backoff(attempt: number): Promise<void> {
    return new Promise((r) => setTimeout(r, WDA_BACKOFF_MS * attempt));
  }

  /**
   * Resilient WDA transport, mirroring the Android RPC client's robustness:
   * a per-request AbortController timeout, up to `retries` attempts with linear
   * backoff on network errors and 5xx, and a one-shot session recreate + retry
   * when WDA reports an invalid/stale session id. 4xx responses (e.g. element
   * not found) are NOT retried.
   */
  private async wdaRequest(
    path: string,
    init?: RequestInit,
    opts: { recoverSession?: boolean } = {},
  ): Promise<Response> {
    const recoverSession = opts.recoverSession ?? true;
    let currentPath = path;
    let recovered = false;

    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${this.wdaUrl}${currentPath}`, { ...init, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        // Network failure or timeout abort — transient, retry within budget.
        if (attempt <= this.retries) {
          await this.backoff(attempt);
          continue;
        }
        const reason =
          err instanceof Error && err.name === 'AbortError'
            ? `timed out after ${this.timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        throw new Error(`WDA ${currentPath} request failed: ${reason}`);
      }
      clearTimeout(timer);

      if (res.ok) return res;

      const body = await res.text();

      // Stale/invalid session: recreate once, rewrite the path's session
      // segment to the new id, then retry (counts against the retry budget).
      if (recoverSession && !recovered && isInvalidSessionBody(body) && attempt <= this.retries) {
        recovered = true;
        const oldSid = this.sessionId;
        this.sessionId = undefined;
        const newSid = await this.ensureSession(true);
        if (oldSid) {
          currentPath = currentPath
            .replace(`/session/${oldSid}/`, `/session/${newSid}/`)
            .replace(new RegExp(`/session/${oldSid}$`), `/session/${newSid}`);
        }
        await this.backoff(attempt);
        continue;
      }

      // 5xx is transient; 4xx (element-not-found and friends) is not.
      if (res.status >= 500 && attempt <= this.retries) {
        await this.backoff(attempt);
        continue;
      }

      throw new WdaHttpError(`WDA ${currentPath} ${res.status}: ${body}`, res.status);
    }
  }

  private async wdaFetch(path: string, init?: RequestInit): Promise<Response> {
    return this.wdaRequest(path, init);
  }

  async tap(x: number, y: number): Promise<void> {
    const sid = await this.ensureSession();
    await this.wdaFetch(`/session/${sid}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actions: [{
          type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerUp', button: 0 },
          ],
        }],
      }),
    });
  }

  async longPress(x: number, y: number, durationMs: number): Promise<void> {
    const sid = await this.ensureSession();
    await this.wdaFetch(`/session/${sid}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actions: [{
          type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: durationMs },
            { type: 'pointerUp', button: 0 },
          ],
        }],
      }),
    });
  }

  async swipe(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<void> {
    const sid = await this.ensureSession();
    await this.wdaFetch(`/session/${sid}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actions: [{
          type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: Math.max(1, durationMs), x: toX, y: toY },
            { type: 'pointerUp', button: 0 },
          ],
        }],
      }),
    });
  }

  async screenSize(): Promise<{ width: number; height: number }> {
    const sid = await this.ensureSession();
    const res = await this.wdaFetch(`/session/${sid}/window/size`);
    const data = await res.json() as { value?: { width?: number; height?: number } };
    const w = data.value?.width;
    const h = data.value?.height;
    if (typeof w !== 'number' || typeof h !== 'number') {
      throw new Error('WDA /window/size did not return width/height');
    }
    return { width: w, height: h };
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    // WDA exposes no idle endpoint, so approximate one: poll `/source` and
    // return once two consecutive reads hash identically (the UI has settled),
    // honoring the caller's timeout. Only if the *first* read fails do we fall
    // back to the short capped sleep the old implementation always used.
    const budget = Math.max(0, timeoutMs);
    const deadline = Date.now() + budget;

    let sid: string;
    let prev: number;
    try {
      sid = await this.ensureSession();
      prev = hashString(await this.readSource(sid));
    } catch {
      await sleep(Math.min(WDA_IDLE_SLEEP_CAP_MS, budget));
      return;
    }

    while (Date.now() < deadline) {
      await sleep(Math.min(WDA_IDLE_POLL_MS, Math.max(0, deadline - Date.now())));
      let cur: number;
      try {
        cur = hashString(await this.readSource(sid));
      } catch {
        // A transient read failure mid-settle: stop rather than spin the CPU.
        return;
      }
      if (cur === prev) return; // two consecutive identical reads => settled
      prev = cur;
    }
  }

  private async readSource(sid: string): Promise<string> {
    const res = await this.wdaFetch(`/session/${sid}/source`);
    const data = await res.json() as { value?: string };
    return data.value ?? '';
  }

  private async activeElementId(sid: string): Promise<string> {
    const activeRes = await this.wdaFetch(`/session/${sid}/element/active`);
    const active = await activeRes.json() as { value?: { ELEMENT?: string } | string };
    const eid = typeof active.value === 'string' ? active.value : active.value?.ELEMENT;
    if (!eid) throw new Error('WDA: no active element');
    return eid;
  }

  async typeText(text: string): Promise<void> {
    const sid = await this.ensureSession();
    const eid = await this.activeElementId(sid);
    await this.wdaFetch(`/session/${sid}/element/${eid}/value`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, value: text.split('') }),
    });
  }

  async clearText(): Promise<void> {
    // Clear the active field via WDA's element `/clear` — never a hardware key.
    const sid = await this.ensureSession();
    const eid = await this.activeElementId(sid);
    await this.wdaFetch(`/session/${sid}/element/${eid}/clear`, { method: 'POST' });
  }

  async pressKey(key: HardwareKey): Promise<void> {
    const sid = await this.ensureSession();
    if (key === 'home') {
      await this.wdaFetch(`/wda/homescreen`, { method: 'POST' });
      return;
    }
    if (key === 'volumeUp' || key === 'volumeDown') {
      await this.wdaFetch(`/session/${sid}/wda/pressButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key }),
      });
      return;
    }
    throw new NotSupportedOnPlatformError(`pressKey(${key})`, 'ios');
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    // WDA returns a full-resolution PNG and offers no capture-time downscale.
    // Host-side downscaling would need an image library (sharp), which is not a
    // monorepo dependency, so `scale` cannot be honored here. Warn once (rather
    // than silently ignore it) and return full-res — matching Android, which
    // also applies no hard byte cap in the driver. Callers needing a size bound
    // enforce it after encoding.
    const scale = opts?.scale;
    if (scale !== undefined && scale < 1 && !this.scaleWarned) {
      this.scaleWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[@device-stream/dsl] screenshot({ scale: ${scale} }) is ignored on iOS/WDA ` +
          '(no capture-time or host-side downscale available); returning full-resolution PNG.',
      );
    }
    const sid = await this.ensureSession();
    const res = await this.wdaFetch(`/session/${sid}/screenshot`);
    const data = await res.json() as { value?: string };
    if (!data.value) throw new Error('WDA returned empty screenshot');
    return Buffer.from(data.value, 'base64');
  }

  async hierarchy(): Promise<UIElement[]> {
    const sid = await this.ensureSession();
    const res = await this.wdaFetch(`/session/${sid}/source`);
    const data = await res.json() as { value?: string };
    if (!data.value) throw new Error('WDA returned empty source');
    return parseWdaSource(data.value);
  }

  async openUrl(url: string): Promise<void> {
    if (this.kind === 'simulator') {
      await simctl(['openurl', this.serial, url]);
      return;
    }
    // Physical device: rely on WDA-backed Safari deep-link via siri-like
    // mechanism is unreliable; the documented path is `idevicedebug` or a
    // companion app. We surface a clear error rather than silently doing
    // nothing.
    throw new NotSupportedOnPlatformError('openUrl (iOS device)', 'ios');
  }

  async openDownloads(): Promise<void> {
    throw new NotSupportedOnPlatformError('openDownloads', 'ios');
  }

  async launchApp(bundleId: string): Promise<void> {
    if (this.kind === 'simulator') {
      await simctl(['launch', this.serial, bundleId]);
      return;
    }
    await runCmd('ios', ['launch', `--udid=${this.serial}`, bundleId]);
  }

  async stopApp(bundleId: string): Promise<void> {
    if (this.kind === 'simulator') {
      await simctl(['terminate', this.serial, bundleId]);
      return;
    }
    await runCmd('ios', ['kill', bundleId, `--udid=${this.serial}`]).catch(() => {
      /* go-ios kill may need different syntax across versions; non-fatal */
    });
  }

  async installApp(appPath: string): Promise<void> {
    if (this.kind === 'simulator') {
      await simctl(['install', this.serial, appPath], 180_000);
      return;
    }
    await runCmd('ios', ['install', `--udid=${this.serial}`, `--path=${appPath}`], 300_000);
  }

  async enableInstallByThirdParty(_packageName: string): Promise<void> {
    throw new NotSupportedOnPlatformError('enableInstallByThirdParty', 'ios');
  }

  async grantPermissions(packageName: string, permissions: string[] | '*'): Promise<void> {
    if (this.kind !== 'simulator') {
      throw new NotSupportedOnPlatformError('grantPermissions (iOS device)', 'ios');
    }
    if (permissions === '*') {
      await simctl(['privacy', this.serial, 'grant', 'all', packageName]);
      return;
    }
    const services = new Set<IOSPrivacyService>();
    for (const p of permissions) {
      const mapped = ANDROID_TO_IOS_PRIVACY[p] ?? (p as IOSPrivacyService);
      services.add(mapped);
    }
    for (const svc of services) {
      await simctl(['privacy', this.serial, 'grant', svc, packageName]);
    }
  }

  async setLocation(latitude: number, longitude: number): Promise<void> {
    if (this.kind !== 'simulator') {
      throw new NotSupportedOnPlatformError('setLocation (iOS device)', 'ios');
    }
    await simctl(['location', this.serial, 'set', `${latitude},${longitude}`]);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${this.wdaUrl}/session/${this.sessionId}`, { method: 'DELETE' }).catch(() => {});
    this.sessionId = undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** djb2 string hash — enough to detect that two `/source` reads differ. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}
