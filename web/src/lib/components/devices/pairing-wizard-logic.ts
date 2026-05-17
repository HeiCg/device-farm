/**
 * Phase 36 / Plan 36-04 — PairingWizard state machine (PAIR-WIZARD-UI).
 *
 * Pure-logic module extracted from PairingWizard.svelte so the reducer,
 * terminal-check and countdown helper can be unit-tested in node without
 * vite-plugin-svelte (same pattern as palette-logic.ts in 36-03).
 *
 * The wizard is driven by a discriminated-union $state in the .svelte
 * component; this module owns the transitions.
 *
 * State graph:
 *
 *   idle → starting → awaiting-scan → pairing → connecting → done
 *                         ↓             ↓           ↓
 *                       error         error       error
 *
 * The component drives:
 *   - starting (fetch /api/devices/pair/start)
 *   - awaiting-scan (fetch resolved, WS opened)
 *
 * The server WS frames drive (via reduceFrame):
 *   - paired → pairing
 *   - connecting → connecting
 *   - done → done
 *   - error → error
 *
 * Local TTL timer (component-owned) drives:
 *   - expiresAt elapsed → error (reason='timeout')
 */

export type WizardState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | {
      kind: 'awaiting-scan';
      sessionId: string;
      qrDataUrl: string;
      pin: string;
      /** ms since epoch (Date.now() + 60_000). */
      expiresAt: number;
    }
  | { kind: 'pairing'; sessionId: string; host: string; port: number }
  | { kind: 'connecting'; sessionId: string; deviceName: string }
  | { kind: 'done'; deviceId: string; deviceName: string }
  | { kind: 'error'; reason: string; canRetry: boolean };

/**
 * Server WS frame payload shape. Mirrors the
 * envelope's `payload` field emitted by `server/api/pairing.ts` +
 * `server/pool/internal/wireless/session.ts`.
 *
 * In practice the wizard receives the envelope (`{v,ts,correlationId,
 * payload}`); the component unwraps to `payload` before calling
 * `reduceFrame`.
 */
export type WsFramePayload =
  | { type: 'awaiting-scan' }
  | { type: 'pairing' }
  | { type: 'paired'; host: string; port: number }
  | { type: 'connecting'; deviceName: string }
  | { type: 'done'; deviceId: string; deviceName: string }
  | { type: 'error'; reason: string }
  | { type: 'expired' }
  // Catch-all for server payloads carrying extra fields we don't
  // depend on (e.g. sessionId / instance / pin echo).
  | { type: string; [k: string]: unknown };

export function initialState(): WizardState {
  return { kind: 'idle' };
}

export function isTerminal(state: WizardState): boolean {
  return state.kind === 'done' || state.kind === 'error';
}

/**
 * Apply a WS frame to the current state. Pure: returns the same
 * reference when no transition fires (lets the .svelte component skip
 * unnecessary $effect re-runs if it short-circuits on identity).
 */
export function reduceFrame(state: WizardState, payload: WsFramePayload): WizardState {
  switch (payload.type) {
    case 'awaiting-scan':
    case 'pairing':
      // No-op — `awaiting-scan` is set when the wizard receives the
      // POST response; `pairing` is set when the `paired` frame
      // arrives. The server may echo state names; we ignore unless
      // they carry the discriminator data we need.
      return state;

    case 'paired': {
      const host = (payload as { host?: string }).host ?? '';
      const port = (payload as { port?: number }).port ?? 0;
      // Only transition from awaiting-scan (or pairing, idempotent).
      if (state.kind === 'awaiting-scan' || state.kind === 'pairing') {
        const sessionId =
          state.kind === 'awaiting-scan' ? state.sessionId : state.sessionId;
        return { kind: 'pairing', sessionId, host, port };
      }
      return state;
    }

    case 'connecting': {
      const deviceName = (payload as { deviceName?: string }).deviceName ?? '';
      if (state.kind === 'pairing' || state.kind === 'awaiting-scan') {
        const sessionId =
          state.kind === 'pairing' ? state.sessionId : state.sessionId;
        return { kind: 'connecting', sessionId, deviceName };
      }
      return state;
    }

    case 'done': {
      const deviceId = (payload as { deviceId?: string }).deviceId ?? '';
      const deviceName = (payload as { deviceName?: string }).deviceName ?? '';
      return { kind: 'done', deviceId, deviceName };
    }

    case 'error': {
      const reason = (payload as { reason?: string }).reason ?? 'unknown';
      return { kind: 'error', reason, canRetry: true };
    }

    case 'expired': {
      return { kind: 'error', reason: 'timeout', canRetry: true };
    }

    default:
      return state;
  }
}

/**
 * Compute remaining seconds until expiry, rounded UP so the operator
 * sees the integer tick to zero at the exact moment of expiry.
 *
 * Returns 0 when past expiry (never negative).
 */
export function computeRemainingSec(expiresAt: number, now: number = Date.now()): number {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}
