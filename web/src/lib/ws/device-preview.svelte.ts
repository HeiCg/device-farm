/**
 * WebSocket client for device screen preview frames.
 *
 * Protocol (matches @device-stream/android ScrcpyService output):
 *   - Initial JSON `metadata` message: { codec, width, height }
 *   - Subsequent JSON `data` messages: { data: base64 H.264 packet, keyframe, pts }
 *   - Optional `frame` messages: base64 JPEG (legacy/MJPEG path)
 *   - Error: { type: 'error', message }
 *
 * H.264 packets are decoded via WebCodecs VideoDecoder and drawn to a canvas.
 * Falls back to image rendering when the server sends `frame` messages.
 */
import { getApiKey } from '$lib/auth/auth-store.svelte.js';

// Scrcpy emits the codec as a 4-byte big-endian FourCC integer where the
// most-significant byte is the first character. 0x68323634 = "h264".
function fourCcToCodecString(codec: number): string {
	const b3 = codec & 0xff;
	const b2 = (codec >> 8) & 0xff;
	const b1 = (codec >> 16) & 0xff;
	const b0 = (codec >> 24) & 0xff;
	const name = String.fromCharCode(b0, b1, b2, b3);
	if (name === 'h265' || name === 'hev1') return 'hev1.1.6.L93.B0';
	return 'avc1.42E01E';
}

export function createDevicePreview(deviceId: string) {
	let frameSrc = $state('');
	let connected = $state(false);
	let error = $state<string | null>(null);
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let width = $state(0);
	let height = $state(0);

	let ws: WebSocket | null = null;
	let userDisconnected = false;
	let decoder: VideoDecoder | null = null;
	let pendingCodec: string | null = null;
	let configured = false;
	let waitingForKeyframe = true;
	// Scrcpy sends SPS/PPS as an Annex-B blob in a separate `configuration`
	// message. WebCodecs' `description` parameter expects AVCC, so we keep the
	// bytes around and prepend them to the next keyframe payload (Annex-B
	// inline mode) where the decoder can parse them naturally.
	let configBytes: Uint8Array | null = null;

	function ensureDecoder(): void {
		if (decoder) return;
		decoder = new VideoDecoder({
			output: (frame) => {
				if (canvasEl) {
					const ctx = canvasEl.getContext('2d');
					if (ctx) {
						if (canvasEl.width !== frame.displayWidth || canvasEl.height !== frame.displayHeight) {
							canvasEl.width = frame.displayWidth;
							canvasEl.height = frame.displayHeight;
						}
						ctx.drawImage(frame, 0, 0);
					}
				}
				frame.close();
			},
			error: (err) => {
				error = `Decoder error: ${err.message}`;
			},
		});
		configured = false;
		waitingForKeyframe = true;
	}

	function configureDecoder(): void {
		if (!decoder || !pendingCodec) return;
		// Annex-B mode: no `description`. Chrome's WebCodecs accepts inline
		// SPS/PPS+IDR start-code sequences when description is omitted.
		decoder.configure({
			codec: pendingCodec,
			optimizeForLatency: true,
		});
		configured = true;
		waitingForKeyframe = true;
	}

	function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
		const out = new Uint8Array(a.length + b.length);
		out.set(a, 0);
		out.set(b, a.length);
		return out;
	}

	function base64ToBytes(b64: string): Uint8Array {
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	function connect(): void {
		userDisconnected = false;
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const token = getApiKey();
		const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
		ws = new WebSocket(`${protocol}//${location.host}/ws/devices/${deviceId}/preview${tokenParam}`);

		ws.onopen = () => {
			connected = true;
			error = null;
		};

		ws.onclose = () => {
			connected = false;
			try {
				decoder?.close();
			} catch {
				// already closed
			}
			decoder = null;
		};

		ws.onerror = () => {
			// onclose fires after onerror
		};

		ws.onmessage = (event: MessageEvent) => {
			let msg: any;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}

			if (msg.type === 'metadata') {
				if (typeof msg.width === 'number' && msg.width > 0) width = msg.width;
				if (typeof msg.height === 'number' && msg.height > 0) height = msg.height;
				if (typeof msg.codec === 'number') {
					pendingCodec = fourCcToCodecString(msg.codec);
					ensureDecoder();
				}
				return;
			}

			if (msg.type === 'configuration' && typeof msg.data === 'string') {
				try {
					configBytes = base64ToBytes(msg.data);
					ensureDecoder();
					if (!configured) configureDecoder();
				} catch (err: any) {
					error = `Configure failed: ${err.message}`;
				}
				return;
			}

			if (msg.type === 'data' && typeof msg.data === 'string') {
				ensureDecoder();
				if (!configured) configureDecoder();
				if (!decoder) return;
				if (waitingForKeyframe && !msg.keyframe) return;
				waitingForKeyframe = false;

				try {
					let bytes = base64ToBytes(msg.data);
					// Prepend SPS/PPS to every keyframe so the decoder always has
					// the parameter sets it needs to start (or resume) decoding.
					if (msg.keyframe && configBytes) {
						bytes = concat(configBytes, bytes);
					}
					const chunk = new EncodedVideoChunk({
						type: msg.keyframe ? 'key' : 'delta',
						timestamp: msg.pts ? Number(BigInt(msg.pts)) : 0,
						data: bytes,
					});
					decoder.decode(chunk);
				} catch (err: any) {
					error = `Decode failed: ${err.message}`;
				}
				return;
			}

			if (msg.type === 'frame' && msg.data) {
				// Legacy MJPEG path (iOS sim, screencap fallback)
				frameSrc = `data:image/jpeg;base64,${msg.data}`;
				return;
			}

			if (msg.type === 'error') {
				error = msg.message ?? 'Stream error';
			}
		};
	}

	function disconnect(): void {
		userDisconnected = true;
		try {
			decoder?.close();
		} catch {
			// already closed
		}
		decoder = null;
		ws?.close();
		ws = null;
	}

	return {
		get frameSrc() { return frameSrc; },
		get connected() { return connected; },
		get error() { return error; },
		get width() { return width; },
		get height() { return height; },
		setCanvas(el: HTMLCanvasElement | null) { canvasEl = el; },
		connect,
		disconnect,
	};
}
