# Phase 31 — Quick Wins: Logs, Job Config & CLI Polish

**Track:** DX / DF
**Effort:** ~1.5 days
**Source ideas:** simutil (logcat parser, cold-boot), simvyn (batch flush, CLI auto-update banner)

## Goal

Land four small, isolated quality-of-life improvements that compound into much better daily UX without touching device-stream internals or DB schema (one tiny `jobs` column added).

## Why

Highest ROI moves in v3.0: each < ½ day, removes a daily annoyance, no architectural risk. Bundling them as one phase amortizes the planning/PR overhead.

## Scope

### In
1. **Logcat parser + crash auto-tag** — parse Android threadtime lines server-side, expose `{level, isCrash}` per broadcast, set `jobs.failure_class = 'crash'` when a crash signature appears.
2. **Job log WS batch-flush** — coalesce sub-150ms log emissions into a single WS frame.
3. **Cold-boot / no-audio per-job options** — new optional fields on the job spec that flow through `EmulatorDriver.boot()`.
4. **CLI auto-update check** — non-blocking GitHub-releases poll on `device-farm` startup, prints a banner when a newer version exists.

### Out
- iOS log parsing (different pipeline, separate)
- Logcat search UI overhaul (just need the parsed payload, UI iterates later)
- Auto-installing the CLI update (just notify)

## Tasks

### T-31.1 — Logcat parser + crash tag (~3h)

**Files**
- `server/jobs/log-parsing.ts` (new, ~80 LOC)
- `server/jobs/job-broadcaster.ts` (modify)
- `server/db/schema.ts` (add `failure_class` enum column to `jobs`)
- `server/jobs/__tests__/log-parsing.test.ts` (new)

**Implementation**

Port `lib/plugins/logcat/logcat_helper.dart` (simutil). Core regex:

```
threadtime format: MM-DD HH:MM:SS.mmm  PID  TID  L  TAG: msg
regex:  ^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$

crash markers (must also be level=E for confirmation):
  /FATAL EXCEPTION/i
  /Fatal signal \d+/i
  /beginning of crash/i
  /AndroidRuntime: FATAL/i
```

Wire into `job-broadcaster.ts`: when a logcat line is pushed, parse it; if `isCrash` and `failure_class` is null, set it via Drizzle update + emit a `{ type: 'crash-detected', firstLine }` WS event.

**Verify:** unit tests on 5 real fixtures (`__tests__/fixtures/logcat-*.txt`), crash detection for AndroidRuntime + native signals + ANR header, negative tests for user-app log lines that mention "FATAL" without level E.

### T-31.2 — WS batch-flush (~2h)

**Files**
- `server/jobs/job-broadcaster.ts` (modify)

**Implementation**

Currently each log line is sent immediately. Replace with per-connection buffer flushed by `setInterval(flush, 150)` and on `bufferLen >= 64` (whichever first). Drain on disconnect.

```
class FlushQueue:
  buf: WsEnvelope[] = []
  timer = setInterval(() => this.flush(), 150)
  push(msg): buf.push(msg); if (buf.length >= 64) this.flush()
  flush(): if (!buf.length) return; sock.send({type:'batch', items:buf}); buf=[]
  close(): clearInterval(timer); this.flush()
```

Client (`web/src/lib/api/ws.ts`) unwraps the `batch` envelope. **Backwards-compat:** keep non-batch envelopes working; clients can opt-out with `?nobatch=1`.

**Verify:** load test — submit a job that prints 10k log lines, observe WS frames drop from ~10k to ~70 with no message loss (replay against the broadcaster's history buffer).

### T-31.3 — Cold-boot / no-audio per-job (~2h)

**Files**
- `server/config/schema.ts` (extend JobSpec with `bootOptions?: BootOptions`)
- `server/pool/android/emulator.ts:91-103` (consume opts when building argv)
- `cli/cmd/run.go` (new flags `--cold-boot`, `--no-audio`)
- `server/api/jobs.ts` (thread option into job creation)

**Implementation**

```
BootOptionsSchema = z.object({
  coldBoot: z.boolean().default(false),
  noAudio: z.boolean().default(true),
  gpu: z.enum(['swiftshader_indirect','host','auto']).default('swiftshader_indirect'),
})
```

Replace hardcoded argv:
```
args = ['-avd', avd, '-port', port, '-no-window', '-no-boot-anim']
if opts.coldBoot: args.push('-no-snapshot-load')
if opts.noAudio:  args.push('-no-audio')
args.push('-gpu', opts.gpu)
```

CLI Go: add flags, include in multipart metadata as `boot_options` JSON.

**Verify:** integration test booting an emulator twice — once cold (no snapshot), once warm. Assert behaviour difference via `adb shell getprop sys.boot_completed` timing.

### T-31.4 — CLI auto-update banner (~2h)

**Files**
- `cli/internal/updates/check.go` (new)
- `cli/cmd/root.go` (call check in `PersistentPreRun`)
- `cli/internal/ui/banner.go` (new — simple ANSI box)

**Implementation**

On startup, fire-and-forget goroutine: `GET https://api.github.com/repos/<org>/device-farm/releases/latest`, compare `tag_name` with `version.Version` (semver). If newer, print a small box:

```
+-----------------------------------------+
|  Update available: v1.2.3 -> v1.3.0     |
|  Run: device-farm self-update           |
+-----------------------------------------+
```

Cache result in `~/.cache/device-farm/update-check.json` for 24h. Honor `DEVICE_FARM_NO_UPDATE_CHECK=1`, `--quiet`, `$CI`. Validate `tag_name` against `^v\d+\.\d+\.\d+(-[\w.]+)?$` before printing. Use Go stdlib `net/http` with 3s timeout; no third-party dep.

**Verify:** `go test ./internal/updates/...` mocking the GitHub response; smoke test with real endpoint behind a feature flag.

## Acceptance criteria

- [ ] A job that logs `FATAL EXCEPTION` finishes with `failure_class = 'crash'` and the dashboard surfaces a "Crash detected" badge.
- [ ] Submitting a 10k-line job results in < 100 WS frames on the dashboard.
- [ ] `device-farm run --cold-boot ...` warm-boots the AVD without snapshots (measurable in emulator log).
- [ ] Running `device-farm` while a newer GitHub release exists prints the banner; with `DEVICE_FARM_NO_UPDATE_CHECK=1` it does not.
- [ ] `npm test` and `cd cli && make test` green.
- [ ] No regression: pre-existing job pipeline E2E still passes.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Batch-flush breaks older CLI clients | Keep emitting unbatched frames when client sends `?nobatch=1` |
| GitHub API rate limit | 24h disk cache; skip on `$CI`; honor opt-out env var |
| Crash regex false-positive on user app logs | Require level `E` AND threadtime match AND keyword |

## References

- simutil: `lib/plugins/logcat/logcat_helper.dart` (regex, `is:*` filters, `looksLikeCrash`)
- simutil: `lib/models/android_quick_launch_option.dart` (boot variants enum)
- simvyn: `packages/modules/log-viewer/log-streamer.ts:144-249` (batch flush, 150ms / 10k buffer)
- simvyn: `packages/cli/src/index.ts` (upgrade flow & banner)
- Current code: `server/pool/android/emulator.ts:91-103`, `server/jobs/job-broadcaster.ts`

## Done = Nyquist-compliant

Set `nyquist_compliant: true` in `STATE.md` after merging. Required: parser unit tests, batch-flush soak, boot flag E2E, CLI banner mock test.
