---
phase: 5
slug: web-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x + @testing-library/svelte |
| **Config file** | web/vitest.config.ts (new — Wave 0 installs) |
| **Quick run command** | `cd web && npx vitest run` |
| **Full suite command** | `npm test && cd web && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd web && npx vitest run`
- **After every plan wave:** Run `npm test && cd web && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | — | scaffold | `cd web && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | UI-01 | unit (component) | `cd web && npx vitest run src/lib/components/jobs/JobCard.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 1 | UI-02 | unit (API client) | `cd web && npx vitest run src/lib/api/jobs.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 1 | UI-03 | unit (component) | `cd web && npx vitest run src/routes/jobs/[id]/page.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 1 | UI-04 | unit (component) | `cd web && npx vitest run src/lib/components/jobs/VideoPlayer.test.ts` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 1 | UI-05 | unit (component) | `cd web && npx vitest run src/lib/components/devices/DeviceGrid.test.ts` | ❌ W0 | ⬜ pending |
| 05-04-02 | 04 | 1 | UI-06 | unit (component) | `cd web && npx vitest run src/routes/settings/page.test.ts` | ❌ W0 | ⬜ pending |
| 05-05-01 | 05 | 1 | UI-07 | unit (WS handler) | `cd web && npx vitest run src/lib/ws/job-stream.test.ts` | ❌ W0 | ⬜ pending |
| 05-06-01 | — | 1 | — | integration | `npx vitest run server/api/__tests__/static-serving.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/` SvelteKit project scaffold (package.json, svelte.config.js, vite.config.ts)
- [ ] `web/vitest.config.ts` — test config for SvelteKit components
- [ ] `web/package.json` — must include @testing-library/svelte, jsdom as dev deps
- [ ] `server/api/__tests__/static-serving.test.ts` — verify Fastify serves SPA + fallback

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live WebSocket preview renders frames | UI-03 | Requires running emulator + WS connection | Start device, submit job, open job detail, verify live preview updates |
| Video playback in browser | UI-04 | Requires actual MP4 artifact file | Complete a job, open detail, verify video plays |
| Device grid live status updates | UI-05 | Requires multiple running devices | Start 2+ devices, verify grid reflects state changes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
