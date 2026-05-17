/**
 * Sessions route load helpers — Phase 34 Plan 34-07.
 *
 * Pure-function load logic extracted from `+page.ts` so the spec suite can
 * import + exercise it without pulling in SvelteKit's `./$types.js`
 * generated module (which only exists inside the SvelteKit build).
 */
import { error } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client.js';
import { listSessions, type SessionListItem } from './client.js';

export interface SessionsListData {
	sessions: SessionListItem[];
}

export async function loadActiveSessions(): Promise<SessionsListData> {
	try {
		const result = await listSessions('active');
		return { sessions: result.sessions };
	} catch (err: unknown) {
		if (err instanceof ApiError) {
			if (err.status === 401) {
				// apiFetch already cleared the api key + initiated /login
				// navigation; return empty so the route can render until
				// SvelteKit completes the navigation.
				return { sessions: [] };
			}
			throw error(err.status, err.detail);
		}
		throw error(500, err instanceof Error ? err.message : 'failed to load sessions');
	}
}

export interface SessionDetailData {
	session: SessionListItem;
}

/**
 * Loads a single session detail row by id. The current REST surface does
 * not expose `GET /api/sessions/:id` so we fetch the full active list and
 * filter — acceptable for now (small N, infrequent navigation). When the
 * server adds a single-row endpoint this helper is the single edit site.
 */
export async function loadSessionDetail(id: string): Promise<SessionDetailData> {
	try {
		const result = await listSessions();
		const session = result.sessions.find((s) => s.sessionId === id);
		if (!session) {
			throw error(404, 'session not found');
		}
		return { session };
	} catch (err: unknown) {
		if (err instanceof ApiError) {
			if (err.status === 401) {
				throw error(401, 'Unauthorized');
			}
			throw error(err.status, err.detail);
		}
		throw err;
	}
}
