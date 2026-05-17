# Milestones

## v3.0 Spec-Driven Architecture (Shipped: 2026-05-17)

**Phases completed:** 19 phases, 128 plans, 37 tasks

**Key accomplishments:**
- (none recorded)

---

## v2.0 Device-Stream Integration (Shipped: 2026-04-17)

**Phases completed:** 5 of 6 (Phases 10-14). Phase 15 (operational dependency cleanup) deferred to v3.0.
**Plans completed:** 9
**Timeline:** 2026-04-15 → 2026-04-16
**Git range:** `docs: start milestone v2.0 Device-Stream Integration` → `docs(14-01): complete device preview pipeline plan`

**Key accomplishments:**
- **CLI Doctor rewritten** — 11 dependency checks (Java, Android SDK, ADB, Xcode CLT, Maestro, ffmpeg, PostgreSQL, Node.js, go-ios, sim-capture, idb) with hierarchical output, version gating, and CI-friendly exit codes
- **CLI Dependencies automation** — 9 auto-installers via brew/sdkmanager/softwareupdate with installer registry pattern, streamed subprocess output, and clean `--json` mode
- **Pool manager replaced by device-stream** — `@device-stream/android` (hybrid driver retaining emulator spawning with TangoADB health) and `@device-stream/ios-simulator` (pure wrapper) now drive all device lifecycle
- **MP4 recording via device-stream** — `RecordingService` wraps `RecordingSession` with H.264 (Android scrcpy) and MJPEG (iOS ScreenCaptureKit) frame sources; `ScrcpyService`/`CaptureService` exposed as Fastify decorators
- **Device preview pipeline fixed** — Android/iOS preview adapters with callback chaining and event-emitter filtering bridge `ScrcpyService`/`CaptureService` into `DeviceStreamAdapter` via a post-construction adapter factory

**Tech debt carried to v3.0 (from v2.0 audit):**
- Phase 15 (never planned): undeclared `lifecycle-plugin` dependency on `api` plugin, `file:../device-stream` sibling-repo coupling, `installSimCapture` requires `../device-stream` directory
- CLI device name shows `deviceId` UUID instead of name (Phase 9 cosmetic)
- All 13 phases have `nyquist_compliant: false` — validation never performed

**Known gaps (accepted at archive time):**
- Phase 15 “Fix Operational Dependencies” was never planned. Items tracked in `v2.0-MILESTONE-AUDIT.md` under tech debt.

---
