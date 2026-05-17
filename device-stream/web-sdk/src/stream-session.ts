/**
 * StreamSession — owns the WebSocket + paint loop for one running
 * stream. Decode strategy is delegated to FrameDecoder; canvas
 * painting is a single-frame queue drained on requestAnimationFrame
 * (latest wins; older frames are released).
 *
 * Ported from baguette (Apache 2.0):
 *   /tmp/baguette/Sources/Baguette/Resources/Web/stream-session.js
 *
 * Substitution from baguette: baguette's buildWSUrl(udid, format, version)
 * used a hardcoded path. Replaced with a `url: string` parameter the
 * caller provides.
 *
 *   const session = new StreamSession({
 *     url,
 *     format,
 *     canvas,
 *     onSize: (w, h) => …,    // first frame + on resize
 *     onFps:  (fps) => …,     // every second
 *     onLog:  (msg, isErr) => …,
 *     onText: (envelope) => boolean | void,
 *   });
 *   session.start();
 *   // …
 *   session.stop();
 *
 * Doesn't know what a sidebar button is, doesn't touch the gallery,
 * doesn't manage input. Owns precisely the WS + paint pipeline.
 */
import { FrameDecoder } from './frame-decoder.js';
import type { Decoder } from './frame-decoder.js';

export interface StreamSessionOptions {
  url: string;
  format: 'mjpeg' | 'avcc';
  canvas: HTMLCanvasElement;
  onSize?: (w: number, h: number) => void;
  onFps?: (fps: number) => void;
  onLog?: (msg: string, isError?: boolean) => void;
  onText?: (envelope: any) => boolean | void;
}

export class StreamSession {
  private readonly opts: StreamSessionOptions;
  private ws: WebSocket | null = null;
  private decoder: Decoder | null = null;
  private alive = false;
  private pending: (ImageBitmap | VideoFrame) | null = null;
  private frameCount = 0;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;

  /** Upstream transport: input + control rides on the same socket.
   *  Callers grab `session.send` and pass it to Transport as its
   *  `send` hook. Drops messages when the socket isn't ready —
   *  gestures fired before the open handshake are rare and not
   *  worth queuing. */
  send: (payload: any) => void = () => {};

  constructor(opts: StreamSessionOptions) {
    this.opts = opts;
  }

  start(): void {
    const { url, format, canvas, onSize, onFps, onLog, onText } = this.opts;
    const ctx = canvas.getContext('2d')!;
    const log = onLog ?? (() => {});

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.ws = socket;
    this.alive = true;

    // Upstream transport: input + control rides on the same socket.
    this.send = (payload: any) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    this.decoder = FrameDecoder.create(format, {
      onFrame: (frame) => {
        if (this.pending && typeof (this.pending as any).close === 'function') {
          try { (this.pending as any).close(); } catch {}
        }
        this.pending = frame;
      },
      onLog: log,
    });

    socket.onopen    = () => log('WS connected');
    // Text frames piggyback alongside binary video on the same WS
    // (describe_ui_result, server-pushed errors, …). Give callers
    // first crack at parsed JSON; if their hook returns truthy the
    // decoder doesn't get the frame. Binary always falls through.
    socket.onmessage = (e) => {
      if (onText && !(e.data instanceof ArrayBuffer)) {
        let env: any = null;
        try { env = JSON.parse(e.data); } catch { /* not JSON; let decoder log */ }
        if (env && onText(env) === true) return;
      }
      this.decoder!.feed(e);
    };
    socket.onclose   = () => { log('WS disconnected'); this.alive = false; this.ws = null; };
    socket.onerror   = () => log('WS error', true);

    const paint = () => {
      if (!this.alive) return;
      if (this.pending) {
        const f = this.pending;
        this.pending = null;
        const w = (f as any).displayWidth  ?? (f as any).width;
        const h = (f as any).displayHeight ?? (f as any).height;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          if (onSize) onSize(w, h);
        }
        ctx.drawImage(f as CanvasImageSource, 0, 0);
        if (typeof (f as any).close === 'function') { try { (f as any).close(); } catch {} }
        this.frameCount++;
      }
      this.rafId = requestAnimationFrame(paint);
    };
    this.rafId = requestAnimationFrame(paint);

    this.fpsTimer = setInterval(() => {
      if (onFps) onFps(this.frameCount);
      this.frameCount = 0;
    }, 1000);
  }

  stop(): void {
    this.alive = false;
    if (this.fpsTimer) { clearInterval(this.fpsTimer); this.fpsTimer = null; }
    if (this.rafId)    { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.ws)       { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.decoder)  { this.decoder.dispose(); this.decoder = null; }
    if (this.pending && typeof (this.pending as any).close === 'function') {
      try { (this.pending as any).close(); } catch {}
    }
    this.pending = null;
  }
}
