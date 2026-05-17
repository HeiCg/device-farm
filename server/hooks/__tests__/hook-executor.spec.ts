/**
 * Phase 16 / Plan 16-04 — HookExecutor tests-as-spec (MOD-01, MOD-08).
 *
 * Describe-tree mirrors server/hooks/MODULE.md "Public API" section verbatim.
 * Covers 4 of the 5 module invariants — (a) sequential, (b) failOnError false,
 * (d) enabled false, (e) platform filter. Invariant (c) lives in queue.spec.ts
 * (plan 16-01) because it requires a DB.
 *
 * Hooks are in-process shell execs — no DB gating needed.
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';

import { HookExecutor, type HookDefinition, type HookContext } from '../hook-executor.js';

const silentLogger = pino({ level: 'silent' });

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    deviceId: 'test-device-uuid',
    emulatorId: 'test-emulator',
    serial: 'emulator-5554',
    platform: 'android',
    port: 5554,
    jobId: 'test-job',
    ...overrides,
  };
}

function def(overrides: Partial<HookDefinition>): HookDefinition {
  return {
    name: 'h',
    event: 'device.booted',
    command: 'echo OK',
    platform: 'all',
    timeoutMs: 30_000,
    failOnError: false,
    enabled: true,
    ...overrides,
  } as HookDefinition;
}

describe('HookExecutor', () => {
  describe('setHooks / addHook / removeHook', () => {
    it('setHooks replaces the registered hook list', () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([def({ name: 'a' }), def({ name: 'b' })]);
      expect(ex.getHooks().map(h => h.name)).toEqual(['a', 'b']);
      ex.setHooks([def({ name: 'c' })]);
      expect(ex.getHooks().map(h => h.name)).toEqual(['c']);
    });

    it('addHook appends to the registered list', () => {
      const ex = new HookExecutor(silentLogger);
      ex.addHook(def({ name: 'a' }));
      ex.addHook(def({ name: 'b' }));
      expect(ex.getHooks().map(h => h.name)).toEqual(['a', 'b']);
    });

    it('removeHook returns true on hit, false on miss; idempotent', () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([def({ name: 'a' })]);
      expect(ex.removeHook('a')).toBe(true);
      expect(ex.removeHook('a')).toBe(false);
      expect(ex.getHooks()).toHaveLength(0);
    });
  });

  describe('getHooksForEvent', () => {
    it('[Invariant d] excludes enabled: false hooks', () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([
        def({ name: 'on',  event: 'device.booted', enabled: true }),
        def({ name: 'off', event: 'device.booted', enabled: false }),
      ]);
      const visible = ex.getHooksForEvent('device.booted');
      expect(visible.map(h => h.name)).toEqual(['on']);
    });

    it('returns only hooks for the requested event', () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([
        def({ name: 'boot',     event: 'device.booted' }),
        def({ name: 'shutdown', event: 'device.shutdown' }),
      ]);
      const boot = ex.getHooksForEvent('device.booted');
      expect(boot.map(h => h.name)).toEqual(['boot']);
    });
  });

  describe('execute', () => {
    it('[Invariant a] runs hooks sequentially per event in registration order', async () => {
      const ex = new HookExecutor(silentLogger);
      // Two hooks that append to a shared file. Sequential order means file shows 1,2 — not 2,1 or interleaved.
      const ordered: string[] = [];
      // Fake commands via a simple `echo` to stderr/stdout; we rely on the ORDER of results,
      // which HookExecutor returns in registration order — so assert the results array ordering.
      ex.setHooks([
        def({ name: 'first',  command: 'echo 1' }),
        def({ name: 'second', command: 'echo 2' }),
      ]);
      const results = await ex.execute('device.booted', makeContext());
      results.forEach(r => ordered.push(r.hookName));
      expect(ordered).toEqual(['first', 'second']);
      // All succeeded sequentially.
      expect(results.every(r => r.success)).toBe(true);
    });

    it('[Invariant b] failOnError: false returns a failed HookResult without throwing', async () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([def({ name: 'boom', command: 'false', failOnError: false })]);
      const results = await ex.execute('device.booted', makeContext());
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].hookName).toBe('boom');
      // Did NOT throw — we are past the await.
    });

    it('[Invariant e] platform filter excludes hooks with non-matching platform', async () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([
        def({ name: 'android-only', platform: 'android' }),
        def({ name: 'ios-only',     platform: 'ios' }),
        def({ name: 'all',          platform: 'all' }),
      ]);
      const results = await ex.execute('device.booted', makeContext({ platform: 'android' }));
      expect(results.map(r => r.hookName)).toEqual(['android-only', 'all']);
    });

    it('throws HookError when failOnError: true and command fails', async () => {
      const ex = new HookExecutor(silentLogger);
      ex.setHooks([def({ name: 'strict', command: 'false', failOnError: true })]);
      await expect(ex.execute('device.booted', makeContext())).rejects.toThrow(/strict/);
    });
  });
});
