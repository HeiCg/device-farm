/**
 * Phase 36 / Plan 36-02 — Wireless module internal barrel (PAIR-WIRELESS).
 *
 * Re-exports the public wireless surface for consumers inside
 * server/pool/internal/ (specifically server/pool/internal/module.ts).
 * External consumers must go through server/pool/index.ts per MOD-02
 * (dep-cruiser rule 4 `no-deep-imports-into-pool-internal`).
 */
export {
  browseForPairing,
  browseForConnect,
  isOnLocalSubnet,
  type BrowserHandle,
} from './mdns.js';
export { adbPair, type PairResult } from './pair.js';
export { adbConnect, type ConnectResult } from './connect.js';
export { buildPairingQr, type PairingQrPayload } from './qr.js';
export {
  createPairingService,
  type PairingService,
  type PairingServiceDeps,
  type PairingSession,
  type PairingSessionState,
} from './session.js';
