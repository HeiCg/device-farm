# Phase 2: Job Execution and API - Research

**Researched:** 2026-03-10
**Domain:** Job queue, child process management, Maestro CLI integration, REST API (Fastify)
**Confidence:** HIGH

## Summary

Phase 2 builds the core job lifecycle on top of Phase 1's device infrastructure. The work decomposes into four domains: (1) job submission via multipart API, (2) FIFO queue with event-driven dispatch, (3) Maestro child process execution with stdout parsing, and (4) full REST API surface. All DB tables, config fields, and the PoolManager integration points already exist from Phase 1.

The Maestro CLI outputs structured lines during execution with patterns like `Running flow <name>`, `<command> COMPLETED/FAILED/SKIPPED`, and a summary like `N/M Flows Passed`. The parser needs to handle ANSI color codes and shard prefixes. For multipart upload, `@fastify/multipart` is the standard Fastify plugin. RFC 7807 error responses are best implemented with a custom Fastify error handler (no mature Fastify plugin exists). Cursor-based pagination on UUID primary keys requires a composite cursor using `(createdAt, id)` since UUIDs are not sequential.

**Primary recommendation:** Build a JobService class as the central orchestrator (create, queue, dispatch, execute, cancel), a MaestroParser as a standalone line-by-line stdout parser, and a JobRoutes Fastify plugin for the full REST surface. Use event-driven dispatch triggered by device release and job submission.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Flat file list via multipart upload -- each YAML file as a separate multipart field
- No ZIP support -- keep it simple, CI constructs multipart with curl/CLI easily
- Validate YAML syntax on upload -- reject job immediately if any file is malformed (fast fail before queue)
- Enforce metadata schema -- reject job if required fields from `job_metadata_schema` config are missing or wrong type
- Queue full -> HTTP 429 Too Many Requests with Retry-After header
- Write flow files to temp dir per job: `/tmp/device-farm/jobs/<job-id>/` -- clean up after job completes
- Single `maestro test <dir>` call -- Maestro discovers and runs all .yaml flows in the directory
- Stdout parser: recognize structured patterns (flow start, command, pass/fail) -> job_steps rows
- Unrecognized output lines: captured in raw `maestro_output` field, no step created (log and skip)
- On timeout: keep partial results, save completed steps, mark job status as 'timeout'
- Event-driven dispatch -- when device becomes idle (after release), immediately check queue and dispatch next job; also check on new job submission
- No polling -- zero latency between device available and job start
- Strict FIFO per platform -- no priority levels, first in first out
- No auto-retry on infrastructure failure -- fail the job with infra error, CI decides whether to resubmit
- Kill Maestro immediately on cancel -- SIGTERM the process, save partial results, release device
- Cursor-based pagination for job list (GET /api/jobs?cursor=<id>&limit=20)
- Metadata filtering via dot notation query params: `?metadata.branch=main&metadata.pr=123` -> translated to JSONB queries
- Error responses follow RFC 7807 Problem Details format: `{ type, title, status, detail, instance }`
- Job detail (GET /api/jobs/:id) returns job + all steps inline in one response
- Standard filters: status, platform, metadata fields, with pagination

### Claude's Discretion
- Exact Maestro stdout parsing regex/patterns (research Maestro output format)
- Fastify multipart plugin choice and configuration
- RFC 7807 implementation approach (Fastify plugin or custom)
- Cursor-based pagination implementation details (cursor encoding, sort order)
- Job service layer internal architecture
- Temp dir cleanup timing and error handling

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| JOBS-01 | User can create job via POST multipart (YAML files + metadata JSON) | @fastify/multipart with `req.parts()` for mixed fields/files, YAML validation with js-yaml |
| JOBS-02 | Jobs queued when no device available (FIFO per platform) | In-memory queue per platform, event-driven dispatch on device release + job submission |
| JOBS-03 | Job Executor runs `maestro test` on allocated device via child_process.spawn | spawn with stdio pipe, MAESTRO_DEVICE_ID env var, temp dir for flow files |
| JOBS-04 | Parser transforms Maestro stdout into structured steps | Line-by-line regex parser matching Maestro output patterns (flow start, command status, summary) |
| JOBS-05 | Configurable timeout kills Maestro process and releases device | setTimeout based on config.jobs.timeout_minutes, SIGTERM -> save partial results -> release |
| JOBS-06 | User can cancel queued or running job | Queue removal for queued jobs, SIGTERM child process for running jobs, save partial results |
| JOBS-07 | Job result includes summary (total, passed, failed, skipped) and detailed steps | Parse Maestro summary line + aggregate from step rows, store in resultSummary JSONB |
| JOBS-08 | Metadata JSONB generico -- CI passes free-form fields | Validate against job_metadata_schema config (required/optional fields), store as JSONB |
| API-01 | GET /api/jobs -- list with filters, pagination | Cursor-based pagination with (createdAt, id) composite cursor, JSONB metadata filtering |
| API-02 | GET /api/jobs/:id -- job details with steps | Single query joining jobs + jobSteps, return inline |
| API-03 | GET /api/jobs/:id/logs -- complete Maestro logs | Return maestro_output text field from jobs table |
| API-04 | GET /api/jobs/:id/recording -- download video | Out of scope for Phase 2 (recordings are Phase 3), return 404 or stub |
| API-05 | DELETE /api/jobs/:id -- cancel job | Route to JobService.cancel(), handle both queued and running states |
| API-06 | GET /api/devices -- list all devices and status | Already exists in Phase 1, enhance with current job info |
| API-07 | POST /api/devices/:id/restart -- restart device | Call into PoolManager/HealthChecker to restart specific device |
| API-08 | GET /api/health -- server + pool status | Already exists in Phase 1, enhance with queue depth and job stats |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/multipart | ^9.x | Multipart file upload parsing | Official Fastify plugin, uses @fastify/busboy underneath |
| js-yaml | ^4.1.1 (already installed) | YAML syntax validation on upload | Already in project, used for config loading |
| child_process (Node built-in) | N/A | Spawn Maestro CLI process | spawn() with stdio: 'pipe' for stdout parsing |
| drizzle-orm | ^0.45.1 (already installed) | DB queries for jobs, steps, pagination | Already in project, supports JSONB queries and cursor pagination |
| async-mutex | ^0.5.0 (already installed) | Queue dispatch concurrency control | Already in project, used by PoolManager |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | built-in | Temp dir creation/cleanup for flow files | Write YAML files to /tmp/device-farm/jobs/<id>/ |
| node:readline | built-in | Line-by-line stdout parsing | Parse Maestro output stream as lines |
| strip-ansi | ^7.x | Remove ANSI color codes from Maestro output | Clean stdout before regex parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| strip-ansi | Manual regex ANSI removal | strip-ansi handles all edge cases; manual regex misses some sequences |
| In-memory queue | Bull/BullMQ with Redis | Overkill for single-node; adds Redis dependency for no benefit at <50 jobs/day |
| Custom RFC 7807 | fastify-problem-details plugin | Plugin is immature (v1.0.0); custom error handler is 30 lines and fully controlled |

**Installation:**
```bash
npm install @fastify/multipart strip-ansi
```

## Architecture Patterns

### Recommended Project Structure
```
server/
  jobs/
    job-service.ts          # Central orchestrator: create, queue, dispatch, execute, cancel
    job-queue.ts            # In-memory FIFO queue per platform
    job-executor.ts         # Spawns Maestro, manages child process lifecycle
    maestro-parser.ts       # Line-by-line stdout parser -> structured steps
    plugin.ts               # Fastify plugin: registers JobService, wires dispatch events
    __tests__/
      job-service.test.ts
      job-queue.test.ts
      job-executor.test.ts
      maestro-parser.test.ts
  api/
    routes.ts               # All REST routes (jobs CRUD, devices, health)
    error-handler.ts        # RFC 7807 error handler
    pagination.ts           # Cursor encoding/decoding helpers
    validation.ts           # Zod schemas for request validation
    plugin.ts               # Fastify plugin: registers routes
    __tests__/
      routes.test.ts
      pagination.test.ts
      error-handler.test.ts
```

### Pattern 1: Event-Driven Job Dispatch
**What:** When a device becomes idle (after release) or a new job is submitted, immediately attempt to dispatch the next queued job.
**When to use:** Every device release and job submission event.
**Example:**
```typescript
// In JobService
class JobService {
  private queues: Map<Platform, JobQueue> = new Map([
    ['android', new JobQueue()],
    ['ios', new JobQueue()],
  ]);

  async submitJob(job: Job): Promise<void> {
    this.queues.get(job.platform)!.enqueue(job);
    await this.tryDispatch(job.platform);
  }

  async onDeviceReleased(platform: Platform): Promise<void> {
    await this.tryDispatch(platform);
  }

  private async tryDispatch(platform: Platform): Promise<void> {
    const queue = this.queues.get(platform)!;
    if (queue.isEmpty()) return;

    const device = await this.pool.allocate(platform, queue.peek().id);
    if (!device) return;

    const job = queue.dequeue()!;
    // Start execution in background (don't await)
    this.executeJob(job, device).catch(err =>
      this.logger.error({ jobId: job.id, error: err.message }, 'Job execution failed')
    );
  }
}
```

### Pattern 2: Line-by-Line Stdout Parser (State Machine)
**What:** Parse Maestro stdout line by line using readline interface, matching known patterns.
**When to use:** During Maestro process execution.
**Example:**
```typescript
import { createInterface } from 'node:readline';
import stripAnsi from 'strip-ansi';

// Maestro output patterns (from source code analysis):
// "Running flow <name>"
// "<command description> RUNNING"
// "<command description> COMPLETED"
// "<command description> FAILED"
// "<command description> SKIPPED"
// "[Passed] <flow> (<duration>)"
// "[Failed] <flow> (<duration>)"
// "N/M Flows Passed" or "N/M Flows Failed"

const FLOW_START = /^(?:\[shard \d+\] )?Running flow (.+)$/;
const COMMAND_STATUS = /^(?:\[shard \d+\] )?(.+?) (COMPLETED|FAILED|SKIPPED|RUNNING)$/;
const FLOW_RESULT = /^(?:\[shard \d+\] )?\[(Passed|Failed|Canceled)\] (.+?) \((\d+)s\)$/;
const SUITE_SUMMARY = /^(\d+)\/(\d+) Flows? (Passed|Failed)/;

class MaestroParser {
  parse(stdout: Readable, callbacks: ParserCallbacks): void {
    const rl = createInterface({ input: stdout });
    rl.on('line', (rawLine) => {
      const line = stripAnsi(rawLine).trim();
      // Match patterns in priority order
      // ...
    });
  }
}
```

### Pattern 3: Fastify Plugin with Decorated Services
**What:** Register JobService on the Fastify instance via plugin decoration, following the established pool plugin pattern.
**When to use:** Service registration and dependency injection.
**Example:**
```typescript
// server/jobs/plugin.ts
declare module 'fastify' {
  interface FastifyInstance {
    jobService: JobService;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const jobService = new JobService(
    fastify.pool,       // from pool plugin
    db,                 // database instance
    fastify.config,     // app config
    fastify.log as unknown as pino.Logger,
  );

  fastify.decorate('jobService', jobService);

  // Wire dispatch trigger: listen for device releases
  // Hook into pool's release flow

  fastify.addHook('onClose', async () => {
    await jobService.shutdown();
  });
}, { name: 'job-plugin', dependencies: ['config', 'pool-plugin'] });
```

### Pattern 4: RFC 7807 Error Handler
**What:** Custom Fastify error handler that formats all errors as RFC 7807 Problem Details.
**When to use:** Global error handler for all API routes.
**Example:**
```typescript
// server/api/error-handler.ts
interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const status = error.statusCode ?? 500;
  const problem: ProblemDetail = {
    type: `https://device-farm.local/errors/${error.code ?? 'internal'}`,
    title: error.message,
    status,
    detail: error.message,
    instance: request.url,
  };
  reply.status(status).header('content-type', 'application/problem+json').send(problem);
}
```

### Pattern 5: Cursor-Based Pagination with UUID
**What:** Use composite cursor (createdAt + id) since UUIDs are not sequential.
**When to use:** GET /api/jobs list endpoint.
**Example:**
```typescript
// Cursor is base64-encoded JSON: { createdAt: ISO string, id: UUID }
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString());
}

function encodeCursor(job: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: job.createdAt, id: job.id })).toString('base64url');
}

// Drizzle query with cursor
const results = await db.select().from(jobs)
  .where(and(
    ...filters,
    cursor ? or(
      lt(jobs.createdAt, cursorData.createdAt),
      and(eq(jobs.createdAt, cursorData.createdAt), lt(jobs.id, cursorData.id))
    ) : undefined,
  ))
  .orderBy(desc(jobs.createdAt), desc(jobs.id))
  .limit(limit + 1); // Fetch one extra to detect hasMore
```

### Anti-Patterns to Avoid
- **Awaiting job execution in the request handler:** The POST /api/jobs endpoint must return immediately with 201 and the queued job. Execution happens asynchronously.
- **Polling for queue dispatch:** Use event-driven dispatch. Polling adds latency and wastes CPU.
- **Parsing Maestro output after process exits:** Parse line-by-line during execution so partial results are available on timeout/cancel.
- **Storing flow file content only in DB:** Also write to temp dir on disk because `maestro test` reads from filesystem.
- **Using offset-based pagination:** With UUID PKs and concurrent inserts, offset pagination skips/duplicates rows.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart parsing | Custom multipart body parser | @fastify/multipart | Multipart RFC is complex (boundaries, encoding, streaming) |
| YAML validation | Custom YAML parser | js-yaml (already installed) | js-yaml.load() throws on malformed YAML with clear errors |
| ANSI code stripping | Regex like `/\x1b\[[0-9;]*m/g` | strip-ansi | Handles all ANSI escape sequences including cursor movement, not just colors |
| Child process lifecycle | Manual spawn + event wiring | Thin wrapper around spawn with AbortController | Node 18+ supports AbortSignal for spawn; handle SIGTERM/SIGKILL escalation |
| UUID generation | Custom ID generation | crypto.randomUUID() or DB gen_random_uuid() | DB already generates UUIDs via default; use DB-generated for consistency |

**Key insight:** The job execution domain has many edge cases (zombie processes, partial results, concurrent dispatch) that benefit from small, well-tested building blocks rather than a monolithic executor.

## Common Pitfalls

### Pitfall 1: Race Condition in Queue Dispatch
**What goes wrong:** Two events (device release + new job) fire simultaneously, both see the same idle device, both try to allocate it.
**Why it happens:** Event-driven dispatch without mutex protection.
**How to avoid:** PoolManager.allocate() already uses a mutex. Additionally, wrap the entire tryDispatch() in a mutex per platform so dequeue + allocate is atomic.
**Warning signs:** Duplicate job starts, "device already allocated" errors in logs.

### Pitfall 2: Maestro Process Not Killed on Timeout/Cancel
**What goes wrong:** SIGTERM sent to Maestro process but child processes (adb, instruments) survive.
**Why it happens:** Maestro may spawn child processes that aren't in the same process group.
**How to avoid:** Spawn Maestro with `detached: true` and `process.kill(-pid, 'SIGTERM')` to kill the entire process group. Escalate to SIGKILL after 5 seconds (same pattern as ProcessTracker).
**Warning signs:** Orphan adb/instruments processes accumulating, devices stuck in "running" state.

### Pitfall 3: Temp Dir Cleanup Race
**What goes wrong:** Temp dir deleted while Maestro is still reading flow files (on cancel/timeout).
**Why it happens:** Cleanup runs immediately after sending SIGTERM, before process actually exits.
**How to avoid:** Wait for the child process 'exit' event before cleaning up temp dir. Use a try/finally pattern.
**Warning signs:** Maestro errors about missing flow files in logs.

### Pitfall 4: ANSI Codes in Parser Input
**What goes wrong:** Regex patterns don't match because Maestro output contains ANSI color escape sequences.
**Why it happens:** Maestro uses colored output (green for pass, red for fail, cyan for shard prefix).
**How to avoid:** Strip ANSI codes from each line BEFORE applying regex patterns. Use strip-ansi library.
**Warning signs:** Parser captures zero steps, all output goes to raw maestro_output.

### Pitfall 5: Cursor Pagination with Non-Sequential UUIDs
**What goes wrong:** Simple `WHERE id > cursor` produces inconsistent page ordering.
**Why it happens:** UUIDv4 values are random, not sequential.
**How to avoid:** Use composite cursor `(createdAt, id)` with proper `OR`/`AND` where clause. Sort by `createdAt DESC, id DESC`.
**Warning signs:** Jobs appearing on multiple pages or missing from pagination.

### Pitfall 6: Multipart Field Order Dependency
**What goes wrong:** Metadata JSON field not available when processing file fields.
**Why it happens:** @fastify/multipart processes fields in order they appear in the request; if files come before metadata, metadata hasn't been parsed yet.
**How to avoid:** Use `req.parts()` async iterator -- collect all parts first, then validate. Document in API that metadata field should come first but handle any order in code.
**Warning signs:** Metadata validation failures on well-formed requests.

### Pitfall 7: Unhandled Promise Rejection in Background Execution
**What goes wrong:** Job execution (running in background after dispatch) throws an unhandled error, crashing the process.
**Why it happens:** executeJob() is called without await (fire-and-forget); if it rejects, nothing catches it.
**How to avoid:** Always `.catch()` on the fire-and-forget promise. In the catch handler, mark the job as failed and release the device.
**Warning signs:** Server crashes during job execution, devices stuck in "allocated" state.

## Code Examples

### Multipart Job Submission Handler
```typescript
// Source: @fastify/multipart docs + project conventions
import multipart from '@fastify/multipart';
import * as yaml from 'js-yaml';

fastify.register(multipart, {
  limits: {
    fileSize: 1024 * 1024, // 1MB per YAML file
    files: 50,             // Max 50 flow files per job
    fields: 10,            // Metadata + other fields
  },
});

fastify.post('/api/jobs', async (request, reply) => {
  const files: Array<{ filename: string; content: string }> = [];
  let metadata: Record<string, unknown> = {};

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      const content = (await part.toBuffer()).toString('utf-8');
      // Validate YAML syntax (fast fail)
      try {
        yaml.load(content);
      } catch (e) {
        throw createError(400, `Invalid YAML in ${part.filename}: ${e.message}`);
      }
      files.push({ filename: part.filename, content });
    } else {
      // Field -- expect 'metadata' and 'platform'
      if (part.fieldname === 'metadata') {
        metadata = JSON.parse(part.value as string);
      }
    }
  }

  const job = await fastify.jobService.createJob({ files, metadata, platform });
  reply.status(201).send(job);
});
```

### JSONB Metadata Filtering with Drizzle
```typescript
// Source: Drizzle ORM docs for JSONB operators
import { sql } from 'drizzle-orm';

function buildMetadataFilters(query: Record<string, string>): SQL[] {
  const filters: SQL[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('metadata.')) {
      const jsonPath = key.replace('metadata.', '');
      // Use PostgreSQL JSONB operator: metadata->>'key' = 'value'
      filters.push(sql`${jobs.metadata}->>${jsonPath} = ${value}`);
    }
  }
  return filters;
}
```

### Maestro Process Spawning
```typescript
// Source: Node.js child_process docs + project ProcessTracker pattern
import { spawn } from 'node:child_process';

function spawnMaestro(flowDir: string, deviceId: string, platform: Platform): ChildProcess {
  const args = ['test', flowDir, '--format', 'junit', '--output', `${flowDir}/report.xml`];

  // Set device targeting env var
  const env: Record<string, string> = { ...process.env };
  if (platform === 'android') {
    env.ANDROID_SERIAL = deviceId; // Maestro uses this to target specific emulator
  }
  // For iOS, Maestro auto-detects booted simulator or uses MAESTRO_DEVICE_ID

  const child = spawn('maestro', args, {
    cwd: flowDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // Create process group for clean kill
  });

  return child;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Offset pagination | Cursor-based pagination | Standard practice for UUID PKs | Consistent results under concurrent writes |
| RFC 7807 | RFC 9457 (supersedes 7807) | 2024 | Same format, 9457 adds minor clarifications; 7807 is still widely used |
| @fastify/multipart busboy | @fastify/multipart @fastify/busboy | 2023 | Fastify forked busboy for maintenance; transparent to users |
| AbortController for spawn | Node 18+ native AbortSignal | 2022 | Cleaner process cancellation via `spawn(cmd, args, { signal })` |

**Deprecated/outdated:**
- `busboy` (original): Use `@fastify/busboy` via `@fastify/multipart` -- Fastify maintains its own fork
- RFC 7807: Technically superseded by RFC 9457, but format is identical; using "RFC 7807" terminology is fine

## Open Questions

1. **Maestro device targeting for iOS simulators**
   - What we know: For Android, `ANDROID_SERIAL` env var targets specific emulator. Maestro docs mention `--device` flag.
   - What's unclear: Exact env var or flag for targeting a specific iOS simulator when multiple are booted.
   - Recommendation: Use `--device <udid>` flag which works for both platforms per Maestro CLI docs.

2. **Maestro stdout format stability**
   - What we know: Current output patterns from source code analysis (RUNNING, COMPLETED, FAILED, SKIPPED, flow result lines).
   - What's unclear: Whether these patterns are stable across Maestro versions or may change.
   - Recommendation: Build parser with fallback -- if a line doesn't match any pattern, append to raw output. Log unmatched lines at debug level for monitoring.

3. **DB connection sharing between plugins**
   - What we know: `createDb()` is called in `buildApp()` in server/index.ts but the `db` instance is not decorated on Fastify or passed to plugins.
   - What's unclear: Whether to decorate `db` on Fastify instance or pass it via plugin options.
   - Recommendation: Decorate `db` on the Fastify instance (like pool plugin does with `app.pool`) so both job-plugin and api-plugin can access it. Create a db-plugin that runs before job-plugin.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JOBS-01 | Multipart upload creates job with validated YAML + metadata | unit + integration | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "create"` | Wave 0 |
| JOBS-02 | FIFO queue per platform, enqueue/dequeue | unit | `npx vitest run server/jobs/__tests__/job-queue.test.ts` | Wave 0 |
| JOBS-03 | Maestro spawn with correct args, env, cwd | unit | `npx vitest run server/jobs/__tests__/job-executor.test.ts -t "spawn"` | Wave 0 |
| JOBS-04 | Stdout parser extracts flow names, commands, status, duration | unit | `npx vitest run server/jobs/__tests__/maestro-parser.test.ts` | Wave 0 |
| JOBS-05 | Timeout kills process, saves partial results, marks timeout | unit | `npx vitest run server/jobs/__tests__/job-executor.test.ts -t "timeout"` | Wave 0 |
| JOBS-06 | Cancel removes from queue or kills running process | unit | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "cancel"` | Wave 0 |
| JOBS-07 | Result summary computed from steps (total, passed, failed, skipped) | unit | `npx vitest run server/jobs/__tests__/maestro-parser.test.ts -t "summary"` | Wave 0 |
| JOBS-08 | Metadata validated against schema, stored as JSONB | unit | `npx vitest run server/jobs/__tests__/job-service.test.ts -t "metadata"` | Wave 0 |
| API-01 | List jobs with filters + cursor pagination | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "list"` | Wave 0 |
| API-02 | Job detail with inline steps | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "detail"` | Wave 0 |
| API-03 | Logs endpoint returns maestro_output | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "logs"` | Wave 0 |
| API-04 | Recording download (stub for Phase 2) | manual-only | N/A -- deferred to Phase 3 | N/A |
| API-05 | Cancel via DELETE | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "cancel"` | Wave 0 |
| API-06 | Device list with job info | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "devices"` | Wave 0 |
| API-07 | Device restart | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "restart"` | Wave 0 |
| API-08 | Health with queue depth | unit | `npx vitest run server/api/__tests__/routes.test.ts -t "health"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/jobs/__tests__/job-service.test.ts` -- covers JOBS-01, JOBS-02, JOBS-06, JOBS-08
- [ ] `server/jobs/__tests__/job-queue.test.ts` -- covers JOBS-02
- [ ] `server/jobs/__tests__/job-executor.test.ts` -- covers JOBS-03, JOBS-05
- [ ] `server/jobs/__tests__/maestro-parser.test.ts` -- covers JOBS-04, JOBS-07
- [ ] `server/api/__tests__/routes.test.ts` -- covers API-01 through API-08
- [ ] `server/api/__tests__/pagination.test.ts` -- covers cursor encode/decode
- [ ] `server/api/__tests__/error-handler.test.ts` -- covers RFC 7807 formatting

## Sources

### Primary (HIGH confidence)
- Maestro CLI source: `TestSuiteInteractor.kt` and `TestSuiteStatusView.kt` -- stdout output patterns
- [@fastify/multipart GitHub](https://github.com/fastify/fastify-multipart) -- API, limits, TypeScript support
- [Drizzle ORM cursor pagination guide](https://orm.drizzle.team/docs/guides/cursor-based-pagination) -- composite cursor pattern for UUIDs
- Existing codebase: pool-manager.ts, device.ts, process-tracker.ts, db/schema.ts -- integration points

### Secondary (MEDIUM confidence)
- [RFC 7807 / RFC 9457](https://datatracker.ietf.org/doc/html/rfc7807) -- Problem Details format specification
- [Maestro CLI docs](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) -- --format, --output, --device flags

### Tertiary (LOW confidence)
- Maestro stdout format stability across versions -- patterns derived from current source, may change
- Exact Maestro device targeting for iOS when multiple simulators booted -- needs runtime validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified, most already in project
- Architecture: HIGH -- follows established project patterns (Fastify plugins, Pino logger, Drizzle, Zod)
- Maestro parsing: MEDIUM -- patterns from source code, but format not officially documented as stable API
- Pitfalls: HIGH -- derived from direct code analysis and known concurrency patterns

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain; Maestro output format is the main volatility risk)
