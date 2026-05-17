# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Device Farm is a self-hosted test execution platform for Apple Silicon Macs. It manages Android emulators (and iOS simulators), executes Maestro test flows, and provides real-time observability via WebSocket streaming and a web dashboard.

**Stack:** TypeScript server (Fastify 5) + Go CLI (Cobra) + SvelteKit 5 web UI + PostgreSQL (Drizzle ORM)

## Commands

### Server
```bash
npm run dev                    # Start server with hot reload (tsx watch)
npm run build                  # TypeScript compile to dist/
npm test                       # Run all server tests (Vitest)
npx vitest run server/jobs/__tests__/job-service.test.ts  # Single test file
npx vitest run -t "test name"  # Single test by name
```

### CLI (from `cli/` directory)
```bash
make build                     # Build Go binary to bin/device-farm
make test                      # Run all Go tests
go test -run TestName ./cmd    # Single Go test
```

### Web (from project root)
```bash
npm run web:dev                # SvelteKit dev server on :5173
npm run web:build              # Production build to web/build/
```

### Database
```bash
npx drizzle-kit push           # Apply schema changes to DB
npx drizzle-kit generate       # Generate migration files
```

### Development without emulators
```bash
DEVICE_FARM_CONFIG=config.dev.yaml npm run dev  # Disables device pools
```

## Architecture

### Three-Component System
- **Server** (`server/`): Fastify with 12 plugins registered in dependency order in `server/index.ts`. Each plugin uses Fastify decorators to expose services (e.g., `fastify.jobService`, `fastify.pool`, `fastify.db`).
- **CLI** (`cli/`): Go binary using Cobra commands. Submits jobs via multipart HTTP, streams logs via WebSocket.
- **Web** (`web/`): SvelteKit SPA served by the server's static plugin from `web/build/`. Uses typed API client and WebSocket subscriptions.

### Plugin Registration Order (server/index.ts)
Plugins must register in dependency order. Each declares `{ dependencies: ['...'] }`:
1. config → 2. dependency-checker → 3. pool → 4. db → 5. auth → 6. websocket → 7. artifacts → 8. reporting → 9. jobs → 10. lifecycle → 11. api → 12. static

### Device State Machine
Devices follow strict state transitions validated by `VALID_TRANSITIONS` in `server/types/index.ts`:
```
Booting → Idle ↔ Allocated → Running → Cleanup → Idle
Any state → Error → Booting/Offline
```

### DeviceDriver Interface (`server/pool/types.ts`)
Platform-specific drivers (Android `emulator.ts`, iOS `simulator.ts`) implement: `create`, `boot`, `shutdown`, `isHealthy`, `cleanup`. The PoolManager is platform-agnostic.

### Job Processing Pipeline
1. Multipart upload (flows + metadata + env + APK) → 2. Queue per platform → 3. Allocate device (mutex-protected) → 4. Execute Maestro → 5. Stream logs/steps via WebSocket → 6. Update DB + trigger webhook → 7. Cleanup device

### Key Patterns
- **Error responses:** RFC 7807 Problem+JSON format (`server/api/error-handler.ts`)
- **Job broadcaster:** In-memory per-job message history (last 100) replayed on WebSocket connect
- **Port allocation:** Dynamic allocation with zombie process blacklist to avoid "port in use" errors
- **Config:** Zod-validated YAML loaded from `config.yaml` (override with `DEVICE_FARM_CONFIG` env var)

## TypeScript Conventions
- ES modules with `.js` extensions in imports (NodeNext resolution)
- Zod for runtime validation of config and API inputs
- `async-mutex` for device allocation concurrency control
- Tests use `vi.mock()` at module level; mock factories for Pool, Database, Config, Logger

## Important Notes
- **API Level 35** is used (not 36.1) because API 36.1 crashes on macOS Tahoe due to mprotect/hvf issues
- `pluginTimeout: 120_000` in Fastify config to allow emulator boot during `onReady`
- Server DB schema: 8 tables defined in `server/db/schema.ts`
- Web app uses Svelte 5 runes (`$state`, `$derived`, `$effect`) and Tailwind CSS v4
