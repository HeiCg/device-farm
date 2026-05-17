---
phase: 36-physical-devices-ux
plan: 00
subsystem: infra
tags: [discovery, mdns, wireless-adb, command-palette, scaffold, bonjour, qrcode, fuzzysort]

requires:
  - phase: 20-pool-module
    provides: PoolEmitters + poolRegistry + makePoolEmitters extension surface
  - phase: 26-auth-module
    provides: actorSchema substrate (consumed by devicePairAttemptedPayload.actor)
provides:
  - 4 new pool events (3 discovery + 1 pairing audit) registered with TRACE-08 persistence
  - Stub files for all Wave 1-3 modules (no scavenger hunt for executors)
  - dep-cruiser rule 13 `no-bare-adb-list-outside-discovery` (DISC-SVC sole-caller)
  - 4 new npm dependencies pinned (bonjour-service, qrcode, @types/qrcode, fuzzysort)
affects:
  - 36-01 DISC-SVC (DeviceDiscoveryService body)
  - 36-02 PAIR-WIRELESS + PHYS-ANDROID-DRIVER + DISC-WS (wireless pairing + physical driver + WS routes)
  - 36-03 CMD-PALETTE (command palette body)
  - 36-04 PAIR-WIZARD-UI (3-step pairing wizard)

tech-stack:
  added:
    - bonjour-service@^1.3.0 (server — mDNS discovery for adb pairing)
    - qrcode@^1.5.4 (server — QR code generation for pairing wizard)
    - "@types/qrcode@^1.5.5 (server dev)"
    - fuzzysort@^3.1.0 (web — command palette ranking)
  patterns:
    - "Wave 0 substrate-only plans: scaffold every Wave 1+ file with throw-stubs so executors have exact write targets"
    - "Pool event registry additive growth (5 → 9 entries) — preserves all prior TRACE-08 persistence policy decisions"
    - "Sole-caller dep-cruiser rule (path-based) + runtime grep-guard spec (in Wave 1) — two-layer enforcement"

key-files:
  created:
    - server/pool/internal/discovery/types.ts
    - server/pool/internal/discovery/fingerprint.ts
    - server/pool/internal/discovery/poller.ts
    - server/pool/internal/discovery/adapters/android.ts
    - server/pool/internal/discovery/adapters/ios.ts
    - server/pool/internal/discovery/index.ts
    - server/pool/internal/wireless/mdns.ts
    - server/pool/internal/wireless/pair.ts
    - server/pool/internal/wireless/connect.ts
    - server/pool/internal/wireless/qr.ts
    - server/pool/internal/wireless/session.ts
    - server/pool/android/physical.ts
    - server/api/devices-stream.ts
    - server/api/pairing.ts
    - web/src/lib/components/CommandPalette.svelte
    - web/src/lib/command-palette/registry.ts
    - web/src/lib/command-palette/recent.svelte.ts
    - web/src/lib/command-palette/fuzzy.ts
    - web/src/lib/stores/devices.svelte.ts
    - web/src/routes/devices/pair/+page.svelte
  modified:
    - package.json (deps + lockfile)
    - package-lock.json
    - web/package.json
    - web/package-lock.json
    - .dependency-cruiser.cjs (rule 13 added)
    - server/pool/events.ts (4 new events, 9-entry registry, 9-helper emitters)
    - server/pool/schemas.ts (3 new discovery schemas + type export)
    - server/pool/index.ts (barrel re-exports for new events + schemas)
    - server/pool/health-checker.ts (NOOP_POOL_EMIT extended to 9 helpers)
    - server/pool/pool-manager.ts (NOOP_POOL_EMIT extended to 9 helpers)
    - server/pool/__tests__/events.spec.ts (5 new assertions covering 4 new events)
    - server/pool/__tests__/allocation.spec.ts (capture stub extended)
    - server/pool/__tests__/health-checker.spec.ts (capture stub extended)

key-decisions:
  - "TRACE-08 split for discovery — added/removed PERSISTED (audit trail of physical devices joining/leaving the lab); changed transient (high-frequency state flap, derivable from added)"
  - "pair.attempted PERSISTED — every pair attempt is operationally relevant for security triage (failed auth indicates stale QR scan; success means new physical device joined)"
  - "Discovery sole-caller enforced two-layer: dep-cruiser rule 13 (path-based, structural) + grep-guard spec in 36-01 (file-contents, runtime). Dep-cruiser cannot grep source text."
  - "PoolEmitters NOOP fallback updated in pool-manager.ts + health-checker.ts to maintain back-compat with PoolEmitters consumers (prevents type-only break of 28 → 24 errors)"
  - "Web pairing route placed under /devices/pair (matches existing /devices namespace) rather than /pair"

patterns-established:
  - "Phase 36 Wave 0 substrate pattern: install deps + extend events registry + add dep-cruiser rule + scaffold stub files — splits 1 architectural task from 3 implementation waves so Wave 1+ executors can write directly into known files"
  - "Throw-stub pattern: every runtime method throws `Not implemented — Wave N (NN-NN) task` so accidental wiring during plan execution fails fast with a precise pointer"

requirements-completed: []  # 36-00 is substrate — no functional requirements close. DISC-SVC/PAIR-WIRELESS/PHYS-ANDROID-DRIVER/PAIR-WIZARD-UI/CMD-PALETTE/DISC-WS land in Plans 36-01..36-04.

duration: 27 min
completed: 2026-05-16
---

# Phase 36 Plan 00: Wave 0 Substrate Summary

**Discovery + wireless-pairing + command-palette substrate: 4 new pool events with TRACE-08 persistence, 14 server + 6 web stub files, dep-cruiser rule 13 (`no-bare-adb-list-outside-discovery`), and 4 pinned npm deps (bonjour-service, qrcode, @types/qrcode, fuzzysort) so Waves 1-3 have exact write targets.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-05-16T22:34:50Z
- **Completed:** 2026-05-16T23:01:06Z
- **Tasks:** 3 (atomic commits)
- **Files modified:** 33 (20 created + 13 modified)

## Accomplishments

- Pool event registry extended additively 5 → 9 entries (3 discovery + 1 pairing audit) with TRACE-08-aware persistence flags
- 14 server stub files created (discovery types/fingerprint/poller + android/ios adapters + 5 wireless helpers + PhysicalAndroidDriver + 2 API route stubs)
- 6 web stub files created (CommandPalette.svelte + 3 command-palette modules + deviceStore + /devices/pair route)
- 11 vitest spec stubs (8 server + 3 web) — all `it.todo` rows mapping to 36-VALIDATION.md
- dep-cruiser rule 13 `no-bare-adb-list-outside-discovery` shipped (path-based; complemented by runtime grep-guard spec in 36-01)
- 4 npm deps pinned and installed (bonjour-service, qrcode, @types/qrcode, fuzzysort) — zero reference-repo dependencies added
- tsc baseline 24 errors maintained (zero new); dep-check 5 baseline violations maintained (zero new from 25 new modules); svelte-check 21 baseline maintained

## Task Commits

1. **Task 1: Install deps + extend Pool event registry + dep-cruiser rule** — `0bd124a` (chore)
2. **Task 2: Server scaffolds (discovery + wireless + physical-android + API stubs)** — `41958d4` (feat)
3. **Task 3: Web scaffolds (command-palette + devices store + pairing route)** — `2045957` (feat)

## Files Created/Modified

**Created (20):**

Server (14):
- `server/pool/internal/discovery/{types,fingerprint,poller,index}.ts` — discovery type contracts + diff/sort + service factory + internal barrel
- `server/pool/internal/discovery/adapters/{android,ios}.ts` — the ONLY legitimate callers of bare `adb devices` / `simctl list devices`
- `server/pool/internal/wireless/{mdns,pair,connect,qr,session}.ts` — bonjour browsers + adb pair/connect wrappers + QR builder + session state machine
- `server/pool/android/physical.ts` — PhysicalAndroidDriver implementing DeviceDriver
- `server/api/{devices-stream,pairing}.ts` — WS broadcast route + REST pairing routes

Web (6):
- `web/src/lib/components/CommandPalette.svelte` — Svelte 5 component exporting openPalette/closePalette
- `web/src/lib/command-palette/{registry,recent.svelte,fuzzy}.ts` — action registry + localStorage recents + fuzzysort wrapper
- `web/src/lib/stores/devices.svelte.ts` — DeviceStore with $state runes
- `web/src/routes/devices/pair/+page.svelte` — wizard placeholder route

Spec stubs (11):
- `server/pool/__tests__/discovery-{fingerprint,poller,sole-caller,emit}.spec.ts`
- `server/pool/__tests__/wireless/{mdns,pair,subnet,session,qr}.spec.ts`
- `server/pool/__tests__/android/physical.spec.ts`
- `server/api/__tests__/devices-stream.spec.ts`
- `web/src/lib/components/__tests__/CommandPalette.spec.ts`
- `web/src/lib/command-palette/__tests__/recent.spec.ts`
- `web/src/lib/stores/__tests__/devices.spec.ts`

**Modified (13):**
- `package.json` + `package-lock.json` — bonjour-service + qrcode + @types/qrcode
- `web/package.json` + `web/package-lock.json` — fuzzysort
- `.dependency-cruiser.cjs` — rule 13 `no-bare-adb-list-outside-discovery`
- `server/pool/events.ts` — 4 new event names + payload schemas + registry entries + emit helpers
- `server/pool/schemas.ts` — `discoveredDeviceStateSchema` + `discoveredDeviceTypeSchema` + `discoveredDevicePayloadSchema`
- `server/pool/index.ts` — barrel re-exports for new events + schemas
- `server/pool/health-checker.ts` — NOOP_POOL_EMIT extended to 9 helpers
- `server/pool/pool-manager.ts` — NOOP_POOL_EMIT extended to 9 helpers
- `server/pool/__tests__/events.spec.ts` — registry-count assertions updated 5 → 9 + new entry coverage
- `server/pool/__tests__/allocation.spec.ts` — capture stub PoolEmitters extended (type-completeness)
- `server/pool/__tests__/health-checker.spec.ts` — capture stub PoolEmitters extended (type-completeness)

## Decisions Made

- **TRACE-08 persistence split for discovery:** `device.discovered.added` + `device.discovered.removed` PERSISTED (audit trail of physical devices joining/leaving the lab — security/operations relevant); `device.discovered.changed` transient (high-frequency state flap, derivable from added/removed pair).
- **`device.pair.attempted` PERSISTED:** every pair attempt is operationally relevant — failed auth indicates stale QR scan; success means new physical device joined. `outcome` enum discriminates auth-fail / timeout / cross-subnet / unknown for triage.
- **Discovery sole-caller two-layer enforcement:** dep-cruiser rule 13 (path-based, structural) blocks `bare-adb-list.ts`-style helpers from being imported across the discovery boundary; the runtime grep-guard spec (in 36-01) walks source files looking for bare `adb devices` / `simctl list devices` regex matches. Dep-cruiser cannot grep source text, hence two layers.
- **NOOP_POOL_EMIT extension over breaking PoolEmitters consumers:** rather than refactor every back-compat consumer to the new emitter shape, the noop fallback in `pool-manager.ts` + `health-checker.ts` was extended to 9 helpers. Preserves the existing tsc baseline (24 errors — DEFERRED-15-A) without introducing new ones.
- **Pairing route under `/devices/pair`:** placed inside the existing `/devices` namespace rather than top-level `/pair` to keep the web route tree shallow and discoverable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended `events.spec.ts` registry-count + payload-validation coverage for 4 new entries**
- **Found during:** Task 1 verification (`npx vitest run server/pool/__tests__/events.spec.ts`)
- **Issue:** The existing spec hard-coded `expect(Object.keys(poolRegistry)).toHaveLength(5)` + a 5-helper assertion. Adding the 4 new events would cause 3 test failures with no payload-schema coverage for the new entries.
- **Fix:** Updated registry-count + emitter-count assertions to 9; added a new `[Phase 36-00] pool events — discovery + pairing (entries 6-9)` describe block with safeParse accept/reject coverage for all 4 new payload schemas (discovery added/removed/changed via `discoveredDevicePayloadSchema` shape + pair.attempted with outcome enum + sessionId UUID + port positivity).
- **Files modified:** `server/pool/__tests__/events.spec.ts`
- **Verification:** All 13 tests pass (was 12 — added 1 net new test; remaining 5 assertions were inline extensions)
- **Committed in:** `0bd124a` (Task 1 commit)

**2. [Rule 1 - Bug] Extended `NOOP_POOL_EMIT` in `pool-manager.ts` + `health-checker.ts` for 4 new helpers**
- **Found during:** Task 1 typecheck (4 TS2739 "missing properties" errors after adding helpers to `makePoolEmitters`)
- **Issue:** The two production-code NOOP_POOL_EMIT constants are typed as `PoolEmitters` — adding 4 new helpers to the type broke their structural assignment.
- **Fix:** Extended both NOOP constants with 4 `() => ({} as Envelope)` entries (`discoveredAdded` / `discoveredRemoved` / `discoveredChanged` / `pairAttempted`).
- **Files modified:** `server/pool/health-checker.ts`, `server/pool/pool-manager.ts`
- **Verification:** tsc back to baseline 24 errors (was 28 transiently)
- **Committed in:** `0bd124a` (Task 1 commit)

**3. [Rule 1 - Bug] Extended capture-stub PoolEmitters in 2 existing spec files**
- **Found during:** Task 1 typecheck (2 TS2739 errors in `allocation.spec.ts` + `health-checker.spec.ts`)
- **Issue:** Both specs declare local capture-stub objects typed as `PoolEmitters` to record emit calls — same structural type break as production code.
- **Fix:** Added 4 corresponding capture entries (unused in current assertions but required for type completeness; commented as such inline).
- **Files modified:** `server/pool/__tests__/allocation.spec.ts`, `server/pool/__tests__/health-checker.spec.ts`
- **Verification:** tsc back to baseline; existing emit assertions in those specs unaffected
- **Committed in:** `0bd124a` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 2 missing-critical-test-coverage + 2 Rule 1 structural-type-completeness fixes)
**Impact on plan:** All 3 fixes essential to maintain the tsc baseline and provide minimum payload-schema coverage. No scope creep — the events.spec extension is the minimum to keep the existing test asserting an accurate registry shape post-extension.

## Authentication Gates

None — substrate plan, no external services touched.

## Issues Encountered

- npm install reports 29 vulnerabilities (24 moderate + 3 high + 2 critical) — pre-existing in the dependency graph; out of scope for this plan; tracked separately as security tech-debt.
- Web `svelte-check` reports 21 errors total — all in pre-existing files (`+page.svelte` device store typing + `pipeline-runs/[id]/+page.svelte` etc.); zero in the 6 new files (verified by grep on output).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 36-01 (Wave 1 / DISC-SVC) unblocked** — DeviceDiscoveryService body has exact write targets at `server/pool/internal/discovery/{poller,fingerprint,adapters/{android,ios}}.ts`. Emitters available via `fastify.poolModule.emit.discovered{Added,Removed,Changed}`. Grep-guard spec stub at `discovery-sole-caller.spec.ts` ready to receive its body.
- **Plan 36-02 (Wave 2 / PAIR-WIRELESS + PHYS-ANDROID-DRIVER + DISC-WS) unblocked** — bonjour-service + qrcode installed; wireless module stubs in place; `PhysicalAndroidDriver` shell exists; `server/api/{devices-stream,pairing}.ts` route stubs ready for registration.
- **Plan 36-03 (Wave 2 / CMD-PALETTE) unblocked** — fuzzysort installed; CommandPalette.svelte stub exports openPalette/closePalette so `+layout.svelte` ⌘K wiring is a single-edit operation.
- **Plan 36-04 (Wave 2 / PAIR-WIZARD-UI) unblocked** — `/devices/pair` route registered; wizard body lands as a single `+page.svelte` rewrite.
- 4 new pool events available to the typed bus from this commit forward — any module can subscribe via `fastify.bus.on('device.discovered.added', ...)`.

## Self-Check: PASSED

- 20 created files verified on disk (server: 14; web: 6).
- 11 spec stubs verified on disk and recognised as todo by vitest (verified via `npx vitest --reporter=verbose run server/pool/__tests__/discovery-fingerprint.spec.ts` showing `3 todo (3)`).
- 3 commits verified in `git log`: `0bd124a` (Task 1), `41958d4` (Task 2), `2045957` (Task 3).
- tsc baseline 24 errors maintained (counted via `npx tsc --noEmit 2>&1 | grep -E "^server/" | wc -l`).
- dep-check 5 baseline violations maintained (counted via `npm run dep-check` final summary).
- 4 dependency strings present in lockfiles: `bonjour-service`, `qrcode`, `@types/qrcode` (root); `fuzzysort` (web).
- `POOL_EVENT_NAMES.DISCOVERED_ADDED === 'device.discovered.added'` verified in events.spec test run.

---
*Phase: 36-physical-devices-ux*
*Completed: 2026-05-16*
