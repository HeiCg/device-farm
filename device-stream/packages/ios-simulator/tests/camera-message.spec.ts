import { describe, it, expect } from 'vitest';
import { parseCameraMessage } from '../src/camera-message.js';

describe('parseCameraMessage', () => {
  it('parses camera_list', () => {
    const r = parseCameraMessage(JSON.stringify({ type: 'camera_list' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ type: 'camera_list' });
  });

  it('parses camera_start with all fields and defaults missing mirror to false', () => {
    const r = parseCameraMessage(
      JSON.stringify({ type: 'camera_start', deviceUID: 'CAM-1', fit: 'fill' })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        type: 'camera_start',
        deviceUID: 'CAM-1',
        fit: 'fill',
        mirror: false,
      });
    }
  });

  it('parses camera_start with mirror=true and unknown fit value falls back to "fit"', () => {
    const r = parseCameraMessage(
      JSON.stringify({ type: 'camera_start', deviceUID: 'CAM-2', fit: 'huh', mirror: true })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        type: 'camera_start',
        deviceUID: 'CAM-2',
        fit: 'fit',
        mirror: true,
      });
    }
  });

  it('rejects camera_start with missing deviceUID', () => {
    const r = parseCameraMessage(JSON.stringify({ type: 'camera_start', fit: 'fit' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deviceUID/);
  });

  it('parses camera_stop', () => {
    const r = parseCameraMessage(JSON.stringify({ type: 'camera_stop' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ type: 'camera_stop' });
  });

  it('parses camera_set_flags with partial fields', () => {
    const r1 = parseCameraMessage(JSON.stringify({ type: 'camera_set_flags', mirror: true }));
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.value).toEqual({ type: 'camera_set_flags', mirror: true });
      expect((r1.value as any).fit).toBeUndefined();
    }
    const r2 = parseCameraMessage(JSON.stringify({ type: 'camera_set_flags', fit: 'fill' }));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value).toEqual({ type: 'camera_set_flags', fit: 'fill' });
    }
  });

  it('rejects invalid JSON', () => {
    const r = parseCameraMessage('not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/);
  });

  it('rejects missing type field', () => {
    const r = parseCameraMessage(JSON.stringify({ foo: 'bar' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing 'type'/);
  });

  it('rejects unknown type field', () => {
    const r = parseCameraMessage(JSON.stringify({ type: 'camera_blast' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown type/);
  });
});
