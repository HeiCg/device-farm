# Phase 14: Fix Device Preview Pipeline - Research

**Researched:** 2026-04-15
**Domain:** WebSocket frame streaming, device-stream adapter integration
**Confidence:** HIGH

## Summary

This phase closes two gaps identified in the v2.0 audit: INTG-01 (adapter factory missing) and FLOW-01 (preview delivers no frames). The DevicePreviewManager infrastructure is fully built -- subscriber fan-out, WebSocket route with throttling, heartbeat, auth -- but it constructs with no adapterFactory, so the default throws an error. The fix requires creating two concrete DeviceStreamAdapter implementations (one for Android/ScrcpyService, one for iOS/CaptureService) and wiring a real adapter factory into DevicePreviewManager at construction time.

The recording pipeline (Phase 13) already demonstrates the exact pattern: RecordingService wraps ScrcpyService and CaptureService via H264FrameSource and MJPEGFrameSource. The preview adapters follow the same approach but pipe frames to the DevicePreviewManager's onFrame callback instead of an ffmpeg Writable sink.

**Key insight:** ScrcpyService already sends H.264 packets as base64 JSON over its session WebSocket AND supports a parallel recording callback. For preview, the adapter needs to tap into the same packet stream. CaptureService emits `frameData` events with base64 JPEG data. Both are already instantiated as Fastify decorators in artifact-plugin.ts.

**Primary recommendation:** Create two adapter classes (AndroidPreviewAdapter, IosPreviewAdapter) in `server/streaming/adapters/`, build an adapter factory function that selects by platform, and pass it to DevicePreviewManager in websocket-plugin.ts (which must declare artifact-plugin as a dependency to access scrcpyService/captureService).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion -- pure infrastructure phase.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @device-stream/android | local (file:) | ScrcpyService for Android H.264 streaming | Already integrated in Phase 12-13 |
| @device-stream/ios-simulator | local (file:) | CaptureService for iOS MJPEG streaming | Already integrated in Phase 12-13 |
| @fastify/websocket | installed | WebSocket support in Fastify | Already registered in websocket-plugin |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ws | installed | WebSocket implementation | Already used for frame relay |
| pino | installed | Logging | Logger injection in adapters |

No new packages needed -- everything is already installed.

## Architecture Patterns

### Recommended Project Structure
```
server/streaming/
  adapters/
    android-preview-adapter.ts   # NEW: DeviceStreamAdapter for Android
    ios-preview-adapter.ts       # NEW: DeviceStreamAdapter for iOS
    index.ts                     # NEW: createAdapterFactory() export
  device-preview.ts              # EXISTING: no changes needed
  websocket-plugin.ts            # MODIFY: pass adapterFactory to DevicePreviewManager
  types.ts                       # EXISTING: no changes needed
```

### Pattern 1: Android Preview Adapter

**What:** Wraps ScrcpyService to deliver H.264 frames via the DeviceStreamAdapter interface.

**Key detail:** ScrcpyService.startStream() requires an Adb connection and a WebSocket. For preview, the adapter does NOT start its own scrcpy session -- the session is already running (started by job execution). The adapter taps into the existing session's packet stream via setRecordingCallback (or a similar parallel callback mechanism).

**Alternative approach:** If the preview needs to work independently of job execution (no active scrcpy session), the adapter would need to start its own scrcpy stream. This requires an Adb connection from the pool's AndroidDriver. However, based on job-service.ts, startPreview is called during job execution when a session is already running.

**Frame format:** ScrcpyService emits ScrcpyMediaStreamPacket with `{ type, data, keyframe?, pts? }`. The data is a Uint8Array that needs `Buffer.from(data)` conversion before passing to the onFrame handler. The WebSocket route in websocket-plugin.ts then base64-encodes this for transmission.

```typescript
// AndroidPreviewAdapter implements DeviceStreamAdapter
import type { ScrcpyService } from '@device-stream/android';
import type { DeviceStreamAdapter, FrameHandler } from '../device-preview.js';

export class AndroidPreviewAdapter implements DeviceStreamAdapter {
  private frameHandler: FrameHandler | null = null;

  constructor(
    private readonly scrcpyService: ScrcpyService,
  ) {}

  async start(deviceId: string): Promise<void> {
    // Tap into the existing scrcpy session's packet stream
    this.scrcpyService.setRecordingCallback(deviceId, (packet) => {
      if (this.frameHandler && packet.type === 'data') {
        this.frameHandler(Buffer.from(packet.data));
      }
    });
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  async stop(): Promise<void> {
    // Remove the callback, do NOT stop the scrcpy session
    // (session lifecycle is managed by job execution)
    this.scrcpyService.setRecordingCallback(this.deviceId, undefined);
    this.frameHandler = null;
  }
}
```

**Critical concern:** `setRecordingCallback` is ALSO used by the recording pipeline (H264FrameSource). If both preview and recording run simultaneously (which they do -- job-service starts preview THEN recording), they will conflict because setRecordingCallback overwrites the previous callback. This MUST be addressed.

### Pattern 2: iOS Preview Adapter

**What:** Wraps CaptureService to deliver JPEG frames via DeviceStreamAdapter interface.

**Key detail:** CaptureService extends EventEmitter and emits `frameData` events with `(deviceId, base64Jpeg, width, height)`. The adapter listens on this event, filters by deviceId, and converts to Buffer.

```typescript
// IosPreviewAdapter implements DeviceStreamAdapter
import type { CaptureService } from '@device-stream/ios-simulator';
import type { DeviceStreamAdapter, FrameHandler } from '../device-preview.js';

export class IosPreviewAdapter implements DeviceStreamAdapter {
  private frameHandler: FrameHandler | null = null;
  private eventHandler: ((...args: any[]) => void) | null = null;

  constructor(
    private readonly captureService: CaptureService,
    private readonly deviceId: string,
  ) {}

  async start(deviceId: string): Promise<void> {
    this.eventHandler = (emittedDeviceId: string, base64Jpeg: string) => {
      if (emittedDeviceId === deviceId && this.frameHandler) {
        this.frameHandler(Buffer.from(base64Jpeg, 'base64'));
      }
    };
    this.captureService.on('frameData', this.eventHandler);
  }

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  async stop(): Promise<void> {
    if (this.eventHandler) {
      this.captureService.off('frameData', this.eventHandler);
      this.eventHandler = null;
    }
    this.frameHandler = null;
  }
}
```

**Note:** iOS frames arrive as base64 JPEG. The websocket-plugin then re-encodes to base64 for transmission. This means double base64 if we decode then re-encode. Optimization: pass the base64 string directly as a Buffer (without decoding) since the websocket route does `frame.toString('base64')`. Alternatively, adjust the frame pipeline to avoid double encoding.

### Pattern 3: Adapter Factory Wiring

**What:** Create a factory function and pass it to DevicePreviewManager.

**Key constraint:** websocket-plugin.ts currently declares dependencies `['config', 'auth']`. To access `fastify.scrcpyService` and `fastify.captureService`, it must add `'artifact-plugin'` to dependencies. But artifact-plugin depends on `['config', 'db', 'pool-plugin']` and is registered AFTER websocket-plugin (step 8 vs step 7 in index.ts).

**Resolution options:**
1. **Move adapter factory injection to a later plugin** (e.g., a new `preview-plugin` that depends on both websocket-plugin and artifact-plugin)
2. **Change registration order** in index.ts to register artifact-plugin before websocket-plugin
3. **Use Fastify's onReady hook** to inject the factory after all plugins are registered
4. **Pass services directly** instead of via Fastify decorators -- construct the factory in job-plugin (step 10) which already has access to both

**Recommended:** Option 1 -- create a lightweight `preview-wiring-plugin.ts` that depends on `['websocket-plugin', 'artifact-plugin']` and sets the adapter factory. This avoids disrupting the existing plugin order and is the cleanest Fastify pattern.

Alternative: Modify DevicePreviewManager to accept the factory post-construction via a `setAdapterFactory()` method, then call it from job-plugin. This is simpler but slightly less clean.

### Anti-Patterns to Avoid

- **Starting a new scrcpy session for preview:** The ScrcpyService session is already running during job execution. Starting a second one would conflict. Tap into the existing session instead.
- **Double base64 encoding:** CaptureService emits base64 JPEG. The websocket route calls `frame.toString('base64')` on the Buffer. If you decode then re-encode, you waste CPU. Either pass the base64 string through as-is or skip the re-encode step.
- **Overwriting recording callback:** ScrcpyService.setRecordingCallback replaces the previous callback. If preview and recording both use it, one will stop working. Need a multiplexer or a different approach (see Pitfalls).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frame capture from Android | Raw ADB screen capture | ScrcpyService.setRecordingCallback | Already has H.264 streaming with proper cleanup |
| Frame capture from iOS | Raw ScreenCaptureKit calls | CaptureService EventEmitter 'frameData' | Already parsing binary protocol with frame counting |
| WebSocket frame delivery | Custom WebSocket server | Existing websocket-plugin route | Already has auth, heartbeat, throttling |
| Fan-out to subscribers | Manual subscriber management | DevicePreviewManager | Already has subscriber set with add/remove/fan-out |

## Common Pitfalls

### Pitfall 1: Recording Callback Conflict (Android)
**What goes wrong:** ScrcpyService.setRecordingCallback overwrites the previous callback. If H264FrameSource (recording) sets it, then AndroidPreviewAdapter also sets it, recording breaks.
**Why it happens:** setRecordingCallback was designed for a single consumer.
**How to avoid:** Either (a) multiplex the callback in the adapter -- wrap any existing callback and call both, or (b) use a different mechanism for preview (e.g., tap into the WebSocket relay packets that ScrcpyService already sends). Option (a) is cleaner: before setting the callback, save the existing one and chain them.
**Warning signs:** Recording stops producing frames when preview starts.

### Pitfall 2: Plugin Dependency Order
**What goes wrong:** websocket-plugin tries to access fastify.scrcpyService which doesn't exist yet because artifact-plugin hasn't registered.
**Why it happens:** Plugin registration order in index.ts -- websocket is step 7, artifact is step 8.
**How to avoid:** Don't add artifact-plugin dependency to websocket-plugin. Instead, wire the factory in a separate plugin or via a post-construction setter.
**Warning signs:** "Cannot read property of undefined" on server startup.

### Pitfall 3: Preview Without Active Capture (iOS)
**What goes wrong:** If startPreview is called before CaptureService.startCapture, no frames will be emitted.
**Why it happens:** CaptureService only emits frameData when actively capturing a simulator's screen.
**How to avoid:** The adapter's start() method should call captureService.startCapture(deviceId) if not already capturing. Check with captureService.isCapturing(deviceId) first.
**Warning signs:** Preview connects but no frames arrive for iOS devices.

### Pitfall 4: Preview Without Active Scrcpy Session (Android)
**What goes wrong:** If startPreview is called before ScrcpyService.startStream, there's no session to tap into.
**Why it happens:** ScrcpyService sessions are started by the device-stream integration, not by the preview system.
**How to avoid:** In job-service.ts, startPreview is called during job execution when the device is allocated and scrcpy should already be streaming. Verify the session exists via scrcpyService.isStreaming(deviceId) before setting the callback.
**Warning signs:** "getSession returned undefined" errors.

### Pitfall 5: Memory Leak from Event Listeners (iOS)
**What goes wrong:** If stop() doesn't properly remove the frameData listener, leaked handlers accumulate.
**Why it happens:** Forgetting to call captureService.off() with the exact same function reference.
**How to avoid:** Store the bound handler reference in the adapter instance and remove it in stop().
**Warning signs:** Node.js MaxListenersExceededWarning.

### Pitfall 6: Double Base64 for iOS Frames
**What goes wrong:** CaptureService emits base64 strings. If adapter decodes to Buffer, then websocket-plugin re-encodes to base64, it wastes CPU and increases latency.
**Why it happens:** DeviceStreamAdapter.onFrame expects Buffer, but websocket-plugin.ts does `frame.toString('base64')` to create the message.
**How to avoid:** For iOS, pass the base64 string as a Buffer (Buffer.from(base64String, 'utf-8')) and in the websocket route, detect if it's already base64 OR change the adapter to pass raw JPEG bytes. The simplest fix: decode the base64 to raw JPEG Buffer in the adapter, accept the minor CPU cost (JPEG frames are small at preview resolution).

## Code Examples

### Adapter Factory Function
```typescript
// server/streaming/adapters/index.ts
import type { AdapterFactory } from '../device-preview.js';
import type { ScrcpyService } from '@device-stream/android';
import type { CaptureService } from '@device-stream/ios-simulator';
import { AndroidPreviewAdapter } from './android-preview-adapter.js';
import { IosPreviewAdapter } from './ios-preview-adapter.js';

export function createAdapterFactory(
  scrcpyService: ScrcpyService,
  captureService: CaptureService,
): AdapterFactory {
  return (deviceId, platform) => {
    if (platform === 'android') {
      return new AndroidPreviewAdapter(scrcpyService, deviceId);
    }
    return new IosPreviewAdapter(captureService, deviceId);
  };
}
```

### DevicePreviewManager Setter (if chosen over new plugin)
```typescript
// Add to DevicePreviewManager class
setAdapterFactory(factory: AdapterFactory): void {
  (this as any).adapterFactory = factory;
}
```

### Wiring in Job Plugin (option if using setter)
```typescript
// In job-plugin.ts, after creating services
fastify.devicePreview.setAdapterFactory(
  createAdapterFactory(fastify.scrcpyService, fastify.captureService)
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Default factory (throws) | No factory wired | Phase 6 (initial preview skeleton) | Preview route exists but delivers no frames |
| Manual frame capture | device-stream services | Phase 12-13 | ScrcpyService and CaptureService handle all frame acquisition |

## Open Questions

1. **Recording callback conflict on Android**
   - What we know: setRecordingCallback replaces the previous callback. Both preview and recording need it simultaneously.
   - What's unclear: Whether ScrcpyService should be modified to support multiple callbacks, or if the adapter should chain them.
   - Recommendation: Chain in the adapter -- save existing callback before overwriting, call both. This avoids modifying @device-stream/android.

2. **Should preview start its own capture session?**
   - What we know: job-service calls startPreview during job execution when devices are already streaming.
   - What's unclear: Should preview also work outside job context (e.g., viewing idle devices)?
   - Recommendation: For this phase (gap closure), only support preview during job execution. Idle device preview is a future enhancement.

3. **Frame format for Android preview**
   - What we know: ScrcpyService packets contain H.264 NAL units. The browser would need an H.264 decoder (like Broadway.js or WebCodecs API).
   - What's unclear: Whether the web client expects raw H.264 or decoded JPEG frames.
   - Recommendation: For now, pass raw H.264 packets through. The websocket-plugin already encodes to base64 JSON. The web UI can decode later (WEB-02 requirement is future scope).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run server/streaming/__tests__/device-preview.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTG-01 | Adapter factory creates correct adapter by platform | unit | `npx vitest run server/streaming/__tests__/adapter-factory.test.ts -x` | No - Wave 0 |
| INTG-01 | Android adapter taps into ScrcpyService callback | unit | `npx vitest run server/streaming/__tests__/android-preview-adapter.test.ts -x` | No - Wave 0 |
| INTG-01 | iOS adapter listens on CaptureService frameData event | unit | `npx vitest run server/streaming/__tests__/ios-preview-adapter.test.ts -x` | No - Wave 0 |
| FLOW-01 | DevicePreviewManager with real factory delivers frames | unit | `npx vitest run server/streaming/__tests__/device-preview.test.ts -x` | Yes (mock only) |
| FLOW-01 | Preview heartbeat works alongside frame delivery | unit | `npx vitest run server/streaming/__tests__/device-preview.test.ts -x` | Yes (existing) |

### Sampling Rate
- **Per task commit:** `npx vitest run server/streaming/__tests__/ -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before /gsd:verify-work

### Wave 0 Gaps
- [ ] `server/streaming/__tests__/android-preview-adapter.test.ts` -- covers INTG-01 Android
- [ ] `server/streaming/__tests__/ios-preview-adapter.test.ts` -- covers INTG-01 iOS
- [ ] `server/streaming/__tests__/adapter-factory.test.ts` -- covers factory creation

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `server/streaming/device-preview.ts` -- DevicePreviewManager API, default factory behavior
- Direct code inspection of `server/streaming/websocket-plugin.ts` -- WebSocket route, frame throttling, heartbeat
- Direct code inspection of `server/artifacts/recording-service.ts` -- H264FrameSource/MJPEGFrameSource pattern
- Direct code inspection of `server/artifacts/artifact-plugin.ts` -- ScrcpyService/CaptureService instantiation
- Direct code inspection of `node_modules/@device-stream/android/dist/scrcpy-service.d.ts` -- ScrcpyService API
- Direct code inspection of `node_modules/@device-stream/ios-simulator/dist/capture-service.d.ts` -- CaptureService API
- Direct code inspection of `server/jobs/job-service.ts` -- preview start/stop lifecycle in job execution
- Direct code inspection of `server/index.ts` -- plugin registration order

### Secondary (MEDIUM confidence)
- None

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and used in Phase 12-13
- Architecture: HIGH -- follows exact same patterns as recording pipeline
- Pitfalls: HIGH -- identified from direct code analysis of API contracts and plugin dependencies

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable internal codebase, no external dependency changes expected)
