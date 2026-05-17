/**
 * Sessions WebSocket client — Phase 34 Plan 34-07.
 *
 * Wraps the Phase 34-02 session WS surface (`/ws/sessions/:id?token=<bearer>`)
 * with:
 *   - Ack-matching: each envelope sent via `send()` resolves when an `ack`,
 *     `pong`, or matching `error` frame arrives with `forMsgId === id`.
 *   - Frame log: a Svelte store of every received frame for the action history
 *     UI in `[id]/+page.svelte`.
 *   - TLS-first scheme guard (`deriveWsScheme`): defaults to `wss:`; plaintext
 *     `ws:` is permitted ONLY when `location.hostname` is a loopback literal
 *     (`localhost` / `127.0.0.1`). Production behind TLS-terminating reverse
 *     proxies or direct TLS always uses `wss:` — see RESEARCH §Open Q #8.
 *
 * No external dependencies.
 */
import { writable, type Readable } from 'svelte/store';

export interface AckResult {
	durationMs: number;
	result?: unknown;
}

export interface SessionFrame {
	type: string;
	forMsgId?: string;
	durationMs?: number;
	result?: unknown;
	code?: string;
	message?: string;
	kind?: string;
	data?: unknown;
	/** Wall-clock timestamp the client received the frame (ms epoch). */
	_at: number;
	[key: string]: unknown;
}

export interface SessionWsClient {
	frames: Readable<SessionFrame[]>;
	send(envelope: { type: string; id?: string; [key: string]: unknown }): Promise<AckResult>;
	close(): void;
}

/**
 * Returns true when the hostname is a loopback literal (no DNS lookup).
 * Used by the TLS-first scheme guard to decide whether plaintext WS is
 * acceptable. Mirrors the RFC 6761 reserved literals.
 */
export function isLoopback(hostname: string): boolean {
	return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/**
 * TLS-first scheme guard — RESEARCH §Open Q #8.
 *
 * Production deployments terminate TLS at the server or upstream proxy;
 * plaintext WebSocket is permitted ONLY for loopback dev hosts. Every
 * non-loopback plaintext request is force-upgraded to `wss:` to prevent
 * accidental cleartext bearer-token transmission (CWE-319).
 */
export function deriveWsScheme(loc: { protocol: string; hostname: string }): 'wss:' | 'ws:' {
	if (loc.protocol === 'https:') return 'wss:';
	if (isLoopback(loc.hostname)) return 'ws:';
	return 'wss:';
}

/**
 * Builds a session WS URL. Centralized so every WS dial in the page module
 * routes through `deriveWsScheme` (defense-in-depth against accidental
 * cleartext regression).
 */
export function buildSessionWsUrl(
	loc: { protocol: string; hostname: string; host: string },
	sessionId: string,
	token: string,
): string {
	const scheme = deriveWsScheme(loc);
	const safeId = encodeURIComponent(sessionId);
	const safeToken = encodeURIComponent(token);
	return `${scheme}//${loc.host}/ws/sessions/${safeId}?token=${safeToken}`;
}

/** Internal: pending resolver bookkeeping. */
interface PendingEntry {
	resolve: (a: AckResult) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Construct a session WS client given a fully-built URL. The URL must
 * already include the `?token=` query — callers should route through
 * `buildSessionWsUrl` to stay TLS-guarded.
 *
 * `socketFactory` is exposed for testability so specs can inject a
 * MockWebSocket without monkey-patching globalThis.
 */
export function createSessionWs(
	url: string,
	opts: {
		socketFactory?: (url: string) => WebSocket;
		ackTimeoutMs?: number;
	} = {},
): SessionWsClient {
	const factory = opts.socketFactory ?? ((u: string) => new WebSocket(u));
	const ackTimeoutMs = opts.ackTimeoutMs ?? 30_000;
	const socket = factory(url);
	const framesStore = writable<SessionFrame[]>([]);
	const pending = new Map<string, PendingEntry>();

	socket.addEventListener('message', (ev) => {
		const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
		let frame: SessionFrame | null = null;
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				frame = { ...parsed, _at: Date.now() } as SessionFrame;
			}
		} catch {
			// drop malformed
		}
		if (!frame) return;
		framesStore.update((arr) => [...arr, frame!]);

		if ((frame.type === 'ack' || frame.type === 'pong') && typeof frame.forMsgId === 'string') {
			const entry = pending.get(frame.forMsgId);
			if (entry) {
				pending.delete(frame.forMsgId);
				clearTimeout(entry.timer);
				entry.resolve({
					durationMs: typeof frame.durationMs === 'number' ? frame.durationMs : 0,
					result: frame.result,
				});
			}
		} else if (frame.type === 'error' && typeof frame.forMsgId === 'string') {
			const entry = pending.get(frame.forMsgId);
			if (entry) {
				pending.delete(frame.forMsgId);
				clearTimeout(entry.timer);
				const code = typeof frame.code === 'string' ? frame.code : 'unknown_error';
				const message = typeof frame.message === 'string' ? frame.message : 'session WS error';
				entry.reject(new Error(`${code}: ${message}`));
			}
		}
	});

	socket.addEventListener('close', () => {
		// Reject any outstanding promises so the UI doesn't hang forever.
		for (const [, entry] of pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error('socket closed'));
		}
		pending.clear();
	});

	async function send(partial: {
		type: string;
		id?: string;
		[key: string]: unknown;
	}): Promise<AckResult> {
		const id = partial.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const envelope = { ...partial, id };
		// Wait for OPEN if still CONNECTING. Reject if already CLOSED/CLOSING.
		if (socket.readyState === WebSocket.CONNECTING) {
			await new Promise<void>((resolveOpen, rejectOpen) => {
				const onOpen = () => {
					socket.removeEventListener('open', onOpen);
					socket.removeEventListener('error', onErr);
					resolveOpen();
				};
				const onErr = () => {
					socket.removeEventListener('open', onOpen);
					socket.removeEventListener('error', onErr);
					rejectOpen(new Error('socket failed to open'));
				};
				socket.addEventListener('open', onOpen);
				socket.addEventListener('error', onErr);
			});
		} else if (socket.readyState !== WebSocket.OPEN) {
			throw new Error('socket not open');
		}

		return new Promise<AckResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (pending.delete(id)) {
					reject(new Error(`timeout id=${id}`));
				}
			}, ackTimeoutMs);
			pending.set(id, { resolve, reject, timer });
			try {
				socket.send(JSON.stringify(envelope));
			} catch (err) {
				pending.delete(id);
				clearTimeout(timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	function close(): void {
		try {
			socket.close(1000);
		} catch {
			// ignore
		}
	}

	return {
		frames: { subscribe: framesStore.subscribe } as Readable<SessionFrame[]>,
		send,
		close,
	};
}

/**
 * Pure helper exported for test + UI reuse: converts a click event on a
 * canvas overlay into device-pixel coordinates by reading the canvas
 * bounding rect + the device's intrinsic resolution.
 */
export interface CanvasClickToDeviceCoordsInput {
	rect: { left: number; top: number; width: number; height: number };
	clientX: number;
	clientY: number;
	deviceWidth: number;
	deviceHeight: number;
}

export function canvasClickToDeviceCoords(
	input: CanvasClickToDeviceCoordsInput,
): { x: number; y: number } {
	const { rect, clientX, clientY, deviceWidth, deviceHeight } = input;
	if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
	const x = Math.floor(((clientX - rect.left) / rect.width) * deviceWidth);
	const y = Math.floor(((clientY - rect.top) / rect.height) * deviceHeight);
	return { x, y };
}
