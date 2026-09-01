import type { HardwareKey, Platform, ScreenshotOptions, UIElement } from '../types';

export interface Driver {
  readonly platform: Platform;
  readonly serial: string;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs: number): Promise<void>;
  swipe(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: HardwareKey): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
  hierarchy(): Promise<UIElement[]>;
  /** Logical screen size in the same coordinate space as `bounds`. */
  screenSize(): Promise<{ width: number; height: number }>;
  /** Block until the UI stops changing (or `timeoutMs` elapses). Best-effort. */
  waitForIdle(timeoutMs: number): Promise<void>;

  openUrl(url: string): Promise<void>;
  openDownloads(): Promise<void>;
  launchApp(id: string): Promise<void>;
  stopApp(id: string): Promise<void>;
  installApp(path: string): Promise<void>;

  enableInstallByThirdParty(packageName: string): Promise<void>;
  grantPermissions(packageName: string, permissions: string[] | '*'): Promise<void>;
  setLocation(latitude: number, longitude: number): Promise<void>;

  close(): Promise<void>;
}
