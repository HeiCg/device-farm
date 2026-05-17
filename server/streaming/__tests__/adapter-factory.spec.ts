import { describe, it, expect, vi } from 'vitest';
import { createAdapterFactory } from '../internal/adapters/index.js';
import { AndroidPreviewAdapter } from '../internal/adapters/android-preview-adapter.js';
import { IosPreviewAdapter } from '../internal/adapters/ios-preview-adapter.js';

describe('createAdapterFactory', () => {
  const mockScrcpy = {} as any;
  const mockCapture = {} as any;

  it('returns a function', () => {
    const factory = createAdapterFactory(mockScrcpy, mockCapture);
    expect(typeof factory).toBe('function');
  });

  it('factory with platform=android returns AndroidPreviewAdapter', () => {
    const factory = createAdapterFactory(mockScrcpy, mockCapture);
    const adapter = factory('emulator-5554', 'android');
    expect(adapter).toBeInstanceOf(AndroidPreviewAdapter);
  });

  it('factory with platform=ios returns IosPreviewAdapter', () => {
    const factory = createAdapterFactory(mockScrcpy, mockCapture);
    const adapter = factory('ABCD-1234', 'ios');
    expect(adapter).toBeInstanceOf(IosPreviewAdapter);
  });
});
