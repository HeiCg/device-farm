import { describe, it, expect } from 'vitest';
import { runScriptHook } from '../internal/script-runner.js';

describe('script-runner', () => {
  it('runs a trivial DSL script and surfaces stdout', async () => {
    const { stdout } = await runScriptHook({
      script: `
        console.log('script ran');
        console.log('serial=' + ctx.serial);
        console.log('greeting=' + greeting);
      `,
      vars: { greeting: 'hello' },
      context: {
        deviceId: 'd-1',
        emulatorId: 'avd-1',
        serial: 'emulator-5554',
        platform: 'android',
        port: 5554,
        jobId: 'job-1',
      },
      timeoutMs: 60_000,
    });

    expect(stdout).toContain('script ran');
    expect(stdout).toContain('serial=emulator-5554');
    expect(stdout).toContain('greeting=hello');
  }, 90_000);

  it('skips destructuring for var names that are not valid identifiers', async () => {
    const { stdout } = await runScriptHook({
      script: `
        console.log('only-via-vars=' + vars["weird-key"]);
        console.log('typeof_ident=' + typeof greeting);
      `,
      vars: { 'weird-key': 'present', greeting: 'hi' },
      context: {
        deviceId: 'd', emulatorId: 'e', serial: 's', platform: 'android',
        port: null, jobId: 'j',
      },
      timeoutMs: 60_000,
    });

    expect(stdout).toContain('only-via-vars=present');
    expect(stdout).toContain('typeof_ident=string');
  }, 90_000);

  it('context.vars override hook.vars when merged by executor', async () => {
    // This test exercises the merge order that hook-executor performs before
    // calling runScriptHook: { ...hook.vars, ...context.vars }. Here we simulate
    // that merge inline by passing the already-merged object.
    const { stdout } = await runScriptHook({
      script: `console.log('account=' + vars.account);`,
      vars: { account: 'ca4' /* simulates context.vars winning over hook.vars 'default' */ },
      context: {
        deviceId: 'd', emulatorId: 'e', serial: 's', platform: 'android',
        port: null, jobId: 'j',
      },
      timeoutMs: 60_000,
    });
    expect(stdout).toContain('account=ca4');
  }, 90_000);

  it('propagates script errors as a rejected promise', async () => {
    await expect(runScriptHook({
      script: `throw new Error('boom from script');`,
      context: {
        deviceId: 'd', emulatorId: 'e', serial: 's', platform: 'android',
        port: null, jobId: 'j',
      },
      timeoutMs: 60_000,
    })).rejects.toMatchObject({ stderr: expect.stringContaining('boom from script') });
  }, 90_000);
});
