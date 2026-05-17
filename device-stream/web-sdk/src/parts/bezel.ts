/**
 * Bezel — renders the DeviceKit chrome (outer body + clipped screen
 * rect) from a chrome.json fetched at construction time. Pure DOM
 * construction; no input handling, no wire format.
 *
 * Ported from baguette (Apache 2.0):
 *   /tmp/baguette/Sources/Baguette/Resources/Web/baguette/parts/bezel.js
 *
 * Adaptation: device-stream's Bezel owns the chrome.json fetch directly
 * (baguette delegates it to the Simulator aggregate). The geometry
 * derivation (viewport, screenRect, clipRadius) matches the formulas
 * in baguette's chrome-bezel rendering doc.
 */

export interface BezelGeometry {
  viewport:   { width: number; height: number };
  screenRect: { x: number; y: number; width: number; height: number };
  clipRadius: number;
}

export interface BezelOptions {
  /** URL to a chrome.json from /Library/Developer/DeviceKit/Chrome/<id>.devicechrome/. */
  chromeJsonUrl: string;
  /** URL to the rasterized bezel PNG (bare or composite). */
  bezelPngUrl:   string;
  /** Container the bezel DOM is mounted into. */
  container:     HTMLElement;
  /** When true, returns geometry but does NOT modify the container. */
  geometryOnly?: boolean;
}

interface ChromeJsonSubset {
  images: {
    sizing:        { width: number; height: number };
    devicePadding: { top: number; left: number; bottom: number; right: number };
  };
  screenInsets:      { top: number; left: number; bottom: number; right: number };
  outerCornerRadius: number;
}

function clearChildren(el: HTMLElement): void {
  while (el.lastChild) el.removeChild(el.lastChild);
}

export class Bezel {
  private readonly opts: BezelOptions;
  wrapper:    HTMLElement | null = null;
  frameImg:   HTMLImageElement | null = null;
  screenArea: HTMLElement | null = null;
  canvas:     HTMLCanvasElement | null = null;

  constructor(opts: BezelOptions) {
    this.opts = opts;
  }

  /** Fetch chrome.json, derive geometry, mount DOM (unless geometryOnly), return geometry. */
  async load(): Promise<BezelGeometry> {
    const res = await fetch(this.opts.chromeJsonUrl);
    if (!res.ok) throw new Error(`chrome.json fetch: ${res.status}`);
    const json = (await res.json()) as ChromeJsonSubset;
    const geometry = this._derive(json);

    if (!this.opts.geometryOnly) {
      this._mount(geometry);
    }
    return geometry;
  }

  private _derive(json: ChromeJsonSubset): BezelGeometry {
    const viewport = {
      width:  json.images.sizing.width,
      height: json.images.sizing.height,
    };
    const i = json.screenInsets;
    const screenRect = {
      x:      i.left,
      y:      i.top,
      width:  viewport.width  - i.left - i.right,
      height: viewport.height - i.top  - i.bottom,
    };
    return { viewport, screenRect, clipRadius: json.outerCornerRadius };
  }

  private _mount(g: BezelGeometry): void {
    const container = this.opts.container;
    clearChildren(container);

    const wrapper = document.createElement('div');
    // `dvh` (dynamic viewport height) subtracts iOS Safari's URL bar
    // and bottom toolbar from the cap, so the bezel does not render
    // behind them and get clipped. The earlier `vh` declaration
    // stays as a fallback for engines without `dvh` support.
    wrapper.style.cssText =
      'position:relative;display:inline-block;max-height:70vh;max-height:70dvh;';

    const frameImg = document.createElement('img');
    frameImg.src = this.opts.bezelPngUrl;
    frameImg.draggable = false;
    frameImg.alt = '';
    frameImg.style.cssText =
      'display:block;height:100%;max-height:70vh;max-height:70dvh;pointer-events:none;position:relative;z-index:1;';
    frameImg.onerror = () => { frameImg.style.display = 'none'; };

    const screenArea = document.createElement('div');
    screenArea.style.cssText =
      'position:absolute;overflow:hidden;cursor:crosshair;z-index:2;';
    screenArea.tabIndex = 0;
    screenArea.style.outline = 'none';

    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'display:block;width:100%;height:100%;object-fit:fill;image-rendering:high-quality;';
    screenArea.appendChild(canvas);

    wrapper.appendChild(screenArea);
    wrapper.appendChild(frameImg);

    // Position the screen rect inside the bezel as percentages so the
    // overlay tracks the bezel as the viewport scales.
    screenArea.style.left   = (g.screenRect.x      / g.viewport.width  * 100) + '%';
    screenArea.style.top    = (g.screenRect.y      / g.viewport.height * 100) + '%';
    screenArea.style.width  = (g.screenRect.width  / g.viewport.width  * 100) + '%';
    screenArea.style.height = (g.screenRect.height / g.viewport.height * 100) + '%';

    const cr = g.clipRadius || 0;
    const hPct = (cr / g.screenRect.width)  * 100;
    const vPct = (cr / g.screenRect.height) * 100;
    screenArea.style.borderRadius = `${hPct}% / ${vPct}%`;

    container.appendChild(wrapper);

    this.wrapper    = wrapper;
    this.frameImg   = frameImg;
    this.screenArea = screenArea;
    this.canvas     = canvas;
  }
}
