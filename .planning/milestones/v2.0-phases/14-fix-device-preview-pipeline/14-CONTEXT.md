# Phase 14: Fix Device Preview Pipeline - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Close integration gap INTG-01 and flow gap FLOW-01: wire ScrcpyService (Android) and CaptureService (iOS) into DevicePreviewManager via concrete DeviceStreamAdapter implementations so the preview WebSocket delivers live frames.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DevicePreviewManager` (`server/streaming/device-preview.ts`) — fully implemented with subscriber fan-out, just needs a real `AdapterFactory`
- `DeviceStreamAdapter` interface defined: `start(deviceId)`, `onFrame(handler)`, `stop()`
- `ScrcpyService` from `@device-stream/android` — already instantiated in `artifact-plugin.ts`
- `CaptureService` from `@device-stream/ios-simulator` — already instantiated in `artifact-plugin.ts`
- WebSocket route `/ws/devices/:id/preview` already wired in `websocket-plugin.ts` with heartbeat and frame throttling

### Established Patterns
- Services instantiated in plugin files, decorated onto Fastify instance
- Recording service uses same ScrcpyService/CaptureService with H264FrameSource wrapper
- Plugin dependencies declared via `{ dependencies: [...] }`

### Integration Points
- `websocket-plugin.ts:29` — DevicePreviewManager constructed without adapterFactory (uses default that throws)
- `artifact-plugin.ts` — ScrcpyService and CaptureService already decorated on Fastify
- `server/artifacts/recording-service.ts` — pattern for wrapping ScrcpyService/CaptureService into frame sources

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
