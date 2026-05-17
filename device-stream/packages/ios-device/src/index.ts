/**
 * @device-stream/ios-device
 * iOS physical device streaming via WDA MJPEG + qvh H.264 fallback
 */

export {
  IOSDeviceService,
  iosDeviceService,
} from './device-service';

export {
  GoIOSClient,
  GoIOSDevice,
  goIOSClient,
} from './go-ios-client';

export {
  WebDriverAgentClient,
  WDASessionConfig,
  webDriverAgentClient,
} from './wda-client';

export {
  MjpegStreamClient,
  mjpegStreamClient,
} from './mjpeg-client';

export {
  QuickTimeCapture,
  quickTimeCapture,
} from './quicktime-capture';

export {
  iosConfig,
  IOSConfig,
} from './config';

// Re-export core types for convenience
export {
  Device,
  VideoStreamMetadata,
  DeviceConnection,
} from '@device-stream/core';
