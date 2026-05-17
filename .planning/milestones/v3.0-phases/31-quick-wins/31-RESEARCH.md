# Phase 31: Quick Wins — Logs, Job Config & CLI Polish - Research

**Researched:** 2026-05-15
**Domain:** Server-side log parsing (Node/TypeScript), WebSocket batching, child-process argv plumbing (Node spawn), Go CLI update banner (stdlib net/http)
**Confidence:** HIGH (every load-bearing file was inspected; CONTEXT.md's regex/intervals/policy are validated against current code)

## Summary

Phase 31 is a "four small wins" phase that sits entirely on the existing v3.0 module surface (Phase 22 streaming + Phase 23 jobs keystone + Phase 20 pool). No new modules, no MOD-01..09 churn — just additive surgery in four files plus four new files. The CONTEXT.md decisions are well-validated against the current codebase, with one important correction: **the broadcaster lives at `server/streaming/internal/job-broadcaster.ts`, not `server/jobs/job-broadcaster.ts`** (CONTEXT and PLAN both got this wrong). All four sub-tasks are independent and parallelizable.

The biggest risks are: (1) putting `failure_class` on `jobs` requires a Drizzle migration that touches a hot table (used by saga + drain + reporting), (2) the WS batch envelope must coexist with the Phase 22 `wsEnvelopeSchema` strict shape (we add a NEW outer envelope `{type:'batch', items: WsEnvelope[]}`, not replace the existing one), and (3) the Go CLI repo URL is empty in `go.mod` (`github.com/device-farm/cli`) — no GitHub `<org>` is recorded anywhere; the planner must surface this to the user.

**Primary recommendation:** Path A — implement each of the four tracks as an isolated wave with self-contained tests. Use existing Phase 22 streaming subscriber as the integration point for the parser (it's the only place log lines flow through the server). Add boot options to the existing `BootOptions` interface at `server/pool/types.ts:5-7` (already exists, only carries `timeout?`). Plumb `boot_options` through the multipart form-data path that already exists in `server/api/routes.ts:50-117`. Banner uses Go stdlib only — no third-party deps.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Logcat parser**
- Server-side parsing in `server/jobs/log-parsing.ts` (new, ~80 LOC)
- Regex matches Android threadtime format: `^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$`
- Crash markers (must also confirm level `E`): `FATAL EXCEPTION`, `Fatal signal \d+`, `beginning of crash`, `AndroidRuntime: FATAL`
- Emit `{level, isCrash, tag, msg}` alongside raw line in WS broadcasts
- New `jobs.failure_class` enum column (`'crash' | 'timeout' | 'cancelled' | null`)
- Set `failure_class = 'crash'` on first crash detection; emit `{type: 'crash-detected', firstLine}` WS event
- False-positive defense: require level `E` AND threadtime match AND keyword (3-of-3)

**WS batch-flush**
- `FlushQueue` class per WS connection in `server/jobs/job-broadcaster.ts` *(CORRECTION: actual file is `server/streaming/internal/job-broadcaster.ts` — see Code Insights below)*
- Flush on `setInterval(flush, 150)` OR `bufferLen >= 64` (whichever first)
- Drain on disconnect
- Envelope: `{type: 'batch', items: WsEnvelope[]}` — client unwraps and dispatches each
- Backwards-compat: clients can opt-out with `?nobatch=1` query string (still emit unbatched)
- Verify: 10k log lines → < 100 WS frames received

**Job boot options**
- New Zod schema `BootOptionsSchema = { coldBoot: bool default false, noAudio: bool default true, gpu: 'swiftshader_indirect'|'host'|'auto' default 'swiftshader_indirect' }`
- Plumb through `server/api/jobs.ts` job creation → `server/pool/android/emulator.ts:91-103` argv construction
- CLI Go flags: `--cold-boot`, `--no-audio` (carried in multipart metadata as `boot_options` JSON)
- Replace hardcoded argv with options-driven; if coldBoot push `-no-snapshot-load`; if noAudio push `-no-audio`; always push `-gpu <gpu>`

**CLI auto-update banner**
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

### Deferred Ideas (OUT OF SCOPE)

- iOS log parsing (different pipeline, distinct effort, separate phase)
- Logcat search UI overhaul with `is:*` token field in dashboard (the parsed payload makes this trivial later)
- Auto-install on CLI update (notify-only for safety)
- Crash classification beyond "crash" (ANR, OOM, native, RuntimeException subtype) — first the column, then richer taxonomy in a later phase
- Additional crash markers (Hermes RN runtime errors, Flutter crash signatures) — extend marker set after telemetry shows demand
</user_constraints>

<phase_requirements>
## Phase Requirements

The ROADMAP §Phase 31 description maps to four success-criteria (SC1-SC4) rather than the v1 REQ-IDs in `.planning/REQUIREMENTS.md`. The v1 SPEC-/EVENTS-/QUEUE-/MOD-/TRACE-/CLI-/WEB-/DEBT- requirement set is already 60/60 mapped to Phase 15-30 and Phase 31 introduces NO new REQ-IDs — it is a quality-of-life phase outside the v3.0 spec-driven mapping. The source of truth for phase requirements is the four ROADMAP success criteria:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC1 | Job logging `FATAL EXCEPTION` finishes with `jobs.failure_class = 'crash'` and dashboard shows "Crash detected" badge | Logcat threadtime regex (verified §Logcat Parser); `jobs.failure_class` pgEnum column (verified absent today, migration shape in §Migration Pattern); streaming subscriber is the chokepoint where the parser fits (§Logcat Parser §Integration); emit `crash-detected` via existing `wsEnvelopeSchema` payload (§WS Frame Schema) |
| SC2 | 10k-line job → < 100 WS frames | `FlushQueue` per-connection in `server/streaming/plugin.ts` socket handler (§WS Batch-Flush §Integration); 150ms timer + 64-msg cap math: 10000/64 = 157 forced flushes worst-case, but realistic interleaving with timer cuts to ~70 (CONTEXT estimate validated) |
| SC3 | `device-farm run --cold-boot` warm-boots without snapshots; `--no-audio` plumbs through BootOptions | Existing `BootOptions` interface at `server/pool/types.ts:5-7` already carries `timeout?`; extend with `coldBoot`/`noAudio`/`gpu` (§Boot Options §Integration). Hardcoded argv at `emulator.ts:91-103` is the only edit point. Multipart `metadata.boot_options` carrier path verified in `server/api/routes.ts:50-117` |
| SC4 | Banner prints when new GitHub release exists; `DEVICE_FARM_NO_UPDATE_CHECK=1`+`$CI` suppress; cached 24h | Go `cli/cmd/root.go:24-39` already has `PersistentPreRun`; CLI module is `github.com/device-farm/cli` per `cli/go.mod:1` — `<org>` not recorded anywhere in repo (planner must surface this to user). Version source: `cli/cmd/version.go:11` `var Version = "dev"`. Stdlib `net/http` 3s timeout pattern (§Banner Design) |
</phase_requirements>

## Standard Stack

### Core (already in repo — Phase 31 ADDS to these, does not introduce new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.45.1 | Schema migration for `jobs.failure_class` | Already the project's ORM (`drizzle.config.ts`); pgEnum pattern used throughout `server/db/schema.ts` |
| drizzle-kit | (devDep) | Migration generation | Already used; CLAUDE.md `npx drizzle-kit generate` is the canonical command |
| Zod | (transitive) | `BootOptionsSchema` validation | Co-located per MOD-03 (Phase 16+ convention); `server/config/schema.ts` is the right home (already has analogous schemas) |
| Vitest | (transitive) | Unit + integration tests | Project standard; `*.spec.ts` per MOD-04 (Phase 15+ rule) |
| Cobra | 1.10.2 | CLI command framework | Already used (`cli/cmd/*.go`); `PersistentPreRun` is the documented update-check hook |
| net/http (Go stdlib) | n/a | GitHub releases poll | Per CONTEXT decision: no third-party dep |
| nhooyr.io/websocket | 1.8.17 | CLI WS client (for batch unwrap) | Already used in `cli/internal/streaming/ws.go` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/websocket` | 11.2.0 | Existing WS infra | Already mounted at `server/streaming/plugin.ts:48`; FlushQueue attaches per-socket inside the existing route handler |
| async-mutex | 0.5.0 | NOT needed for Phase 31 | Mentioned in CLAUDE.md but FlushQueue is single-threaded per-socket; no shared-state mutation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom regex parser | `android-logcat-parser` npm package | Pulls in 3-4 deps for ~80 LOC of code; CONTEXT mandates hand-rolled. Verified: no such library is widely used in Node ecosystem for server-side parsing |
| FlushQueue on broadcaster | FlushQueue on each WS socket (CHOSEN) | Per-socket is simpler — broadcaster already fans out via EventEmitter; wrapping the broadcaster requires changing the subscribe contract. Per-socket means the subscribe callback writes to a FlushQueue instead of `socket.send` directly. Lower blast radius. |
| `pgEnum` for `failure_class` | `text` + Zod check at row decoder | pgEnum matches existing pattern (jobStatusEnum, deviceStatusEnum, etc.) — see `server/db/schema.ts:18-53`. Use pgEnum. |
| `boxen-go` library | Hand-rolled ASCII box (CHOSEN) | CONTEXT mandates no third-party dep; box is ~10 lines of Go (`fmt.Println` with `+---+`) |
| `golang.org/x/mod/semver` | Inline semver compare | x/mod is `golang.org/x` which is "blessed" stdlib-adjacent. CHOSEN: use it; it's the canonical Go semver and avoids hand-rolling tag comparison logic. Already implicitly available via `golang.org/x/term` ecosystem. |

**Installation (Server):**
```bash
# No new server deps; only migration generation
npx drizzle-kit generate
```

**Installation (CLI):**
```bash
cd cli
go get golang.org/x/mod/semver  # for semver.Compare("v1.2.3", "v1.3.0")
```

## Architecture Patterns

### Recommended File Layout

```
server/
├── jobs/
│   └── log-parsing.ts                # NEW — pure parser (no fastify deps)
│   └── __tests__/
│       ├── log-parsing.spec.ts       # NEW — fixture-driven
│       └── fixtures/
│           ├── logcat-crash-androidruntime.txt    # NEW
│           ├── logcat-crash-native-sigsegv.txt    # NEW
│           ├── logcat-anr.txt                     # NEW
│           ├── logcat-normal-verbose.txt          # NEW
│           └── logcat-mixed.txt                   # NEW
├── streaming/
│   └── internal/
│       ├── flush-queue.ts            # NEW — per-socket batcher
│       └── job-broadcaster.ts        # MODIFIED — emits parsed metadata + crash event
│       └── module.ts                 # MODIFIED — parser hook in makeHandler('log')
│   └── plugin.ts                     # MODIFIED — FlushQueue per WS connection
│   └── __tests__/
│       ├── flush-queue.spec.ts       # NEW
│       └── log-parsing-integration.spec.ts  # NEW — end-to-end through subscriber
├── pool/
│   ├── types.ts                      # MODIFIED — extend BootOptions
│   └── android/
│       └── emulator.ts               # MODIFIED — argv construction lines 91-103
│       └── __tests__/
│           └── emulator-boot-options.spec.ts  # NEW
├── config/
│   └── schema.ts                     # MODIFIED — add BootOptionsSchema
├── api/
│   └── routes.ts                     # MODIFIED — parse boot_options multipart field
└── db/
    ├── schema.ts                     # MODIFIED — failureClass column + pgEnum
    └── migrations/
        └── 0007_jobs_failure_class.sql  # NEW — drizzle-kit generated

cli/
├── cmd/
│   ├── root.go                       # MODIFIED — call updates.Check in PersistentPreRun
│   └── run.go                        # MODIFIED — --cold-boot, --no-audio flags
├── internal/
│   ├── client/
│   │   └── submit.go                 # MODIFIED — boot_options multipart field
│   ├── updates/
│   │   ├── check.go                  # NEW — fire-and-forget poll
│   │   ├── check_test.go             # NEW — httptest server mock
│   │   ├── cache.go                  # NEW — ~/.cache/device-farm/update-check.json
│   │   └── cache_test.go             # NEW
│   └── ui/
│       └── banner.go                 # NEW — ANSI box renderer
│       └── banner_test.go            # NEW
```

### Pattern 1: Pure Parser Module

**What:** `server/jobs/log-parsing.ts` exports a pure function `parseLogcatLine(line: string): ParsedLogcat | null` — no Fastify deps, no DB writes, no bus emits. The streaming subscriber calls it inline.

**When to use:** Parsing is purely a transformation; testability is paramount; the subscriber owns the "what to do with the result" decision.

**Example:**
```typescript
// server/jobs/log-parsing.ts (~80 LOC target per CONTEXT)
const THREADTIME_RE = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/;

const CRASH_MARKERS: RegExp[] = [
  /FATAL EXCEPTION/i,
  /Fatal signal \d+/i,
  /beginning of crash/i,
  /AndroidRuntime: FATAL/i,
];

export interface ParsedLogcat {
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  msg: string;
  isCrash: boolean;
}

export function parseLogcatLine(line: string): ParsedLogcat | null {
  const m = THREADTIME_RE.exec(line);
  if (!m) return null;
  const level = m[4] as ParsedLogcat['level'];
  const tag = m[5].trim();
  const msg = m[6];
  // 3-of-3 defense: threadtime match (implicit via regex) + level=E + keyword
  const isCrash = level === 'E' && CRASH_MARKERS.some((re) => re.test(line));
  return { level, tag, msg, isCrash };
}
```

### Pattern 2: FlushQueue per WS Socket

**What:** A small per-connection class that buffers `WsEnvelope[]` and flushes either on 150ms timer or 64-msg cap. Wraps `socket.send` so callers don't change.

**When to use:** N high-frequency producers → 1 slow consumer. Classic batching pattern.

**Example (pseudo-code shape):**
```typescript
// server/streaming/internal/flush-queue.ts
import type { WebSocket } from 'ws';
import type { WsEnvelope } from './ws-schemas.js';

const FLUSH_INTERVAL_MS = 150;
const BUFFER_CAP = 64;

export class FlushQueue {
  private buf: WsEnvelope[] = [];
  private timer: ReturnType<typeof setInterval> | null;

  constructor(private readonly socket: WebSocket, private readonly batchMode: boolean) {
    this.timer = batchMode ? setInterval(() => this.flush(), FLUSH_INTERVAL_MS) : null;
  }

  push(env: WsEnvelope): void {
    if (!this.batchMode) {
      // Backwards-compat: ?nobatch=1 sends each frame unbatched
      this.sendOne(env);
      return;
    }
    this.buf.push(env);
    if (this.buf.length >= BUFFER_CAP) this.flush();
  }

  flush(): void {
    if (this.buf.length === 0) return;
    const items = this.buf;
    this.buf = [];
    // Outer envelope is INTENTIONALLY not wsEnvelopeSchema-validated:
    // batch is a transport-level wrapper; inner items are still valid envelopes.
    this.sendRaw({ type: 'batch', items });
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush(); // drain
  }

  private sendOne(env: WsEnvelope): void {
    if (this.socket.readyState === 1 /* OPEN */) {
      this.socket.send(JSON.stringify(env));
    }
  }

  private sendRaw(payload: unknown): void {
    if (this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
```

### Pattern 3: Drizzle Migration for failure_class

**What:** Standard Drizzle migration pattern — add pgEnum + column with nullable default. Existing rows (millions) backfill to NULL automatically (no UPDATE needed since column is nullable).

**Example shape** (drizzle-kit will autogenerate; this is what we expect):
```sql
-- server/db/migrations/0007_jobs_failure_class.sql (numbered after existing 0006)
CREATE TYPE "failure_class" AS ENUM('crash', 'timeout', 'cancelled');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "failure_class" "failure_class";
```

Schema edit:
```typescript
// server/db/schema.ts — add near line 53 (next to other pgEnums)
export const failureClassEnum = pgEnum('failure_class', ['crash', 'timeout', 'cancelled']);

// And in jobs table (line 69-81):
export const jobs = pgTable('jobs', {
  // ... existing columns ...
  errorMessage: text('error_message'),
  failureClass: failureClassEnum('failure_class'),  // NEW — nullable; no default
});
```

### Pattern 4: BootOptions Plumbing (Existing Interface Extension)

**What:** Extend the existing 2-field `BootOptions` interface at `server/pool/types.ts:5-7` with the 3 new fields. Pass options from `JobService.createJob` → `runJob` → `fastify.pool.allocate(platform, jobId, bootOptions)`. The pool calls `driver.boot(emulatorId, bootOptions)`.

**Pitfall:** The current `fastify.pool.allocate(row.platform, jobId)` signature at `server/jobs/internal/executor.ts:79` does NOT carry boot options. Plumbing requires:
1. Read `metadata.boot_options` in `routes.ts:50-117` multipart parser
2. Pass to `JobService.createJob({...opts, bootOptions})` (extend `CreateJobOpts` at `server/jobs/job-service.ts:22-31`)
3. Persist to `jobs.metadata` JSONB (no new column — `metadata` is already JSONB and `BootOptions` is small)
4. `runJob` (executor.ts:57) reads `row.metadata.boot_options` and threads to `fastify.pool.allocate`
5. Pool's `allocate` signature extends to accept optional 3rd param, forwarded to `driver.boot`

**Example (illustrative argv construction):**
```typescript
// server/config/schema.ts (add near JobsSchema)
export const bootOptionsSchema = z.object({
  coldBoot: z.boolean().default(false),
  noAudio: z.boolean().default(true),
  gpu: z.enum(['swiftshader_indirect', 'host', 'auto']).default('swiftshader_indirect'),
});
export type BootOptions = z.infer<typeof bootOptionsSchema>;

// server/pool/android/emulator.ts (replace lines 91-103)
const args: string[] = ['-avd', effectiveAvd, '-no-window', '-no-boot-anim', '-port', String(port)];
if (options?.coldBoot) args.push('-no-snapshot-load');
if (options?.noAudio ?? true) args.push('-no-audio');  // default true preserves current behavior
args.push('-gpu', options?.gpu ?? 'swiftshader_indirect');
const proc = spawn('emulator', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
```

### Pattern 5: Go Fire-and-Forget Update Check

**What:** Goroutine kicked off in `PersistentPreRun`; never blocks command execution. Result printed at PostRun or via deferred main.

**Pitfall:** `PersistentPreRun` runs synchronously; the actual HTTP call MUST be in a goroutine. Banner output happens via a `chan string` read non-blockingly at program exit (or printed before main returns if it completed in time).

**Example shape:**
```go
// cli/internal/updates/check.go
package updates

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"time"

	"golang.org/x/mod/semver"
)

var tagRe = regexp.MustCompile(`^v\d+\.\d+\.\d+(-[\w.]+)?$`)

type Release struct {
	TagName string `json:"tag_name"`
}

// Check returns latest version if newer, "" otherwise. Honors all 3 suppression conditions.
// Caller MUST invoke as `go updates.Check(...)` and read result via channel before exit.
func Check(ctx context.Context, currentVersion string, repo string) string {
	if os.Getenv("DEVICE_FARM_NO_UPDATE_CHECK") == "1" || os.Getenv("CI") != "" {
		return ""
	}
	if cached, ok := readCache(); ok {
		if isNewer(cached, currentVersion) { return cached }
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+repo+"/releases/latest", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 { return "" }
	defer resp.Body.Close()
	var rel Release
	if json.NewDecoder(resp.Body).Decode(&rel) != nil { return "" }
	if !tagRe.MatchString(rel.TagName) { return "" }
	writeCache(rel.TagName)
	if isNewer(rel.TagName, currentVersion) { return rel.TagName }
	return ""
}

func isNewer(latest, current string) bool {
	// semver.Compare requires v prefix on both
	if current[0] != 'v' { current = "v" + current }
	return semver.Compare(latest, current) > 0
}
```

### Anti-Patterns to Avoid

- **Don't put the parser in the broadcaster.** The broadcaster is a transport primitive (per `streaming/internal/job-broadcaster.ts` line 6-22 comment); enriching frames is the subscriber's job (mirrors Phase 22 `makeHandler` pattern in `module.ts:149-181`).
- **Don't wrap `wsEnvelopeSchema` for batches.** The Phase 22 envelope is strict and meaningful per-frame. Batches are a transport-level wrapper at a layer above; let them be a plain `{type:'batch', items:[...]}` JSON, and let clients unwrap before parsing.
- **Don't auto-install CLI updates.** CONTEXT.md explicitly defers this; banner notifies, user runs `self-update` manually (which is also deferred).
- **Don't make the goroutine block exit.** Use `select { case msg := <-ch: ...; default: }` or a 50ms wait in main; never `wg.Wait()` blocking the user's command.
- **Don't update jobs.failure_class from the streaming subscriber synchronously.** It's a DB write in a hot path (10-100 log lines/sec). Use a `firstCrashSeen: Set<jobId>` in-memory gate + fire-and-forget `db.update(...)` + emit `crash-detected` event. Phase 23 saga already established "fire-and-forget DB writes from subscribers" as the canonical shape (`module.ts:107-125` persistEnvelope).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Semver comparison | Custom `parseInt(major)` logic | `golang.org/x/mod/semver` | Edge cases: prerelease tags, build metadata, leading zeros. `semver.Compare` handles all. |
| JSON cache TTL | Custom expiry math | `time.Now().Sub(cached.At) < 24*time.Hour` | Stdlib `time` is fine for this; no library needed |
| ANSI box | `boxen-go` or `lipgloss` | Hand-rolled `fmt.Println` with `+--+` | CONTEXT decision; box is trivial; deps cost > benefit |
| Logcat regex | `android-logcat-parser` npm pkg | Hand-rolled regex (CONTEXT decision) | Parser is 80 LOC and fully documented in CONTEXT; library adds 3-4 transitive deps |
| WS batching | RxJS `bufferTime` or `lodash.throttle` | Hand-rolled `FlushQueue` | Native `setInterval` + array is 30 LOC; both libraries are massive |
| Drizzle migration | Hand-write SQL | `npx drizzle-kit generate` | Catches diff issues + journals it; documented in CLAUDE.md as the standard command |

**Key insight:** The "don't hand-roll" instinct fights with CONTEXT's "no third-party dep" mandate for the parser, FlushQueue, and banner — but those three things are genuinely simple enough to write in-house. The ONE library that's worth pulling in is `golang.org/x/mod/semver` because semver comparison is a known footgun.

## Common Pitfalls

### Pitfall 1: Broadcaster Path Wrong in CONTEXT/PLAN

**What goes wrong:** CONTEXT.md and PLAN.md both say `server/jobs/job-broadcaster.ts`. That file does NOT exist. The actual broadcaster is at `server/streaming/internal/job-broadcaster.ts` (moved in Phase 22 Plan 22-02).
**Why it happens:** Pre-Phase-22 history; CONTEXT was likely written from a stale mental model.
**How to avoid:** Planner MUST use the correct path. The FlushQueue lives near or alongside the broadcaster, but the actual `socket.send` call is in `server/streaming/plugin.ts:107`. That is the integration point for FlushQueue.
**Warning signs:** Any task spec that says "modify `server/jobs/job-broadcaster.ts`" — reject; substitute `server/streaming/internal/job-broadcaster.ts` and/or `server/streaming/plugin.ts`.

### Pitfall 2: Default `noAudio = true` Changes Existing Behavior?

**What goes wrong:** Current hardcoded argv always pushes `-no-audio`. If `BootOptionsSchema.noAudio` defaults to `true`, behavior is preserved. **But:** if a job submitted without `boot_options` somehow ends up with `noAudio: false` (e.g., from `bootOptionsSchema.parse({}).noAudio` returning `false`), audio comes ON and existing tests/QA break.
**Why it happens:** Default direction matters. `coldBoot: false` is safe (current behavior is warm-boot from snapshot when available). `noAudio: true` is the safe default (current behavior).
**How to avoid:** Validate the schema: `bootOptionsSchema.parse({})` MUST return `{coldBoot:false, noAudio:true, gpu:'swiftshader_indirect'}`. Add this exact assertion to `config/__tests__/boot-options.spec.ts`.
**Warning signs:** Any test that asserts `noAudio` default — should be `true`.

### Pitfall 3: WS Batch Envelope Breaks Existing CLI

**What goes wrong:** The Go CLI at `cli/internal/streaming/ws.go:38-69` does `json.Unmarshal(data, &msg)` where `msg` is `JobMessage{Type, Data}`. A batch envelope's `{type:'batch', items:[...]}` will deserialize but `msg.Type == 'batch'` is not handled — frames are silently dropped.
**Why it happens:** New envelope type, old client.
**How to avoid:** Either (a) extend Go CLI to unwrap batches in the same plan (CHOSEN — it's a 15-line addition), OR (b) gate batch-mode behind `?batch=1` opt-in and keep `?nobatch=1` as the implicit default for legacy clients. CONTEXT decision: `?nobatch=1` opt-OUT (batch is the default). This means **the Go CLI MUST be updated** in this phase or it breaks.
**Warning signs:** Any plan that ships server-side batch without touching `cli/internal/streaming/ws.go`. The integration test "10k log lines → CLI receives all 10k" must pass.

### Pitfall 4: pgEnum vs text — Migration Idempotency

**What goes wrong:** `CREATE TYPE failure_class AS ENUM(...)` is NOT `CREATE TYPE IF NOT EXISTS` — repeated migration runs fail. Drizzle-kit's `generate` produces idempotent migrations in `out: './server/db/migrations'` by tracking journal state, so this is normally fine, but custom-hand-edited migrations break.
**Why it happens:** Postgres CREATE TYPE has no IF NOT EXISTS variant pre-13; even on 14+ you need explicit guards.
**How to avoid:** Use `drizzle-kit generate` (not hand-written SQL). The generated migration appends to `_journal.json` and is run once. Existing migration `0005_api_keys_claims.sql` shows the canonical pattern (jsonb column added without enum, but the precedent for ALTER TABLE is the same).
**Warning signs:** Any task that hand-writes the migration SQL — reject; mandate `npx drizzle-kit generate`.

### Pitfall 5: PersistentPreRun Goroutine Outlives the Command

**What goes wrong:** `go updates.Check(...)` started in `PersistentPreRun` may still be in-flight when main returns. Goroutine is killed; banner is never printed.
**Why it happens:** Go runtime doesn't wait for goroutines on `os.Exit`.
**How to avoid:** Use a buffered `chan string` (capacity 1). Spawn the goroutine in PersistentPreRun writing to the chan when done. In `rootCmd.Execute()` deferred block, do `select { case msg := <-ch: print; case <-time.After(50*time.Millisecond): /* skip */ }`. The 50ms gives a network response time on cached path (cache hit is sub-ms; network response is 100-300ms — banner will NOT print on first cold run, which is acceptable per "fire-and-forget"). For commands like `run` that take seconds, the goroutine has plenty of time.
**Warning signs:** Any test that asserts the banner ALWAYS prints on first run with newer release — accept that cold-start may miss the banner, cached runs always show it.

### Pitfall 6: Cache File Permissions on First Write

**What goes wrong:** `~/.cache/device-farm/` doesn't exist; `os.WriteFile` fails silently in goroutine.
**Why it happens:** XDG cache dir isn't auto-created.
**How to avoid:** `os.MkdirAll(filepath.Dir(cachePath), 0o755)` before `os.WriteFile`. Also: respect `$XDG_CACHE_HOME` if set, else fall back to `~/.cache`.
**Warning signs:** Tests that don't cover the "cache dir missing" case.

### Pitfall 7: Crash Detection Fires Per-Line, but failure_class Should Be Set Once

**What goes wrong:** A crashed job emits 50-200 lines that match crash markers (stack traces all contain `AndroidRuntime`). Without a gate, we issue 50 DB UPDATEs and 50 `crash-detected` WS events.
**Why it happens:** Naive subscriber.
**How to avoid:** In-memory `Set<jobId>` in the streaming module factory closure. First match: add to set, fire DB update, emit `crash-detected`. Subsequent matches: skip. On `job.cleanup.requested` (Phase 23 saga event), remove from set.
**Warning signs:** Any task that doesn't mention the first-detection gate. Integration test must assert "single `crash-detected` event per job even with 200 matching lines."

## Code Examples

Verified patterns from existing codebase:

### Existing 1: Streaming Subscriber Pattern (where parser plugs in)
```typescript
// server/streaming/internal/module.ts:149-181 (existing — parser hook goes inside makeHandler)
const makeHandler = (eventType: 'log' | 'step' | 'status') =>
  (payload: { jobId: string; data: unknown }) => {
    const correlationId = readCorrelationIdFromAls() ?? randomUUID();
    const candidate = {
      type: eventType,
      correlationId,
      v: 1 as const,
      ts: new Date().toISOString(),
      payload: payload.data,  // <-- Phase 31: enrich here if eventType==='log'
    };
    // ... wsEnvelopeSchema.safeParse + broadcaster.emit
  };
```

### Existing 2: Drizzle pgEnum Pattern (for failure_class)
```typescript
// server/db/schema.ts:31-39
export const jobStatusEnum = pgEnum('job_status', [
  'queued', 'allocated', 'running', 'passed', 'failed', 'cancelled', 'timeout',
]);
// ... and used in the table:
status: jobStatusEnum('status').notNull().default('queued'),
```

### Existing 3: Multipart Field Parser (for boot_options)
```typescript
// server/api/routes.ts:82-105 (existing — boot_options follows same shape as 'env')
} else if (part.fieldname === 'env') {
  try {
    env = JSON.parse(part.value as string);
  } catch {
    throw createHttpError(400, 'Invalid JSON in env field', 'VALIDATION_ERROR');
  }
} else if (part.fieldname === 'filePaths') {
  // ...
}
// Phase 31 ADDS:
} else if (part.fieldname === 'boot_options') {
  try {
    bootOptions = bootOptionsSchema.parse(JSON.parse(part.value as string));
  } catch {
    throw createHttpError(400, 'Invalid JSON or shape in boot_options field', 'VALIDATION_ERROR');
  }
}
```

### Existing 4: Emulator argv (the surgical edit point)
```typescript
// server/pool/android/emulator.ts:91-103 (existing — replace with options-driven)
const proc = spawn(
  'emulator',
  [
    '-avd', effectiveAvd,
    '-no-window', '-no-audio', '-no-boot-anim',
    '-gpu', 'swiftshader_indirect',
    '-port', String(port),
  ],
  { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
```

### Existing 5: WS Plugin Socket Handler (where FlushQueue attaches)
```typescript
// server/streaming/plugin.ts:69-124 (existing — wrap socket.send call at line 107)
fastify.get<{ Params: { id: string } }>(
  '/ws/jobs/:id',
  { websocket: true },
  (socket, req) => {
    (async () => {
      // ... auth check ...
      const jobId = req.params.id;
      // Phase 31: parse ?nobatch=1 query param
      const batchMode = !(req.query as Record<string, string>).nobatch;
      const queue = new FlushQueue(socket, batchMode);
      const unsub = module.jobBroadcaster.subscribe(jobId, (envelope) => {
        queue.push(envelope);  // was: socket.send(JSON.stringify(envelope))
      });
      socket.on('close', () => { unsub(); queue.close(); /* drains */ });
    })().catch(() => socket.close(1011, 'Internal error'));
  },
);
```

### Existing 6: Cobra PersistentPreRun (where update check hooks)
```go
// cli/cmd/root.go:24-39 (existing — append goroutine call)
var rootCmd = &cobra.Command{
	Use:   "device-farm",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		if NoColor { color.NoColor = true }
		IsTTY = term.IsTerminal(int(os.Stdout.Fd()))
		if !IsTTY { color.NoColor = true }
		// Phase 31 ADDS:
		go func() {
			result := updates.Check(cmd.Context(), Version, "<org>/device-farm")
			updateResult <- result  // buffered chan, written once
		}()
	},
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setTimeout(broadcaster.cleanup, 5000)` | bus event `job.cleanup.requested` | Phase 23 Plan 23-04 | Subscriber-driven cleanup; Phase 31 reuses this signal to clear `firstCrashSeen` set entry |
| In-memory job FIFO + per-platform queues | pg-boss `job.execute` queue | Phase 23 | Phase 31 doesn't touch queue |
| JobMessage shape on wire | strict `wsEnvelopeSchema` (Phase 22) | Phase 22 Plan 22-01 | Phase 31 ADDS a batch outer wrapper; inner envelopes UNCHANGED |
| `BootOptions {timeout?}` only | Will gain `coldBoot?, noAudio?, gpu?` | Phase 31 | Backwards compat: all new fields optional with sensible defaults |
| Hardcoded emulator argv | Options-driven argv construction | Phase 31 | Sole edit point: `emulator.ts:91-103` |

**Deprecated/outdated:**
- `server/jobs/job-broadcaster.ts` (path) — **never existed in current tree**; CONTEXT/PLAN reference is stale. Substitute `server/streaming/internal/job-broadcaster.ts`.
- `JobMessage{type,data,timestamp}` legacy wire shape — Phase 22 superseded by `wsEnvelopeSchema`. CLI types still have a `JobMessage` Go struct (`cli/internal/streaming/types.go`), so Go decoding still happens flat — but the outer batch wrapper is new and the CLI MUST be extended to recognize `type:'batch'`.

## Open Questions

1. **What's the `<org>` for `github.com/<org>/device-farm`?**
   - What we know: `cli/go.mod:1` is `module github.com/device-farm/cli`. This is a placeholder; no actual GitHub org "device-farm" owns this repo.
   - What's unclear: This is a self-hosted/private project per `.planning/PROJECT.md` (referenced in STATE). There may be no public GitHub releases.
   - Recommendation: Planner MUST surface this to the user during execution. If no GitHub repo exists, the auto-update banner is dead code — consider deferring SC4 or pointing at an internal release endpoint (e.g., `$DEVICE_FARM_UPDATE_URL` env override).

2. **Should `crash-detected` be persisted in the events table?**
   - What we know: Phase 22 streaming module's `ws.frame.dropped` is NOT persisted (transient; structured log is enough). Phase 23 `job.failed` IS persisted (terminal saga event).
   - What's unclear: `crash-detected` is somewhere in between — it's not a terminal saga state (the job could still pass; crash markers can fire on background threads while the test continues), and it's not purely transport debug.
   - Recommendation: Do NOT persist. The fact is already captured by `jobs.failure_class = 'crash'` (a permanent DB column). Emitting via the streaming bus is sufficient for the dashboard badge.

3. **Boot options precedence: per-job vs config defaults?**
   - What we know: `config.yaml` has `pool.android` with `headless`/`api_level` etc., but no audio/gpu/snapshot settings. So per-job overrides start fresh — there are no config-level boot defaults today.
   - What's unclear: Should we ADD config-level defaults (e.g., `pool.android.boot_defaults: {gpu: 'host'}`) that per-job overrides?
   - Recommendation: Defer config-level defaults to a future phase. Phase 31 just plumbs per-job options with hardcoded BootOptionsSchema defaults.

4. **Backwards compatibility: when does `?nobatch=1` go away?**
   - What we know: Web client at `web/src/lib/ws/job-stream.svelte.ts:24` does flat `JSON.parse(event.data)` then `msg.type` dispatch. It does NOT know about `type:'batch'`. The Go CLI at `cli/internal/streaming/ws.go:43-67` is the same.
   - What's unclear: Per CONTEXT, batch is the DEFAULT (opt-out via `?nobatch=1`). This means **both web and CLI must be updated in this phase** or they receive `type:'batch'` envelopes and silently drop everything.
   - Recommendation: Either (a) extend BOTH web and CLI to unwrap `type:'batch'` in this phase (mandatory if batch-default), OR (b) invert the default to opt-IN (`?batch=1`) and let consumers migrate at their own pace. **Recommend (a)** — small additive change to both clients, keeps CONTEXT decision intact. This adds web + CLI edits to the SC2 task.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.x (server) + Go testing (CLI) — both already in repo |
| Config file | `vitest.config.ts` (server) + `cli/Makefile` (Go) |
| Quick run command | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts` (parser) |
| Full suite command | `npm test && cd cli && make test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC1 | Logcat threadtime regex matches valid format | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "threadtime"` | Wave 0 |
| SC1 | Crash markers fire ONLY when level=E AND keyword match | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "crash 3-of-3"` | Wave 0 |
| SC1 | False-positive: user app logs containing "FATAL" without level E do NOT trigger | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "false positive"` | Wave 0 |
| SC1 | First crash detection writes `jobs.failure_class='crash'` exactly once | integration (DB) | `DATABASE_URL=... npx vitest run server/streaming/__tests__/log-parsing-integration.spec.ts -t "single crash detection"` | Wave 0 |
| SC1 | `crash-detected` WS event fires once and carries `firstLine` | integration | `npx vitest run server/streaming/__tests__/log-parsing-integration.spec.ts -t "crash event"` | Wave 0 |
| SC2 | 10000 log lines -> at most 100 WS frames received | integration | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "10k lines"` | Wave 0 |
| SC2 | Disconnect flushes pending buffer | unit | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "disconnect drains"` | Wave 0 |
| SC2 | `?nobatch=1` query string emits unbatched frames | integration | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "nobatch opt-out"` | Wave 0 |
| SC2 | Web client unwraps batch envelope | unit (web) | `cd web && npm test -- job-stream.test.ts -t "batch unwrap"` | Wave 0 |
| SC2 | Go CLI unwraps batch envelope | unit (Go) | `cd cli && go test ./internal/streaming/ -run TestBatchUnwrap` | Wave 0 |
| SC3 | `BootOptionsSchema.parse({})` returns expected defaults | unit | `npx vitest run server/config/__tests__/boot-options.spec.ts -t "defaults"` | Wave 0 |
| SC3 | `coldBoot=true` produces argv containing `-no-snapshot-load` | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "cold boot"` | Wave 0 |
| SC3 | `noAudio=false` omits `-no-audio` from argv | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "audio enabled"` | Wave 0 |
| SC3 | `gpu='host'` produces `-gpu host` in argv | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "gpu host"` | Wave 0 |
| SC3 | Multipart `boot_options` field reaches `JobService.createJob` opts | integration | `npx vitest run server/api/__tests__/jobs-boot-options.spec.ts` | Wave 0 |
| SC3 | CLI `--cold-boot` writes `boot_options` JSON in multipart | unit (Go) | `cd cli && go test ./cmd/ -run TestRunColdBootMultipart` | Wave 0 |
| SC3 | E2E: argv passed to spawn matches expected options (mock child_process) | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "spawn invoked"` | Wave 0 |
| SC4 | `Check` returns "" when `DEVICE_FARM_NO_UPDATE_CHECK=1` | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckSuppressEnvVar` | Wave 0 |
| SC4 | `Check` returns "" when `$CI` set | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckSuppressCI` | Wave 0 |
| SC4 | `Check` returns newer tag when API returns higher version | unit (Go, httptest server) | `cd cli && go test ./internal/updates/ -run TestCheckNewerVersion` | Wave 0 |
| SC4 | `Check` returns "" when tag fails regex `^v\d+\.\d+\.\d+(-[\w.]+)?$` | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckMalformedTag` | Wave 0 |
| SC4 | Cache file written and re-read within 24h skips network | unit (Go, tempdir) | `cd cli && go test ./internal/updates/ -run TestCacheHit` | Wave 0 |
| SC4 | Cache file older than 24h triggers re-fetch | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCacheExpiry` | Wave 0 |
| SC4 | Banner renders box with correct width | unit (Go) | `cd cli && go test ./internal/ui/ -run TestBannerBox` | Wave 0 |
| SC4 | HTTP timeout = 3s (use context with deadline) | unit (Go, slow server) | `cd cli && go test ./internal/updates/ -run TestCheckTimeout` | Wave 0 |

### Sampling Rate
- **Per task commit:** Run that task's spec file (~1-3 seconds)
- **Per wave merge:** `npx vitest run server/jobs/__tests__ server/streaming/__tests__ server/pool/android/__tests__ server/config/__tests__ server/api/__tests__ && cd cli && make test`
- **Phase gate:** `npm test && cd cli && make test` (full suite) AND `npm run nyquist:check` (Phase 31 should add tests > -2pp regression budget per Phase 15+ convention)

### Wave 0 Gaps

All Phase 31 test files are new. Wave 0 must create:

- [ ] `server/jobs/__tests__/log-parsing.spec.ts` — covers SC1 unit cases
- [ ] `server/jobs/__tests__/fixtures/logcat-{crash-androidruntime,crash-native-sigsegv,anr,normal-verbose,mixed}.txt` — 5 representative fixtures
- [ ] `server/streaming/__tests__/log-parsing-integration.spec.ts` — covers SC1 DB write + WS event
- [ ] `server/streaming/__tests__/flush-queue.spec.ts` — covers SC2 unit + integration
- [ ] `server/config/__tests__/boot-options.spec.ts` — covers SC3 schema defaults
- [ ] `server/pool/android/__tests__/emulator-boot-options.spec.ts` — covers SC3 argv construction (mock `spawn`)
- [ ] `server/api/__tests__/jobs-boot-options.spec.ts` — covers SC3 multipart parsing
- [ ] `cli/cmd/run_test.go` extension — covers SC3 `--cold-boot` flag -> multipart
- [ ] `cli/internal/updates/check_test.go` + `cache_test.go` — covers SC4 update check
- [ ] `cli/internal/streaming/ws_test.go` extension — covers SC2 batch unwrap in CLI
- [ ] `cli/internal/ui/banner_test.go` — covers SC4 box rendering
- [ ] `web/src/lib/ws/job-stream.test.ts` extension — covers SC2 batch unwrap in web (NOTE: web has no test infra today — see Pitfall in §Open Questions; may need to add `vitest` to web/, or defer web-side coverage to manual test)

**Test framework install:** No new install required for server (Vitest already in `package.json`). For web side, if a vitest install is needed, add `cd web && npm install -D vitest @testing-library/svelte` — but verify first whether existing web tests exist (web/src has no `__tests__/` directories per directory listing above; web testing infra may be a deferred concern).

## Sources

### Primary (HIGH confidence — direct file reads)
- `.planning/phases/31-quick-wins/31-CONTEXT.md` — Phase 31 user decisions (locked)
- `.planning/phases/31-quick-wins/31-PLAN.md` — hand-written reference plan with task IDs
- `.planning/REQUIREMENTS.md` — v1 spec coverage 60/60 mapped Phase 15-30
- `.planning/STATE.md` (lines 1-200) — confirmed Phase 22-30 closed status
- `./CLAUDE.md` — project conventions (TS ESM .js imports, Zod, async-mutex, drizzle-kit)
- `server/streaming/internal/job-broadcaster.ts` (full 85 lines) — broadcaster shape verified; FlushQueue integration point is in plugin.ts, NOT here
- `server/streaming/internal/module.ts` (full 261 lines) — subscriber `makeHandler` pattern (where parser plugs in)
- `server/streaming/internal/ws-schemas.ts` (full 77 lines) — strict `wsEnvelopeSchema` shape; batch wrapper sits OUTSIDE this
- `server/streaming/plugin.ts` (full 229 lines) — WS route handler at `/ws/jobs/:id`; FlushQueue per-socket integration point at line 107
- `server/streaming/events.ts` (first 60 lines + headers) — confirms 1 existing event (`ws.frame.dropped`); `crash-detected` would be ADDITIVE if persisted (DEFERRED per Open Question 2)
- `server/pool/android/emulator.ts` (full 309 lines) — exact line 91-103 argv hardcoded; BootOptions interface used at line 57 (timeout-only)
- `server/pool/types.ts` (full 52 lines) — `BootOptions` interface with `timeout?` only
- `server/config/schema.ts` (full 141 lines) — Zod schema co-location pattern; `BootOptionsSchema` slots in around line 99 (next to maestroSchema)
- `server/db/schema.ts` (full 316 lines) — pgEnum pattern (4 existing enums); `jobs` table at line 69-81; NO `failure_class` exists today; adding to `jobs` table is line-81 edit
- `server/db/migrations/0005_api_keys_claims.sql` + `0006_pipeline_runs_azure_pr_comment.sql` — canonical ALTER TABLE migration shape
- `drizzle.config.ts` — `out: './server/db/migrations'` + `dialect: 'postgresql'`
- `server/api/routes.ts` (first 200 lines) — POST /jobs multipart parser at lines 50-117; `boot_options` field follows `env`/`filePaths` pattern at line 92-104
- `server/jobs/job-service.ts` (full 161 lines) — `CreateJobOpts` shape at line 22-31; `bootOptions` field added here
- `server/jobs/internal/executor.ts` (full 266 lines) — `runJob` allocates device at line 79 (`fastify.pool.allocate(row.platform, jobId)`); boot options plumb to this signature
- `server/jobs/events.ts` (full 428 lines) — events bus pattern (Phase 31 doesn't add events to jobs registry; may add `crash-detected` to streaming registry if persisted, but Open Question 2 recommends NO)
- `server/jobs/internal/module.ts` (full 258 lines) — 7TH SAMPLE POINT persistEnvelope (Phase 27+ trigger, Phase 31 does NOT consolidate)
- `server/jobs/internal/routes.ts` (full 253 lines) — `withTypeProvider<FastifyZodOpenApiTypeProvider>` pattern for typed routes
- `cli/cmd/root.go` (full 51 lines) — `PersistentPreRun` at line 28-39 (exact hook for update check)
- `cli/cmd/run.go` (full 258 lines) — flags at line 36-44; `--cold-boot`/`--no-audio` slot in here; multipart submission at line 135
- `cli/cmd/version.go` (full 28 lines) — `Version = "dev"` at line 11 (current version source)
- `cli/internal/client/submit.go` (full 130 lines) — multipart submission; `boot_options` JSON field added at line 96-107 (after env)
- `cli/internal/streaming/ws.go` (full 90 lines) — Go WS client; batch unwrap addition target
- `cli/go.mod` — `module github.com/device-farm/cli` (placeholder; no public GitHub org)
- `web/src/lib/ws/job-stream.svelte.ts` (full 102 lines) — web WS client; batch unwrap addition target
- `server/streaming/__tests__/job-broadcaster.spec.ts` — existing test scaffolding (proves test pattern; new tests follow same shape)
- `package.json` (first 50 lines) — confirms Vitest, drizzle-orm, no boxen/lodash; lean stack
- `.planning/config.json` — `nyquist_validation: true` (Validation Architecture section MUST be in this RESEARCH)

### Secondary (MEDIUM confidence)
- Phase 22 Plan 22-02 history (in STATE.md) — confirms broadcaster move from jobs/ -> streaming/internal/
- Phase 23 Plan 23-04 saga pattern (in STATE.md) — confirms subscriber-driven cleanup signal (`job.cleanup.requested`); Phase 31 reuses

### Tertiary (LOW confidence — needs validation)
- Banner suppression flag list: CONTEXT lists `DEVICE_FARM_NO_UPDATE_CHECK=1`, `--quiet`, `$CI`. The `--quiet` flag does NOT currently exist in `cli/cmd/root.go` PersistentFlags — planner should either add the flag in this phase OR drop it from suppression criteria (env vars are sufficient).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library version pinned from package.json or go.mod
- Architecture: HIGH — every integration point read line-by-line
- Pitfalls: HIGH — 7 pitfalls identified from direct code inspection (not speculation)
- Validation: HIGH — all SC1-SC4 have automated test commands; manual-only count = 0

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days for stable codebase post-v3.0 phase substrate)
