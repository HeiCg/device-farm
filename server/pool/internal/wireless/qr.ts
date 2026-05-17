/**
 * Phase 36 / Plan 36-02 — Pairing QR payload builder (PAIR-WIRELESS).
 *
 * Generates a fresh pairing payload:
 *   - 6-digit numeric pin (crypto.randomInt — uniform distribution)
 *   - instance name `devicefarm-<hex8>` (crypto.randomBytes(4))
 *   - payload `WIFI:T:ADB;S:<instance>;P:<pin>;;` (Android Studio recognises
 *     this Wi-Fi QR format for "Pair device using Wi-Fi")
 *   - PNG data URL via qrcode (errorCorrectionLevel: 'M', margin: 1)
 */
import { randomBytes, randomInt } from 'node:crypto';
import QRCode from 'qrcode';

export interface PairingQrPayload {
  /** Raw QR text content: `WIFI:T:ADB;S:<instance>;P:<pin>;;`. */
  payload: string;
  /** PNG render: `data:image/png;base64,<...>`. */
  dataUrl: string;
  /** Bonjour service instance name (used by mdns.browseForPairing). */
  instance: string;
  /** 6-digit numeric pin. */
  pin: string;
}

export async function buildPairingQr(): Promise<PairingQrPayload> {
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const instance = `devicefarm-${randomBytes(4).toString('hex')}`;
  const payload = `WIFI:T:ADB;S:${instance};P:${pin};;`;
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
  });
  return { payload, dataUrl, instance, pin };
}
