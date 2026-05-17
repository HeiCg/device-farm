import type { AdapterFactory } from '../device-preview.js';
import type { ScrcpyService } from '@device-stream/android';
import type { CaptureService } from '@device-stream/ios-simulator';
import { AndroidPreviewAdapter } from './android-preview-adapter.js';
import { IosPreviewAdapter } from './ios-preview-adapter.js';

export function createAdapterFactory(
  scrcpyService: ScrcpyService,
  captureService: CaptureService,
): AdapterFactory {
  return (deviceId, platform) => {
    if (platform === 'android') {
      return new AndroidPreviewAdapter(scrcpyService, deviceId);
    }
    return new IosPreviewAdapter(captureService, deviceId);
  };
}
