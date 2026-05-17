# Spike: Graceful Shutdown Timing

**Run on:** MacBook Pro (Apple M4 Max — `Mac16,7`, arm64, Darwin 25.3.0)
**Date:** 2026-04-17
**Config:** 50 × 5s-sleep jobs, timeout=30_000ms, pickup grace=3s
**Command:** `DATABASE_URL="postgresql://heicg@localhost:5432/device_farm_test" npx tsx scripts/spikes/shutdown-timing.ts`
**pg-boss:** v12.15.0
**Schema:** `pgboss_shutdown_spike` (dropped after run)

## Result

```
close took 4032ms
```

Measured on 2026-04-17T15:39:11Z (one invocation; low-concurrency workload —
pg-boss v12 default teamSize=1, so typically 1 job actually drains, the other 49
are left in `created` state and simply released by the graceful shutdown).

## Conclusion

**Keep the 30_000ms `boss.stop({ graceful: true, timeout })` budget.**

- Worst-case measured drain against a single in-flight 5s job: **~4s**.
- That leaves 26s of headroom — the 30s budget is aligned with the default K8s
  grace period and has ample margin for realistic device-farm workloads.
- No retune needed before Phase 16 kickoff. Re-run this spike on the real Mac
  Mini dev target once Phase 16+ workloads are enqueuing multi-minute Maestro
  runs; update the conclusion here if the close duration ever exceeds 15s
  (half the budget).

## Notes

- The initial run with a 1_000ms pickup grace returned 17ms — pg-boss hadn't
  dequeued any job yet, so graceful stop had nothing to drain. Bumping the
  pickup grace to 3_000ms gave pg-boss time to pick up one job before
  `app.close()` fired. This calibration is encoded in
  `scripts/spikes/shutdown-timing.ts` (`PICKUP_GRACE_MS`).
- Script ran on the developer MacBook Pro (Apple M4 Max), not the Mac Mini.
  Re-running on the Mac Mini dev target before Phase 16 is recommended — the
  numbers should be comparable (both Apple Silicon, same pg-boss version). If
  a re-run on the Mac Mini produces close > 15_000ms, bump the timeout or
  lower `teamSize` so fewer in-flight jobs can stack up at shutdown time.
- The graceful-shutdown spec in `server/queue/__tests__/shutdown.spec.ts`
  locks in the single-job drain ceiling (< 2_000ms for one 200ms job) as a
  regression guard.
