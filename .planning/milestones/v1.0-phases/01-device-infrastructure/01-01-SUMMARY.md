---
phase: 01-device-infrastructure
plan: 01
subsystem: infra
tags: [fastify, zod, drizzle, postgres, yaml, config, typescript]

# Dependency graph
requires:
  - phase: none
    provides: "Greenfield project"
provides:
  - "Zod-validated config system with YAML parsing and env var overrides"
  - "Drizzle ORM schema for devices, jobs, job_files, job_steps, recordings"
  - "Fastify server entry point with config plugin and health route"
  - "Dependency checker for runtime binary validation (adb, emulator, xcrun, ffmpeg, maestro)"
  - "TypeScript types: Platform, DeviceState enum, DeviceInfo, VALID_TRANSITIONS"
affects: [01-02-PLAN, 01-03-PLAN, 01-04-PLAN, 02-01-PLAN]

# Tech tracking
tech-stack:
  added: [fastify 5.8, zod 4.3, drizzle-orm 0.45, postgres.js, js-yaml, async-mutex, vitest, tsx, pino-pretty]
  patterns: [Fastify plugin architecture, Zod pre-parsed defaults for nested objects, execFile for safe binary checks]

key-files:
  created:
    - package.json
    - tsconfig.json
    - vitest.config.ts
    - config.yaml
    - drizzle.config.ts
    - server/config/schema.ts
    - server/config/loader.ts
    - server/config/plugin.ts
    - server/config/__tests__/loader.test.ts
    - server/db/schema.ts
    - server/db/index.ts
    - server/utils/dependency-checker.ts
    - server/utils/__tests__/dependency-checker.test.ts
    - server/types/index.ts
    - server/index.ts
  modified: []

key-decisions:
  - "Used pre-parsed default pattern for Zod 4 nested objects to fix cascading defaults"
  - "Defined all DB tables (devices, jobs, job_files, job_steps, recordings) upfront to avoid migration conflicts"
  - "Used pgEnum for all enum columns instead of string types"

patterns-established:
  - "Fastify plugin pattern: fp(async (fastify) => { ... }, { name }) for encapsulated concerns"
  - "Config loading: YAML + env override + Zod safeParse with formatted error messages"
  - "Zod 4 nested defaults: pre-parse each sub-schema and use parsed result as .default() value"
  - "Dependency checker: execFile (not exec) with timeout, platform-conditional skipping"

requirements-completed: [INFRA-01]

# Metrics
duration: 6min
completed: 2026-03-10
---

# Phase 1 Plan 1: Project Scaffold + Config Summary

**Fastify 5 server scaffold with Zod 4 YAML config validation, Drizzle PostgreSQL schema (5 tables), and execFile-based dependency checker**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-10T03:04:48Z
- **Completed:** 2026-03-10T03:11:07Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Complete ESM project scaffold with Fastify, Zod 4, Drizzle, TypeScript strict mode
- Config system that parses YAML, validates with Zod, and supports env var overrides (DEVICE_FARM_PORT, DATABASE_URL, DEVICE_FARM_CONFIG)
- Full PostgreSQL schema with 5 tables (devices, jobs, job_files, job_steps, recordings) and 5 pgEnums
- Dependency checker that validates runtime binaries with platform-conditional skipping
- 12 passing unit tests covering config loading and dependency checking

## Task Commits

Each task was committed atomically:

1. **Task 1: Project scaffold + Config system with Zod validation** - `b8dbf68` (feat)
2. **Task 2: Database schema + Dependency checker + Server entry point** - `90425da` (feat)

_Note: TDD tasks -- tests written first (RED), then implementation (GREEN), committed together._

## Files Created/Modified
- `package.json` - Project manifest with all dependencies (ESM, Fastify 5, Zod 4, Drizzle)
- `tsconfig.json` - TypeScript config (ES2022, NodeNext, strict)
- `vitest.config.ts` - Vitest config for server tests
- `config.yaml` - Default configuration file matching implementation plan
- `drizzle.config.ts` - Drizzle Kit config for migration generation
- `server/config/schema.ts` - Zod config schema with AppConfig type export
- `server/config/loader.ts` - YAML parse + env override + Zod validation
- `server/config/plugin.ts` - Fastify plugin decorating app with typed config
- `server/config/__tests__/loader.test.ts` - 7 tests for config loading
- `server/db/schema.ts` - Drizzle table definitions (devices, jobs, job_files, job_steps, recordings)
- `server/db/index.ts` - Database connection factory
- `server/utils/dependency-checker.ts` - Runtime binary validation with install hints
- `server/utils/__tests__/dependency-checker.test.ts` - 5 tests for dependency checker
- `server/types/index.ts` - Platform type, DeviceState enum, DeviceInfo, VALID_TRANSITIONS
- `server/index.ts` - Fastify entry point with config, health route, graceful shutdown

## Decisions Made
- **Zod 4 nested defaults:** Zod 4 changed behavior -- `.default({})` on nested objects no longer triggers inner field defaults. Fixed by pre-parsing each sub-schema and using the parsed result as the `.default()` value. This ensures complete default cascading.
- **All tables upfront:** Defined jobs, job_files, job_steps, recordings tables now (used in Phase 2+) to avoid migration conflicts when those phases add them.
- **pgEnum for all enums:** Used Drizzle's pgEnum for platform, device_status, job_status, file_type, step_status -- provides DB-level type safety.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod 4 nested default cascading**
- **Found during:** Task 1 (Config system implementation)
- **Issue:** Zod 4 `.default({})` on outer objects does not trigger inner field defaults. Tests for default values were failing.
- **Fix:** Changed to pre-parsed default pattern: parse each sub-schema with `.parse({})` first, then use the result as the `.default()` value for the parent schema.
- **Files modified:** server/config/schema.ts
- **Verification:** All 7 config tests pass, defaults cascade correctly
- **Committed in:** b8dbf68

**2. [Rule 1 - Bug] Fixed AppConfig import path in plugin.ts**
- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** plugin.ts imported `type AppConfig` from loader.ts, but loader.ts only imported it internally from schema.ts without re-exporting.
- **Fix:** Changed plugin.ts to import AppConfig directly from schema.ts
- **Files modified:** server/config/plugin.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** b8dbf68

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes were necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config system ready for all subsequent plans to use
- DB schema defines all tables needed through Phase 3
- Types (DeviceState, VALID_TRANSITIONS) ready for state machine implementation in 01-02
- Dependency checker ready for server startup integration in 01-04
- Server entry point ready for plugin registration as features are added

---
*Phase: 01-device-infrastructure*
*Completed: 2026-03-10*
