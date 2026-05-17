// contracts/ws-messages.ts
// Phase 17 Plan 17-02 — WebSocket message aggregator.
//
// Single entry point for:
//   - server/scripts/build-openapi.ts (activates the WS emit block — un-TODOs the import)
//   - cli/Makefile (17-03 uses this via jq extract of ws-messages.json)
//   - web/src/lib/api/... (17-04 / Phase 29)
//
// Adding a new WS variant:
//   1. Add the Zod schema to the module's ws-schemas.ts with .meta({id:...})
//   2. Import here + call wsMessageRegistry.add(...)
//   3. Re-export below
//   4. Add a canonical fixture to contracts/ws-fixtures/<name>.sample.json
//   5. Update server/websocket/__tests__/frames.spec.ts VARIANTS array
//   6. Regenerate: npm run openapi:generate (emits contracts/ws-messages.json)
//   7. Regenerate: (cd cli && make types) — may need unions.go edit
import { z } from 'zod';
import {
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
} from '../server/jobs/ws-schemas.js';
import {
  devicePreviewMessage,
  deviceStateMessage,
} from '../server/pool/ws-schemas.js';
import {
  artifactCreatedMessage,
} from '../server/artifacts/ws-schemas.js';
import { wsEnvelopeSchema } from '../server/streaming/internal/ws-schemas.js';

export const wsMessageRegistry = z.registry<{ id: string; description?: string }>();
wsMessageRegistry.add(jobLogMessage, { id: 'JobLogMessage' });
wsMessageRegistry.add(jobStepMessage, { id: 'JobStepMessage' });
wsMessageRegistry.add(jobStatusMessage, { id: 'JobStatusMessage' });
wsMessageRegistry.add(devicePreviewMessage, { id: 'DevicePreviewMessage' });
wsMessageRegistry.add(deviceStateMessage, { id: 'DeviceStateMessage' });
wsMessageRegistry.add(artifactCreatedMessage, { id: 'ArtifactCreatedMessage' });
wsMessageRegistry.add(wsEnvelopeSchema, { id: 'WsEnvelope' });

// Re-exports — consumers use a single import path.
export {
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
  devicePreviewMessage,
  deviceStateMessage,
  artifactCreatedMessage,
  wsEnvelopeSchema,
};

// Aggregate union for generic dispatchers (Phase 22 Streaming module).
export const anyWsMessage = z.discriminatedUnion('type', [
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
  devicePreviewMessage,
  deviceStateMessage,
  artifactCreatedMessage,
]);

export type AnyWsMessage = z.infer<typeof anyWsMessage>;
