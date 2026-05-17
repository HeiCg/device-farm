# Phase 34 Session API + MCP Server — Deferred Items Catalog

**Phase closed:** 2026-05-16
**Inherited from:** Phase 26 (persistEnvelope consolidation chain — DEFERRED-26-B continues as DEFERRED-34-A); Phase 15 (tsc errors); Phase 17 (fastify-zod-openapi v5 carry-forward).
**New deferrals from Phase 34:** 7 items targeting Phase 35 / 36 / 37 / v3.1.

---

## Inherited (pre-existing, NOT introduced by Phase 34)

### DEFERRED-15-A: Map-vs-RequestContext typecheck errors

**Files:** assorted — `server/bus/helpers.ts`, `server/queue/plugin.ts`,
related subscribers + `server/events/__tests__/emit-helpers.spec.ts` +
`server/hooks/__tests__/events.spec.ts`.

**Failure:** TypeScript strict-mode errors related to the ALS store shape
migration from Map to plain-object (Phase 15/20 pattern). Functional
runtime unaffected (`readAls` helper is dual-shape tolerant). Pre-existing
24-error baseline unchanged through Phase 34.

**Resolution planned:** Phase 27+ (when the final ALS shape cleanup lands).

**Impact on Phase 34:** None.

### DEFERRED-17-A: fastify-zod-openapi v5 `required`-emission bug (non-auth scope)

**Files affected (still pending):** `server/api/__tests__/routes.test.ts`,
`server/artifacts/__tests__/artifact-routes.test.ts`.

**Failure:** fastify-zod-openapi v5.6.1 emits `required` fields with array
representation instead of object; validator-compiler rejects request
bodies that previously validated.

**Resolution planned:** Phase 27+ API Aggregator (fastify-zod-openapi v6
upgrade or swap to `@fastify/zod`).

**Impact on Phase 34:** None — sessions module uses Zod schemas via the
same `fastify-zod-openapi` plugin but emits POST body schemas through
the route registrar where the harness picks up `.meta({id:...})` correctly.
Routes.spec coverage for sessions did NOT regress.

---

## New Phase 34 deferrals (7)

### DEFERRED-34-A: persistEnvelope 11TH SAMPLE POINT consolidation (supersedes DEFERRED-26-B)

**Status:** The 10-line `persistEnvelope` middleware in
`server/sessions/internal/module.ts:makePersistEnvelope` is the 11th
verbatim copy across:

- `server/hooks/internal/module.ts` (Phase 16)
- `server/lifecycle/internal/module.ts` (Phase 18)
- `server/reporting/internal/module.ts` (Phase 19)
- `server/pool/internal/module.ts` (Phase 20)
- `server/artifacts/internal/module.ts` (Phase 21)
- `server/streaming/internal/module.ts` (Phase 22)
- `server/jobs/internal/module.ts` (Phase 23)
- `server/maestro/internal/module.ts` (Phase 24)
- `server/pipelines/internal/module.ts` (Phase 25)
- `server/auth/internal/module.ts` (Phase 26)
- `server/sessions/internal/module.ts` (Phase 34 — THIS sample)

Pattern is locked-in (11 verbatim instances); consolidation requires
touching 11 modules atomically + extracting to
`server/bus/persist-envelope.ts`.

**Owner:** Phase 27+ API Aggregator. Replace 11 duplicates with imports.

**Why not Phase 34?** Phase 34 is module-introduction scope; consolidation
is a tree-wide refactor that's safer once the API aggregator phase
defines the canonical extraction site. Each module body (16-26 + 34) had
higher individual leverage than the consolidation itself.

**Supersedes:** DEFERRED-26-B.

### DEFERRED-34-B: Multi-session-per-device

**Status:** Phase 34 enforces a hard server-side guarantee of one active
session per device via the partial unique index
`sessions_device_active_idx WHERE status='active'` (Drizzle migration 0009).
The Section §Non-Goals in `server/sessions/MODULE.md` explicitly defers
multi-tenant device sharing.

**Owner:** v3.1 / future feature phase. Requires WS broadcast topology
design (collaborative driving vs observer mode), per-tenant permission
model, and conflict resolution semantics (whose tap wins when 2 owners
race).

**Why not Phase 34?** Single-session-per-device is the simplest sufficient
contract for the MCP + CLI + web use cases. Multi-tenant is a feature
expansion belonging in a dedicated phase.

### DEFERRED-34-C: Full iOS hierarchy walker for the NL resolver

**Status:** Phase 34 Plan 34-03 ships a best-effort iOS resolver that
parses `simctl ui` dumps where available. The Maestro AI XML heuristic
was tuned primarily for the Android uiautomator dump shape; iOS
production-grade coverage requires a deeper WDA-bridge integration.

**Owner:** Phase 36 (CommandPalette + DeviceDiscovery) or Phase 37
(Platform Extensions). Tied to the iOS skeleton extraction work in
Phase 37 Track A — the same hierarchy data feeds both surfaces.

**Why not Phase 34?** Phase 34 scope was the SESSION primitive; cross-
platform NL resolver parity is a horizontal enhancement that ships when
the iOS surface area is independently mature.

### DEFERRED-34-D: Per-session resolver cost cap

**Status:** Phase 34 documents the resolver cost ceiling in
`docs/runbooks/session-resolver-costs.md` (~$0.005-0.01 per
ClaudeVisionResolver call) but does NOT enforce a per-session call cap
at the resolver layer. Today the only ceilings are the per-action 30s
timeout (bounds Anthropic latency) and the per-session rate limit (30
actions / 10s — applies to all envelopes, not just `tapByDescription`).

**Owner:** Phase 37 Platform Extensions. May add a configurable
`sessions.resolver.callsPerSession` ceiling after 30-day production
usage shows whether the cap is needed.

**Why not Phase 34?** No production cost evidence yet. The Maestro AI
default + FallbackResolver chain already bounds cost by amortizing
through the cheap deterministic primary. Premature enforcement would
add complexity without measurable benefit.

### DEFERRED-34-E: MCP resource expansion beyond `device-farm://devices`

**Status:** Phase 34 ships a single MCP resource (`device-farm://devices`)
that lists available pool devices. Future resources could include
`device-farm://sessions` (active session list), `device-farm://artifacts`
(uploaded build artifacts), or `device-farm://screenshots` (recent
screenshot artifact ids).

**Owner:** Phase 35 (App Explorer). Adds `device-farm://explorations`
as a new MCP resource so Claude Code can pick "open this exploration"
from a resource picker.

**Why not Phase 34?** Resource expansion lands incrementally with each
phase that introduces a new resource type. Phase 34 establishes the
resource registration pattern (`server.registerResource(name, uri,
metadata, handler)`); subsequent phases ride on it.

### DEFERRED-34-F: Live `/sessions` list updates via WS broadcast

**Status:** Phase 34 ships the `/sessions` list view as a static load
(SvelteKit `+page.ts` calls `loadActiveSessions()` once at navigation
time). Real-time propagation of leases/releases from other actors would
require a `session.*` WS broadcast channel + a web-side subscription.

**Owner:** Phase 36 (CommandPalette). The palette already needs live
device + session state for fuzzy-search "Open session ..." actions; the
list-page subscription is a sibling consumer.

**Why not Phase 34?** Static load is sufficient for the human-debug-
surface UX. Real-time propagation is a Phase 36+ polish that wraps the
already-shipped REST surface in a thin WS layer.

### DEFERRED-34-G: Maestro `--ai-prompt` fallback shell-out for unmatched targets

**Status:** Originally considered as a 3rd resolver backend (after
Maestro AI XML heuristic + Claude Vision) to invoke
`maestro test --ai-prompt "tap on Login button"` as a last-resort
fallback. NOT implemented in Phase 34 — the heuristic + Claude Vision
chain handled every test case in the design phase.

**Owner:** Cleared as never-needed if the heuristic + Claude Vision
fallback chain suffices in production. Verify after 30-day prod usage:
if `resolver_failed` rate exceeds an operational threshold (TBD), this
deferral re-opens as a Phase 37+ task.

**Why not Phase 34?** Adds a hard runtime dependency on the Maestro CLI
binary being installed on every device-farm host — the existing chain
keeps the binary requirement optional.

---

Total: 7 Phase 34-specific deferrals + 2 carry-forwards = 9 tracked items at Phase 34 close.

Phase 35 App Explorer unblocked — depends on Phase 34 session primitive +
MCP surface. Phase 35 owns DEFERRED-34-E MCP resource expansion. Phase 36
CommandPalette owns DEFERRED-34-F live list updates + DEFERRED-34-C iOS
resolver parity. Phase 37 Platform Extensions owns DEFERRED-34-D
per-session cost cap (and may revisit DEFERRED-34-G if the resolver chain
proves insufficient in production). v3.1 owns DEFERRED-34-B multi-session-
per-device. Phase 27+ continues to own DEFERRED-34-A persistEnvelope
consolidation (11TH SAMPLE POINT — chain reaches its limit at 11 modules).
