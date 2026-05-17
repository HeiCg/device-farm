# preflight

Phase 37 Plan 37-00 Track B scaffold (Wave 0). Greenlight App Store preflight scanner — IPA/APK static analysis against a versioned rule pack.

## Purpose

Greenlight App Store preflight scanner — IPA/APK static analysis against a versioned rule pack. Detects known App Store rejection blockers (ITMS-91053 missing PrivacyInfo manifest, ATT-missing-for-IDFA, minimum-OS mismatch, missing entitlements) BEFORE the binary reaches Apple/Google review.

The rule pack lives at `server/preflight/rules/__data__/forbidden-symbols.json` and is versioned via `schema_version` + `rules_updated`. Updates to the pack require bumping `rules_updated` so the verifier subscriber re-runs on stale `preflight_runs` rows (Wave 2 deferred).

Wave 0 ships only scaffolding — `createPreflightModule` returns `null`. Wave 1 (Plan 37-02) implements the binary parser + rule evaluator.

## Public API

Exports from `server/preflight/index.ts`:

| Symbol | Source | Purpose |
|--------|--------|---------|
| `createPreflightModule` | `./internal/module.js` | MOD-06 factory; constructs the scanner + rule loader |
| `PreflightModule` (type) | `./internal/module.js` | Factory return type — Wave 0: `null`; Wave 1: `{scan, getRulePack}` |
| `preflightPlugin` | `./plugin.js` | Default Fastify plugin |
| `preflightReportSchema` | `./schemas.js` | Zod schema for the scan output |
| `PreflightReport` (type) | `./schemas.js` | `z.infer<typeof preflightReportSchema>` |

Fastify decorators exposed by the plugin:

- `fastify.preflightModule: PreflightModule | null`

## Events Emitted

| Event | Payload | Persisted | aggregateType |
|-------|---------|-----------|---------------|
| `preflight.completed` | `{preflightRunId, status, blockerCount, warningCount}` | true (Wave 1) | preflight |

Wave 0: constant only — emit wiring lands in Wave 1.

## Events Consumed

None in Wave 0. Wave 1 may subscribe to `analysis.ingested` to auto-run preflight on every uploaded skeleton (deferred — UI drag-drop is the primary path).

## Queue Produced

None. Preflight scans are synchronous (~1-3 seconds per IPA). If parser-side latency grows past 5s in Wave 1, extract to a `preflight.scan` queue (DEFERRED-37-B).

## Queue Consumed

None.

## Invariants

1. **Rule pack schema_version stable** — `forbidden-symbols.json.schema_version` is `1` until breaking changes; old rule packs CANNOT mask new rejection categories silently.
2. **Status discriminated** — every `preflight_runs.status` is one of `pass | pass_with_warnings | blocked`; service layer Zod-validates before insert.
3. **Blockers immutable per run** — once a `preflight_runs` row is written, `blockers`/`warnings` arrays are never mutated. Re-running creates a NEW row with the same `filename` but newer `rulesVersion` (audit trail preservation).

## Non-Goals

- **Auto-fix suggestions** — preflight reports the issue; fix is the developer's responsibility. A future agent integration could propose Info.plist diffs but that's out of scope.
- **App Store metadata validation** — only binary-level checks (PrivacyInfo, Info.plist, executable symbols). App description / screenshots live elsewhere (App Store Connect).
- **Android Play Store rules** — Wave 0/1 ship iOS rules only. Android rule pack is DEFERRED-37-C.
- **Real-time rule pack updates** — rule pack ships embedded; restart required to load new rules. A hot-reload path (file-watcher) is DEFERRED-37-D.

## Dependencies

Plugin metadata (`server/preflight/plugin.ts`):

```javascript
dependencies: ['config', 'db']
```

- `config` — Wave 1 reads `fastify.config.preflight.enabled` (default true).
- `db` — `fastify.db` for `preflight_runs` table insert/select.

### Runnable Example

```typescript
// Wave 1 will accept this:
// curl -X POST http://localhost:3000/api/preflight \
//   -H 'authorization: Bearer <key>' \
//   -F 'file=@MyApp.ipa'
//
// Returns PreflightReport JSON shape:
import { preflightReportSchema } from 'server/preflight';

const report = preflightReportSchema.parse({
  status: 'blocked',
  rules_version: '2026-05-16',
  platform: 'ios',
  blockers: [{
    rule_id: 'ITMS-91053-USERDEFAULTS',
    message: 'NSUserDefaults used without privacy manifest declaration',
  }],
  warnings: [],
});
```

Wave 1: plugin is registered after `apiPlugin` so `@fastify/multipart` is decorated when the `POST /api/preflight` handler runs (`req.file()`).

### Phase 37 deferrals

- **Android `.apk` rule pack** — Wave 1 returns `ANDROID-COMING-V31` warning for any Android upload. Real rules deferred to v3.1 as `DEFERRED-37-A`. See `.planning/phases/37-platform-extensions/deferred-items.md`.
- **`npm run preflight:update` rule-pack refresh mechanism** — `DEFERRED-37-I`, target v3.1 (Pitfall 6 followup).
- **Dynamic analysis / iOS runtime sandboxing** — out of scope; static scan only.
