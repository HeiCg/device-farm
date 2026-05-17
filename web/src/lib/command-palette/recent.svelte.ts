/**
 * Phase 36 Plan 36-03 — Recent actions localStorage helper.
 *
 * FIFO max 5 entries. Duplicate pushes move the entry to the head.
 * SSR-safe: returns [] when `localStorage` is undefined (e.g. node import
 * during SvelteKit SSR pass) and `pushRecent` becomes a no-op.
 */

// Exported for spec assertions in 36-03.
export const STORAGE_KEY = 'device-farm-palette-recent';
export const MAX = 5;

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined' && localStorage !== null;
}

export function getRecent(): string[] {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecent(actionId: string): void {
  if (!hasStorage()) return;
  const current = getRecent();
  // Remove any existing occurrence (move-to-head behavior)
  const deduped = current.filter((id) => id !== actionId);
  // Prepend new id, slice to MAX
  const next = [actionId, ...deduped].slice(0, MAX);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private-browsing failures swallowed — recents are best-effort.
  }
}
