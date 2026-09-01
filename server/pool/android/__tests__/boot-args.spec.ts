import { describe, it, expect } from 'vitest';
import {
  resolveGpuMode,
  resolveNoWindow,
  buildEmulatorBootArgs,
  kvmPreflight,
} from '../boot-args.js';

describe('resolveGpuMode', () => {
  it('defaults to swiftshader_indirect when nothing is set', () => {
    expect(resolveGpuMode(undefined, {})).toBe('swiftshader_indirect');
  });

  it('uses the BootOptions value when no env override', () => {
    expect(resolveGpuMode('host', {})).toBe('host');
  });

  it('env override wins over BootOptions', () => {
    expect(resolveGpuMode('host', { DEVICE_FARM_EMULATOR_GPU_MODE: 'swiftshader' })).toBe('swiftshader');
  });

  it('accepts the ARGENT_EMULATOR_GPU_MODE alias', () => {
    expect(resolveGpuMode(undefined, { ARGENT_EMULATOR_GPU_MODE: 'angle_indirect' })).toBe('angle_indirect');
  });

  it('rejects an unknown GPU mode (fail fast)', () => {
    expect(() => resolveGpuMode(undefined, { DEVICE_FARM_EMULATOR_GPU_MODE: 'turbo' })).toThrow(/invalid gpu/i);
  });
});

describe('resolveNoWindow', () => {
  it('defaults to headless (true) for the server farm', () => {
    expect(resolveNoWindow({})).toBe(true);
  });

  it('shows the window when explicitly disabled', () => {
    for (const v of ['0', 'false', 'no', 'FALSE']) {
      expect(resolveNoWindow({ DEVICE_FARM_EMULATOR_NO_WINDOW: v })).toBe(false);
    }
  });

  it('stays headless for truthy values and accepts the ARGENT alias', () => {
    expect(resolveNoWindow({ DEVICE_FARM_EMULATOR_NO_WINDOW: '1' })).toBe(true);
    expect(resolveNoWindow({ ARGENT_EMULATOR_NO_WINDOW: '1' })).toBe(true);
  });
});

describe('buildEmulatorBootArgs', () => {
  const base = { avd: 'pixel', port: 5554, grpcPort: 8554 };

  it('preserves the established arg order (avd → no-window → boot-anim → port → grpc → audio → gpu)', () => {
    const args = buildEmulatorBootArgs(base, {});
    const order = ['-avd', 'pixel', '-no-window', '-no-boot-anim', '-port', '5554', '-grpc', '8554'];
    expect(args.slice(0, order.length)).toEqual(order);
    const gpuIdx = args.indexOf('-gpu');
    expect(args[gpuIdx + 1]).toBe('swiftshader_indirect');
  });

  it('omits -no-window when the window is requested', () => {
    const args = buildEmulatorBootArgs(base, { DEVICE_FARM_EMULATOR_NO_WINDOW: '0' });
    expect(args).not.toContain('-no-window');
  });

  it('adds -no-audio by default and drops it when noAudio is false', () => {
    expect(buildEmulatorBootArgs(base, {})).toContain('-no-audio');
    expect(buildEmulatorBootArgs({ ...base, noAudio: false }, {})).not.toContain('-no-audio');
  });

  it('adds -no-snapshot-load only on cold boot', () => {
    expect(buildEmulatorBootArgs(base, {})).not.toContain('-no-snapshot-load');
    expect(buildEmulatorBootArgs({ ...base, coldBoot: true }, {})).toContain('-no-snapshot-load');
  });

  it('always appends the hardening flags (netfast, no-metrics, crash-report-mode never)', () => {
    const args = buildEmulatorBootArgs(base, {});
    expect(args).toContain('-netfast');
    expect(args).toContain('-no-metrics');
    const crashIdx = args.indexOf('-crash-report-mode');
    expect(crashIdx).toBeGreaterThan(-1);
    expect(args[crashIdx + 1]).toBe('never');
  });
});

describe('kvmPreflight', () => {
  it('is a no-op (usable) off Linux', () => {
    expect(kvmPreflight({}, { platform: 'darwin' })).toEqual({ platform: 'darwin', usable: true });
  });

  it('reports usable when /dev/kvm is accessible on Linux', () => {
    const diag = kvmPreflight({}, { platform: 'linux', canAccess: () => true });
    expect(diag.usable).toBe(true);
    expect(diag.reason).toBeUndefined();
  });

  it('warns with remediation when /dev/kvm is not accessible on Linux', () => {
    const diag = kvmPreflight({}, { platform: 'linux', canAccess: () => false });
    expect(diag.usable).toBe(false);
    expect(diag.reason).toMatch(/kvm/i);
    expect(diag.reason).toMatch(/TCG|software/i);
  });
});
