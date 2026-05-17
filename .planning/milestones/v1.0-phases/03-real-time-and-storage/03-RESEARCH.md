# Phase 3: Real-Time and Storage - Research

**Researched:** 2026-03-10
**Domain:** WebSocket streaming, video recording, artifact lifecycle management
**Confidence:** MEDIUM-HIGH

## Summary

Phase 3 adds real-time observability (WebSocket streaming of logs, steps, metrics, and live device preview) and artifact lifecycle management (recording, screenshots, storage, compression, retention). The core integration challenge is wiring into the existing `JobService.executeJob()` flow to start/stop recording, capture screenshots on failure, stream events via WebSocket, and manage artifact files on disk with automated cleanup.

The standard stack is well-defined by project decisions: `@fastify/websocket` v11.x for WebSocket support (compatible with Fastify 5), `@device-stream/*` (existing internal library) for live device preview, direct `ffmpeg` spawning via `child_process.spawn` for video recording (fluent-ffmpeg is archived/deprecated as of May 2025), `node-cron` for lifecycle scheduling, and platform-native tools (`adb exec-out screencap -p`, `xcrun simctl io screenshot`) for screenshots.

**Primary recommendation:** Structure implementation in layers -- (1) WebSocket infrastructure and job event broadcasting, (2) device preview and video recording via device-stream + ffmpeg, (3) screenshot capture and artifact storage, (4) lifecycle automation (compression, retention, disk pressure).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single WebSocket connection per job at `/ws/jobs/:id` -- all event types (log, step, metrics, status) on one socket with a `type` field
- Separate endpoint for live device preview at `/ws/devices/:id/preview` -- device-scoped
- All messages are JSON: `{ type: 'log'|'step'|'metrics'|'status', data: {...}, timestamp }` -- including video frames as base64 on preview endpoint
- Late join: replay recent history on connect -- burst of recent log lines + all steps so far + current status, then stream live
- @fastify/websocket for WebSocket support
- Record entire job duration -- one MP4 per job, start when Maestro begins, stop when job finishes
- Capture via device-stream + ffmpeg pipe -- reuse same stream for live preview and recording
- Works for both Android (@device-stream/android) and iOS (@device-stream/ios-simulator)
- Screenshot via platform-native tools: `adb exec-out screencap -p` (Android) and `xcrun simctl io screenshot` (iOS)
- Screenshot triggered when MaestroParser detects a step failure
- Logcat + memory as separate artifact files, streamed live via job WebSocket
- Nested artifact storage by job ID: `storage/artifacts/<job-uuid>/recording.mp4, screenshots/*.png, logcat.txt, memory.json, maestro.log`
- Replace `recordings` table with unified `artifacts` table
- Individual artifact downloads via API: GET /api/jobs/:id/artifacts (list), GET /api/jobs/:id/artifacts/:artifactId (download)
- node-cron for lifecycle scheduling (in-process)
- Compression: ffmpeg re-encode to lower quality after compress_after_days (default 7)
- Deletion: remove artifacts after retention_days (default 30)
- Disk pressure: delete oldest first when exceeding max_storage_gb (default 50)
- Scheduling: compression + retention daily; disk usage check hourly
- Lifecycle actions logged via pino + summary accessible via health endpoint

### Claude's Discretion
- Exact ffmpeg encoding parameters (CRF, resolution, codec)
- node-cron schedule expressions and off-peak timing
- WebSocket reconnection/heartbeat implementation details
- Memory metrics collection method (adb shell dumpsys meminfo parsing)
- Artifacts table exact schema (columns, indexes)
- How replay buffer is sized (last N lines)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REAL-01 | WebSocket streams logs + steps in real time | @fastify/websocket v11.x + job event broadcasting pattern via MaestroParser callbacks |
| REAL-02 | Live preview via device-stream (Android scrcpy H.264) | @device-stream/android integration, base64 frame relay over WS |
| REAL-03 | Live preview via device-stream (iOS simulator) | @device-stream/ios-simulator integration, same base64 pattern |
| REAL-04 | Video recording (ffmpeg to MP4) saved as artifact | child_process.spawn ffmpeg with image2pipe input, ProcessTracker for ffmpeg PID |
| REAL-05 | Screenshot on step failure | Platform-native adb/simctl commands, MaestroParser onFlowResult callback |
| REAL-06 | ADB logcat as stream/artifact | adb logcat spawn, dual output (WS broadcast + file write) |
| REAL-07 | Memory metrics capture during execution | adb shell dumpsys meminfo -c parsing, periodic sampling |
| STOR-01 | Artifacts stored on filesystem with DB paths | Unified artifacts table, nested directory structure by job UUID |
| STOR-02 | Cron compresses videos after N days | node-cron + ffmpeg re-encode at lower CRF |
| STOR-03 | Cron deletes artifacts after retention_days | node-cron + fs.rm with DB cleanup |
| STOR-04 | Cron monitors disk usage, deletes oldest if over limit | node-cron hourly + du/df check |
| STOR-05 | Artifacts downloadable via API | GET list + GET download endpoints with Content-Disposition |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/websocket | ^11.2.0 | WebSocket support for Fastify | Official Fastify plugin, built on ws@8, supports Fastify 5, route-level WS handlers |
| @device-stream/android | internal | Android live preview (scrcpy H.264) | Existing internal library per PROJECT.md -- do not rebuild |
| @device-stream/ios-simulator | internal | iOS simulator live preview | Existing internal library per PROJECT.md -- do not rebuild |
| node-cron | ^3.x | In-process task scheduling | Pure JS, no external deps, crontab syntax, lightweight |
| ffmpeg | system binary | Video recording + compression | System dependency, spawned via child_process.spawn |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/ws | latest (dev) | TypeScript types for ws | Required for @fastify/websocket TypeScript support |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct ffmpeg spawn | fluent-ffmpeg | fluent-ffmpeg archived May 2025 -- DO NOT USE |
| node-cron | croner | croner is newer/lighter but node-cron is locked decision |
| Single WS per job | Separate WS per event type | More connections to manage, user decided single connection |

**Installation:**
```bash
npm install @fastify/websocket node-cron
npm install -D @types/ws @types/node-cron
```

## Architecture Patterns

### Recommended Project Structure
```
server/
├── streaming/
│   ├── websocket-plugin.ts       # Registers @fastify/websocket, defines WS routes
│   ├── job-broadcaster.ts        # EventEmitter that buffers + broadcasts job events
│   ├── device-preview.ts         # Manages device-stream instances, relays frames to WS
│   └── types.ts                  # WS message types
├── artifacts/
│   ├── artifact-plugin.ts        # Fastify plugin for artifact routes
│   ├── artifact-service.ts       # CRUD for artifacts table, file management
│   ├── recording-service.ts      # Start/stop ffmpeg recording per job
│   ├── screenshot-service.ts     # Platform-native screenshot capture
│   ├── logcat-service.ts         # ADB logcat spawn + file write
│   └── memory-service.ts         # Memory metrics collection
├── lifecycle/
│   ├── lifecycle-plugin.ts       # Registers node-cron schedules
│   ├── compression-task.ts       # Find + re-encode old videos
│   ├── retention-task.ts         # Delete expired artifacts
│   └── disk-pressure-task.ts     # Monitor disk, delete oldest if over limit
└── db/
    └── schema.ts                 # Add artifacts table (replaces recordings)
```

### Pattern 1: Job Event Broadcasting (EventEmitter + Ring Buffer)

**What:** Central broadcaster that collects job events and fans them out to connected WebSocket clients with late-join replay.

**When to use:** For REAL-01 (logs, steps, metrics streaming) and late-join replay.

**Example:**
```typescript
// Source: Project pattern (EventEmitter + async-mutex from existing codebase)
import { EventEmitter } from 'node:events';

interface JobMessage {
  type: 'log' | 'step' | 'metrics' | 'status' | 'logcat';
  data: unknown;
  timestamp: string;
}

class JobBroadcaster {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<string, JobMessage[]>();
  private readonly MAX_BUFFER = 200; // Last N messages for replay

  emit(jobId: string, message: JobMessage): void {
    let buffer = this.buffers.get(jobId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(jobId, buffer);
    }
    buffer.push(message);
    if (buffer.length > this.MAX_BUFFER) buffer.shift();
    this.emitter.emit(`job:${jobId}`, message);
  }

  subscribe(jobId: string, handler: (msg: JobMessage) => void): () => void {
    // Replay buffered history first
    const buffer = this.buffers.get(jobId) ?? [];
    for (const msg of buffer) handler(msg);
    // Then subscribe to live events
    this.emitter.on(`job:${jobId}`, handler);
    return () => this.emitter.off(`job:${jobId}`, handler);
  }

  cleanup(jobId: string): void {
    this.buffers.delete(jobId);
    this.emitter.removeAllListeners(`job:${jobId}`);
  }
}
```

### Pattern 2: Recording Service (ffmpeg pipe from device-stream)

**What:** Spawns ffmpeg to encode frames from device-stream into MP4. Same stream feeds both live preview and recording.

**When to use:** For REAL-04 (video recording).

**Example:**
```typescript
// Source: ffmpeg pipe pattern (verified via official ffmpeg docs + community examples)
import { spawn, type ChildProcess } from 'node:child_process';

class RecordingService {
  private processes = new Map<string, ChildProcess>();

  startRecording(jobId: string, outputPath: string): WritableStream {
    const ffmpeg = spawn('ffmpeg', [
      '-y',                           // Overwrite output
      '-f', 'image2pipe',             // Input format: piped images
      '-framerate', '10',             // Input framerate
      '-i', 'pipe:0',                 // Read from stdin
      '-c:v', 'libx264',             // H.264 codec
      '-preset', 'ultrafast',         // Fast encoding for real-time
      '-crf', '28',                   // Quality (lower = better, 28 is reasonable)
      '-pix_fmt', 'yuv420p',         // Pixel format for compatibility
      '-movflags', '+faststart',      // Enable streaming playback
      outputPath,
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    this.processes.set(jobId, ffmpeg);
    return ffmpeg.stdin!;  // Write frames here
  }

  async stopRecording(jobId: string): Promise<void> {
    const ffmpeg = this.processes.get(jobId);
    if (!ffmpeg) return;
    ffmpeg.stdin?.end();  // Signal EOF, ffmpeg finalizes MP4
    await new Promise<void>((resolve) => ffmpeg.on('exit', () => resolve()));
    this.processes.delete(jobId);
  }
}
```

### Pattern 3: WebSocket Route with Fastify Plugin

**What:** Register WebSocket routes using @fastify/websocket within Fastify plugin encapsulation.

**When to use:** For all WS endpoints.

**Example:**
```typescript
// Source: @fastify/websocket official README
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(websocket);

  // Job events WebSocket
  fastify.get('/ws/jobs/:id', { websocket: true }, (socket, req) => {
    const jobId = (req.params as { id: string }).id;
    // Attach handlers synchronously (per @fastify/websocket docs)
    const unsub = fastify.jobBroadcaster.subscribe(jobId, (msg) => {
      if (socket.readyState === 1) { // OPEN
        socket.send(JSON.stringify(msg));
      }
    });
    socket.on('close', () => unsub());
  });

  // Device preview WebSocket
  fastify.get('/ws/devices/:id/preview', { websocket: true }, (socket, req) => {
    const deviceId = (req.params as { id: string }).id;
    // Start or join device stream, relay base64 frames
    const unsub = fastify.devicePreview.subscribe(deviceId, (frame) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: 'frame',
          data: frame.toString('base64'),
          timestamp: new Date().toISOString(),
        }));
      }
    });
    socket.on('close', () => unsub());
  });
});
```

### Pattern 4: Lifecycle Task (node-cron)

**What:** Schedule periodic tasks for compression, retention, and disk monitoring.

**Example:**
```typescript
// Source: node-cron npm docs
import cron from 'node-cron';

// Daily at 3 AM: compress old videos + delete expired artifacts
cron.schedule('0 3 * * *', async () => {
  await compressOldVideos();
  await deleteExpiredArtifacts();
});

// Hourly: check disk usage
cron.schedule('0 * * * *', async () => {
  await checkDiskPressure();
});
```

### Anti-Patterns to Avoid
- **Attaching WS handlers asynchronously:** @fastify/websocket docs explicitly warn against this -- messages can be dropped during async setup. Attach `socket.on('message')` synchronously.
- **Using fluent-ffmpeg:** Archived/deprecated as of May 2025. Use direct `child_process.spawn`.
- **Separate WS connections per event type:** User decision locks single connection per job with `type` field discrimination.
- **Storing artifacts in DB blob columns:** User decision is filesystem storage with DB path references.
- **Global cron without logging:** All lifecycle actions must be logged via pino and surfaced in health endpoint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket server | Raw ws setup | @fastify/websocket | Handles upgrade, plugin encapsulation, hooks, error handling |
| Video encoding | Custom frame-to-video pipeline | ffmpeg via child_process.spawn | Edge cases in codec negotiation, container format, timing |
| Device screen capture | Custom scrcpy client | @device-stream/* (internal lib) | Already built, handles protocol negotiation, platform differences |
| Cron scheduling | setTimeout/setInterval chains | node-cron | Crontab syntax, missed job handling, timezone support |
| Screenshot capture | Custom framebuffer reading | adb screencap / xcrun simctl io | Platform-native, reliable, zero dependencies |

**Key insight:** The device-stream library is the critical integration point -- it already handles the complex scrcpy protocol for Android and ScreenCaptureKit for iOS. The recording pipeline reuses the same stream, just tees it to ffmpeg stdin.

## Common Pitfalls

### Pitfall 1: ffmpeg Zombie Processes
**What goes wrong:** ffmpeg child process is spawned for recording but not properly killed when job is cancelled or times out. Orphan ffmpeg processes consume CPU/memory.
**Why it happens:** Only Maestro process gets killed via AbortSignal, ffmpeg is forgotten.
**How to avoid:** Register ffmpeg PIDs in ProcessTracker (existing pattern). Kill ffmpeg on job abort/timeout. Use process groups (`detached: true` + `process.kill(-pid)`).
**Warning signs:** `ps aux | grep ffmpeg` shows processes without parent jobs.

### Pitfall 2: WebSocket Memory Leaks from Abandoned Connections
**What goes wrong:** Clients disconnect without proper close, EventEmitter listeners accumulate.
**Why it happens:** No heartbeat/ping mechanism, no cleanup on socket error.
**How to avoid:** Implement ws ping/pong heartbeat (ws library supports this natively). Clean up subscriptions in both `close` and `error` handlers. Set `maxListeners` on EventEmitter.
**Warning signs:** Node.js MaxListenersExceededWarning, growing memory usage.

### Pitfall 3: Race Between Recording Stop and File Access
**What goes wrong:** Job finishes, artifact record created in DB, but ffmpeg hasn't finalized the MP4 moov atom yet. Download returns corrupt file.
**Why it happens:** ffmpeg needs to write the moov atom (file index) when stdin closes. This is async.
**How to avoid:** `await` the ffmpeg process exit before creating the artifact DB record. Use `+faststart` movflag so moov is at file beginning.
**Warning signs:** Downloaded MP4 files that won't play, zero-length moov atom.

### Pitfall 4: Base64 Frame Bandwidth on Preview WebSocket
**What goes wrong:** Sending full-resolution screenshots as base64 every 100ms overwhelms network and clients.
**Why it happens:** Base64 encoding adds ~33% overhead on top of raw frame size.
**How to avoid:** Limit preview resolution (scale down before base64 encoding). Throttle frame rate (5-10 fps is plenty for preview). Consider JPEG compression before base64 (smaller than PNG).
**Warning signs:** WebSocket backpressure, client lag, network saturation.

### Pitfall 5: Logcat Flood
**What goes wrong:** ADB logcat output is extremely verbose (thousands of lines/second). Broadcasting every line via WebSocket overwhelms clients and fills artifact files.
**Why it happens:** logcat captures ALL system logs by default.
**How to avoid:** Filter logcat by package/tag: `adb logcat -s <tag>:V`. Or use `--pid` flag to filter by app PID. Buffer and batch WS messages (e.g., every 200ms).
**Warning signs:** Large logcat.txt files (hundreds of MB), WS send queue growing.

### Pitfall 6: Disk Usage Calculation Performance
**What goes wrong:** Walking entire artifact directory tree to calculate size is slow with thousands of jobs.
**Why it happens:** Using `du -sh` on a large directory blocks for seconds.
**How to avoid:** Track file sizes in the artifacts DB table. Sum from DB instead of filesystem. Only do full filesystem scan as fallback/validation.
**Warning signs:** Hourly disk check blocking the event loop for seconds.

### Pitfall 7: node-cron Overlapping Runs
**What goes wrong:** node-cron fires a new task while the previous run is still in progress, causing double disk I/O or race conditions.
**Why it happens:** node-cron does not prevent overlapping executions by default.
**How to avoid:** Use a running flag or mutex (async-mutex already in project) to prevent concurrent lifecycle runs.
**Warning signs:** Two compression tasks running simultaneously, double disk I/O.

## Code Examples

### Unified Artifacts Table Schema (Drizzle)
```typescript
// Replaces the existing recordings table
import { index } from 'drizzle-orm/pg-core';

export const artifactTypeEnum = pgEnum('artifact_type', [
  'video',
  'screenshot',
  'logcat',
  'memory',
  'log',
]);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  type: artifactTypeEnum('type').notNull(),
  filePath: varchar('file_path', { length: 1024 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  compressed: boolean('compressed').notNull().default(false),
  compressedAt: timestamp('compressed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobIdIdx: index('artifacts_job_id_idx').on(table.jobId),
  createdAtIdx: index('artifacts_created_at_idx').on(table.createdAt),
  typeIdx: index('artifacts_type_idx').on(table.type),
}));
```

### ADB Logcat Streaming
```typescript
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

function startLogcat(
  deviceId: string,
  outputPath: string,
  onLine: (line: string) => void,
) {
  const logcat = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const fileStream = createWriteStream(outputPath);
  const rl = createInterface({ input: logcat.stdout! });

  rl.on('line', (line) => {
    fileStream.write(line + '\n');
    onLine(line); // Broadcast via WebSocket
  });

  return {
    stop: () => {
      logcat.kill('SIGTERM');
      fileStream.end();
    },
    pid: logcat.pid,
  };
}
```

### Memory Metrics via dumpsys meminfo
```typescript
// adb shell dumpsys meminfo -c outputs compact machine-readable format
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);

interface MemoryMetrics {
  totalPss: number;    // KB
  nativeHeap: number;  // KB
  javaHeap: number;    // KB
  timestamp: string;
}

async function captureMemoryMetrics(
  deviceId: string,
  packageName?: string,
): Promise<MemoryMetrics> {
  const args = ['-s', deviceId, 'shell', 'dumpsys', 'meminfo'];
  if (packageName) args.push(packageName);
  args.push('-c'); // Compact/machine-readable format

  const { stdout } = await execFile('adb', args);
  const lines = stdout.split('\n');
  let totalPss = 0, nativeHeap = 0, javaHeap = 0;

  for (const line of lines) {
    const parts = line.split(',');
    if (parts[0] === 'proc' && parts[1] === 'total') {
      totalPss = parseInt(parts[2] ?? '0', 10);
    }
    if (line.includes('Native Heap')) nativeHeap = parseInt(parts[1] ?? '0', 10);
    if (line.includes('Dalvik Heap')) javaHeap = parseInt(parts[1] ?? '0', 10);
  }

  return { totalPss, nativeHeap, javaHeap, timestamp: new Date().toISOString() };
}
```

### Screenshot Capture (Platform-Native)
```typescript
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';

const execFile = promisify(nodeExecFile);

async function captureScreenshot(
  platform: 'android' | 'ios',
  deviceId: string,
  outputPath: string,
): Promise<void> {
  if (platform === 'android') {
    // adb exec-out outputs binary to stdout (no pty corruption)
    const { stdout } = await execFile(
      'adb',
      ['-s', deviceId, 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer' as any, maxBuffer: 10 * 1024 * 1024 },
    );
    await writeFile(outputPath, stdout);
  } else {
    // xcrun simctl io for iOS simulator
    await execFile('xcrun', ['simctl', 'io', deviceId, 'screenshot', '--type=png', outputPath]);
  }
}
```

### Compression Task (ffmpeg re-encode)
```typescript
import { spawn } from 'node:child_process';

async function compressVideo(inputPath: string, outputPath: string): Promise<void> {
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'slow',       // Better compression than ultrafast
    '-crf', '35',             // Higher CRF = smaller file (quality trade-off)
    '-vf', 'scale=-2:720',   // Scale down to 720p max
    '-an',                    // No audio (emulator recording)
    outputPath,
  ]);

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    ffmpeg.on('error', reject);
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fluent-ffmpeg wrapper | Direct child_process.spawn for ffmpeg | May 2025 (archived) | No wrapper dependency, direct control over args |
| @fastify/websocket v10 | @fastify/websocket v11 | 2024 | Fastify 5 compatibility |
| Custom scrcpy clients | @yume-chan/scrcpy (or internal @device-stream) | 2024-2025 | TypeScript-native scrcpy implementation |
| External crontab | node-cron in-process | Ongoing | No system-level cron dependency |

**Deprecated/outdated:**
- fluent-ffmpeg: Archived May 2025. Use child_process.spawn directly.
- @fastify/websocket v10 and below: Not compatible with Fastify 5.

## Open Questions

1. **@device-stream API surface**
   - What we know: Internal library at github.com/HeiCg/device-stream with packages for android and ios-simulator. Uses scrcpy for Android, ScreenCaptureKit for iOS.
   - What's unclear: Exact API for starting/stopping streams, frame format (raw buffer? JPEG? PNG?), how to tee the stream for both preview and recording.
   - Recommendation: Implementer must review the device-stream source code before coding. The frame format determines ffmpeg input format (`image2pipe` for images, `rawvideo` for raw pixels, or `h264` for encoded video).

2. **H.264 vs JPEG frames for preview**
   - What we know: CONTEXT.md says "base64 JSON frames" on preview endpoint. Android device-stream uses scrcpy H.264.
   - What's unclear: Whether frames arrive as H.264 NALUs (need decoding before base64) or as decoded JPEG/PNG.
   - Recommendation: If H.264, the preview WS should send raw H.264 chunks for client-side decoding (more efficient). If decoded frames, JPEG compression before base64 is best.

3. **Memory metrics package name for dumpsys**
   - What we know: `adb shell dumpsys meminfo <package>` needs the app package name. Maestro flows test a specific app.
   - What's unclear: How to determine the app package name from Maestro flow files.
   - Recommendation: Make package name optional in metrics collection. If not available, capture overall device memory instead.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REAL-01 | WS streams logs + steps in real time | unit | `npx vitest run server/streaming/__tests__/job-broadcaster.test.ts` | No -- Wave 0 |
| REAL-02 | Live preview Android via device-stream | unit | `npx vitest run server/streaming/__tests__/device-preview.test.ts` | No -- Wave 0 |
| REAL-03 | Live preview iOS via device-stream | unit | Same as REAL-02 (platform parameterized) | No -- Wave 0 |
| REAL-04 | Video recording (ffmpeg to MP4) | unit | `npx vitest run server/artifacts/__tests__/recording-service.test.ts` | No -- Wave 0 |
| REAL-05 | Screenshot on step failure | unit | `npx vitest run server/artifacts/__tests__/screenshot-service.test.ts` | No -- Wave 0 |
| REAL-06 | ADB logcat stream/artifact | unit | `npx vitest run server/artifacts/__tests__/logcat-service.test.ts` | No -- Wave 0 |
| REAL-07 | Memory metrics capture | unit | `npx vitest run server/artifacts/__tests__/memory-service.test.ts` | No -- Wave 0 |
| STOR-01 | Artifacts stored on FS with DB paths | unit | `npx vitest run server/artifacts/__tests__/artifact-service.test.ts` | No -- Wave 0 |
| STOR-02 | Cron compresses old videos | unit | `npx vitest run server/lifecycle/__tests__/compression-task.test.ts` | No -- Wave 0 |
| STOR-03 | Cron deletes after retention | unit | `npx vitest run server/lifecycle/__tests__/retention-task.test.ts` | No -- Wave 0 |
| STOR-04 | Disk pressure monitor | unit | `npx vitest run server/lifecycle/__tests__/disk-pressure-task.test.ts` | No -- Wave 0 |
| STOR-05 | Artifacts downloadable via API | unit | `npx vitest run server/api/__tests__/artifact-routes.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/streaming/__tests__/job-broadcaster.test.ts` -- covers REAL-01 (event broadcasting + replay buffer)
- [ ] `server/streaming/__tests__/device-preview.test.ts` -- covers REAL-02, REAL-03 (mock device-stream)
- [ ] `server/artifacts/__tests__/recording-service.test.ts` -- covers REAL-04 (mock ffmpeg spawn)
- [ ] `server/artifacts/__tests__/screenshot-service.test.ts` -- covers REAL-05 (mock adb/simctl)
- [ ] `server/artifacts/__tests__/logcat-service.test.ts` -- covers REAL-06 (mock adb logcat)
- [ ] `server/artifacts/__tests__/memory-service.test.ts` -- covers REAL-07 (mock dumpsys)
- [ ] `server/artifacts/__tests__/artifact-service.test.ts` -- covers STOR-01 (DB + filesystem ops)
- [ ] `server/lifecycle/__tests__/compression-task.test.ts` -- covers STOR-02
- [ ] `server/lifecycle/__tests__/retention-task.test.ts` -- covers STOR-03
- [ ] `server/lifecycle/__tests__/disk-pressure-task.test.ts` -- covers STOR-04
- [ ] `server/api/__tests__/artifact-routes.test.ts` -- covers STOR-05

## Sources

### Primary (HIGH confidence)
- @fastify/websocket GitHub README -- API patterns, handler signature, Fastify 5 compatibility (v11.x)
- @fastify/websocket releases page -- v11.0.1+ supports Fastify 5
- Existing codebase (server/jobs/job-service.ts, server/jobs/maestro-parser.ts) -- integration points
- PROJECT.md -- @device-stream/* as existing internal dependency
- CONTEXT.md -- All locked decisions

### Secondary (MEDIUM confidence)
- ffmpeg piping patterns -- spawn + stdin pipe for encoding (multiple community sources)
- ffmpeg movflags documentation (ffmpeg.org) -- +faststart for streaming playback
- adb dumpsys meminfo (developer.android.com) -- -c flag for compact/machine-readable output
- node-cron npm -- Schedule API, crontab syntax
- fluent-ffmpeg archived (github.com/fluent-ffmpeg/node-fluent-ffmpeg) -- Confirmed deprecated May 2025

### Tertiary (LOW confidence)
- @device-stream/* internal API -- not publicly documented, needs source code review before implementation
- Memory metrics parsing format -- dumpsys output varies by Android version, needs runtime validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- @fastify/websocket verified for Fastify 5, node-cron well-established, ffmpeg universal
- Architecture: MEDIUM-HIGH -- Patterns follow existing codebase conventions (Fastify plugins, pino child loggers, async-mutex). device-stream integration details are LOW due to undocumented internal API.
- Pitfalls: HIGH -- Well-documented issues with ffmpeg zombies, WS memory leaks, logcat flooding

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, 30 days)
