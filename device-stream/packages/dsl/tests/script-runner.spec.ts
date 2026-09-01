/**
 * `runScript` hardening spec — exercises the real shared runtime (spawns tsx
 * child processes), so assertions target the operational contract: a
 * SIGTERM-ignoring child still settles at the deadline, the child env is a
 * curated allowlist (no secret spread), and reserved `vars` keys are rejected
 * before anything spawns.
 *
 * Scripts here only `console.log` / hang — they never drive the device, so the
 * lazily-created `@device-stream/dsl` session never connects.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runScript } from '../src/script-runner';
import type { SessionOptions } from '../src/types';

// device-stream/packages/dsl/tests → up 4 → device-farm root (has
// node_modules/.bin/tsx and the @device-stream/dsl workspace symlink).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SESSION: SessionOptions = { serial: 'test-serial', platform: 'android' };

describe('runScript — SIGTERM→SIGKILL escalation', () => {
  it('settles (rejects, timedOut) for a SIGTERM-ignoring child within the deadline+grace', async () => {
    const start = Date.now();
    let err: any;
    try {
      await runScript({
        // setInterval keeps the event loop alive (so Node doesn't exit on an
        // unsettled top-level await); the SIGTERM handler ignores the polite
        // signal, forcing the SIGKILL escalation path.
        script: `process.on('SIGTERM', () => {}); setInterval(() => {}, 100000);`,
        session: SESSION,
        timeoutMs: 800,
        cwd: REPO_ROOT,
      });
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeDefined();
    expect(err.killed).toBe(true);
    // Settles at the deadline, not after cold-start + hang forever.
    expect(elapsed).toBeLessThan(800 + 5000 + 3000);
  }, 60_000);
});

describe('runScript — curated child env', () => {
  it('drops parent secrets but passes ANDROID_* through', async () => {
    const prevToken = process.env.DEVICE_FARM_TOKEN;
    const prevHome = process.env.ANDROID_HOME;
    process.env.DEVICE_FARM_TOKEN = 'supersecret-token';
    process.env.ANDROID_HOME = '/opt/android-sdk';
    try {
      const { stdout } = await runScript({
        script: [
          `console.log('TOKEN=' + process.env.DEVICE_FARM_TOKEN);`,
          `console.log('AH=' + process.env.ANDROID_HOME);`,
        ].join('\n'),
        session: SESSION,
        timeoutMs: 30_000,
        cwd: REPO_ROOT,
      });
      expect(stdout).toContain('TOKEN=undefined');
      expect(stdout).toContain('AH=/opt/android-sdk');
    } finally {
      if (prevToken === undefined) delete process.env.DEVICE_FARM_TOKEN;
      else process.env.DEVICE_FARM_TOKEN = prevToken;
      if (prevHome === undefined) delete process.env.ANDROID_HOME;
      else process.env.ANDROID_HOME = prevHome;
    }
  }, 60_000);

  it('honors extraEnv as an explicit opt-in', async () => {
    const { stdout } = await runScript({
      script: `console.log('OPT=' + process.env.MY_OPT_IN);`,
      session: SESSION,
      timeoutMs: 30_000,
      cwd: REPO_ROOT,
      extraEnv: { MY_OPT_IN: 'yes' },
    });
    expect(stdout).toContain('OPT=yes');
  }, 60_000);
});

describe('runScript — reserved vars keys', () => {
  it('rejects a `ds` vars key before spawning, listing the reserved names', async () => {
    await expect(
      runScript({
        script: `console.log('unreachable');`,
        session: SESSION,
        vars: { ds: 1 },
        timeoutMs: 30_000,
        cwd: REPO_ROOT,
      }),
    ).rejects.toThrow(/reserved vars key/i);
  });
});
