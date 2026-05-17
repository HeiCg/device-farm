---
phase: 03-real-time-and-storage
plan: 05
subsystem: artifacts, streaming, jobs
tags: [artifact-service, ffmpeg, recording, screenshot, logcat, memory, websocket, device-preview, fastify-plugin]

requires:
  - phase: 03-real-time-and-storage
    provides: WebSocket streaming infrastructure (JobBroadcaster, WS plugin), recording/screenshot services, logcat/memory/device-preview services, unified artifacts DB table
  - phase: 02-job-execution-and-api
    provides: JobService, JobExecutor, MaestroParser with callback interface
  - phase: 01-device-infrastructure
    provides: ProcessTracker, PoolManager, platform drivers
provides:
  - ArtifactService for DB/filesystem CRUD (create, list, get, delete artifacts)
  - Artifact API routes (GET /jobs/:id/artifacts, GET /jobs/:id/artifacts/:artifactId)
  - Full Phase 3 integration in job execution (recording, screenshot, logcat, memory, broadcasting)
  - Device preview WebSocket route (/ws/devices/:id/preview) with 10fps throttling
  - Artifact Fastify plugin wiring all services
affects: [03-06, 04-cli, 05-web-dashboard]

tech-stack:
  added: []
  patterns: ["Phase3Services options object for backwards-compatible service injection", "Fire-and-forget screenshot on step failure", "Frame piping from DevicePreviewManager to ffmpeg writable"]

key-files:
  created:
    - server/artifacts/artifact-service.ts
    - server/artifacts/artifact-plugin.ts
    - server/artifacts/__tests__/artifact-service.test.ts
    - server/api/__tests__/artifact-routes.test.ts
  modified:
    - server/api/routes.ts
    - server/api/__tests__/routes.test.ts
    - server/jobs/job-service.ts
    - server/jobs/job-executor.ts
    - server/jobs/plugin.ts
    - server/streaming/websocket-plugin.ts
    - server/index.ts

key-decisions:
  - "Phase3Services optional parameter on JobService constructor for backwards-compatible service injection"
  - "Device preview frames piped directly to ffmpeg writable via subscriber pattern (not Readable.pipe)"
  - "Screenshot capture is fire-and-forget with .catch to avoid blocking Maestro execution"
  - "Artifact plugin declares all 5 services (artifact, recording, screenshot, logcat, memory) as Fastify decorations"
  - "Job plugin depends on websocket-plugin and artifact-plugin to access Phase 3 services at construction"

patterns-established:
  - "Optional Phase3Services injection for service integration without breaking existing tests"
  - "Artifact file existence check via fs.access before streaming download response"
  - "Device preview WS throttling via timestamp check (100ms min interval = ~10fps max)"

requirements-completed: [STOR-01, STOR-05, REAL-01, REAL-02, REAL-03, REAL-04, REAL-05, REAL-06, REAL-07]

duration: 7min
completed: 2026-03-10
---

# Phase 3 Plan 05: Service Integration and Artifact Management Summary

**ArtifactService CRUD with API download routes, full Phase 3 service integration in job execution (recording + preview + logcat + memory + broadcasting), and device preview WebSocket endpoint with 10fps throttling**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-10T22:46:53Z
- **Completed:** 2026-03-10T22:53:45Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Built ArtifactService with full CRUD: create records, list by job, get by ID, delete by job (DB + files), path utilities
- Replaced stub recording route with artifact list and download API routes with ownership checks and file existence validation
- Integrated all Phase 3 services into JobService.executeJob(): device preview start, frame piping to ffmpeg, logcat/memory start, MaestroParser event broadcasting, screenshot on failure, artifact record creation in finally block
- Added device preview WebSocket route (/ws/devices/:id/preview) with 10fps frame throttling
- All 235 tests pass across 24 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: ArtifactService CRUD and artifact API routes (RED)** - `1829496` (test)
2. **Task 1: ArtifactService CRUD and artifact API routes (GREEN)** - `51f8cf6` (feat)
3. **Task 2: Wire all services into job execution and register plugins** - `7ef26b3` (feat)

## Files Created/Modified
- `server/artifacts/artifact-service.ts` - ArtifactService with DB CRUD, filesystem operations, and Fastify type augmentation
- `server/artifacts/artifact-plugin.ts` - Fastify plugin instantiating and decorating all 5 artifact services
- `server/artifacts/__tests__/artifact-service.test.ts` - 6 unit tests for ArtifactService CRUD operations
- `server/api/__tests__/artifact-routes.test.ts` - 5 route-level tests for artifact list and download endpoints
- `server/api/routes.ts` - Replaced stub recording route with artifact list and download routes
- `server/api/__tests__/routes.test.ts` - Added artifactService decoration, removed recording stub test
- `server/jobs/job-service.ts` - Full Phase 3 integration: preview, recording, logcat, memory, broadcasting, artifact creation
- `server/jobs/job-executor.ts` - Added ExecutionCallbacks interface and onStdoutLine callback support
- `server/jobs/plugin.ts` - Passes all Phase 3 services to JobService constructor
- `server/streaming/websocket-plugin.ts` - Added device preview WS route and DevicePreviewManager decoration
- `server/index.ts` - Registers websocket, artifact, and job plugins in correct dependency order

## Decisions Made
- Phase3Services parameter is optional on JobService constructor, preserving backwards compatibility with all existing tests
- Device preview frames piped to ffmpeg via subscriber callback (write to writable) rather than Readable.pipe, matching the fan-out subscriber pattern from DevicePreviewManager
- Screenshot capture on step failure is fire-and-forget (.catch logging) to avoid blocking Maestro execution flow
- Job plugin now depends on websocket-plugin and artifact-plugin explicitly, ensuring services are available at construction time
- Broadcaster cleanup uses 5-second delay (setTimeout) to allow late WS readers to receive final messages

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing routes.test.ts for recording route removal**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Existing test expected the old `GET /jobs/:id/recording` stub route which was replaced by artifact routes
- **Fix:** Removed the recording stub test, added artifactService mock decoration to buildTestApp
- **Files modified:** server/api/__tests__/routes.test.ts
- **Verification:** All 17 existing route tests pass, plus 5 new artifact route tests
- **Committed in:** 51f8cf6 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary to maintain test suite correctness after route replacement. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full end-to-end job execution flow: device preview -> recording -> logcat/memory -> Maestro with broadcasting -> artifact creation
- Artifact download API ready for CLI and Web UI consumption
- Device preview WebSocket ready for live device screen viewing
- Plan 03-06 (lifecycle management) can build on top of ArtifactService for compression and retention

## Self-Check: PASSED

All 4 created files verified present. All 3 commits (1829496, 51f8cf6, 7ef26b3) verified in git log.

---
*Phase: 03-real-time-and-storage*
*Completed: 2026-03-10*
