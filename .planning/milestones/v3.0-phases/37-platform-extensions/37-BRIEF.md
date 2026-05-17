# Phase 37 — Platform Extensions: Skeleton, Preflight, GitHub PR, Parallel Patterns

**Track:** DF
**Effort:** ~6 days
**Source ideas:** app-explorer (iOS skeleton), mobile-devtools (Greenlight, PR review bot), kittyfarm (InputCoordinator fan-out, BuildPlayRunner)
**Depends on:** Phase 34 (sessions). Phase 36 helpful but not required.

## Goal

Close v3.0 with four independent feature drops that round out the platform: iOS binary screen extraction, App Store preflight scanning, GitHub PR comment integration mirroring the existing Azure path, and parallel input/build patterns lifted from kittyfarm.

## Why

These are individually medium-effort features but share the same operating surface (`server/`, `cli/`, `web/`) and don't require deep infra changes — so we bundle them to fit a 1-week phase. Each unlocks a distinct customer story:

- **Skeleton** — "what screens does this binary even have?" before writing flows.
- **Preflight** — "will the App Store reject this build?" before submit.
- **GitHub PR** — Azure already works; GitHub is where most users are.
- **InputBroadcaster + Build-Once-Deploy-N** — power-user features for parallel testing.

## Scope

### In
- iOS static skeleton extraction in Go CLI (`device-farm analyze app.ipa`).
- `analyses` table linking skeletons to builds; web viewer.
- Preflight runner: parses `Info.plist`, `PrivacyInfo.xcprivacy`, IPA binary for forbidden symbols; produces compliance report.
- GitHub integration plugin (mirror of existing Azure plugin): GitHub App auth, webhook receive, `commentOnPR(prNumber, body, imageUrls)`.
- `jobs` schema extension: `github_pr_id`, `github_pr_comment_id`, `github_integration_id` (same pattern as commit `afe215c`).
- CLI flag `--github-pr <num>` mirroring `--azure-pr`.
- `InputBroadcaster` service: fan-out a normalized touch to N leased sessions.
- Build-once-deploy-N: a job spec mode that builds an IPA/APK once and installs+launches on all matching devices in parallel.

### Out
- Figma checker (deferred per user)
- Security scanner / pentest (out of milestone)
- Android skeleton extraction (`aapt`-based — fast follow in v3.1)
- Push notification testing (consider for v3.1)

## Tasks

### T-37.1 — iOS skeleton extraction (~6h)

**Files**
- `cli/cmd/analyze.go` (Go subcommand)
- `cli/internal/macho/parser.go` (Mach-O `__objc_classlist` + `__swift5_types` parser)
- `cli/internal/macho/swift_demangle.go` (wraps `xcrun swift-demangle -compact`)
- `cli/internal/macho/hermes.go` (RN Hermes bundle string scan)
- `cli/internal/macho/__tests__/*.go`

Port `app-explorer/app_explorer/skeleton/ios.py` to Go. ~600 LOC equivalent.

**Output JSON**
```
{
  schema_version: 1, platform: 'ios',
  app: { bundle_id, bundle_name, version, executable, url_schemes, minimum_os },
  react_native_bundle: { path, size_bytes, is_hermes } | null,
  stats: { objc_classlist_total, swift5_types_section_total, candidate_screens, screens_by_kind, screens_by_source, deep_link_entries },
  candidate_screens: [{name, qualified_name, module, kind: 'viewcontroller'|'screen'|'view', confidence:'high'|'medium'|'low', source: 'objc'|'swift'|'hermes'}],
  deep_link_entries: [{scheme, is_oauth_callback, note}],
  known_gaps: []
}
```

**Submit to server** for storage:
- `POST /api/builds/:id/skeleton` (multipart: skeleton.json) → returns `analysisId`.
- `analyses` table: `(id, build_artifact_id, platform, payload jsonb, created_at)`.

**Heuristics** (copied from `_SCREEN_HEURISTICS`):
- `*ViewController` → high
- `*Screen` → high
- `*Page|*Sheet|*Modal` → medium
- `*View` → low + suffix filter for noise (`BadgeView`, `IconView`, ...)
- React Native Hermes: regex `[A-Z][a-z][A-Za-z]{2,40}?Screen` rejecting concatenation artifacts (>3 camelCase boundaries, >38 chars, known fragments)

### T-37.2 — Skeleton viewer (~3h)

**Files**
- `web/src/routes/builds/[id]/skeleton/+page.svelte`
- `web/src/lib/components/SkeletonReport.svelte`

Table view grouped by module / confidence with deep-link list. Cross-link to: "Start exploration seeded by this skeleton" (CTA to Phase 35 `/explorations/new?seed=<analysisId>`).

### T-37.3 — Greenlight preflight (~5h)

**Files**
- `server/preflight/index.ts` (plugin)
- `server/preflight/rules/ios-info-plist.ts`
- `server/preflight/rules/ios-privacy-manifest.ts`
- `server/preflight/rules/ios-forbidden-symbols.ts`
- `server/preflight/rules/__data__/forbidden-symbols.json` (bundled rule pack)
- `server/api/preflight.ts` (`POST /api/preflight`)
- `web/src/routes/preflight/+page.svelte`

**Rules**
- `Info.plist`: required usage descriptions (`NSCameraUsageDescription` etc. — derived from app's used APIs via `nm`); `ITSAppUsesNonExemptEncryption`; deprecated keys.
- `PrivacyInfo.xcprivacy`: required `NSPrivacyAccessedAPITypes` for `UserDefaults`, `FileTimestamp`, `SystemBootTime`, `DiskSpace`, `ActiveKeyboards` when symbols match.
- Forbidden API symbols (`SystemConfiguration` private, IDFA without ATT, etc.) — bundled rule pack JSON.
- IPA binary: run `otool -l` and check executable for unsupported architectures (32-bit), missing bitcode, oversized binary.

**Output** RFC 7807 Problem+JSON if any blocker; otherwise pass with warnings array.

**Web UI**: drag-drop IPA → upload → progress → checklist (red/yellow/green) per rule.

### T-37.4 — GitHub integration (~6h)

**Files**
- `server/integrations/github/index.ts` (plugin mirror of `server/integrations/azure/`)
- `server/integrations/github/app-auth.ts` (JWT install token flow)
- `server/integrations/github/webhook.ts` (`POST /webhooks/github`)
- `server/integrations/github/comments.ts` (`commentOnPR(installationId, owner, repo, prNumber, body)`)
- `server/db/schema.ts` (extend `jobs` with `github_pr_*` columns + migration)
- `cli/cmd/run.go` (add `--github-pr <num>` flag, sets metadata)
- `server/api/jobs.ts` (route metadata → post comment + edit-in-place on completion)
- `docs/runbooks/github-integration.md`
- `examples/.github/workflows/device-farm-pr.yml`

**Comment template**
```markdown
### 📱 Device Farm — Job #<id>

| Status | Device | Duration |
|---|---|---|
| ✅ Passed | Pixel 8 / Android 15 | 2m 13s |

<details>
<summary>Screenshots (3)</summary>

![home](https://artifacts.../shot1.png)
![login](https://artifacts.../shot2.png)
![success](https://artifacts.../shot3.png)

</details>

[Open job ↗](https://device-farm/jobs/<id>) · [Logs](...) · [Video](...)
```

Use signed-URL artifacts as remote images (GitHub Markdown supports them; no extra hosting).

**Idempotency**: on job updates, edit the existing comment (stored `github_pr_comment_id`) instead of posting new ones — matches Azure behavior.

**Security**: webhook HMAC-verified (`x-hub-signature-256`); installation tokens cached with TTL; never log tokens.

### T-37.5 — InputBroadcaster (~3h)

**Files**
- `server/sessions/broadcaster.ts`
- `server/sessions/__tests__/broadcaster.test.ts`
- WS endpoint extension: `/api/sessions/broadcast` accepts `{sessionIds: [...], action}` and fans out

```
broadcast({sessionIds, action}):
  await Promise.all(sessionIds.map(id => actions.dispatch(id, action)))
  return { results: [{sessionId, ok, error?}, ...] }
```

NormalizedTouch (x, y in 0..1) is converted to pixel coords per device inside dispatch (each session knows its device's screen size).

**Web UI hook**: in `/sessions/[id]` debug page, add a "Mirror to: [multi-select]" dropdown — taps then fan out.

### T-37.6 — Build-once-deploy-N (~3h)

**Files**
- `server/jobs/parallel-deploy.ts`
- `server/api/jobs.ts` (job spec `mode: 'parallel-deploy'`)

```
runParallelDeploy(job):
  // Build step performed once (existing artifact upload flow)
  apk = job.artifacts.apk
  devices = await pool.allocateMany(job.platform, job.parallelism)
  await Promise.all(devices.map(d => installAndLaunch(d, apk, job.maestroFlow)))
  // Aggregate per-device results
```

Job result groups per-device with summary status. UI shows N stream tiles side by side.

### T-37.7 — Webhook payload extension (~1h)

**Files**
- `server/reporting/webhook-payload.ts`

Add to payload:
- `preflight: {pass: bool, blockers: [...], warnings: [...]} | null`
- `analysis: {analysisId, candidateScreensCount, deepLinks: [...]} | null`
- `parallelDeploy: {devices: [...]} | null`

All v3.0 webhooks include these new optional fields without breaking existing consumers.

## Acceptance criteria

- [ ] `device-farm analyze sample.ipa` outputs valid skeleton JSON; `POST /api/builds/:id/skeleton` stores it.
- [ ] `/builds/[id]/skeleton` renders the screen list with confidence badges + deep links.
- [ ] `POST /api/preflight` returns blockers for a known-bad sample IPA; passes for a known-good one.
- [ ] GitHub App pairs with a sandbox repo; `--github-pr` posts a comment with screenshots; subsequent updates edit it.
- [ ] HMAC verification rejects forged webhook payloads.
- [ ] InputBroadcaster: a tap broadcast to 3 sessions hits 3 devices within 100ms of each other.
- [ ] `mode: parallel-deploy` job runs an APK on 3 emulators in parallel; UI shows 3 tiles.
- [ ] All v3.0 webhooks include new optional fields without breaking existing consumers.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Mach-O parsing breaks on new Xcode | Cite app-explorer's tested implementation; CI matrix against bundled fixtures |
| GitHub Markdown strips signed-URL images if too long | Limit to 5 inline screenshots; rest behind `<details>` link to dashboard |
| Preflight rule pack drifts behind Apple | Surface "rules updated: YYYY-MM-DD" in UI; doc upgrade path |
| Parallel deploy hits port pool exhaustion | Reuse Phase 31/33 port allocator; cap parallelism per platform config |
| InputBroadcaster races: one session fails | Surface partial results; do not roll back successful sends |

## References

- app-explorer: `app_explorer/skeleton/ios.py` (Mach-O parser, 722 LOC)
- app-explorer: `app_explorer/skeleton/react_native.py` (Hermes scan, 199 LOC)
- mobile-devtools README: Greenlight + PR Review Bot descriptions
- kittyfarm: `KittyFarm/Input/InputCoordinator.swift` (broadcast pattern, 45 LOC)
- kittyfarm: `KittyFarm/Lifecycle/BuildPlayRunner.swift:118-141` + `:371-417` (parallel deploy)
- Existing code: `server/integrations/azure/` (mirror this for github), commit `afe215c` (PR comment_id pattern)

## Done = Nyquist-compliant

Skeleton fixtures (good IPA + RN IPA) under `cli/internal/macho/__tests__/fixtures/`; preflight rule unit tests + golden-file integration tests; GitHub plugin contract test with mocked GH API; broadcaster fan-out concurrency test; parallel-deploy E2E with 3 emulators.
