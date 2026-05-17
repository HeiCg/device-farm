/**
 * Session detail load function — Phase 34 Plan 34-07.
 *
 * Thin SvelteKit wrapper around `loadSessionDetail` (in $lib/sessions/load).
 */
import { loadSessionDetail } from '$lib/sessions/load.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async ({ params }) => loadSessionDetail(params.id);
