/**
 * Sessions list load function — Phase 34 Plan 34-07.
 *
 * Runs client-side only (SvelteKit adapter-static SPA mode; root +layout.ts
 * sets `ssr = false`). Auth is enforced at the root layout — if not
 * authenticated the layout redirects to /login before this load fires.
 * apiFetch additionally redirects to /login on a 401 from the server.
 */
import { loadActiveSessions } from '$lib/sessions/load.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => loadActiveSessions();
