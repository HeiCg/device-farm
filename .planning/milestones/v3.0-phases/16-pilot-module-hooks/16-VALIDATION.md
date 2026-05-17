---
phase: 16
slug: pilot-module-hooks
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-17
updated: 2026-04-17
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run server/hooks/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~45 seconds (full); ~6 seconds (hooks-only) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/hooks/`
- **After every plan wave:** Run `npm test && npm run lint && npm run dep-check`
- **Before `/gsd:verify-work`:** Full suite must be green + `dependency-cruiser` passes + Nyquist delta ≤ −2pp vs baseline
- **Max feedback latency:** 10 seconds for hooks-scoped quick run

---

## Per-Task Verification Map

*Populated by planner — one row per task. Every task has an automated verification command. Wave 0 (plan 16-00) has no upstream deps; later waves assume Wave 0 artifacts exist.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| **0.1** | 16-00 | 0 | QUEUE-06 prep | structural grep + typecheck | `node -e "…QUEUE_NAMES.HOOK_RUN grep + pkg.devDependencies['dependency-cruiser']"` (frontmatter-embedded) | — | ⬜ |
| **0.2** | 16-00 | 0 | SPEC-01, SPEC-03 | structural grep + typecheck | `npx tsc --noEmit && node -e "…hookDefinitionSchema single-source + z.infer HookDefinition"` | — | ⬜ |
| **0.3** | 16-00 | 0 | MOD-03, EVENTS-06 | structural grep + typecheck | `npx tsc --noEmit && node -e "…HOOK_EVENT_NAMES + hooksRegistry + makeHookEmitters + payloads + persisted:true count=2"` | — | ⬜ |
| **0.4** | 16-00 | 0 | MOD-05 | structural grep | `node -e "…ADR-002 sections + 2026-04-17 status + README index row"` | — | ⬜ |
| **1.1** | 16-01 | 1 | QUEUE-06 | migration + structural grep | `node -e "…0001_*.sql + CREATE TABLE hook_runs + operation_key PK + 3 indexes + schema.ts hookRuns export"` | — | ⬜ |
| **1.2** | 16-01 | 1 | QUEUE-06, EVENTS-06 | structural grep + typecheck | `npx tsc --noEmit && node -e "…onConflictDoNothing(target: hookRuns.operationKey) + hookRunPayloadSchema.parse + if (!claimed) + emit.completed/failed + QUEUE_NAMES.HOOK_RUN + registerHookRunWorker"` | — | ⬜ |
| **1.3** | 16-01 | 1 | EVENTS-06, EVENTS-09 | DB-gated integration (skipIf) + structural grep | `npx tsc --noEmit && node -e "…[Invariant c] + [EVENTS-09] + test.trigger + registerHookRunWorker + vi.spyOn(executor as any, 'executeOne') + toHaveBeenCalledTimes(1)"` | — | ⬜ |
| **2.1** | 16-02 | 2 | MOD-02 | structural grep + typecheck | `npx tsc --noEmit && node -e "…internal/hook-executor.ts class + shim re-export + schemas path"` | — | ⬜ |
| **2.2** | 16-02 | 2 | MOD-06 | structural grep + typecheck | `npx tsc --noEmit && node -e "…createHooksModule + TypedBus(hooksRegistry) + registerHookRunWorker + wireBusToQueue + hookRunPayloadSchema.parse + if (stopped) return + singletonKey"` | — | ⬜ |
| **2.3** | 16-02 | 2 | SPEC-02, MOD-06 | structural grep + typecheck + lint | `npx tsc --noEmit && node -e "…createHooksModule + decorate hookExecutor + decorate hooksModule + registerBusSubscribers + onClose→shutdown + deps ['config','event-bus','queue','pool-plugin'] + safeParse count≥3 + RFC 7807 URI + route list"` | — | ⬜ |
| **2.4** | 16-02 | 2 | MOD-02, MOD-06 | unit vitest (no DB) + structural grep | `npx tsc --noEmit && node -e "…barrel exports + internal-path denylist"` + `npx vitest run server/hooks/__tests__/module.spec.ts` | — | ⬜ |
| **3.1** | 16-03 | 3 | MOD-02 | structural grep + dep-check run | `node -e "…cfg.forbidden names + tsConfig + enhancedResolveOptions.conditionNames + pkg scripts.dep-check"` + `npm run dep-check` | — | ⬜ |
| **3.2** | 16-03 | 3 | MOD-02 | subprocess integration (depcruise JSON probe) + pre-task manual gate | `npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts && npm run dep-check` (pre-task manual: `npx depcruise --config .dependency-cruiser.cjs --output-type json __fixtures__/dep-cruiser/bad-deep-import.ts`) | — | ⬜ |
| **4.1** | 16-04 | 3 | MOD-01 | structural grep (markdown AST) | `node -e "…9 required H2 sections in order + 5 [Invariant X] + 4 emitted events + hook.run queue + test.trigger + Runnable Example"` | — | ⬜ |
| **4.2** | 16-04 | 3 | MOD-08 | unit vitest (no DB) + structural grep | `npx vitest run server/hooks/__tests__/hook-executor.spec.ts && node -e "…[Invariant a,b,d,e] + describe('setHooks / addHook / removeHook') + describe('getHooksForEvent') + describe('execute')"` | — | ⬜ |
| **4.3** | 16-04 | 3 | MOD-03, SPEC-03, TRACE-04 | unit vitest (no DB) + Nyquist gate + structural grep | `npx vitest run server/hooks/__tests__/events.spec.ts && node -e "…[SPEC-03][MOD-03, TRACE-08][MOD-03][TRACE-04] + asyncLocalStorage.run + import {asyncLocalStorage} from '@fastify/request-context' + new Map([['correlationId'"` + `npm run nyquist:capture && npm run nyquist:check` | — | ⬜ |

**Status legend:** ⬜ pending · ✅ green · ❌ red · ⚠️ flaky

**Wave summary:**
- Wave 0 (substrate): 4 tasks, all structural greps + typecheck — fast, no runtime cost.
- Wave 1 (durable queue): 3 tasks, 1 requires DB (queue.spec.ts skips without `TEST_DATABASE_URL`).
- Wave 2 (factory + barrel): 4 tasks, 1 vitest unit run (module.spec.ts).
- Wave 3 (enforcement + docs): 6 tasks, 2 vitest unit runs + 1 dep-cruiser probe subprocess + 1 Nyquist gate.

**Nyquist compliance:** Every task has an `<automated>` command. No task declares MISSING verification. The phase is Nyquist-compliant (`nyquist_compliant: true`).

---

## Wave 0 Requirements

- [ ] `server/hooks/__tests__/fixtures/test-registry.ts` — synthetic `test.trigger` registry fixture for bus→queue bridge exercises (Task 0.3)
- [ ] `.dependency-cruiser.cjs` — config committed in Task 3.1 (Wave 3); Wave 0 only installs the devDep (Task 0.1)
- [ ] `dependency-cruiser` dev dep installed — `package.json` and `package-lock.json` reflect `^17.3` range (Task 0.1)
- [ ] Drizzle migration for `hook_runs` (generated via `npx drizzle-kit generate`) present under `server/db/migrations/` (Task 1.1 — Wave 1, not Wave 0)

*Note: the table layout intentionally defers dep-cruiser config (3.1) and hook_runs migration (1.1) to their respective waves. Wave 0 ships only the artifact substrate (schemas, events, ADR, QUEUE_NAMES extension, dep-cruiser devDep install).*

*Coverage baseline from `.planning/nyquist-baseline.json` (Phase 15 Plan 15-09) is the reference point for the ≤ −2pp delta gate.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MODULE.md describe-tree alignment with Public API | MOD-01 | Parsing markdown AST → test suite shape is high-tooling-cost for marginal value at single-module scale; reviewer-gated | PR reviewer checks each H3 in MODULE.md "Public API" section has a `describe(...)` block in `hook-executor.spec.ts` that matches verbatim |
| ~~Deep-import CI failure proof~~ **[REPLACED BY AUTOMATION — Task 3.2]** | MOD-02 | ~~Requires introducing a test file outside `server/hooks/` that imports from `server/hooks/internal/*` — intentionally dirty; verified once then removed~~ | ~~Reviewer confirms CI failed on the PR that added the probe file, and the probe file was reverted before merge~~ **AUTOMATED:** Task 3.2 places a permanent fixture at `__fixtures__/dep-cruiser/bad-deep-import.ts` (outside `server/` so `npm run dep-check` ignores it) and runs `depcruise` as a subprocess from `dep-cruiser.spec.ts`, asserting the `no-deep-imports-into-hooks-internal` rule fires with non-zero exit + correct violation JSON. |

Only 1 manual-only row remains (MODULE.md describe-tree alignment, deferred to MOD-04 CI enforcement in Phase 30).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (16/16 tasks — see table above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (dep-cruiser devDep, Drizzle schemas substrate, test fixtures, ADR-002)
- [x] No watch-mode flags (every verify uses `vitest run`, never `vitest`)
- [x] Feedback latency < 10s for hooks-scoped quick run
- [x] `nyquist_compliant: true` set in frontmatter after coverage delta is measured (delta check runs in Task 4.3 — the final task of the phase)

**Approval:** populated 2026-04-17 after plan creation; pending execution run-through confirmation.
