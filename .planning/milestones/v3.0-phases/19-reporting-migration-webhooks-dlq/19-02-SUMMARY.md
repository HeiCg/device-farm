---
phase: 19
plan: 02
subsystem: reporting
tags: [webhook, deliverOnce, tdd, retry-delete, pg-boss-prep, queue-05]
requires:
  - phase: 19-00
    provides: failing-server.ts shared test fixture (startFailingServer); git mv webhook-service.test.ts → .spec.ts rename
  - phase: 19-01
    provides: job-service bus emit (job.completed) — removed the last `.catch(() => {})` fire-and-forget caller of the old deliver() method
provides:
  - server/reporting/webhook-service.ts deliverOnce (100 lines; retry loop + BASE_DELAY_MS/DEFAULT_MAX_RETRIES deleted)
  - server/reporting/__tests__/webhook-service.spec.ts (186 lines, 14 tests, 282ms — no DB, no pg-boss)
  - QUEUE-05 upstream primitive — single-attempt that pg-boss queue worker (plan 19-03) wraps in try/catch for retry + DLQ accounting
affects:
  - 19-03 (queue.ts worker handler calls deliverOnce inside try/catch; re-throws on failure for pg-boss retry counting)
  - 19-03 DLQ worker (extracts error.message from deliverOnce's `HTTP ${status}` throw for `webhook.failed.retryExhausted` terminal event payload)
  - 19-04 (integration spec exercises deliverOnce through the queue end-to-end)
tech-stack:
  added: []
  patterns:
    - "TDD RED → GREEN pair — prior commit 5dbe619 shipped spec rewrite; this plan lands the implementation"
    - "Call-site migration over deprecated wrapper — report-routes.ts:30 updated to deliverOnce + .catch() rather than keeping deliver() as a thin wrapper"
    - "4xx as non-retryable-success per RESEARCH §Pitfall 7 (resolves without throw; pg-boss marks job success; no DLQ)"
    - "Raw error re-throw with `HTTP ${status}` substring contract — pg-boss serialises to job.output; DLQ worker extracts for terminal event"
key-files:
  created: []
  modified:
    - server/reporting/webhook-service.ts (83 → 100 lines; `deliver` retry-loop method + BASE_DELAY_MS/DEFAULT_MAX_RETRIES constants deleted; deliverOnce implemented; max_retries config field marked @deprecated but preserved for constructor back-compat)
    - server/reporting/report-routes.ts (POST /webhooks ping endpoint migrated from `webhookService.deliver(url, ...)` fire-and-forget to `webhookService.deliverOnce(url, ...).catch(() => {})` — preserves fire-and-forget until plan 19-03 enqueues via boss.send('webhook.deliver'))
  deleted:
    - (none)
tests:
  green:
    - server/reporting/__tests__/webhook-service.spec.ts — 14/14 pass in 282ms
    - full reporting + jobs suites — 98/98 pass in 838ms
  red-to-green-evidence: "Prior RED commit 5dbe619 failed with `TypeError: svc.deliverOnce is not a function` across all 14 tests; this commit lands implementation and all 14 pass."
verification:
  grep-checks:
    - 'grep -c "async deliverOnce(url: string, payload: object): Promise<void>" server/reporting/webhook-service.ts = 1 ✓'
    - 'grep -c "async deliver(url" server/reporting/webhook-service.ts = 0 ✓'
    - 'grep -c "for (let attempt" server/reporting/webhook-service.ts = 0 ✓'
    - 'grep -cE "BASE_DELAY_MS|DEFAULT_MAX_RETRIES" server/reporting/webhook-service.ts = 0 ✓'
    - 'grep -c "DEFAULT_TIMEOUT_MS" server/reporting/webhook-service.ts = 2 (definition + use; plan expected ≥1) ✓'
    - 'grep -c "createHmac" server/reporting/webhook-service.ts = 2 (import + use; plan expected ≥1) ✓'
    - 'grep -c "AbortSignal.timeout(this.timeoutMs)" server/reporting/webhook-service.ts = 1 ✓'
    - 'grep -c "HTTP \${resp.status}" server/reporting/webhook-service.ts = 1 ✓'
    - 'grep -c "@deprecated Phase 19" server/reporting/webhook-service.ts = 2 (interface field + private field; plan expected ≥1) ✓'
    - 'no remaining `.deliver(` call sites in server/reporting|jobs|api (excluding spec files; job-service.ts:431 is a comment reference only) ✓'
  typecheck: 'npx tsc --noEmit shows zero new errors; pre-existing Phase 17/18 Map-vs-RequestContext + recording-service + pipelines/schema errors documented out-of-scope per STATE.md — none in server/reporting/webhook-service.ts or server/reporting/report-routes.ts'
  constructor-back-compat: 'reporting-plugin.ts still compiles — constructor signature `(logger: pino.Logger, config?: WebhookConfig)` unchanged; config.max_retries still accepted (no-op)'
requirements:
  QUEUE-05: "UPSTREAM complete — deliverOnce is the single-attempt primitive that plan 19-03's queue worker wraps in try/catch for pg-boss retry + DLQ. QUEUE-05 closes in plan 19-03."
---

# Plan 19-02 Summary — WebhookService.deliverOnce (GREEN)

## What changed

Single commit `b5e2c7c` (after RED commit `5dbe619`):

**server/reporting/webhook-service.ts** (83 → 100 lines)
- Old `deliver(url, payload)` method + its retry loop (`for (attempt = 0; attempt <= maxRetries)`) + exponential-backoff + jitter DELETED.
- Constants `BASE_DELAY_MS` (1000) and `DEFAULT_MAX_RETRIES` (3) DELETED.
- NEW: `deliverOnce(url: string, payload: object): Promise<void>` — single fetch; resolves on 2xx; resolves on 4xx (logged as warn, non-retryable per RESEARCH §Pitfall 7); throws raw `Error("Webhook delivery failed: HTTP ${status}")` on 5xx for pg-boss retry counting.
- HMAC signing preserved (`X-Signature-256` when `secret` configured).
- `AbortSignal.timeout(timeoutMs)` preserved.
- `WebhookConfig` interface preserved — `max_retries` field kept + marked `@deprecated Phase 19` (accepted by constructor but never read).
- Constructor signature byte-identical; reporting-plugin.ts still compiles.

**server/reporting/report-routes.ts** (webhook ping endpoint, lines 27-35)
- `void fastify.webhookService.deliver(url, {...})` → `void fastify.webhookService.deliverOnce(url, {...}).catch(() => {})`.
- Updated the Phase 17 plan comment to point at Phase 19-03 (queue migration) as the future home.

## Test names (14 green)

- `resolves on 200 OK after exactly ONE fetch call` (single-attempt invariant)
- `resolves on 201 Created`
- `resolves on 204 No Content`
- `resolves WITHOUT throwing on 400 Bad Request`
- `resolves WITHOUT throwing on 404 Not Found`
- `resolves WITHOUT throwing on 422 Unprocessable Entity`
- `throws on 500 Internal Server Error; error message contains HTTP status`
- `throws on 502 Bad Gateway`
- `throws on 503 Service Unavailable`
- `throws on network error (unreachable port)`
- `sends X-Signature-256 header when secret is configured`
- `does NOT send X-Signature-256 header when secret is NOT configured`
- `always sends Content-Type: application/json`
- `throws when target hangs longer than timeout_ms`

## Test runtime

`npx vitest run server/reporting/__tests__/webhook-service.spec.ts` — 14 passed in 282ms (transform 22ms, setup 0ms, import 55ms, tests 126ms).

## Full suite regression check

`npx vitest run server/reporting/ server/jobs/` — 8 files, 98 tests, all pass in 838ms. Zero regression in sibling modules.

## Remaining `.deliver(` grep check

```
grep -rn "webhookService\.deliver\b\|\.deliver(" server/reporting/ server/jobs/ server/api/ | grep -v "\.spec\.\|\.test\." | grep -v "deliverOnce\b"
server/jobs/job-service.ts:431:      // The old `.catch(() => {})` fire-and-forget webhookService.deliver() call
```

Only match is a historical comment explaining WHY the old call is gone (Plan 19-01 already deleted it). No live call sites remain.

## Handoff to plan 19-03

Plan 19-03 creates `server/reporting/queue.ts` (pg-boss work queue definition: `webhook.deliver` + `webhook.deliver.dlq`). The queue's main worker handler calls `webhookService.deliverOnce(url, payload)` inside a try/catch and re-throws on failure so pg-boss increments the retry counter. After `retryLimit:5` exhaustion pg-boss routes the job to the dead-letter queue; the DLQ worker consumes it and emits `webhook.failed.retryExhausted` (terminal, persisted event) via `reportingEmit.failedRetryExhausted` from plan 19-01's reporting/events.ts.

Plan 19-03 also rewrites `server/reporting/reporting-plugin.ts` → `server/reporting/plugin.ts` (factory-wirer pattern, same as plan 18-03 / plan 16-04). This plan 19-02 intentionally left the existing plugin file untouched; plan 19-03 owns the plugin rewrite.

The `report-routes.ts` ping endpoint call site will be updated again in plan 19-03 from the current `.deliverOnce().catch()` wrapper to `boss.send('webhook.deliver', ...)` — the plan-19-02 wrapper is an interim state that preserves fire-and-forget semantics without the deleted retry loop.
