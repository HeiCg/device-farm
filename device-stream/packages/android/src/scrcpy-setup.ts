/**
 * Scrcpy server deployment to Android devices.
 *
 * Phase 33 (2026-05-16): scrcpy-server.jar is STILL required for physical
 * Android devices. Emulators use gRPC + MMAP via the android-grpc-stream
 * daemon (default after canary; opt-out with `DEVICE_STREAM_ANDROID_GRPC=0`).
 * This module remains active for the physical-device fallback path and as
 * the gRPC-disabled fallback for emulators. See:
 *   - docs/runbooks/android-grpc.md   (operator runbook)
 *   - device-stream/packages/android/src/service.ts §AndroidStreamingService
 *     (selection rule that picks gRPC for emulators, scrcpy for physical).
 *
 * See: https://tangoadb.dev/scrcpy/push-server/
 */

import type { Adb } from '@yume-chan/adb';
import { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { BIN, VERSION } from '@yume-chan/fetch-scrcpy-server';
import { readFile } from 'fs/promises';
import { ReadableStream } from '@yume-chan/stream-extra';

const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';

export class ScrcpySetup {
  /**
   * Get the scrcpy server version from the fetch-scrcpy-server package
   */
  getVersion(): string {
    return VERSION;
  }

  /**
   * Pushes the scrcpy server to the device using AdbScrcpyClient.pushServer
   * See: https://tangoadb.dev/scrcpy/push-server/
   */
  async pushServerToDevice(adb: Adb): Promise<void> {
    try {
      console.log(`Pushing scrcpy server v${VERSION} to device...`);

      const serverBuffer = await readFile(BIN);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(serverBuffer));
          controller.close();
        }
      });

      await AdbScrcpyClient.pushServer(adb, stream, DEVICE_SERVER_PATH);

      console.log(`✓ Scrcpy server v${VERSION} pushed to device at ${DEVICE_SERVER_PATH}`);
    } catch (error) {
      console.error('Failed to push scrcpy server to device:', error);
      throw error;
    }
  }

  /**
   * Checks if scrcpy server exists on device
   * Uses spawnWaitText for convenience
   * See: https://tangoadb.dev/api/adb/subprocess/none-protocol/
   */
  async checkServerOnDevice(adb: Adb): Promise<boolean> {
    try {
      const protocol = adb.subprocess.shellProtocol || adb.subprocess.noneProtocol;
      const result = await protocol.spawnWaitText(
        `test -f ${DEVICE_SERVER_PATH} && echo exists || echo missing`
      );
      const output = typeof result === 'string' ? result : result.stdout;
      return output.trim() === 'exists';
    } catch (error) {
      console.error('Failed to check scrcpy server on device:', error);
      return false;
    }
  }

  /**
   * Removes the scrcpy server from the device
   */
  async removeServerFromDevice(adb: Adb): Promise<void> {
    try {
      console.log('Removing old scrcpy server from device...');
      const protocol = adb.subprocess.shellProtocol || adb.subprocess.noneProtocol;
      await protocol.spawnWaitText(`rm -f ${DEVICE_SERVER_PATH}`);
      console.log('✓ Old scrcpy server removed');
    } catch (error) {
      console.error('Failed to remove scrcpy server from device:', error);
      throw error;
    }
  }

  /**
   * Ensures scrcpy server is ready on the device
   */
  async ensureServerReady(adb: Adb, forceReinstall = false): Promise<void> {
    if (forceReinstall) {
      console.log('Force reinstall requested, removing old server...');
      await this.removeServerFromDevice(adb);
    }

    const exists = await this.checkServerOnDevice(adb);

    if (!exists) {
      console.log('Scrcpy server not found on device, deploying...');
      await this.pushServerToDevice(adb);
    } else {
      console.log(`✓ Scrcpy server v${VERSION} already on device`);
    }
  }

  getDeviceServerPath(): string {
    return DEVICE_SERVER_PATH;
  }
}

export const scrcpySetup = new ScrcpySetup();
