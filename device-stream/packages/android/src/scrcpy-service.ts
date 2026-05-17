/**
 * Scrcpy streaming service for Android devices
 * Uses TangoADB (@yume-chan/adb-scrcpy) for H.264 video streaming
 */

import type { Adb } from '@yume-chan/adb';
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { VERSION } from '@yume-chan/fetch-scrcpy-server';
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
import type { ReadableStream } from '@yume-chan/stream-extra';
import type { WebSocket } from 'ws';
import { scrcpySetup } from './scrcpy-setup';

interface ScrcpySession {
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  videoStream: ReadableStream<ScrcpyMediaStreamPacket>;
  serial: string;
  ws: WebSocket;
  reader?: ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
  stopping?: boolean;
}

export class ScrcpyService {
  private sessions: Map<string, ScrcpySession> = new Map();

  /**
   * Phase A — queued tuning targets per serial. Real restart-with-new-flags
   * wiring is deferred to a follow-up phase; for now setters store the
   * desired values so consumers can verify the wire path end-to-end.
   */
  private targets = new Map<string, { bitrate?: number; fps?: number; maxSize?: number }>();

  async startStream(adb: Adb, serial: string, ws: WebSocket): Promise<void> {
    // Stop any existing session for this device
    await this.stopStream(serial);

    console.log(`Starting scrcpy stream for device ${serial}`);

    try {
      // Ensure scrcpy server is deployed on device. Don't force a reinstall on
      // every stream open — that pushes the .jar across adb each time and adds
      // ~1-2s of latency per connect for no benefit. Setup is idempotent and
      // will only push when the on-device version mismatches.
      await scrcpySetup.ensureServerReady(adb, false);

      // Create scrcpy options - use latest version with video enabled
      const options = new AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        tunnelForward: true,
        sendDeviceMeta: true,
        sendCodecMeta: true,
        sendFrameMeta: true,
      }, {
        version: VERSION,
      });

      // Start scrcpy client
      const client = await AdbScrcpyClient.start(
        adb,
        scrcpySetup.getDeviceServerPath(),
        options
      );

      console.log(`Scrcpy client started for ${serial}`);

      // Get video stream
      const videoStreamPromise = await client.videoStream;

      if (!videoStreamPromise) {
        throw new Error('Video stream not available');
      }

      const videoStream = videoStreamPromise.stream;
      const metadata = videoStreamPromise.metadata;

      console.log(`Video stream metadata:`, {
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      });

      // Create session
      const session: ScrcpySession = {
        client,
        videoStream,
        serial,
        ws,
      };

      this.sessions.set(serial, session);

      // Send initial metadata to client. width/height are usually 0 here
      // because adb-scrcpy's InspectStream only populates them once the
      // configuration packet flows through — push a follow-up metadata
      // message via the sizeChanged event for an accurate canvas size.
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: metadata.codec,
        width: videoStreamPromise.width,
        height: videoStreamPromise.height,
      }));
      videoStreamPromise.sizeChanged(({ width, height }) => {
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
          type: 'metadata',
          codec: metadata.codec,
          width,
          height,
        }));
      });

      // Start reading and forwarding video packets (fire-and-forget to avoid blocking)
      this.pipeVideoStream(session).catch(err =>
        console.error('[Scrcpy] pipeVideoStream error for %s:', serial, err)
      );

    } catch (error) {
      console.error('[Scrcpy] Failed to start scrcpy stream for %s:', serial, error);
      throw error;
    }
  }

  private async pipeVideoStream(session: ScrcpySession): Promise<void> {
    const { videoStream, ws, serial } = session;

    try {
      const reader = videoStream.getReader();
      session.reader = reader;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[Scrcpy] video stream ended for %s', serial);
          break;
        }

        // Forward video packet to WebSocket client
        if (ws.readyState === 1) { // WebSocket.OPEN
          const packet = {
            type: value.type,
            data: Buffer.from(value.data).toString('base64'),
            ...(value.type === 'data' && {
              keyframe: value.keyframe,
              pts: value.pts?.toString(),
            }),
          };

          ws.send(JSON.stringify(packet));
        } else {
          console.log('[Scrcpy] WebSocket closed for %s, stopping stream', serial);
          break;
        }
      }
    } catch (error) {
      console.error('[Scrcpy] error reading video stream for %s:', serial, error);
    } finally {
      await this.stopStream(serial);
    }
  }

  async stopStream(serial: string): Promise<void> {
    const session = this.sessions.get(serial);

    if (!session || session.stopping) return;

    session.stopping = true;
    this.sessions.delete(serial);

    console.log(`Stopping scrcpy stream for ${serial}`);

    try {
      if (session.reader) {
        await session.reader.cancel();
      }

      await session.client.close();
    } catch (error) {
      console.error('[Scrcpy] error stopping stream for %s:', serial, error);
    }
  }

  isStreaming(serial: string): boolean {
    return this.sessions.has(serial);
  }

  getSession(serial: string): ScrcpySession | undefined {
    return this.sessions.get(serial);
  }

  /** Phase A stub — queue a new bitrate target. */
  async setBitrate(serial: string, bps: number): Promise<void> {
    console.log('[Scrcpy] queue set_bitrate %d for %s (Phase A stub)', bps, serial);
    this.targets.set(serial, { ...this.targets.get(serial), bitrate: bps });
  }

  /** Phase A stub — queue a new fps cap. */
  async setFps(serial: string, fps: number): Promise<void> {
    console.log('[Scrcpy] queue set_fps %d for %s (Phase A stub)', fps, serial);
    this.targets.set(serial, { ...this.targets.get(serial), fps });
  }

  /** Phase A stub — queue a new maxSize (pixels along the longest edge). */
  async setScale(serial: string, scale: number): Promise<void> {
    // scrcpy's --max-size is an integer pixel value; treat `scale` as a
    // fraction of 1080p for now. Real scaling logic lands when the restart
    // path is wired.
    const maxSize = Math.round(1080 * scale);
    console.log('[Scrcpy] queue set_scale %d (maxSize=%d) for %s (Phase A stub)', scale, maxSize, serial);
    this.targets.set(serial, { ...this.targets.get(serial), maxSize });
  }

  /** Phase A stub — no force-IDR API on TangoADB yet; log only. */
  async forceIdr(serial: string): Promise<void> {
    console.log('[Scrcpy] force_idr requested for %s (Phase A no-op)', serial);
  }

  /** Read-only view of queued tuning targets for a serial. */
  getQueuedTargets(serial: string): { bitrate?: number; fps?: number; maxSize?: number } | undefined {
    return this.targets.get(serial);
  }

  /**
   * Stop all active streams
   */
  async stopAll(): Promise<void> {
    const serials = Array.from(this.sessions.keys());
    await Promise.all(serials.map(serial => this.stopStream(serial)));
  }
}

export const scrcpyService = new ScrcpyService();
