/**
 * Device-free fixtures: hand-built payloads that stand in for real MCP results so
 * the metric/capture/report layers can be tested without an emulator.
 */
import type { CallRecord } from '../types.js';
import type { McpToolResult } from '../capture.js';

/** Build a minimal but valid PNG buffer with the given IHDR width/height. */
export function makePngBase64(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  // Signature
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  // IHDR length (13) — not read by our parser but present in a real PNG
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

/** A describe-style text result. */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

/** An argent-style auto-capture result: text note + screenshot image. */
export function textAndImageResult(text: string, width: number, height: number): McpToolResult {
  return {
    content: [
      { type: 'text', text },
      { type: 'image', data: makePngBase64(width, height), mimeType: 'image/png' },
    ],
  };
}

/**
 * A hand-numbered call list used by the metrics tests. Two agent calls plus one
 * auto-capture, spread across three logical steps.
 */
export const SAMPLE_CALLS: CallRecord[] = [
  {
    step: 1,
    tool: 'launch-app',
    origin: 'agent',
    requestBytes: 30,
    requestTokens: 10,
    resultBytes: 200,
    resultTokens: 100,
    contentTypes: ['text'],
  },
  {
    step: 1,
    tool: 'describe',
    origin: 'auto-describe',
    requestBytes: 20,
    requestTokens: 5,
    resultBytes: 800,
    resultTokens: 400,
    contentTypes: ['text'],
  },
  {
    step: 2,
    tool: 'gesture-tap',
    origin: 'agent',
    requestBytes: 40,
    requestTokens: 15,
    resultBytes: 100,
    resultTokens: 50,
    contentTypes: ['text'],
  },
];
