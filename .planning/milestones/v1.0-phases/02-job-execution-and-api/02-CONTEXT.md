# Phase 2: Job Execution and API - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can submit Maestro test jobs via REST API (multipart YAML files + metadata JSON), jobs are queued FIFO per platform, dispatched to allocated devices, Maestro runs as child process with stdout parsed into structured steps, and the full REST API surface is exposed (create, list, detail, logs, cancel, devices, health). No WebSocket streaming, no live preview, no video recording, no storage lifecycle — those are Phase 3.

Requirements: JOBS-01 through JOBS-08, API-01 through API-08.

</domain>

<decisions>
## Implementation Decisions

### Job Submission Flow
- Flat file list via multipart upload — each YAML file as a separate multipart field
- No ZIP support — keep it simple, CI constructs multipart with curl/CLI easily
- Validate YAML syntax on upload — reject job immediately if any file is malformed (fast fail before queue)
- Enforce metadata schema — reject job if required fields from `job_metadata_schema` config are missing or wrong type
- Queue full → HTTP 429 Too Many Requests with Retry-After header

### Maestro Execution & Parsing
- Write flow files to temp dir per job: `/tmp/device-farm/jobs/<job-id>/` — clean up after job completes
- Single `maestro test <dir>` call — Maestro discovers and runs all .yaml flows in the directory
- Stdout parser: recognize structured patterns (flow start, command, pass/fail) → job_steps rows
- Unrecognized output lines: captured in raw `maestro_output` field, no step created (log and skip)
- On timeout: keep partial results, save completed steps, mark job status as 'timeout'

### Queue Dispatch Strategy
- Event-driven dispatch — when device becomes idle (after release), immediately check queue and dispatch next job; also check on new job submission
- No polling — zero latency between device available and job start
- Strict FIFO per platform — no priority levels, first in first out
- No auto-retry on infrastructure failure — fail the job with infra error, CI decides whether to resubmit (consistent with Phase 1 decision)
- Kill Maestro immediately on cancel — SIGTERM the process, save partial results, release device

### API Response Shape & Errors
- Cursor-based pagination for job list (GET /api/jobs?cursor=<id>&limit=20)
- Metadata filtering via dot notation query params: `?metadata.branch=main&metadata.pr=123` → translated to JSONB queries
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

</decisions>

<specifics>
## Specific Ideas

- Maestro is invoked as `child_process.spawn("maestro", ["test", dir])` — decided in PROJECT.md
- PoolManager already has `allocate(platform, jobId)`, `markRunning(deviceId)`, `release(deviceId)` — job executor integrates directly
- DB schema already defined: jobs, job_files, job_steps tables with all needed columns
- Config already has `jobs.timeout_minutes` (default 30), `jobs.max_queue_size` (default 100), `job_metadata_schema` with required/optional arrays
- Event-driven dispatch should hook into PoolManager's device release flow

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PoolManager` (server/pool/pool-manager.ts): `allocate()`, `markRunning()`, `release()`, `getDevices()`, `getDevice()` — ready for job executor integration
- `Device` (server/pool/device.ts): state machine with EventEmitter — can emit events for dispatch triggers
- `AppConfig` (server/config/schema.ts): already has jobs, job_metadata_schema, storage sections
- DB schema (server/db/schema.ts): jobs, jobFiles, jobSteps, recordings tables fully defined with enums

### Established Patterns
- Fastify plugin architecture — each capability is a Fastify plugin (config/plugin.ts, pool/plugin.ts)
- Pino logger with child loggers per component
- Zod for validation (config), Drizzle ORM for DB queries
- Mutex-based concurrency control (PoolManager uses async-mutex)
- Process tracking via ProcessTracker for child processes

### Integration Points
- `server/index.ts` buildApp() — register new job/API plugins after pool plugin
- Pool plugin exposes `app.pool`, `app.processTracker`, `app.healthChecker` on Fastify instance
- Health endpoint already exists at GET /api/health, devices at GET /api/devices — Phase 2 enhances these
- Graceful shutdown already waits for running devices — needs to also handle job cancellation

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-job-execution-and-api*
*Context gathered: 2026-03-10*
