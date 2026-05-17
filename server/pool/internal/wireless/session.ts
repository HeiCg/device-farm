/**
 * Phase 36 / Plan 36-02 — Pairing session state machine (PAIR-WIRELESS).
 *
 * Orchestrates the full wireless pairing sequence:
 *
 *   awaiting-scan → (mDNS up) → pairing → (adb pair ok)
 *     → connecting → (mDNS connect up + adb connect ok) → done
 *
 *   With terminal sinks:
 *     → error (auth/cross-subnet/cancel/unknown)
 *     → expired (60s TTL elapsed)
 *
 * Per RESEARCH:
 *   - 60s TTL strictly enforced via setTimeout
 *   - Cross-subnet rejection happens in mDNS layer; surface as pair.attempted
 *     outcome=cross-subnet
 *   - Connect browser is started FIRST (Pitfall 2 — connect service may
 *     advertise faster than we can subscribe post-pair)
 *   - On shutdown, all sessions are cancelled to stop mDNS browsers
 *     (Pitfall 5 — bonjour ghost services).
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type pino from 'pino';
import { browseForPairing, browseForConnect, type BrowserHandle } from './mdns.js';
import { adbPair } from './pair.js';
import { adbConnect } from './connect.js';
import { buildPairingQr } from './qr.js';
import type { PoolEmitters } from '../../events.js';

export type PairingSessionState =
  | 'awaiting-scan'
  | 'pairing'
  | 'connecting'
  | 'done'
  | 'expired'
  | 'error';

export interface PairingSession {
  id: string;
  state: PairingSessionState;
  instance: string;
  pin: string;
  qrDataUrl: string;
  /** ms since epoch — Date.now() + 60_000 at start. */
  expiresAt: number;
  /** Subscribe to state-change events (for WS streaming). */
  on(event: 'state-change', handler: (snapshot: PairingSession) => void): () => void;
  cancel(): void;
}

export interface PairingServiceDeps {
  emit: Pick<PoolEmitters, 'pairAttempted'>;
  logger: pino.Logger;
  actor?: string;
}

export interface PairingService {
  start(): Promise<PairingSession>;
  get(sessionId: string): PairingSession | null;
  cancel(sessionId: string): void;
  shutdownAll(): void;
}

interface SessionInternals {
  id: string;
  state: PairingSessionState;
  instance: string;
  pin: string;
  qrDataUrl: string;
  expiresAt: number;
  pairingBrowser: BrowserHandle | null;
  connectBrowser: BrowserHandle | null;
  ttlTimer: NodeJS.Timeout | null;
  emitter: EventEmitter;
  pairedGuid: string | null;
  pairedHost: string | null;
  pairedPort: number | null;
  terminalEmitted: boolean;
}

const PAIR_AGGREGATE = randomUUID(); // unused placeholder; sessionId becomes aggregateId

const TTL_MS = 60_000;

export function createPairingService(deps: PairingServiceDeps): PairingService {
  void PAIR_AGGREGATE;
  const { emit, logger, actor = 'system' } = deps;
  const sessions = new Map<string, SessionInternals>();

  function snapshot(internal: SessionInternals): PairingSession {
    return {
      id: internal.id,
      state: internal.state,
      instance: internal.instance,
      pin: internal.pin,
      qrDataUrl: internal.qrDataUrl,
      expiresAt: internal.expiresAt,
      on: (event, handler) => {
        if (event !== 'state-change') return () => { /* noop */ };
        const inner = (s: PairingSession): void => handler(s);
        internal.emitter.on('state-change', inner);
        return () => internal.emitter.off('state-change', inner);
      },
      cancel: () => cancel(internal.id),
    };
  }

  function transition(internal: SessionInternals, next: PairingSessionState): void {
    if (internal.state === next) return;
    internal.state = next;
    internal.emitter.emit('state-change', snapshot(internal));
  }

  function teardown(internal: SessionInternals): void {
    try { internal.pairingBrowser?.stop(); } catch { /* ignore */ }
    try { internal.connectBrowser?.stop(); } catch { /* ignore */ }
    internal.pairingBrowser = null;
    internal.connectBrowser = null;
    if (internal.ttlTimer) {
      clearTimeout(internal.ttlTimer);
      internal.ttlTimer = null;
    }
  }

  function emitTerminal(
    internal: SessionInternals,
    outcome: 'success' | 'auth-fail' | 'timeout' | 'cross-subnet' | 'unknown',
    host: string,
    port: number,
  ): void {
    if (internal.terminalEmitted) return;
    internal.terminalEmitted = true;
    try {
      emit.pairAttempted(internal.id, {
        sessionId: internal.id,
        host,
        port,
        outcome,
        actor,
      });
    } catch (err) {
      logger.warn({ err, sessionId: internal.id }, 'pair.attempted emit failed');
    }
  }

  function cancel(id: string): void {
    const internal = sessions.get(id);
    if (!internal) return;
    teardown(internal);
    if (internal.state !== 'done' && internal.state !== 'expired' && internal.state !== 'error') {
      transition(internal, 'error');
    }
    emitTerminal(
      internal,
      'unknown',
      internal.pairedHost ?? '0.0.0.0',
      internal.pairedPort ?? 0,
    );
  }

  function expire(internal: SessionInternals): void {
    if (internal.state === 'done' || internal.state === 'error' || internal.state === 'expired') {
      return;
    }
    teardown(internal);
    transition(internal, 'expired');
    emitTerminal(internal, 'timeout', internal.pairedHost ?? '0.0.0.0', internal.pairedPort ?? 0);
  }

  async function handlePairingFound(internal: SessionInternals, host: string, port: number): Promise<void> {
    if (internal.state !== 'awaiting-scan') return;
    transition(internal, 'pairing');
    try {
      const result = await adbPair(host, port, internal.pin);
      if (!result.ok) {
        teardown(internal);
        transition(internal, 'error');
        const outcomeMap = {
          auth: 'auth-fail' as const,
          timeout: 'timeout' as const,
          resolve: 'unknown' as const,
          unknown: 'unknown' as const,
        };
        emitTerminal(internal, outcomeMap[result.reason], host, port);
        return;
      }
      internal.pairedGuid = result.guid;
      internal.pairedHost = result.host;
      internal.pairedPort = result.port;
      // Stop the pairing browser (we have what we need); keep connect
      // browser running (started up-front per Pitfall 2).
      try { internal.pairingBrowser?.stop(); } catch { /* ignore */ }
      internal.pairingBrowser = null;
      transition(internal, 'connecting');
    } catch (err) {
      logger.warn({ err, sessionId: internal.id }, 'adb pair threw unexpectedly');
      teardown(internal);
      transition(internal, 'error');
      emitTerminal(internal, 'unknown', host, port);
    }
  }

  async function handleConnectFound(internal: SessionInternals, host: string, port: number): Promise<void> {
    if (internal.state !== 'connecting') return;
    try {
      const result = await adbConnect(host, port);
      if (!result.ok) {
        teardown(internal);
        transition(internal, 'error');
        emitTerminal(internal, 'unknown', host, port);
        return;
      }
      teardown(internal);
      transition(internal, 'done');
      emitTerminal(internal, 'success', result.host, result.port);
    } catch (err) {
      logger.warn({ err, sessionId: internal.id }, 'adb connect threw unexpectedly');
      teardown(internal);
      transition(internal, 'error');
      emitTerminal(internal, 'unknown', host, port);
    }
  }

  function handlePairingError(internal: SessionInternals, err: Error): void {
    const isCrossSubnet = /cross-subnet/i.test(err.message);
    teardown(internal);
    transition(internal, 'error');
    emitTerminal(
      internal,
      isCrossSubnet ? 'cross-subnet' : 'unknown',
      internal.pairedHost ?? '0.0.0.0',
      internal.pairedPort ?? 0,
    );
  }

  return {
    async start(): Promise<PairingSession> {
      const qr = await buildPairingQr();
      const id = randomUUID();
      const expiresAt = Date.now() + TTL_MS;

      const internal: SessionInternals = {
        id,
        state: 'awaiting-scan',
        instance: qr.instance,
        pin: qr.pin,
        qrDataUrl: qr.dataUrl,
        expiresAt,
        pairingBrowser: null,
        connectBrowser: null,
        ttlTimer: null,
        emitter: new EventEmitter(),
        pairedGuid: null,
        pairedHost: null,
        pairedPort: null,
        terminalEmitted: false,
      };
      sessions.set(id, internal);

      // Pitfall 2 — start CONNECT browser FIRST (the connect service may
      // advertise faster than we subscribe post-pair).
      internal.connectBrowser = browseForConnect(
        qr.instance,
        (host, port) => { void handleConnectFound(internal, host, port); },
        (err) => { handlePairingError(internal, err); },
      );

      internal.pairingBrowser = browseForPairing(
        qr.instance,
        (host, port) => { void handlePairingFound(internal, host, port); },
        (err) => { handlePairingError(internal, err); },
      );

      internal.ttlTimer = setTimeout(() => expire(internal), TTL_MS);

      return snapshot(internal);
    },

    get(sessionId: string): PairingSession | null {
      const internal = sessions.get(sessionId);
      return internal ? snapshot(internal) : null;
    },

    cancel,

    shutdownAll(): void {
      for (const id of sessions.keys()) {
        cancel(id);
      }
    },
  };
}
