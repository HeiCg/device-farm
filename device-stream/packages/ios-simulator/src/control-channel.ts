import type { ControlMessage } from '@device-stream/core';

export interface ControlHandlers {
  onFps:       (fps: number) => void;
  onBitrate:   (bps: number) => void;
  onScale:     (scale: number) => void;
  onForceIdr:  () => void;
  onSnapshot:  () => void;
}

const FPS_MIN = 1;
const FPS_MAX = 120;
const BITRATE_MIN_BPS = 100_000;
const BITRATE_MAX_BPS = 50_000_000;
const SCALE_MIN = 0.1;
const SCALE_MAX = 4.0;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class ControlChannel {
  constructor(private readonly handlers: ControlHandlers) {}

  handle(msg: ControlMessage): void {
    switch (msg.type) {
      case 'set_fps':
        this.handlers.onFps(clamp(msg.fps, FPS_MIN, FPS_MAX));
        return;
      case 'set_bitrate':
        this.handlers.onBitrate(clamp(msg.bps, BITRATE_MIN_BPS, BITRATE_MAX_BPS));
        return;
      case 'set_scale':
        this.handlers.onScale(clamp(msg.scale, SCALE_MIN, SCALE_MAX));
        return;
      case 'force_idr':
        this.handlers.onForceIdr();
        return;
      case 'snapshot':
        this.handlers.onSnapshot();
        return;
    }
  }
}
