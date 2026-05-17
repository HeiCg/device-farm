// @vitest-environment jsdom
//
// Sessions list spec — Phase 34 Plan 34-07.
//
// Carries forward the Plan 34-00 file-existence assertions for the route
// stubs, and adds Plan 34-07 substantive coverage of:
//   (a) +page.ts load function returns {sessions: [...]} on 200
//   (b) +page.ts load function surfaces ApiError -> SvelteKit error() on non-401
//   (c) +page.ts load function returns empty list on 401 (apiFetch internally
//       redirects to /login; load returns gracefully)
//   (d) listSessions() builds the correct query string (no status / with status)
//   (e) releaseSession() issues DELETE with the encoded session id
//
// IMPORTANT: web/ has no svelte test-runner infrastructure (no
// vite-plugin-svelte test integration). We do NOT render the +page.svelte
// component here — instead we exercise the pure-function surface in
// `+page.ts` + `client.ts`. The Release-button state-filtering behavior is
// a 3-line $state filter (`sessions = sessions.filter(...)`) verified
// manually at the human-verify checkpoint at the end of this plan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Route file existence (carryover from 34-00 substrate) -----------------

// Existence checks resolve paths relative to this spec file (not cwd) so
// they pass regardless of whether vitest is invoked from web/ or repo root.
// `fileURLToPath` handles the platform-specific URL → path conversion that
// `new URL(...).pathname` botches under jsdom (returns a URL with extra
// percent-encoding on some hosts).
const HERE = dirname(fileURLToPath(import.meta.url));
const fromHere = (rel: string) => resolve(HERE, rel);

describe('Sessions web route stubs (Plan 34-00 carryover)', () => {
	it('list route file exists', () => {
		expect(existsSync(fromHere('../../../routes/sessions/+page.svelte'))).toBe(true);
	});

	it('detail route file exists', () => {
		expect(existsSync(fromHere('../../../routes/sessions/[id]/+page.svelte'))).toBe(true);
	});

	it('list load function file exists (Plan 34-07)', () => {
		expect(existsSync(fromHere('../../../routes/sessions/+page.ts'))).toBe(true);
	});

	it('client.ts file exists (Plan 34-07)', () => {
		expect(existsSync(fromHere('../client.ts'))).toBe(true);
	});
});

// --- Mock the typed apiFetch surface --------------------------------------

// The root vitest config configures the `$lib` alias to point at
// web/src/lib so the imports below resolve identically inside the spec
// and inside the SUT (`client.ts` uses `import {apiFetch} from '$lib/...'`).
vi.mock('$lib/api/client.js', async () => {
	class ApiError extends Error {
		status: number;
		detail: string;
		type: string;
		constructor(status: number, detail: string, type = 'about:blank') {
			super(detail);
			this.status = status;
			this.detail = detail;
			this.type = type;
		}
	}
	return {
		ApiError,
		apiFetch: vi.fn()
	};
});

vi.mock('$lib/auth/auth-store.svelte.js', () => ({
	getApiKey: () => 'test-key',
	clearApiKey: () => {}
}));

// --- listSessions / releaseSession wrappers -------------------------------

describe('listSessions / releaseSession wrappers (Plan 34-07)', () => {
	let apiFetchMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const mod = await import('$lib/api/client.js');
		apiFetchMock = (mod as any).apiFetch as ReturnType<typeof vi.fn>;
		apiFetchMock.mockReset();
	});

	it('listSessions() with no status omits the query string', async () => {
		apiFetchMock.mockResolvedValue({ sessions: [] });
		const { listSessions } = await import('../client.js');
		await listSessions();
		expect(apiFetchMock).toHaveBeenCalledWith('/sessions');
	});

	it('listSessions("active") appends the encoded status query', async () => {
		apiFetchMock.mockResolvedValue({ sessions: [] });
		const { listSessions } = await import('../client.js');
		await listSessions('active');
		expect(apiFetchMock).toHaveBeenCalledWith('/sessions?status=active');
	});

	it('releaseSession(id) DELETEs the encoded id path', async () => {
		apiFetchMock.mockResolvedValue(undefined);
		const { releaseSession } = await import('../client.js');
		await releaseSession('abc/123');
		expect(apiFetchMock).toHaveBeenCalledWith('/sessions/abc%2F123', { method: 'DELETE' });
	});

	it('leaseSession(body) POSTs serialized JSON', async () => {
		apiFetchMock.mockResolvedValue({
			sessionId: 'sess-1',
			deviceId: 'dev-1',
			deviceName: 'pixel-5',
			platform: 'android',
			leaseUntil: '2030-01-01T00:00:00Z',
			wsUrl: 'ws://localhost:3000/ws/sessions/sess-1'
		});
		const { leaseSession } = await import('../client.js');
		await leaseSession({ platform: 'android', ttlSeconds: 600 });
		expect(apiFetchMock).toHaveBeenCalledWith('/sessions', {
			method: 'POST',
			body: JSON.stringify({ platform: 'android', ttlSeconds: 600 })
		});
	});
});

// --- +page.ts load function ----------------------------------------------

describe('+page.ts load (Plan 34-07)', () => {
	let apiFetchMock: ReturnType<typeof vi.fn>;
	let ApiErrorCtor: any;

	beforeEach(async () => {
		const mod = await import('$lib/api/client.js');
		apiFetchMock = (mod as any).apiFetch as ReturnType<typeof vi.fn>;
		ApiErrorCtor = (mod as any).ApiError;
		apiFetchMock.mockReset();
	});

	it('returns {sessions: [...]} on 200', async () => {
		const sample = [
			{
				sessionId: 's1',
				deviceId: 'd1',
				deviceName: 'pixel-5',
				platform: 'android' as const,
				status: 'active' as const,
				ownerActor: 'apikey:11111111-1111-1111-1111-111111111111',
				leaseUntil: '2030-01-01T00:00:00Z',
				createdAt: '2026-01-01T00:00:00Z',
				releasedAt: null
			}
		];
		apiFetchMock.mockResolvedValue({ sessions: sample });
		const { loadActiveSessions } = await import('../load.js');
		const result = await loadActiveSessions();
		expect(result).toEqual({ sessions: sample });
		expect(apiFetchMock).toHaveBeenCalledWith('/sessions?status=active');
	});

	it('returns empty list on 401 (apiFetch already redirected to /login)', async () => {
		apiFetchMock.mockRejectedValue(new ApiErrorCtor(401, 'Unauthorized'));
		const { loadActiveSessions } = await import('../load.js');
		const result = await loadActiveSessions();
		expect(result).toEqual({ sessions: [] });
	});

	it('throws a SvelteKit error on non-401 ApiError', async () => {
		apiFetchMock.mockRejectedValue(new ApiErrorCtor(500, 'boom'));
		const { loadActiveSessions } = await import('../load.js');
		// SvelteKit's error(status, body) throws an HttpError-shaped object
		// whose .status / .body fields surface in the caught exception.
		let caught: any = null;
		try {
			await loadActiveSessions();
		} catch (err) {
			caught = err;
		}
		expect(caught).not.toBeNull();
		expect(caught.status).toBe(500);
	});
});
