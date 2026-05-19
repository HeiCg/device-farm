export type Platform = 'android' | 'ios';

export interface Selector {
  id?: string;
  text?: string;
  contentDescription?: string;
  className?: string;
  packageName?: string;
  index?: number;
}

export interface UIElement {
  id?: string;
  text?: string;
  contentDescription?: string;
  className?: string;
  packageName?: string;
  bounds: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  selected: boolean;
  checked?: boolean;
  focused?: boolean;
}

export type IOSKind = 'simulator' | 'device';

export interface SessionOptions {
  serial: string;
  platform: Platform;
  /** iOS only — default 'simulator'. Selects between simctl and go-ios paths for install / privacy / location. */
  iosKind?: IOSKind;
  androidServerUrl?: string;
  wdaUrl?: string;
  wdaSessionId?: string;
  defaultTimeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * iOS privacy service names accepted by `xcrun simctl privacy`. Names match Apple's
 * TCC categories; extras like 'all' and 'location-always' are also valid.
 * See: `xcrun simctl privacy --help`.
 */
export type IOSPrivacyService =
  | 'all'
  | 'calendar'
  | 'contacts-limited'
  | 'contacts'
  | 'location'
  | 'location-always'
  | 'photos-add'
  | 'photos'
  | 'media-library'
  | 'microphone'
  | 'motion'
  | 'reminders'
  | 'siri'
  | 'camera';

export type HardwareKey = 'back' | 'home' | 'enter' | 'menu' | 'volumeUp' | 'volumeDown' | 'power';

export class NotSupportedOnPlatformError extends Error {
  constructor(public readonly method: string, public readonly platform: Platform) {
    super(`${method} is not supported on ${platform}`);
    this.name = 'NotSupportedOnPlatformError';
  }
}

export class ElementNotFoundError extends Error {
  constructor(public readonly selector: Selector, public readonly timeoutMs: number) {
    super(`Element ${JSON.stringify(selector)} not found within ${timeoutMs}ms`);
    this.name = 'ElementNotFoundError';
  }
}
