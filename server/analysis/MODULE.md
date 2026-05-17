# analysis

Phase 37 Plan 37-00 Track A scaffold (Wave 0). Stores iOS skeleton analyses ingested from the `device-farm analyze` CLI command. Wave 1 (Plan 37-01) wires the real factory + routes.

## Purpose

Stores iOS skeleton analyses ingested from `device-farm analyze` invocations. The CLI side (Go `cli/internal/macho`) does the binary extraction; this server module owns persistence (`analyses` table), event emission (`analysis.ingested`), and the REST surface (`POST /api/builds/:id/skeleton`).

Wave 0 ships only scaffolding — `createAnalysisModule` returns `null`, no routes are registered. Wave 1 (Plan 37-01) flips on production logic.

## Public API

Exports from `server/analysis/index.ts`:

| Symbol | Source | Purpose |
|--------|--------|---------|
| `createAnalysisModule` | `./internal/module.js` | MOD-06 factory; constructs the analysis ingest pipeline + emit helpers |
| `AnalysisModule` (type) | `./internal/module.js` | Factory return type — Wave 0: `null`; Wave 1: `{ingest, lookup, bus}` |
| `analysisPlugin` | `./plugin.js` | Default Fastify plugin (registered in Wave 1) |
| `skeletonPayloadSchema` | `./schemas.js` | Zod schema for the CLI ingest body |
| `SkeletonPayload` (type) | `./schemas.js` | `z.infer<typeof skeletonPayloadSchema>` |

Fastify decorators exposed by the plugin:

- `fastify.analysisModule: AnalysisModule | null`

## Events Emitted

| Event | Payload | Persisted | aggregateType |
|-------|---------|-----------|---------------|
| `analysis.ingested` | `{analysisId, buildArtifactId?, jobId?, platform}` | true (Wave 1) | analysis |

Wave 0: constant only — handlers wired in Wave 1.

## Events Consumed

None in Wave 0. Wave 1 may subscribe to `job.completed` to opportunistically trigger skeleton extraction on iOS jobs (deferred — CLI-driven ingest is the primary path).

## Queue Produced

None. Skeleton extraction is synchronous on the CLI side; server only stores the payload.

## Queue Consumed

None.

## Invariants

1. **Payload schema versioned** — every row in `analyses.payload.schema_version` is `1` (Wave 0); Wave 1 enforces via `skeletonPayloadSchema.parse` before insert.
2. **Build artifact OR job link** — `analyses` row references either `buildArtifactId` (PR-bot / pipeline flow) or `jobId` (ad-hoc CLI). Never both null at the same time (Wave 1 enforces via service layer).
3. **Platform fixed to iOS** — Wave 0/1 only emit `platform='ios'`. Android skeleton lives in Phase 38+ (DEFERRED-37-A).

## Non-Goals

- **Binary extraction itself** — lives in `cli/internal/macho/` (Go). This module is the server-side sink only.
- **React Native bundle parsing** — Hermes detection + screen scan happens in Go (`cli/internal/macho/hermes.go`). Server stores the result, not the bytecode.
- **Real-time WS push of analyses** — Wave 1 ships request/response only; web `/builds/[id]/skeleton` page polls. Phase 38+ may add a bus subscriber to streaming.
- **Cross-platform analyses** — Android dex skeleton is a separate phase (out of scope for Phase 37).

## Dependencies

Plugin metadata (`server/analysis/plugin.ts`):

```javascript
dependencies: ['config', 'db']
```

- `config` — Wave 1 reads `fastify.config.analysis` (currently no keys; reserved).
- `db` — `fastify.db` for `analyses` table insert/select.

### Runnable Example

```typescript
// Wave 1 will accept this CLI POST:
// curl -X POST http://localhost:3000/api/builds/<id>/skeleton \
//   -H 'authorization: Bearer <key>' \
//   -H 'content-type: application/json' \
//   --data @skeleton.json
//
// Where skeleton.json matches skeletonPayloadSchema.
import { skeletonPayloadSchema } from 'server/analysis';

const payload = skeletonPayloadSchema.parse({
  schema_version: 1,
  platform: 'ios',
  app: { bundle_id: 'com.example.app', version: '1.0.0' },
  react_native_bundle: null,
  stats: { total_classes: 0, total_swift_types: 0 },
  candidate_screens: [],
  deep_link_entries: [],
  known_gaps: [],
});
```

Wave 0: this typecheck path exists but no plugin is registered in `server/index.ts` yet — Wave 1 adds.

### Phase 37 deferrals

- **Android dex skeleton** — only iOS lands in Phase 37. Android (`apk → dex → class names`) deferred to v3.1 as `DEFERRED-37-D`. See `.planning/phases/37-platform-extensions/deferred-items.md`.
- **Bitcode-based deeper analysis** — Apple deprecated bitcode in Xcode 14. Tracked as `DEFERRED-37-C` (not-feasible).
- **Hermes precision tuning on real customer apps** — post-launch monitoring item (`DEFERRED-37-J`). Confidence rated LOW until tuned against >10 real RN bundles.
