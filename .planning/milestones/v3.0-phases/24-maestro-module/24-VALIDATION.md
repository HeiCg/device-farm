---
phase: 24
slug: maestro-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (root, existing) |
| **Quick run command** | `npx vitest run server/maestro/__tests__/<spec>.spec.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10-25s wave-merge, full suite ~3-4min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run server/maestro/__tests__/<file>.spec.ts` (~200-500ms unit; ~5-15s DB-gated).
- **After every wave:** `npx vitest run server/maestro/__tests__/ server/pool/__tests__/`.
- **Phase gate (Plan 24-05 close):** `npm test` excluding inherited DEFERRED-17-A files; `npm run dep-check` ≤ 3 (pre-existing artifacts→streaming; Phase 24 adds 0); `npx tsc --noEmit` 0 NEW errors; `npm run nyquist:check` exit 0; `npm run lint` clean.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----|-----------|-------------------|-------------|--------|
| 24-00-01 | 00 | 0 | SC3a | unit | `find server/maestro -name 'MODULE.md' -name 'index.ts' -name 'events.ts'` | ❌ W0 | ⬜ pending |
| 24-00-02 | 00 | 0 | SC3b | unit | `npx vitest run server/maestro/__tests__/events.spec.ts` (placeholder shape) | ❌ W0 | ⬜ pending |
| 24-00-03 | 00 | 0 | SC3d | unit | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts` (extend) | ✅ extend | ⬜ pending |
| 24-00-04 | 00 | 0 | SC3g | unit | `npx vitest run server/pool/__tests__/events.spec.ts` (verify BOOTED const) | ✅ extend | ⬜ pending |
| 24-01-01 | 01 | 1 | SC3b | unit | `npx vitest run server/maestro/__tests__/events.spec.ts` (full body) | ❌ W0 from 00 | ⬜ pending |
| 24-01-02 | 01 | 1 | SC3g | unit | `npx vitest run server/pool/__tests__/events.spec.ts` (5-entry registry) | ✅ extend | ⬜ pending |
| 24-02-01 | 02 | 2 | SC3h | unit | `npx vitest run server/pool/__tests__/subscriber.spec.ts` (4 emit sites) | ✅ extend | ⬜ pending |
| 24-03-01 | 03 | 3 | SC1 | structural | `git log --follow server/maestro/internal/device-info-collector.ts` (blame preserved) | ❌ Plan 24-03 | ⬜ pending |
| 24-03-02 | 03 | 3 | SC3a | unit | `npx vitest run server/maestro/__tests__/module.spec.ts` (factory shape) | ❌ Plan 24-03 | ⬜ pending |
| 24-03-03 | 03 | 3 | SC2 | structural | `! grep -n "metadataCollect\\|onReady.*deviceInfoCollector" server/maestro/plugin.ts` (loop deleted) | ❌ Plan 24-03 | ⬜ pending |
| 24-03-04 | 03 | 3 | SC1 | structural | `! grep -rE "from .*pool/device-info-collector" server/` (zero remaining imports after gitmv) | ❌ Plan 24-03 | ⬜ pending |
| 24-04-01 | 04 | 4 | SC2 | DB-gated | `npx vitest run server/maestro/__tests__/subscriber.spec.ts` | ❌ Plan 24-04 | ⬜ pending |
| 24-04-02 | 04 | 4 | SC3f | DB-gated | `npx vitest run server/maestro/__tests__/correlation.spec.ts` | ❌ Plan 24-04 | ⬜ pending |
| 24-04-03 | 04 | 4 | SC1 | unit (readFileSync) | `npx vitest run server/maestro/__tests__/lifecycle-ownership.spec.ts` | ❌ Plan 24-04 | ⬜ pending |
| 24-05-01 | 05 | 5 | SC3a | structural | `grep -cE '^## (Purpose\|Public API\|Events Emitted\|Events Consumed\|Queue Produced\|Queue Consumed\|Invariants\|Non-Goals\|Dependencies)$' server/maestro/MODULE.md` returns 9 | ❌ Plan 24-05 | ⬜ pending |
| 24-05-02 | 05 | 5 | MOD-04 | manual git | `git log --follow server/maestro/__tests__/hierarchy-service.spec.ts` (blame preserved) | ❌ Plan 24-05 | ⬜ pending |
| 24-05-03 | 05 | 5 | SC3e | unit | `npx vitest run server/__tests__/plugin-order.spec.ts` (additive jobs+maestro asserts) | ✅ extend | ⬜ pending |
| 24-05-04 | 05 | 5 | SC3c | gate | `npm run nyquist:check` exit 0 (delta ≥ -2pp) | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/maestro/events.ts` — placeholder (MAESTRO_EVENT_NAMES with 2 keys + empty maestroRegistry; full body 24-01)
- [ ] `server/maestro/queue.ts` — comment-only file ("Maestro owns no queue surface")
- [ ] `server/maestro/internal/module.ts` — 10-line throw-stub
- [ ] `server/maestro/MODULE.md` — Purpose-only placeholder
- [ ] `server/maestro/index.ts` — 1-line MOD-02 strict re-export
- [ ] `server/maestro/__tests__/events.spec.ts` — registry-shape placeholder (count=2 names, EVENTS-03 dotted past-tense, no duplicates)
- [ ] `server/pool/events.ts` — placeholder addition: `POOL_EVENT_NAMES.BOOTED = 'device.booted'` constant only (registry stays at 4 entries; full body 24-01)
- [ ] `.dependency-cruiser.cjs` — 8th forbidden rule `no-deep-imports-into-maestro-internal` mirroring rules 5/6/7
- [ ] `__fixtures__/dep-cruiser/bad-maestro-deep-import.ts` — fires 8th rule via `@ts-expect-error` import
- [ ] `server/hooks/__tests__/dep-cruiser.spec.ts` — extend with `[MOD-02 maestro extension]` it-block

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device hierarchy fetch round-trip | SC2 | Requires actual booted Android emulator | Boot emulator, observe `maestro.device-info.collected` in `events`-table for non-persisted side-channel logger trace OR run a smoke test via `device-farm doctor` plus a job submission |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s (wave-merge command)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
