/**
 * AndroidStreamingService (Phase 33 / T-33.6 + T-33.7 / Wave 4).
 *
 * Thin selector wrapping the legacy ScrcpyService and the new GrpcEmuClient.
 *
 * Selection rule (mirrors 33-RESEARCH.md §TS service swap, line 624-685):
 *   1. device.kind !== 'emulator'         -> scrcpy   (physical Android stays on scrcpy per scope)
 *   2. device.grpcPort == null            -> scrcpy   (no gRPC port allocated)
 *   3. DEVICE_STREAM_ANDROID_GRPC === '0' -> scrcpy   (explicit operator opt-out)
 *   4. otherwise                          -> try GrpcEmuClient.spawn; on
 *                                            rejection log.warn + fall back to
 *                                            scrcpy (NEVER throw to the caller).
 *
 * Mid-stream daemon failure is NOT a fallback case — the GrpcEmuClient emits
 * 'crashed' on the post-first-frame exit path and we surface it as a normal
 * stream error rather than restarting under scrcpy (the emulator is bad).
 *
 * Touch + key routing helpers (routeTap/routeKey) are owned by this module
 * because the session Map lives here. device-service.ts delegates BEFORE
 * shelling out to ADB so we keep the existing ADB path untouched as the
 * fallback target.
 *
 * typeText UNCHANGED — the proto subset has no sendText and the ADB
 * `input text` path is still the only way to type into an Android emulator.
 */

import type { WebSocket } from 'ws';
import type { Adb } from '@yume-chan/adb';

import { GrpcEmuClient } from './grpc-emu-client';
import { scrcpyService } from './scrcpy-service';

export interface AndroidStreamingTarget {
  serial: string;
  kind: 'emulator' | 'physical';
  grpcPort?: number | null;
}

export type AndroidSession =
  | {
      kind: 'grpc';
      client: GrpcEmuClient;
      /** Populated from the daemon's 0x03 metadata frame. */
      display?: { width: number; height: number };
    }
  | { kind: 'scrcpy' };

export class AndroidStreamingService {
  private sessions = new Map<string, AndroidSession>();

  /**
   * Start streaming for `device`. `adb` is required for the scrcpy fallback
   * path (TangoADB's `AdbScrcpyClient.start` needs the Adb instance); it may
   * be `null` when the operator forces the gRPC path with a pre-allocated
   * grpcPort and accepts that fallback will throw on missing Adb.
   */
  async start(
    device: AndroidStreamingTarget,
    adb: Adb | null,
    ws: WebSocket | null,
  ): Promise<void> {
    const useGrpc =
      device.kind === 'emulator' &&
      device.grpcPort != null &&
      process.env.DEVICE_STREAM_ANDROID_GRPC !== '0';

    if (useGrpc) {
      try {
        const client = await GrpcEmuClient.spawn(device.serial, device.grpcPort!, ws);
        const session: AndroidSession = { kind: 'grpc', client };

        // The first 0x03 frame populates display dimensions for pixel-ratio math.
        client.on('metadata', (m: { width: number; height: number; fps: number }) => {
          session.display = { width: m.width, height: m.height };
        });
        // Mid-stream crash = emulator went bad; surface but don't restart scrcpy.
        client.on('crashed', (err: Error) => {
          console.error(
            '[AndroidStreamingService] grpc daemon crashed mid-stream for %s: %s',
            device.serial, err.message,
          );
        });

        this.sessions.set(device.serial, session);
        return;
      } catch (err) {
        // Spawn-failure path: log.warn (NOT log.error — fallback is graceful)
        // and fall through to scrcpy below. The error is grep-able via the
        // [AndroidStreamingService] prefix + serial.
        console.warn(
          '[AndroidStreamingService] gRPC path failed for %s, falling back to scrcpy: %s',
          device.serial, (err as Error).message,
        );
      }
    }

    if (adb != null) {
      await scrcpyService.startStream(adb, device.serial, ws as WebSocket);
    }
    this.sessions.set(device.serial, { kind: 'scrcpy' });
  }

  async stop(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (!session) return;
    this.sessions.delete(serial);
    if (session.kind === 'grpc') {
      await session.client.stop();
    } else {
      await scrcpyService.stopStream(serial);
    }
  }

  /** Read-only view of the active session for the given serial. */
  getSession(serial: string): AndroidSession | undefined {
    return this.sessions.get(serial);
  }

  /**
   * Attempt to handle a tap via the gRPC daemon. Returns true if routed
   * through gRPC (caller must NOT also send ADB input); false if the session
   * is scrcpy or absent and the caller should fall back to ADB.
   *
   * Encodes tap as two touch events (phase 0 = began, phase 2 = ended) at
   * the same coordinate, mirroring kittyfarm AndroidEmulatorTouchTranslator
   * tap semantics.
   */
  async routeTap(serial: string, x: number, y: number): Promise<boolean> {
    const session = this.sessions.get(serial);
    if (session?.kind !== 'grpc') return false;
    const dw = session.display?.width ?? 1080;
    const dh = session.display?.height ?? 1920;
    session.client.sendTouchAtPixel(x, y, dw, dh, { phase: 0 });
    session.client.sendTouchAtPixel(x, y, dw, dh, { phase: 2 });
    return true;
  }

  /**
   * Attempt to handle a key press via the gRPC daemon. Returns true if
   * routed through gRPC; false if the caller should fall back to ADB
   * `input keyevent`.
   *
   * Encodes as down + up events with modMask=0. keyCode is the numeric
   * Android AKEYCODE_* value (caller resolves names like 'BACK' to 4).
   */
  async routeKey(serial: string, keyCode: number): Promise<boolean> {
    const session = this.sessions.get(serial);
    if (session?.kind !== 'grpc') return false;
    session.client.sendKey('down', keyCode);
    session.client.sendKey('up', keyCode);
    return true;
  }

  /**
   * typeText is intentionally NOT routed — the proto subset shipped in Wave 1
   * has no sendText RPC. Callers must use ADB `input text`. This stub exists
   * so future protocol extensions can plug in here without changing call sites.
   */
  async routeTypeText(_serial: string, _text: string): Promise<boolean> {
    return false;
  }
}

/**
 * Shared singleton — symmetric with `scrcpyService` for callers that want
 * the same DI shape across Phase 32 (sim) and Phase 33 (android). Tests
 * construct fresh instances per-spec via `new AndroidStreamingService()`.
 */
export const androidStreamingService = new AndroidStreamingService();
