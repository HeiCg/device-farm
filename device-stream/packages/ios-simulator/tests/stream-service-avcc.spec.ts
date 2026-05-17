import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SimulatorStreamService } from '../src/stream-service.js';
import { serializeAvccFrame } from '@device-stream/core';

class FakeSocket extends EventEmitter {
  readyState = 1; // OPEN
  sent: Array<{ data: any; binary: boolean }> = [];
  send(data: any, opts?: { binary?: boolean }) {
    this.sent.push({ data, binary: opts?.binary ?? false });
  }
  close() {}
}

describe('SimulatorStreamService AVCC forwarding', () => {
  it('forwards a keyframe from CaptureService as a binary tag-prefixed message', () => {
    const svc = new SimulatorStreamService();
    const source = new EventEmitter();
    svc.attachAvccSource(source as any);

    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-AAA', undefined, 'avcc');

    const payload = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    source.emit('frame', { udid: 'UDID-AAA', kind: 'keyframe', payload });

    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0].binary).toBe(true);
    const expected = serializeAvccFrame('keyframe', payload);
    const got = ws.sent[0].data as Uint8Array;
    expect(Buffer.from(got).equals(Buffer.from(expected))).toBe(true);
  });

  it('does not forward AVCC frames to MJPEG-mode sockets', () => {
    const svc = new SimulatorStreamService();
    const source = new EventEmitter();
    svc.attachAvccSource(source as any);

    const mjpegWs = new FakeSocket();
    svc.handleBrowserConnection(mjpegWs as any, 'UDID-BBB', undefined, 'mjpeg');

    source.emit('frame', { udid: 'UDID-BBB', kind: 'delta', payload: Buffer.from([1, 2, 3]) });
    expect(mjpegWs.sent.length).toBe(0);
  });

  it('replays the last avcC description to a late-joining AVCC browser', () => {
    const svc = new SimulatorStreamService();
    const source = new EventEmitter();
    svc.attachAvccSource(source as any);

    const description = Buffer.from([0x01, 0x42, 0xE0, 0x1F]);
    source.emit('frame', { udid: 'UDID-CCC', kind: 'avcc', payload: description });

    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-CCC', undefined, 'avcc');

    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0].binary).toBe(true);
    const expected = serializeAvccFrame('avcc', description);
    const got = ws.sent[0].data as Uint8Array;
    expect(Buffer.from(got).equals(Buffer.from(expected))).toBe(true);
  });

  it('ignores frames for unrelated udids', () => {
    const svc = new SimulatorStreamService();
    const source = new EventEmitter();
    svc.attachAvccSource(source as any);

    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-DDD', undefined, 'avcc');

    source.emit('frame', { udid: 'OTHER-UDID', kind: 'delta', payload: Buffer.from([9, 9, 9]) });
    expect(ws.sent.length).toBe(0);
  });

  it('detachAvccSource() stops forwarding', () => {
    const svc = new SimulatorStreamService();
    const source = new EventEmitter();
    svc.attachAvccSource(source as any);

    const ws = new FakeSocket();
    svc.handleBrowserConnection(ws as any, 'UDID-EEE', undefined, 'avcc');
    svc.detachAvccSource();

    source.emit('frame', { udid: 'UDID-EEE', kind: 'keyframe', payload: Buffer.from([0]) });
    expect(ws.sent.length).toBe(0);
  });
});
