/**
 * Pool types - DeviceDriver interface and related types.
 */

/**
 * Boot options passed to DeviceDriver.boot.
 *
 * Phase 31 / Plan 31-03 / SC3 — extended with per-job emulator argv options
 * (coldBoot, noAudio, gpu). Defaults match `bootOptionsSchema` in
 * server/config/schema.ts so passing `undefined` preserves the current
 * pre-Phase-31 emulator behavior.
 */
export interface BootOptions {
  timeout?: number;
  coldBoot?: boolean;
  noAudio?: boolean;
  gpu?: 'swiftshader_indirect' | 'host' | 'auto';
}

export interface BootResult {
  port: number;
  pid: number;
  /**
   * Emulator gRPC port (band 8554-8650) for the Android EmulatorController service.
   * Phase 33 — see .planning/phases/33-android-grpc/33-RESEARCH.md §Device entity changes.
   * `undefined` when gRPC was not requested (physical devices, allocation failure, env opt-out).
   */
  grpcPort?: number;
}

export interface AndroidDeviceConfig {
  enabled: boolean;
  max_instances: number;
  headless: boolean;
  api_level: string;
  system_image_variant: string;
  device_profile: string;
  ram_mb: number;
}

export interface IosDeviceConfig {
  enabled: boolean;
  max_instances: number;
  runtime: string;
  device_type: string;
}

export type DeviceConfig = AndroidDeviceConfig | IosDeviceConfig;

/**
 * DeviceDriver interface - the contract that platform-specific drivers implement.
 * Each method corresponds to a lifecycle phase of a virtual device.
 */
export interface DeviceDriver {
  /** Create a new virtual device (AVD or simulator). Returns emulatorId/UDID. */
  create(name: string, config: DeviceConfig): Promise<string>;

  /** Boot the virtual device. Returns port and PID. */
  boot(emulatorId: string, options?: BootOptions): Promise<BootResult>;

  /** Shut down the virtual device. */
  shutdown(emulatorId: string): Promise<void>;

  /** Check if the virtual device is healthy and responsive. */
  isHealthy(emulatorId: string, port?: number | null): Promise<boolean>;

  /** Clean up the virtual device between jobs (snapshot restore or erase). */
  cleanup(emulatorId: string): Promise<void>;
}
