<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { getApiKey } from '$lib/auth/auth-store.svelte.js';
	import {
		buildSessionWsUrl,
		canvasClickToDeviceCoords,
		createSessionWs,
		type SessionFrame,
		type SessionWsClient,
	} from '$lib/sessions/ws.js';
	import { listSessions, type SessionListItem } from '$lib/sessions/client.js';
	import MirrorTargetSelector from '$lib/components/MirrorTargetSelector.svelte';

	let { data } = $props<{ data: { session: SessionListItem } }>();

	let ws = $state<SessionWsClient | null>(null);
	let frames = $state<SessionFrame[]>([]);
	let typeText = $state('');
	let connectionError = $state<string | null>(null);
	let videoEl: HTMLVideoElement | undefined = $state();
	let canvasEl: HTMLCanvasElement | undefined = $state();

	// Phase 37 Plan 37-04 Wave 1 Track D — mirror targets (multi-select).
	// `otherSessions` is loaded once on mount (siblings of this session); user
	// toggles chips on the MirrorTargetSelector to opt into fan-out. Every
	// canvas tap / text submit issues a parallel POST /api/sessions/broadcast
	// when `mirrorIds.length > 0`. Errors land in `mirrorResults` as a
	// short-lived per-session feed (3s auto-clear).
	let otherSessions = $state<Array<{ id: string; deviceLabel: string }>>([]);
	let mirrorIds = $state<string[]>([]);
	let mirrorResults = $state<Array<{ sessionId: string; ok: boolean; error?: string; at: number }>>([]);

	// Device dimensions — RESEARCH §Open Q TBD: the server's session list does
	// not surface deviceWidth/Height today (Plan 34-03 will probe when
	// resolver paths need them). Until then default to a 1080x1920 portrait
	// reference frame (the same constants buildActionContext uses) so the
	// click-to-tap mapping is at least proportionally correct.
	const DEFAULT_DEVICE_WIDTH = 1080;
	const DEFAULT_DEVICE_HEIGHT = 1920;
	const deviceWidth = $derived<number>(
		((data.session as unknown as { deviceWidth?: number }).deviceWidth) ?? DEFAULT_DEVICE_WIDTH,
	);
	const deviceHeight = $derived<number>(
		((data.session as unknown as { deviceHeight?: number }).deviceHeight) ?? DEFAULT_DEVICE_HEIGHT,
	);

	onMount(() => {
		if (!browser) return;
		const token = getApiKey() ?? '';
		if (!token) {
			connectionError = 'Not authenticated. Redirecting to /login…';
			return;
		}
		// Phase 37 Plan 37-04 — load other active sessions for the mirror selector.
		// Best-effort: a failure here only disables mirror UI; main session WS still works.
		listSessions('active')
			.then((res) => {
				otherSessions = res.sessions
					.filter((s) => s.sessionId !== data.session.sessionId)
					.map((s) => ({
						id: s.sessionId,
						deviceLabel: `${s.deviceName} (${s.platform})`,
					}));
			})
			.catch(() => { /* mirror selector simply shows "no other sessions" */ });

		try {
			const url = buildSessionWsUrl(window.location, data.session.sessionId, token);
			ws = createSessionWs(url);
			const unsub = ws.frames.subscribe((arr) => (frames = arr));
			return () => unsub();
		} catch (err: unknown) {
			connectionError = err instanceof Error ? err.message : 'Failed to open WS';
		}
	});

	async function fanOutAction(action:
		| { type: 'tap'; touch: { x: number; y: number } }
		| { type: 'text'; text: string }
		| { type: 'key'; event: { key: string; modifiers?: string[] } }): Promise<void> {
		if (mirrorIds.length === 0) return;
		const token = getApiKey() ?? '';
		try {
			const res = await fetch('/api/sessions/broadcast', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ sessionIds: mirrorIds, action }),
			});
			if (!res.ok) {
				console.warn('broadcast endpoint returned', res.status);
				return;
			}
			const body = (await res.json()) as { results: Array<{ sessionId: string; ok: boolean; error?: string }> };
			const now = Date.now();
			mirrorResults = [
				...body.results.map((r) => ({ ...r, at: now })),
				...mirrorResults,
			].slice(0, 8);
			// Auto-clear after 3s.
			setTimeout(() => {
				mirrorResults = mirrorResults.filter((r) => Date.now() - r.at < 3000);
			}, 3100);
		} catch (err) {
			console.error('mirror broadcast failed', err);
		}
	}

	onDestroy(() => {
		ws?.close();
		ws = null;
	});

	async function handleCanvasClick(ev: MouseEvent) {
		if (!ws || !canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const { x, y } = canvasClickToDeviceCoords({
			rect,
			clientX: ev.clientX,
			clientY: ev.clientY,
			deviceWidth,
			deviceHeight,
		});
		try {
			await ws.send({ type: 'tap', x, y });
		} catch (err: unknown) {
			console.error('tap failed', err);
		}
		// Phase 37 Plan 37-04 — also fan-out to mirror targets if any.
		// Normalize px coords to 0..1 range for the broadcast endpoint.
		void fanOutAction({
			type: 'tap',
			touch: {
				x: Math.min(1, Math.max(0, x / deviceWidth)),
				y: Math.min(1, Math.max(0, y / deviceHeight)),
			},
		});
	}

	async function handleTypeKey(ev: KeyboardEvent) {
		if (ev.key !== 'Enter' || ev.shiftKey || !ws || !typeText) return;
		ev.preventDefault();
		const text = typeText;
		typeText = '';
		try {
			await ws.send({ type: 'type', text });
		} catch (err: unknown) {
			console.error('type failed', err);
		}
		void fanOutAction({ type: 'text', text });
	}

	function formatFrame(f: SessionFrame): string {
		if (f.type === 'ack') {
			const dur = typeof f.durationMs === 'number' ? `${f.durationMs}ms` : '';
			return `ack ${f.forMsgId ?? ''} ${dur}`.trim();
		}
		if (f.type === 'error') return `error ${f.code ?? ''}: ${f.message ?? ''}`.trim();
		if (f.type === 'event') return `event ${f.kind ?? ''}`.trim();
		if (f.type === 'pong') return `pong ${f.forMsgId ?? ''}`.trim();
		return f.type;
	}
</script>

<svelte:head><title>Session {data.session.sessionId} — Device Farm</title></svelte:head>

<div class="space-y-4">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-2xl font-semibold">Session</h1>
			<p class="text-xs text-gray-500 font-mono">{data.session.sessionId}</p>
		</div>
		<a href="/sessions" class="text-blue-600 hover:underline text-sm">&larr; Back to sessions</a>
	</header>

	{#if connectionError}
		<div class="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded">
			{connectionError}
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
		<!-- Live preview + click overlay -->
		<div class="lg:col-span-2 space-y-2">
			<div class="text-xs text-gray-500">
				Device: <span class="font-mono">{data.session.deviceName}</span> ({data.session.platform})
			</div>
			<div class="relative bg-black aspect-[9/16] max-h-[70vh] mx-auto" style="aspect-ratio: {deviceWidth} / {deviceHeight};">
				<!-- TODO: pipe scrcpy H.264 into <video> via existing device preview WS
				     (/ws/devices/:deviceId/preview from server/streaming/plugin.ts).
				     Deferred — the WebCodecs pipeline is non-trivial and orthogonal
				     to the click-to-tap overlay surface this plan ships. The overlay
				     works against a blank canvas of known dimensions. -->
				<video bind:this={videoEl} class="absolute inset-0 w-full h-full" muted playsinline></video>
				<canvas
					bind:this={canvasEl}
					class="absolute inset-0 w-full h-full cursor-crosshair"
					width={deviceWidth}
					height={deviceHeight}
					onclick={handleCanvasClick}
					data-testid="session-canvas"
				></canvas>
			</div>
			<div>
				<label for="type-input" class="text-xs text-gray-500">Type text (press Enter to send)</label>
				<textarea
					id="type-input"
					bind:value={typeText}
					onkeydown={handleTypeKey}
					placeholder="Type and press Enter…"
					rows="2"
					class="mt-1 w-full border rounded p-2 text-sm font-mono"
					data-testid="session-type-input"
				></textarea>
			</div>

			<!-- Phase 37 Plan 37-04 Wave 1 Track D — MirrorTargetSelector. -->
			<MirrorTargetSelector
				sessions={otherSessions}
				selectedIds={mirrorIds}
				onChange={(ids) => (mirrorIds = ids)}
			/>
			{#if mirrorResults.length > 0}
				<ul class="text-xs space-y-1" data-testid="mirror-results">
					{#each mirrorResults as r (r.sessionId + r.at)}
						<li class="font-mono {r.ok ? 'text-green-700' : 'text-red-700'}">
							{r.ok ? 'ok' : 'err'} → {r.sessionId.slice(0, 8)}{r.error ? ` — ${r.error}` : ''}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Action history feed -->
		<aside class="lg:col-span-1 border rounded p-2 overflow-y-auto max-h-[80vh]">
			<h2 class="text-sm font-semibold mb-2 border-b pb-1">Action history</h2>
			{#if frames.length === 0}
				<p class="text-xs text-gray-500">No frames yet.</p>
			{:else}
				<ul class="text-xs font-mono space-y-1">
					{#each frames as frame, i (i)}
						<li class="border-b py-1 break-words">
							<span class="text-gray-500">{new Date(frame._at).toLocaleTimeString()}</span>
							<span class={frame.type === 'error' ? 'ml-2 text-red-600' : frame.type === 'ack' ? 'ml-2 text-blue-600' : 'ml-2'}>
								{formatFrame(frame)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</div>
</div>
