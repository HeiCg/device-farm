/**
 * Transport — the ONE module that knows the wire format. Every other
 * part of the SDK calls Transport methods in domain terms ("send a
 * tap"); only this file knows that translates to a JSON envelope
 * with a `type` field. The SDK boundary makes the wire dialect a
 * hidden implementation detail of the SDK — bumping the protocol is
 * a one-file change.
 *
 * Ported from baguette (Apache 2.0):
 *   /tmp/baguette/Sources/Baguette/Resources/Web/baguette/transport.js
 *
 * Constructed with a `send(payload)` callback the consumer page supplies
 * (today: the WebSocket that carries frames). Keeping socket lifecycle
 * outside the SDK means the SDK can plug into any transport — page-owned
 * WS, asc-cli plugin's adapter, future stdin pipe — without changes.
 */
import type {
  GestureMessage,
  ControlMessage,
  ButtonMessage,
} from '@device-stream/core';

export type SendFn = (payload: GestureMessage | ControlMessage) => void;
export type LogFn  = (msg: string, isError?: boolean) => void;
export type Finger = { x: number; y: number };
export type TouchEdge = 'top' | 'bottom' | 'left' | 'right';

export class Transport {
  private readonly send: SendFn;
  private readonly log: LogFn;
  private width = 0;
  private height = 0;

  constructor({ send, log }: { send: SendFn; log?: LogFn }) {
    this.send = send;
    this.log = log ?? (() => {});
  }

  /** Update the screen size carried on every gesture envelope. */
  setScreenSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  // --- Domain verbs the SDK parts call ---
  tap({ x, y, duration = 0.05 }: { x: number; y: number; duration?: number }): void {
    this._dispatch({ type: 'tap', x, y, duration, ...this._size() });
  }

  swipe({ from, to, duration = 0.25 }: {
    from: Finger; to: Finger; duration?: number;
  }): void {
    this._dispatch({
      type: 'swipe',
      startX: from.x, startY: from.y,
      endX:   to.x,   endY:   to.y,
      duration, ...this._size(),
    });
  }

  touchDown(fingers: Finger[], opts?: { edge?: TouchEdge }): void {
    this._touch('down', fingers, opts);
  }
  touchMove(fingers: Finger[], opts?: { edge?: TouchEdge }): void {
    this._touch('move', fingers, opts);
  }
  touchUp(fingers: Finger[], opts?: { edge?: TouchEdge }): void {
    this._touch('up', fingers, opts);
  }

  /** Hardware-button press — caller supplies the full envelope. */
  button(envelope: ButtonMessage, { hold = 0 }: { hold?: number } = {}): void {
    const out: ButtonMessage = { ...envelope };
    if (hold > 0) out.duration = hold;
    this._dispatch(out);
  }

  // --- Control envelopes ---
  setBitrate(bps: number):  void { this._dispatch({ type: 'set_bitrate', bps }); }
  setFps(fps: number):      void { this._dispatch({ type: 'set_fps', fps }); }
  setScale(scale: number):  void { this._dispatch({ type: 'set_scale', scale }); }
  forceIdr():               void { this._dispatch({ type: 'force_idr' }); }
  snapshot():               void { this._dispatch({ type: 'snapshot' }); }

  // --- internals ---
  private _touch(
    phase: 'down' | 'move' | 'up',
    fingers: Finger[],
    opts?: { edge?: TouchEdge },
  ): void {
    const base = this._size();
    if (fingers.length === 1) {
      const env: any = {
        type: `touch1-${phase}`,
        x: fingers[0].x, y: fingers[0].y,
        ...base,
      };
      if (opts?.edge) env.edge = opts.edge;
      this._dispatch(env);
    } else if (fingers.length === 2) {
      this._dispatch({
        type: `touch2-${phase}`,
        x1: fingers[0].x, y1: fingers[0].y,
        x2: fingers[1].x, y2: fingers[1].y,
        ...base,
      } as any);
    }
  }

  private _size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private _dispatch(envelope: GestureMessage | ControlMessage): void {
    try {
      this.send(envelope);
    } catch (e) {
      this.log(`${(envelope as any).type}: ${(e as Error).message}`, true);
    }
  }
}
