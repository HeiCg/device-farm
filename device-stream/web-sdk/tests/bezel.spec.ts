import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bezel } from '../src/parts/bezel.js';

// Sample chrome.json reduced to what Bezel reads.
const CHROME = {
  images: {
    sizing: { width: 1206, height: 2622 },
    devicePadding: { top: 0, left: 0, bottom: 0, right: 0 },
  },
  screenInsets: { top: 50, left: 30, bottom: 50, right: 30 },
  outerCornerRadius: 220,
};

beforeEach(() => {
  // Stub fetch to return our CHROME json when chrome.json is requested.
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (url.endsWith('chrome.json')) {
      return { ok: true, json: async () => CHROME, text: async () => JSON.stringify(CHROME) };
    }
    return { ok: false, status: 404 } as any;
  });
});

describe('Bezel.load', () => {
  it('returns derived geometry (viewport, screenRect, clipRadius)', async () => {
    const container = document.createElement('div');
    const bezel = new Bezel({
      chromeJsonUrl: 'https://x/chrome.json',
      bezelPngUrl: 'https://x/bezel.png',
      container,
      geometryOnly: true,
    });
    const g = await bezel.load();
    expect(g.viewport).toEqual({ width: 1206, height: 2622 });
    expect(g.screenRect).toEqual({ x: 30, y: 50, width: 1206 - 30 - 30, height: 2622 - 50 - 50 });
    expect(g.clipRadius).toBe(220);
  });

  it('mounts DOM when geometryOnly is false', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bezel = new Bezel({
      chromeJsonUrl: 'https://x/chrome.json',
      bezelPngUrl: 'https://x/bezel.png',
      container,
    });
    await bezel.load();
    // Container should have one wrapper child with one img + one screenArea div with a canvas.
    expect(container.children.length).toBe(1);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.querySelector('img')).not.toBeNull();
    expect(wrapper.querySelector('canvas')).not.toBeNull();
  });
});
