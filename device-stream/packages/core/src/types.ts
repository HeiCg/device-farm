/**
 * Core types and interfaces for device streaming
 * Shared across all @device-stream packages
 */

/**
 * Supported device platforms
 */
export type DevicePlatform = 'android' | 'ios';

/**
 * Input action types supported across platforms
 */
export type InputAction = 'tap' | 'type' | 'back' | 'home' | 'scroll' | 'swipe';

/**
 * Video codec types
 * - h264: Used by Android (scrcpy) and iOS QuickTime fallback
 * - h265: HEVC codec (future support)
 * - mjpeg: Used by iOS MJPEG streaming from WDA and sim-capture
 */
export type VideoCodec = 'h264' | 'h265' | 'mjpeg';

/**
 * Scroll direction type
 */
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Device status for simulators/emulators
 */
export type DeviceStatus =
  | 'creating'      // Being created
  | 'booting'       // Starting up
  | 'ready'         // Ready for use
  | 'busy'          // In use by a task
  | 'stopping'      // Shutting down
  | 'stopped'       // Not running
  | 'error';        // Error state

/**
 * Unified device interface supporting both Android and iOS
 */
export interface Device {
  serial: string;
  platform: DevicePlatform;
  model: string;
  osVersion: string;
  screenWidth: number;
  screenHeight: number;
  battery?: number;
  connected: boolean;
}

/**
 * Video stream metadata
 */
export interface VideoStreamMetadata {
  codec: VideoCodec;
  width: number;
  height: number;
  frameRate?: number;
}

/**
 * Device connection state
 */
export interface DeviceConnection {
  serial: string;
  platform: DevicePlatform;
  connectedAt: number;
  sessionId?: string;
}

/**
 * Platform capabilities
 */
export interface PlatformCapabilities {
  platform: DevicePlatform;
  available: boolean;
  reason?: string;
  features: {
    automation: boolean;
    screenMirroring: boolean;
    fileTransfer: boolean;
    appManagement: boolean;
  };
}

/**
 * Farm device interface for managed simulators/emulators
 */
export interface FarmDevice {
  id: string;
  platform: DevicePlatform;
  name: string;
  status: DeviceStatus;
  serial?: string;
  port?: number;
  createdAt: number;
  lastUsedAt?: number;
  taskId?: string;
  error?: string;
  metadata?: {
    osVersion?: string;
    deviceType?: string;
    screenResolution?: string;
  };
}

/**
 * Options for creating a new device
 */
export interface CreateDeviceOptions {
  platform: DevicePlatform;
  name?: string;
  deviceType?: string;
  osVersion?: string;
}

/**
 * Result of app installation
 */
export interface InstallAppResult {
  success: boolean;
  bundleId?: string;
  error?: string;
}

/**
 * Stream result with status
 */
export interface StreamResult {
  success: boolean;
  error?: string;
}

/**
 * Device farm configuration
 */
export interface DeviceFarmConfig {
  maxAndroidDevices: number;
  maxIOSDevices: number;
  androidDefaults: {
    deviceType: string;
    systemImage: string;
  };
  iosDefaults: {
    deviceType: string;
    runtime: string;
  };
  bootTimeout: number;
  idleTimeout: number;
}

/**
 * Device farm statistics
 */
export interface DeviceFarmStats {
  totalDevices: number;
  androidDevices: {
    total: number;
    ready: number;
    busy: number;
  };
  iosDevices: {
    total: number;
    ready: number;
    busy: number;
  };
  queueLength: number;
}

/**
 * Queued task waiting for a device
 */
export interface QueuedTask {
  id: string;
  platform: DevicePlatform;
  resolve: (device: FarmDevice) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

/**
 * Events emitted by the device farm
 */
export type DeviceFarmEvent =
  | { type: 'device:created'; device: FarmDevice }
  | { type: 'device:ready'; device: FarmDevice }
  | { type: 'device:busy'; device: FarmDevice; taskId: string }
  | { type: 'device:released'; device: FarmDevice }
  | { type: 'device:stopped'; device: FarmDevice }
  | { type: 'device:error'; device: FarmDevice; error: string }
  | { type: 'queue:added'; taskId: string; platform: DevicePlatform }
  | { type: 'queue:fulfilled'; taskId: string; deviceId: string };
