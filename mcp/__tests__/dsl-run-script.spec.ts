/**
 * `dsl_run_script` tool spec — exercises the real shared `runScript` runtime
 * (spawns tsx child processes), so assertions target the caps and rendering
 * contract, not exact error wording (WS1 is reshaping error messages in
 * parallel).
 *
 * Scripts here only `console.log` / throw / sleep — they never touch the fake
 * device, so the lazily-created `@device-stream/dsl` session never connects.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { SessionOptions } from '@device-stream/dsl';
import {
  executeScript,
  renderScriptError,
  capTail,
  SCRIPT_TOOL_NAME,
  scriptToolDescription,
} from '../src/dsl/script-tool.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSION: SessionOptions = { serial: 'test-serial', platform: 'android' };

function run(script: string, timeoutMs?: number) {
  return executeScript({ script, timeoutMs }, SESSION, REPO_ROOT);
}

describe('scriptToolDescription', () => {
  it('is lean (≤600 chars) and states it runs local code', () => {
    expect(scriptToolDescription.length).toBeLessThanOrEqual(600);
    expect(scriptToolDescription.toLowerCase()).toContain('local code');
  });
});

describe('capTail', () => {
  it('keeps the tail with a truncation marker when over the cap', () => {
    const s = 'x'.repeat(5000);
    const out = capTail(s, 4000);
    expect(out.length).toBeLessThanOrEqual(4000 + 40);
    expect(out).toContain('truncated, 5000 chars total');
    expect(out.endsWith('x'.repeat(10))).toBe(true);
  });

  it('passes short strings through untouched', () => {
    expect(capTail('hello', 4000)).toBe('hello');
  });
});

describe('renderScriptError', () => {
  it('rewrites temp .mts paths to <script> and keeps ≤3 frames', () => {
    const stderr = [
      '/repo/.df-hook-tmp/run-abc123/hook.mts:3',
      "        throw new Error('boom');",
      '              ^',
      '',
      'Error: boom',
      '    at file:///repo/.df-hook-tmp/run-abc123/hook.mts:3:15',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:222:25)',
      '    at async onImport (node:internal/modules/run_main:123:1)',
      '    at async somethingElse (node:internal/x:1:1)',
    ].join('\n');
    const out = renderScriptError(stderr);
    expect(out).not.toContain('.df-hook-tmp');
    expect(out).toContain('boom');
    expect((out.match(/^\s*at\s/gm) ?? []).length).toBeLessThanOrEqual(3);
  });
});

describe('dsl_run_script execution', () => {
  it('happy path: a multi-step script returns ok + stdout', async () => {
    const res = await run(`
      console.log('step-1');
      console.log('serial=' + ds.serial);
      console.log('step-3');
    `);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text ?? '';
    expect(text).toContain('ok');
    expect(text).toContain('step-1');
    expect(text).toContain('serial=test-serial');
    expect(text).toContain('step-3');
  }, 90_000);

  it('throw inside script: capped error, no temp path leaked, ≤3 frames', async () => {
    const res = await run(`throw new Error('kaboom-from-script');`);
    expect(res.isError).toBe(true);
    const text = res.content[0].text ?? '';
    expect(text).toContain('kaboom-from-script');
    expect(text).not.toContain('.df-hook-tmp');
    expect(text.length).toBeLessThanOrEqual(4000 + 40);
    expect((text.match(/^\s*at\s/gm) ?? []).length).toBeLessThanOrEqual(3);
  }, 90_000);

  it('stdout flood is capped to ~4.2 KB', async () => {
    const res = await run(`
      const line = 'y'.repeat(100);
      for (let i = 0; i < 1000; i++) console.log(line);
    `);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text ?? '';
    expect(text.length).toBeLessThanOrEqual(4200);
    expect(text).toContain('truncated');
  }, 90_000);

  it('timeout kills the child and reports it', async () => {
    const res = await run(`await new Promise((r) => setTimeout(r, 60000));`, 800);
    expect(res.isError).toBe(true);
    const text = res.content[0].text ?? '';
    expect(text).toContain(SCRIPT_TOOL_NAME);
    expect(text.toLowerCase()).toContain('timed out');
  }, 90_000);

  it('timeout result includes the log tail printed before the hang', async () => {
    const res = await run(
      `console.log('MARKER-before-hang'); await new Promise((r) => setTimeout(r, 60000));`,
      1500,
    );
    expect(res.isError).toBe(true);
    const text = res.content[0].text ?? '';
    expect(text.toLowerCase()).toContain('timed out');
    expect(text).toContain('MARKER-before-hang');
  }, 90_000);

  it('rejects an empty script without spawning', async () => {
    const res = await executeScript({ script: '   ' }, SESSION, REPO_ROOT);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('non-empty');
  });
});
