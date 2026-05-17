import type { CaptureService } from '@device-stream/ios-simulator';
import type { DeviceStreamAdapter } from '../device-preview.js';

/**
 * iOS preview adapter that listens on CaptureService 'frameData' events
 * filtered by deviceId, decoding base64 JPEG to raw Buffer for preview delivery.
 *
 * Uses EventEmitter on('frameData') instead of setFrameCallback to support
 * multiple listeners without conflicting with other consumers.
 */
export class IosPreviewAdapter implements DeviceStreamAdapter {
  private readonly captureService: CaptureService;
  private readonly deviceId: string;
  private frameHandler: ((frame: Buffer) => void) | null = null;
  private eventHandler: ((deviceId: string, base64Jpeg: string, width: number, height: number) => void) | null = null;

  constructor(captureService: CaptureService, deviceId: string) {
    this.captureService = captureService;
    this.deviceId = deviceId;
  }

  onFrame(handler: (frame: Buffer) => void): void {
    this.frameHandler = handler;
  }

  async start(deviceId: string): Promise<void> {
    // Start capture if not already running
    if (!this.captureService.isCapturing(deviceId)) {
      await this.captureService.startCapture(deviceId);
    }

    // Register frame listener filtered by deviceId
    this.eventHandler = (emittedDeviceId: string, base64Jpeg: string, _width: number, _height: number) => {
      if (emittedDeviceId === deviceId && this.frameHandler) {
        this.frameHandler(Buffer.from(base64Jpeg, 'base64'));
      }
    };

    this.captureService.on('frameData', this.eventHandler);
  }

  async stop(): Promise<void> {
    if (this.eventHandler) {
      this.captureService.off('frameData', this.eventHandler);
    }
    this.frameHandler = null;
    this.eventHandler = null;
    // Do NOT call stopCapture — capture lifecycle managed externally
  }
}
