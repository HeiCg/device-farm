/**
 * Phase 36 Plan 36-03 — CommandPalette pure-logic helpers.
 *
 * Extracted from `CommandPalette.svelte` so the aggregation + keyboard
 * navigation + run-and-record behavior can be unit-tested without a
 * vite-plugin-svelte mount (web/ has no svelte-test integration —
 * see sessions-detail.spec for the established pattern).
 *
 * The Svelte component imports + delegates to these helpers; it owns only
 * reactive state (`$state`/`$derived.by`) and DOM bindings.
 */
import type { FuzzyItem } from './fuzzy.js';
import { getActions, type Device } from './registry.js';
import { pushRecent } from './recent.svelte.js';

export interface RunContext {
  goto: (href: string) => void;
}

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  state: string;
}

const PAGES: ReadonlyArray<{ id: string; label: string; sub: string; href: string }> = [
  { id: 'page:devices', label: 'Devices', sub: 'Device pool overview', href: '/devices' },
  { id: 'page:jobs', label: 'Jobs', sub: 'Recent job runs', href: '/jobs' },
  {
    id: 'page:pipelines',
    label: 'Pipelines',
    sub: 'Scheduled pipeline runs',
    href: '/pipelines',
  },
  { id: 'page:sessions', label: 'Sessions', sub: 'Interactive MCP sessions', href: '/sessions' },
  { id: 'page:pair', label: 'Pair device', sub: 'Pair a new wireless Android', href: '/devices/pair' },
  { id: 'page:settings', label: 'Settings', sub: 'Configuration + secrets', href: '/settings' },
];

/**
 * Build the unified palette item list from the action registry + currently
 * known devices + canonical pages. Jobs are layered in by callers that hold
 * the job store; this base aggregator is store-agnostic for testability.
 */
export function aggregateItems(devices: ReadonlyArray<DeviceRow>): FuzzyItem[] {
  const actions: FuzzyItem[] = getActions().map((a) => ({
    id: a.id,
    label: a.label,
    sub: a.description,
    keywords: a.keywords.join(' '),
    kind: 'action',
    run: a.run,
  }));

  const deviceRows: FuzzyItem[] = devices.map((d) => ({
    id: `device:${d.id}`,
    label: d.name,
    sub: `${d.platform} · ${d.state}`,
    keywords: `${d.platform} device`,
    kind: 'device',
    run: (ctx) => ctx.goto(`/devices/${d.id}`),
  }));

  const pageRows: FuzzyItem[] = PAGES.map((p) => ({
    id: p.id,
    label: p.label,
    sub: p.sub,
    keywords: 'page navigate',
    kind: 'page',
    run: (ctx) => ctx.goto(p.href),
  }));

  return [...actions, ...deviceRows, ...pageRows];
}

/**
 * Compute the next selected index after an ArrowUp/ArrowDown keypress.
 * Wraps at both ends. Returns 0 for empty lists (safe display anchor).
 */
export function onKeyArrow(dir: 'up' | 'down', current: number, length: number): number {
  if (length === 0) return 0;
  if (dir === 'down') return (current + 1) % length;
  return (current - 1 + length) % length;
}

/**
 * Run an item with the supplied context and record its id in the recents
 * list. Awaits in case the item runner is async (e.g. an action with API
 * side-effects). Errors propagate to the caller for surfacing.
 */
export async function runItem(item: FuzzyItem, ctx: RunContext): Promise<void> {
  // Record before running so the recent reflects user intent even if the
  // runner throws downstream.
  pushRecent(item.id);
  await item.run(ctx);
}

// Re-export Device for callers that want a single import surface.
export type { Device };
