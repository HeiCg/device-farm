---
phase: 37-platform-extensions
plan: 02
subsystem: preflight
tags: [preflight, ipa, plist, privacy-manifest, rule-engine, yauzl, bplist-parser, fastify, svelte, drizzle]

# Dependency graph
requires:
  - phase: 37-platform-extensions
    provides: Wave 0 substrate (preflight_runs table, scaffold files, npm deps)
  - phase: 23-jobs-module-keystone
    provides: MOD-01..09 conventions + event bus + persistEnvelope pattern
  - phase: 15-event-bus
    provides: TypedBus + createEventHelpers + persistence middleware
provides:
  - Preflight scanner end-to-end (parser + rule engine + 3 iOS rules + 6 rule pack entries)
  - POST /api/preflight + GET /api/preflight/:id (multipart, RFC 7807 errors)
  - Web /preflight drag-drop page + PreflightChecklist component with rules_updated stamp
  - preflight.completed bus event (persisted, aggregateType='preflight')
  - Synthetic-IPA fixture strategy (no real .ipa fixtures shipped; tests build hand-crafted zips + use ParsedIpa objects directly)
affects: [37-04-PLAN (Track D may emit preflight pre-deploy), 37-05-PLAN (close-out wiring)]

# Tech tracking
tech-stack:
  added:
    - "(none — all deps shipped by Wave 0 plan 37-00)"
  patterns:
    - "Synthetic-IPA test strategy: build zips with system `zip` + hand-craft Info.plist XML; avoids checking real Mach-O binaries into git"
    - "Plist format auto-detection (Pitfall 7): sniff first byte — 0x62 bplist / 0x3C xml / 0x7B|0x5B json"
    - "Framework-internal symbol filter (Pitfall 10): moduleNameFromSymbol on Swift `$sNN<module>...` mangling, suppress matches in {SwiftUI,UIKit,UIKitCore,Foundation,CoreFoundation,Combine,...}"
    - "Rule pack version surfaced everywhere: rule-engine.rules_version → API response → UI header (Pitfall 6)"
    - "13th persistEnvelope sample point (DEFERRED-26-B continues — copied verbatim from explorations module)"
    - "Routes handle multipart via @fastify/multipart req.file(); registration order is preflight AFTER api so multipart is decorated"

key-files:
  created:
    - server/preflight/internal/parsers/ipa.ts
    - server/preflight/internal/parsers/apk.ts
    - server/preflight/internal/parsers/macho-symbols.ts
    - server/preflight/internal/parsers/plist-detect.ts
    - server/preflight/internal/rule-engine.ts
    - server/preflight/internal/rules/types.ts
    - server/preflight/internal/rules/ios-info-plist.ts
    - server/preflight/internal/rules/ios-privacy-manifest.ts
    - server/preflight/internal/rules/ios-forbidden-symbols.ts
    - server/preflight/internal/repo.ts
    - server/preflight/__tests__/parser-ipa.spec.ts
    - server/preflight/__tests__/routes.spec.ts
    - web/src/lib/components/PreflightChecklist.svelte
  modified:
    - server/preflight/index.ts
    - server/preflight/plugin.ts
    - server/preflight/routes.ts
    - server/preflight/events.ts
    - server/preflight/internal/module.ts
    - server/preflight/rules/__data__/forbidden-symbols.json
    - server/preflight/__tests__/rules.spec.ts
    - server/preflight/__tests__/privacy-manifest.spec.ts
    - web/src/routes/preflight/+page.svelte
    - server/index.ts

key-decisions:
  - "Synthetic-IPA fixtures over checked-in real .ipa: rule specs feed hand-crafted ParsedIpa objects directly into runRules(); parser specs build minimal zips in-test via `zip -r`. Real .ipa files are operator-supplied; no code-signed binaries committed."
  - "APK parser ships as a deferred-stub returning a placeholder ParsedIpa — Wave 1 Android rule pack is DEFERRED to v3.1 per CONTEXT. Avoids adding adm-zip dep (would have been unused)."
  - "Preflight plugin registered AFTER apiPlugin (not before) — multipart is decorated by api/plugin.ts and the preflight POST handler uses req.file()."
  - "ANDROID-COMING-V31 warning emitted for any android-platform scan so API consumers know rules are coming."

patterns-established:
  - "Multipart upload → tmp file → parse → scan → persist → emit completed event; cleanup via finally block"
  - "Rule kind dispatch: rule pack rules tagged by `kind` field; one rule applier per kind (info_plist_missing_key, privacy_manifest_missing_reason, forbidden_symbol); rule engine concatenates findings then grades severity"

requirements-completed:
  - EXT-PREFLIGHT

# Metrics
duration: 22 min
completed: 2026-05-17
---

# Phase 37 Plan 02: Preflight Scanning End-to-End Summary

**Greenlight App Store preflight scanner — IPA/APK upload → versioned rule pack (6 rules: 4 ITMS-91053 categories + ATT/IDFA + encryption-export) → red/yellow/green checklist persisted to `preflight_runs` and emitted via `preflight.completed` event; drag-drop web UI surfaces rules_updated stamp per Pitfall 6.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-05-17T01:26:22Z
- **Completed:** 2026-05-17T01:48:04Z
- **Tasks:** 2 (both TDD)
- **Commits:** 5 (2 RED + 2 GREEN + 1 spec-only)
- **Files created:** 13
- **Files modified:** 10
- **Tests:** 18 specs across 4 spec files, all green

## Accomplishments

- **End-to-end preflight scan flow** — operator drops IPA into `/preflight` UI → POST `/api/preflight` → yauzl streaming unzip + plist parse + `nm -gU` symbol extract → rule engine evaluates 6 rules across 3 kinds → red/yellow/green report persisted in `preflight_runs` + `preflight.completed` event emitted.
- **6-rule pack covering the bulk of real-world App Store rejections**: 4 ITMS-91053 privacy-manifest categories (UserDefaults, FileTimestamp, SystemBootTime, DiskSpace) + ATT-MISSING-FOR-IDFA (Info.plist) + ENCRYPTION-EXPORT-MISSING (warning tier). All carry remediation strings rendered in the UI.
- **Pitfall coverage**: Pitfall 7 (JSON-shaped Info.plist) handled by `detectPlistFormat` first-byte sniff; Pitfall 10 (SwiftUI framework internals) handled by `moduleNameFromSymbol` + `FRAMEWORK_INTERNAL_MODULES` filter set; Pitfall 6 (rule pack drift) handled by `rules_version` surfacing on every API response + UI header.
- **Versioned rule pack** bumped to `rules_updated: 2026-05-17`; rule engine returns it on every report; UI displays it in the status header.

## Task Commits

Each task was committed atomically through the RED/GREEN TDD cycle:

1. **Task 1 RED: specs + extended rule pack** — `c46f571` (test)
2. **Task 1 GREEN: parsers + rule engine + 3 rule modules** — `e5b11a8` (feat)
3. **Task 2 RED: routes spec** — `c66fbff` (test)
4. **Task 2 GREEN: module + repo + plugin + routes + web UI** — `3ff663f` (feat)

**Plan metadata commit:** added after this file is written.

## Files Created/Modified

### Server — parsers (4 files)
- `server/preflight/internal/parsers/ipa.ts` — yauzl streaming unzip, Info.plist + PrivacyInfo extract, executable to temp dir, `nm -gU` symbol scan, returns `ParsedIpa`. Cleans scratch dir in finally; throws "Invalid zip: malformed archive" on parse errors.
- `server/preflight/internal/parsers/apk.ts` — minimal stub returning placeholder ParsedIpa shape; Android rules deferred to v3.1.
- `server/preflight/internal/parsers/macho-symbols.ts` — `extractSymbols` shells `nm -gU` with 64MB buffer; `moduleNameFromSymbol` parses Swift `$sNN<module>` mangling; `buildSymbolModuleMap` produces the symbol→module map ParsedIpa consumes; exports `FRAMEWORK_INTERNAL_MODULES` set (SwiftUI, UIKit, UIKitCore, Foundation, CoreFoundation, Combine, etc.) for Pitfall 10 filtering.
- `server/preflight/internal/parsers/plist-detect.ts` — `detectPlistFormat` sniffs first non-whitespace byte (0x62 bplist / 0x3C xml / 0x7B|0x5B json). Used by `decodePlist` in ipa.ts.

### Server — rule engine + rules (5 files)
- `server/preflight/internal/rule-engine.ts` — `runRules(bundle, platform)` aggregates findings from 3 rule modules; android short-circuits to ANDROID-COMING-V31 warning; status graded blocked/pass_with_warnings/pass; rules_version copied from rule pack `rules_updated`.
- `server/preflight/internal/rules/types.ts` — RulePack, RulePackRule, RuleFinding interfaces.
- `server/preflight/internal/rules/ios-info-plist.ts` — handles `kind: 'info_plist_missing_key'` rules; supports `always_applies: true` (no trigger needed) for ENCRYPTION-EXPORT-MISSING; otherwise requires app-owned symbol match + key absence.
- `server/preflight/internal/rules/ios-privacy-manifest.ts` — handles `kind: 'privacy_manifest_missing_reason'` rules; cross-references trigger symbols against `bundle.privacyManifest.NSPrivacyAccessedAPITypes[].NSPrivacyAccessedAPITypeReasons` and `required_reason_options`; SwiftUI filter applies.
- `server/preflight/internal/rules/ios-forbidden-symbols.ts` — reserved for `kind: 'forbidden_symbol'` rules (none in current pack); SwiftUI filter applies.

### Server — module / repo / route / plugin (4 files)
- `server/preflight/internal/module.ts` — `createPreflightModule` factory returning `{ bus, emit, repo, scan }`; constructs per-module TypedBus, persistEnvelope closure (13th sample point), repo, scan(input) that does parse → runRules → repo.create → emit.completed.
- `server/preflight/internal/repo.ts` — Drizzle CRUD: `create(input)`, `getById(id)`, `listRecent(limit)` over `preflight_runs` table.
- `server/preflight/routes.ts` — `registerPreflightRoutes(app, { module })` mounts POST `/api/preflight` (multipart via `req.file()`) and GET `/api/preflight/:id`. RFC 7807 problem+json responses for 400 (missing-file / unsupported-extension / malformed-archive), 404 (not-found), 413 (payload-too-large), 500 (scan-error).
- `server/preflight/plugin.ts` — Wave 1 wiring (replaces Wave 0 stub); decorates `fastify.preflightModule` + registers routes. Name `preflight-plugin`, depends on `['config', 'db']`.

### Server — events + barrel
- `server/preflight/events.ts` — `PreflightRegistry` with `preflight.completed` (persisted=true, aggregateType='preflight'); payload `{preflightRunId, status, rulesVersion, blockerCount, warningCount}`; `makePreflightEmitters` factory.
- `server/preflight/index.ts` — MOD-02 barrel; re-exports module factory + plugin + schemas + events.

### Server — tests (4 spec files, 18 tests)
- `server/preflight/__tests__/rules.spec.ts` — 7 tests: pack well-formed, every rule shape, known-bad → blocked, known-good → pass, SwiftUI filter, android branch, ENCRYPTION-EXPORT warning.
- `server/preflight/__tests__/privacy-manifest.spec.ts` — 4 tests: missing reason / wrong reason / correct reason / SwiftUI filter.
- `server/preflight/__tests__/parser-ipa.spec.ts` — 3 tests: synthetic-good IPA parse, synthetic-bad IPA (no privacy manifest), plist format detector recognises XML/bplist/JSON.
- `server/preflight/__tests__/routes.spec.ts` — 4 tests: 200 with body, 400 missing-file, 400 unsupported-extension, 400 malformed-archive.

### Web (2 files)
- `web/src/routes/preflight/+page.svelte` — Svelte 5 drag-drop + file-picker upload; client-side POST to `/api/preflight`; renders `<PreflightChecklist>` on success.
- `web/src/lib/components/PreflightChecklist.svelte` — status banner (bg-red/yellow/green-100 per severity), rules_updated stamp in header, blockers + warnings grouped with rule_id + message + remediation.

### Database
- (Migration 0011 + `preflight_runs` schema column shipped in Plan 37-00.)

### Rule pack
- `server/preflight/rules/__data__/forbidden-symbols.json` — extended from 2 → 6 rules; bumped `rules_updated` to 2026-05-17.

### Integration
- `server/index.ts` — registered `preflightPlugin` at step 18a (after `apiPlugin` to inherit `@fastify/multipart` decoration).

## Sample API responses

### Blocked scan (known-bad IPA)
```json
{
  "status": "blocked",
  "rules_version": "2026-05-17",
  "platform": "ios",
  "blockers": [
    {
      "rule_id": "ITMS-91053-USERDEFAULTS",
      "severity": "blocker",
      "message": "Binary uses NSUserDefaults but PrivacyInfo.xcprivacy does not declare NSPrivacyAccessedAPICategoryUserDefaults reason.",
      "remediation": "Add NSPrivacyAccessedAPICategoryUserDefaults to NSPrivacyAccessedAPITypes in PrivacyInfo.xcprivacy with one of: CA92.1, AC6.1, C56D.1."
    }
  ],
  "warnings": []
}
```

### Pass scan (manifest correct, ITSAppUsesNonExemptEncryption declared)
```json
{
  "status": "pass",
  "rules_version": "2026-05-17",
  "platform": "ios",
  "blockers": [],
  "warnings": []
}
```

### Pass-with-warnings (manifest correct but missing encryption export)
```json
{
  "status": "pass_with_warnings",
  "rules_version": "2026-05-17",
  "platform": "ios",
  "blockers": [],
  "warnings": [
    {
      "rule_id": "ENCRYPTION-EXPORT-MISSING",
      "severity": "warning",
      "message": "Info.plist does not declare ITSAppUsesNonExemptEncryption; App Store Connect will prompt for export-compliance answers on every upload."
    }
  ]
}
```

## Pitfall coverage matrix

| Pitfall | Mitigation in code | Test that proves it |
|---------|--------------------|---------------------|
| **7 — JSON-shaped Info.plist** | `parsers/plist-detect.ts` sniffs first byte; `decodePlist` dispatches to bplist/xml/json | `parser-ipa.spec.ts > detectPlistFormat recognises XML, bplist00, and JSON shapes` |
| **10 — SwiftUI internals** | `moduleNameFromSymbol` extracts Swift `$sNN<module>` prefix; `FRAMEWORK_INTERNAL_MODULES` set; rule appliers filter | `rules.spec.ts > SwiftUI internal symbol does NOT trigger blocker (Pitfall 10 — module filter)` + `privacy-manifest.spec.ts > SwiftUI internal symbol → blocker filtered (Pitfall 10)` |
| **6 — rule pack drift** | `rules_version` in PreflightReport + `rules_updated` in UI header | `rules.spec.ts > known-bad bundle returns rules_version` + UI grep `rules_version` |

## Decisions Made

- **Synthetic IPA fixtures over checked-in real .ipa**: rule specs feed hand-crafted ParsedIpa objects directly into `runRules()`; parser specs build minimal zips via system `zip` at test runtime. Real code-signed binaries would have required ~5–10MB checked-in fixtures + Xcode build pipeline. Synthetic approach proves the algorithm; operator-supplied IPAs exercise it in production.
- **APK parser is a stub returning placeholder ParsedIpa**: Android rules are DEFERRED to v3.1 per phase context. Avoids pulling in adm-zip dep that would have been unused. The rule engine emits a single `ANDROID-COMING-V31` warning for any `.apk` upload so API consumers know coverage is pending.
- **Preflight plugin registered AFTER apiPlugin (step 18a)**: `@fastify/multipart` is registered inside `api/plugin.ts`. The preflight POST handler uses `req.file()`, so multipart MUST be decorated on the root instance before the route runs. Mirrors the placement note in 37-RESEARCH.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] yauzl autoClose default closes the file before per-entry extraction**
- **Found during:** Task 1 GREEN (parser-ipa spec ran)
- **Issue:** `yauzlOpen(path, { lazyEntries: true })` auto-closes the file after the `end` event in entry enumeration. Calling `openReadStream` on previously-read entries then throws "closed".
- **Fix:** Added `autoClose: false` to the open opts; manually `zip.close()` in the finally block of `parseIPA`.
- **Files modified:** `server/preflight/internal/parsers/ipa.ts`
- **Verification:** All 14 task-1 specs pass (previously 12/14).
- **Committed in:** e5b11a8 (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] No adm-zip dep available for APK parser**
- **Found during:** Task 1 GREEN (apk.ts initially imported `adm-zip`)
- **Issue:** Plan referenced `adm-zip` for AndroidManifest extraction; not in package.json.
- **Fix:** Wave 1 has no Android rules — replaced adm-zip-based extraction with a `fs.stat`-only stub that returns the placeholder ParsedIpa shape. Wave 1.5+ adds adm-zip when Android rules land.
- **Files modified:** `server/preflight/internal/parsers/apk.ts`
- **Verification:** `npm run web:build` and preflight specs all pass.
- **Committed in:** e5b11a8 (Task 1 GREEN commit)

**3. [Rule 1 - Bug] TypeScript JSON-module severity narrowing**
- **Found during:** Task 1 GREEN (tsc --noEmit)
- **Issue:** TS infers JSON-imported `severity` field as `string`, not the `'blocker' | 'warning'` union, breaking strict assignment to `RulePack`.
- **Fix:** Cast `rulePackRaw as unknown as RulePack` at JSON-import sites in `rule-engine.ts` and `privacy-manifest.spec.ts`. Schema is enforced at runtime via the rule pack JSON contract.
- **Files modified:** `server/preflight/internal/rule-engine.ts`, `server/preflight/__tests__/privacy-manifest.spec.ts`
- **Verification:** `npx tsc --noEmit | grep preflight` returns no errors.
- **Committed in:** e5b11a8 (Task 1 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing-dep workaround, 1 type cast).
**Impact on plan:** All deviations were small corrections to make the plan-as-written compile and pass tests. No scope creep — the deferred APK rule pack was already a CONTEXT-level decision.

## Issues Encountered

- **Pre-existing TypeScript errors in unrelated files** (server/azure, server/pipelines, server/artifacts, server/bus/helpers, server/events) surfaced during `tsc --noEmit`. None touched by this plan. Logged here only for context — not Phase 37 regressions.
- **server/index.ts was modified concurrently by a parallel agent** mid-execution (system reminder fired). Re-applied the preflight registration after re-reading the file. Final state has preflight imported + registered at step 18a alongside the Track A/C wiring.

## User Setup Required

None — no external service configuration required. Preflight is fully self-hosted.

## Next Phase Readiness

**Track B (EXT-PREFLIGHT) is complete end-to-end:**
- API surface: `POST /api/preflight` + `GET /api/preflight/:id`
- Persistence: `preflight_runs` table writes on every scan
- Event: `preflight.completed` emitted (persisted, aggregateType='preflight') — downstream subscribers (reporting, webhooks) can subscribe via `bus.on('preflight.completed', ...)`.
- UI: `/preflight` drag-drop page with red/yellow/green checklist and rules_updated stamp.

**Phase 37 progress:** Tracks A, B, C all merged independently in Wave 1. Track D (parallel patterns) + Track 5 (close-out) remain. No inter-track conflicts — Track B is fully independent.

**Open follow-ups (not blockers):**
- Real .ipa golden fixtures (operator-supplied) — synthetic fixtures prove the algorithm; production hardening on real builds happens during smoke runs.
- Android rule pack (v3.1) — APK parser stub returns ANDROID-COMING-V31 warning so API consumers are not surprised.
- `npm run preflight:update` script for rule pack refresh (Pitfall 6 followup) — out of scope for Wave 1.

## Self-Check: PASSED

- All 13 created files exist on disk
- All 4 task commits exist in git log (c46f571, e5b11a8, c66fbff, 3ff663f)
- `preflight-plugin` registered in server/index.ts
- `rules_version` rendered in web/src/lib/components/PreflightChecklist.svelte
- 18 spec assertions pass (`npx vitest run server/preflight/__tests__/`)

---
*Phase: 37-platform-extensions*
*Completed: 2026-05-17*
