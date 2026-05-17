# Roadmap: Device Farm

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-11)
- ✅ **v2.0 Device-Stream Integration** — Phases 10-14 (shipped 2026-04-17). See `.planning/milestones/v2.0-ROADMAP.md`.
- ✅ **v3.0 Spec-Driven Architecture** — Phases 15-37 (shipped 2026-05-17). See `.planning/milestones/v3.0-ROADMAP.md`.

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-9) — SHIPPED 2026-03-11</summary>

- [x] Phase 1: Device Infrastructure
- [x] Phase 2: Job Execution and API
- [x] Phase 3: Real-Time and Storage
- [x] Phase 4: Go CLI
- [x] Phase 5: Web Dashboard
- [x] Phase 6: Authentication and Reporting
- [x] Phase 7: CLI WebSocket Auth Token
- [x] Phase 8: Fix Web Dashboard Data Contracts
- [x] Phase 9: Fix CLI Data Contracts

</details>

<details>
<summary>✅ v2.0 Device-Stream Integration (Phases 10-14) — SHIPPED 2026-04-17</summary>

- [x] Phase 10: CLI Doctor (2/2 plans) — completed 2026-04-15
- [x] Phase 11: CLI Dependencies (2/2 plans) — completed 2026-04-15
- [x] Phase 12: Device Management (2/2 plans) — completed 2026-04-16
- [x] Phase 13: Recording (2/2 plans) — completed 2026-04-16
- [x] Phase 14: Fix Device Preview Pipeline (1/1 plan) — completed 2026-04-16

**Deferred to v3.0:**
- Phase 15: Fix Operational Dependencies (absorbed into v3.0 Foundations + Contracts phases)

See `.planning/milestones/v2.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v3.0 Spec-Driven Architecture (Phases 15-37) — SHIPPED 2026-05-17</summary>

**Milestone Goal:** Refactor server + CLI + web for spec-driven (Zod everywhere) and event-driven (typed bus + pg-boss) architecture so the codebase is readable and maintainable by LLMs. Closes with iOS/Android streaming bridges, session API + MCP, App Explorer, physical-device pairing + ⌘K, and platform extensions.

- [x] Phase 15: Foundations (10/10 plans) — completed 2026-04-17
- [x] Phase 16: Pilot Module — hooks (5/5) — completed 2026-04-17
- [x] Phase 17: Contracts Pipeline & Ops Hygiene (9/9) — completed 2026-04-20
- [x] Phase 18: Lifecycle Migration node-cron → pg-boss (5/5) — completed 2026-04-21
- [x] Phase 19: Reporting Migration Webhooks + DLQ (7/7) — completed 2026-04-21
- [x] Phase 20: Pool Module Devices (7/7) — completed 2026-04-21
- [x] Phase 21: Artifacts Module (7/7) — completed 2026-04-22
- [x] Phase 22: Streaming Module (7/7) — completed 2026-05-08
- [x] Phase 23: Jobs Module Keystone (8/8) — completed 2026-05-08
- [x] Phase 24: Maestro Module (6/6) — completed 2026-05-08
- [x] Phase 25: Pipelines Module (6/6) — completed 2026-05-08
- [x] Phase 26: Auth Module (6/6) — completed 2026-05-15
- [x] Phase 31: Quick Wins (5/5) — completed 2026-05-15
- [x] Phase 32: SimulatorKit Private Bridge (6/6) — completed 2026-05-16
- [x] Phase 33: Android gRPC EmulatorController (7/7) — completed 2026-05-16
- [x] Phase 34: Session API + MCP Server (9/9) — completed 2026-05-16
- [x] Phase 35: App Explorer + Atlas Graph (7/7) — completed 2026-05-16
- [x] Phase 36: Physical Devices + Discovery + ⌘K (5/5) — completed 2026-05-17
- [x] Phase 37: Platform Extensions (6/6) — completed 2026-05-17

See `.planning/milestones/v3.0-ROADMAP.md` for full details.

</details>

### 📋 v4.0 (Planning)

Next milestone TBD — run `/gsd:new-milestone` to define scope, requirements, and phases.

## Progress

| Milestone | Phases | Status   | Shipped    |
| --------- | ------ | -------- | ---------- |
| v1.0      | 1-9    | Complete | 2026-03-11 |
| v2.0      | 10-14  | Complete | 2026-04-17 |
| v3.0      | 15-37  | Complete | 2026-05-17 |
