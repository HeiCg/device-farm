import type { HardwareKey, IOSKind, IOSPrivacyService, UIElement } from '../types';
import { runCmd, simctl } from '../shell';
import { NotSupportedOnPlatformError } from '../types';
import type { Driver } from './types';
import { parseWdaSource } from '../selectors/wda-xml';

export interface IOSDriverOptions {
  serial: string;
  kind?: IOSKind;
  wdaUrl?: string;
  sessionId?: string;
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
  private sessionId: string | undefined;

  constructor(opts: IOSDriverOptions) {
    this.serial = opts.serial;
    this.kind = opts.kind ?? 'simulator';
    this.wdaUrl = (opts.wdaUrl ?? 'http://localhost:8100').replace(/\/$/, '');
    this.sessionId = opts.sessionId;
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const res = await fetch(`${this.wdaUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { 'appium:udid': this.serial } } }),
    });
    if (!res.ok) throw new Error(`WDA createSession ${res.status}: ${await res.text()}`);
    const data = await res.json() as { value?: { sessionId?: string }; sessionId?: string };
    const sid = data.value?.sessionId ?? data.sessionId;
    if (!sid) throw new Error('WDA did not return a session id');
    this.sessionId = sid;
    return sid;
  }

  private async wdaFetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.wdaUrl}${path}`, init);
    if (!res.ok) throw new Error(`WDA ${path} ${res.status}: ${await res.text()}`);
    return res;
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

  async typeText(text: string): Promise<void> {
    const sid = await this.ensureSession();
    const activeRes = await this.wdaFetch(`/session/${sid}/element/active`);
    const active = await activeRes.json() as { value?: { ELEMENT?: string } | string };
    const eid = typeof active.value === 'string' ? active.value : active.value?.ELEMENT;
    if (!eid) throw new Error('WDA: no active element to type into');
    await this.wdaFetch(`/session/${sid}/element/${eid}/value`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, value: text.split('') }),
    });
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

  async screenshot(): Promise<Buffer> {
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
