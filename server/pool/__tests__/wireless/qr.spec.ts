/**
 * Phase 36 / Plan 36-02 — Pairing QR builder tests (PAIR-WIRELESS).
 */
import { describe, expect, it } from 'vitest';
import { buildPairingQr } from '../../internal/wireless/qr.js';

describe('[Phase 36-02] pairing QR builder', () => {
  it('payload matches WIFI:T:ADB;S:devicefarm-<hex8>;P:<6digit>;;', async () => {
    const { payload, instance, pin } = await buildPairingQr();
    expect(payload).toMatch(/^WIFI:T:ADB;S:devicefarm-[0-9a-f]{8};P:[0-9]{6};;$/);
    expect(payload).toContain(instance);
    expect(payload).toContain(pin);
  });

  it('pin is exactly 6 decimal digits', async () => {
    const { pin } = await buildPairingQr();
    expect(pin).toMatch(/^[0-9]{6}$/);
  });

  it('dataUrl is a base64 PNG data URL', async () => {
    const { dataUrl } = await buildPairingQr();
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('instance is unique per call', async () => {
    const a = await buildPairingQr();
    const b = await buildPairingQr();
    expect(a.instance).not.toBe(b.instance);
  });
});
