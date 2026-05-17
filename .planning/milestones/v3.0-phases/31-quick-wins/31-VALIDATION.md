---
phase: 31
slug: quick-wins
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `31-RESEARCH.md` Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (server) + Go `testing` (CLI) — both already in repo |
| **Config file** | `vitest.config.ts` (server) + `cli/Makefile` (Go) |
| **Quick run command** | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts` (parser) |
| **Full suite command** | `npm test && cd cli && make test` |
| **Estimated runtime** | ~45s server suite + ~12s Go suite |

---

## Sampling Rate

- **After every task commit:** Run that task's spec file (~1-3s)
- **After every plan wave:** Run subset across `server/jobs/__tests__ server/streaming/__tests__ server/pool/android/__tests__ server/config/__tests__ server/api/__tests__ && cd cli && make test`
- **Before `/gsd:verify-work`:** Full suite green AND `npm run nyquist:check` (regression budget ≤ −2pp per Phase 15+ convention)
- **Max feedback latency:** ~60s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | SC | Test Type | Automated Command | Wave 0? |
|---------|------|------|----|-----------|-------------------|---------|
| 31-01-01 | 01 | 1 | SC1 | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "threadtime"` | ✅ |
| 31-01-02 | 01 | 1 | SC1 | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "crash 3-of-3"` | ✅ |
| 31-01-03 | 01 | 1 | SC1 | unit | `npx vitest run server/jobs/__tests__/log-parsing.spec.ts -t "false positive"` | ✅ |
| 31-01-04 | 01 | 1 | SC1 | integration (DB) | `npx vitest run server/streaming/__tests__/log-parsing-integration.spec.ts -t "single crash detection"` | ✅ |
| 31-01-05 | 01 | 1 | SC1 | integration | `npx vitest run server/streaming/__tests__/log-parsing-integration.spec.ts -t "crash event"` | ✅ |
| 31-02-01 | 02 | 1 | SC2 | integration | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "10k lines"` | ✅ |
| 31-02-02 | 02 | 1 | SC2 | unit | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "disconnect drains"` | ✅ |
| 31-02-03 | 02 | 1 | SC2 | integration | `npx vitest run server/streaming/__tests__/flush-queue.spec.ts -t "nobatch opt-out"` | ✅ |
| 31-02-04 | 02 | 1 | SC2 | unit (web) | `cd web && npm test -- job-stream.test.ts -t "batch unwrap"` | ✅ |
| 31-02-05 | 02 | 1 | SC2 | unit (Go) | `cd cli && go test ./internal/streaming/ -run TestBatchUnwrap` | ✅ |
| 31-03-01 | 03 | 1 | SC3 | unit | `npx vitest run server/config/__tests__/boot-options.spec.ts -t "defaults"` | ✅ |
| 31-03-02 | 03 | 1 | SC3 | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "cold boot"` | ✅ |
| 31-03-03 | 03 | 1 | SC3 | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "audio enabled"` | ✅ |
| 31-03-04 | 03 | 1 | SC3 | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "gpu host"` | ✅ |
| 31-03-05 | 03 | 1 | SC3 | integration | `npx vitest run server/api/__tests__/jobs-boot-options.spec.ts` | ✅ |
| 31-03-06 | 03 | 1 | SC3 | unit (Go) | `cd cli && go test ./cmd/ -run TestRunColdBootMultipart` | ✅ |
| 31-03-07 | 03 | 1 | SC3 | unit | `npx vitest run server/pool/android/__tests__/emulator-boot-options.spec.ts -t "spawn invoked"` | ✅ |
| 31-04-01 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckSuppressEnvVar` | ✅ |
| 31-04-02 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckSuppressCI` | ✅ |
| 31-04-03 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckNewerVersion` | ✅ |
| 31-04-04 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckMalformedTag` | ✅ |
| 31-04-05 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCacheHit` | ✅ |
| 31-04-06 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCacheExpiry` | ✅ |
| 31-04-07 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/ui/ -run TestBannerBox` | ✅ |
| 31-04-08 | 04 | 1 | SC4 | unit (Go) | `cd cli && go test ./internal/updates/ -run TestCheckTimeout` | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Phase 31 test files are new. Wave 0 must create:

- [ ] `server/jobs/__tests__/log-parsing.spec.ts` — SC1 unit cases
- [ ] `server/jobs/__tests__/fixtures/logcat-crash-androidruntime.txt` — fixture
- [ ] `server/jobs/__tests__/fixtures/logcat-crash-native-sigsegv.txt` — fixture
- [ ] `server/jobs/__tests__/fixtures/logcat-anr.txt` — fixture
- [ ] `server/jobs/__tests__/fixtures/logcat-normal-verbose.txt` — fixture
- [ ] `server/jobs/__tests__/fixtures/logcat-mixed.txt` — fixture
- [ ] `server/streaming/__tests__/log-parsing-integration.spec.ts` — SC1 DB + WS event
- [ ] `server/streaming/__tests__/flush-queue.spec.ts` — SC2 batch behavior
- [ ] `server/config/__tests__/boot-options.spec.ts` — SC3 schema defaults
- [ ] `server/pool/android/__tests__/emulator-boot-options.spec.ts` — SC3 argv
- [ ] `server/api/__tests__/jobs-boot-options.spec.ts` — SC3 multipart plumb
- [ ] `web/src/lib/ws/__tests__/job-stream.test.ts` — SC2 batch unwrap
- [ ] `cli/internal/streaming/streaming_test.go` — SC2 Go batch unwrap
- [ ] `cli/cmd/run_test.go` (extend) — SC3 multipart cold-boot
- [ ] `cli/internal/updates/check_test.go` — SC4 unit suite
- [ ] `cli/internal/ui/banner_test.go` — SC4 banner

---

## Manual-Only Verifications

| Behavior | SC | Why Manual | Test Instructions |
|----------|----|------------|-------------------|
| Dashboard "Crash detected" badge renders | SC1 | UI assertion across Svelte 5 reactive state | Submit a job that logs `FATAL EXCEPTION`; verify red badge appears in `/jobs/[id]` within 1s of detection |
| 10k-line job shows < 100 WS frames in DevTools Network → WS | SC2 | Requires browser DevTools observation | Submit job streaming 10k lines; open Chrome DevTools Network/WS; assert frame count < 100 |
| Live GitHub release triggers banner | SC4 | Requires real public release on HeiCg/device-farm | Tag and publish a higher version; run `device-farm` on a clean machine; assert banner appears |

---

## Validation Sign-Off

- [ ] All 24 tasks have `<automated>` verify
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (verified — 24/24 automated)
- [ ] Wave 0 covers all 16 MISSING references above
- [ ] No watch-mode flags (Vitest uses `run`, not `watch`)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set on phase close

**Approval:** pending
