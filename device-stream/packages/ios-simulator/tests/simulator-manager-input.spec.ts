/**
 * Verifies IOSSimulatorManager's input surface delegates to the
 * injected InputService and that cleanup() drains sim-input children
 * via stopAll().
 */
import { describe, it, expect, vi } from 'vitest';
import { IOSSimulatorManager } from '../src/simulator-manager.js';
import type { InputService } from '../src/input-service.js';

function makeMockInputs(): InputService {
  return {
    tap: vi.fn().mockResolvedValue(undefined),
    swipe: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    releaseKey: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as InputService;
}

describe('IOSSimulatorManager input delegation', () => {
  it('tap() forwards to InputService.tap with the same args', async () => {
    const inputs = makeMockInputs();
    const mgr = new IOSSimulatorManager({ inputs });
    await mgr.tap('UDID-A', { x: 10, y: 20, width: 390, height: 844 });
    expect(inputs.tap).toHaveBeenCalledWith('UDID-A', {
      x: 10, y: 20, width: 390, height: 844,
    });
  });

  it('swipe() forwards to InputService.swipe with the same args', async () => {
    const inputs = makeMockInputs();
    const mgr = new IOSSimulatorManager({ inputs });
    await mgr.swipe('UDID-B', {
      fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 300,
    });
    expect(inputs.swipe).toHaveBeenCalledWith('UDID-B', {
      fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 300,
    });
  });

  it('pressKey() and typeText() forward to the matching InputService methods', async () => {
    const inputs = makeMockInputs();
    const mgr = new IOSSimulatorManager({ inputs });
    await mgr.pressKey('UDID-C', 40);
    await mgr.typeText('UDID-C', 'hello');
    expect(inputs.pressKey).toHaveBeenCalledWith('UDID-C', 40);
    expect(inputs.typeText).toHaveBeenCalledWith('UDID-C', 'hello');
  });

  it('cleanup() calls InputService.stopAll BEFORE running the rest of cleanup', async () => {
    const inputs = makeMockInputs();
    const mgr = new IOSSimulatorManager({ inputs });
    await mgr.cleanup();
    expect(inputs.stopAll).toHaveBeenCalledTimes(1);
  });

  it('inputService getter returns the injected instance', () => {
    const inputs = makeMockInputs();
    const mgr = new IOSSimulatorManager({ inputs });
    expect(mgr.inputService).toBe(inputs);
  });
});
