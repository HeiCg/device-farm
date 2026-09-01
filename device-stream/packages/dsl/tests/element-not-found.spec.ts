import { describe, it, expect, vi } from 'vitest';
import { scoreElement, rankNearMisses } from '../src/selectors/matcher';
import { buildElementNotFoundDiagnostics } from '../src/selectors/describe';
import { ElementNotFoundError } from '../src/types';
import type { Selector, UIElement } from '../src/types';
import type { Driver } from '../src/drivers/types';
import { DeviceStreamSessionImpl } from '../src/session';

function el(partial: Partial<UIElement>): UIElement {
  return {
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    enabled: true,
    selected: false,
    ...partial,
  };
}

describe('scoreElement (near-miss scorer)', () => {
  it('scores +2 for an exact field match', () => {
    expect(scoreElement(el({ text: 'Sign in' }), { text: 'Sign in' })).toBe(2);
    expect(scoreElement(el({ id: 'btn', text: 'Sign in' }), { id: 'btn', text: 'Sign in' })).toBe(4);
  });

  it('scores +1 for a case-insensitive / substring "almost"', () => {
    // case differs -> not exact, but almost
    expect(scoreElement(el({ text: 'Sign in' }), { text: 'Sign In' })).toBe(1);
    // element text is a superstring of the target
    expect(scoreElement(el({ text: 'Please Sign In now' }), { text: 'Sign In' })).toBe(1);
    // target is a superstring of the element text
    expect(scoreElement(el({ text: 'Sign' }), { text: 'Sign In' })).toBe(1);
  });

  it('does not count fields absent from the selector', () => {
    // only `text` is in the selector; className present on element but not scored
    expect(scoreElement(el({ text: 'X', className: 'Button' }), { text: 'X' })).toBe(2);
  });

  it('scores unrelated elements as 0', () => {
    expect(scoreElement(el({ text: 'Register', id: 'aaa' }), { id: 'zzz', text: 'Sign In' })).toBe(0);
  });
});

describe('rankNearMisses', () => {
  it('orders by score desc and is stable on ties (pre-order tree order)', () => {
    const tree: UIElement[] = [
      el({ id: 'x', text: 'Sign In' }), // exact id? no. text 'Sign In' vs 'Sign in' almost -> 1
      el({ id: 'login', text: 'Sign in' }), // id exact +2, text exact +2 -> 4
      el({ text: 'Sign in' }), // text exact +2 -> 2 (first tie)
      el({ text: 'sign in' }), // text exact (case-sensitive) fails; almost -> 1 (tie with first)
      el({ id: 'other', text: 'Sign in' }), // text +2 -> 2 (second tie)
    ];
    const ranked = rankNearMisses(tree, { id: 'login', text: 'Sign in' });
    // top is the full match
    expect(ranked[0].id).toBe('login');
    // the two score-2 elements keep their relative pre-order (index 2 before index 4)
    const twos = ranked.filter((r) => r.text === 'Sign in' && r.id !== 'login');
    expect(twos.map((r) => r.id)).toEqual([undefined, 'other']);
  });

  it('caps at the top 10 and drops score-0 elements', () => {
    const tree: UIElement[] = [];
    for (let i = 0; i < 30; i++) tree.push(el({ text: `Sign in ${i}` })); // all "almost" -> score 1
    tree.push(el({ text: 'totally unrelated' })); // score 0, dropped
    const ranked = rankNearMisses(tree, { text: 'Sign in' });
    expect(ranked).toHaveLength(10);
    expect(ranked.every((r) => r.text!.startsWith('Sign in'))).toBe(true);
  });
});

describe('buildElementNotFoundDiagnostics', () => {
  it('produces candidate lines and no screen when there are near-misses', () => {
    const tree: UIElement[] = [
      el({ text: 'Sign in', className: 'Button', bounds: { x: 0, y: 0, width: 100, height: 40 } }),
      el({ text: 'Register' }),
    ];
    const diag = buildElementNotFoundDiagnostics(tree, { text: 'Sign In' });
    expect(diag.candidates.length).toBeGreaterThan(0);
    expect(diag.candidates[0]).toContain('"Sign in"');
    expect(diag.screen).toBeUndefined();
  });

  it('falls back to a screen dump when there are zero near-misses', () => {
    const tree: UIElement[] = [
      el({ text: 'Home', visible: true }),
      el({ text: 'Settings', visible: true }),
    ];
    const diag = buildElementNotFoundDiagnostics(tree, { id: { equals: '__no_such_id__' } });
    expect(diag.candidates).toHaveLength(0);
    expect(diag.screen).toBeDefined();
    expect(diag.screen).toContain('Home');
  });

  it('caps the screen dump at 2000 chars with a trailing marker', () => {
    const tree: UIElement[] = [];
    for (let i = 0; i < 400; i++) {
      tree.push(el({ text: `Row number ${i} with a fairly long label to inflate output`, visible: true }));
    }
    const diag = buildElementNotFoundDiagnostics(tree, { id: { equals: '__no_such_id__' } });
    expect(diag.screen).toBeDefined();
    expect(diag.screen!.length).toBeLessThanOrEqual(2000 + 40); // cap + marker line
    expect(diag.screen).toMatch(/…\(\d+ more lines\)$/);
  });

  it('counts elements matching every field except index', () => {
    const tree: UIElement[] = [
      el({ text: 'Item' }),
      el({ text: 'Item' }),
      el({ text: 'Item' }),
    ];
    const diag = buildElementNotFoundDiagnostics(tree, { text: 'Item', index: 9 });
    expect(diag.matchedCount).toBe(3);
  });
});

describe('ElementNotFoundError message', () => {
  it('renders candidates under "Near matches:"', () => {
    const diag = { candidates: ['Button "Sign in" @50,20', 'TextView "Register" @50,60'], matchedCount: 0 };
    const err = new ElementNotFoundError({ text: 'Sign In' }, 5000, diag);
    expect(err.message).toContain('not found within 5000ms.');
    expect(err.message).toContain('Near matches:');
    expect(err.message).toContain('  Button "Sign in" @50,20');
    expect(err.message).not.toContain('Screen:');
  });

  it('renders the screen dump when there are no candidates', () => {
    const diag = { candidates: [], screen: 'Button #home @10,10\nButton #settings @10,50', matchedCount: 0 };
    const err = new ElementNotFoundError({ id: 'missing' }, 3000, diag);
    expect(err.message).toContain('Screen:');
    expect(err.message).toContain('#home');
    expect(err.message).not.toContain('Near matches:');
  });

  it('appends the index-out-of-range note when matchedCount > 0 and selector has index', () => {
    const diag = { candidates: ['Cell "Item" @5,5'], matchedCount: 3 };
    const err = new ElementNotFoundError({ text: 'Item', index: 9 }, 5000, diag);
    expect(err.message).toContain('3 elements matched the selector but index 9 is out of range.');
  });

  it('omits the index note when the selector has no index', () => {
    const diag = { candidates: ['Cell "Item" @5,5'], matchedCount: 3 };
    const err = new ElementNotFoundError({ text: 'Item' }, 5000, diag);
    expect(err.message).not.toContain('out of range');
  });

  it('never exceeds 2500 chars given a 500-element synthetic tree', () => {
    const tree: UIElement[] = [];
    // long labels so 10 candidate lines blow past the cap and force truncation
    const label = 'x'.repeat(400);
    for (let i = 0; i < 500; i++) tree.push(el({ text: `Sign in ${label} ${i}` }));
    const diag = buildElementNotFoundDiagnostics(tree, { text: 'Sign in', index: 999 });
    const err = new ElementNotFoundError({ text: 'Sign in', index: 999 }, 5000, diag);
    expect(err.message.length).toBeLessThanOrEqual(2500);
  });
});

// A fake driver that counts hierarchy() calls and never finds the element, so the
// wait times out and diagnostics are built from the last polled tree.
function fakeDriver(tree: UIElement[]): Driver & { hierarchyCalls: number } {
  const d: Partial<Driver> & { hierarchyCalls: number } = {
    platform: 'android',
    serial: 'fake',
    hierarchyCalls: 0,
    hierarchy: vi.fn(async () => {
      d.hierarchyCalls++;
      return tree;
    }) as unknown as Driver['hierarchy'],
    tap: async () => {},
    waitForIdle: async () => {},
  };
  return d as Driver & { hierarchyCalls: number };
}

describe('session wiring — no extra device round-trip', () => {
  it('builds diagnostics from the last polled tree without an additional hierarchy() call', async () => {
    const tree: UIElement[] = [el({ text: 'Sign in', className: 'Button' })];
    const driver = fakeDriver(tree);
    const session = new DeviceStreamSessionImpl(driver, {
      serial: 'fake',
      platform: 'android',
      // one poll then the deadline passes before the next iteration
      defaultTimeoutMs: 5,
      pollIntervalMs: 1000,
    });

    let thrown: unknown;
    try {
      await session.get({ text: 'Sign In' }).waitFor();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ElementNotFoundError);
    const err = thrown as ElementNotFoundError;
    // exactly one poll; diagnostics reused that tree (no extra call)
    expect(driver.hierarchyCalls).toBe(1);
    expect(err.diagnostics?.candidates[0]).toContain('"Sign in"');
    expect(err.message).toContain('Near matches:');
  });
});
