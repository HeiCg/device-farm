/**
 * Phase 35 Plan 35-05 — Regex flow-type inference.
 *
 * Port of `_reference/app-explorer/frontend/src/components/JourneyPanel.tsx`
 * lines 15-58 (`getFlowTag`). The 17 rules are preserved verbatim with
 * their Tailwind color tokens so the rendered chips match the React
 * reference 1:1.
 *
 * Rules are priority-ordered: most specific (`danger`) first, generic
 * fallback (`navigate`) last. End-of-path text is checked first (the
 * strongest signal — terminal screen reflects intent); then full-path
 * text; falls through to `navigate` on no match.
 */
import type { ScreenMap } from './atlas-types.js';

export interface FlowTag {
  label: string;
  /** Tailwind class string for the chip background + text color. */
  color: string;
}

type Rule = [label: string, color: string, pattern: RegExp];

const RULES: Rule[] = [
  ['danger', 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-300',
    /active[- ]?ride|dispatched|confirming|cancellation[- ]?failed|cancel[- ]?confirm/],
  ['book', 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    /book|reserve|request|pickup[- ]?spot|ride[- ]?options|review and continue/],
  ['checkout', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    /checkout|cart|upsell|place[- ]?order|order[- ]?placed|confirmation|review order/],
  ['payment', 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    /wallet|payment|card|uber[- ]?cash|currency|gift[- ]?card|add[- ]?funds/],
  ['safety', 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    /safety|ridecheck|trusted[- ]?contact|verify[- ]?ride|pin|teen[- ]?safety|driver[- ]?safety/],
  ['auth', 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    /auth[- ]?sheet|log[- ]?in|sign[- ]?in|sign[- ]?up|verify|2fa|passkey|recovery|password/],
  ['cancel', 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300', /cancel/],
  ['support', 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
    /help|support|chat|inbox|messages|feedback/],
  ['receipt', 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
    /receipt|trip[- ]?detail/],
  ['upsell', 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
    /uber[- ]?one|membership|trial|promo|commute[- ]?hub/],
  ['referral', 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
    /invite|refer|gift[- ]?a[- ]?ride/],
  ['search', 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
    /search|results|filters?|plan[- ]?ride|airline[- ]?picker/],
  ['discovery', 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
    /restaurant[- ]?detail|store|product[- ]?detail|item[- ]?detail|listing/],
  ['settings', 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    /setting|preferences?|communication|notification|privacy[- ]?data|privacy[- ]?center|shortcuts|saved[- ]?places|personal[- ]?info|security/],
  ['profile', 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
    /profile|account|business[- ]?hub|family|saved[- ]?groups/],
  ['legal', 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    /legal|terms|privacy[- ]?policy|license|open[- ]?source/],
  ['history', 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
    /activity|history|past[- ]?trip|order[- ]?detail/],
];

const NAVIGATE_FALLBACK: FlowTag = {
  label: 'navigate',
  color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

/**
 * Infer a flow tag for a DFS path. Looks at the terminal screen first
 * (strongest signal), then the full path text. Returns the
 * `navigate` fallback when no rule matches.
 */
export function getFlowTag(path: string[], map: ScreenMap): FlowTag {
  if (path.length === 0) return NAVIGATE_FALLBACK;

  const titleById = new Map<string, string>();
  for (const s of map.screens) titleById.set(s.screen_id, s.title);

  const endTitle = (titleById.get(path[path.length - 1]) ?? '').toLowerCase();
  const endId = path[path.length - 1].toLowerCase();
  const anyTitle = path.map((id) => (titleById.get(id) ?? '').toLowerCase()).join(' | ');
  const anyId = path.map((id) => id.toLowerCase()).join(' | ');
  const endText = `${endTitle} ${endId}`;
  const anyText = `${anyTitle} ${anyId}`;

  for (const [label, color, pattern] of RULES) {
    if (pattern.test(endText)) return { label, color };
  }
  for (const [label, color, pattern] of RULES) {
    if (pattern.test(anyText)) return { label, color };
  }
  return NAVIGATE_FALLBACK;
}
