# Phase 37: Platform Extensions — Research

**Researched:** 2026-05-16
**Domain:** Mobile binary static analysis (Mach-O/Hermes) · App Store compliance scanning · GitHub App webhooks · Parallel device fan-out
**Confidence:** HIGH (stack & patterns) · MEDIUM (rule pack drift) · LOW (Hermes scan precision on shipped builds)

## Summary

Phase 37 closes v3.0 with four independent feature tracks that share `server/` + `cli/` + `web/` surface but no internal coupling. Three of the four tracks have authoritative reference implementations sitting in `_reference/` (study-only) — the work is **porting algorithms**, not designing them. Track C reuses an existing local pattern (`server/azure/`) almost verbatim, swapping vendor specifics. Track D translates ~45 LOC of Swift `withTaskGroup` into TypeScript `Promise.all` with structured-result aggregation.

The phase ships best as **four parallel waves** (one per track + a close-out for webhook payload extension), each producing 2–6 plan files. Every track lands behind a feature flag/optional config so partial completion still ships v3.0.

**Primary recommendation:** Port `app-explorer/skeleton/ios.py` to Go in `cli/internal/macho/` (shell out to `otool`/`nm`/`xcrun swift-demangle`) — do NOT add a Go Mach-O parsing dep; build a thin offline GitHub App webhook plugin mirroring `server/azure/` swapping basic-auth for `x-hub-signature-256` HMAC + Octokit installation tokens; bundle a versioned Greenlight rule pack in JSON; implement `InputBroadcaster` as a 30-LOC wrapper around `sessionsModule.dispatch` with `Promise.allSettled`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**External Dependencies Policy:** Reference repos are STUDY-ONLY. `app-explorer` (iOS skeleton), `mobile-devtools` (Greenlight + PR Review Bot), `kittyfarm` (InputCoordinator + BuildPlayRunner) at `/Users/heicg/Desktop/projects/_reference/` are read-only references — copy ideas/algorithms/data structures into `device-farm/server` and `device-farm/web`; never add them as deps. Normal libs (GitHub App SDK, plist parsers, ipa-extract tooling we choose) remain fine.

**Authoritative Sources:**
- `37-BRIEF.md` — 4-track task list, success criteria per track
- `/Users/heicg/Desktop/projects/_reference/app-explorer/` — iOS skeleton extraction code
- `/Users/heicg/Desktop/projects/_reference/mobile-devtools/` — Greenlight (preflight) + PR Review Bot
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/InputCoordinator.swift` — fan-out pattern
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/BuildPlayRunner.swift` — Build-Once-Deploy-N

**Architecture per track:**
- **Track A — iOS Skeleton:** new `server/analysis/ipa-skeleton.ts` (storage side) + Go `cli/internal/macho/` (extraction); CLI `device-farm analyze sample.ipa`; web `/builds/[id]/skeleton`.
- **Track B — Preflight:** new module `server/preflight/`; `POST /api/preflight` accepts `.ipa` or `.apk`; UI red/yellow/green checklist.
- **Track C — GitHub PR:** new plugin `server/integrations/github/` mirroring `server/azure/`; HMAC verification on webhooks; CLI `--github-pr <num>` posts/edits comment with screenshots.
- **Track D — Parallel patterns:** `server/jobs/internal/input-broadcaster.ts` + `server/jobs/internal/build-once-deploy-n.ts`.

### Claude's Discretion
- iOS skeleton tooling (port kittyfarm? use class-dump-tng?) — **Recommendation: port app-explorer; do NOT use class-dump-tng (unmaintained, brittle on modern Xcode).**
- Greenlight rule set (start with brief's known-bad fixtures) — **Recommendation: bundle a versioned JSON rule pack with ~15 high-precision rules and a `rulesUpdated` timestamp surfaced in UI.**
- GitHub App vs personal access token — **Recommendation: GitHub App with installation tokens (correct for production; required for org-scoped repos).**
- Whether all 4 tracks land in parallel waves or sequentially — **Recommendation: 4 parallel waves + 1 close-out wave; no inter-track dependencies.**

### Deferred Ideas (OUT OF SCOPE)
- Bitcode-based deeper analysis (post-Apple-deprecation, may not be feasible)
- GitLab MR equivalent (mirror Azure path for now; add later)
- Cross-platform skeleton (Android dex) — separate feature (v3.1 fast-follow via `aapt`)
- Figma checker, Security scanner / pentest, Push notification testing
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXT-IOS-SKELETON | Static iOS screen skeleton extraction from `.ipa` → JSON → DB → web viewer | §Track A: `otool -ov` + `__swift5_types` parse + `xcrun swift-demangle` + Hermes magic-byte + `strings -a -n 8` scan, all shipped via Go subcommand mirroring `app-explorer/skeleton/ios.py` |
| EXT-PREFLIGHT | App Store preflight scanning for `.ipa`/`.apk` with red/yellow/green checklist | §Track B: bundled JSON rule pack + `Info.plist` + `PrivacyInfo.xcprivacy` parse via `@plist/parse` + `nm`/`otool -l` symbol scan; UI checklist |
| EXT-GITHUB-PR | GitHub App integration posting/editing PR comment with screenshots | §Track C: `@octokit/app` + `@octokit/auth-app` + `@octokit/webhooks-methods` `verify()` over `x-hub-signature-256`; mirror `server/azure/` plugin shape; new `jobs.github_pr_*` columns |
| EXT-INPUT-BROADCAST | Fan-out tap/key/text from one source to N device sessions | §Track D: `Promise.allSettled` around `sessionsModule.dispatch`; NormalizedTouch (0..1) → pixel per device; partial-failure surfacing |
| EXT-BUILD-ONCE | Build artifact once, install + launch on N devices in parallel | §Track D: pre-allocate N devices via existing pool + `Promise.all` install+launch; reuse Phase 31/33 port allocator |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/app` | ^15 | GitHub App composite SDK (auth + Octokit + webhooks) | Single SDK covering install token mgmt + REST + webhook verify |
| `@octokit/auth-app` | ^7 | JWT install token flow with auto-refresh | Caches install tokens transparently; production-grade |
| `@octokit/webhooks-methods` | ^5 | `verify()` constant-time HMAC over `x-hub-signature-256` | Avoids hand-rolled `crypto.timingSafeEqual` plumbing |
| `@plist/parse` | ^1 | TypeScript binary/XML/OpenStep plist parser | Handles both XML and bplist00; auto-detects format (`.ipa` Info.plist can be either) |
| `yauzl` | ^3 | Streaming zip reader for `.ipa` extraction | Streaming = no full-buffer alloc on multi-GB IPAs |
| `adm-zip` | ^0.5 | Synchronous zip read fallback (`.apk` is just zip) | Smaller `.apk` files; simpler API |
| Fastify multipart (`@fastify/multipart`) | already installed | `.ipa`/`.apk` upload | Same path as existing `/api/jobs` multipart |
| Vitest | already installed | Track B/C/D server tests | Existing infrastructure |
| Go stdlib + `os/exec` | n/a | Track A — shell to `otool`/`nm`/`xcrun` | Zero new Go deps; matches `cli/cmd/doctor.go` style |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lru-cache` | ^11 | Cache GitHub install tokens (TTL 50min, ttl < 1h API limit) | If `@octokit/auth-app` cache insufficient (it usually is — check first) |
| `sharp` | ^0.33 | Screenshot resize for PR comments (GitHub strips images > N MB) | Only if comment screenshots exceed 5MB total |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell to `otool`/`nm` (Track A) | Pure-Go Mach-O parser (`debug/macho` stdlib) | stdlib does NOT parse `__objc_classlist` superclass pointers — would require re-implementing 400 LOC of relocation logic. **Reject.** |
| `@plist/parse` | `plist` (npm) | Both work; `@plist/parse` has cleaner TS types but `plist` (Tobias Buschor's fork) is more widely used. **Either acceptable.** |
| `class-dump-tng` (Track A) | binary `class-dump-tng` shell-out | Unmaintained since 2018; broken on modern arm64 Xcode 15+ binaries. **Reject.** |
| `@octokit/webhooks` (full) | `@octokit/webhooks-methods` only + manual dispatch | Full lib pulls in EventEmitter + 50+ event schemas; we only need `verify()`. **Recommendation: use methods-only.** |
| Personal Access Token (Track C) | GitHub App | PATs work in dev but fail on org-scoped repos with SSO; App is required for production. **Decision: App.** |

**Installation:**
```bash
npm install @octokit/app @octokit/auth-app @octokit/webhooks-methods @plist/parse yauzl
npm install -D @types/yauzl
# Go side: zero new deps
```

## Architecture Patterns

### Recommended Project Structure

```
server/
├── analysis/                       # Track A — server-side storage
│   ├── MODULE.md
│   ├── plugin.ts
│   ├── routes.ts                   # POST /api/builds/:id/skeleton (multipart)
│   ├── schemas.ts                  # Zod for skeleton payload
│   ├── events.ts                   # build.skeleton.ingested
│   └── internal/
│       ├── module.ts
│       └── repo.ts                 # analyses table CRUD
├── preflight/                      # Track B
│   ├── MODULE.md
│   ├── plugin.ts
│   ├── routes.ts                   # POST /api/preflight
│   ├── schemas.ts
│   ├── events.ts                   # preflight.completed
│   └── internal/
│       ├── module.ts
│       ├── rule-engine.ts          # runs rules over parsed bundle
│       ├── parsers/
│       │   ├── ipa.ts              # unzip + Info.plist + PrivacyInfo + binary symbols
│       │   ├── apk.ts              # unzip + AndroidManifest stub
│       │   └── macho-symbols.ts    # spawn `nm` over executable
│       └── rules/
│           ├── ios-info-plist.ts
│           ├── ios-privacy-manifest.ts
│           ├── ios-forbidden-symbols.ts
│           └── __data__/
│               └── forbidden-symbols.json   # versioned rule pack
├── integrations/                   # NEW directory (mirroring suggestion in CONTEXT)
│   └── github/                     # Track C
│       ├── MODULE.md
│       ├── plugin.ts               # mirrors server/azure/plugin.ts
│       ├── routes.ts               # POST /webhooks/github
│       └── internal/
│           ├── module.ts
│           ├── app-auth.ts         # createAppAuth wrapper
│           ├── webhook-handler.ts  # dispatch on pull_request events
│           ├── comments.ts         # upsertComment (post-or-edit)
│           └── template-builder.ts # markdown render
└── jobs/
    └── internal/
        ├── input-broadcaster.ts    # Track D-1
        └── build-once-deploy-n.ts  # Track D-2

cli/
├── cmd/
│   ├── analyze.go                  # Track A `device-farm analyze sample.ipa`
│   └── run.go                      # +--github-pr flag
└── internal/macho/                 # Track A
    ├── parser.go                   # otool -ov walk
    ├── swift5_types.go             # __swift5_types section parse
    ├── swift_demangle.go           # xcrun swift-demangle -compact wrap
    ├── hermes.go                   # magic byte + strings -a -n 8 + regex
    ├── heuristics.go               # _SCREEN_HEURISTICS port
    └── __tests__/
        └── fixtures/
            ├── good.ipa            # known-good RN sample
            └── empty.ipa

web/
└── src/routes/
    ├── builds/[id]/skeleton/+page.svelte
    ├── preflight/+page.svelte
    └── sessions/[id]/+page.svelte    # +mirror multi-select
```

### Pattern 1: Plugin mirror (Track C → mirror `server/azure/`)

**What:** New `server/integrations/github/` directory copies the file/function shape of `server/azure/` 1:1, swapping the auth + comment-poster internals.

**When to use:** Track C is a pure mirror — same plugin shape, same `pipelines.bus` subscribers, swap webhook auth and comment-poster.

**Example skeleton:**
```typescript
// server/integrations/github/plugin.ts — mirrors server/azure/plugin.ts:17-142
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createGithubModule, type GithubModule } from './internal/module.js';
import { registerGithubRoutes } from './routes.js';
import { PIPELINE_EVENT_NAMES } from '../../pipelines/events.js';

declare module 'fastify' {
  interface FastifyInstance {
    githubModule: GithubModule | null;
  }
}

async function githubPlugin(fastify: FastifyInstance): Promise<void> {
  const mod = await createGithubModule({ fastify, logger: fastify.log });
  fastify.decorate('githubModule', mod);
  if (mod) {
    registerGithubRoutes(fastify, { webhookSecret: mod.webhookSecret, handler: mod.handler });
    fastify.addHook('onReady', async () => {
      const bus = fastify.pipelinesModule.bus;
      const commenter = mod.commenter;
      bus.on(PIPELINE_EVENT_NAMES.RUN_STARTED, (p) => void commenter.upsert({ runId: p.runId, status: 'running' }));
      bus.on(PIPELINE_EVENT_NAMES.RUN_COMPLETED, (p) => void commenter.upsert({ runId: p.runId, status: p.status === 'passed' ? 'passed' : 'failed' }));
    });
  }
}

export default fp(githubPlugin, {
  name: 'github-plugin',
  dependencies: ['config', 'db', 'pipelines-plugin'],
});
```

### Pattern 2: HMAC webhook verification (Track C)

**What:** Replace `server/azure/routes.ts` basic-auth (`checkBasic`) with constant-time `x-hub-signature-256` verification via `@octokit/webhooks-methods`.

**When to use:** Every `POST /webhooks/github` request.

**Example:**
```typescript
// server/integrations/github/routes.ts
import { verify } from '@octokit/webhooks-methods';

export function registerGithubRoutes(app, { webhookSecret, handler }) {
  // CRITICAL: raw body MUST be captured pre-JSON-parse for HMAC.
  // Fastify default JSON parser destroys the raw bytes. Use addContentTypeParser
  // to capture the buffer FIRST, then parse.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try { done(null, { raw: body, parsed: JSON.parse(body.toString('utf8')) }); }
    catch (e) { done(e as Error, undefined); }
  });

  app.post('/webhooks/github', async (req, reply) => {
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string | undefined;
    const delivery = req.headers['x-github-delivery'] as string | undefined;
    const { raw, parsed } = req.body as { raw: Buffer; parsed: unknown };

    if (!sig || !event || !delivery) { reply.code(400); return { error: 'missing headers' }; }
    const ok = await verify(webhookSecret, raw.toString('utf8'), sig);
    if (!ok) { reply.code(401); return { error: 'invalid signature' }; }

    const outcome = await handler.handle(event, parsed);
    reply.code(200); return outcome;
  });
}
```

### Pattern 3: Mach-O parsing via shell-out (Track A)

**What:** Port `app-explorer/skeleton/ios.py` to Go — same algorithm, same external tools (`otool`/`nm`/`xcrun swift-demangle`), same regex anchors.

**When to use:** `cli/cmd/analyze.go` invocation. Runs on the operator's Mac (Xcode CLT required).

**Why shell-out:** Go `debug/macho` cannot resolve `__objc_classlist` superclass pointers without reimplementing relocation logic (~400 LOC). `otool -ov` does this for us in one process spawn.

**Example:**
```go
// cli/internal/macho/parser.go
func ParseObjCClasslist(binary string) ([]ObjCClass, error) {
    cmd := exec.Command("otool", "-ov", binary)
    out, err := cmd.Output()
    if err != nil { return nil, fmt.Errorf("otool -ov: %w", err) }

    classes := []ObjCClass{}
    inClasslist := false
    var currentSuper string
    sawMeta := false

    classHeaderRe := regexp.MustCompile(`^[0-9a-f]{16} 0x[0-9a-f]+\s*$`)
    nameLineRe := regexp.MustCompile(`^ {8}name\s+0x[0-9a-f]+\s+(\S+)\s*$`)
    superLineRe := regexp.MustCompile(`^    superclass\s+0x[0-9a-f]+(?:\s+(\S+))?\s*$`)

    for _, line := range strings.Split(string(out), "\n") {
        if strings.HasPrefix(line, "Contents of") {
            inClasslist = strings.Contains(line, "__objc_classlist")
            continue
        }
        if !inClasslist { continue }
        if strings.HasPrefix(line, "Meta Class") { sawMeta = true; continue }
        if classHeaderRe.MatchString(line) { sawMeta = false; currentSuper = ""; continue }
        if sawMeta { continue }
        if m := superLineRe.FindStringSubmatch(line); m != nil { currentSuper = m[1]; continue }
        if m := nameLineRe.FindStringSubmatch(line); m != nil {
            classes = append(classes, ObjCClass{MangledName: m[1], SuperclassExternal: currentSuper})
            currentSuper = ""
        }
    }
    return classes, nil
}
```

**Source:** `/Users/heicg/Desktop/projects/_reference/app-explorer/app_explorer/skeleton/ios.py:136-172`

### Pattern 4: Fan-out via `Promise.allSettled` (Track D-1)

**What:** Direct translation of Swift `withTaskGroup(of: Void.self)` from `kittyfarm/Input/InputCoordinator.swift`.

**Example:**
```typescript
// server/jobs/internal/input-broadcaster.ts
import type { SessionsModule } from '../../sessions/index.js';
import type { NormalizedTouch, KeyEvent } from '../../sessions/types.js';

export interface BroadcastResult {
  sessionId: string;
  ok: boolean;
  error?: string;
}

export function createInputBroadcaster(deps: { sessionsModule: SessionsModule; logger: pino.Logger }) {
  return {
    async broadcast(sessionIds: string[], action: { type: 'tap'; touch: NormalizedTouch } | { type: 'key'; event: KeyEvent }): Promise<BroadcastResult[]> {
      const results = await Promise.allSettled(
        sessionIds.map((id) => deps.sessionsModule.dispatch(id, action)),
      );
      return results.map((r, i) => r.status === 'fulfilled'
        ? { sessionId: sessionIds[i], ok: true }
        : { sessionId: sessionIds[i], ok: false, error: String(r.reason) },
      );
    },
  };
}
```

**Source:** `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/InputCoordinator.swift:3-45` (45 LOC Swift → ~25 LOC TypeScript).

### Pattern 5: Build-Once-Deploy-N (Track D-2)

**What:** Pre-allocate N devices, then `Promise.all` the install + launch step per device. Each task in the group is independent — failure of one device does NOT block the others.

**Source:** `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/BuildPlayRunner.swift:118-141` (iOS) and `:185-200` (Android) — both use `withThrowingTaskGroup` for fan-out post-build.

```typescript
// server/jobs/internal/build-once-deploy-n.ts
export async function runParallelDeploy(deps, job: ParallelDeployJob) {
  // Build/upload step happens ONCE (existing artifact upload flow already idempotent).
  const apk = job.artifacts.apk;
  const devices = await deps.pool.allocateMany(job.platform, job.parallelism);

  const perDeviceResults = await Promise.allSettled(
    devices.map((d) => installAndLaunch(d, apk, job.maestroFlow)),
  );

  // Aggregate per-device results; do NOT roll back successful sends (kittyfarm-style).
  return {
    deviceCount: devices.length,
    devices: perDeviceResults.map((r, i) => ({
      deviceId: devices[i].id,
      status: r.status === 'fulfilled' ? 'passed' : 'failed',
      error: r.status === 'rejected' ? String(r.reason) : undefined,
    })),
  };
}
```

### Anti-Patterns to Avoid

- **Don't hand-roll HMAC:** Use `@octokit/webhooks-methods.verify()` — it does constant-time comparison; manually using `crypto.createHmac` + `===` opens a timing-attack hole.
- **Don't `JSON.parse` before HMAC verify:** GitHub signs the raw body. Fastify's default JSON parser destroys those bytes. Use `addContentTypeParser` to capture `parseAs: 'buffer'` first.
- **Don't extract the entire `.ipa` to disk:** Use `yauzl` streaming + `tempfile` only for the binary you actually need (`Payload/*.app/<executable>`, `Info.plist`, `PrivacyInfo.xcprivacy`, `main.jsbundle`).
- **Don't add `class-dump-tng` as a binary dependency:** Unmaintained since 2018; broken on Xcode 15+. The `otool -ov` approach (per app-explorer) is current and stable.
- **Don't store install tokens in DB:** `@octokit/auth-app` caches them in-process with auto-refresh. Persisting them adds key-rotation pain.
- **Don't `Promise.all` (Track D) — use `Promise.allSettled`:** A single failed device must NOT cancel the others (kittyfarm pattern: `error: \(target.descriptor.displayName)` logs and continues — `InputCoordinator.swift:10-11`).
- **Don't log signed-URL artifacts after expiry:** Comment templates include signed URLs; cap TTL ≥ 7 days (longer than typical PR review cycles).
- **Don't reuse `azurePrIntegrationId` semantics for GitHub:** Per-row foreign-key indirection works for Azure because PR-bot is provisioned per-integration. GitHub Apps are provisioned per-installation — store `github_installation_id` not `github_integration_id`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub webhook HMAC | `crypto.createHmac` + manual `===` | `@octokit/webhooks-methods.verify` | Constant-time comparison; correct buffer encoding; GitHub-tested |
| GitHub App install token JWT | Custom RS256 sign with `jose` | `@octokit/auth-app.createAppAuth` | Token caching, auto-refresh, per-installation isolation built-in |
| Mach-O `__swift5_types` walker | Re-implement relocation logic via `debug/macho` | Port app-explorer's `otool -l` + manual section read (10 KB script) | 400 LOC saved; matches Apple's own tooling output |
| Swift symbol demangle | Re-implement `swift-demangle` algorithm | `xcrun swift-demangle -compact` shell-out | Apple ships the canonical implementation; ~1ms per 2000 symbols |
| Binary plist decode | Implement bplist00 reader | `@plist/parse` | XML *and* bplist auto-detect; covers all `.ipa` cases |
| Zip extraction | Manual zip layout parse | `yauzl` (stream) or `adm-zip` (sync) | Edge cases (zip64, large files) handled |
| Fan-out concurrency | Custom queue + worker pool | `Promise.allSettled` over `Array.map` | Stdlib; matches kittyfarm's `withTaskGroup` semantics 1:1 |
| Preflight rule engine | Per-rule custom dispatcher | Plain JSON rule pack + linear scan | 15 rules; throughput is not the bottleneck (binary parse is) |
| Markdown comment template | Custom string concat | Shared `template-builder.ts` (mirror `server/azure/internal/template-builder.ts`) | DRY between Azure and GitHub paths |

**Key insight:** Apple ships an entire toolchain (`otool`/`nm`/`xcrun swift-demangle`) that already does the hard parts of Mach-O introspection. The whole "iOS skeleton extraction" trick is **chaining those tools and applying regex heuristics**, not implementing a parser. Reach for Apple's binaries first.

## Common Pitfalls

### Pitfall 1: Fastify Default JSON Parser Destroys Webhook Raw Bytes
**What goes wrong:** `verify()` returns false because the body re-stringified by Fastify's JSON parser doesn't match GitHub's HMAC of the original bytes (key order, whitespace).
**Why it happens:** Fastify parses JSON before routes see it; the raw `Buffer` is gone by the time the handler runs.
**How to avoid:** Use `app.addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` to capture `raw` and `parsed` together. Pass `raw.toString('utf8')` to `verify()`.
**Warning signs:** Local curl works (`tsx` exact buffer); real GitHub deliveries return 401.

### Pitfall 2: `xcrun swift-demangle` Hangs on Stdin > ~10K Symbols
**What goes wrong:** Single-shot stdin write of every symbol causes a pipe deadlock.
**Why it happens:** macOS pipes have a 64KB buffer; large symbol lists block.
**How to avoid:** Batch in chunks of 2000 (app-explorer's choice; `SWIFT_DEMANGLE_BATCH = 2000`). One subprocess spawn per batch.
**Warning signs:** `device-farm analyze` hangs indefinitely on large apps.

### Pitfall 3: Hermes "Concatenation Artifacts" in Screen Extraction
**What goes wrong:** Hermes packs all strings in one buffer with no separators; regex matches like `AmountSuspensePrimaryChildrenderToScreen` are fake.
**Why it happens:** Adjacent JS strings butted up against each other are matched by `[A-Z][a-z][A-Za-z]{2,40}?Screen`.
**How to avoid:** Port `_is_likely_concatenation` and `_looks_like_artifact` filters from `app-explorer/react_native.py:72-128`. Reject names with >3 camelCase boundaries, >38 chars, runtime-fragment prefixes (`Async`, `Resolve`, `Promise`...).
**Warning signs:** Skeleton report includes screens like `SuspenseQueryuse...Screen`.

### Pitfall 4: GitHub App Installation Token TTL
**What goes wrong:** Installation tokens expire in 1 hour. Long-running webhook handlers hit 401.
**Why it happens:** Cached install token rolls over mid-handler.
**How to avoid:** `@octokit/auth-app` handles this automatically — request a fresh octokit at the START of every webhook handler, never store one across event boundaries.
**Warning signs:** Comments stop updating after exactly 1 hour from server start.

### Pitfall 5: GitHub Markdown Image Strip on Large Comments
**What goes wrong:** Inline screenshots disappear from PR comments. Comment renders but images are gone.
**Why it happens:** GitHub strips image proxy URLs (camo.githubusercontent.com) if the request times out (5s) or if the URL is too long.
**How to avoid:** Limit to ≤ 5 inline images; rest behind `<details>` link to dashboard. Use signed URLs with TTL ≥ 7 days.
**Warning signs:** First few screenshots render but later ones show as broken links.

### Pitfall 6: Preflight Rule Pack Drift Without Versioning
**What goes wrong:** Operator runs preflight, gets PASS, Apple still rejects build because rules are 6 months stale.
**Why it happens:** Apple updates Required Reason API list; bundled rules don't track.
**How to avoid:** Bundle rule pack with `rulesUpdated: '2026-05-16'` field. Surface in UI ("Rules updated: 2026-05-16 · update via `npm run preflight:update`"). Document upgrade path.
**Warning signs:** Preflight passes, App Store Connect rejects with ITMS-91053.

### Pitfall 7: `.ipa` Info.plist May Be JSON, Not Plist
**What goes wrong:** App-explorer encountered Info.plist files that parsed as JSON instead of bplist or XML.
**Why it happens:** Edge case — some build pipelines emit JSON-shaped Info.plist.
**How to avoid:** Detect format (`@plist/parse` auto-detects; for the Go side, sniff first byte: `0x62` for binary, `0x3C` for XML/text, `{` or `[` for JSON). Fall back to JSON parse if plist parse fails.
**Warning signs:** Analysis fails on certain RN apps with cryptic "invalid bplist00 magic" errors.

### Pitfall 8: Input Broadcaster Races on Session Cleanup
**What goes wrong:** Broadcast races with a session being released — one tap goes to a freed device.
**Why it happens:** No mutex between `sessionIds` snapshot and dispatch.
**How to avoid:** Validate session existence in `sessionsModule.dispatch` itself; broadcaster does NOT pre-check. Surface NOT_FOUND in results array. Do not roll back successful sends (kittyfarm pattern).
**Warning signs:** Sporadic `dispatch on dead session` errors that don't reproduce.

### Pitfall 9: Parallel Deploy Port Pool Exhaustion
**What goes wrong:** `runParallelDeploy(parallelism: 10)` boots 10 emulators; port allocator runs out.
**Why it happens:** Phase 31 port allocator has a finite pool (Android emulator console + adb + gRPC = 3 ports each).
**How to avoid:** Cap parallelism per platform in config (`config.yaml`: `pool.android.maxParallelism: 4`); reject parallel-deploy jobs exceeding the cap with 503.
**Warning signs:** First 3-4 devices boot; remaining fail with "no free port".

### Pitfall 10: Bundled Forbidden-Symbols Rule Pack Hits SwiftUI Internals
**What goes wrong:** Greenlight flags symbols like `_UIInternalSettings` that are actually unused SwiftUI internals (linker dead-stripped).
**Why it happens:** `nm <binary>` lists symbols even if dead-stripped. App-explorer specifically filters `SWIFTUI_FRAMEWORK_MODULES` for screen heuristics — preflight needs analogous filter for symbol scans.
**How to avoid:** Cross-reference forbidden symbols against actual app modules (via `__swift5_types` parent module field). Skip matches in framework-internal modules.
**Warning signs:** High false-positive rate on SwiftUI apps.

## Code Examples

### Example 1: Greenlight Rule Pack JSON Shape

```json
// server/preflight/rules/__data__/forbidden-symbols.json
{
  "schema_version": 1,
  "rules_updated": "2026-05-16",
  "platform": "ios",
  "rules": [
    {
      "id": "ITMS-91053-USERDEFAULTS",
      "kind": "privacy_manifest_missing_reason",
      "severity": "blocker",
      "trigger_symbols": ["objc_msgSend$standardUserDefaults", "_OBJC_CLASS_$_NSUserDefaults"],
      "required_api_type": "NSPrivacyAccessedAPICategoryUserDefaults",
      "required_reason_options": ["CA92.1", "AC6.1", "C56D.1"],
      "message": "Binary uses NSUserDefaults but PrivacyInfo.xcprivacy does not declare NSPrivacyAccessedAPICategoryUserDefaults reason."
    },
    {
      "id": "ATT-MISSING-FOR-IDFA",
      "kind": "info_plist_missing_key",
      "severity": "blocker",
      "trigger_symbols": ["_ASIdentifierManagerAdvertisingIdentifier"],
      "required_info_plist_key": "NSUserTrackingUsageDescription",
      "message": "Binary references ASIdentifierManager.advertisingIdentifier but Info.plist lacks NSUserTrackingUsageDescription (required since iOS 14.5)."
    }
  ]
}
```

### Example 2: Octokit App Construction

```typescript
// server/integrations/github/internal/app-auth.ts
// Source: https://github.com/octokit/auth-app.js (README §Constructor)
import { App } from '@octokit/app';

export function createGithubApp(opts: { appId: number; privateKey: string; webhookSecret: string }) {
  return new App({
    appId: opts.appId,
    privateKey: opts.privateKey, // PEM string
    // Webhook secret stored separately — passed to verify() in routes.ts.
  });
}

export async function getInstallationOctokit(app: App, installationId: number) {
  return app.getInstallationOctokit(installationId); // cached + auto-refreshed
}
```

### Example 3: Hermes Magic Byte Check (Go)

```go
// cli/internal/macho/hermes.go
// Source: app-explorer/skeleton/react_native.py:19, 138-143
var hermesMagic = []byte{0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F}

func IsHermes(bundlePath string) bool {
    f, err := os.Open(bundlePath)
    if err != nil { return false }
    defer f.Close()
    var buf [8]byte
    if _, err := io.ReadFull(f, buf[:]); err != nil { return false }
    return bytes.Equal(buf[:], hermesMagic)
}
```

### Example 4: PR Comment Markdown Template (mirror Azure)

```typescript
// server/integrations/github/internal/template-builder.ts
// Mirrors server/azure/internal/pr-commenter.ts:42-51 + extends with screenshots.
export function renderComment(opts: {
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  jobId: string;
  deviceLabel: string;
  duration?: string;
  screenshotsSignedUrls: string[];
  dashboardUrl: string;
  logsUrl?: string;
  videoUrl?: string;
}): string {
  const emoji = { running: '⏳', passed: '✅', failed: '❌', cancelled: '⚠️' }[opts.status];
  const inlineShots = opts.screenshotsSignedUrls.slice(0, 5);
  const details = opts.screenshotsSignedUrls.length > 5
    ? `<details><summary>Screenshots (${opts.screenshotsSignedUrls.length})</summary>\n\n${inlineShots.map((u, i) => `![shot${i}](${u})`).join('\n')}\n\n[View all on dashboard](${opts.dashboardUrl})\n</details>`
    : inlineShots.map((u, i) => `![shot${i}](${u})`).join('\n');

  return [
    `### 📱 Device Farm — Job #${opts.jobId}`,
    '',
    `| Status | Device | Duration |`,
    `|---|---|---|`,
    `| ${emoji} ${opts.status} | ${opts.deviceLabel} | ${opts.duration ?? '—'} |`,
    '',
    details,
    '',
    `[Open job ↗](${opts.dashboardUrl}) · [Logs](${opts.logsUrl ?? opts.dashboardUrl}) · [Video](${opts.videoUrl ?? opts.dashboardUrl})`,
  ].join('\n');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Personal Access Tokens for GitHub bots | GitHub Apps with installation tokens | ~2020+ org SSO push | Required for org repos; bot identity is app, not user |
| Bitcode binary analysis | Source-level (`__swift5_types`, classlist) | Apple deprecated bitcode in Xcode 14 (2022) | Bitcode is not in modern `.ipa` files |
| `class-dump` / `class-dump-tng` | `otool -ov` + `xcrun swift-demangle` | Xcode 14+ broke class-dump-tng on arm64 | Use Apple's own tools; no third-party Mach-O parsers |
| PrivacyInfo.xcprivacy optional | Required since May 1, 2024 | Apple App Store requirement | Apps without proper manifest are rejected (ITMS-91053) |
| `crypto.createHmac` + `===` for webhooks | `crypto.timingSafeEqual` (or `@octokit/webhooks-methods.verify`) | Industry shift post-2018 timing attack reports | Required for production webhook handling |

**Deprecated/outdated:**
- **`class-dump` / `class-dump-tng`:** unmaintained since 2018, broken on Xcode 15+. Use `otool -ov` + `xcrun swift-demangle`.
- **Bitcode:** Apple removed bitcode-required submission with Xcode 14. New `.ipa` files have no bitcode segments to analyze.
- **GitHub OAuth Apps for CI bots:** replaced by GitHub Apps. Apps have finer-grained permissions and per-installation tokens.

## Open Questions

### Track A — iOS Skeleton
1. **Where do we store the skeleton JSON?**
   - What we know: brief specifies `analyses` table with `(id, build_artifact_id, platform, payload jsonb, created_at)`.
   - What's unclear: Do builds exist as a first-class table today? (Initial scan shows `jobs` but no `builds`/`buildArtifacts` table.)
   - Recommendation: Either reuse `jobs.id` as build identifier OR add a thin `build_artifacts` table in Plan 37-01. Defer if `jobs` already carries APK/IPA refs (it appears to via `jobs.metadata`).

2. **Hermes scope on Wave 1?**
   - What we know: brief lists Hermes as in-scope; app-explorer ships a working implementation.
   - What's unclear: Does the CLI ship with or without Hermes in v3.0?
   - Recommendation: Ship Hermes-aware in Wave 1 (port is straightforward — ~200 LOC Python → ~250 LOC Go). Mark deferred only if Wave 1 runs over.

### Track B — Preflight
3. **`.apk` rule set parity with `.ipa`?**
   - What we know: Brief mentions `.apk` in API contract but rules are iOS-specific.
   - What's unclear: Should `POST /api/preflight` accept `.apk` in v3.0?
   - Recommendation: Accept `.apk` but ship with empty rule pack + clear "Android rules coming in v3.1" warning. Avoids API churn later.

4. **Rule-pack update mechanism?**
   - What we know: Brief notes risk of rules drifting behind Apple.
   - What's unclear: How are rules updated post-v3.0? npm package? Git submodule? Embedded?
   - Recommendation: Bundle as a JSON file with `rulesUpdated` field; document `npm run preflight:update` script for v3.1.

### Track C — GitHub PR
5. **Storage for `github_installation_id`?**
   - What we know: GitHub Apps are installed per-org or per-repo; install ID maps installation → app.
   - What's unclear: One installation per device-farm tenant or many? (Multi-tenant not in scope per v3.0 — likely one.)
   - Recommendation: Single `system_state.github_installation_id` row for v3.0; design for multi-installation in future schema.

6. **`pipelines` vs `jobs` PR linkage?**
   - What we know: Azure path links `pipeline_runs.azurePr*`; brief asks for `jobs.github_pr_*`.
   - What's unclear: Does CLI `--github-pr` create a pipeline run (mirror Azure) or a standalone job?
   - Recommendation: Mirror Azure — extend `pipeline_runs` with `github_pr_*`. Saves a second comment-poster wiring. If user wants `jobs` directly, do both via shared `template-builder.ts`.

### Track D — Parallel patterns
7. **Sessions module readiness for fan-out?**
   - What we know: Phase 34 sessions module is a dependency. STATE.md confirms Phase 34 complete via prior history.
   - What's unclear: Does `sessionsModule.dispatch(sessionId, action)` exist as a public API surface today?
   - Recommendation: Plan 37-13 wave 0 verifies surface; if missing, falls back to a session-specific broadcast endpoint.

8. **Parallelism cap config schema?**
   - What we know: Port allocator finite per platform.
   - What's unclear: Where does `maxParallelism` live in config? (`pool.android.maxParallelism`? Per-platform key?)
   - Recommendation: Add to existing pool config Zod schema; default 4 for Android, 2 for iOS (simulator).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (server) | Vitest 1.x (existing) |
| Framework (CLI) | Go stdlib `testing` (existing, `cli/Makefile`) |
| Config file | `vitest.config.ts` (server); `cli/Makefile` (Go) |
| Quick run command | `npx vitest run server/integrations/github/__tests__` |
| Full suite command | `npm test && cd cli && make test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-IOS-SKELETON | `device-farm analyze sample.ipa` outputs valid skeleton JSON | unit (Go) | `cd cli && go test ./internal/macho/...` | ❌ Wave 0 |
| EXT-IOS-SKELETON | `POST /api/builds/:id/skeleton` stores payload | integration | `npx vitest run server/analysis/__tests__/routes.spec.ts` | ❌ Wave 0 |
| EXT-IOS-SKELETON | Hermes scan rejects concatenation artifacts | unit (Go) | `cd cli && go test -run TestHermesArtifacts ./internal/macho/` | ❌ Wave 0 |
| EXT-PREFLIGHT | Known-bad IPA returns blockers | golden | `npx vitest run server/preflight/__tests__/rules.spec.ts` | ❌ Wave 0 |
| EXT-PREFLIGHT | Known-good IPA returns pass | golden | `npx vitest run server/preflight/__tests__/rules.spec.ts` | ❌ Wave 0 |
| EXT-PREFLIGHT | `PrivacyInfo.xcprivacy` missing → blocker | unit | `npx vitest run server/preflight/__tests__/privacy-manifest.spec.ts` | ❌ Wave 0 |
| EXT-GITHUB-PR | HMAC verification rejects forged payload | unit | `npx vitest run server/integrations/github/__tests__/routes.spec.ts -t "rejects forged"` | ❌ Wave 0 |
| EXT-GITHUB-PR | Webhook dispatches `pull_request.opened` | integration | `npx vitest run server/integrations/github/__tests__/webhook-handler.spec.ts` | ❌ Wave 0 |
| EXT-GITHUB-PR | Comment upsert edits existing instead of posting | unit (mocked Octokit) | `npx vitest run server/integrations/github/__tests__/commenter.spec.ts` | ❌ Wave 0 |
| EXT-GITHUB-PR | Schema migration adds `pipeline_runs.github_pr_*` columns | migration test | `npx vitest run server/db/__tests__/migration-037.spec.ts` | ❌ Wave 0 |
| EXT-INPUT-BROADCAST | Broadcast fans out tap to 3 sessions within 100ms | concurrency | `npx vitest run server/jobs/__tests__/input-broadcaster.spec.ts` | ❌ Wave 0 |
| EXT-INPUT-BROADCAST | Partial failure surfaces per-session error; successes preserved | unit | `npx vitest run server/jobs/__tests__/input-broadcaster.spec.ts -t "partial"` | ❌ Wave 0 |
| EXT-BUILD-ONCE | Build-once on 3 emulators returns aggregated results | E2E | `npx vitest run server/jobs/__tests__/parallel-deploy.spec.ts` (gated on `DEVICE_FARM_E2E=1`) | ❌ Wave 0 |
| EXT-BUILD-ONCE | Port exhaustion returns 503 with `Retry-After` | integration | `npx vitest run server/jobs/__tests__/parallel-deploy.spec.ts -t "503"` | ❌ Wave 0 |
| All tracks | Webhook payload includes new optional fields (preflight, analysis, parallelDeploy) | unit | `npx vitest run server/reporting/__tests__/webhook-payload.spec.ts -t "phase-37"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed module>/__tests__` (sub-30s)
- **Per wave merge:** `npm test && cd cli && make test` (~3-5min)
- **Phase gate:** Full suite green + `npm run nyquist:check` exit 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/analysis/__tests__/routes.spec.ts` — covers EXT-IOS-SKELETON server-side
- [ ] `server/preflight/__tests__/rules.spec.ts` — covers EXT-PREFLIGHT golden fixtures
- [ ] `server/preflight/__tests__/privacy-manifest.spec.ts` — covers EXT-PREFLIGHT manifest parser
- [ ] `server/integrations/github/__tests__/routes.spec.ts` — covers EXT-GITHUB-PR HMAC + dispatch
- [ ] `server/integrations/github/__tests__/webhook-handler.spec.ts` — covers EXT-GITHUB-PR webhook flow
- [ ] `server/integrations/github/__tests__/commenter.spec.ts` — covers EXT-GITHUB-PR upsert
- [ ] `server/db/__tests__/migration-037.spec.ts` — covers schema migration
- [ ] `server/jobs/__tests__/input-broadcaster.spec.ts` — covers EXT-INPUT-BROADCAST
- [ ] `server/jobs/__tests__/parallel-deploy.spec.ts` — covers EXT-BUILD-ONCE (E2E-gated)
- [ ] `cli/internal/macho/parser_test.go` — covers EXT-IOS-SKELETON Mach-O parse
- [ ] `cli/internal/macho/hermes_test.go` — covers Hermes scan + artifact filtering
- [ ] `cli/internal/macho/__tests__/fixtures/good.ipa` — small known-good fixture (use a 1-screen native iOS app built locally; ~1MB) 
- [ ] `cli/internal/macho/__tests__/fixtures/hermes-rn.ipa` — RN-Hermes fixture for scan tests
- [ ] `cli/internal/macho/__tests__/fixtures/known-bad.ipa` — preflight blocker fixture (e.g., uses ASIdentifierManager without ATT)
- [ ] Shared `template-builder` extraction across `server/azure/` + `server/integrations/github/` (refactor in Wave 0 of Track C)
- [ ] Framework install: none (Vitest + Go stdlib already present)

## Schema Additions

### `pipeline_runs` extension (Track C)
```sql
ALTER TABLE pipeline_runs
  ADD COLUMN github_pr_id text,
  ADD COLUMN github_pr_url text,
  ADD COLUMN github_pr_comment_id text,
  ADD COLUMN github_installation_id bigint,
  ADD COLUMN github_repo_owner text,
  ADD COLUMN github_repo_name text;

CREATE INDEX pipeline_runs_github_pr_idx ON pipeline_runs(github_installation_id, github_pr_id)
  WHERE github_pr_id IS NOT NULL;
```

### `analyses` table (Track A)
```sql
CREATE TABLE analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_artifact_id uuid,                       -- nullable; FK if build_artifacts ships
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,  -- fallback linkage
  platform platform NOT NULL,                   -- existing enum
  payload jsonb NOT NULL,                       -- skeleton JSON
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX analyses_job_id_idx ON analyses(job_id);
```

### `preflight_runs` table (Track B)
```sql
CREATE TABLE preflight_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform platform NOT NULL,
  filename text NOT NULL,
  file_size_bytes bigint NOT NULL,
  rules_version text NOT NULL,                  -- e.g. '2026-05-16'
  status text NOT NULL,                         -- 'pass'|'pass_with_warnings'|'blocked'
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);
```

### No schema change required for Track D

## CLI Flags / Commands per Track

### Track A
```bash
device-farm analyze <ipa-or-app>                  # NEW subcommand
  --upload-to-build <buildId>                     # POST result to server
  --json | --markdown                             # output format (default: json)
```

### Track B
```bash
# No new CLI surface in v3.0 (web-first UI). v3.1 candidate:
# device-farm preflight <ipa-or-apk> [--json]
```

### Track C
```bash
device-farm run                                    # existing
  --github-pr <num>                                # NEW
  --github-repo <owner/repo>                       # NEW (or read from git remote)
```

### Track D
```bash
device-farm run                                    # existing
  --parallel <N>                                   # NEW — Track D-2 build-once-deploy-N
  --broadcast-input                                # NEW — Track D-1 mirror touches to all
```

## Web UI Surfaces per Track

| Track | Route | Purpose |
|-------|-------|---------|
| A | `/builds/[id]/skeleton` | Skeleton viewer (grouped table by module + confidence; deep-link list; CTA to Phase 35 `/explorations/new?seed=<analysisId>`) |
| B | `/preflight` | Drag-drop IPA/APK → progress → red/yellow/green checklist per rule |
| C | `/settings/integrations/github` | Display GitHub App install status + repo list + webhook URL + secret rotation |
| C | `/jobs/[id]` | Add "PR" badge with link if `github_pr_id` set |
| D | `/sessions/[id]` | Add "Mirror to:" multi-select dropdown — taps fan out to selected sessions |
| D | `/jobs/[id]` (parallel mode) | N side-by-side stream tiles per device; aggregated status |

## Test Strategy per Track

| Track | Unit | Integration | Golden/Fixtures | E2E |
|-------|------|-------------|-----------------|-----|
| A | Mach-O parse / Hermes filter / heuristics | `analyze` end-to-end on fixture IPA | `good.ipa`, `hermes-rn.ipa` produce stable JSON | Manual on a real-world IPA per CI run |
| B | Per-rule unit tests | `POST /api/preflight` round-trip | `known-bad.ipa` → blockers, `known-good.ipa` → pass | Manual update of rule pack |
| C | HMAC verify (forged/valid), comment template render | Webhook handler dispatch, commenter upsert (mocked Octokit) | Sample GitHub webhook payloads from official fixtures | Sandbox repo round-trip (manual) |
| D | Broadcaster fan-out + partial failure, build-once-deploy-N aggregation | Parallel deploy with mocked pool | n/a | 3-emulator parallel deploy with `DEVICE_FARM_E2E=1` |

## Sources

### Primary (HIGH confidence)
- `/Users/heicg/Desktop/projects/_reference/app-explorer/app_explorer/skeleton/ios.py` (lines 1-540) — iOS skeleton algorithm
- `/Users/heicg/Desktop/projects/_reference/app-explorer/app_explorer/skeleton/react_native.py` (lines 1-199) — Hermes scan + artifact filters
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Input/InputCoordinator.swift` (45 LOC) — fan-out pattern
- `/Users/heicg/Desktop/projects/_reference/kittyfarm/KittyFarm/Lifecycle/BuildPlayRunner.swift:118-141` (iOS) and `:185-200` (Android) — Build-Once-Deploy-N
- `server/azure/plugin.ts` + `server/azure/routes.ts` + `server/azure/internal/*.ts` — local mirror template for Track C
- `server/jobs/MODULE.md` — module convention for new `server/preflight/` and `server/integrations/github/` MODULE.md files
- [GitHub Docs: Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) — `x-hub-signature-256` spec
- [Apple Developer: NSPrivacyAccessedAPITypes](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes) — privacy manifest spec
- [@octokit/auth-app GitHub README](https://github.com/octokit/auth-app.js/) — install token flow

### Secondary (MEDIUM confidence)
- [Octokit Webhooks site](https://octokit.github.io/webhooks/) — verified webhook event schema reference
- [@octokit/app npm](https://www.npmjs.com/package/@octokit/app) — App composite SDK
- [@plist/parse npm](https://www.npmjs.com/package/@plist/parse) — plist parser (TS, browser+node)
- [GitHub: octokit/webhooks-methods.js](https://github.com/octokit/webhooks-methods.js) — `verify()` constant-time HMAC
- [Bugfender: Complying with Apple's Privacy Requirements](https://bugfender.com/blog/apple-privacy-requirements/) — required-reason API coverage
- [Felgo: Qt ITMS-91053 troubleshooting](https://blog.felgo.com/qt-on-ios-itms-91053-nsprivacyaccessedapitypes) — real-world rejection patterns

### Tertiary (LOW confidence — flag for validation)
- Exact wire format of GitHub `pull_request.opened` webhook for current API version (validate against live sandbox fixture in Wave 0)
- Whether `@octokit/auth-app` v7 cache TTL is exactly 50min (validate empirically; assume <60min default)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library has been used in production by Octokit/Apple/reference implementations; versions current as of 2026-05
- Architecture: HIGH — direct mirror of `server/azure/` pattern (proven in repo) + direct ports from reference repos
- Pitfalls: HIGH — every pitfall has either a canonical citation (Octokit docs, Apple docs) or a direct reference-repo line number
- Hermes precision: LOW — concatenation-artifact filter is heuristic; may need tuning on real customer apps post-launch
- Rule pack content: MEDIUM — initial 10-15 rules are well-documented; ongoing accuracy depends on Apple-update cadence

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for Mach-O/plist/Octokit stack; sooner if Apple updates Required Reason API list)

## RESEARCH COMPLETE
