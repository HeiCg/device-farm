/**
 * Sessions REST client wrappers — Phase 34 Plan 34-07.
 *
 * Thin fetch wrappers around the Phase 34-01 REST surface (POST/DELETE/GET
 * /api/sessions). Reuses the project's typed `apiFetch` (which bakes in
 * Bearer auth via the auth-store + handles 401 → /login redirect for us).
 *
 * Schemas for Session* types are mirrored locally here because at the time
 * this lands the server's openapi.json regeneration is DB-gated (see Plan
 * 34-01 SUMMARY §Issues Encountered). Once `npm run web:types` runs against
 * a DB-equipped environment the generated `components['schemas']['SessionLeaseRequest']`
 * et al. will land in `web/src/lib/api/generated-types.ts` and the local
 * shapes here can be replaced with `import type { components } ...`.
 */
import { apiFetch } from '$lib/api/client.js';

export type SessionStatus = 'active' | 'released' | 'expired';

export interface SessionLeaseRequest {
	platform: 'android' | 'ios';
	ttlSeconds?: number;
}

export interface SessionLeaseResponse {
	sessionId: string;
	deviceId: string;
	deviceName: string;
	platform: 'android' | 'ios';
	leaseUntil: string;
	wsUrl: string;
}

export interface SessionListItem {
	sessionId: string;
	deviceId: string;
	deviceName: string;
	platform: 'android' | 'ios';
	status: SessionStatus;
	ownerActor: string;
	leaseUntil: string;
	createdAt: string;
	releasedAt: string | null;
}

export interface SessionListResponse {
	sessions: SessionListItem[];
}

export interface SessionReleaseResponse {
	sessionId: string;
	status: SessionStatus;
	releasedAt: string;
}

/**
 * List sessions, optionally filtered by status. Defaults to no filter
 * (server returns all).
 */
export async function listSessions(status?: SessionStatus): Promise<SessionListResponse> {
	const q = status ? `?status=${encodeURIComponent(status)}` : '';
	return apiFetch<SessionListResponse>(`/sessions${q}`);
}

/**
 * Lease a fresh device. Returns the session id + ws url. (The web UI does
 * NOT currently invoke this — leasing happens via CLI/MCP per Plan 34-07
 * scope — but the wrapper is exported for parity + future use.)
 */
export async function leaseSession(body: SessionLeaseRequest): Promise<SessionLeaseResponse> {
	return apiFetch<SessionLeaseResponse>('/sessions', {
		method: 'POST',
		body: JSON.stringify(body)
	});
}

/**
 * Release an active session by id. Server returns 204 (no body) or the
 * release receipt depending on admin-override path; we treat both shapes
 * leniently by returning whatever `apiFetch` parses.
 */
export async function releaseSession(sessionId: string): Promise<SessionReleaseResponse | void> {
	return apiFetch<SessionReleaseResponse | void>(`/sessions/${encodeURIComponent(sessionId)}`, {
		method: 'DELETE'
	});
}
