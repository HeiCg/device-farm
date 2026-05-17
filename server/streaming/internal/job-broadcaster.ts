import { EventEmitter } from 'node:events';
import type { WsEnvelope } from './ws-schemas.js';

const MAX_BUFFER = 200;

/**
 * Phase 22 Plan 22-02 — Type tightened to WsEnvelope (was the legacy
 * unenveloped message shape).
 *
 * Ring buffer stores enveloped frames (correlationId-stamped, v:1,
 * ts datetime, typed payload). WS route handler sends JSON.stringify(envelope)
 * directly to the client. Reconnecting clients replay the last <=200
 * envelopes (SC2 invariant).
 *
 * Producer API is now the bus: server/streaming/internal/module.ts
 * subscriber wraps job.log/job.step/job.status payloads into envelopes
 * + calls broadcaster.emit(jobId, envelope). No producer outside the
 * streaming module may call broadcaster.emit directly (SC2 grep-guard
 * in Plan 22-04 lifecycle-ownership.spec).
 *
 * cleanup/getBufferSize signatures unchanged.
 */
export class JobBroadcaster {
  private readonly buffers = new Map<string, WsEnvelope[]>();
  private readonly emitter = new EventEmitter();

  constructor() {
    // Avoid MaxListenersExceededWarning with many concurrent WS clients
    this.emitter.setMaxListeners(0);
  }

  /**
   * Push an envelope to the job's ring buffer and emit to live subscribers.
   */
  emit(jobId: string, envelope: WsEnvelope): void {
    let buffer = this.buffers.get(jobId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(jobId, buffer);
    }

    buffer.push(envelope);
    if (buffer.length > MAX_BUFFER) {
      buffer.shift();
    }

    this.emitter.emit(jobId, envelope);
  }

  /**
   * Subscribe to a job's events. Replays buffered history first,
   * then streams live events. Returns an unsubscribe function.
   */
  subscribe(jobId: string, handler: (envelope: WsEnvelope) => void): () => void {
    // Replay buffered history
    const buffer = this.buffers.get(jobId);
    if (buffer) {
      for (const env of buffer) {
        handler(env);
      }
    }

    // Attach live listener
    this.emitter.on(jobId, handler);

    return () => {
      this.emitter.removeListener(jobId, handler);
    };
  }

  /**
   * Remove buffer and all listeners for a job. Frees memory.
   */
  cleanup(jobId: string): void {
    this.buffers.delete(jobId);
    this.emitter.removeAllListeners(jobId);
  }

  /**
   * Get the current buffer size for a job (for testing/health).
   */
  getBufferSize(jobId: string): number {
    return this.buffers.get(jobId)?.length ?? 0;
  }
}
