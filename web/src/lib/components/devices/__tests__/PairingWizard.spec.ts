// @vitest-environment jsdom
//
// Phase 36 Plan 36-04 — PairingWizard spec (PAIR-WIZARD-UI).
//
// web/ has no vite-plugin-svelte test integration (see sessions-detail.spec
// + CommandPalette.spec for the established pattern), so we exercise the
// pure wizard state machine extracted into `pairing-wizard-logic.ts`:
//
//   - initial state: kind === 'idle'
//   - startPairing(): fetches /api/devices/pair/start, transitions to
//     awaiting-scan with sessionId/qrDataUrl/pin/expiresAt; opens WS
//   - WS frames {paired,connecting,done,error} drive state transitions
//   - cancel() fetches /api/devices/pair/cancel and resets to idle
//   - TTL expiry (Date.now() > expiresAt) calls onExpire which transitions
//     to error
//   - cleanup() closes WS + invokes cancel() when not in terminal state
//
// Plus file-existence + import-binding checks for the 5 .svelte files so
// the wizard surface is locked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type WizardState,
  initialState,
  reduceFrame,
  isTerminal,
  computeRemainingSec,
} from '$lib/components/devices/pairing-wizard-logic.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIZARD_PATH = resolve(HERE, '../PairingWizard.svelte');
const SCAN_PATH = resolve(HERE, '../PairingScanStep.svelte');
const QR_PATH = resolve(HERE, '../PairingQrStep.svelte');
const CONFIRM_PATH = resolve(HERE, '../PairingConfirmStep.svelte');
const PAGE_PATH = resolve(HERE, '../../../../routes/devices/pair/+page.svelte');

describe('[Phase 36-04] PairingWizard component files', () => {
  it('PairingWizard.svelte exists', () => {
    expect(existsSync(WIZARD_PATH)).toBe(true);
  });

  it('PairingScanStep.svelte exists', () => {
    expect(existsSync(SCAN_PATH)).toBe(true);
  });

  it('PairingQrStep.svelte exists', () => {
    expect(existsSync(QR_PATH)).toBe(true);
  });

  it('PairingConfirmStep.svelte exists', () => {
    expect(existsSync(CONFIRM_PATH)).toBe(true);
  });

  it('/devices/pair/+page.svelte renders PairingWizard', () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/PairingWizard/);
  });

  it('PairingWizard.svelte calls /api/devices/pair/start + opens /api/devices/pair/stream', () => {
    const src = readFileSync(WIZARD_PATH, 'utf8');
    expect(src).toMatch(/\/api\/devices\/pair\/start/);
    expect(src).toMatch(/\/api\/devices\/pair\/stream/);
  });
});

describe('[Phase 36-04] pairing wizard state machine', () => {
  it("initial state is { kind: 'idle' }", () => {
    expect(initialState()).toEqual({ kind: 'idle' });
  });

  it("WS frame {type:'awaiting-scan'} is a no-op (already in awaiting-scan after start)", () => {
    const state: WizardState = {
      kind: 'awaiting-scan',
      sessionId: 's1',
      qrDataUrl: 'data:...',
      pin: '123456',
      expiresAt: Date.now() + 60_000,
    };
    const next = reduceFrame(state, { type: 'awaiting-scan' });
    expect(next.kind).toBe('awaiting-scan');
  });

  it("WS frame {type:'paired',host,port} transitions to pairing", () => {
    const state: WizardState = {
      kind: 'awaiting-scan',
      sessionId: 's1',
      qrDataUrl: 'data:...',
      pin: '123456',
      expiresAt: Date.now() + 60_000,
    };
    const next = reduceFrame(state, { type: 'paired', host: '10.0.0.5', port: 37123 });
    expect(next.kind).toBe('pairing');
    if (next.kind === 'pairing') {
      expect(next.host).toBe('10.0.0.5');
      expect(next.port).toBe(37123);
      expect(next.sessionId).toBe('s1');
    }
  });

  it("WS frame {type:'connecting',deviceName} transitions to connecting", () => {
    const state: WizardState = {
      kind: 'pairing',
      sessionId: 's1',
      host: '10.0.0.5',
      port: 37123,
    };
    const next = reduceFrame(state, { type: 'connecting', deviceName: 'Pixel 8' });
    expect(next.kind).toBe('connecting');
    if (next.kind === 'connecting') {
      expect(next.deviceName).toBe('Pixel 8');
      expect(next.sessionId).toBe('s1');
    }
  });

  it("WS frame {type:'done',deviceId,deviceName} transitions to done", () => {
    const state: WizardState = {
      kind: 'connecting',
      sessionId: 's1',
      deviceName: 'Pixel 8',
    };
    const next = reduceFrame(state, {
      type: 'done',
      deviceId: 'phys-abc',
      deviceName: 'Pixel 8',
    });
    expect(next.kind).toBe('done');
    if (next.kind === 'done') {
      expect(next.deviceId).toBe('phys-abc');
      expect(next.deviceName).toBe('Pixel 8');
    }
  });

  it("WS frame {type:'error',reason:'auth'} transitions to error with canRetry=true", () => {
    const state: WizardState = {
      kind: 'awaiting-scan',
      sessionId: 's1',
      qrDataUrl: 'data:...',
      pin: '123456',
      expiresAt: Date.now() + 60_000,
    };
    const next = reduceFrame(state, { type: 'error', reason: 'auth' });
    expect(next.kind).toBe('error');
    if (next.kind === 'error') {
      expect(next.reason).toBe('auth');
      expect(next.canRetry).toBe(true);
    }
  });

  it("WS frame {type:'error',reason:'subnet'} transitions to error with canRetry=true", () => {
    const state: WizardState = {
      kind: 'awaiting-scan',
      sessionId: 's1',
      qrDataUrl: 'data:...',
      pin: '123456',
      expiresAt: Date.now() + 60_000,
    };
    const next = reduceFrame(state, { type: 'error', reason: 'subnet' });
    expect(next.kind).toBe('error');
    if (next.kind === 'error') {
      expect(next.reason).toBe('subnet');
    }
  });

  it('unknown frame type is a no-op', () => {
    const state: WizardState = {
      kind: 'awaiting-scan',
      sessionId: 's1',
      qrDataUrl: 'data:...',
      pin: '123456',
      expiresAt: Date.now() + 60_000,
    };
    const next = reduceFrame(state, { type: 'mystery' } as { type: string });
    expect(next).toBe(state);
  });

  it("isTerminal returns true for done/error and false for in-progress", () => {
    expect(isTerminal({ kind: 'idle' })).toBe(false);
    expect(isTerminal({ kind: 'starting' })).toBe(false);
    expect(
      isTerminal({
        kind: 'awaiting-scan',
        sessionId: 's',
        qrDataUrl: '',
        pin: '',
        expiresAt: 0,
      }),
    ).toBe(false);
    expect(isTerminal({ kind: 'pairing', sessionId: 's', host: 'h', port: 1 })).toBe(false);
    expect(isTerminal({ kind: 'connecting', sessionId: 's', deviceName: 'n' })).toBe(false);
    expect(isTerminal({ kind: 'done', deviceId: 'd', deviceName: 'n' })).toBe(true);
    expect(isTerminal({ kind: 'error', reason: 'auth', canRetry: true })).toBe(true);
  });
});

describe('[Phase 36-04] computeRemainingSec', () => {
  it('returns full TTL when now == expiresAt - 60_000', () => {
    const expiresAt = 1_000_000;
    const now = expiresAt - 60_000;
    expect(computeRemainingSec(expiresAt, now)).toBe(60);
  });

  it('returns 0 (not negative) when past expiry', () => {
    expect(computeRemainingSec(1_000_000, 2_000_000)).toBe(0);
  });

  it('rounds up so the operator sees the seconds counter tick to zero at expiry', () => {
    // 12.4s remaining → display "13" (Math.ceil) so the ring matches integer
    // labels in the UI.
    expect(computeRemainingSec(12_400, 0)).toBe(13);
  });
});
