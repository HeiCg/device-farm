/**
 * Phase 36 / Plan 36-02 — Pairing session state-machine tests (PAIR-WIRELESS).
 *
 * Mocks mdns/pair/connect/qr modules so the orchestration is observable in
 * isolation. Uses fake timers for TTL assertions.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

// ---------- Mocks ----------
const browseForPairingMock = vi.fn();
const browseForConnectMock = vi.fn();
const isOnLocalSubnetMock = vi.fn((_ip: unknown) => true);
const adbPairMock = vi.fn();
const adbConnectMock = vi.fn();
const buildPairingQrMock = vi.fn();

vi.mock('../../internal/wireless/mdns.js', () => ({
  browseForPairing: (a: unknown, b: unknown, c: unknown) => browseForPairingMock(a, b, c),
  browseForConnect: (a: unknown, b: unknown, c: unknown) => browseForConnectMock(a, b, c),
  isOnLocalSubnet: (a: unknown) => isOnLocalSubnetMock(a),
}));
vi.mock('../../internal/wireless/pair.js', () => ({
  adbPair: (a: unknown, b: unknown, c: unknown) => adbPairMock(a, b, c),
}));
vi.mock('../../internal/wireless/connect.js', () => ({
  adbConnect: (a: unknown, b: unknown) => adbConnectMock(a, b),
}));
vi.mock('../../internal/wireless/qr.js', () => ({
  buildPairingQr: () => buildPairingQrMock(),
}));

import { createPairingService } from '../../internal/wireless/session.js';

type EmitCapture = { sessionId: string; payload: Record<string, unknown> };
function makeEmit(captured: EmitCapture[]): {
  pairAttempted: (id: string, p: Record<string, unknown>) => unknown;
} {
  return {
    pairAttempted: (id: string, payload: Record<string, unknown>) => {
      captured.push({ sessionId: id, payload });
      return {};
    },
  };
}

let captured: EmitCapture[];
let pairingBrowserStops: number;
let connectBrowserStops: number;
let pairingOnFound: ((host: string, port: number) => void) | null;
let pairingOnError: ((err: Error) => void) | null;
let connectOnFound: ((host: string, port: number) => void) | null;

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  pairingBrowserStops = 0;
  connectBrowserStops = 0;
  pairingOnFound = null;
  pairingOnError = null;
  connectOnFound = null;

  buildPairingQrMock.mockResolvedValue({
    payload: 'WIFI:T:ADB;S:devicefarm-abcdef12;P:123456;;',
    dataUrl: 'data:image/png;base64,xxxx',
    instance: 'devicefarm-abcdef12',
    pin: '123456',
  });

  browseForPairingMock.mockImplementation((_instance, onFound, onError) => {
    pairingOnFound = onFound;
    pairingOnError = onError;
    return { stop: () => { pairingBrowserStops += 1; } };
  });

  browseForConnectMock.mockImplementation((_guid, onFound, _onError) => {
    connectOnFound = onFound;
    return { stop: () => { connectBrowserStops += 1; } };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function makeService() {
  const emit = makeEmit(captured) as unknown as Parameters<typeof createPairingService>[0]['emit'];
  return createPairingService({
    emit,
    logger: pino({ level: 'silent' }),
  });
}

describe('[Phase 36-02] pairing session state machine', () => {
  it('start() returns session with state="awaiting-scan" and ~60s TTL', async () => {
    const svc = makeService();
    const before = Date.now();
    const session = await svc.start();
    expect(session.state).toBe('awaiting-scan');
    expect(session.instance).toBe('devicefarm-abcdef12');
    expect(session.pin).toBe('123456');
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(session.expiresAt).toBeLessThanOrEqual(before + 61_000);
    svc.cancel(session.id);
  });

  it('transitions to "pairing" on mDNS up then "connecting" on adbPair success', async () => {
    const svc = makeService();
    adbPairMock.mockResolvedValue({ ok: true, guid: 'adb-X', host: '192.168.1.42', port: 5555 });
    const session = await svc.start();
    const states: string[] = [];
    const internal = svc.get(session.id);
    expect(internal).not.toBeNull();
    internal!.on('state-change', (s: { state: string }) => states.push(s.state));

    // Drive: pairing browser fires onFound
    await pairingOnFound!('192.168.1.42', 33861);
    // After adbPair resolves, state should have progressed past pairing
    expect(states).toContain('pairing');
    expect(states).toContain('connecting');
    svc.cancel(session.id);
  });

  it('emits pair.attempted outcome=success on full success', async () => {
    const svc = makeService();
    adbPairMock.mockResolvedValue({ ok: true, guid: 'adb-X', host: '192.168.1.42', port: 5555 });
    adbConnectMock.mockResolvedValue({ ok: true, host: '192.168.1.42', port: 5555 });
    const session = await svc.start();
    await pairingOnFound!('192.168.1.42', 33861);
    // Now drive connect browser
    await connectOnFound!('192.168.1.42', 5555);
    expect(captured.some(c => c.payload.outcome === 'success')).toBe(true);
    svc.cancel(session.id);
  });

  it('emits pair.attempted outcome="auth-fail" on adb auth failure', async () => {
    const svc = makeService();
    adbPairMock.mockResolvedValue({ ok: false, reason: 'auth', rawStderr: 'failed to authenticate' });
    const session = await svc.start();
    await pairingOnFound!('192.168.1.42', 33861);
    expect(captured.some(c => c.payload.outcome === 'auth-fail')).toBe(true);
    const updated = svc.get(session.id);
    expect(updated?.state).toBe('error');
    svc.cancel(session.id);
  });

  it('emits pair.attempted outcome="cross-subnet" when mDNS onError fires', async () => {
    const svc = makeService();
    const session = await svc.start();
    pairingOnError!(new Error('Cross-subnet pairing attempt rejected: 10.5.5.5'));
    expect(captured.some(c => c.payload.outcome === 'cross-subnet')).toBe(true);
    expect(svc.get(session.id)?.state).toBe('error');
    svc.cancel(session.id);
  });

  it('TTL expiry transitions to "expired" and emits timeout', async () => {
    vi.useFakeTimers();
    const svc = makeService();
    const session = await svc.start();
    vi.advanceTimersByTime(60_001);
    const updated = svc.get(session.id);
    expect(updated?.state).toBe('expired');
    expect(captured.some(c => c.payload.outcome === 'timeout')).toBe(true);
  });

  it('cancel() stops both browsers and marks state=error', async () => {
    const svc = makeService();
    const session = await svc.start();
    svc.cancel(session.id);
    expect(pairingBrowserStops).toBeGreaterThanOrEqual(1);
    expect(connectBrowserStops).toBeGreaterThanOrEqual(1);
    expect(svc.get(session.id)?.state).toBe('error');
  });

  it('shutdownAll() cancels every active session', async () => {
    const svc = makeService();
    const s1 = await svc.start();
    const s2 = await svc.start();
    svc.shutdownAll();
    expect(svc.get(s1.id)?.state).toBe('error');
    expect(svc.get(s2.id)?.state).toBe('error');
  });
});
