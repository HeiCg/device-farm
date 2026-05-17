# Phase 19: Reporting Migration (Webhooks + DLQ) - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Move webhook delivery off `.catch(() => {})` fire-and-forget onto pg-boss with retry + dead-letter. Validate the full retry/DLQ/terminal-event pipeline in a production-meaningful module. Concrete deliverables: (1) `WebhookService.deliverOnce()` (single-attempt, throws on non-2xx); (2) `webhook.deliver` pg-boss queue owning `retryLimit: 5` + `retryBackoff: true`; (3) `GET /api/queue/dlq` endpoint with Zod-validated response; (4) `webhook.failed.retryExhausted` terminal event persisted to `events` table with `correlation_id`; (5) reporting module subscribes to `job.completed` from bus and enqueues delivery via Phase 18's `enqueue(name, data, opts)` wrapper; (6) end-to-end correlationId trace from request log → bus event → queue job → 5 retry log lines → DLQ row → terminal event row. Phase 19 does NOT change the wrapper or touch lifecycle queues (Phase 18 scope); does NOT add new event categories beyond webhook delivery (future webhook event types are downstream scope).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. The Phase 16 pilot (`server/hooks/`) and Phase 18 lifecycle module are the reference patterns. Reuse Phase 15 substrate (`server/queue/plugin.ts` `send()` wrapper with ALS correlationId injection, `server/bus/helpers.ts` for subscriptions, `server/events/` table + envelope), the Phase 17 Zod→OpenAPI pipeline for the `/api/queue/dlq` route, and the MOD-01..04 module conventions (MODULE.md, barrel, events.ts, tests-as-spec naming).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/hooks/` — Phase 16 canonical MODULE.md + barrel + events.ts + queue.ts + factory pattern
- `server/lifecycle/` — Phase 18 reference for a module that registers a pg-boss schedule via factory, emits lifecycle events, and graceful-shuts via onClose
- `server/queue/plugin.ts` — `send()` wrapper injects ALS correlationId; Phase 18 Option B fix (per-fire correlationId) in place
- `server/queue/names.ts` — `QUEUE_NAMES` registry; extend with `WEBHOOK_DELIVER` + `WEBHOOK_DELIVER_DLQ`
- `server/bus/` — typed event bus with helpers and plugin; `subscribe(name, handler)` pattern
- `server/events/` — events table + envelope; `persistEnvelope` middleware pattern from bus/plugin.ts (duplicated in lifecycle/internal/module.ts per RESEARCH Open Question #1)
- `server/reporting/` — existing module with webhook delivery logic using `.catch(() => {})` — refactor target
- `server/correlation/` — AsyncLocalStorage plugin with `logContext.run()` / `getCorrelationId()`
- `.dependency-cruiser.cjs` — extend forbidden rule for `server/reporting/internal/*` mirroring hooks + lifecycle

### Established Patterns
- Factory pattern `createXModule(deps)` returning `{ registerSchedulesAndWorkers, shutdown, events }`
- Thin Fastify plugin wirer: construct module → decorate fastify → register workers → onClose shutdown
- Atomic per-task commits; SUMMARY.md per plan; PLAN.md frontmatter (wave, depends_on, files_modified, autonomous)
- Tests-as-spec: `*.spec.ts` co-located under `__tests__/`; DB-gated specs require `DATABASE_URL`
- pg-boss `createQueue → schedule|work → offWork` canonical sequence
- Zod schemas emitted into OpenAPI via `fastify-zod-openapi` (Phase 17 pipeline)
- Terminal events named `<domain>.<verb>.<terminal-reason>` (e.g., `webhook.failed.retryExhausted`)

### Integration Points
- `fastify.boss` / `fastify.bus` / `fastify.logContext` / `fastify.events` decorators (Phase 15/18)
- `server/api/routes.ts` — add `GET /api/queue/dlq` route OR add it to the reporting module barrel and let Phase 27 aggregator wire it
- `server/index.ts` — register reporting module plugin (already registered; Phase 19 swaps the internal body)
- pg-boss dead-letter: pg-boss 10.x stores failed jobs in `pgboss.job` with `state='failed'` and `retrycount >= retryLimit`; DLQ endpoint queries this with optional queue filter
- Phase 18's `enqueue(name, data, opts)` wrapper is `fastify.boss.send` with ALS correlationId — reporting calls it inside the `job.completed` bus subscriber

</code_context>

<specifics>
## Specific Ideas

- `WEBHOOK_DELIVER = 'webhook.deliver'` added to `server/queue/names.ts` (dot-separated per Phase 15/16 convention established in `server/queue/names.ts` — existing constants are `hook.run`, `lifecycle.compress.daily`, etc. The ROADMAP prose form `webhook-deliver` with a hyphen was a loose phrasing; the canonical constant uses dots to match the established codebase convention, which pg-boss v12's regex `^[a-z][a-z0-9._-]*$` accepts.)
- `WEBHOOK_DELIVER_DLQ = 'webhook.deliver.dlq'` — dot-separated, dead-letter suffix convention
- Terminal event name: `webhook.failed.retryExhausted` (matches ROADMAP SC2 verbatim)
- DLQ endpoint path: `GET /api/queue/dlq` (matches ROADMAP SC2 verbatim); Zod response schema includes `id`, `queue`, `state`, `retrycount`, `data`, `output`, `createdon`, `correlation_id`
- Queue worker options: `retryLimit: 5`, `retryBackoff: true` (exponential backoff defaults)
- `WebhookService.deliverOnce(target, payload)` — single-attempt HTTP POST; throws on non-2xx status; timeout via existing fetch + AbortController pattern
- Correlation trace proof: integration spec walks request → `job.completed` bus publish → queue send → 5 worker fires logged → `boss.getJobById` returns failed state → `events` table query finds `webhook.failed.retryExhausted` row with matching `correlation_id`
- ALS store canonical shape for queue-spawned fibers: a plain object matching the `@fastify/request-context` v6 type (`{ correlationId, currentEventId, actor }`) declared in `server/correlation/plugin.ts`. `server/queue/plugin.ts` restores ALS on worker fibers using THIS shape (`asyncLocalStorage.run(storeObject, ...)`) and `server/bus/helpers.ts` reads via a dual-shape `readAls` that accepts BOTH the plain-object form AND a `Map<string, unknown>` form (some legacy test specs still use the Map form). New Phase 19 specs SHOULD use the plain-object form (`asyncLocalStorage.run({ correlationId: cid, currentEventId: null, actor: 'test' } as never, ...)`) as the canonical shape so they exercise the same code path as production. Map-shape spots (hooks, lifecycle tests from earlier phases) are NOT rewritten in Phase 19 — Phase 27+ consolidates.

</specifics>

<deferred>
## Deferred Ideas

- DLQ replay endpoint (re-enqueue from DLQ) — out of scope; `GET /api/queue/dlq` is read-only in Phase 19
- Webhook HMAC signing — separate concern, not mentioned in ROADMAP SC
- Multi-target webhook fan-out — current single-target model carries through
- Webhook event types beyond `job.completed` → webhook delivery (e.g., `device.*` webhooks) — downstream once pool module emits (Phase 20)
- Full reporting route Zod coverage — Phase 17 one-route-minimum already met; full expansion is downstream

</deferred>

---

*Phase: 19-reporting-migration-webhooks-dlq*
*Context gathered: 2026-04-21 via autonomous infrastructure skip*
*Revised: 2026-04-21 to reconcile queue-name convention (dot-separated) per checker W2 + document canonical ALS store shape per checker W5*
