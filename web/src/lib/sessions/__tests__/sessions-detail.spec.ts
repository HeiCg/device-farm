// @vitest-environment jsdom
//
// Sessions detail spec — Phase 34 Plan 34-07.
//
// Covers the pure logic that powers `[id]/+page.svelte`:
//   - existence checks for the route + ws helper files
//   - TLS-first WS scheme guard (`deriveWsScheme`) — wss: default, plaintext
//     only for loopback (per RESEARCH §Open Q #8 + CWE-319 defense)
//   - `buildSessionWsUrl` constructs `${scheme}//${host}/ws/sessions/${id}?token=…`
//   - `canvasClickToDeviceCoords` correctly scales canvas-space clicks into
//     device pixels (1:1 + half-size cases)
//   - `createSessionWs` ack-matching: sending an envelope and dispatching an
//     `ack` frame with matching `forMsgId` resolves the promise
//   - error frame with matching forMsgId rejects the pending send + appears
//     in the frames feed
//   - `loadSessionDetail` happy path (find session) + 404 path (missing id)
//
// Component rendering of the .svelte page is NOT exercised here — web/ has
// no vite-plugin-svelte test integration. The interactive UX (canvas click
// → tap; textarea Enter → type) is verified manually at the human-verify
// checkpoint at the end of this plan.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	canvasClickToDeviceCoords,
	createSessionWs,
	deriveWsScheme,
	buildSessionWsUrl,
	isLoopback,
} from '../ws.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fromHere = (rel: string) => resolve(HERE, rel);

// --- File existence -------------------------------------------------------

describe('Sessions detail route files (Plan 34-07)', () => {
	it('detail route .svelte file exists', () => {
		expect(existsSync(fromHere('../../../routes/sessions/[id]/+page.svelte'))).toBe(true);
	});

	it('detail route +page.ts file exists', () => {
		expect(existsSync(fromHere('../../../routes/sessions/[id]/+page.ts'))).toBe(true);
	});

	it('ws.ts client file exists', () => {
		expect(existsSync(fromHere('../ws.ts'))).toBe(true);
	});
});

// --- TLS-first scheme guard (RESEARCH §Open Q #8 / CWE-319) ----------------

describe('deriveWsScheme — TLS-first guard', () => {
	it('returns wss: when the page is served over https (production)', () => {
		expect(deriveWsScheme({ protocol: 'https:', hostname: 'app.example.com' })).toBe('wss:');
		expect(deriveWsScheme({ protocol: 'https:', hostname: 'localhost' })).toBe('wss:');
	});

	it('force-upgrades plaintext non-loopback hosts to wss: (cleartext defense)', () => {
		expect(deriveWsScheme({ protocol: 'http:', hostname: 'app.example.com' })).toBe('wss:');
		expect(deriveWsScheme({ protocol: 'http:', hostname: '10.0.0.5' })).toBe('wss:');
		expect(deriveWsScheme({ protocol: 'http:', hostname: 'farm.internal' })).toBe('wss:');
	});

	it('allows plaintext ws: ONLY for loopback dev hostnames over http', () => {
		expect(deriveWsScheme({ protocol: 'http:', hostname: 'localhost' })).toBe('ws:');
		expect(deriveWsScheme({ protocol: 'http:', hostname: '127.0.0.1' })).toBe('ws:');
		expect(deriveWsScheme({ protocol: 'http:', hostname: '[::1]' })).toBe('ws:');
	});

	it('isLoopback recognizes only documented loopback literals', () => {
		expect(isLoopback('localhost')).toBe(true);
		expect(isLoopback('127.0.0.1')).toBe(true);
		expect(isLoopback('[::1]')).toBe(true);
		expect(isLoopback('192.168.1.10')).toBe(false);
		expect(isLoopback('app.example.com')).toBe(false);
	});
});

describe('buildSessionWsUrl', () => {
	it('routes through deriveWsScheme + encodes the token', () => {
		const url = buildSessionWsUrl(
			{ protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com:443' },
			'sess-1',
			'tok en/with+chars',
		);
		expect(url.startsWith('wss://app.example.com:443/ws/sessions/sess-1?token=')).toBe(true);
		expect(url).toContain('token=tok%20en%2Fwith%2Bchars');
	});

	it('uses plaintext only for loopback dev', () => {
		const url = buildSessionWsUrl(
			{ protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' },
			'sess-2',
			'abc',
		);
		expect(url.startsWith('ws://localhost:5173/ws/sessions/sess-2?token=abc')).toBe(true);
	});
});

// --- canvasClickToDeviceCoords -------------------------------------------

describe('canvasClickToDeviceCoords — coord scaling', () => {
	it('passes through 1:1 when canvas matches device pixels', () => {
		const result = canvasClickToDeviceCoords({
			rect: { left: 0, top: 0, width: 1080, height: 1920 },
			clientX: 300,
			clientY: 600,
			deviceWidth: 1080,
			deviceHeight: 1920,
		});
		expect(result).toEqual({ x: 300, y: 600 });
	});

	it('scales coords when canvas is rendered at half size', () => {
		const result = canvasClickToDeviceCoords({
			rect: { left: 0, top: 0, width: 540, height: 960 },
			clientX: 300,
			clientY: 600,
			deviceWidth: 1080,
			deviceHeight: 1920,
		});
		expect(result).toEqual({ x: 600, y: 1200 });
	});

	it('accounts for canvas offset from page origin', () => {
		const result = canvasClickToDeviceCoords({
			rect: { left: 100, top: 200, width: 1080, height: 1920 },
			clientX: 400,
			clientY: 800,
			deviceWidth: 1080,
			deviceHeight: 1920,
		});
		expect(result).toEqual({ x: 300, y: 600 });
	});

	it('returns 0,0 defensively on zero-width rect', () => {
		const result = canvasClickToDeviceCoords({
			rect: { left: 0, top: 0, width: 0, height: 0 },
			clientX: 50,
			clientY: 50,
			deviceWidth: 1080,
			deviceHeight: 1920,
		});
		expect(result).toEqual({ x: 0, y: 0 });
	});
});

// --- MockWebSocket --------------------------------------------------------

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	url: string;
	readyState = 1; // OPEN immediately for test simplicity
	sent: string[] = [];
	private listeners = new Map<string, Set<(ev: any) => void>>();

	constructor(url: string) {
		this.url = url;
	}

	addEventListener(type: string, cb: (ev: any) => void) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(cb);
	}

	removeEventListener(type: string, cb: (ev: any) => void) {
		this.listeners.get(type)?.delete(cb);
	}

	dispatchEvent(type: string, ev: any) {
		this.listeners.get(type)?.forEach((cb) => cb(ev));
	}

	send(data: string) {
		this.sent.push(data);
	}

	close(_code?: number) {
		this.readyState = 3;
		this.dispatchEvent('close', { code: _code ?? 1000 });
	}

	/** Test helper: simulate an inbound frame. */
	emit(frame: object) {
		this.dispatchEvent('message', { data: JSON.stringify(frame) });
	}
}

// jsdom exposes a global WebSocket but lacks the readyState constants the
// SUT references (`WebSocket.OPEN` etc.). Patch the global so SUT
// comparisons resolve consistently.
beforeEach(() => {
	(globalThis as any).WebSocket = MockWebSocket;
});

// --- createSessionWs ------------------------------------------------------

describe('createSessionWs — ack matching + frame feed', () => {
	it('resolves send() when a matching ack frame arrives', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});

		const sendPromise = client.send({ type: 'tap', x: 100, y: 200, id: 'msg-1' });
		// Wait a microtask so the send goes onto the socket
		await Promise.resolve();
		expect(mock.sent.length).toBe(1);
		const sentEnvelope = JSON.parse(mock.sent[0]);
		expect(sentEnvelope).toEqual({ type: 'tap', x: 100, y: 200, id: 'msg-1' });

		mock.emit({ type: 'ack', forMsgId: 'msg-1', durationMs: 42 });

		const result = await sendPromise;
		expect(result).toEqual({ durationMs: 42, result: undefined });
	});

	it('auto-generates an id when caller omits one', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});
		const sendPromise = client.send({ type: 'type', text: 'hi' });
		await Promise.resolve();
		const sent = JSON.parse(mock.sent[0]);
		expect(sent.id).toBeTypeOf('string');
		expect(sent.id.length).toBeGreaterThan(4);
		mock.emit({ type: 'ack', forMsgId: sent.id, durationMs: 5 });
		await sendPromise;
	});

	it('rejects send() when a matching error frame arrives', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});
		const sendPromise = client.send({ type: 'tap', x: 1, y: 1, id: 'bad-1' });
		await Promise.resolve();
		mock.emit({ type: 'error', forMsgId: 'bad-1', code: 'device_error', message: 'tap failed' });

		await expect(sendPromise).rejects.toThrow(/device_error: tap failed/);
	});

	it('appends every received frame to the frames store with _at timestamp', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});

		const seen: any[] = [];
		const unsub = client.frames.subscribe((arr) => seen.push([...arr]));

		mock.emit({ type: 'event', kind: 'connected', data: { heartbeatIntervalMs: 30000 } });
		mock.emit({ type: 'ack', forMsgId: 'whatever', durationMs: 1 });

		// The first snapshot is the empty initial value; the last should
		// contain both emitted frames in order.
		const final = seen[seen.length - 1];
		expect(final.length).toBe(2);
		expect(final[0].type).toBe('event');
		expect(final[0].kind).toBe('connected');
		expect(typeof final[0]._at).toBe('number');
		expect(final[1].type).toBe('ack');

		unsub();
	});

	it('rejects pending sends when the socket closes', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});
		const sendPromise = client.send({ type: 'tap', x: 0, y: 0, id: 'stuck' });
		await Promise.resolve();
		mock.close(1006);
		await expect(sendPromise).rejects.toThrow(/socket closed/);
	});

	it('drops malformed JSON frames without throwing', async () => {
		let mock!: MockWebSocket;
		const client = createSessionWs('ws://localhost/ws/sessions/s1?token=x', {
			socketFactory: (u) => {
				mock = new MockWebSocket(u);
				return mock as unknown as WebSocket;
			},
		});
		let snapshot: any[] = [];
		const unsub = client.frames.subscribe((arr) => (snapshot = arr));
		mock.dispatchEvent('message', { data: 'not-json {{{' });
		mock.emit({ type: 'event', kind: 'connected' });
		expect(snapshot.length).toBe(1);
		expect(snapshot[0].type).toBe('event');
		unsub();
	});
});

// --- loadSessionDetail ----------------------------------------------------

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
		apiFetch: vi.fn(),
	};
});

vi.mock('$lib/auth/auth-store.svelte.js', () => ({
	getApiKey: () => 'test-key',
	clearApiKey: () => {},
}));

describe('loadSessionDetail', () => {
	let apiFetchMock: ReturnType<typeof vi.fn>;
	beforeEach(async () => {
		const mod = await import('$lib/api/client.js');
		apiFetchMock = (mod as any).apiFetch as ReturnType<typeof vi.fn>;
		apiFetchMock.mockReset();
	});

	it('returns {session} when the id is found in the list', async () => {
		apiFetchMock.mockResolvedValue({
			sessions: [
				{
					sessionId: 'target',
					deviceId: 'd1',
					deviceName: 'pixel-5',
					platform: 'android',
					status: 'active',
					ownerActor: 'apikey:abc',
					leaseUntil: '2030-01-01T00:00:00Z',
					createdAt: '2026-01-01T00:00:00Z',
					releasedAt: null,
				},
			],
		});
		const { loadSessionDetail } = await import('../load.js');
		const result = await loadSessionDetail('target');
		expect(result.session.sessionId).toBe('target');
	});

	it('throws 404 when the session id is missing', async () => {
		apiFetchMock.mockResolvedValue({ sessions: [] });
		const { loadSessionDetail } = await import('../load.js');
		let caught: any = null;
		try {
			await loadSessionDetail('missing');
		} catch (err) {
			caught = err;
		}
		expect(caught).not.toBeNull();
		expect(caught.status).toBe(404);
	});
});
