---
phase: 20
slug: pool-module-devices
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run server/pool/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~35 seconds (pool slice) / ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/pool/__tests__/`
- **After every plan wave:** Run `npm test` (full suite) + `npm run lint` + `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite green + dep-check clean + Nyquist delta ≤ −2pp
- **Max feedback latency:** 35 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-00-01 | 00 | 0 | substrate | unit | `npx vitest run server/pool/__tests__/events.spec.ts` | ❌ W0 | ⬜ pending |
| 20-00-02 | 00 | 0 | substrate | code-inspection | `grep -E 'DEVICE_(BOOT|REAP)' server/queue/names.ts` | ❌ W0 | ⬜ pending |
| 20-00-03 | 00 | 0 | substrate | code-inspection | `grep -E 'server/pool/internal' .dependency-cruiser.cjs` | ❌ W0 | ⬜ pending |
| 20-01-01 | 01 | 1 | SC1 events.ts | unit | `npx vitest run server/pool/__tests__/events.spec.ts` | ✅ W0 | ⬜ pending |
| 20-01-02 | 01 | 1 | SC1 registry | unit | `grep -E 'poolRegistry|POOL_EVENT_NAMES' server/pool/events.ts` | ✅ W0 | ⬜ pending |
| 20-02-01 | 02 | 2 | SC1 pool-manager emits | unit | `npx vitest run server/pool/__tests__/pool-manager.spec.ts` | ✅ W0 | ⬜ pending |
| 20-02-02 | 02 | 2 | SC1 device.transition | unit | `npx vitest run server/pool/__tests__/device.spec.ts` | ✅ W0 | ⬜ pending |
| 20-02-03 | 02 | 2 | SC1 health-checker emits | unit | `npx vitest run server/pool/__tests__/health-checker.spec.ts` | ✅ W0 | ⬜ pending |
| 20-03-01 | 03 | 3 | SC3 factory | unit | `npx vitest run server/pool/__tests__/module.spec.ts` | ✅ W0 | ⬜ pending |
| 20-03-02 | 03 | 3 | SC2 plugin rewire | unit | `grep -vE 'healthChecker\\.start\\|Process reaper started' server/index.ts` | ✅ W0 | ⬜ pending |
| 20-03-03 | 03 | 3 | SC3 queue.ts | unit | `grep -E 'registerPoolQueues|DEVICE_REAP' server/pool/queue.ts` | ✅ W0 | ⬜ pending |
| 20-04-01 | 04 | 4 | SC1+SC4 DB-gated | integration | `DATABASE_URL=$TEST_DATABASE_URL npx vitest run server/pool/__tests__/subscriber.spec.ts` | ✅ W0 | ⬜ pending |
| 20-04-02 | 04 | 4 | SC4 correlation | integration | `DATABASE_URL=$TEST_DATABASE_URL npx vitest run server/pool/__tests__/correlation.spec.ts` | ✅ W0 | ⬜ pending |
| 20-05-01 | 05 | 5 | MOD-01 MODULE.md | code-inspection | `test -f server/pool/MODULE.md && wc -l server/pool/MODULE.md` | ❌ W0 | ⬜ pending |
| 20-05-02 | 05 | 5 | MOD-02 barrel | code-inspection | `grep -E '^export ' server/pool/index.ts \| wc -l` | ❌ W0 | ⬜ pending |
| 20-05-03 | 05 | 5 | MOD-04 test renames | code-inspection | `find server/pool/__tests__ -name '*.spec.ts' \| wc -l` | ✅ | ⬜ pending |
| 20-05-04 | 05 | 5 | Nyquist delta | tool-run | `npx tsx server/scripts/nyquist-diff.ts` | ✅ | ⬜ pending |
| 20-06-01 | 06 | 6 | phase-close | tool-run | `npm test && npm run lint && npm run dep-check && npx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/pool/events.ts` — Zod schemas + emit helpers + POOL_EVENT_NAMES + poolRegistry + POOL_AGGREGATE_TYPE
- [ ] `server/pool/__tests__/events.spec.ts` — stubs proving events.ts shape (MOD-03)
- [ ] `server/pool/queue.ts` — stub exporting registerPoolQueues factory + DEVICE_REAP queue registration
- [ ] `server/queue/names.ts` — add `DEVICE_BOOT = 'device.boot'` + `DEVICE_REAP = 'device.reap'` constants
- [ ] `.dependency-cruiser.cjs` — add `no-pool-internal` forbidden rule for `server/pool/internal/**` mirroring reporting
- [ ] `server/pool/internal/module.ts` — 4-line stub (overwritten in Plan 20-03)
- [ ] `server/pool/MODULE.md` — placeholder to satisfy MOD-01 pre-checks (finalized in Plan 20-05)
- [ ] `server/pool/index.ts` — barrel stub (finalized in Plan 20-05)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end boot cycle with real emulator | SC2 (health-checker ownership) | Requires Mac Mini + Apple Silicon + real emulator; CI cannot reproduce | Start server; `POST /api/devices/boot`; observe `device.booted` log line with correlationId; `GET /api/devices`; verify device appears with state `Idle`; kill emulator; verify `device.health.failed` logged and state transitions to `Error` |
| Reaper kills zombie qemu process | SC2 (reaper ownership) | Requires actual zombie process; simulation via mock covers logic but not OS-level signals | Launch emulator; kill parent before graceful shutdown; wait 60s; verify reaper removes port from allocation set via `GET /api/devices/ports` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
