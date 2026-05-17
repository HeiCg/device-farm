import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @device-stream/ios-simulator
const mockCreateDevice = vi.fn();
const mockStartDevice = vi.fn();
const mockStopDevice = vi.fn();
const mockDeleteDevice = vi.fn();
const mockGetDevice = vi.fn();

vi.mock('@device-stream/ios-simulator', () => {
  return {
    IOSSimulatorManager: class MockIOSSimulatorManager {
      createDevice = mockCreateDevice;
      startDevice = mockStartDevice;
      stopDevice = mockStopDevice;
      deleteDevice = mockDeleteDevice;
      getDevice = mockGetDevice;
    },
  };
});

// Mock node:child_process
const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

import type { IosDeviceConfig } from '../../types.js';
import { DeviceStreamIosDriver } from '../device-stream-driver.js';

function createIosConfig(): IosDeviceConfig {
  return {
    enabled: true,
    max_instances: 2,
    runtime: 'iOS-17-5',
    device_type: 'iPhone-15',
  };
}

describe('DeviceStreamIosDriver', () => {
  let driver: DeviceStreamIosDriver;
  const config = createIosConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new DeviceStreamIosDriver();
  });

  describe('create()', () => {
    it('calls IOSSimulatorManager.createDevice() with mapped deviceType and osVersion', async () => {
      mockCreateDevice.mockResolvedValue({
        id: 'ABCD-1234-UDID',
        platform: 'ios',
        name: 'ios-1',
        status: 'stopped',
      });

      const result = await driver.create('ios-1', config);

      expect(mockCreateDevice).toHaveBeenCalledWith({
        platform: 'ios',
        name: 'ios-1',
        deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15',
        osVersion: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5',
      });
      expect(result).toBe('ABCD-1234-UDID');
    });

    it('maps device_type and runtime to full identifiers', async () => {
      mockCreateDevice.mockResolvedValue({
        id: 'SOME-UDID',
        platform: 'ios',
        name: 'test',
        status: 'stopped',
      });

      const customConfig: IosDeviceConfig = {
        enabled: true,
        max_instances: 1,
        runtime: 'iOS-18-0',
        device_type: 'iPhone-16-Pro',
      };

      await driver.create('test', customConfig);

      expect(mockCreateDevice).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
          osVersion: 'com.apple.CoreSimulator.SimRuntime.iOS-18-0',
        }),
      );
    });

    it('handles existing simulator gracefully', async () => {
      mockCreateDevice.mockResolvedValue({
        id: 'EXISTING-UDID',
        platform: 'ios',
        name: 'ios-1',
        status: 'stopped',
      });

      const result = await driver.create('ios-1', config);
      expect(result).toBe('EXISTING-UDID');
    });
  });

  describe('boot()', () => {
    it('calls IOSSimulatorManager.startDevice(), returns { port: 0, pid: 0 }', async () => {
      mockStartDevice.mockResolvedValue({
        id: 'UDID-1',
        status: 'ready',
      });

      const result = await driver.boot('UDID-1');

      expect(mockStartDevice).toHaveBeenCalledWith('UDID-1');
      expect(result).toEqual({ port: 0, pid: 0 });
    });

    it('handles already-booted case', async () => {
      mockStartDevice.mockResolvedValue({
        id: 'UDID-1',
        status: 'ready',
      });

      const result = await driver.boot('UDID-1');
      expect(result).toEqual({ port: 0, pid: 0 });
    });
  });

  describe('shutdown()', () => {
    it('calls IOSSimulatorManager.stopDevice()', async () => {
      mockStopDevice.mockResolvedValue(undefined);

      await driver.shutdown('UDID-1');

      expect(mockStopDevice).toHaveBeenCalledWith('UDID-1');
    });

    it('handles already-stopped case gracefully', async () => {
      mockStopDevice.mockRejectedValue(new Error('current state: Shutdown'));

      await expect(driver.shutdown('UDID-1')).resolves.not.toThrow();
    });
  });

  describe('isHealthy()', () => {
    it('calls IOSSimulatorManager.getDevice() and checks status === ready', async () => {
      mockGetDevice.mockReturnValue({
        id: 'UDID-1',
        status: 'ready',
      });

      const result = await driver.isHealthy('UDID-1');

      expect(mockGetDevice).toHaveBeenCalledWith('UDID-1');
      expect(result).toBe(true);
    });

    it('returns false when device not found', async () => {
      mockGetDevice.mockReturnValue(undefined);

      const result = await driver.isHealthy('UDID-UNKNOWN');
      expect(result).toBe(false);
    });

    it('returns false when device status is not ready', async () => {
      mockGetDevice.mockReturnValue({
        id: 'UDID-1',
        status: 'stopped',
      });

      const result = await driver.isHealthy('UDID-1');
      expect(result).toBe(false);
    });
  });

  describe('cleanup()', () => {
    it('calls stopDevice then xcrun simctl erase (NOT deleteDevice)', async () => {
      mockStopDevice.mockResolvedValue(undefined);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb?: Function) => {
        if (cb) cb(null, { stdout: '', stderr: '' });
        return { on: vi.fn() };
      });

      await driver.cleanup('UDID-1');

      expect(mockStopDevice).toHaveBeenCalledWith('UDID-1');
      expect(mockExecFile).toHaveBeenCalledWith(
        'xcrun',
        ['simctl', 'erase', 'UDID-1'],
        expect.any(Function),
      );
      expect(mockDeleteDevice).not.toHaveBeenCalled();
    });
  });
});
