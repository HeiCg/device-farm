import { describe, it, expect, vi } from 'vitest';
import { Device } from '../device.js';
import { DeviceState } from '../../types/index.js';

describe('Device state machine', () => {
  it('transitions from Booting to Idle', () => {
    const device = new Device('test-device', 'android');
    // Device starts in Booting state
    expect(device.state).toBe(DeviceState.Booting);
    device.transition(DeviceState.Idle);
    expect(device.state).toBe(DeviceState.Idle);
  });

  it('transitions from Idle to Allocated', () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);
    device.transition(DeviceState.Allocated);
    expect(device.state).toBe(DeviceState.Allocated);
  });

  it('throws InvalidTransitionError for Running from Idle', () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);
    expect(() => device.transition(DeviceState.Running)).toThrow('Invalid state transition');
  });

  it('throws InvalidTransitionError for Offline from Idle', () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);
    expect(() => device.transition(DeviceState.Offline)).toThrow('Invalid state transition');
  });

  it('emits stateChange event with { from, to } on valid transition', () => {
    const device = new Device('test-device', 'android');
    const handler = vi.fn();
    device.on('stateChange', handler);

    device.transition(DeviceState.Idle);

    expect(handler).toHaveBeenCalledWith({
      from: DeviceState.Booting,
      to: DeviceState.Idle,
    });
  });

  it('allocate() transitions from Idle to Allocated and sets currentJobId', async () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);

    await device.allocate('job-123');

    expect(device.state).toBe(DeviceState.Allocated);
    expect(device.currentJobId).toBe('job-123');
  });

  it('release() transitions from Cleanup to Idle and clears currentJobId', async () => {
    const device = new Device('test-device', 'android');
    // Walk through valid state path: Booting -> Idle -> Allocated -> Running -> Cleanup
    device.transition(DeviceState.Idle);
    await device.allocate('job-123');
    device.transition(DeviceState.Running);
    device.transition(DeviceState.Cleanup);

    device.release();

    expect(device.state).toBe(DeviceState.Idle);
    expect(device.currentJobId).toBeNull();
    expect(device.pid).toBeNull();
  });

  it('concurrent allocate() calls: one succeeds, one fails (mutex)', async () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);

    const results = await Promise.allSettled([
      device.allocate('job-1'),
      device.allocate('job-2'),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/Invalid state transition/);
  });

  it('toInfo() returns a DeviceInfo snapshot', () => {
    const device = new Device('test-device', 'android');
    device.transition(DeviceState.Idle);

    const info = device.toInfo();

    expect(info).toMatchObject({
      id: expect.any(String),
      name: 'test-device',
      platform: 'android',
      state: DeviceState.Idle,
      emulatorId: '',
      port: null,
      pid: null,
      currentJobId: null,
    });
  });

  describe('[Phase 20-02] transition return value', () => {
    it('[Invariant MOD-08 (a)] transition returns {from, to} on success', () => {
      const device = new Device('test-device', 'android');
      const result = device.transition(DeviceState.Idle);
      expect(result).toEqual({ from: DeviceState.Booting, to: DeviceState.Idle });
    });

    it('[Invariant MOD-08 (b)] transition STILL emits stateChange EE event + returns {from,to}', () => {
      const device = new Device('test-device', 'android');
      const handler = vi.fn();
      device.on('stateChange', handler);

      const result = device.transition(DeviceState.Idle);

      expect(handler).toHaveBeenCalledWith({ from: DeviceState.Booting, to: DeviceState.Idle });
      expect(result).toEqual({ from: DeviceState.Booting, to: DeviceState.Idle });
    });

    it('[Invariant MOD-08 (a)] disallowed transition still throws InvalidTransitionError — no return', () => {
      const device = new Device('test-device', 'android');
      device.transition(DeviceState.Idle); // now in Idle
      expect(() => device.transition(DeviceState.Running)).toThrow('Invalid state transition');
    });
  });
});
