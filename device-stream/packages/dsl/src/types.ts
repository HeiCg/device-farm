export type Platform = 'android' | 'ios';

/**
 * Flexible string matcher used by selector fields. A bare string is an exact,
 * case-sensitive equality check (back-compatible with the original API). The
 * object form composes constraints — all provided constraints must hold.
 */
export type StringMatch =
  | string
  | {
      equals?: string;
      contains?: string;
      /** JavaScript regex source, e.g. '^item-\\d+$'. Tested with `.test()`. */
      regex?: string;
      /** Apply equals/contains/regex case-insensitively. */
      caseInsensitive?: boolean;
    };

export interface Selector {
  id?: StringMatch;
  text?: StringMatch;
  contentDescription?: StringMatch;
  className?: StringMatch;
  packageName?: StringMatch;
  /** Pick the Nth match (0-based) among all elements satisfying the selector. */
  index?: number;
  /** Require the element's `enabled` flag to equal this. */
  enabled?: boolean;
  /**
   * Require the element to be visible. Elements with unknown visibility
   * (e.g. flat Android nodes that don't report it) are permitted; only
   * known-invisible elements are excluded.
   */
  visible?: boolean;
  /** Relative match: the element must have a descendant matching this selector. */
  containsDescendant?: Selector;
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
  /** Known visibility, when the backend reports it (iOS WDA `visible`). */
  visible?: boolean;
  /** Child elements, when the backend preserves hierarchy (iOS). */
  children?: UIElement[];
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

/** Direction to travel through content (finger moves the opposite way). */
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface SwipeOptions {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Gesture duration in ms (default 300). */
  durationMs?: number;
}

export interface ScrollOptions {
  /** Fraction of the screen the swipe spans, 0–1 (default 0.6). */
  distance?: number;
  durationMs?: number;
}

export interface ScreenshotOptions {
  /**
   * Capture scale, 0–1. Backends that downscale at capture time (Android
   * android-server) honor it; those that can't (iOS/WDA) return full-res.
   */
  scale?: number;
}

export interface ScrollUntilVisibleOptions extends ScrollOptions {
  /** Scroll direction (default 'down'). */
  direction?: ScrollDirection;
  /** Maximum number of scroll attempts before giving up (default 10). */
  maxScrolls?: number;
  /** Idle settle timeout between scrolls, ms (default 2000). */
  settleTimeoutMs?: number;
}

export class NotSupportedOnPlatformError extends Error {
  constructor(public readonly method: string, public readonly platform: Platform) {
    super(`${method} is not supported on ${platform}`);
    this.name = 'NotSupportedOnPlatformError';
  }
}

/**
 * Structured near-miss diagnostics attached to an {@link ElementNotFoundError} so
 * an agent can self-correct without a follow-up `describe` round-trip. Built from
 * the last tree the session already polled — no extra device call.
 */
export interface ElementNotFoundDiagnostics {
  /** Rendered outline lines of the top near-miss elements (≤ 10). */
  candidates: string[];
  /** Pruned describe of the current screen, only when there are no near-misses. */
  screen?: string;
  /** Elements that matched every selector field except `index`. */
  matchedCount?: number;
}

/** Hard cap on the total rendered error message length (chars). */
const MESSAGE_CAP = 2500;

function buildElementNotFoundMessage(
  selector: Selector,
  timeoutMs: number,
  diag?: ElementNotFoundDiagnostics,
): string {
  let msg = `Element ${JSON.stringify(selector)} not found within ${timeoutMs}ms.`;

  if (diag && diag.candidates.length > 0) {
    msg += '\nNear matches:\n' + diag.candidates.map((c) => `  ${c}`).join('\n');
  } else if (diag && diag.screen) {
    msg += '\nScreen:\n' + diag.screen;
  }

  if (diag && diag.matchedCount && diag.matchedCount > 0 && selector.index !== undefined) {
    msg += `\n${diag.matchedCount} elements matched the selector but index ${selector.index} is out of range.`;
  }

  return msg.length > MESSAGE_CAP ? msg.slice(0, MESSAGE_CAP) : msg;
}

export class ElementNotFoundError extends Error {
  readonly diagnostics?: ElementNotFoundDiagnostics;

  constructor(
    public readonly selector: Selector,
    public readonly timeoutMs: number,
    diagnostics?: ElementNotFoundDiagnostics,
  ) {
    super(buildElementNotFoundMessage(selector, timeoutMs, diagnostics));
    this.name = 'ElementNotFoundError';
    this.diagnostics = diagnostics;
  }
}
