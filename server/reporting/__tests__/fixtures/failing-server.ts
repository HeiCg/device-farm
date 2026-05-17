/**
 * Phase 19 / Plan 19-00 Task 0.6 — Shared failing-HTTP-server test fixture.
 *
 * Exports `startFailingServer(opts)` which spins up an ephemeral http.Server
 * on port 0 (OS-allocated). Consumers call `.setResponse({status, body?, hangMs?})`
 * between requests to configure the next response shape, and read
 * `.requestCount()` / `.lastHeaders()` / `.lastBody()` for assertions.
 *
 * Consumers:
 *   - server/reporting/__tests__/webhook-service.spec.ts      (plan 19-02 unit spec — deliverOnce contract)
 *   - server/reporting/__tests__/queue.spec.ts                (plan 19-04 DB-gated SC1 proof — 5× 500 → DLQ)
 *   - server/reporting/__tests__/correlation.spec.ts          (plan 19-04 DB-gated SC4 proof — single correlationId)
 *   - server/reporting/__tests__/terminal-event.spec.ts       (plan 19-04 DB-gated EVENTS-07 proof)
 *   - server/reporting/__tests__/dlq-route.spec.ts            (plan 19-05 DB-gated Zod round-trip — ONLY uses startFailingServer if seeding via failing requests; the route spec may skip the fixture and seed directly via app.queue.send — see plan 19-05 notes)
 *
 * This is a test-ONLY fixture. It MUST NOT be imported by production code
 * (enforced by the lack of a re-export from server/reporting/index.ts).
 * The `__fixtures__/` path convention distinguishes test helpers from
 * production modules.
 *
 * Factored per checker revision W1 (2026-04-21) to DRY ~40 lines × 5 consumers = ~200 lines.
 */
import { createServer, type Server } from 'node:http';

export interface TestServerResponse {
  status: number;
  body?: string;
  hangMs?: number;
}

export interface FailingServerHandle {
  /** Full URL including path (e.g. http://127.0.0.1:54321/hook) */
  url: string;
  /** Raw Node http.Server — exposed for advanced uses; most consumers use close() */
  server: Server;
  /** Configure the next response shape (applies until next setResponse). */
  setResponse: (opts: TestServerResponse) => void;
  /** Count of requests received since startFailingServer (monotonically increasing). */
  requestCount: () => number;
  /** Headers of the most recent request (lowercase keys). */
  lastHeaders: () => Record<string, string>;
  /** Body (string) of the most recent request. */
  lastBody: () => string;
  /** Close the server; resolves when socket cleanup completes. */
  close: () => Promise<void>;
}

export interface StartFailingServerOpts {
  /** Default response shape (applied before first setResponse). Default: 500. */
  defaultResponse?: TestServerResponse;
  /** Request path suffix (default: '/hook'). */
  path?: string;
}

/**
 * Boot an ephemeral http.Server on port 0 and return a handle.
 *
 * Default behaviour: respond 500 to every request (the SC1 "always-fail" target).
 * Consumers override per-test via `.setResponse({status: 200})` etc.
 *
 * Returns after the server is listening — safe to hand the `.url` to
 * `WebhookService.deliverOnce` or to `fastify.queue.send` as a webhook target.
 */
export async function startFailingServer(
  opts: StartFailingServerOpts = {},
): Promise<FailingServerHandle> {
  const path = opts.path ?? '/hook';
  let responseOpts: Required<TestServerResponse> = {
    status: opts.defaultResponse?.status ?? 500,
    body: opts.defaultResponse?.body ?? 'nope',
    hangMs: opts.defaultResponse?.hangMs ?? 0,
  };
  let count = 0;
  let lastHeaders: Record<string, string> = {};
  let lastBody = '';

  const server: Server = createServer((req, res) => {
    count++;
    lastHeaders = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(',') : String(v ?? ''),
      ]),
    );
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      lastBody = body;
      const fire = (): void => {
        res.writeHead(responseOpts.status, { 'Content-Type': 'text/plain' });
        res.end(responseOpts.body);
      };
      if (responseOpts.hangMs > 0) {
        setTimeout(fire, responseOpts.hangMs);
      } else {
        fire();
      }
    });
  });

  const url: string = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(`http://127.0.0.1:${address.port}${path}`);
      } else {
        reject(new Error('Failed to bind failing server'));
      }
    });
  });

  return {
    url,
    server,
    setResponse: (next) => {
      responseOpts = {
        status: next.status,
        body: next.body ?? '',
        hangMs: next.hangMs ?? 0,
      };
    },
    requestCount: () => count,
    lastHeaders: () => lastHeaders,
    lastBody: () => lastBody,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
