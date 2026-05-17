/**
 * WebSocket client for job streaming using Svelte 5 runes.
 * Connects to /ws/jobs/:id and dispatches messages by type.
 *
 * Phase 31 SC2: the server defaults to coalescing outbound frames into a
 * single `{type:'batch', items: JobMessage[]}` outer envelope per 150ms
 * window. The message handler detects the batch wrapper and iterates each
 * inner envelope, dispatching them identically to the pre-31 flat path so
 * downstream consumers see no difference. Legacy unbatched frames (?nobatch=1
 * opt-out path) still flow through the same per-envelope dispatch.
 *
 * Phase 31 SC1 surface: `crash-detected` envelope drives the dashboard
 * "Crash detected" badge via `crashDetected` + `crashFirstLine` reactive
 * state exposed on the returned store.
 */
import type { LogData, StepData, MetricsData, JobMessage, StatusData } from '$lib/api/types.js';
import { getApiKey } from '$lib/auth/auth-store.svelte.js';

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'cancelled', 'timeout']);
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

interface CrashDetectedPayload {
	firstLine: string;
}

export function createJobStream(jobId: string) {
	let logs = $state<LogData[]>([]);
	let steps = $state<StepData[]>([]);
	let metrics = $state<MetricsData[]>([]);
	let status = $state<string | null>(null);
	let connected = $state(false);
	let crashDetected = $state(false);
	let crashFirstLine = $state<string | null>(null);

	let ws: WebSocket | null = null;
	let userDisconnected = false;
	let reconnectAttempts = 0;

	function dispatchEnvelope(msg: JobMessage): void {
		switch (msg.type) {
			case 'log': {
				const data = msg.data as LogData;
				logs.push(data);
				break;
			}
			case 'step': {
				const data = msg.data as StepData;
				steps.push(data);
				break;
			}
			case 'metrics': {
				const data = msg.data as MetricsData;
				metrics.push(data);
				break;
			}
			case 'status': {
				const data = msg.data as StatusData;
				status = data.status;
				if (TERMINAL_STATUSES.has(data.status)) {
					// Allow server to send final messages before disconnecting
					setTimeout(() => disconnect(), 1000);
				}
				break;
			}
			case 'crash-detected': {
				const data = msg.data as CrashDetectedPayload;
				crashDetected = true;
				crashFirstLine = data?.firstLine ?? null;
				break;
			}
			default:
				// Unknown envelope type — log structured, do not throw. Forward-compat
				// for new server-side event types (Phase 23 saga added several).
				console.warn('[job-stream] unknown envelope type', msg.type);
		}
	}

	function handleMessage(event: MessageEvent) {
		let parsed: { type?: string; items?: unknown[] } & Partial<JobMessage>;
		try {
			parsed = JSON.parse(event.data);
		} catch (err) {
			// Malformed JSON — log and drop without throwing (graceful degrade).
			console.warn('[job-stream] malformed JSON frame', err);
			return;
		}

		// Phase 31 SC2: unwrap server-side batch envelope. The outer wrapper is
		// transport-level and intentionally NOT a JobMessage; inner items are
		// the strict per-event envelopes the dashboard already understands.
		if (parsed.type === 'batch' && Array.isArray(parsed.items)) {
			for (const inner of parsed.items as JobMessage[]) {
				dispatchEnvelope(inner);
			}
			return;
		}

		dispatchEnvelope(parsed as JobMessage);
	}

	function connect() {
		userDisconnected = false;
		reconnectAttempts = 0;
		openConnection();
	}

	function openConnection() {
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const token = getApiKey();
		const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
		ws = new WebSocket(`${protocol}//${location.host}/ws/jobs/${jobId}${tokenParam}`);

		ws.onopen = () => {
			connected = true;
			reconnectAttempts = 0;
		};

		ws.onclose = () => {
			connected = false;
			if (!userDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectAttempts++;
				setTimeout(() => openConnection(), RECONNECT_DELAY_MS);
			}
		};

		ws.onerror = () => {
			// onclose will fire after onerror, handled there
		};

		ws.onmessage = handleMessage;
	}

	function disconnect() {
		userDisconnected = true;
		ws?.close();
		ws = null;
	}

	return {
		get logs() { return logs; },
		get steps() { return steps; },
		get metrics() { return metrics; },
		get status() { return status; },
		get connected() { return connected; },
		get crashDetected() { return crashDetected; },
		get crashFirstLine() { return crashFirstLine; },
		connect,
		disconnect
	};
}
