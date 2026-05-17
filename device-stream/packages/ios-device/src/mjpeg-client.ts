/**
 * MJPEG Stream Client for WebDriverAgent
 * Connects to WDA's MJPEG stream endpoint and emits JPEG frames
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import { iosConfig } from './config';

export class MjpegStreamClient extends EventEmitter {
  private activeConnections: Map<string, http.ClientRequest> = new Map();
  private port: number;
  private host: string;

  constructor(host: string = 'localhost', port: number = iosConfig.mjpegPort) {
    super();
    this.host = host;
    this.port = port;
  }

  /**
   * Check if MJPEG stream is available
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get({
        hostname: this.host,
        port: this.port,
        path: '/stream',
        timeout: 5000,
      }, (res) => {
        const contentType = res.headers['content-type'] || '';
        resolve(
          res.statusCode === 200 &&
          (contentType.includes('multipart/x-mixed-replace') ||
           contentType.includes('image/jpeg'))
        );
        res.destroy();
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Connect to MJPEG stream for a device
   * Emits 'frame' events with JPEG Buffer data
   */
  connect(udid: string, port?: number): void {
    if (this.activeConnections.has(udid)) {
      console.warn(`[MjpegStreamClient] Already connected to stream for device ${udid}`);
      return;
    }

    const streamPort = port || this.port;
    console.log(`[MjpegStreamClient] Connecting to MJPEG stream at ${this.host}:${streamPort}/stream for device ${udid}`);

    const req = http.get({
      hostname: this.host,
      port: streamPort,
      path: '/stream',
      headers: {
        'Accept': 'multipart/x-mixed-replace; boundary=--BoundaryString',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        this.emit('error', { udid, error: new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`) });
        return;
      }

      const contentType = res.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/i);
      const boundary = boundaryMatch ? boundaryMatch[1].trim() : '--BoundaryString';

      console.log(`[MjpegStreamClient] Connected, boundary: ${boundary}`);

      let buffer = Buffer.alloc(0);
      let frameStarted = false;
      let frameStart = 0;

      res.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Buffer overflow protection (4MB max)
        if (frameStarted && buffer.length > 4 * 1024 * 1024) {
          console.warn(`[MjpegStreamClient] Buffer overflow for ${udid}, resetting`);
          buffer = Buffer.alloc(0);
          frameStarted = false;
        }

        while (buffer.length > 0) {
          if (!frameStarted) {
            const jpegStart = this.findJpegStart(buffer);
            if (jpegStart >= 0) {
              frameStarted = true;
              frameStart = jpegStart;
            } else {
              if (buffer.length > 2) {
                buffer = buffer.slice(-2);
              }
              break;
            }
          }

          if (frameStarted) {
            const jpegEnd = this.findJpegEnd(buffer, frameStart);
            if (jpegEnd >= 0) {
              const frame = buffer.slice(frameStart, jpegEnd + 2);
              this.emit('frame', { udid, data: frame });
              buffer = buffer.slice(jpegEnd + 2);
              frameStarted = false;
            } else {
              break;
            }
          }
        }
      });

      res.on('end', () => {
        console.log(`[MjpegStreamClient] Stream ended for device ${udid}`);
        this.activeConnections.delete(udid);
        this.emit('disconnected', { udid });
      });

      res.on('error', (error) => {
        console.error(`[MjpegStreamClient] Stream error for device ${udid}:`, error);
        this.activeConnections.delete(udid);
        this.emit('error', { udid, error });
      });
    });

    req.on('error', (error) => {
      console.error(`[MjpegStreamClient] Connection error for device ${udid}:`, error);
      this.activeConnections.delete(udid);
      this.emit('error', { udid, error });
    });

    req.on('timeout', () => {
      console.error(`[MjpegStreamClient] Connection timeout for device ${udid}`);
      req.destroy();
      this.activeConnections.delete(udid);
      this.emit('error', { udid, error: new Error('Connection timeout') });
    });

    this.activeConnections.set(udid, req);
    this.emit('connected', { udid });
  }

  /**
   * Disconnect from MJPEG stream
   */
  disconnect(udid: string): void {
    const req = this.activeConnections.get(udid);
    if (req) {
      req.destroy();
      this.activeConnections.delete(udid);
      console.log(`[MjpegStreamClient] Disconnected from stream for device ${udid}`);
      this.emit('disconnected', { udid });
    }
  }

  /**
   * Disconnect all streams
   */
  disconnectAll(): void {
    const udids = Array.from(this.activeConnections.keys());
    for (const udid of udids) {
      this.disconnect(udid);
    }
  }

  /**
   * Check if connected to a device's stream
   */
  isConnected(udid: string): boolean {
    return this.activeConnections.has(udid);
  }

  /**
   * Find JPEG start marker (0xFF 0xD8) in buffer
   */
  private findJpegStart(buffer: Buffer): number {
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find JPEG end marker (0xFF 0xD9) in buffer after startPos
   */
  private findJpegEnd(buffer: Buffer, startPos: number): number {
    for (let i = startPos + 2; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Get number of active streams
   */
  getActiveStreamCount(): number {
    return this.activeConnections.size;
  }
}

// Export singleton instance
export const mjpegStreamClient = new MjpegStreamClient();
