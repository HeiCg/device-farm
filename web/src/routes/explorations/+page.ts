/**
 * Phase 35 Plan 35-05 — Explorations list route loader.
 *
 * Runs client-side only (SvelteKit adapter-static SPA mode). Auth is
 * enforced at the root layout — if not authenticated the layout
 * redirects to /login before this load fires.
 */
import { error } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client.js';
import { listExplorations, type ExplorationListItem } from '$lib/explorations/client.js';
import type { PageLoad } from './$types.js';

export interface ExplorationsListData {
  explorations: ExplorationListItem[];
}

export const load: PageLoad = async (): Promise<ExplorationsListData> => {
  try {
    const result = await listExplorations();
    return { explorations: result.explorations };
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        // apiFetch already cleared the api key + initiated /login
        // navigation; return empty so the route can render until
        // SvelteKit completes the navigation.
        return { explorations: [] };
      }
      throw error(err.status, err.detail);
    }
    throw error(500, err instanceof Error ? err.message : 'failed to load explorations');
  }
};
