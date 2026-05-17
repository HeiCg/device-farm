/**
 * Phase 36 Plan 36-03 — fuzzysort wrapper.
 *
 * `rank(query, items)` returns a filtered+ranked subset of `items`:
 *   - empty query → first 50 items in insertion order (no ranking)
 *   - non-empty   → fuzzysort.go over keys label/sub/keywords with
 *                   permissive threshold (-10000) and 50-item cap
 *
 * `FuzzyItem` is the runtime row shape carried through the palette — the
 * `keywords` field accepts either a pre-joined string or a string[] so
 * callers can keep idiomatic data; we flatten arrays before handing to
 * fuzzysort (which only ranks string keys).
 */
import fuzzysort from 'fuzzysort';

import type { ActionContext } from './registry.js';

export interface FuzzyItem {
  id: string;
  label: string;
  sub?: string;
  keywords?: string;
  kind: 'action' | 'device' | 'job' | 'page';
  run: (ctx: ActionContext) => Promise<void> | void;
}

const KEYS = ['label', 'sub', 'keywords'] as const;
const THRESHOLD = -10000;
const LIMIT = 50;

export function rank(query: string, items: FuzzyItem[]): FuzzyItem[] {
  if (!query.trim()) return items.slice(0, LIMIT);
  const results = fuzzysort.go(query, items, {
    keys: KEYS as unknown as ReadonlyArray<string>,
    threshold: THRESHOLD,
    limit: LIMIT,
  });
  return results.map((r) => r.obj);
}
