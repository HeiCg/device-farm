---
phase: 17
slug: contracts-pipeline-ops-hygiene
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (server/web), `go test` (cli) |
| **Config file** | `vitest.config.ts`, `cli/internal/types/*_test.go` |
| **Quick run command** | `npx vitest run server/websocket/ server/__tests__/` |
| **Full suite command** | `npm test && npm run lint && npm run dep-check && npm run contracts:check && (cd cli && make types && go test ./...)` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` scoped to the touched module + `npx tsc --noEmit` (typecheck)
- **After every plan wave:** Full suite + `git diff --exit-code` for generated files
- **Before `/gsd:verify-work`:** Full suite green + `npm run contracts:check` passes + Nyquist delta ≤ −2pp vs baseline + `server/__tests__/plugin-order.spec.ts` green after every rename commit
- **Max feedback latency:** 15 seconds for per-commit quick-run

---

## Per-Task Verification Map

*Populated by planner — one row per task.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| _(pending plan creation)_ |  |  |  |  |  |  | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install dev deps: `fastify-zod-openapi@^4.x`, `@fastify/swagger@^9.x`, `openapi-typescript@^7.x`, `zod-openapi@^6.x` (registry helpers from samchungy/zod-openapi)
- [ ] `server/scripts/build-openapi.ts` created as a standalone tsx script
- [ ] `contracts/openapi/` + `contracts/ws-messages/` + `contracts/ws-fixtures/` directories scaffolded with `.gitkeep`
- [ ] `vendor/device-stream/` scaffolded (tarballs added in the DEBT-01 plan)
- [ ] Empirical check: run `go-jsonschema` against a minimal sample OpenAPI `components.schemas` to confirm output quality — recorded in `server/scripts/__tests__/build-openapi.spec.ts` baseline

*Coverage baseline from `.planning/nyquist-baseline.json` (Phase 15 Plan 15-09) is the reference point for the ≤ −2pp delta gate.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fresh-clone `npm install` without sibling `../device-stream` | DEBT-01 | Requires a clean tmpdir and full dependency resolution; CI might not cover tmpdir-install smoke | Reviewer runs `git clone` into a fresh dir, `npm install`, confirms exit 0 and `node_modules/@device-stream/core/package.json` is present |
| `installSimCapture` integration on a Mac Mini | DEBT-01 | Requires macOS with `xcrun`/`swiftc` toolchain present — CI on Linux can't run it | Reviewer runs the flow on a Mac Mini, confirms simcapture binary appears in expected path |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (build-openapi.ts skeleton, contracts/ dirs, vendor/ dir, dep installs)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s for quick-run
- [ ] `nyquist_compliant: true` set in frontmatter after coverage delta is measured

**Approval:** pending
