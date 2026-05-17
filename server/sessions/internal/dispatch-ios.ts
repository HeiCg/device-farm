/**
 * iOS primitives for session action dispatch — Phase 34 Plan 34-02.
 *
 * Open Question #2 resolution: v1 ships iOS via `xcrun simctl` shell-out
 * (Phase 32 SimulatorKit private bridge integration is DEFERRED — the bridge
 * is built but lacks the session-action surface; a future plan can swap
 * these helpers without touching `actions.ts` because the dispatch routes
 * through these wrappers).
 *
 * EVERY helper uses `execFile` (NOT `exec`) via `node:child_process` +
 * `node:util.promisify`. This is critical for the `type` / install path
 * where user-supplied text or paths would be vulnerable to shell-injection
 * under `exec` (e.g. `xcrun simctl io ...; rm -rf /`). `execFile` passes
 * each arg as a discrete argv slot — no shell interpolation happens.
 *
 * Helpers accept an `execFileAsync` callable so tests can inject a spy
 * (vi.fn()) and assert the exact argv emitted, without mocking globally.
 */

export type IosExecFileAsync = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface IosDispatchDeps {
  execFileAsync: IosExecFileAsync;
  udid: string;
}

/**
 * Tap on the iOS simulator at (x, y). `xcrun simctl io <udid> touch <x> <y>`
 * accepts integer pixel coordinates.
 */
export async function iosTap(
  deps: IosDispatchDeps & { x: number; y: number },
): Promise<void> {
  await deps.execFileAsync('xcrun', [
    'simctl', 'io', deps.udid, 'touch', String(deps.x), String(deps.y),
  ]);
}

/**
 * Type a string. `xcrun simctl io <udid> input text "<text>"` types the
 * literal text. NOTE: newlines + non-printable characters are accepted
 * literally; if the consumer wants Return-key semantics they should send a
 * separate `{type:'key', code:'enter'}` envelope rather than embedding `\n`.
 */
export async function iosType(
  deps: IosDispatchDeps & { text: string },
): Promise<void> {
  await deps.execFileAsync('xcrun', [
    'simctl', 'io', deps.udid, 'input', 'text', deps.text,
  ]);
}

/**
 * Swipe — emitted as a touch-down + linear interpolation + touch-up via
 * the `simctl io` swipe verb. `xcrun simctl io <udid> swipe <x1> <y1>
 * <x2> <y2> <durationSeconds>`. simctl wants the duration in seconds
 * (float). We convert millis → seconds here.
 */
export async function iosSwipe(
  deps: IosDispatchDeps & {
    x1: number; y1: number; x2: number; y2: number; durationMs: number;
  },
): Promise<void> {
  const seconds = (deps.durationMs / 1000).toFixed(3);
  await deps.execFileAsync('xcrun', [
    'simctl', 'io', deps.udid, 'swipe',
    String(deps.x1), String(deps.y1), String(deps.x2), String(deps.y2),
    seconds,
  ]);
}

/**
 * Press a hardware-like key. simctl exposes the standard keys (home, power,
 * volup, voldown, etc) via `xcrun simctl io <udid> press <key>`. Maps
 * protocol enum → simctl key name.
 */
const IOS_KEY_NAMES: Record<string, string> = {
  home: 'home',
  back: 'home', // iOS has no system back — fall back to home
  enter: 'return',
  volup: 'volumeup',
  voldown: 'volumedown',
  power: 'power',
  menu: 'home', // iOS has no system menu — fall back to home
  recent: 'home', // iOS app switcher is a double-tap home — approximate
};

export async function iosKey(
  deps: IosDispatchDeps & { code: string },
): Promise<void> {
  const keyName = IOS_KEY_NAMES[deps.code] ?? deps.code;
  await deps.execFileAsync('xcrun', [
    'simctl', 'io', deps.udid, 'press', keyName,
  ]);
}

/** Launch app via bundle id. */
export async function iosLaunch(
  deps: IosDispatchDeps & { bundleId: string },
): Promise<void> {
  await deps.execFileAsync('xcrun', [
    'simctl', 'launch', deps.udid, deps.bundleId,
  ]);
}

/** Install an .ipa/.app bundle. `simctl install <udid> <path>`. */
export async function iosInstall(
  deps: IosDispatchDeps & { appPath: string },
): Promise<void> {
  await deps.execFileAsync('xcrun', [
    'simctl', 'install', deps.udid, deps.appPath,
  ]);
}

/** Uninstall app by bundle id. `simctl uninstall <udid> <bundle>`. */
export async function iosUninstall(
  deps: IosDispatchDeps & { bundleId: string },
): Promise<void> {
  await deps.execFileAsync('xcrun', [
    'simctl', 'uninstall', deps.udid, deps.bundleId,
  ]);
}
