import type { ScrcpyService } from '@device-stream/android';
import type { DeviceStreamAdapter } from '../device-preview.js';

/**
 * Android preview adapter that taps into ScrcpyService recording callback
 * to deliver H.264 frames for live preview without breaking recording.
 *
 * Callback chaining: If an existing onPacket callback (e.g. from H264FrameSource
 * for recording) is present on the session, it is preserved and called first.
 * On stop(), the original callback is restored so recording continues uninterrupted.
 */
export class AndroidPreviewAdapter implements DeviceStreamAdapter {
  private readonly scrcpyService: ScrcpyService;
  private readonly deviceId: string;
  private frameHandler: ((frame: Buffer) => void) | null = null;
  private originalCallback: ((packet: any) => void) | undefined = undefined;
  private hadOriginalCallback = false;

  constructor(scrcpyService: ScrcpyService, deviceId: string) {
    this.scrcpyService = scrcpyService;
    this.deviceId = deviceId;
  }

  onFrame(handler: (frame: Buffer) => void): void {
    this.frameHandler = handler;
  }

  async start(deviceId: string): Promise<void> {
    // Capture existing onPacket callback (e.g. set by H264FrameSource for recording)
    const session = this.scrcpyService.getSession(deviceId);
    if (session?.onPacket) {
      this.originalCallback = session.onPacket;
      this.hadOriginalCallback = true;
    }

    // Set up chained callback that preserves existing callback AND adds preview
    this.scrcpyService.setRecordingCallback(deviceId, (packet) => {
      // Call original callback first (preserves recording)
      if (this.originalCallback) {
        this.originalCallback(packet);
      }
      // Then deliver frame to preview handler (both 'configuration' and 'data' packets)
      if (this.frameHandler) {
        this.frameHandler(Buffer.from(packet.data));
      }
    });
  }

  async stop(): Promise<void> {
    // Restore original callback if one existed, otherwise remove
    if (this.hadOriginalCallback) {
      this.scrcpyService.setRecordingCallback(this.deviceId, this.originalCallback);
    } else {
      this.scrcpyService.setRecordingCallback(this.deviceId, undefined);
    }
    this.frameHandler = null;
  }
}
