# Phase 31: Quick Wins — Logs, Job Config & CLI Polish - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Four small, isolated quality-of-life improvements that compound into better daily UX without touching device-stream internals or DB schema (one tiny `jobs` column added):

1. Server-side Android logcat parsing + crash auto-tagging
2. Job log WebSocket batch-flush (150ms windows)
3. Per-job emulator boot options (cold-boot, no-audio, gpu)
4. Go CLI auto-update banner from GitHub releases

Out of scope: iOS log parsing (separate pipeline), logcat search UI overhaul (UI iterates later), auto-installing the CLI update (notify only).

</domain>

<decisions>
## Implementation Decisions

### Logcat parser
- Server-side parsing in `server/jobs/log-parsing.ts` (new, ~80 LOC)
- Regex matches Android threadtime format: `^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$`
- Crash markers (must also confirm level `E`): `FATAL EXCEPTION`, `Fatal signal \d+`, `beginning of crash`, `AndroidRuntime: FATAL`
- Emit `{level, isCrash, tag, msg}` alongside raw line in WS broadcasts
- New `jobs.failure_class` enum column (`'crash' | 'timeout' | 'cancelled' | null`)
- Set `failure_class = 'crash'` on first crash detection; emit `{type: 'crash-detected', firstLine}` WS event
- False-positive defense: require level `E` AND threadtime match AND keyword (3-of-3)

### WS batch-flush
- `FlushQueue` class per WS connection in `server/jobs/job-broadcaster.ts`
- Flush on `setInterval(flush, 150)` OR `bufferLen >= 64` (whichever first)
- Drain on disconnect
- Envelope: `{type: 'batch', items: WsEnvelope[]}` — client unwraps and dispatches each
- Backwards-compat: clients can opt-out with `?nobatch=1` query string (still emit unbatched)
- Verify: 10k log lines → < 100 WS frames received

### Job boot options
- New Zod schema `BootOptionsSchema = { coldBoot: bool default false, noAudio: bool default true, gpu: 'swiftshader_indirect'|'host'|'auto' default 'swiftshader_indirect' }`
- Plumb through `server/api/jobs.ts` job creation → `server/pool/android/emulator.ts:91-103` argv construction
- CLI Go flags: `--cold-boot`, `--no-audio` (carried in multipart metadata as `boot_options` JSON)
- Replace hardcoded argv with options-driven; if coldBoot push `-no-snapshot-load`; if noAudio push `-no-audio`; always push `-gpu <gpu>`

### CLI auto-update banner
- `cli/internal/updates/check.go` — fire-and-forget goroutine on `PersistentPreRun`
- Endpoint: `GET https://api.github.com/repos/<org>/device-farm/releases/latest` (3s timeout via `net/http` stdlib)
- Compare `tag_name` with `version.Version` (semver); validate `tag_name` against `^v\d+\.\d+\.\d+(-[\w.]+)?$` before printing
- Cache result in `~/.cache/device-farm/update-check.json` for 24h
- Suppress when: `DEVICE_FARM_NO_UPDATE_CHECK=1`, `--quiet`, `$CI` set
- Banner: simple ASCII box (no third-party dep)

### Claude's Discretion
- Exact `<org>` GitHub repo URL for releases endpoint — Claude reads from CLI version metadata or asks during execution
- Exact Drizzle migration filename/timestamp format follows existing convention
- Vitest test file fixture set: pick 5 representative logcat outputs (crash, ANR, native sigsegv, normal verbose, mixed)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/jobs/job-broadcaster.ts` — existing per-job WS broadcaster with 100-msg history replay; extend with FlushQueue
- `server/pool/android/emulator.ts:91-103` — current hardcoded argv `['-avd', avd, '-port', port, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect']`
- `server/config/schema.ts` — existing Zod-based config schema; co-locate `BootOptionsSchema` near `JobSpec`
- `server/db/schema.ts` — Drizzle table definitions; add `failure_class` column via `pgEnum` or `text` with check constraint
- `cli/cmd/root.go` — Cobra root; `PersistentPreRun` hook available

### Established Patterns
- Drizzle migrations via `drizzle-kit generate`
- Zod schemas for runtime validation of config and API inputs
- Job lifecycle events via the bus (from Phase 23 keystone module)
- Cobra commands consume metadata from multipart form-data (CLI → server contract)
- Tests under `server/jobs/__tests__/*.spec.ts` using Vitest; mock factories for Pool, Database, Config, Logger

### Integration Points
- `server/jobs/job-broadcaster.ts` is consumed by `web/src/lib/api/ws.ts` (dashboard) and CLI WS subscription in `cli/cmd/logs.go` — both need batch-aware updates
- `server/api/jobs.ts` job creation route accepts multipart; new `boot_options` field added to metadata parser
- Database migration applied via `npx drizzle-kit push` in dev / standard migration in prod

</code_context>

<specifics>
## Specific Ideas

Port the logcat regex and `is:*` filter tokens from simutil's `lib/plugins/logcat/logcat_helper.dart`. Port the batch-flush 150ms / 10k buffer pattern from simvyn's `packages/modules/log-viewer/log-streamer.ts:144-249`. Boot option enum mirrors simutil's `android_quick_launch_option.dart`. CLI banner pattern lifted from simvyn's `cli/src/index.ts` (boxen-style ANSI box, but hand-rolled in Go without third-party dep).

</specifics>

<deferred>
## Deferred Ideas

- iOS log parsing (different pipeline, distinct effort, separate phase)
- Logcat search UI overhaul with `is:*` token field in dashboard (the parsed payload makes this trivial later)
- Auto-install on CLI update (notify-only for safety)
- Crash classification beyond "crash" (ANR, OOM, native, RuntimeException subtype) — first the column, then richer taxonomy in a later phase
- Additional crash markers (Hermes RN runtime errors, Flutter crash signatures) — extend marker set after telemetry shows demand

</deferred>
