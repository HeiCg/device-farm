/**
 * Core interfaces for device streaming services
 */

import {
  Device,
  DevicePlatform,
  DeviceConnection,
  VideoStreamMetadata,
  ScrollDirection,
} from './types';

/**
 * Base interface for all device services (Android, iOS, etc.)
 */
export interface DeviceService {
  /**
   * Get the platform this service handles
   */
  getPlatform(): DevicePlatform;

  /**
   * List all available devices for this platform
   */
  listDevices(): Promise<Device[]>;

  /**
   * Connect to a specific device
   */
  connect(serial: string): Promise<void>;

  /**
   * Disconnect from a device
   */
  disconnect(serial: string): Promise<void>;

  /**
   * Check if a device is connected
   */
  isConnected(serial: string): boolean;

  /**
   * Execute tap gesture at coordinates
   */
  tap(serial: string, x: number, y: number): Promise<void>;

  /**
   * Type text on the device
   */
  typeText(serial: string, text: string): Promise<void>;

  /**
   * Press a system key
   */
  pressKey(serial: string, key: string): Promise<void>;

  /**
   * Capture screenshot
   */
  screenshot(serial: string): Promise<Buffer>;

  /**
   * Perform swipe gesture
   */
  swipe?(
    serial: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration?: number
  ): Promise<void>;

  /**
   * Perform scroll gesture in a direction
   */
  scroll?(
    serial: string,
    direction: ScrollDirection,
    distance?: number
  ): Promise<void>;

  /**
   * Start screen mirroring stream
   */
  startMirroring(serial: string): Promise<VideoStreamMetadata>;

  /**
   * Stop screen mirroring stream
   */
  stopMirroring(serial: string): Promise<void>;
}

/**
 * Abstract base class for platform-specific device services
 * Provides common functionality and state management
 */
export abstract class BaseDeviceService implements DeviceService {
  protected connections: Map<string, DeviceConnection> = new Map();
  protected platform: DevicePlatform;

  constructor(platform: DevicePlatform) {
    this.platform = platform;
  }

  getPlatform(): DevicePlatform {
    return this.platform;
  }

  isConnected(serial: string): boolean {
    return this.connections.has(serial);
  }

  protected markConnected(serial: string, sessionId?: string): void {
    this.connections.set(serial, {
      serial,
      platform: this.platform,
      connectedAt: Date.now(),
      sessionId,
    });
  }

  protected markDisconnected(serial: string): void {
    this.connections.delete(serial);
  }

  protected assertConnected(serial: string): void {
    if (!this.isConnected(serial)) {
      throw new Error(`Device ${serial} is not connected. Platform: ${this.platform}`);
    }
  }

  protected getConnection(serial: string): DeviceConnection {
    const connection = this.connections.get(serial);
    if (!connection) {
      throw new Error(`Device ${serial} is not connected. Platform: ${this.platform}`);
    }
    return connection;
  }

  async swipe(
    _serial: string,
    _startX: number,
    _startY: number,
    _endX: number,
    _endY: number,
    _duration?: number
  ): Promise<void> {
    throw new Error(`swipe is not supported on platform: ${this.platform}`);
  }

  async scroll(
    _serial: string,
    _direction: ScrollDirection,
    _distance?: number
  ): Promise<void> {
    throw new Error(`scroll is not supported on platform: ${this.platform}`);
  }

  // Abstract methods to be implemented by platform-specific services
  abstract listDevices(): Promise<Device[]>;
  abstract connect(serial: string): Promise<void>;
  abstract disconnect(serial: string): Promise<void>;
  abstract tap(serial: string, x: number, y: number): Promise<void>;
  abstract typeText(serial: string, text: string): Promise<void>;
  abstract pressKey(serial: string, key: string): Promise<void>;
  abstract screenshot(serial: string): Promise<Buffer>;
  abstract startMirroring(serial: string): Promise<VideoStreamMetadata>;
  abstract stopMirroring(serial: string): Promise<void>;
}
