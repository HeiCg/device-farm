import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FlushQueue } from '../internal/flush-queue.js';
import type { WsEnvelope } from '../internal/ws-schemas.js';

// Phase 31 Wave 0: RED state. The production module
// `server/streaming/internal/flush-queue.ts` is implemented by Wave 1 plan 31-02.
// Until then, this spec MUST fail with a module resolution error.

function mockSocket() {
  return { send: vi.fn(), readyState: 1 /* OPEN */ };
}

function envelope(i: number): WsEnvelope {
  return {
    type: 'log',
    v: 1,
    correlationId: '00000000-0000-0000-0000-000000000000',
    ts: new Date().toISOString(),
    payload: { line: `log line ${i}` },
  } as WsEnvelope;
}

describe('FlushQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('10k lines: produces fewer than 100 WS frames and accounts for every envelope', () => {
    const socket = mockSocket();
    const q = new FlushQueue(socket as any, true);

    for (let i = 0; i < 10000; i++) q.push(envelope(i));
    vi.advanceTimersByTime(30_000);
    q.close();

    expect(socket.send.mock.calls.length).toBeLessThan(100);

    let total = 0;
    for (const call of socket.send.mock.calls) {
      const parsed = JSON.parse(call[0] as string);
      if (parsed.type === 'batch') {
        total += parsed.items.length;
      } else {
        total += 1;
      }
    }
    expect(total).toBe(10000);
  });

  it('disconnect drains pending buffer in a single batch send', () => {
    const socket = mockSocket();
    const q = new FlushQueue(socket as any, true);

    for (let i = 0; i < 5; i++) q.push(envelope(i));
    q.close();

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(socket.send.mock.calls[0][0] as string);
    expect(payload.type).toBe('batch');
    expect(payload.items.length).toBe(5);
  });

  it('nobatch opt-out: each frame is sent unbatched', () => {
    const socket = mockSocket();
    const q = new FlushQueue(socket as any, false);

    q.push(envelope(0));
    q.push(envelope(1));
    q.push(envelope(2));

    expect(socket.send).toHaveBeenCalledTimes(3);
    for (const call of socket.send.mock.calls) {
      const parsed = JSON.parse(call[0] as string);
      expect(parsed.type).not.toBe('batch');
    }

    q.close();
  });

  it('buffer cap triggers flush before timer fires', () => {
    // Cap was raised from 64 → 256 in Wave 1 (31-02 Task 1, Rule 1 deviation):
    // the SC2 "< 100 frames for 10k lines" contract is unsatisfiable at cap=64.
    // The cap-flush behavior itself remains under test — at BUFFER_CAP pushes,
    // a single batch flush is emitted before the 150ms timer fires.
    const CAP = 256;
    const socket = mockSocket();
    const q = new FlushQueue(socket as any, true);

    for (let i = 0; i < CAP; i++) q.push(envelope(i));

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(socket.send.mock.calls[0][0] as string);
    expect(payload.type).toBe('batch');
    expect(payload.items.length).toBe(CAP);

    q.close();
  });

  it('empty flush is a no-op', () => {
    const socket = mockSocket();
    const q = new FlushQueue(socket as any, true);

    q.flush();
    expect(socket.send).not.toHaveBeenCalled();

    q.close();
  });
});
