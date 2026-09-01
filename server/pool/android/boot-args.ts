/**
 * Android emulator boot-arg construction + host preflight.
 *
 * Pure helpers (no spawning, no fs side effects unless you let them) so the
 * argv is unit-testable. Captures the operational knowledge needed for fast,
 * reliable headless/CI emulator boots:
 *   - GPU mode selection with env override + validation (lavapipe/black-window traps)
 *   - headless control (Wayland Qt crash-consent SIGABRT avoidance)
 *   - boot hardening flags (suppress dialogs / telemetry / network simulation)
 *   - /dev/kvm preflight (TCG fallback is 10–50× slower)
 *
 * Env knobs (with ARGENT_* aliases for parity):
 *   DEVICE_FARM_EMULATOR_GPU_MODE   override -gpu (e.g. host, swiftshader, angle_indirect)
 *   DEVICE_FARM_EMULATOR_NO_WINDOW  '0'/'false'/'no' shows the window (default headless)
 */
import { accessSync, constants as fsConstants } from 'node:fs';

/** GPU modes accepted by `emulator -gpu`. */
const VALID_GPU_MODES = new Set([
  'auto',
  'host',
  'swiftshader_indirect',
  'swiftshader',
  'angle_indirect',
  'angle',
  'guest',
  'software',
  'mesa',
  'off',
]);

const DEFAULT_GPU = 'swiftshader_indirect';

export function resolveGpuMode(optsGpu: string | undefined, env: NodeJS.ProcessEnv): string {
  const raw = env.DEVICE_FARM_EMULATOR_GPU_MODE ?? env.ARGENT_EMULATOR_GPU_MODE ?? optsGpu;
  if (raw === undefined || raw.trim() === '') return DEFAULT_GPU;
  const mode = raw.trim();
  if (!VALID_GPU_MODES.has(mode)) {
    throw new Error(
      `Invalid GPU mode: "${mode}". Valid modes: ${[...VALID_GPU_MODES].join(', ')}.`,
    );
  }
  return mode;
}

/**
 * Whether to pass `-no-window`. Defaults to headless (the farm runs without a
 * display); set DEVICE_FARM_EMULATOR_NO_WINDOW=0/false/no to show the window.
 */
export function resolveNoWindow(env: NodeJS.ProcessEnv): boolean {
  const raw = env.DEVICE_FARM_EMULATOR_NO_WINDOW ?? env.ARGENT_EMULATOR_NO_WINDOW;
  if (raw === undefined) return true;
  return !/^(0|false|no)$/i.test(raw.trim());
}

export interface BootArgsInput {
  avd: string;
  port: number;
  grpcPort: number;
  /** From BootOptions; may be overridden by env. */
  gpu?: string;
  /** Defaults to true (disable audio). */
  noAudio?: boolean;
  /** Skip snapshot load for a clean cold boot. */
  coldBoot?: boolean;
}

/**
 * Build the full emulator argv. Order preserves the established sequence
 * (avd → no-window → boot-anim → port → grpc → snapshot → audio → gpu) so
 * existing arg-order assertions hold, then appends hardening flags.
 */
export function buildEmulatorBootArgs(input: BootArgsInput, env: NodeJS.ProcessEnv): string[] {
  const args: string[] = ['-avd', input.avd];
  if (resolveNoWindow(env)) args.push('-no-window');
  args.push('-no-boot-anim', '-port', String(input.port), '-grpc', String(input.grpcPort));
  if (input.coldBoot === true) args.push('-no-snapshot-load');
  if (input.noAudio !== false) args.push('-no-audio');
  args.push('-gpu', resolveGpuMode(input.gpu, env));
  // Hardening — suppress the Qt crash-consent dialog (SIGABRTs headless on
  // Wayland), telemetry prompts, and latency/throughput network simulation.
  args.push('-netfast', '-no-metrics', '-crash-report-mode', 'never');
  return args;
}

export interface KvmDiagnostic {
  platform: string;
  usable: boolean;
  reason?: string;
}

export interface KvmPreflightDeps {
  platform?: NodeJS.Platform | string;
  canAccess?: (path: string) => boolean;
}

/**
 * Check /dev/kvm on Linux. Off Linux this is a no-op (macOS uses HVF, etc.).
 * `usable: false` means the emulator will fall back to TCG software emulation.
 */
export function kvmPreflight(env: NodeJS.ProcessEnv, deps: KvmPreflightDeps = {}): KvmDiagnostic {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux') return { platform: String(platform), usable: true };

  const canAccess =
    deps.canAccess ??
    ((p: string): boolean => {
      try {
        accessSync(p, fsConstants.R_OK | fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    });

  const usable = canAccess('/dev/kvm');
  return {
    platform: String(platform),
    usable,
    reason: usable
      ? undefined
      : '/dev/kvm is not readable/writable — the emulator will fall back to TCG software ' +
        'emulation (10–50× slower). Enable virtualization in BIOS/UEFI and add your user to ' +
        'the kvm group: sudo usermod -aG kvm "$USER" (then re-login).',
  };
}
