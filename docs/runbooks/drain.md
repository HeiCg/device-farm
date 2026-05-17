# Runbook: Graceful Drain

Phase 23 Plan 23-05 — operator-initiated quiescence procedure for safe Device Farm restarts.

## Why drain?

The Device Farm runs Maestro test execution against Android emulators (and iOS simulators). Killing the server mid-execution leaves emulators in inconsistent states (allocated but never released; recordings half-written; pending webhooks lost). Drain stops new work and waits for in-flight to finish naturally before you restart or shut down the server.

## Mechanism (Pitfall 1 corrected)

pg-boss v12 has **NO** `paused` flag on `updateQueue` — the canonical drain pattern uses `boss.offWork` + a persistent `system_state` row + an admission check:

1. **Persistent flag:** A row in `system_state` (`key = 'drain_requested_at'`) records the intent. This survives server restart — the jobs plugin reads it on `onReady` via `honorDrainOnBoot` and immediately calls `boss.offWork` so a restart while drained does NOT accidentally resume processing.
2. **Worker stop:** `boss.offWork(JOB_EXECUTE_QUEUE_NAME, {wait:false})` removes the worker from this server's pg-boss instance for both `job.execute` and `recording.upload`. In-flight workers complete their current handler. New jobs in the queue are NOT picked up. (Single-node deployment — no other server can pick them up either.)
3. **Admission gate:** `fastify.jobsModule.enqueueJob` reads the system_state row before `queue.send`; presence → throws `503 system_draining` (code `DRAINING`).

## Procedure

### Drain

`POST /admin/drain?timeout=N` (default N=300, max N=1800).

```bash
curl -X POST 'http://localhost:3000/admin/drain?timeout=300' \
  -H 'Authorization: Bearer <YOUR_API_KEY>'
```

The endpoint long-polls until the in-flight count reaches zero or the timeout elapses (default 300s, max 1800s).

Response (success):
```json
{"drained": true, "in_flight": 0, "drained_at": "2026-05-08T12:00:00.000Z"}
```

Response (timeout — in-flight stuck):
```json
{"drained": false, "in_flight": 2, "timeout": true}
```

### Restart server

Once `drained:true`:
```bash
sudo systemctl restart device-farm   # or your process manager
# OR — for dev:
# Ctrl-C, then `npm run dev`
```

On boot the jobs plugin reads `system_state.drain_requested_at`; the row exists, so `honorDrainOnBoot` calls `offWork` immediately. Worker stays parked.

### Resume

`POST /admin/drain/resume` (no body; auth required).

```bash
curl -X POST 'http://localhost:3000/admin/drain/resume' \
  -H 'Authorization: Bearer <YOUR_API_KEY>'
```

Response:
```json
{"resumed": true}
```

The plugin re-registers the pg-boss worker via `jobsModule.registerWorkerOnly` (NOT `registerWorkerAndSubscribers` — Fastify's `addHook` would throw `FST_ERR_INSTANCE_ALREADY_LISTENING` after `ready()`). The artifacts module's `recording.upload` worker is also re-registered when present. New `enqueueJob` calls accept again.

## Failure modes

- **Timeout — in-flight stuck:** A job has hung (zombie qemu, network wait, etc.). Manual recovery: identify via `fastify.jobsModule.runningJobs` keys (logs); `kill -9` the qemu process; the worker's AbortController completes; in-flight count decrements. Alternatively, force-restart server while drain row present — plugin honors drain on next boot.
- **Resume fails:** if `registerWorkerOnly` errors during resume, the system_state row is already deleted but the worker is not registered. Fix: restart server (plugin registers worker via `createJobsModule.registerWorkerAndSubscribers` on boot; with no drain row, work proceeds normally).
- **Database unreachable:** Drain endpoint returns 5xx. The system_state row may not have been written. Manual recovery: when DB recovers, POST /admin/drain again.

## Auth

Both endpoints require any-valid API key (Bearer token or `X-API-Key` header). The token is validated via `authService.validateKey`. Phase 26 Auth Module formalizes an admin claim + `requireAdmin` middleware (DEFERRED-23-A); until then ANY valid key is accepted.

## Events

`system.drain.completed` event is persisted to the `events` table on successful drain. Audit trail — query by `event_type` for drain rehearsal history. Carries `drainedAt` (ISO) and `durationMs` (wall-time from request to in-flight=0).

`system.drain.resumed` event is persisted on resume. Carries `resumedAt` (ISO).

Both events use `aggregateType: 'system'` (not `'job'`) per DEFERRED-23-B; this discriminates them in trace-tree consumption.

## Observability

Watch logs:
```bash
journalctl -u device-farm -f | grep -i drain   # systemd
# OR
docker logs device-farm 2>&1 | grep -i drain   # docker
```

Look for:
- `Drain completed (in-flight=0)` — successful drain
- `Drain timed out — in-flight still non-zero` — timeout case
- `Boot detected drain_requested_at` — restart honoring drain
- `Drain resumed (workers re-registered)` — successful resume
