export type Platform = 'android' | 'ios';

export enum DeviceState {
  Booting = 'booting',
  Idle = 'idle',
  Allocated = 'allocated',
  Running = 'running',
  Cleanup = 'cleanup',
  Error = 'error',
  Offline = 'offline',
}

export interface DeviceMetadata {
  osVersion: string | null;
  sdkVersion: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  screenDensity: number | null;
  ramMb: number | null;
  abi: string | null;
  manufacturer: string | null;
  model: string | null;
  locale: string | null;
  timezone: string | null;
  batteryLevel: number | null;
  collectedAt: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  state: DeviceState;
  emulatorId: string;
  port: number | null;
  /**
   * Emulator gRPC port — populated on boot when Phase 33 gRPC transport is active.
   * Nullable to match a future DB column shape; `null` means "boot did not allocate one".
   */
  grpcPort?: number | null;
  pid: number | null;
  currentJobId: string | null;
  metadata: DeviceMetadata | null;
}

export const VALID_TRANSITIONS: Record<DeviceState, DeviceState[]> = {
  [DeviceState.Booting]: [DeviceState.Idle, DeviceState.Error],
  [DeviceState.Idle]: [DeviceState.Allocated, DeviceState.Error],
  [DeviceState.Allocated]: [DeviceState.Running, DeviceState.Cleanup, DeviceState.Idle, DeviceState.Error],
  [DeviceState.Running]: [DeviceState.Cleanup, DeviceState.Error],
  [DeviceState.Cleanup]: [DeviceState.Idle, DeviceState.Error],
  [DeviceState.Error]: [DeviceState.Booting, DeviceState.Offline],
  [DeviceState.Offline]: [DeviceState.Booting],
};
