import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerEvent } from '../src/protocol-v2.js';

describe('logs envelopes', () => {
  it('parses a client logs subscription request', () => {
    const r = parseClientMessage('{"type":"subscribe_logs","level":"info"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ type: 'subscribe_logs', level: 'info' });
    }
  });

  it('parses stop_logs', () => {
    const r = parseClientMessage('{"type":"stop_logs"}');
    expect(r.ok).toBe(true);
  });

  it('parses describe_ui with hit-test coords', () => {
    const r = parseClientMessage('{"type":"describe_ui","x":172,"y":880}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ type: 'describe_ui', x: 172, y: 880 });
    }
  });

  it('parses a server log line event', () => {
    const r = parseServerEvent('{"type":"log","line":"hello"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ type: 'log', line: 'hello' });
    }
  });

  it('parses describe_ui_result with a tree', () => {
    const r = parseServerEvent('{"type":"describe_ui_result","ok":true,"tree":{"role":"AXButton","children":[]}}');
    expect(r.ok).toBe(true);
  });

  it('parseServerEvent rejects malformed JSON', () => {
    const r = parseServerEvent('not json');
    expect(r.ok).toBe(false);
  });
});
