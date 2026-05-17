/**
 * iOS Simulator Stream Service
 * Receives frames from CaptureService and relays to browser WebSockets.
 * Supports MJPEG (legacy JSON frames) and AVCC (binary tag-prefixed frames).
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import {
  parseClientMessage,
  isControlMessage,
  isGestureMessage,
  serializeAvccFrame,
  type AvccFrameKind,
} from '@device-stream/core';
import { ControlChannel, type ControlHandlers } from './control-channel.js';
import type { InputService } from './input-service.js';

type StreamMode = 'mjpeg' | 'avcc';

interface SimulatorMetadata {
  width: number;
  height: number;
  fps: number;
}

interface BrowserEntry {
  ws: WebSocket;
  mode: StreamMode;
}

interface SimulatorConnection {
  browsers: Set<BrowserEntry>;
  metadata?: SimulatorMetadata;
  // Last avcC description seen — replayed to new joiners in AVCC mode so
  // they can configure their decoder without waiting for the next IDR.
  lastAvccDescription?: Buffer;
  lastFrameTime: number;
  frameCount: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

/**
 * AVCC frame source. The CaptureService emits 'frame' with
 * { udid, kind, payload } for AVCC captures; the stream service listens
 * for those events and forwards the binary-tagged payload over each
 * AVCC-mode browser socket.
 */
export interface AvccFrameSource extends EventEmitter {
  on(event: 'frame', listener: (frame: { udid: string; kind: AvccFrameKind; payload: Buffer }) => void): this;
  off(event: 'frame', listener: (frame: { udid: string; kind: AvccFrameKind; payload: Buffer }) => void): this;
}

export interface SimulatorStreamServiceOptions {
  /**
   * Optional input dispatcher. When set, gesture envelopes received on
   * the browser WebSocket are forwarded via `inputs.send(udid, env)`.
   * When absent, gesture envelopes are dropped with a warn-level log.
   */
  inputs?: InputService;
}

export class SimulatorStreamService {
  private connections = new Map<string, SimulatorConnection>();
  private avccSource?: AvccFrameSource;
  private avccListener?: (frame: { udid: string; kind: AvccFrameKind; payload: Buffer }) => void;
  private inputs?: InputService;

  constructor(opts: SimulatorStreamServiceOptions = {}) {
    this.inputs = opts.inputs;
  }

  /**
   * Late-bind / replace the InputService used to dispatch gestures.
   * Useful when the manager is built after the stream service (e.g.
   * test-app boot order) or when swapping for tests.
   */
  setInputs(inputs: InputService | undefined): void {
    this.inputs = inputs;
  }

  /**
   * Wire a CaptureService-like emitter so AVCC 'frame' events get
   * forwarded to AVCC-mode browser sockets for the matching udid.
   */
  attachAvccSource(source: AvccFrameSource): void {
    this.detachAvccSource();
    const listener = (frame: { udid: string; kind: AvccFrameKind; payload: Buffer }) => {
      this.injectAvccFrame(frame.udid, frame.kind, frame.payload);
    };
    source.on('frame', listener);
    this.avccSource = source;
    this.avccListener = listener;
  }

  detachAvccSource(): void {
    if (this.avccSource && this.avccListener) {
      this.avccSource.off('frame', this.avccListener);
    }
    this.avccSource = undefined;
    this.avccListener = undefined;
  }

  /**
   * Handle connection from browser wanting to view simulator stream.
   * `mode` selects MJPEG (default, legacy) or AVCC binary framing.
   */
  handleBrowserConnection(
    ws: WebSocket,
    deviceId: string,
    controlHandlers?: ControlHandlers,
    mode: StreamMode = 'mjpeg',
  ): void {
    let conn = this.connections.get(deviceId);

    if (!conn) {
      conn = {
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0,
      };
      this.connections.set(deviceId, conn);
    }

    if (conn.cleanupTimer) {
      clearTimeout(conn.cleanupTimer);
      conn.cleanupTimer = undefined;
    }

    const entry: BrowserEntry = { ws, mode };
    conn.browsers.add(entry);
    console.log('[SimStream] Browser connected to %s (mode=%s, %d browsers)', deviceId, mode, conn.browsers.size);

    if (mode === 'mjpeg' && conn.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        codec: 1, // mjpeg
        codecName: 'mjpeg',
        ...conn.metadata,
      }));
    }

    // For AVCC joiners: replay the last avcC description so their decoder
    // is configured before the next keyframe arrives.
    if (mode === 'avcc' && conn.lastAvccDescription) {
      try {
        ws.send(serializeAvccFrame('avcc', conn.lastAvccDescription), { binary: true });
      } catch (err) {
        console.error('[SimStream] replay avcC failed for %s: %s', deviceId, err);
      }
    }

    ws.on('close', () => {
      conn?.browsers.delete(entry);
      console.log('[SimStream] Browser disconnected from %s (%d browsers)', deviceId, conn?.browsers.size ?? 0);

      if (conn?.browsers.size === 0) {
        conn.cleanupTimer = setTimeout(() => {
          const currentConn = this.connections.get(deviceId);
          if (currentConn?.browsers.size === 0) {
            this.connections.delete(deviceId);
          }
        }, 30000);
      }
    });

    ws.on('error', (error) => {
      console.error('[SimStream] Browser error for %s: %s', deviceId, error);
    });

    if (controlHandlers) {
      const channel = new ControlChannel(controlHandlers);
      ws.on('message', (raw: Buffer | string) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const parsed = parseClientMessage(text);
        if (!parsed.ok) {
          console.warn('[SimStream] v2 parse error for %s: %s', deviceId, parsed.error);
          return;
        }
        if (isControlMessage(parsed.value)) {
          channel.handle(parsed.value);
        } else if (isGestureMessage(parsed.value)) {
          if (this.inputs) {
            this.inputs.send(deviceId, parsed.value).catch((e) =>
              console.warn('[stream-service gesture %s] %s', deviceId, e?.message ?? String(e))
            );
          } else {
            console.warn('[stream-service gesture %s] dropped (no InputService configured)', deviceId);
          }
        }
      });
    }
  }

  /**
   * Inject an MJPEG frame from the legacy ScreenCaptureKit capture path.
   * Broadcasts as a JSON `{type:'frame'}` message to MJPEG-mode browsers.
   */
  injectFrame(deviceId: string, base64Jpeg: string, width: number, height: number): void {
    let conn = this.connections.get(deviceId);
    if (!conn) {
      conn = {
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0,
      };
      this.connections.set(deviceId, conn);
    }

    if (!conn.metadata || conn.metadata.width !== width || conn.metadata.height !== height) {
      conn.metadata = { width, height, fps: 30 };
      const metaMsg = JSON.stringify({
        type: 'metadata',
        codec: 1,
        codecName: 'mjpeg',
        width,
        height,
        fps: 30,
      });
      conn.browsers.forEach(entry => {
        if (entry.mode === 'mjpeg' && entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(metaMsg);
        }
      });
    }

    conn.lastFrameTime = Date.now();
    conn.frameCount++;

    if (conn.frameCount === 1) {
      console.log('[SimStream] Device %s first injected frame - ScreenCaptureKit working', deviceId);
    }

    const frameData = JSON.stringify({
      type: 'frame',
      data: base64Jpeg,
      pts: conn.frameCount,
      codec: 'mjpeg',
    });

    conn.browsers.forEach(entry => {
      if (entry.mode === 'mjpeg' && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(frameData);
      }
    });
  }

  /**
   * Inject an AVCC frame (avcC blob, keyframe, delta, or JPEG seed).
   * Broadcasts as a binary tag-prefixed message to AVCC-mode browsers.
   */
  injectAvccFrame(deviceId: string, kind: AvccFrameKind, payload: Buffer): void {
    let conn = this.connections.get(deviceId);
    if (!conn) {
      conn = {
        browsers: new Set(),
        lastFrameTime: Date.now(),
        frameCount: 0,
      };
      this.connections.set(deviceId, conn);
    }

    if (kind === 'avcc') {
      conn.lastAvccDescription = Buffer.from(payload);
    }

    conn.lastFrameTime = Date.now();
    conn.frameCount++;

    const wire = serializeAvccFrame(kind, payload);
    conn.browsers.forEach(entry => {
      if (entry.mode === 'avcc' && entry.ws.readyState === WebSocket.OPEN) {
        try {
          entry.ws.send(wire, { binary: true });
        } catch (err) {
          console.error('[SimStream] avcc send failed for %s: %s', deviceId, err);
        }
      }
    });
  }

  isStreaming(deviceId: string): boolean {
    const conn = this.connections.get(deviceId);
    if (!conn) return false;
    return (Date.now() - conn.lastFrameTime) < 5000;
  }

  getDeviceStats(deviceId: string): {
    browserCount: number;
    frameCount: number;
    metadata?: SimulatorMetadata;
  } | null {
    const conn = this.connections.get(deviceId);
    if (!conn) return null;
    return {
      browserCount: conn.browsers.size,
      frameCount: conn.frameCount,
      metadata: conn.metadata,
    };
  }

  cleanup(): void {
    this.detachAvccSource();
    for (const [, conn] of this.connections) {
      conn.browsers.forEach(entry => {
        if (entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.close();
        }
      });
    }
    this.connections.clear();
  }
}

// Export singleton instance
export const simulatorStreamService = new SimulatorStreamService();
