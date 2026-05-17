/**
 * @device-stream/ios-simulator
 * iOS Simulator streaming via ScreenCaptureKit (sim-capture binary)
 */

export {
  SimulatorStreamService,
  simulatorStreamService,
} from './stream-service';

export {
  IOSSimulatorManager,
  IOSSimulatorManagerOptions,
  createIOSSimulatorManager,
} from './simulator-manager';

export {
  CaptureService,
  createCaptureService,
} from './capture-service';

export {
  SimCapturePrivateClient,
  SimCapturePrivateOptions,
  SimCapturePrivateFrameEvent,
} from './sim-capture-private-client';

export * from './log-stream.js';
export * from './describe-ui.js';
export * from './chrome.js';
export * from './camera-layout.js';
export * from './input-service.js';

// Re-export core types for convenience
export {
  FarmDevice,
  DeviceStatus,
  CreateDeviceOptions,
  InstallAppResult,
  StreamResult,
} from '@device-stream/core';
