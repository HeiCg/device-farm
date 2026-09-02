import { describe, it, expect, vi, afterEach } from 'vitest';
import { IOSDriver } from '../src/drivers/ios';

const WDA = 'http://wda.test';

/** Minimal Response stand-in with both json() and text(). */
function res(status: number, body: unknown): Response {
  const isString = typeof body === 'string';
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (isString ? JSON.parse(body as string) : body),
    text: async () => (isString ? (body as string) : JSON.stringify(body)),
  } as unknown as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IOSDriver.clearText (B1)', () => {
  it('taps the active element via WDA element/:id/clear, never a hardware key', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/session/SID/element/active')) return res(200, { value: { ELEMENT: 'E1' } });
      if (url.endsWith('/session/SID/element/E1/clear')) return res(200, { value: null });
      return res(404, 'no such element');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID' });

    await d.clearText();

    const clearCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/element/E1/clear'));
    expect(clearCall).toBeDefined();
    expect((clearCall![1] as RequestInit).method).toBe('POST');
  });
});

describe('IOSDriver.waitForIdle (B3)', () => {
  it('returns once two consecutive /source reads are identical', async () => {
    const sources = ['<a/>', '<b/>', '<b/>'];
    let n = 0;
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/source')) return res(200, { value: sources[Math.min(n++, sources.length - 1)] });
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID' });

    await d.waitForIdle(2000);
    const sourceReads = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/source')).length;
    expect(sourceReads).toBe(3); // a, b, b -> settled on the second b
  });

  it('honors a timeout beyond the old 350ms cap while the UI keeps changing', async () => {
    let n = 0;
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/source')) return res(200, { value: `<frame ${n++}/>` }); // always different
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID' });

    const started = Date.now();
    await d.waitForIdle(500);
    const elapsed = Date.now() - started;
    const sourceReads = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/source')).length;
    // Old impl slept <=350ms and never polled; the new one keeps polling to ~500ms.
    expect(elapsed).toBeGreaterThan(350);
    expect(sourceReads).toBeGreaterThanOrEqual(3);
  });

  it('falls back to a short sleep when the first /source read fails', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/source')) return res(404, 'no such element'); // 4xx: not retried
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID' });

    const started = Date.now();
    await d.waitForIdle(2000);
    const elapsed = Date.now() - started;
    const sourceReads = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/source')).length;
    expect(sourceReads).toBe(1); // one failed read, then the capped fallback sleep
    expect(elapsed).toBeLessThan(1000); // capped at 350ms, not the full 2000ms
  });
});

describe('IOSDriver WDA transport retry/timeout (B4)', () => {
  it('retries on 5xx then succeeds', async () => {
    let n = 0;
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/window/size')) {
        return n++ < 2 ? res(503, 'busy') : res(200, { value: { width: 390, height: 844 } });
      }
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID', retries: 3 });

    const size = await d.screenSize();
    expect(size).toEqual({ width: 390, height: 844 });
    const sizeCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/window/size')).length;
    expect(sizeCalls).toBe(3);
  });

  it('recreates the session on an invalid-session error and retries once', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.includes('/session/old/window/size')) return res(404, 'invalid session id');
      if (url.endsWith('/session') && init?.method === 'POST') {
        return res(200, { value: { sessionId: 'new' } });
      }
      if (url.includes('/session/new/window/size')) return res(200, { value: { width: 1, height: 2 } });
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'old', retries: 3 });

    const size = await d.screenSize();
    expect(size).toEqual({ width: 1, height: 2 });
    const createdSession = fetchMock.mock.calls.some(
      ([u, i]) => String(u).endsWith('/session') && (i as RequestInit)?.method === 'POST',
    );
    expect(createdSession).toBe(true);
    const retriedWithNew = fetchMock.mock.calls.some(([u]) => String(u).includes('/session/new/window/size'));
    expect(retriedWithNew).toBe(true);
  });

  it('does NOT retry a 4xx element-not-found', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/window/size')) return res(404, 'no such element');
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID', retries: 3 });

    await expect(d.screenSize()).rejects.toThrow(/404/);
    const sizeCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/window/size')).length;
    expect(sizeCalls).toBe(1);
  });

  it('times out a wedged request via AbortController', async () => {
    stubFetch(
      (url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID', timeoutMs: 20, retries: 0 });

    await expect(d.screenSize()).rejects.toThrow(/timed out after 20ms/);
  });
});

describe('IOSDriver.screenshot scale (B6)', () => {
  it('warns once that scale is ignored on iOS and returns the full-res PNG', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch((url) => {
      if (url.endsWith('/screenshot')) return res(200, { value: Buffer.from('png').toString('base64') });
      return res(404, 'x');
    });
    const d = new IOSDriver({ serial: 'S', wdaUrl: WDA, sessionId: 'SID' });

    const buf = await d.screenshot({ scale: 0.25 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/ignored on iOS/);

    await d.screenshot({ scale: 0.5 }); // still only warned once per driver
    expect(warn).toHaveBeenCalledTimes(1);

    await d.screenshot(); // no scale -> no warning
    await d.screenshot({ scale: 1 }); // full scale -> no warning
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
