import type { WebSocket } from 'ws';

export interface PipelineMessage {
  type: 'stage_start' | 'stage_log' | 'stage_end' | 'job_created' | 'run_end';
  data: Record<string, unknown>;
  timestamp: string;
}

export class PipelineBroadcaster {
  private readonly subscribers: Map<string, Set<WebSocket>> = new Map();
  private readonly buffers: Map<string, PipelineMessage[]> = new Map();
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 200) {
    this.maxBufferSize = maxBufferSize;
  }

  emit(runId: string, message: PipelineMessage): void {
    let buffer = this.buffers.get(runId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(runId, buffer);
    }
    buffer.push(message);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    const subs = this.subscribers.get(runId);
    if (subs) {
      const json = JSON.stringify(message);
      for (const ws of subs) {
        if (ws.readyState === ws.OPEN) {
          ws.send(json);
        }
      }
    }
  }

  subscribe(runId: string, ws: WebSocket): void {
    let subs = this.subscribers.get(runId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(runId, subs);
    }
    subs.add(ws);

    const buffer = this.buffers.get(runId);
    if (buffer) {
      for (const msg of buffer) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    }
  }

  unsubscribe(runId: string, ws: WebSocket): void {
    const subs = this.subscribers.get(runId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        this.subscribers.delete(runId);
      }
    }
  }

  cleanup(runId: string): void {
    this.subscribers.delete(runId);
  }
}
