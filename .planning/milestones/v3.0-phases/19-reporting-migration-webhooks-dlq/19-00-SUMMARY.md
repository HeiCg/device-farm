---
phase: 19
plan: 00
subsystem: reporting
tags: [substrate, wave-0, queue-names, schemas, dep-cruiser, mod-02, mod-04, fixtures]
requires:
  - Phase 18 queue.schedule correlationId:null envelope (inherited)
  - Phase 16 dep-cruiser rule 1 pattern
  - Phase 18 dep-cruiser rule 2 pattern + fixture + spec shape
provides:
  - QUEUE_NAMES.WEBHOOK_DELIVER constant
  - QUEUE_NAMES.WEBHOOK_DELIVER_DLQ constant
  - QueuePluginOptions.maintenanceIntervalSeconds passthrough (test-gated)
  - webhookDeliveryPayloadSchema, dlqJobSchema, dlqListResponseSchema Zod source-of-truth
  - WebhookDeliveryPayload, DlqJob, DlqListResponse TS type aliases
  - server/reporting/internal/module.ts stub (plan 19-03 overwrites)
  - .dependency-cruiser.cjs rule 3 "no-deep-imports-into-reporting-internal"
  - __fixtures__/dep-cruiser/bad-reporting-deep-import.ts fixture
  - server/reporting/__tests__/fixtures/failing-server.ts shared test helper
  - server/reporting/__tests__/webhook-service.spec.ts (MOD-04 rename)
affects:
  - Plans 19-01..19-06 can import substrate without serialisation
  - Plan 19-02 webhook-service.spec.ts rewrite targets new filename
  - Plans 19-04/19-05 DB-gated specs consume maintenanceIntervalSeconds + failing-server + schemas
tech-stack:
  added: []
  patterns:
    - "Wave 0 substrate: queue names + plugin options + Zod source-of-truth + dep-cruiser rule + MOD-02 stub + MOD-04 rename + shared fixture in one plan"
    - "vi.doMock + vi.resetModules + dynamic import to spy on ES class constructor with private fields"
    - "4-line internal/ stub required for dep-cruiser rule to fire (Phase 18 18-00 empirical)"
key-files:
  created:
    - server/reporting/internal/module.ts
    - __fixtures__/dep-cruiser/bad-reporting-deep-import.ts
    - server/reporting/__tests__/fixtures/failing-server.ts
  modified:
    - server/queue/names.ts
    - server/queue/plugin.ts
    - server/queue/__tests__/plugin.spec.ts
    - server/reporting/schemas.ts
    - .dependency-cruiser.cjs
    - server/hooks/__tests__/dep-cruiser.spec.ts
  renamed:
    - "server/reporting/__tests__/webhook-service.test.ts -> .spec.ts (100% similarity)"
decisions:
  - "vi.doMock approach for PgBoss constructor spy — PgBoss v12 stores merged config on private #config field, so instance introspection is impossible. Subclass SpiedPgBoss captures ctorArgs and vi.resetModules forces plugin to re-import the mock."
  - "Fixture file compiles clean because tsconfig only includes `server/**/*` — @ts-expect-error future-proofs against later TS checking widenings."
  - "flaky-detector.test.ts and junit-generator.test.ts intentionally NOT renamed per plan directive — out-of-scope for Phase 19; Phase 30 repo-wide migration handles them."
metrics:
  duration: 13min
  tasks: 6
  files_created: 3
  files_modified: 6
  files_renamed: 1
  completed: 2026-04-21
---

# Phase 19 Plan 00: Reporting Substrate Summary

## One-liner

Phase 19 Wave 0 substrate ships 2 queue names (webhook.deliver + webhook.deliver.dlq), maintenanceIntervalSeconds test-gated passthrough, 3 Zod schemas for webhook payload + flat DLQ response, dep-cruiser rule 3 mirror for reporting/internal, 4-line internal/ stub unblocking the rule, .test.ts -> .spec.ts MOD-04 rename, and a shared failing-HTTP-server fixture DRYing ~40 LOC across 5 downstream specs.

## What Changed

### QUEUE_NAMES diff (5 -> 7 entries)

Before Phase 18 state:
```typescript
export const QUEUE_NAMES = {
  DEMO: 'demo',
  HOOK_RUN: 'hook.run',
  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
} as const;
```

After Phase 19-00:
```typescript
export const QUEUE_NAMES = {
  DEMO: 'demo',
  HOOK_RUN: 'hook.run',
  LIFECYCLE_COMPRESS_DAILY:  'lifecycle.compress.daily',
  LIFECYCLE_DISK_HOURLY:     'lifecycle.disk.hourly',
  LIFECYCLE_RETENTION_DAILY: 'lifecycle.retention.daily',
  WEBHOOK_DELIVER:     'webhook.deliver',
  WEBHOOK_DELIVER_DLQ: 'webhook.deliver.dlq',
} as const;
```

Both new constants satisfy `isValidQueueName` regex `^[a-z][a-z0-9._-]*$`. Object.keys(QUEUE_NAMES).length === 7 verified at runtime via `node --experimental-strip-types`.

### server/queue/plugin.ts diff

QueuePluginOptions gains a third optional field:
```typescript
maintenanceIntervalSeconds?: number;
```

PgBoss construction extended with a matching spread-ternary branch AFTER the existing cronMonitorIntervalSeconds forward:
```typescript
const boss = new PgBoss({
  connectionString,
  schema,
  application_name: 'device-farm-server',
  ...(opts.cronMonitorIntervalSeconds !== undefined
    ? { cronMonitorIntervalSeconds: opts.cronMonitorIntervalSeconds }
    : {}),
  ...(opts.maintenanceIntervalSeconds !== undefined
    ? { maintenanceIntervalSeconds: opts.maintenanceIntervalSeconds }
    : {}),
} as never);
```

Production default (opt unset) forwards nothing - pg-boss applies its own 60s default. Plans 19-03/19-04 DB-gated specs will pass `maintenanceIntervalSeconds: 1` so DLQ re-insertion lag collapses into the ~15s vi.waitFor window Phase 18 correlation.spec.ts also uses.

### Spec output

```
DATABASE_URL=... TEST_DATABASE_URL=... npx vitest run server/queue/__tests__/plugin.spec.ts

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  481ms
```

All 7 describe blocks green: Phase 15 decorator shape (3) + Phase 18 schedule correlation (2) + Phase 19 maintenanceIntervalSeconds passthrough (2).

### server/reporting/schemas.ts diff (33 -> 89 lines)

3 new Zod schemas added (Phase 17 webhookCreateRequestSchema + webhookSchema preserved):

- `webhookDeliveryPayloadSchema` — `{url: z.string().url(), payload: z.record(z.string(), z.unknown())}`
- `dlqJobSchema` — flat shape matching CONTEXT §Specifics verbatim: `id, queue, state, retrycount, data, output, createdon, correlation_id` (snake_case field names exactly as specified)
- `dlqListResponseSchema` — `{items: array(dlqJobSchema), count: int().nonnegative()}`

3 new TS type aliases: `WebhookDeliveryPayload`, `DlqJob`, `DlqListResponse`.

All 5 schemas carry `.meta({id, description})` for OpenAPI registry surfacing via Phase 17 pipeline.

### .dependency-cruiser.cjs diff (3 forbidden rules -> 4)

New rule 3 added between existing rule 2 and rule 4:
```javascript
{
  name: 'no-deep-imports-into-reporting-internal',
  comment:
    'Nothing outside server/reporting/** may reach into server/reporting/internal/**. ' +
    'Public API comes from server/reporting/index.ts barrel. Phase 19 MOD-02. ' +
    'Mirrors the Phase 16 hooks rule + Phase 18 lifecycle rule.',
  severity: 'error',
  from: { pathNot: '^server/reporting/' },
  to:   { path:    '^server/reporting/internal/' },
},
```

File-header comment updated: "Three forbidden rules" -> "Four forbidden rules".

`npm run dep-check` on committed codebase: **0 violations, 204 modules, 449 dependencies cruised** (vs 203 modules pre-plan; the new `server/reporting/internal/module.ts` stub is the 204th).

### server/reporting/internal/module.ts (stub)

```typescript
export function createReportingModule(): never {
  throw new Error('Plan 19-03 not yet executed');
}
```

11 lines total including the doc-comment. Plan 19-03 overwrites with the real factory. Stub existence is a hard requirement (Phase 18 18-00 empirically verified: without a resolvable target, depcruise 17.3.10 silently drops the unresolvable import before rule-matching).

### __fixtures__/dep-cruiser/bad-reporting-deep-import.ts

Mirrors the lifecycle fixture shape verbatim with `@ts-expect-error` directive + test-only scoping via `includeOnly: '^server/'` (excluded from `npm run dep-check`; brought in by the spec's `--include-only '^(server|__fixtures__)/'` CLI override).

### server/hooks/__tests__/dep-cruiser.spec.ts extension

Third it-block added to the single describe body, reusing the existing `spawnSync`/`CONFIG`/`INCLUDE_ONLY_OVERRIDE` constants (no setup duplication). Test runs the two-pass err+json reporter pattern and asserts `no-deep-imports-into-reporting-internal` fires on the fixture:

```
npx vitest run server/hooks/__tests__/dep-cruiser.spec.ts

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  2.63s
```

3 it-blocks: hooks + lifecycle + reporting — all green.

### Webhook-service rename (MOD-04)

```bash
git mv server/reporting/__tests__/webhook-service.test.ts server/reporting/__tests__/webhook-service.spec.ts
```

`git log --follow -1 --format=%H server/reporting/__tests__/webhook-service.spec.ts` returns `a417061e708295e89e308748130aaeceb4a20aa3` — the rename commit itself. Git's `--follow` flag follows the rename chain; blame history on the content is preserved because the `git mv` was recorded as a 100% similarity rename. `npx vitest run server/reporting/__tests__/webhook-service.spec.ts`: 6 tests pass (content byte-identical to the pre-rename file). Plan 19-02 rewrites the body.

### server/reporting/__tests__/fixtures/failing-server.ts (136 lines)

Exports:
- `startFailingServer(opts)` — async factory returning `FailingServerHandle`
- `FailingServerHandle` interface — `{url, server, setResponse, requestCount, lastHeaders, lastBody, close}`
- `StartFailingServerOpts` interface — `{defaultResponse?, path?}`
- `TestServerResponse` interface — `{status, body?, hangMs?}`

Uses `createServer` from `node:http` + `.listen(0)` for OS-allocated port. Default response 500 / "nope" matches RESEARCH §Example 2 inline pattern. `close()` returns `Promise<void>`. NOT re-exported from `server/reporting/index.ts` (no barrel exists yet; plan 19-03 creates it without referencing this fixture).

## Verification

All acceptance criteria met:

- QUEUE_NAMES has 7 entries with WEBHOOK_DELIVER + WEBHOOK_DELIVER_DLQ both passing isValidQueueName
- server/queue/plugin.ts forwards maintenanceIntervalSeconds when set (additive; production unchanged)
- server/reporting/schemas.ts preserves Phase 17 ping schemas + adds 3 new Phase 19 schemas with 3 TS type aliases (snake_case `correlation_id` / `retrycount` / `createdon` verified verbatim against CONTEXT)
- server/reporting/internal/module.ts stub exists (11 lines, exports `createReportingModule`)
- .dependency-cruiser.cjs has 4 forbidden rules in expected order: hooks (1), lifecycle (2), reporting (3), direct-bus-emit (4)
- __fixtures__/dep-cruiser/bad-reporting-deep-import.ts exists with @ts-expect-error directive
- server/hooks/__tests__/dep-cruiser.spec.ts has 3 it-blocks, all pass
- server/reporting/__tests__/webhook-service.test.ts renamed to .spec.ts via git mv (blame preserved)
- flaky-detector.test.ts + junit-generator.test.ts UNCHANGED (out-of-scope)
- server/reporting/__tests__/fixtures/failing-server.ts exports 4 symbols (1 function + 3 interfaces)
- npm run dep-check: green (204 modules, 449 deps, 0 violations)
- Full verification suite: 30 tests pass across 9 test files in 5.12s

## Deviations from Plan

None — plan executed exactly as written.

**Notes on execution:**

1. **vi.doMock approach for PgBoss constructor spy** (Task 0.2) — Plan suggested `(fastify.boss as any).config?.maintenanceIntervalSeconds === 1` as primary structural assertion. PgBoss v12 empirically stores merged config on a private `#config` field inaccessible from userland. Switched to `vi.doMock + vi.resetModules + dynamic import` to install a `SpiedPgBoss extends actual.PgBoss` subclass that records the constructor args object. This exercises the REAL plugin code path (`import { PgBoss } from 'pg-boss'` resolves to the mocked module during the test) and yields deterministic structural assertions. Pre-existing tests still green; no test-runtime overhead in the other describe blocks (vi.doUnmock + vi.resetModules in finally).

2. **Pre-existing typecheck errors** documented in STATE.md Phase 18 carried over: 6 errors in unrelated files (`server/artifacts/`, `server/bus/`, `server/events/`, `server/pipelines/`) — all reproduce on HEAD~6 before any Phase 19 work. Phase 18 18-04 SUMMARY documented these as pre-existing fastify-zod-openapi v5 + Map-vs-RequestContext divergence; out-of-scope per SCOPE BOUNDARY rule. No new typecheck errors introduced by Phase 19-00.

3. **Requirements EVENTS-07 + QUEUE-05 NOT marked complete** — Plan 19-00 frontmatter lists them but `gap_closure: false` indicates this is substrate only. Full closure requires: (a) real `createReportingModule` factory overriding the stub — plan 19-03; (b) webhook.failed.retryExhausted terminal event emission — plan 19-04; (c) `GET /api/queue/dlq` route — plan 19-05; (d) end-to-end correlationId trace — plans 19-04 + 19-05. REQUIREMENTS.md checkboxes remain unchecked until the plan that actually lands the behaviour ships (likely 19-05 or 19-06).

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 0.1  | Extend QUEUE_NAMES with WEBHOOK_DELIVER + WEBHOOK_DELIVER_DLQ | `7fcb56a` |
| 0.2  | Add maintenanceIntervalSeconds passthrough to queue plugin | `6a60b68` |
| 0.3  | Extend reporting schemas with webhook delivery + DLQ | `e6c6616` |
| 0.4  | Add reporting/internal dep-cruiser rule + stub + fixture | `8b8d132` |
| 0.5  | Rename webhook-service.test.ts to .spec.ts | `a417061` |
| 0.6  | Add shared failing-HTTP-server test fixture | `4ff96b7` |

## Self-Check: PASSED

- FOUND: server/queue/names.ts (modified, 7 entries in QUEUE_NAMES)
- FOUND: server/queue/plugin.ts (modified, maintenanceIntervalSeconds passthrough)
- FOUND: server/queue/__tests__/plugin.spec.ts (modified, 2 new tests in Phase 19-00 describe)
- FOUND: server/reporting/schemas.ts (modified, 89 lines, 3 new schemas + 3 types)
- FOUND: server/reporting/internal/module.ts (created, 11 lines, stub)
- FOUND: .dependency-cruiser.cjs (modified, 4 forbidden rules)
- FOUND: __fixtures__/dep-cruiser/bad-reporting-deep-import.ts (created)
- FOUND: server/hooks/__tests__/dep-cruiser.spec.ts (modified, 3 it-blocks)
- FOUND: server/reporting/__tests__/webhook-service.spec.ts (renamed, preserved)
- FOUND: server/reporting/__tests__/fixtures/failing-server.ts (created, 136 lines)
- FOUND commit: 7fcb56a
- FOUND commit: 6a60b68
- FOUND commit: e6c6616
- FOUND commit: 8b8d132
- FOUND commit: a417061
- FOUND commit: 4ff96b7
