import type { ElementNotFoundDiagnostics, HierarchyTree, Selector, UIElement } from '../types';
import { centerOf, elementMatches, flattenTree, rankNearMisses } from './matcher';

/**
 * A compact, normalized node intended for an LLM agent or a debug dump. It keeps
 * only the fields that identify an element and drops noise (invisible nodes and
 * anonymous structural containers with nothing identifying inside).
 */
export interface DescribedNode {
  className?: string;
  id?: string;
  text?: string;
  contentDescription?: string;
  /** Tap target (center of bounds). */
  center: { x: number; y: number };
  enabled: boolean;
  children: DescribedNode[];
}

/** Whether a node carries something an agent could select it by. */
function isIdentifiable(el: UIElement): boolean {
  return Boolean(el.id || el.text || el.contentDescription);
}

/**
 * Convert a (possibly nested) UIElement forest into a pruned DescribedNode
 * forest: visible nodes only, dropping anonymous containers that have no kept
 * descendants. Identifiable nodes (with id/text/desc) are always kept.
 */
export function describeElements(roots: UIElement[]): DescribedNode[] {
  const out: DescribedNode[] = [];
  for (const el of roots) {
    // Known-invisible elements are skipped entirely (along with their subtree).
    if (el.visible === false) continue;
    const children = describeElements(el.children ?? []);
    if (!isIdentifiable(el) && children.length === 0) continue;
    out.push({
      className: el.className,
      id: el.id,
      text: el.text,
      contentDescription: el.contentDescription,
      center: centerOf(el),
      enabled: el.enabled,
      children,
    });
  }
  return out;
}

/** Render a DescribedNode forest as an indented outline. */
export function renderDescription(nodes: DescribedNode[], indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const n of nodes) {
    const parts: string[] = [];
    if (n.className) parts.push(n.className);
    if (n.id) parts.push(`#${n.id}`);
    if (n.text) parts.push(`"${n.text}"`);
    else if (n.contentDescription) parts.push(`[${n.contentDescription}]`);
    parts.push(`@${n.center.x},${n.center.y}`);
    if (!n.enabled) parts.push('(disabled)');
    lines.push(pad + parts.join(' '));
    if (n.children.length) lines.push(renderDescription(n.children, indent + 1));
  }
  return lines.join('\n');
}

/**
 * Render a single UIElement as one outline line, identical in format to a
 * {@link renderDescription} node (minus indentation and children). Used for
 * near-miss candidate lines in {@link buildElementNotFoundDiagnostics}.
 */
export function renderElementLine(el: UIElement): string {
  const parts: string[] = [];
  if (el.className) parts.push(el.className);
  if (el.id) parts.push(`#${el.id}`);
  if (el.text) parts.push(`"${el.text}"`);
  else if (el.contentDescription) parts.push(`[${el.contentDescription}]`);
  const c = centerOf(el);
  parts.push(`@${c.x},${c.y}`);
  if (!el.enabled) parts.push('(disabled)');
  return parts.join(' ');
}

/** Max near-miss candidate lines carried in the diagnostics. */
const CANDIDATE_LIMIT = 10;
/** Cap (chars) on the screen dump attached when there are no near-misses. */
const SCREEN_CAP = 2000;

/** Render a pruned screen outline, capped with a trailing `…(<n> more lines)` marker. */
function renderScreenDump(tree: UIElement[], cap: number): string {
  const full = renderDescription(describeElements(tree));
  if (full.length <= cap) return full;

  const lines = full.split('\n');
  const kept: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = (kept.length ? 1 : 0) + line.length;
    if (len + add > cap) break;
    kept.push(line);
    len += add;
  }
  const remaining = lines.length - kept.length;
  return `${kept.join('\n')}\n…(${remaining} more lines)`;
}

/**
 * Build {@link ElementNotFoundDiagnostics} from a tree the caller already polled —
 * no extra device round-trip. Top near-misses become candidate lines; when there
 * are none, a capped screen dump is attached instead. `matchedCount` counts
 * elements that satisfy every selector field except `index`.
 */
export function buildElementNotFoundDiagnostics(
  tree: UIElement[],
  sel: Selector,
): ElementNotFoundDiagnostics {
  const candidates = rankNearMisses(tree, sel, CANDIDATE_LIMIT).map(renderElementLine);

  const withoutIndex: Selector = { ...sel, index: undefined };
  const matchedCount = flattenTree(tree).filter((el) => elementMatches(el, withoutIndex)).length;

  const diag: ElementNotFoundDiagnostics = { candidates, matchedCount };
  if (candidates.length === 0) diag.screen = renderScreenDump(tree, SCREEN_CAP);

  const t = tree as HierarchyTree;
  if (t.truncated) {
    diag.truncated = true;
    if (t.maxElements !== undefined) diag.maxElements = t.maxElements;
  }
  return diag;
}
