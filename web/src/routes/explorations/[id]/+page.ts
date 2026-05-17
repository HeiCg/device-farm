/**
 * Phase 35 Plan 35-05 — Exploration detail route loader.
 *
 * Loads the full graph (exploration + screens + transitions) for a
 * single run id. The route renders Atlas + ScreenPanel + JourneyPanel
 * and (for queued/running runs) opens a WebSocket to merge live
 * frames into the local screenMap state.
 */
import { error } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client.js';
import {
  getExploration,
  type ExplorationGetResponse,
} from '$lib/explorations/client.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async ({
  params,
}: {
  params: { id: string };
}): Promise<ExplorationGetResponse> => {
  try {
    return await getExploration(params.id);
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 401) throw error(401, 'Unauthorized');
      throw error(err.status, err.detail);
    }
    throw error(500, err instanceof Error ? err.message : 'failed to load exploration');
  }
};
