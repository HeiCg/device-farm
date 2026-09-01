import type { Selector, StringMatch, UIElement } from '../types';

/**
 * Test a string value against a {@link StringMatch}. A bare string is exact,
 * case-sensitive equality. The object form requires every provided constraint
 * (equals / contains / regex) to hold; `caseInsensitive` applies to all three.
 */
export function matchString(value: string | undefined, m: StringMatch | undefined): boolean {
  if (m === undefined) return true;
  if (value === undefined) return false;

  if (typeof m === 'string') return value === m;

  const ci = m.caseInsensitive === true;
  const hay = ci ? value.toLowerCase() : value;

  if (m.equals !== undefined) {
    const needle = ci ? m.equals.toLowerCase() : m.equals;
    if (hay !== needle) return false;
  }
  if (m.contains !== undefined) {
    const needle = ci ? m.contains.toLowerCase() : m.contains;
    if (!hay.includes(needle)) return false;
  }
  if (m.regex !== undefined) {
    const re = new RegExp(m.regex, ci ? 'i' : undefined);
    if (!re.test(value)) return false;
  }
  return true;
}

export function elementMatches(el: UIElement, sel: Selector): boolean {
  if (!matchString(el.id, sel.id)) return false;
  if (!matchString(el.text, sel.text)) return false;
  if (!matchString(el.contentDescription, sel.contentDescription)) return false;
  if (!matchString(el.className, sel.className)) return false;
  if (!matchString(el.packageName, sel.packageName)) return false;

  if (sel.enabled !== undefined && el.enabled !== sel.enabled) return false;
  // Only exclude on *known* invisibility; unknown (undefined) is permitted.
  if (sel.visible === true && el.visible === false) return false;

  if (sel.containsDescendant !== undefined) {
    const hasDescendant = flattenTree(el.children ?? []).some((d) =>
      elementMatches(d, sel.containsDescendant as Selector),
    );
    if (!hasDescendant) return false;
  }
  return true;
}

/** Pre-order flatten of a (possibly nested) element forest. */
export function flattenTree(roots: UIElement[]): UIElement[] {
  const out: UIElement[] = [];
  const visit = (node: UIElement): void => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

export function findElement(tree: UIElement[], sel: Selector): UIElement | undefined {
  const matches = flattenTree(tree).filter((el) => elementMatches(el, sel));
  if (matches.length === 0) return undefined;
  return matches[sel.index ?? 0];
}

export function centerOf(el: UIElement): { x: number; y: number } {
  return {
    x: Math.round(el.bounds.x + el.bounds.width / 2),
    y: Math.round(el.bounds.y + el.bounds.height / 2),
  };
}

/** The literal text a StringMatch is looking for, for "almost" comparison (regex-only has none). */
function stringMatchTarget(m: StringMatch): string | undefined {
  if (typeof m === 'string') return m;
  return m.equals ?? m.contains;
}

/**
 * Score one selector field against an element value:
 *   +2 exact match, +1 "almost" (case-insensitive / substring either way), 0 otherwise.
 * A field absent from the selector (`m === undefined`) contributes nothing.
 */
function stringFieldScore(value: string | undefined, m: StringMatch | undefined): number {
  if (m === undefined) return 0;
  if (matchString(value, m)) return 2;
  if (value === undefined) return 0;
  const target = stringMatchTarget(m);
  if (target === undefined) return 0;
  const v = value.toLowerCase();
  const t = target.toLowerCase();
  if (v === t || v.includes(t) || t.includes(v)) return 1;
  return 0;
}

/**
 * Near-miss score of an element against a selector. Pure; higher means closer.
 * Each present selector field that fully matches adds 2, an "almost" string match
 * adds 1. Fields not named by the selector do not count. `index` /
 * `containsDescendant` are ignored — they're not element-identity signals.
 */
export function scoreElement(el: UIElement, sel: Selector): number {
  let score = 0;
  score += stringFieldScore(el.id, sel.id);
  score += stringFieldScore(el.text, sel.text);
  score += stringFieldScore(el.contentDescription, sel.contentDescription);
  score += stringFieldScore(el.className, sel.className);
  score += stringFieldScore(el.packageName, sel.packageName);
  if (sel.enabled !== undefined && el.enabled === sel.enabled) score += 2;
  if (sel.visible !== undefined && !(sel.visible === true && el.visible === false)) score += 2;
  return score;
}

/**
 * Rank the tree's elements by {@link scoreElement} against `sel` and return the top
 * `limit` with score > 0. Pure; stable on ties (keeps pre-order tree order).
 */
export function rankNearMisses(tree: UIElement[], sel: Selector, limit = 10): UIElement[] {
  return flattenTree(tree)
    .map((el, i) => ({ el, i, score: scoreElement(el, sel) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.el);
}
