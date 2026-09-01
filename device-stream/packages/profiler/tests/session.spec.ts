import { describe, it, expect } from 'vitest';
import { ProfilerSession } from '../src/session';
import type { RawProfile, CaptureBackend } from '../src/types';

function fakeBackend(profile: RawProfile): CaptureBackend {
  const calls: string[] = [];
  return {
    kind: profile.kind,
    async start() { calls.push('start'); },
    async stop() { calls.push('stop'); return profile; },
    _calls: calls,
  } as CaptureBackend & { _calls: string[] };
}

const PROFILE: RawProfile = { kind: 'react', durationMs: 10, samples: [] };

describe('ProfilerSession', () => {
  it('starts idle and transitions idle -> recording -> stopped', async () => {
    const s = new ProfilerSession(fakeBackend(PROFILE), 'emulator-5554');
    expect(s.state).toBe('idle');
    await s.start();
    expect(s.state).toBe('recording');
    const raw = await s.stop();
    expect(s.state).toBe('stopped');
    expect(raw).toEqual(PROFILE);
  });

  it('rejects starting twice', async () => {
    const s = new ProfilerSession(fakeBackend(PROFILE), 'd');
    await s.start();
    await expect(s.start()).rejects.toThrow(/already recording/i);
  });

  it('rejects stopping before starting', async () => {
    const s = new ProfilerSession(fakeBackend(PROFILE), 'd');
    await expect(s.stop()).rejects.toThrow(/not recording/i);
  });

  it('exposes the device id and backend kind for ownership checks', () => {
    const s = new ProfilerSession(fakeBackend(PROFILE), 'emulator-5554');
    expect(s.deviceId).toBe('emulator-5554');
    expect(s.kind).toBe('react');
  });
});
