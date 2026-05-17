/**
 * BrowserRecorder — compose canvas + MediaRecorder pipeline. Ported from
 * baguette (Apache 2.0):
 *   /tmp/baguette/Sources/Baguette/Resources/Web/recorder.js
 *
 * The compose canvas only exists while recording. Drawing pipeline:
 *   bezelImg → compose
 *   clip(roundRect screen.rect, clipRadius)
 *     sourceCanvas → compose at screen.rect
 *     overlay dots → compose
 *   compose.captureStream(60) → MediaRecorder → MP4/WebM blob
 */

// SPDX-License-Identifier: Apache-2.0
// Original: baguette/Sources/Baguette/Resources/Web/recorder.js (Apache 2.0)

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecorderOptions {
  /** The live canvas being painted by the stream session. */
  sourceCanvas: HTMLCanvasElement;
  /** Full composite output dimensions (bezel frame size). */
  viewport: { width: number; height: number };
  /** Screen placement within the bezel and its corner radius. */
  screen: { rect: ScreenRect; clipRadius: number };
  /** Optional bezel image drawn as background layer. */
  bezelImg?: HTMLImageElement;
  /** Optional PinchOverlay host element for dot annotation. */
  overlayHost?: HTMLElement;
  /** Override MIME type instead of probing MediaRecorder.isTypeSupported. */
  mimeType?: string;
  /** Capture frame rate (default 60). */
  fps?: number;
  /** Video bitrate in bps (default 12 Mbps). */
  bitrate?: number;
}

export interface RecordingResult {
  url: string;
  blob: Blob;
  filename: string;
  mimeType: string;
  durationSeconds: number;
  bytes: number;
}

// ---------------------------------------------------------------------------
// MIME type probe — MP4/H.264 plays everywhere; WebM as fallback.
// ---------------------------------------------------------------------------

const PREFERRED_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function extFor(mime: string): string {
  return mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the compose canvas size: viewport when provided (with or without
 *  a bezel image), source-canvas size as fallback, hard fallback 1170×2532. */
function composeSize(
  bezelImg: HTMLImageElement | undefined,
  viewport: { width: number; height: number } | undefined,
  sourceCanvas: HTMLCanvasElement,
): { w: number; h: number } {
  // Prefer explicit viewport dimensions when given — this covers both the
  // bezel-composite path and the bezel-less path.
  if (viewport) {
    return { w: viewport.width, h: viewport.height };
  }
  // Baguette fallback: use the bezel image's natural size if viewport is absent.
  if (bezelImg && bezelImg.naturalWidth > 0) {
    return { w: bezelImg.naturalWidth, h: bezelImg.naturalHeight };
  }
  if (sourceCanvas.width > 0) {
    return { w: sourceCanvas.width, h: sourceCanvas.height };
  }
  return { w: 1170, h: 2532 };
}

/** Draw a rounded-rectangle path. Uses quadraticCurveTo for broad browser
 *  compatibility (same as baguette source). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// BrowserRecorder
// ---------------------------------------------------------------------------

export class BrowserRecorder {
  /** True iff MediaRecorder is available in this runtime. */
  static isAvailable(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }

  private readonly sourceCanvas: HTMLCanvasElement;
  private readonly bezelImg?: HTMLImageElement;
  private readonly viewport: { width: number; height: number };
  private readonly screenDef: { rect: ScreenRect; clipRadius: number };
  private readonly overlayHost?: HTMLElement;
  private readonly fps: number;
  private readonly bitrate: number;
  private readonly mimeType: string;

  // State that only exists while recording
  private compose: HTMLCanvasElement | null = null;
  private composeCtx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private endedAt = 0;

  constructor(opts: RecorderOptions) {
    this.sourceCanvas = opts.sourceCanvas;
    this.bezelImg     = opts.bezelImg;
    this.viewport     = opts.viewport;
    this.screenDef    = opts.screen;
    this.overlayHost  = opts.overlayHost;
    this.fps          = opts.fps ?? 60;
    // 12 Mbps default — artifact-free H.264 for an iPhone-sized canvas
    // without exploding file size (browser default is ~2.5 Mbps).
    this.bitrate      = opts.bitrate ?? 12_000_000;
    this.mimeType     = opts.mimeType ?? pickMimeType();
  }

  /** Allocate the compose canvas and start the MediaRecorder.  Throws if
   *  MediaRecorder is unavailable or the recorder is already running. */
  start(): void {
    if (!this.sourceCanvas) throw new Error('sourceCanvas is required');
    if (!BrowserRecorder.isAvailable()) {
      throw new Error('MediaRecorder not available in this browser');
    }
    if (this.recorder) throw new Error('already recording');

    const size = composeSize(this.bezelImg, this.viewport, this.sourceCanvas);
    this.compose = document.createElement('canvas');
    this.compose.width  = size.w;
    this.compose.height = size.h;

    const ctx = this.compose.getContext('2d');
    // ctx may be null in environments that stub canvas (e.g. JSDOM in tests).
    // We store null and guard every paint call — recording still works
    // structurally; actual pixels just won't be painted.
    this.composeCtx = ctx;
    // High-quality resampling so the live stream looks sharp when the
    // bezel composite is at a higher resolution than the source canvas.
    if (this.composeCtx) {
      this.composeCtx.imageSmoothingEnabled = true;
      this.composeCtx.imageSmoothingQuality = 'high';
    }

    this._startPaintLoop();

    const stream = (this.compose as any).captureStream(this.fps) as MediaStream;
    const recorderOpts: MediaRecorderOptions = {};
    if (this.mimeType) recorderOpts.mimeType = this.mimeType;
    if (this.bitrate)  recorderOpts.videoBitsPerSecond = this.bitrate;

    this.recorder = new MediaRecorder(stream, recorderOpts);
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
    this.startedAt = Date.now();
  }

  /** Stop the recorder, await the final chunk, tear down the compose
   *  canvas and rAF loop, and return a RecordingResult with a Blob URL
   *  ready to drop into an `<a download>` link. */
  async stop(): Promise<RecordingResult> {
    if (!this.recorder) throw new Error('not started');

    const recorder = this.recorder;
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    try { recorder.requestData(); } catch { /* not all impls expose this */ }
    recorder.stop();
    await stopped;

    this.endedAt = Date.now();
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.recorder   = null;
    this.compose    = null;
    this.composeCtx = null;

    const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
    this.chunks = [];

    const stamp = new Date(this.startedAt)
      .toISOString().replace(/[:.]/g, '-').replace('Z', '');

    return {
      blob,
      url: URL.createObjectURL(blob),
      filename: `simulator-${stamp}.${extFor(this.mimeType)}`,
      mimeType: this.mimeType || 'video/webm',
      durationSeconds: (this.endedAt - this.startedAt) / 1000,
      bytes: blob.size,
    };
  }

  /** Discard an in-flight recording without producing an artifact.  Safe
   *  to call at any time (including after stop). */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.recorder   = null;
    this.compose    = null;
    this.composeCtx = null;
    this.chunks     = [];
  }

  // -------------------------------------------------------------------------
  // Private paint loop
  // -------------------------------------------------------------------------

  private _startPaintLoop(): void {
    const tick = () => {
      this._paint();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Per-frame paint: bezel → screen (clipped) → pinch dots.
   *  All data comes from DOM nodes already on the page; nothing is fetched. */
  private _paint(): void {
    if (!this.composeCtx || !this.compose) return;
    const ctx = this.composeCtx;
    const cw  = this.compose.width;
    const ch  = this.compose.height;
    ctx.clearRect(0, 0, cw, ch);

    const useBezel =
      this.bezelImg !== undefined &&
      this.bezelImg.naturalWidth > 0 &&
      this.screenDef !== undefined;

    if (useBezel && this.bezelImg) {
      const s = this.screenDef.rect;
      const r = this.screenDef.clipRadius ?? 0;

      // 1. Bezel as background — the "off" dark glass that sits under the
      //    live screen content.
      ctx.drawImage(this.bezelImg, 0, 0, cw, ch);

      // 2. Screen content, clipped to the inner corner radius.
      if (this.sourceCanvas.width > 0) {
        ctx.save();
        roundRectPath(ctx, s.x, s.y, s.width, s.height, r);
        ctx.clip();
        ctx.drawImage(this.sourceCanvas, s.x, s.y, s.width, s.height);
        // 3. Pinch HUD on top, still inside the clip.
        this._paintOverlayDots(ctx, s);
        ctx.restore();
      }
    } else if (this.sourceCanvas.width > 0) {
      // No bezel — bare-screen recording.
      ctx.drawImage(this.sourceCanvas, 0, 0, cw, ch);
      this._paintOverlayDots(ctx, { x: 0, y: 0, width: cw, height: ch });
    }
  }

  /** Read the current DOM positions of PinchOverlay's dots and paint
   *  matching circles onto the compose canvas.  No state cached — each
   *  tick re-reads what the live overlay is showing. */
  private _paintOverlayDots(ctx: CanvasRenderingContext2D, screenRect: ScreenRect): void {
    const host = this.overlayHost;
    if (!host || host.children.length === 0) return;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width === 0 || hostRect.height === 0) return;
    const sx = screenRect.width  / hostRect.width;
    const sy = screenRect.height / hostRect.height;

    // Mirror PinchOverlay dot styling (sim-input.js): 36 px diameter,
    // indigo fill + stroke.  Canvas shadows omitted — slow and unnecessary.
    const radiusComposite = 18 * Math.max(sx, sy);
    ctx.save();
    ctx.fillStyle   = 'rgba(99, 102, 241, 0.35)';
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
    ctx.lineWidth   = 2 * Math.max(sx, sy);
    for (const dot of Array.from(host.children)) {
      const el   = dot as HTMLElement;
      const left = parseFloat(el.style.left);
      const top  = parseFloat(el.style.top);
      if (!isFinite(left) || !isFinite(top)) continue;
      const cx = screenRect.x + left * sx;
      const cy = screenRect.y + top  * sy;
      ctx.beginPath();
      ctx.arc(cx, cy, radiusComposite, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
