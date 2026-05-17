/**
 * QuickTime video capture service using quicktime_video_hack (qvh)
 * Captures H264 video from iOS devices for screen mirroring
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class QuickTimeCapture extends EventEmitter {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private activeWatchers: Map<string, fs.FSWatcher> = new Map();
  private tempDir: string;

  constructor() {
    super();
    this.tempDir = path.join(os.tmpdir(), 'device-stream-ios-capture');

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Check if quicktime_video_hack (qvh) is installed
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('which', ['qvh']);
      check.on('close', (code) => {
        resolve(code === 0);
      });
      check.on('error', () => resolve(false));
    });
  }

  /**
   * Start capturing video from iOS device
   * Streams H264 video data via 'videoData' event
   */
  async startCapture(udid: string): Promise<void> {
    if (this.activeProcesses.has(udid)) {
      throw new Error(`Already capturing from device ${udid}`);
    }

    const videoFile = path.join(this.tempDir, `${udid}.h264`);
    const audioFile = path.join(this.tempDir, `${udid}.wav`);

    [videoFile, audioFile].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });

    const qvh = spawn('qvh', [
      'record',
      videoFile,
      audioFile,
      `--udid=${udid}`
    ]);

    this.activeProcesses.set(udid, qvh);

    qvh.stderr?.on('data', (data) => {
      const message = data.toString();
      console.log(`[QVH ${udid}] ${message}`);
      if (message.includes('error') || message.includes('failed')) {
        console.error(`[QVH ${udid} ERROR DETECTED] ${message}`);
      }
    });

    qvh.stdout?.on('data', (data) => {
      console.log(`[QVH ${udid} DATA]: ${data.toString()}`);
    });

    qvh.on('close', (code) => {
      console.log(`[QVH ${udid} CLOSE]: Process exited with code ${code}`);
      this.activeProcesses.delete(udid);
      this.emit('stopped', { udid });

      [videoFile, audioFile].forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
    });

    qvh.on('error', (error) => {
      console.error(`[QuickTimeCapture] Failed to start QVH process for ${udid}:`, error);
      this.activeProcesses.delete(udid);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    this.startFileStream(udid, videoFile);

    console.log(`Started QuickTime capture for iOS device ${udid}`);
  }

  /**
   * Stream H264 file as it's being written
   */
  private startFileStream(udid: string, videoFile: string): void {
    let position = 0;
    let readStream: fs.ReadStream | null = null;
    let isReading = false;

    const readNewData = () => {
      if (isReading || !this.activeProcesses.has(udid)) return;

      if (!fs.existsSync(videoFile)) return;

      const stats = fs.statSync(videoFile);
      if (stats.size <= position) return;

      isReading = true;

      readStream = fs.createReadStream(videoFile, {
        start: position,
        highWaterMark: 64 * 1024,
      });

      const chunks: Buffer[] = [];

      readStream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      readStream.on('end', () => {
        if (chunks.length > 0) {
          const data = Buffer.concat(chunks);
          position += data.length;
          this.emit('videoData', { udid, data });
        }
        isReading = false;
        readStream = null;
      });

      readStream.on('error', (error) => {
        console.error(`[QuickTimeCapture] Read stream error for ${udid}:`, error);
        isReading = false;
        readStream = null;
      });
    };

    const waitForFile = () => {
      if (fs.existsSync(videoFile)) {
        startWatching();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.activeProcesses.has(udid)) {
          waitForFile();
        }
      }, 100);

      this.once('stopped', (event) => {
        if (event.udid === udid) {
          clearTimeout(timeout);
        }
      });
    };

    const startWatching = () => {
      try {
        const watcher = fs.watch(videoFile, { persistent: false }, (eventType) => {
          if (eventType === 'change') {
            readNewData();
          }
        });

        watcher.on('error', (error) => {
          console.error(`[QuickTimeCapture] File watcher error for ${udid}:`, error);
          startPolling();
        });

        this.activeWatchers.set(udid, watcher);
        readNewData();

        this.once('stopped', (event) => {
          if (event.udid === udid) {
            watcher.close();
            this.activeWatchers.delete(udid);
            if (readStream) {
              readStream.destroy();
            }
          }
        });
      } catch (error) {
        console.error(`[QuickTimeCapture] Failed to start file watcher for ${udid}:`, error);
        startPolling();
      }
    };

    const startPolling = () => {
      const interval = setInterval(() => {
        if (!this.activeProcesses.has(udid)) {
          clearInterval(interval);
          return;
        }
        readNewData();
      }, 50);

      this.once('stopped', (event) => {
        if (event.udid === udid) {
          clearInterval(interval);
          if (readStream) {
            readStream.destroy();
          }
        }
      });
    };

    waitForFile();
  }

  /**
   * Stop capturing from device
   */
  async stopCapture(udid: string): Promise<void> {
    const proc = this.activeProcesses.get(udid);

    if (!proc) {
      console.warn(`No active capture for device ${udid}`);
      return;
    }

    proc.kill('SIGTERM');

    // Wait for process to exit, with timeout and SIGKILL fallback
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.activeProcesses.has(udid)) {
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        }
        resolve();
      }, 3000);

      proc.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    console.log(`Stopped QuickTime capture for iOS device ${udid}`);
  }

  /**
   * Stop all active captures
   */
  async stopAll(): Promise<void> {
    const udids = Array.from(this.activeProcesses.keys());
    await Promise.all(udids.map(udid => this.stopCapture(udid)));
  }

  /**
   * Check if currently capturing from a device
   */
  isCapturing(udid: string): boolean {
    return this.activeProcesses.has(udid);
  }

  /**
   * Cleanup temp directory
   */
  cleanup(): void {
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }
}

// Export singleton instance
export const quickTimeCapture = new QuickTimeCapture();

// Cleanup on process exit
process.on('exit', () => {
  quickTimeCapture.stopAll();
  quickTimeCapture.cleanup();
});
