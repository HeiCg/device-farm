/**
 * Spec for telemetry plugin's pino `alsMixin` — Phase 15 Plan 03, Task 3.2.
 *
 * Proves TRACE-03 (every pino log line inside a request carries correlationId) and
 * MOD-07 (module child loggers inherit correlationId automatically).
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import pino from 'pino';
import { asyncLocalStorage } from '@fastify/request-context';
import { correlationPlugin } from '../../correlation/index.js';
import { alsMixin } from '../index.js';

/** Collect all JSON log records written to a pino destination. */
function captureStream(): { stream: Writable; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const line = chunk.toString().trim();
      if (line) {
        try { records.push(JSON.parse(line)); } catch { /* ignore non-JSON */ }
      }
      cb();
    },
  });
  return { stream, records };
}

describe('alsMixin — direct invocation', () => {
  it('returns an empty object when there is no active ALS store', () => {
    expect(alsMixin()).toEqual({});
  });

  it('returns correlationId when ALS store is a Map (cross-queue path)', () => {
    const store = new Map<string, unknown>([['correlationId', 'abc']]);
    const out = asyncLocalStorage.run(store as never, () => alsMixin());
    expect(out).toEqual({ correlationId: 'abc' });
  });

  it('returns correlationId when ALS store is a plain object (request-context path)', () => {
    const store = { correlationId: 'req-cid', currentEventId: null, actor: 'anonymous' };
    const out = asyncLocalStorage.run(store as never, () => alsMixin());
    // actor is truthy ('anonymous') so it is emitted; currentEventId is null so it is omitted.
    expect(out).toEqual({ correlationId: 'req-cid', actor: 'anonymous' });
  });

  it('adds causationId and actor when present, omits them when absent', () => {
    const full = { correlationId: 'c1', currentEventId: 'evt-1', actor: 'system' };
    expect(asyncLocalStorage.run(full as never, () => alsMixin())).toEqual({
      correlationId: 'c1',
      causationId: 'evt-1',
      actor: 'system',
    });

    const onlyCid = { correlationId: 'c2', currentEventId: null, actor: 'anonymous' };
    // anonymous is the default value — we still emit it because actor is truthy.
    expect(asyncLocalStorage.run(onlyCid as never, () => alsMixin())).toEqual({
      correlationId: 'c2',
      actor: 'anonymous',
    });
  });
});

describe('alsMixin wired into pino — inside a Fastify request', () => {
  it('every log line carries correlationId, including child-logger lines', async () => {
    const { stream, records } = captureStream();
    const logger = pino({ level: 'info', mixin: alsMixin }, stream);

    const app = Fastify({ loggerInstance: logger });
    await app.register(correlationPlugin);
    app.get('/log', async (req) => {
      req.log.info('route-level log');
      const moduleLogger = req.log.child({ module: 'jobs' });
      moduleLogger.info('module-level log');
      return { ok: true };
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/log',
      headers: { 'x-correlation-id': 'cid-mixin-test' },
    });
    await app.close();
    expect(res.statusCode).toBe(200);

    const routeLine = records.find(r => r.msg === 'route-level log');
    const moduleLine = records.find(r => r.msg === 'module-level log');
    expect(routeLine?.correlationId).toBe('cid-mixin-test');
    expect(moduleLine?.correlationId).toBe('cid-mixin-test');
    expect(moduleLine?.module).toBe('jobs');
  });

  it('log lines OUTSIDE any request do not include correlationId', () => {
    const { stream, records } = captureStream();
    const logger = pino({ level: 'info', mixin: alsMixin }, stream);
    logger.info('boot message');
    const boot = records.find(r => r.msg === 'boot message');
    expect(boot).toBeDefined();
    expect(boot?.correlationId).toBeUndefined();
    expect(boot?.causationId).toBeUndefined();
  });
});
