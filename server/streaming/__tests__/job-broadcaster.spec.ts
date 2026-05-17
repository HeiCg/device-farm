import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JobBroadcaster } from '../internal/job-broadcaster.js';
import type { WsEnvelope } from '../internal/ws-schemas.js';

/**
 * Phase 22 Plan 22-02 — JobBroadcaster signature tightened to WsEnvelope.
 * This test file previously wrapped legacy JobMessage{type,data,timestamp}
 * payloads; it now exercises the WsEnvelope shape directly.
 */
function makeEnvelope(type: 'log' | 'step' = 'log', i = 0): WsEnvelope {
  return {
    type,
    correlationId: randomUUID(),
    v: 1,
    ts: new Date().toISOString(),
    payload: { line: `msg-${i}` },
  };
}

describe('JobBroadcaster', () => {
  let broadcaster: JobBroadcaster;

  beforeEach(() => {
    broadcaster = new JobBroadcaster();
  });

  describe('emit', () => {
    it('stores envelopes in per-job buffer', () => {
      broadcaster.emit('job-1', makeEnvelope('log', 1));
      broadcaster.emit('job-1', makeEnvelope('log', 2));
      expect(broadcaster.getBufferSize('job-1')).toBe(2);
    });

    it('isolates buffers between jobs', () => {
      broadcaster.emit('job-1', makeEnvelope('log', 1));
      broadcaster.emit('job-2', makeEnvelope('log', 2));
      expect(broadcaster.getBufferSize('job-1')).toBe(1);
      expect(broadcaster.getBufferSize('job-2')).toBe(1);
    });
  });

  describe('subscribe', () => {
    it('replays buffered envelopes then receives live events', () => {
      const received: WsEnvelope[] = [];
      const env1 = makeEnvelope('log', 1);
      const env2 = makeEnvelope('log', 2);

      // Emit before subscribing
      broadcaster.emit('job-1', env1);
      broadcaster.emit('job-1', env2);

      // Subscribe -- should replay
      broadcaster.subscribe('job-1', (env) => received.push(env));

      expect(received).toHaveLength(2);
      expect(received[0]).toBe(env1);
      expect(received[1]).toBe(env2);

      // Emit live -- should receive
      const env3 = makeEnvelope('step', 3);
      broadcaster.emit('job-1', env3);

      expect(received).toHaveLength(3);
      expect(received[2]).toBe(env3);
    });

    it('returns unsubscribe function that stops receiving', () => {
      const received: WsEnvelope[] = [];

      const unsub = broadcaster.subscribe('job-1', (env) => received.push(env));

      broadcaster.emit('job-1', makeEnvelope('log', 1));
      expect(received).toHaveLength(1);

      unsub();

      broadcaster.emit('job-1', makeEnvelope('log', 2));
      expect(received).toHaveLength(1); // no new messages
    });

    it('multiple subscribers receive same envelopes independently', () => {
      const received1: WsEnvelope[] = [];
      const received2: WsEnvelope[] = [];

      broadcaster.subscribe('job-1', (env) => received1.push(env));
      broadcaster.subscribe('job-1', (env) => received2.push(env));

      const env = makeEnvelope('log', 1);
      broadcaster.emit('job-1', env);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received1[0]).toBe(env);
      expect(received2[0]).toBe(env);
    });

    it('unsubscribe does not affect other subscribers', () => {
      const received1: WsEnvelope[] = [];
      const received2: WsEnvelope[] = [];

      const unsub1 = broadcaster.subscribe('job-1', (env) => received1.push(env));
      broadcaster.subscribe('job-1', (env) => received2.push(env));

      unsub1();

      broadcaster.emit('job-1', makeEnvelope('log', 1));
      expect(received1).toHaveLength(0);
      expect(received2).toHaveLength(1);
    });

    it('returns empty replay after cleanup', () => {
      broadcaster.emit('job-1', makeEnvelope('log', 1));
      broadcaster.cleanup('job-1');

      const received: WsEnvelope[] = [];
      broadcaster.subscribe('job-1', (env) => received.push(env));
      expect(received).toHaveLength(0);
    });
  });

  describe('ring buffer overflow', () => {
    it('caps at MAX_BUFFER (200) envelopes, dropping oldest', () => {
      for (let i = 0; i < 250; i++) {
        broadcaster.emit('job-1', makeEnvelope('log', i));
      }

      expect(broadcaster.getBufferSize('job-1')).toBe(200);

      // Verify oldest were dropped -- subscribe and check first envelope
      const received: WsEnvelope[] = [];
      broadcaster.subscribe('job-1', (env) => received.push(env));

      // First replayed envelope should be msg-50 (0..49 were dropped)
      expect((received[0].payload as { line: string }).line).toBe('msg-50');
      expect((received[199].payload as { line: string }).line).toBe('msg-249');
    });
  });

  describe('cleanup', () => {
    it('removes buffer and all listeners for a job', () => {
      const received: WsEnvelope[] = [];
      broadcaster.subscribe('job-1', (env) => received.push(env));
      broadcaster.emit('job-1', makeEnvelope('log', 1));

      broadcaster.cleanup('job-1');

      expect(broadcaster.getBufferSize('job-1')).toBe(0);

      // After cleanup, emit should not reach old subscriber
      broadcaster.emit('job-1', makeEnvelope('log', 2));
      expect(received).toHaveLength(1);
    });

    it('does not affect other jobs', () => {
      const received: WsEnvelope[] = [];
      broadcaster.subscribe('job-2', (env) => received.push(env));

      broadcaster.cleanup('job-1');

      broadcaster.emit('job-2', makeEnvelope('log', 1));
      expect(received).toHaveLength(1);
    });
  });
});
