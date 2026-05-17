import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserRecorder } from '../src/recorder.js';

// JSDOM lacks both MediaRecorder and canvas.captureStream — stub them
// before constructing the recorder.
beforeEach(() => {
  (globalThis as any).MediaRecorder = class {
    state = 'inactive';
    ondataavailable: ((e: any) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  };
  (HTMLCanvasElement.prototype as any).captureStream = function () { return {} as any; };
  // JSDOM may not implement URL.createObjectURL — stub it if missing
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', configurable: true });
  }
});

describe('BrowserRecorder', () => {
  it('start() allocates a compose canvas at viewport size', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 438; sourceCanvas.height = 954;

    const r = new BrowserRecorder({
      sourceCanvas,
      viewport: { width: 480, height: 1000 },
      screen: { rect: { x: 21, y: 23, width: 438, height: 954 }, clipRadius: 60 },
    });
    r.start();
    const compose = (r as any).compose as HTMLCanvasElement;
    expect(compose).toBeDefined();
    expect(compose.width).toBe(480);
    expect(compose.height).toBe(1000);
    r.stop();
  });

  it('stop() returns a result with url, blob, filename, mimeType, durationSeconds', async () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 438; sourceCanvas.height = 954;
    const r = new BrowserRecorder({
      sourceCanvas,
      viewport: { width: 480, height: 1000 },
      screen: { rect: { x: 21, y: 23, width: 438, height: 954 }, clipRadius: 60 },
    });
    r.start();
    const result = await r.stop();
    expect(result.url).toMatch(/^blob:/);
    expect(result.filename).toMatch(/\.(mp4|webm)$/);
    expect(result.mimeType).toMatch(/video\//);
    expect(typeof result.durationSeconds).toBe('number');
  });
});
