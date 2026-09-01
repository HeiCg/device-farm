/**
 * Runs a `kind: 'script'` hook by delegating to the shared `@device-stream/dsl`
 * script runtime (`runScript`), which wraps the user's TypeScript snippet with a
 * generated prelude that:
 *   1. Creates a `@device-stream/dsl` session bound to the hook's target device.
 *   2. Exposes the hook context (`ctx`) and user-supplied vars (`vars`).
 *   3. Destructures each top-level var whose name is a valid JS identifier
 *      so the user can write `${username}` instead of `${vars.username}`.
 *   4. Closes the session in a `finally` block.
 *
 * The MCP `dsl_run_script` tool reuses the same shared runtime, so the prelude
 * contract stays identical across hooks and agent-authored scripts.
 *
 * Returned shape mirrors what `execFile` produces (raw, uncapped), so the
 * existing `executeOne` happy/error paths in HookExecutor consume it unchanged.
 */
import { runScript } from '@device-stream/dsl';
import type { HookContext } from './hook-executor.js';

export interface ScriptHookRunOptions {
  script: string;
  vars?: Record<string, unknown>;
  iosKind?: 'simulator' | 'device';
  context: HookContext;
  timeoutMs: number;
  cwd?: string;
}

export interface ScriptHookRunResult {
  stdout: string;
  stderr: string;
}

export async function runScriptHook(opts: ScriptHookRunOptions): Promise<ScriptHookRunResult> {
  return runScript({
    script: opts.script,
    session: {
      serial: opts.context.serial,
      platform: opts.context.platform,
      iosKind: opts.iosKind,
    },
    vars: opts.vars ?? {},
    ctx: opts.context as unknown as Record<string, unknown>,
    timeoutMs: opts.timeoutMs,
    cwd: opts.cwd,
  });
}
