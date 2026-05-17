# Phase 6: Authentication and Reporting - Research

**Researched:** 2026-03-10
**Domain:** API key authentication, webhook delivery, JUnit XML reporting, flaky test detection
**Confidence:** HIGH

## Summary

Phase 6 adds two orthogonal feature groups to the existing device farm: (1) API key authentication gating all API and Web UI access, and (2) reporting features including webhook notifications, JUnit XML generation, and flaky test detection. Both groups integrate into well-established patterns in the codebase.

The authentication model is simple: admin-managed API keys stored in PostgreSQL, validated via `@fastify/bearer-auth` on all API routes. The CLI already sends `Authorization: Bearer <key>` headers (CLI-07 complete), so the server just needs to validate them. The Web UI (SvelteKit SPA with `ssr: false`) needs a login gate that stores the API key in localStorage and injects it into all `apiFetch` calls.

Reporting features are self-contained: webhooks fire-and-forget on job completion with simple retry logic, JUnit XML is generated from existing `jobSteps` data, and flaky detection queries historical `jobSteps` results per flow name using a sliding window.

**Primary recommendation:** Use `@fastify/bearer-auth` v10 with `addHook: false` for selective route protection, hand-write JUnit XML (no library needed for this simple output), and implement webhook delivery as a fire-and-forget service with configurable retry.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | API keys gerenciadas pelo admin para CLI, CI e Web UI | DB table `api_keys`, CRUD endpoints under `/api/admin/keys`, key generation with `crypto.randomBytes` |
| AUTH-02 | Rotas da API protegidas -- requerem API key valida | `@fastify/bearer-auth` v10 with custom auth function querying DB, applied as onRequest hook |
| AUTH-03 | Web UI requer API key ou login basico para acesso | SvelteKit auth gate component, localStorage for key, injected into `apiFetch` headers |
| REPT-01 | Webhook POST para URL configurada quando job termina | WebhookService with fetch + retry, config schema extension for `webhooks.url` |
| REPT-02 | JUnit XML report gerado por job para integracao nativa com CI | Hand-built XML from `jobSteps` data, served via `GET /api/jobs/:id/report.xml` |
| REPT-03 | Historico de pass/fail por flow para deteccao de flaky tests | SQL query on `job_steps` grouped by `flow_name`, sliding window of last N runs |
| REPT-04 | UI exibe badge/indicador de flaky em flows com historico instavel | API endpoint `GET /api/flows/flaky`, Svelte badge component on job detail page |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @fastify/bearer-auth | ^10.x | Bearer token validation hook | Official Fastify plugin, v10 for Fastify 5 compatibility, constant-time comparison built-in |
| crypto (node:crypto) | built-in | API key generation | `randomBytes(32).toString('hex')` for cryptographically secure keys |
| node:crypto (scrypt) | built-in | API key hashing | Hash keys before storage, compare on validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | JUnit XML generation | Hand-write XML -- format is simple, no library needed |
| (none needed) | - | Webhook delivery | Native `fetch` with retry logic -- no external dependency needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @fastify/bearer-auth | Custom onRequest hook | bearer-auth provides constant-time comparison, proper 401 responses, and is battle-tested |
| Hand-written XML | junit-report-builder npm | Adds dependency for ~30 lines of string templating |
| Native fetch retry | got/axios with retry | Unnecessary dependency for a simple POST with 2-3 retries |

**Installation:**
```bash
npm install @fastify/bearer-auth
```

## Architecture Patterns

### Recommended Project Structure
```
server/
├── auth/
│   ├── __tests__/
│   │   ├── auth-plugin.test.ts
│   │   ├── auth-service.test.ts
│   │   └── key-routes.test.ts
│   ├── auth-plugin.ts          # Fastify plugin: bearer-auth + decorates authService
│   ├── auth-service.ts         # Key CRUD, validation, hashing
│   └── key-routes.ts           # Admin CRUD routes for API keys
├── reporting/
│   ├── __tests__/
│   │   ├── webhook-service.test.ts
│   │   ├── junit-generator.test.ts
│   │   └── flaky-detector.test.ts
│   ├── reporting-plugin.ts     # Fastify plugin: registers services + routes
│   ├── webhook-service.ts      # Fire-and-forget webhook delivery with retry
│   ├── junit-generator.ts      # JUnit XML string builder
│   ├── flaky-detector.ts       # Historical pass/fail analysis
│   └── report-routes.ts        # GET /jobs/:id/report.xml, GET /flows/flaky
web/
├── src/
│   ├── lib/
│   │   ├── auth/
│   │   │   └── auth-store.svelte.ts  # $state for API key, localStorage persistence
│   │   └── api/
│   │       └── client.ts             # Modified to inject Authorization header
│   └── routes/
│       └── login/
│           └── +page.svelte          # Login page (API key input)
```

### Pattern 1: Fastify Plugin with Bearer Auth (selective routes)
**What:** Register `@fastify/bearer-auth` with `addHook: false` to get the `verifyBearerAuth` decorator, then apply it selectively.
**When to use:** When some routes (like `/api/health`) should remain public.
**Example:**
```typescript
// Source: @fastify/bearer-auth README
import fp from 'fastify-plugin';
import bearerAuth from '@fastify/bearer-auth';
import { AuthService } from './auth-service.js';

export default fp(async (fastify) => {
  const authService = new AuthService(fastify.db, fastify.log);
  fastify.decorate('authService', authService);

  await fastify.register(bearerAuth, {
    addHook: false,
    auth: async (key: string) => {
      return authService.validateKey(key);
    },
    errorResponse: (err: Error) => ({
      type: 'https://device-farm.local/errors/UNAUTHORIZED',
      title: 'Unauthorized',
      status: 401,
      detail: err.message,
      instance: '',
    }),
    contentType: 'application/problem+json',
  });
}, { name: 'auth', dependencies: ['config', 'db'] });
```

### Pattern 2: API Key Hashing (store hash, not plaintext)
**What:** Hash API keys with scrypt before storing; on validation, hash the incoming key and compare.
**When to use:** Always -- never store plaintext API keys.
**Example:**
```typescript
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_PREFIX = 'df_';
const HASH_LEN = 64;

function generateKey(): { raw: string; hash: string; salt: string } {
  const raw = KEY_PREFIX + randomBytes(32).toString('hex');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(raw, salt, HASH_LEN).toString('hex');
  return { raw, hash, salt };
}

function verifyKey(raw: string, storedHash: string, salt: string): boolean {
  const hash = scryptSync(raw, salt, HASH_LEN);
  const expected = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(hash, expected);
}
```

### Pattern 3: Applying Auth to API Routes
**What:** Use Fastify's `addHook` on the API route group to enforce auth, while keeping health public.
**When to use:** Apply auth at the route plugin level, not globally.
**Example:**
```typescript
// In api/plugin.ts -- add preHandler to protected route groups
await fastify.register(async (protectedScope) => {
  protectedScope.addHook('onRequest', fastify.verifyBearerAuth);
  await protectedScope.register(jobRoutes);
  await protectedScope.register(deviceRoutes);
  await protectedScope.register(configRoute);
}, { prefix: '/api' });

// Health stays public
await fastify.register(healthRoute, { prefix: '/api' });
```

### Pattern 4: Webhook Fire-and-Forget with Retry
**What:** POST job result to configured URL when job finishes, retry on failure.
**When to use:** REPT-01 webhook delivery.
**Example:**
```typescript
class WebhookService {
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  async deliver(url: string, payload: object): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) return;
        if (resp.status >= 400 && resp.status < 500) return; // Don't retry client errors
      } catch { /* retry */ }
      if (attempt < this.maxRetries) {
        const delay = this.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * delay * 0.5;
        await new Promise(r => setTimeout(r, delay + jitter));
      }
    }
    // Log failure after all retries exhausted -- don't throw
  }
}
```

### Pattern 5: JUnit XML Generation
**What:** Build JUnit XML string from job steps data.
**When to use:** REPT-02 endpoint.
**Example:**
```typescript
function generateJUnitXML(job: JobRecord, steps: StepRecord[]): string {
  const passed = steps.filter(s => s.status === 'passed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const totalTime = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / 1000;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="Device Farm" tests="${steps.length}" failures="${failed}" errors="0" skipped="${skipped}" time="${totalTime.toFixed(3)}">\n`;
  xml += `  <testsuite name="${escapeXml(job.id)}" tests="${steps.length}" failures="${failed}" errors="0" skipped="${skipped}" time="${totalTime.toFixed(3)}">\n`;

  for (const step of steps) {
    const time = ((step.durationMs ?? 0) / 1000).toFixed(3);
    xml += `    <testcase name="${escapeXml(step.flowName ?? 'unknown')}" classname="maestro" time="${time}"`;
    if (step.status === 'passed') {
      xml += ` />\n`;
    } else if (step.status === 'failed') {
      xml += `>\n      <failure message="${escapeXml(step.error ?? 'Test failed')}" type="MaestroFailure" />\n    </testcase>\n`;
    } else if (step.status === 'skipped') {
      xml += `>\n      <skipped />\n    </testcase>\n`;
    }
  }
  xml += `  </testsuite>\n</testsuites>`;
  return xml;
}
```

### Pattern 6: Flaky Test Detection (Sliding Window)
**What:** Query last N runs of each flow, flag as flaky if pass rate is between thresholds.
**When to use:** REPT-03 and REPT-04.
**Example:**
```typescript
// A flow is flaky if it has BOTH passes AND failures in the last N runs
// Common threshold: pass rate between 20% and 80% = flaky
const WINDOW_SIZE = 10;
const FLAKY_MIN_RATE = 0.2; // At least 20% pass
const FLAKY_MAX_RATE = 0.8; // At most 80% pass

// SQL approach: group job_steps by flow_name, get last N results
// SELECT flow_name, status FROM job_steps
// WHERE flow_name IS NOT NULL
// ORDER BY started_at DESC
// Then compute per-flow pass rate in application code
```

### Anti-Patterns to Avoid
- **Storing API keys in plaintext:** Always hash with scrypt/argon2. The raw key is shown exactly once at creation time.
- **Global auth hook:** Don't apply auth to ALL routes. Health check must remain public for load balancers.
- **Synchronous webhook delivery:** Never block job completion on webhook delivery. Fire-and-forget with async retry.
- **Complex XML library for simple output:** JUnit XML is ~30 lines of string building. A library adds dependency for no benefit.
- **Flaky detection on every request:** Pre-compute flaky status on a schedule or cache with TTL, don't query history on every page load.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bearer token extraction & 401 response | Custom header parsing + timing-safe compare | @fastify/bearer-auth v10 | Handles edge cases: missing header, malformed header, timing-safe compare, proper 401 format |
| Constant-time string comparison | Simple `===` comparison | `timingSafeEqual` from node:crypto | Prevents timing attacks on API key validation |
| API key generation | `Math.random()` based strings | `crypto.randomBytes(32)` | Cryptographically secure randomness required for auth tokens |

**Key insight:** Authentication has critical security properties (timing attacks, key storage) where hand-rolled solutions introduce vulnerabilities. Use proven primitives.

## Common Pitfalls

### Pitfall 1: Plaintext API Key Storage
**What goes wrong:** Storing raw API keys in the database. If DB is compromised, all keys are exposed.
**Why it happens:** Seems simpler than hashing.
**How to avoid:** Hash keys with scrypt + salt. Show raw key only once at creation. Store hash + salt in DB.
**Warning signs:** A `keys` column without a corresponding `salt` column.

### Pitfall 2: Auth Breaking WebSocket Connections
**What goes wrong:** Bearer auth hook rejects WebSocket upgrade requests that don't have standard Authorization headers.
**Why it happens:** WebSocket browser API doesn't support custom headers.
**How to avoid:** For WebSocket routes, accept the API key as a query parameter (`?token=xxx`) and validate manually. Or keep WS routes in a separate scope without the bearer auth hook.
**Warning signs:** WS connections fail with 401 after auth is enabled.

### Pitfall 3: Webhook Retry Thundering Herd
**What goes wrong:** Multiple webhooks retry at identical intervals, overwhelming the target server.
**Why it happens:** Pure exponential backoff without jitter.
**How to avoid:** Add random jitter to each retry delay. Use `delay + Math.random() * delay * 0.5`.
**Warning signs:** Webhook target reports spike traffic after recovering from downtime.

### Pitfall 4: JUnit XML Special Character Escaping
**What goes wrong:** Flow names or error messages containing `<`, `>`, `&`, `"` break XML.
**Why it happens:** String concatenation without escaping.
**How to avoid:** Always escape XML special characters in all dynamic values.
**Warning signs:** CI tools fail to parse the JUnit XML report.

### Pitfall 5: Flaky Detection Performance
**What goes wrong:** Querying all historical job_steps for every flow on each request is slow.
**Why it happens:** No index on `flow_name`, no result caching.
**How to avoid:** Add index on `job_steps(flow_name, status)`. Cache flaky results with 5-minute TTL. Limit window to last N runs per flow.
**Warning signs:** `/api/flows/flaky` endpoint takes seconds to respond.

### Pitfall 6: Web UI Auth Redirect Loop
**What goes wrong:** SPA tries to fetch API data before checking auth, gets 401, redirects to login, which tries to verify key, gets 401...
**Why it happens:** No client-side auth check before API calls.
**How to avoid:** Check localStorage for key existence before any API call. On 401 response, clear stored key and redirect to login page. Login page itself makes no authenticated requests.
**Warning signs:** Browser shows rapid redirect loop or infinite loading.

## Code Examples

### DB Schema for API Keys
```typescript
// Source: project pattern from server/db/schema.ts
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  keySalt: varchar('key_salt', { length: 64 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(), // First 8 chars for identification
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
});
```

### Config Schema Extension
```typescript
// Add to config/schema.ts
const authSchema = z.object({
  enabled: z.boolean().default(false),
});

const webhooksSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().optional(), // HMAC signing secret
  timeout_ms: z.number().int().default(10000),
  max_retries: z.number().int().default(3),
});

// Add to configSchema
auth: authSchema.default(authSchema.parse({})),
webhooks: webhooksSchema.default(webhooksSchema.parse({})),
```

### Web UI Auth Store (Svelte 5 runes)
```typescript
// Source: project pattern from web/src/lib/ws/*.svelte.ts
// web/src/lib/auth/auth-store.svelte.ts
const AUTH_KEY = 'device-farm-api-key';

let apiKey = $state<string | null>(
  typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_KEY) : null
);

export function getApiKey(): string | null {
  return apiKey;
}

export function setApiKey(key: string): void {
  apiKey = key;
  localStorage.setItem(AUTH_KEY, key);
}

export function clearApiKey(): void {
  apiKey = null;
  localStorage.removeItem(AUTH_KEY);
}

export function isAuthenticated(): boolean {
  return apiKey !== null && apiKey.length > 0;
}
```

### Modified apiFetch with Auth Header
```typescript
// Modify web/src/lib/api/client.ts
import { getApiKey, clearApiKey } from '$lib/auth/auth-store.svelte';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  const key = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init?.headers as Record<string, string>,
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    clearApiKey();
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized', 'UNAUTHORIZED');
  }
  // ... rest of existing logic
}
```

### Webhook Integration in JobService
```typescript
// In job-service.ts executeJob finally block, after saving results:
if (this.webhookService && this.config.webhooks?.url) {
  this.webhookService.deliver(this.config.webhooks.url, {
    event: 'job.completed',
    job: { id: job.id, status: result.status, platform: job.platform },
    summary: result.summary,
    timestamp: new Date().toISOString(),
  }).catch((err) => {
    this.logger.error({ jobId: job.id, error: err.message }, 'Webhook delivery failed');
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JWT sessions | API key (Bearer token) | N/A for this project | Simpler for CI/CLI -- no token refresh needed. SSO planned for v2 |
| XML DOM builder | String templating for JUnit | N/A | For simple output formats, string building is more efficient |
| Global auth middleware | Scoped route protection | Fastify plugin encapsulation | Health/public endpoints remain accessible |

**Deprecated/outdated:**
- @fastify/bearer-auth v8.x: Use v10.x for Fastify 5 compatibility

## Open Questions

1. **Auth bypass for WebSocket routes**
   - What we know: Browser WebSocket API cannot set custom headers. The existing WS routes at `/api/jobs/:id/ws` need auth.
   - What's unclear: Whether to use query parameter (`?token=xxx`) or validate in the WS upgrade handler.
   - Recommendation: Use query parameter for WS connections. Validate in the connection handler before accepting. This matches industry practice (GitHub, Slack APIs).

2. **Webhook HMAC Signing**
   - What we know: Best practice is to sign webhook payloads with HMAC-SHA256 so receivers can verify authenticity.
   - What's unclear: Whether this is needed for v1 (internal tool).
   - Recommendation: Include optional `webhooks.secret` config. If set, add `X-Signature-256` header. Simple to implement, good practice.

3. **Auth on/off toggle**
   - What we know: During development, auth being mandatory is inconvenient.
   - What's unclear: Exact toggle mechanism.
   - Recommendation: `auth.enabled` config flag (default `false`). When false, auth plugin registers but doesn't enforce. Allows gradual rollout.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | API key CRUD (create, list, revoke) | unit | `npx vitest run server/auth/__tests__/auth-service.test.ts -x` | No - Wave 0 |
| AUTH-02 | API routes reject without valid key | unit | `npx vitest run server/auth/__tests__/auth-plugin.test.ts -x` | No - Wave 0 |
| AUTH-03 | Web UI redirects to login without key | manual-only | Manual: open UI without key, verify redirect | N/A |
| REPT-01 | Webhook POST on job completion | unit | `npx vitest run server/reporting/__tests__/webhook-service.test.ts -x` | No - Wave 0 |
| REPT-02 | JUnit XML matches expected format | unit | `npx vitest run server/reporting/__tests__/junit-generator.test.ts -x` | No - Wave 0 |
| REPT-03 | Flaky detection identifies unstable flows | unit | `npx vitest run server/reporting/__tests__/flaky-detector.test.ts -x` | No - Wave 0 |
| REPT-04 | Flaky endpoint returns flow data | unit | `npx vitest run server/reporting/__tests__/flaky-detector.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/auth/__tests__/ server/reporting/__tests__/ --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/auth/__tests__/auth-service.test.ts` -- covers AUTH-01
- [ ] `server/auth/__tests__/auth-plugin.test.ts` -- covers AUTH-02
- [ ] `server/reporting/__tests__/webhook-service.test.ts` -- covers REPT-01
- [ ] `server/reporting/__tests__/junit-generator.test.ts` -- covers REPT-02
- [ ] `server/reporting/__tests__/flaky-detector.test.ts` -- covers REPT-03, REPT-04

## Sources

### Primary (HIGH confidence)
- Project codebase analysis: server/api/plugin.ts, server/db/schema.ts, server/config/schema.ts, server/jobs/job-service.ts, cli/internal/client/client.go, web/src/lib/api/client.ts
- [@fastify/bearer-auth README](https://github.com/fastify/fastify-bearer-auth) -- registration, config options, Fastify 5 compatibility (v10.x)
- [testmoapp/junitxml](https://github.com/testmoapp/junitxml) -- JUnit XML format specification and complete examples

### Secondary (MEDIUM confidence)
- [Webhook retry best practices](https://hookdeck.com/outpost/guides/outbound-webhook-retry-best-practices) -- exponential backoff with jitter, circuit breakers
- [Slack Engineering - Flaky test detection](https://slack.engineering/handling-flaky-tests-at-scale-auto-detection-suppression/) -- sliding window approach, 20% threshold

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- @fastify/bearer-auth is the official Fastify auth plugin, v10 confirmed for Fastify 5
- Architecture: HIGH -- follows established plugin patterns from server/config/plugin.ts, server/jobs/plugin.ts
- Pitfalls: HIGH -- WebSocket auth bypass and XML escaping are well-documented gotchas
- Reporting: HIGH -- JUnit XML format is stable and well-documented, flaky detection is straightforward SQL

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, no fast-moving dependencies)
