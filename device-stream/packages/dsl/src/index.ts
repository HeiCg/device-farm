import type {
  Platform,
  Selector,
  UIElement,
  SessionOptions,
  HardwareKey,
  IOSKind,
  IOSPrivacyService,
} from './types';

export type { Platform, Selector, UIElement, SessionOptions, HardwareKey, IOSKind, IOSPrivacyService };
export { NotSupportedOnPlatformError, ElementNotFoundError } from './types';

export interface ElementHandle extends PromiseLike<UIElement> {
  fill(text: string): Promise<void>;
  tap(): Promise<void>;
  longPress(durationMs?: number): Promise<void>;
  clear(): Promise<void>;
  text(): Promise<string>;
  exists(): Promise<boolean>;
  waitFor(opts?: { timeoutMs?: number }): Promise<UIElement>;
}

export interface WaitHandle {
  toAppear(): Promise<void>;
  toDisappear(): Promise<void>;
  changeTo(target: Selector): Promise<void>;
}

export interface DeviceStreamSession {
  readonly serial: string;
  readonly platform: Platform;

  openUrl(url: string): Promise<void>;
  openDownloads(): Promise<void>;
  pressKey(key: HardwareKey): Promise<void>;

  get(selector: Selector): ElementHandle;
  tapOn(selector: Selector): Promise<void>;
  copyText(selector: Selector): Promise<string>;

  awaitUntil(selector: Selector, opts?: { timeoutMs?: number }): WaitHandle;

  screenshot(): Promise<Buffer>;
  hierarchy(): Promise<UIElement[]>;

  launchApp(packageOrBundleId: string): Promise<void>;
  stopApp(packageOrBundleId: string): Promise<void>;

  /**
   * Install an app on the device.
   * - Android: APK via `adb install -r -g <path>`
   * - iOS Simulator: `.app` bundle via `xcrun simctl install`
   * - iOS Device: throws NotSupportedOnPlatformError (out of scope for hook-setup)
   */
  installApp(appPath: string): Promise<void>;

  /**
   * Android only: grant `REQUEST_INSTALL_PACKAGES` to `packageName` so the app can
   * install other APKs without the user toggle. Throws NotSupportedOnPlatformError on iOS.
   */
  enableInstallByThirdParty(packageName: string): Promise<void>;

  /**
   * Grant runtime permissions to an app.
   *
   * - Android: `pm grant`. `'*'` (default) grants the full declared set from `dumpsys package`.
   * - iOS Simulator: `xcrun simctl privacy <udid> grant`. Android-style names like
   *   `android.permission.CAMERA` are auto-translated to the matching TCC service; native
   *   iOS service names (e.g. `'camera'`, `'location-always'`) also work. `'*'` grants `all`.
   * - iOS Device: throws NotSupportedOnPlatformError.
   */
  grantPermissions(packageName: string, permissions?: string[] | '*'): Promise<void>;

  /**
   * Set the device location.
   * - Android: `adb emu geo fix` (emulators only; physical devices unsupported).
   * - iOS Simulator: `xcrun simctl location <udid> set lat,lon`.
   * - iOS Device: throws NotSupportedOnPlatformError.
   */
  setLocation(latitude: number, longitude: number): Promise<void>;

  close(): Promise<void>;
}

export async function createSession(opts: SessionOptions): Promise<DeviceStreamSession> {
  const { createDriver, DeviceStreamSessionImpl } = await import('./session');
  const driver = createDriver(opts);
  return new DeviceStreamSessionImpl(driver, opts);
}
