import { describe, it, expect } from 'vitest';
import {
  toUIElement,
  isBoundsVisible,
  displayBoundsFor,
  reconstructHierarchy,
} from '../src/drivers/android';
import { describeElements, renderDescription } from '../src/selectors/describe';
import { flattenTree } from '../src/selectors/matcher';
import type { UIElement } from '../src/types';

type Rect = UIElement['bounds'];
const DISPLAY: Rect = { x: 0, y: 0, width: 100, height: 100 };

/** Minimal raw android-server node builder. */
function rawNode(over: Partial<AndroidRaw> = {}): AndroidRaw {
  return {
    index: 0,
    className: 'View',
    bounds: { x1: 0, y1: 0, x2: 10, y2: 10 },
    enabled: true,
    ...over,
  };
}

interface AndroidRaw {
  index: number;
  className?: string;
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  enabled?: boolean;
}

describe('isBoundsVisible', () => {
  it('is false for zero area', () => {
    expect(isBoundsVisible({ x: 10, y: 10, width: 0, height: 40 }, DISPLAY)).toBe(false);
    expect(isBoundsVisible({ x: 10, y: 10, width: 40, height: 0 }, DISPLAY)).toBe(false);
  });

  it('is false when fully offscreen', () => {
    expect(isBoundsVisible({ x: 200, y: 200, width: 50, height: 50 }, DISPLAY)).toBe(false);
    expect(isBoundsVisible({ x: -80, y: 10, width: 50, height: 50 }, DISPLAY)).toBe(false);
  });

  it('is true when partially intersecting the display', () => {
    expect(isBoundsVisible({ x: -10, y: 10, width: 30, height: 30 }, DISPLAY)).toBe(true);
    expect(isBoundsVisible({ x: 90, y: 90, width: 40, height: 40 }, DISPLAY)).toBe(true);
  });

  it('is true when fully inside the display', () => {
    expect(isBoundsVisible({ x: 10, y: 10, width: 20, height: 20 }, DISPLAY)).toBe(true);
  });
});

describe('displayBoundsFor', () => {
  it('picks the largest-area node as the display rectangle', () => {
    const nodes: AndroidRaw[] = [
      rawNode({ bounds: { x1: 0, y1: 0, x2: 10, y2: 10 } }),
      rawNode({ bounds: { x1: 0, y1: 0, x2: 200, y2: 400 } }),
      rawNode({ bounds: { x1: 50, y1: 50, x2: 60, y2: 60 } }),
    ];
    expect(displayBoundsFor(nodes)).toEqual({ x: 0, y: 0, width: 200, height: 400 });
  });
});

describe('toUIElement', () => {
  it('populates visible from bounds vs display', () => {
    const onscreen = toUIElement(
      rawNode({ resourceId: 'a', bounds: { x1: 0, y1: 0, x2: 50, y2: 50 } }),
      DISPLAY,
    );
    const offscreen = toUIElement(
      rawNode({ resourceId: 'b', bounds: { x1: 500, y1: 500, x2: 600, y2: 600 } }),
      DISPLAY,
    );
    expect(onscreen.visible).toBe(true);
    expect(offscreen.visible).toBe(false);
    expect(onscreen.id).toBe('a');
    expect(onscreen.bounds).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });
});

describe('reconstructHierarchy', () => {
  const el = (over: Partial<UIElement> & { bounds: Rect }): UIElement => ({
    enabled: true,
    selected: false,
    ...over,
  });

  it('nests a contained element under its smallest container', () => {
    const parent = el({ id: 'p', bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const child = el({ id: 'c', bounds: { x: 10, y: 10, width: 20, height: 20 } });
    const roots = reconstructHierarchy([parent, child]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('p');
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children![0].id).toBe('c');
  });

  it('keeps disjoint elements as separate roots', () => {
    const a = el({ id: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 } });
    const b = el({ id: 'b', bounds: { x: 50, y: 50, width: 20, height: 20 } });
    const roots = reconstructHierarchy([a, b]);
    expect(roots.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(roots.every((r) => r.children!.length === 0)).toBe(true);
  });

  it('picks the smallest container when nested three deep', () => {
    const outer = el({ id: 'outer', bounds: { x: 0, y: 0, width: 100, height: 100 } });
    const mid = el({ id: 'mid', bounds: { x: 5, y: 5, width: 60, height: 60 } });
    const inner = el({ id: 'inner', bounds: { x: 10, y: 10, width: 10, height: 10 } });
    const roots = reconstructHierarchy([outer, mid, inner]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('outer');
    expect(roots[0].children![0].id).toBe('mid');
    expect(roots[0].children![0].children![0].id).toBe('inner');
  });

  it('breaks equal-bounds ties by document order (earlier is parent)', () => {
    const first = el({ id: 'first', bounds: { x: 0, y: 0, width: 50, height: 50 } });
    const second = el({ id: 'second', bounds: { x: 0, y: 0, width: 50, height: 50 } });
    const roots = reconstructHierarchy([first, second]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('first');
    expect(roots[0].children![0].id).toBe('second');
  });
});

/**
 * Synthetic flat Android screen (~120 nodes): a full-screen anonymous root,
 * 40 visible identifiable buttons grouped under 5 anonymous on-screen wrappers,
 * plus a large offscreen region (45 identifiable nodes + 29 anonymous wrappers)
 * that a real device reports below the fold. `visible` is unknown today, so the
 * offscreen region is rendered verbatim; WS2 derives visibility and prunes it.
 */
function androidFixture(): AndroidRaw[] {
  const nodes: AndroidRaw[] = [];
  // Full-screen anonymous root.
  nodes.push(rawNode({ className: 'FrameLayout', bounds: { x1: 0, y1: 0, x2: 1080, y2: 2400 } }));

  // 5 on-screen anonymous wrapper bands, 8 identifiable buttons each.
  for (let w = 0; w < 5; w++) {
    const bandY = w * 400 + 20;
    nodes.push(
      rawNode({ className: 'LinearLayout', bounds: { x1: 0, y1: bandY, x2: 1080, y2: bandY + 360 } }),
    );
    for (let b = 0; b < 8; b++) {
      const x1 = b * 130 + 10;
      nodes.push(
        rawNode({
          className: 'Button',
          resourceId: `btn_${w}_${b}`,
          text: `Item ${w}-${b}`,
          bounds: { x1, y1: bandY + 20, x2: x1 + 110, y2: bandY + 320 },
        }),
      );
    }
  }

  // Offscreen region (below the 2400px display): 45 identifiable + 29 anonymous.
  for (let k = 0; k < 45; k++) {
    const y1 = 2500 + k * 100;
    nodes.push(
      rawNode({
        className: 'TextView',
        resourceId: `off_${k}`,
        text: `Off ${k}`,
        bounds: { x1: 20, y1, x2: 300, y2: y1 + 80 },
      }),
    );
  }
  for (let m = 0; m < 29; m++) {
    const y1 = 2500 + m * 200;
    nodes.push(
      rawNode({ className: 'FrameLayout', bounds: { x1: 0, y1, x2: 1080, y2: y1 + 150 } }),
    );
  }
  return nodes;
}

describe('Android describe pruning (WS2)', () => {
  it('drops >= 40% of describe lines vs the pre-WS2 flat/visibility-less output', () => {
    const raw = androidFixture();

    // "Today": flat map, no visibility derived, no hierarchy reconstruction.
    const todayFlat: UIElement[] = raw.map((n) => ({
      id: n.resourceId,
      text: n.text,
      contentDescription: n.contentDesc,
      className: n.className,
      bounds: { x: n.bounds.x1, y: n.bounds.y1, width: n.bounds.x2 - n.bounds.x1, height: n.bounds.y2 - n.bounds.y1 },
      enabled: n.enabled ?? true,
      selected: false,
    }));
    const linesToday = renderDescription(describeElements(todayFlat)).split('\n').length;

    // WS2: visibility + reconstruction.
    const display = displayBoundsFor(raw);
    const after = reconstructHierarchy(raw.map((n) => toUIElement(n, display)));
    const linesAfter = renderDescription(describeElements(after)).split('\n').length;

    const reduction = (linesToday - linesAfter) / linesToday;
    expect(reduction).toBeGreaterThanOrEqual(0.4);
  });

  it('populates visible for every Android element', () => {
    const raw = androidFixture();
    const display = displayBoundsFor(raw);
    const forest = reconstructHierarchy(raw.map((n) => toUIElement(n, display)));
    for (const el of flattenTree(forest)) {
      expect(typeof el.visible).toBe('boolean');
    }
    expect(flattenTree(forest)).toHaveLength(raw.length);
  });
});
