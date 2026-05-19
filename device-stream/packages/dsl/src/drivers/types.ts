import type { HardwareKey, Platform, UIElement } from '../types';

export interface Driver {
  readonly platform: Platform;
  readonly serial: string;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: HardwareKey): Promise<void>;
  screenshot(): Promise<Buffer>;
  hierarchy(): Promise<UIElement[]>;

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
