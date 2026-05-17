<!--
  Phase 36 Plan 36-04 — PairingWizard (PAIR-WIZARD-UI).

  Top-level wizard state machine + WS subscription + 3-step rendering.

  Discriminated-union state machine (see pairing-wizard-logic.ts):
    idle → starting → awaiting-scan → pairing → connecting → done
                          ↓             ↓           ↓
                        error         error       error
  + expired (TTL) routes to error reason='timeout'.

  API:
    - POST /api/devices/pair/start  → returns
      { sessionId, qrDataUrl, pin, instance, ttlSeconds:60 }
    - WS   /api/devices/pair/stream?sessionId=<id> → state-transition
      envelopes ({v,ts,correlationId,payload:{type,...}})
    - POST /api/devices/pair/cancel → 204 (called on Cancel + on
      unmount when in a non-terminal state).

  WS handling: every onmessage parse → unwrap to payload → reduceFrame
  → assign. The reducer is pure; the component owns the WS lifecycle.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import PairingScanStep from './PairingScanStep.svelte';
  import PairingQrStep from './PairingQrStep.svelte';
  import PairingConfirmStep from './PairingConfirmStep.svelte';
  import {
    type WizardState,
    type WsFramePayload,
    initialState,
    isTerminal,
    reduceFrame,
  } from './pairing-wizard-logic.js';

  interface PairStartResponse {
    sessionId: string;
    qrDataUrl: string;
    pin: string;
    instance: string;
    ttlSeconds: number;
  }

  let state = $state<WizardState>(initialState());
  let ws: WebSocket | null = null;

  function getSessionId(): string | null {
    switch (state.kind) {
      case 'awaiting-scan':
      case 'pairing':
      case 'connecting':
        return state.sessionId;
      default:
        return null;
    }
  }

  function teardownWs(): void {
    if (ws) {
      try {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
  }

  function openStream(sessionId: string): void {
    teardownWs();
    if (typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/devices/pair/stream?sessionId=${encodeURIComponent(sessionId)}`;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      state = { kind: 'error', reason: 'ws-failed', canRetry: true };
      return;
    }
    ws.onmessage = (ev: MessageEvent): void => {
      try {
        const env = JSON.parse(ev.data) as { payload?: WsFramePayload };
        const payload = env?.payload;
        if (!payload || typeof payload !== 'object' || !('type' in payload)) return;
        const next = reduceFrame(state, payload);
        if (next !== state) {
          state = next;
          if (isTerminal(next)) teardownWs();
        }
      } catch {
        // Drop malformed frames.
      }
    };
    ws.onerror = (): void => {
      // onclose will follow; let it handle the state.
    };
    ws.onclose = (): void => {
      ws = null;
      // If the server hung up before a terminal state, treat as error.
      if (
        state.kind === 'awaiting-scan' ||
        state.kind === 'pairing' ||
        state.kind === 'connecting'
      ) {
        state = { kind: 'error', reason: 'connection-lost', canRetry: true };
      }
    };
  }

  async function startPairing(): Promise<void> {
    state = { kind: 'starting' };
    try {
      const res = await fetch('/api/devices/pair/start', { method: 'POST' });
      if (!res.ok) {
        state = { kind: 'error', reason: `start-failed (${res.status})`, canRetry: true };
        return;
      }
      const body = (await res.json()) as PairStartResponse;
      const ttlMs = (body.ttlSeconds ?? 60) * 1000;
      state = {
        kind: 'awaiting-scan',
        sessionId: body.sessionId,
        qrDataUrl: body.qrDataUrl,
        pin: body.pin,
        expiresAt: Date.now() + ttlMs,
      };
      openStream(body.sessionId);
    } catch (err) {
      state = { kind: 'error', reason: 'start-failed', canRetry: true };
    }
  }

  async function cancel(): Promise<void> {
    const sessionId = getSessionId();
    teardownWs();
    if (sessionId) {
      try {
        await fetch('/api/devices/pair/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      } catch {
        // best-effort; we're going back to idle either way.
      }
    }
    state = initialState();
  }

  function onExpire(): void {
    // Local TTL fired before any server frame arrived. Treat as timeout error.
    const sessionId = getSessionId();
    teardownWs();
    state = { kind: 'error', reason: 'timeout', canRetry: true };
    if (sessionId) {
      // Fire-and-forget — server's own TTL will also fire.
      fetch('/api/devices/pair/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {
        // ignore
      });
    }
  }

  function retry(): void {
    state = initialState();
  }

  onMount(() => {
    return () => {
      // Component unmount: cancel any in-flight session + close WS.
      const sessionId = getSessionId();
      teardownWs();
      if (sessionId) {
        fetch('/api/devices/pair/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        }).catch(() => {
          // ignore
        });
      }
    };
  });
</script>

<div class="bg-surface-container p-6 rounded-xl border border-outline-variant/20">
  {#if state.kind === 'idle'}
    <PairingScanStep onStart={startPairing} />
  {:else if state.kind === 'starting'}
    <PairingScanStep onStart={startPairing} disabled={true} />
  {:else if state.kind === 'awaiting-scan'}
    <PairingQrStep
      qrDataUrl={state.qrDataUrl}
      pin={state.pin}
      expiresAt={state.expiresAt}
      onCancel={cancel}
      {onExpire}
    />
  {:else if state.kind === 'pairing'}
    <div class="flex flex-col gap-3 max-w-xl">
      <h2 class="text-lg font-medium text-on-surface">Pairing…</h2>
      <p class="text-sm text-on-surface-variant">
        Authenticating with the phone at <span class="font-mono">{state.host}:{state.port}</span>.
      </p>
      <div class="h-1 w-full bg-surface-container-low rounded-full overflow-hidden">
        <div class="h-full w-1/2 bg-primary/60 rounded-full animate-pulse"></div>
      </div>
    </div>
  {:else if state.kind === 'connecting'}
    <div class="flex flex-col gap-3 max-w-xl">
      <h2 class="text-lg font-medium text-on-surface">Connecting…</h2>
      <p class="text-sm text-on-surface-variant">
        Establishing adb connection to <strong>{state.deviceName || 'device'}</strong>.
      </p>
      <div class="h-1 w-full bg-surface-container-low rounded-full overflow-hidden">
        <div class="h-full w-3/4 bg-primary/60 rounded-full animate-pulse"></div>
      </div>
    </div>
  {:else if state.kind === 'done'}
    <PairingConfirmStep
      deviceName={state.deviceName}
      deviceId={state.deviceId}
      onDone={retry}
    />
  {:else if state.kind === 'error'}
    <div class="flex flex-col gap-4 max-w-xl">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-3xl text-tertiary">error</span>
        <h2 class="text-lg font-medium text-on-surface">Pairing failed</h2>
      </div>
      <p class="text-sm text-on-surface-variant">
        {#if state.reason === 'timeout'}
          The QR code expired before your phone scanned it. Try again — you'll have 60 seconds.
        {:else if state.reason === 'auth'}
          The phone rejected the pairing PIN. The QR code may have been generated for a previous attempt — try again.
        {:else if state.reason === 'subnet'}
          The phone is on a different subnet from this server. Make sure both are on the same Wi-Fi network (no VPN, no guest VLAN).
        {:else if state.reason === 'connection-lost'}
          Lost connection to the pairing server. Check that the device-farm server is still running, then retry.
        {:else}
          Reason: <span class="font-mono">{state.reason}</span>
        {/if}
      </p>
      {#if state.canRetry}
        <div>
          <button
            onclick={retry}
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span class="material-symbols-outlined text-base">refresh</span>
            Try again
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
