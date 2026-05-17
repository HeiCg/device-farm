# Phase 5: Web Dashboard - Research

**Researched:** 2026-03-10
**Domain:** SvelteKit SPA, real-time WebSocket UI, video playback, Fastify static serving
**Confidence:** HIGH

## Summary

Phase 5 builds a web dashboard as a SvelteKit single-page application (SPA) that communicates with the existing Fastify API (REST + WebSocket). The project constraints explicitly specify SvelteKit as the frontend stack. The server already exposes all necessary endpoints: REST API at `/api/*` for jobs, devices, health, and artifacts; WebSocket at `/ws/jobs/:id` for real-time job streaming; and `/ws/devices/:id/preview` for live device screen frames.

The recommended architecture is **SvelteKit in SPA mode using `@sveltejs/adapter-static`**, built to static files, and served by Fastify via `@fastify/static`. This avoids running a second Node server, keeps deployment simple (single process), and aligns with the existing Fastify-centric architecture. All data fetching happens client-side via `fetch()` to the same origin's `/api/*` routes -- no CORS configuration needed.

**Primary recommendation:** Build SvelteKit as a static SPA with Svelte 5 runes, Tailwind CSS v4 for styling, serve from Fastify via `@fastify/static`, and use native browser WebSocket API for real-time features. Use native HTML5 `<video>` element for MP4 playback (no library needed since recordings are MP4, not HLS).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Dashboard com jobs recentes e status do pool de devices | GET /api/health (pool + queue), GET /api/jobs (recent jobs with limit) |
| UI-02 | Lista de jobs com filtros por status, plataforma, metadata e paginacao | GET /api/jobs with cursor pagination, status/platform/meta.* query params |
| UI-03 | Detalhe do job: live preview + logs + steps lado a lado (split view) | GET /api/jobs/:id (steps inline), WS /ws/jobs/:id (live logs/steps), WS /ws/devices/:id/preview (live frames) |
| UI-04 | Player do video gravado apos job concluido | GET /api/jobs/:id/artifacts (list), GET /api/jobs/:id/artifacts/:aid (download MP4), native `<video>` element |
| UI-05 | Grid de devices com status ao vivo (idle, running, error, etc) | GET /api/devices (all devices + state), periodic polling or WS for live updates |
| UI-06 | Pagina de settings mostrando config atual do servidor | GET /api/health (exposes config-adjacent data), may need new GET /api/config endpoint |
| UI-07 | Exibicao de metricas de memoria e adb logcat na tela do job | WS /ws/jobs/:id streams 'metrics' and 'logcat' message types alongside 'log' and 'step' |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| svelte | ^5.53 | UI framework with runes reactivity | Project constraint (PROJECT.md), current stable |
| @sveltejs/kit | ^2.51 | App framework, routing, build tooling | Standard SvelteKit for Svelte 5 |
| @sveltejs/adapter-static | ^3.x | Build SPA to static files | SPA mode -- no SSR server needed |
| @tailwindcss/vite | ^4.x | Utility-first CSS via Vite plugin | Standard styling for SvelteKit, zero-config with v4 |
| tailwindcss | ^4.x | CSS framework | Modern utility-first approach, v4 uses CSS-native config |
| @fastify/static | ^8.x | Serve SPA files from Fastify | Keeps single-process deployment |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-svelte | ^0.460+ | Icon library | Status indicators, navigation icons |
| clsx | ^2.x | Conditional CSS class joining | Dynamic class composition in components |
| date-fns | ^4.x | Date formatting/relative time | Job timestamps, durations display |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind CSS | Plain CSS / CSS modules | Tailwind is faster for dashboards, consistent with utility approach |
| Native WebSocket | socket.io-client | Overkill -- server uses raw WS via @fastify/websocket, no socket.io server |
| Native `<video>` | video.js | MP4 files play natively -- video.js adds 100KB+ for no benefit |
| adapter-static | adapter-node | adapter-node runs a second server -- unnecessary since Fastify handles API |

**Installation (in `web/` subdirectory):**
```bash
npx sv create web --template minimal --types ts
cd web
npm install -D @sveltejs/adapter-static @tailwindcss/vite tailwindcss lucide-svelte clsx date-fns
```

## Architecture Patterns

### Recommended Project Structure
```
web/                          # SvelteKit SPA (separate package.json)
├── package.json
├── svelte.config.js          # adapter-static, SPA fallback
├── vite.config.ts            # tailwindcss vite plugin, API proxy for dev
├── src/
│   ├── app.css               # @import "tailwindcss"
│   ├── app.html              # Shell template
│   ├── lib/
│   │   ├── api/              # API client functions (typed fetch wrappers)
│   │   │   ├── client.ts     # Base fetch with error handling
│   │   │   ├── jobs.ts       # Job CRUD + pagination
│   │   │   ├── devices.ts    # Device list
│   │   │   └── health.ts     # Health/config endpoint
│   │   ├── ws/               # WebSocket connection managers
│   │   │   ├── job-stream.ts # Connect to /ws/jobs/:id, parse messages
│   │   │   └── device-preview.ts # Connect to /ws/devices/:id/preview
│   │   ├── stores/           # Svelte 5 rune-based shared state
│   │   │   └── connection.svelte.ts # Connection status tracking
│   │   ├── components/       # Reusable UI components
│   │   │   ├── layout/       # Shell, nav, sidebar
│   │   │   ├── jobs/         # JobCard, JobTable, StepList, LogViewer
│   │   │   ├── devices/      # DeviceCard, DeviceGrid, StatusBadge
│   │   │   └── shared/       # Pagination, Filters, StatusIndicator
│   │   └── utils/            # Formatters, constants
│   └── routes/
│       ├── +layout.svelte    # App shell with navigation
│       ├── +layout.ts        # export const ssr = false (SPA mode)
│       ├── +page.svelte      # Dashboard (UI-01)
│       ├── jobs/
│       │   ├── +page.svelte  # Job list with filters (UI-02)
│       │   └── [id]/
│       │       └── +page.svelte  # Job detail split view (UI-03, UI-04, UI-07)
│       ├── devices/
│       │   └── +page.svelte  # Device grid (UI-05)
│       └── settings/
│           └── +page.svelte  # Server config (UI-06)
├── static/                   # Static assets (favicon, etc.)
└── build/                    # Output (served by Fastify)
```

### Pattern 1: SPA Mode Configuration
**What:** Disable SSR globally so all pages render client-side only
**When to use:** Always -- this is a dashboard SPA, not a content site
**Example:**
```typescript
// web/src/routes/+layout.ts
export const ssr = false;
export const prerender = false;
```

```javascript
// web/svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',  // SPA fallback for client-side routing
    }),
    paths: {
      base: '',  // Served from root
    },
  },
};
```

### Pattern 2: Fastify Static Serving + SPA Fallback
**What:** Serve built SPA files from Fastify, with fallback to index.html for client-side routes
**When to use:** Production serving
**Example:**
```typescript
// server/api/plugin.ts (updated)
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve SPA static files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webBuildPath = path.resolve(__dirname, '../../web/build');

await fastify.register(fastifyStatic, {
  root: webBuildPath,
  prefix: '/',
  decorateReply: false,  // Avoid conflict if registered elsewhere
  wildcard: false,        // Don't match API/WS routes
});

// SPA fallback: serve index.html for unmatched non-API routes
fastify.setNotFoundHandler(async (request, reply) => {
  // Only serve fallback for non-API, non-WS GET requests
  if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/ws/')) {
    return reply.sendFile('index.html');
  }
  return reply.code(404).send({ error: 'Not Found' });
});
```

### Pattern 3: Typed API Client with Fetch
**What:** Thin typed wrappers around fetch() that return structured data
**When to use:** All API calls from the SPA
**Example:**
```typescript
// web/src/lib/api/client.ts
const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public type: string,
  ) {
    super(detail);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText, body.type ?? 'UNKNOWN');
  }
  return res.json();
}
```

### Pattern 4: WebSocket with Svelte 5 Runes
**What:** Reactive WebSocket connection that pushes messages into rune-based state
**When to use:** Job detail page (live logs, steps, status), device preview
**Example:**
```typescript
// web/src/lib/ws/job-stream.ts
import type { JobMessage } from './types.js';

export function createJobStream(jobId: string) {
  let messages = $state<JobMessage[]>([]);
  let connected = $state(false);
  let ws: WebSocket | null = null;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/jobs/${jobId}`);

    ws.onopen = () => { connected = true; };
    ws.onclose = () => { connected = false; };
    ws.onmessage = (event) => {
      const msg: JobMessage = JSON.parse(event.data);
      messages = [...messages, msg];
    };
  }

  function disconnect() {
    ws?.close();
    ws = null;
  }

  return {
    get messages() { return messages; },
    get connected() { return connected; },
    connect,
    disconnect,
  };
}
```

### Pattern 5: Vite Dev Proxy for API
**What:** During development, proxy /api and /ws to the running Fastify server
**When to use:** Local development only
**Example:**
```typescript
// web/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
```

### Anti-Patterns to Avoid
- **SSR for dashboard:** No benefit -- all data is API-driven, adds complexity, requires Node server
- **Polling instead of WebSocket:** Server already has WS infrastructure -- use it for real-time data
- **Global state stores for everything:** Use component-level `$state` for page-specific data, only use shared stores for cross-cutting concerns (auth token, connection status)
- **Fetching in +page.server.ts:** SPA mode has no server -- use `onMount` or `{#await}` blocks for data loading
- **Re-implementing cursor pagination:** The API already returns `{ data, nextCursor, hasMore }` -- just pass nextCursor back

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS utility classes | Custom CSS framework | Tailwind CSS v4 | Consistent, responsive, dark mode built-in |
| Video player controls | Custom player UI | Native `<video>` element | MP4 plays everywhere, browser provides controls |
| WebSocket reconnection | Custom retry logic | Simple reconnect wrapper (3-5 lines) | Don't need socket.io, just exponential backoff on close |
| Icons | SVG sprites / custom icons | lucide-svelte | Tree-shakeable, consistent, 1000+ icons |
| Date formatting | Manual date math | date-fns `formatDistanceToNow`, `format` | Handles locales, relative times, edge cases |
| Pagination state | Custom pagination machine | Derive from API response `nextCursor`/`hasMore` | API already handles cursor logic |
| Base64 frame rendering | Canvas manipulation | `<img src="data:image/jpeg;base64,{frame}">` | Browser handles it natively, simpler than canvas |

**Key insight:** The server API is already well-designed with cursor pagination, structured WebSocket messages, and artifact download endpoints. The dashboard should be a thin rendering layer, not a data management system.

## Common Pitfalls

### Pitfall 1: WebSocket Memory Leak on Navigation
**What goes wrong:** WebSocket connections left open when navigating away from job detail page
**Why it happens:** SvelteKit SPA keeps components alive longer than expected; no cleanup on route change
**How to avoid:** Use `onMount` return cleanup or `onDestroy` to close WebSocket connections. In Svelte 5, use `$effect` with cleanup return.
**Warning signs:** Browser dev tools show multiple WS connections to same job

### Pitfall 2: Device Preview Frame Flooding
**What goes wrong:** Rendering base64 frames at 10fps causes jank, high memory usage
**Why it happens:** Each frame is ~100KB+ base64, creating new Image objects per frame
**How to avoid:** Use a single `<img>` element and update its `src` attribute; throttle rendering if browser falls behind. Consider using `requestAnimationFrame` for frame updates.
**Warning signs:** Page becomes unresponsive during live preview

### Pitfall 3: SPA Fallback Not Working
**What goes wrong:** Direct URL navigation to `/jobs/abc-123` returns 404
**Why it happens:** Fastify tries to find a static file, fails, returns 404 instead of serving index.html
**How to avoid:** Register `setNotFoundHandler` in Fastify that serves index.html for non-API GET requests
**Warning signs:** Refresh on any page other than root shows 404 or blank page

### Pitfall 4: Stale Data After Job Completion
**What goes wrong:** Job detail shows "running" after job has finished
**Why it happens:** WebSocket sends status:passed/failed but component state is not updated, or WS disconnects before final message
**How to avoid:** When WS sends a terminal status message (passed/failed/cancelled/timeout), refetch job details via REST to get final state including artifacts
**Warning signs:** Job shows "running" but no new log messages arrive

### Pitfall 5: Log Viewer Scroll Performance
**What goes wrong:** Log viewer with thousands of lines causes scroll jank
**Why it happens:** Rendering all log lines in DOM at once
**How to avoid:** Use CSS `overflow-y: auto` with `max-height` and keep a reasonable buffer (last 1000 lines in DOM, full log accessible via scroll-to-load or download)
**Warning signs:** Page slows down on long-running jobs with verbose output

### Pitfall 6: Build Output Path Mismatch
**What goes wrong:** Fastify cannot find SPA files
**Why it happens:** adapter-static outputs to `web/build/` but Fastify looks elsewhere
**How to avoid:** Use consistent path resolution in Fastify static plugin; add build step to npm scripts
**Warning signs:** Root URL shows 404 or Fastify default response

## Code Examples

### Job List Page with Cursor Pagination
```svelte
<!-- web/src/routes/jobs/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '$lib/api/client';

  let jobs = $state<any[]>([]);
  let nextCursor = $state<string | null>(null);
  let hasMore = $state(false);
  let loading = $state(false);
  let statusFilter = $state<string>('');
  let platformFilter = $state<string>('');

  async function loadJobs(cursor?: string) {
    loading = true;
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (statusFilter) params.set('status', statusFilter);
    if (platformFilter) params.set('platform', platformFilter);

    const res = await apiFetch<{ data: any[]; nextCursor: string | null; hasMore: boolean }>(
      `/jobs?${params}`
    );
    jobs = cursor ? [...jobs, ...res.data] : res.data;
    nextCursor = res.nextCursor;
    hasMore = res.hasMore;
    loading = false;
  }

  onMount(() => { loadJobs(); });
</script>
```

### Live Log Viewer with WebSocket
```svelte
<!-- web/src/lib/components/jobs/LogViewer.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let { jobId }: { jobId: string } = $props();
  let lines = $state<string[]>([]);
  let container: HTMLElement;

  onMount(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/jobs/${jobId}`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'log') {
        lines = [...lines, msg.data.line];
        // Auto-scroll to bottom
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight;
        });
      }
    };

    return () => ws.close();
  });
</script>

<div bind:this={container} class="h-96 overflow-y-auto bg-gray-900 text-green-400 font-mono text-sm p-4">
  {#each lines as line}
    <div class="whitespace-pre-wrap">{line}</div>
  {/each}
</div>
```

### Device Preview Frame Rendering
```svelte
<!-- web/src/lib/components/devices/DevicePreview.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  let { deviceId }: { deviceId: string } = $props();
  let frameSrc = $state<string>('');
  let connected = $state(false);

  onMount(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/devices/${deviceId}/preview`);

    ws.onopen = () => { connected = true; };
    ws.onclose = () => { connected = false; };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'frame') {
        frameSrc = `data:image/jpeg;base64,${msg.data}`;
      }
    };

    return () => ws.close();
  });
</script>

{#if frameSrc}
  <img src={frameSrc} alt="Device preview" class="w-full rounded-lg" />
{:else}
  <div class="w-full aspect-[9/16] bg-gray-800 rounded-lg flex items-center justify-center text-gray-400">
    {connected ? 'Waiting for frames...' : 'Connecting...'}
  </div>
{/if}
```

### Video Player for Recorded Jobs
```svelte
<script lang="ts">
  let { jobId, artifactId }: { jobId: string; artifactId: string } = $props();
</script>

<!-- Native HTML5 video -- MP4 plays in all modern browsers -->
<video
  controls
  preload="metadata"
  class="w-full rounded-lg"
  src="/api/jobs/{jobId}/artifacts/{artifactId}"
>
  <track kind="captions" />
</video>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 reactive stores ($:) | Svelte 5 runes ($state, $derived, $effect, $props) | Oct 2024 (Svelte 5.0) | Fine-grained reactivity, explicit signal model |
| tailwind.config.js | CSS @theme directive + Vite plugin | Jan 2025 (Tailwind v4) | No config file, CSS-native configuration |
| PostCSS for Tailwind | @tailwindcss/vite plugin | Jan 2025 (Tailwind v4) | Simpler build, no postcss dependency |
| SvelteKit 1.x routing | SvelteKit 2.x with Svelte 5 support | Dec 2023 / Oct 2024 | Modern routing, runes compatibility |

**Deprecated/outdated:**
- `$:` reactive declarations: Replaced by `$derived` rune in Svelte 5
- Svelte stores (writable/readable): Replaced by `$state` rune for most use cases
- `export let` props: Replaced by `$props()` rune
- tailwind.config.js: Replaced by CSS-based @theme in v4
- `lang="postcss"` in style tags: No longer needed with v4 Vite plugin

## API Surface Available to Dashboard

The existing server exposes everything the dashboard needs:

### REST Endpoints (all at /api prefix)
| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| /api/jobs | GET | List jobs, cursor pagination, filters | `{ data: Job[], nextCursor, hasMore }` |
| /api/jobs | POST | Create job (multipart) | Job |
| /api/jobs/:id | GET | Job detail with steps | `{ ...job, steps: Step[] }` |
| /api/jobs/:id | DELETE | Cancel job | `{ status: 'cancelled' }` |
| /api/jobs/:id/logs | GET | Raw Maestro output | `{ logs: string }` |
| /api/jobs/:id/artifacts | GET | List artifacts for job | Artifact[] |
| /api/jobs/:id/artifacts/:aid | GET | Download artifact file | Binary stream |
| /api/devices | GET | All devices with state | Device[] |
| /api/devices/:id/restart | POST | Restart device | `{ status: 'restarting' }` |
| /api/health | GET | Server health + pool + queue + lifecycle | HealthResponse |

### WebSocket Endpoints
| Endpoint | Message Types | Purpose |
|----------|--------------|---------|
| /ws/jobs/:id | log, step, metrics, status, logcat | Real-time job execution stream |
| /ws/devices/:id/preview | frame | Live device screen (base64 JPEG) |

### Note on UI-06 (Settings Page)
The /api/health endpoint returns pool status, queue depth, and lifecycle stats but does NOT expose the full server config (pool sizes, retention days, storage paths, etc.). A new lightweight endpoint (GET /api/config or extending /api/health) may be needed to expose read-only config for the settings page.

## Open Questions

1. **Settings Endpoint**
   - What we know: /api/health has pool + lifecycle stats but not full config
   - What's unclear: Whether to add GET /api/config or extend /api/health
   - Recommendation: Add GET /api/config returning sanitized config (exclude database_url)

2. **Device Status Polling vs WebSocket**
   - What we know: GET /api/devices returns current state; no WS endpoint for device status changes
   - What's unclear: Whether to add a WS endpoint for device events or poll
   - Recommendation: Poll every 5s on the devices page -- simpler, device state changes are infrequent

3. **Build Integration**
   - What we know: SPA builds to `web/build/`, Fastify needs to serve it
   - What's unclear: Whether to add `web:build` to root package.json or keep builds separate
   - Recommendation: Add `"web:build": "cd web && npm run build"` to root package.json, document build order

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x (already installed in root) + @testing-library/svelte |
| Config file | web/vitest.config.ts (new -- SvelteKit projects use separate config) |
| Quick run command | `cd web && npx vitest run` |
| Full suite command | `npm test` (root vitest for server) + `cd web && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Dashboard renders recent jobs + pool status | unit (component) | `cd web && npx vitest run src/lib/components/jobs/JobCard.test.ts` | No -- Wave 0 |
| UI-02 | Job list filters and pagination work | unit (API client) | `cd web && npx vitest run src/lib/api/jobs.test.ts` | No -- Wave 0 |
| UI-03 | Job detail split view renders logs + steps + preview | unit (component) | `cd web && npx vitest run src/routes/jobs/[id]/page.test.ts` | No -- Wave 0 |
| UI-04 | Video player loads artifact URL | unit (component) | `cd web && npx vitest run src/lib/components/jobs/VideoPlayer.test.ts` | No -- Wave 0 |
| UI-05 | Device grid renders all devices with status | unit (component) | `cd web && npx vitest run src/lib/components/devices/DeviceGrid.test.ts` | No -- Wave 0 |
| UI-06 | Settings page displays config | unit (component) | `cd web && npx vitest run src/routes/settings/page.test.ts` | No -- Wave 0 |
| UI-07 | Memory metrics and logcat visible on job page | unit (WS handler) | `cd web && npx vitest run src/lib/ws/job-stream.test.ts` | No -- Wave 0 |
| -- | Fastify serves SPA + fallback | integration | `npx vitest run server/api/__tests__/static-serving.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run`
- **Per wave merge:** `npm test && cd web && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `web/` SvelteKit project scaffold (package.json, svelte.config.js, vite.config.ts)
- [ ] `web/vitest.config.ts` -- test config for SvelteKit components
- [ ] `web/package.json` -- must include @testing-library/svelte, jsdom as dev deps
- [ ] `server/api/__tests__/static-serving.test.ts` -- verify Fastify serves SPA + fallback

## Sources

### Primary (HIGH confidence)
- Project codebase: server/api/routes.ts, server/streaming/websocket-plugin.ts, server/db/schema.ts -- existing API surface
- Project constraints: .planning/PROJECT.md -- "SvelteKit (frontend)" explicitly specified
- [SvelteKit SPA docs](https://svelte.dev/docs/kit/single-page-apps) -- SPA mode with adapter-static
- [SvelteKit adapter-static docs](https://svelte.dev/docs/kit/adapter-static) -- fallback page configuration
- [Tailwind CSS SvelteKit guide](https://tailwindcss.com/docs/guides/sveltekit) -- v4 Vite plugin setup

### Secondary (MEDIUM confidence)
- [SvelteKit releases](https://github.com/sveltejs/kit/releases) -- current version 2.51.0
- [Svelte releases](https://github.com/sveltejs/svelte/releases) -- current version 5.53.0
- [@fastify/static npm](https://www.npmjs.com/package/@fastify/static) -- static file serving
- [Svelte 5 runes for real-time data](https://dev.to/polliog/real-world-svelte-5-handling-high-frequency-real-time-data-with-runes-3i2f) -- runes patterns for high-frequency updates

### Tertiary (LOW confidence)
- [SvelteKit + Fastify discussion](https://github.com/sveltejs/kit/discussions/10981) -- community patterns, not officially documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Project constraint specifies SvelteKit, Tailwind is standard pairing, versions verified from release pages
- Architecture: HIGH - SPA + @fastify/static is well-documented pattern; API surface verified from codebase
- Pitfalls: MEDIUM - Based on common SPA + WebSocket patterns; some pitfalls are from general web dev experience
- API mapping: HIGH - Verified by reading actual route handlers and WebSocket plugin source

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (30 days -- stable ecosystem)
