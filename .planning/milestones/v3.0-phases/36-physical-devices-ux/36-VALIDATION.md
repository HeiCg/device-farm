---
phase: 36
slug: physical-devices-ux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 36 — Validation Strategy

> Three tracks: discovery service, wireless pairing, command palette. Vitest for server + web.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | Vitest (server pool + web component tests) |
| **Config files** | `server/pool/internal/discovery/__tests__/` (Wave 0 installs) · `server/pool/internal/wireless/__tests__/` (Wave 0 installs) · `web/src/lib/cmd-palette/__tests__/` (Wave 0 installs) |
| **Quick run** | `npx vitest run server/pool/internal/discovery server/pool/internal/wireless` |
| **Web run** | `cd web && npx vitest run lib/cmd-palette` |
| **Full suite** | `npm test` |
| **Estimated runtime** | ~40s server · ~20s web |

---

## Sampling Rate

- **After every task commit:** Quick run of touched surface
- **After every wave:** Full server + web vitest run
- **Before phase verify:** Full suite + real Pixel pairing smoke (manual) + ⌘K UX walkthrough (manual)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 36-T1 | 01 | 1 | DISC-SVC | unit | `npx vitest run server/pool/internal/discovery/__tests__/service.spec` | ❌ W0 | ⬜ pending |
| 36-T2 | 02 | 2 | PAIR-WIRELESS | unit + mock | `npx vitest run server/pool/internal/wireless/__tests__/pairing.spec` | ❌ W0 | ⬜ pending |
| 36-T3 | 02 | 2 | PHYS-ANDROID-DRIVER | unit | `npx vitest run server/pool/internal/drivers/physical-android.spec` | ❌ W0 | ⬜ pending |
| 36-T4 | 03 | 3 | PAIR-WIZARD-UI | unit | `cd web && npx vitest run routes/devices/pair` | ❌ W0 | ⬜ pending |
| 36-T5 | 02 | 2 | CMD-PALETTE | unit | `cd web && npx vitest run lib/cmd-palette` | ❌ W0 | ⬜ pending |
| 36-T6 | 02 | 2 | DISC-WS | unit | `npx vitest run server/pool/__tests__/discovery-ws.spec` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `server/pool/internal/discovery/` — module scaffold
- [ ] `server/pool/internal/wireless/` — pairing service scaffold
- [ ] `server/pool/internal/drivers/physical-android/` — driver scaffold
- [ ] `web/src/lib/cmd-palette/` — palette component scaffold + 1 Svelte test stub
- [ ] `web/src/routes/devices/pair/+page.svelte` — wizard stub
- [ ] Vitest spec stubs for all 6 task verifications
- [ ] npm deps added: `bonjour-service`, `qrcode`, `fuzzysort` (lockfile updated)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Pixel 8 with "Wireless debugging" enabled pairs within 5s | PAIR-WIRELESS | Requires physical device | Open wizard, enable wireless debugging on Pixel, scan QR, observe device join pool |
| ⌘K opens palette + keyboard nav works | CMD-PALETTE | Requires browser | Press ⌘K, type "go to jobs", press Enter, verify navigation |
| `devices-changed` events fan out to UI in < 1s of plug/unplug | DISC-SVC | Requires real ADB | Plug device, observe live list update |
| v2.0 deviceName fix shown on CLI | DISC-SVC | Requires deviceName field flowing through pipeline | `device-farm devices` shows readable names instead of UUIDs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` once Wave 0 lands

**Approval:** pending
