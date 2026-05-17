---
phase: 21
slug: artifacts-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (server-side TypeScript) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run server/artifacts/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~3s quick · ~45s full |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched-spec.ts>` (single-file, ~1-2s)
- **After every plan wave:** Run `npx vitest run server/artifacts/` (whole-module, ~3s)
- **Before `/gsd:verify-work`:** Full suite `npm test` must be green + `npm run nyquist:check` must pass
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

*Populated by planner — one row per task. Every task gets an automated verification command. Wave 0 (plan 21-00) has no upstream deps; later waves assume Wave 0 artifacts exist.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| _(pending plan creation)_ |  |  |  |  |  |  | ⬜ |

**Status legend:** ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

---

## Wave 0 Requirements

*Populated by planner. Typical Wave 0 substrate for module-migration phases:*

- [ ] `server/artifacts/events.ts` — event name constants + Zod payload schemas + registry + `makeArtifactsEmitters` (MOD-03)
- [ ] `server/artifacts/queue.ts` — `recording.upload` queue name constant + worker registration (QUEUE layer of SC3)
- [ ] `server/artifacts/MODULE.md` — 9-section contract per Phase 16/20 canonical template (MOD-01)
- [ ] `server/artifacts/index.ts` — barrel + `createArtifactsModule(deps)` factory (MOD-02)
- [ ] `server/artifacts/__tests__/fixtures/` — shared stub services if needed (per Phase 19 W1 pattern)
- [ ] Drizzle migration adding `artifacts.recording_id UNIQUE` column (or new `recordings` table — see RESEARCH Q1)

*Coverage baseline from `.planning/nyquist-baseline.json` (Phase 15 Plan 15-09) is the reference point for the ≤ −2pp delta gate.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| _(target: zero manual rows — all success criteria must have automated verification)_ |  |  |  |

*If none remain after planning: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (events.ts, queue.ts, MODULE.md, barrel, migration)
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
