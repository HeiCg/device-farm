import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  isControlMessage,
  isGestureMessage,
  serializeAvccFrame,
  ClientMessageV2,
} from '../src/protocol-v2.js';

describe('parseClientMessage', () => {
  it('parses a set_bitrate control envelope', () => {
    const msg = parseClientMessage('{"type":"set_bitrate","bps":4000000}');
    expect(msg.ok).toBe(true);
    expect(msg.value).toEqual({ type: 'set_bitrate', bps: 4000000 });
    expect(isControlMessage(msg.value!)).toBe(true);
  });

  it('parses a tap gesture envelope', () => {
    const msg = parseClientMessage(
      '{"type":"tap","x":219,"y":478,"width":438,"height":954,"duration":0.05}'
    );
    expect(msg.ok).toBe(true);
    expect(isGestureMessage(msg.value!)).toBe(true);
  });

  it('rejects unknown envelope types', () => {
    const msg = parseClientMessage('{"type":"unknown_xyz"}');
    expect(msg.ok).toBe(false);
    expect(msg.error).toMatch(/unknown/i);
  });

  it('rejects malformed JSON', () => {
    const msg = parseClientMessage('not json');
    expect(msg.ok).toBe(false);
  });
});

describe('serializeAvccFrame', () => {
  it('prepends 0x02 for keyframes', () => {
    const out = serializeAvccFrame('keyframe', new Uint8Array([0xaa, 0xbb]));
    expect(out[0]).toBe(0x02);
    expect(out.slice(1)).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it('prepends 0x03 for delta frames', () => {
    const out = serializeAvccFrame('delta', new Uint8Array([0x11]));
    expect(out[0]).toBe(0x03);
  });

  it('prepends 0x01 for avcC description', () => {
    const out = serializeAvccFrame('avcc', new Uint8Array([0x42]));
    expect(out[0]).toBe(0x01);
  });

  it('prepends 0x04 for JPEG seed', () => {
    const out = serializeAvccFrame('jpeg-seed', new Uint8Array([0xff, 0xd8]));
    expect(out[0]).toBe(0x04);
  });
});
