# Phase 18: Lifecycle Migration (node-cron → pg-boss) - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the `server/lifecycle/` housekeeping module to `boss.schedule()`; establish the correlationId-carrying `boss.send()` wrapper that every future scheduled job will use. The deliverable is: (1) compression, retention, and disk-pressure tasks run on pg-boss named schedules with `singletonKey` preventing overlap; (2) a reusable `enqueue(name, data, opts)` wrapper that injects `correlationId` from AsyncLocalStorage; (3) the lifecycle module refactored to Phase 16 conventions (MODULE.md, barrel, events.ts, tests-as-spec); (4) graceful shutdown drains in-flight jobs.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. The Phase 16 pilot (`server/hooks/`) is the reference pattern to copy; ADR-003 patterns apply where relevant. Reuse the existing `server/correlation/` ALS plumbing and `server/bus/` helpers established in Phase 15.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/hooks/` — Phase 16 pilot module, canonical MODULE.md + barrel + events.ts + queue.ts + factory pattern
- `server/correlation/` — AsyncLocalStorage plugin with `logContext.run()` / `getCorrelationId()` helpers
- `server/bus/` — typed event bus with helpers.ts and plugin
- `server/lifecycle/` — existing module with 4 files: compression-task.ts, disk-pressure-task.ts, retention-task.ts, lifecycle-plugin.ts (currently uses node-cron directly)

### Established Patterns
- Fastify plugin registration order is decorator-dependency-ordered (declared via `dependencies: [...]`)
- Module factory pattern: `createHooksModule(deps)` → barrel re-exports → plugin registers
- Tests colocated under `__tests__/`, Vitest with real Postgres (DATABASE_URL required)
- Atomic per-task commits; SUMMARY.md per plan

### Integration Points
- pg-boss is already installed and integrated (Phase 15 substrate)
- `fastify.boss` / `fastify.bus` / `fastify.logContext` decorators available after plugin-ready
- node-cron is the current scheduler — will be removed from lifecycle (still used by pipelines; that's Phase 25)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase, follow ROADMAP success criteria and Phase 16 reference pattern exactly.

</specifics>

<deferred>
## Deferred Ideas

None — phase scope is sharply defined by ROADMAP success criteria.

</deferred>

---

*Phase: 18-lifecycle-migration-node-cron-pg-boss*
*Context gathered: 2026-04-20 via autonomous infrastructure skip*
