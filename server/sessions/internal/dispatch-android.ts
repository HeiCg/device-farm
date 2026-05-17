/**
 * Android primitives for session action dispatch — Phase 34 Plan 34-02.
 *
 * Thin wrappers over @device-stream/android `AndroidDeviceService` (aka
 * `tangoAdbService`). Each helper takes a `deps` object so tests can inject
 * a stub `androidDevice` + `execFileAsync` and assert exact call args.
 *
 * The wrappers exist (rather than calling `tangoAdbService` directly from
 * `actions.ts`) so dispatch tests can mock the injection point cleanly
 * without `vi.mock('@device-stream/android')` pollution.
 *
 * `key` maps the 8-member protocol enum to an Android keycode integer per
 * `android.view.KeyEvent`. Note: AndroidDeviceService.pressKey accepts a
 * STRING key per its signature (it shells out to `adb shell input keyevent
 * <STRING>`); we pass the protocol code through directly when the
 * AndroidDeviceService supports it, BUT for clarity + future-proof we keep
 * the integer mapping documented in KEY_CODES below.
 */
import type { AndroidDeviceService } from '@device-stream/android';
import type { KeyCode } from './protocol.js';

/**
 * Android KeyEvent integer codes (per `android.view.KeyEvent`).
 * Documented for the operator; the wrapper currently delegates to the
 * AndroidDeviceService.pressKey string-name overload so adb shell receives
 * `KEYCODE_HOME` rather than the integer literal. The mapping below is the
 * canonical reference if a future native gRPC path needs the integer.
 */
export const KEY_CODES_INT: Record<KeyCode, number> = {
  home: 3,
  back: 4,
  enter: 66,
  volup: 24,
  voldown: 25,
  power: 26,
  menu: 82,
  recent: 187,
};

/**
 * Android `adb shell input keyevent` accepts uppercase symbolic key names —
 * KEYCODE_HOME / KEYCODE_BACK / etc. Mapping below keeps the protocol enum
 * stable + isolates the adb-format here.
 */
const KEY_NAMES: Record<KeyCode, string> = {
  home: 'KEYCODE_HOME',
  back: 'KEYCODE_BACK',
  enter: 'KEYCODE_ENTER',
  volup: 'KEYCODE_VOLUME_UP',
  voldown: 'KEYCODE_VOLUME_DOWN',
  power: 'KEYCODE_POWER',
  menu: 'KEYCODE_MENU',
  recent: 'KEYCODE_APP_SWITCH',
};

export interface AndroidDispatchDeps {
  androidDevice: Pick<
    AndroidDeviceService,
    'tap' | 'typeText' | 'swipe' | 'pressKey' | 'launchApp'
  >;
  serial: string;
}

export async function androidTap(deps: AndroidDispatchDeps & { x: number; y: number }): Promise<void> {
  await deps.androidDevice.tap(deps.serial, deps.x, deps.y);
}

export async function androidType(deps: AndroidDispatchDeps & { text: string }): Promise<void> {
  await deps.androidDevice.typeText(deps.serial, deps.text);
}

export async function androidSwipe(
  deps: AndroidDispatchDeps & { x1: number; y1: number; x2: number; y2: number; durationMs: number },
): Promise<void> {
  await deps.androidDevice.swipe(deps.serial, deps.x1, deps.y1, deps.x2, deps.y2, deps.durationMs);
}

export async function androidKey(
  deps: AndroidDispatchDeps & { code: KeyCode },
): Promise<void> {
  await deps.androidDevice.pressKey(deps.serial, KEY_NAMES[deps.code]);
}

export async function androidLaunch(
  deps: AndroidDispatchDeps & { bundleId: string },
): Promise<void> {
  await deps.androidDevice.launchApp(deps.serial, deps.bundleId);
}

/**
 * Uninstall an APK — AndroidDeviceService does not expose `uninstall` directly,
 * so we shell out to adb here. Tests inject `execFileAsync` to verify the
 * exact argv emitted.
 */
export interface AndroidUninstallDeps {
  execFileAsync: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  serial: string;
  bundleId: string;
}

export async function androidUninstall(deps: AndroidUninstallDeps): Promise<void> {
  await deps.execFileAsync('adb', ['-s', deps.serial, 'uninstall', deps.bundleId]);
}
