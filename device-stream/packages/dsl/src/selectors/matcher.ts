import type { Selector, UIElement } from '../types';

export function elementMatches(el: UIElement, sel: Selector): boolean {
  if (sel.id !== undefined && el.id !== sel.id) return false;
  if (sel.text !== undefined && el.text !== sel.text) return false;
  if (sel.contentDescription !== undefined && el.contentDescription !== sel.contentDescription) return false;
  if (sel.className !== undefined && el.className !== sel.className) return false;
  if (sel.packageName !== undefined && el.packageName !== sel.packageName) return false;
  return true;
}

export function findElement(tree: UIElement[], sel: Selector): UIElement | undefined {
  const matches = tree.filter((el) => elementMatches(el, sel));
  if (matches.length === 0) return undefined;
  const idx = sel.index ?? 0;
  return matches[idx];
}

export function centerOf(el: UIElement): { x: number; y: number } {
  return {
    x: Math.round(el.bounds.x + el.bounds.width / 2),
    y: Math.round(el.bounds.y + el.bounds.height / 2),
  };
}
