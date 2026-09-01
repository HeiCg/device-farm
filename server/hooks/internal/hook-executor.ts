/**
 * HookExecutor — runs user-defined shell commands at lifecycle points.
 *
 * Hook events:
 *  - device.booted:    Fires after a device finishes booting and becomes Idle
 *  - device.shutdown:  Fires before a device is shut down
 *  - test.before:      Fires after device allocation, before Maestro starts
 *  - test.after:       Fires after Maestro exits, before device cleanup
 *
 * Commands can use template variables:
 *  {{device_id}}       — internal device UUID
 *  {{emulator_id}}     — AVD name or iOS UDID
 *  {{serial}}          — ADB serial (e.g. emulator-5554) or UDID for iOS
 *  {{platform}}        — "android" or "ios"
 *  {{port}}            — emulator console port (Android only)
 *  {{job_id}}          — job UUID (test hooks only)
 *
 * Commands run with a timeout. Failures are logged but never block the pipeline
 * (unless failOnError is true for that hook).
 *
 * Phase 16 / Plan 16-02 — moved under server/hooks/internal/ as part of the
 * MOD-02 barrel refactor. The root `server/hooks/hook-executor.ts` becomes a
 * back-compat re-export so existing imports keep resolving.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { Platform } from '../../types/index.js';
import type { HookEvent, HookDefinition } from '../schemas.js';

// Phase 16 / Plan 16-00: HookEvent + HookDefinition moved to server/hooks/schemas.ts
// (single Zod source-of-truth via z.infer). Re-exported here for back-compat with
// existing consumers that import them from './hook-executor.js'.
export type { HookEvent, HookDefinition };

const execFileAsync = promisify(execFile);

export interface HookContext {
  deviceId: string;
  emulatorId: string;
  serial: string;
  platform: Platform;
  port: number | null;
  jobId?: string;
  /**
   * Per-invocation key/value bag from the trigger source (e.g. a parsed Azure DevOps
   * `device-script` block, a job submission, or a manual `/api/hooks/:name/test` call).
   * For `kind: 'script'` hooks these are merged on top of the hook definition's own
   * `vars` (context wins). For `kind: 'shell'` hooks they are exposed as
   * `DEVICE_FARM_VAR_<KEY>` env vars when the key is a valid identifier.
   */
  vars?: Record<string, unknown>;
}

export interface HookResult {
  hookName: string;
  event: HookEvent;
  /** For shell hooks: the interpolated shell command. For script hooks: a short tag like `script:<name>`. */
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class HookExecutor {
  private readonly logger: pino.Logger;
  private hooks: HookDefinition[] = [];

  constructor(logger: pino.Logger) {
    this.logger = logger.child({ component: 'hook-executor' });
  }

  /**
   * Register hooks from config or API.
   */
  setHooks(hooks: HookDefinition[]): void {
    this.hooks = hooks;
    this.logger.info({ count: hooks.length }, 'Hooks registered');
  }

  /**
   * Add a single hook.
   */
  addHook(hook: HookDefinition): void {
    this.hooks.push(hook);
    this.logger.info({ name: hook.name, event: hook.event }, 'Hook added');
  }

  /**
   * Remove a hook by name.
   */
  removeHook(name: string): boolean {
    const idx = this.hooks.findIndex(h => h.name === name);
    if (idx === -1) return false;
    this.hooks.splice(idx, 1);
    this.logger.info({ name }, 'Hook removed');
    return true;
  }

  /**
   * Get all registered hooks.
   */
  getHooks(): HookDefinition[] {
    return [...this.hooks];
  }

  /**
   * Get hooks for a specific event.
   */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    return this.hooks.filter(h => h.event === event && h.enabled);
  }

  /**
   * Execute all hooks for a given event. Runs sequentially in registration order.
   * Returns results for each hook.
   *
   * @throws If any hook with failOnError=true fails
   */
  async execute(event: HookEvent, context: HookContext): Promise<HookResult[]> {
    const applicable = this.hooks.filter(h =>
      h.event === event &&
      h.enabled &&
      (h.platform === 'all' || h.platform === context.platform),
    );

    if (applicable.length === 0) return [];

    this.logger.info(
      { event, deviceId: context.deviceId, hookCount: applicable.length },
      'Executing hooks',
    );

    const results: HookResult[] = [];

    for (const hook of applicable) {
      const result = await this.executeOne(hook, context);
      results.push(result);

      if (!result.success && hook.failOnError) {
        this.logger.error(
          { hookName: hook.name, event, error: result.error },
          'Hook failed with failOnError=true — aborting',
        );
        throw new HookError(hook.name, event, result.error ?? 'Hook command failed');
      }
    }

    return results;
  }

  /**
   * Execute a single hook (shell command or DSL script).
   */
  private async executeOne(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    const timeout = hook.timeoutMs || DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    if (hook.kind === 'script') {
      return this.executeScript(hook, context, timeout, start);
    }

    const command = this.interpolate(hook.command ?? '', context);

    this.logger.debug({ hookName: hook.name, command, timeout }, 'Running hook');

    try {
      const { stdout, stderr } = await execFileAsync(
        '/bin/sh', ['-c', command],
        { timeout, env: this.buildEnv(context), maxBuffer: 16 * 1024 * 1024 },
      );

      const durationMs = Date.now() - start;

      this.logger.info(
        { hookName: hook.name, durationMs, exitCode: 0 },
        'Hook completed successfully',
      );

      return {
        hookName: hook.name,
        event: hook.event,
        command,
        exitCode: 0,
        stdout: stdout.substring(0, 10_000),
        stderr: stderr.substring(0, 10_000),
        durationMs,
        success: true,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const exitCode = err.code ?? null;

      this.logger.warn(
        { hookName: hook.name, durationMs, exitCode, error: err.message },
        'Hook failed',
      );

      return {
        hookName: hook.name,
        event: hook.event,
        command,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        stdout: (err.stdout ?? '').substring(0, 10_000),
        stderr: (err.stderr ?? err.message ?? '').substring(0, 10_000),
        durationMs,
        success: false,
        error: err.message,
      };
    }
  }

  private async executeScript(
    hook: HookDefinition,
    context: HookContext,
    timeout: number,
    start: number,
  ): Promise<HookResult> {
    const tag = `script:${hook.name}`;
    this.logger.debug({ hookName: hook.name, timeout }, 'Running DSL script hook');

    try {
      const { runScriptHook } = await import('./script-runner.js');
      const mergedVars = { ...(hook.vars ?? {}), ...(context.vars ?? {}) };
      const { stdout, stderr } = await runScriptHook({
        script: hook.script ?? '',
        vars: mergedVars,
        iosKind: hook.iosKind,
        context,
        timeoutMs: timeout,
      });
      const durationMs = Date.now() - start;

      this.logger.info(
        { hookName: hook.name, durationMs, exitCode: 0 },
        'Script hook completed successfully',
      );

      return {
        hookName: hook.name,
        event: hook.event,
        command: tag,
        exitCode: 0,
        stdout: stdout.substring(0, 10_000),
        stderr: stderr.substring(0, 10_000),
        durationMs,
        success: true,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const exitCode = err.code ?? null;

      this.logger.warn(
        { hookName: hook.name, durationMs, exitCode, error: err.message },
        'Script hook failed',
      );

      return {
        hookName: hook.name,
        event: hook.event,
        command: tag,
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        stdout: (err.stdout ?? '').substring(0, 10_000),
        stderr: (err.stderr ?? err.message ?? '').substring(0, 10_000),
        durationMs,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Replace {{variable}} placeholders in a command string.
   */
  private interpolate(command: string, context: HookContext): string {
    return command
      .replace(/\{\{device_id\}\}/g, context.deviceId)
      .replace(/\{\{emulator_id\}\}/g, context.emulatorId)
      .replace(/\{\{serial\}\}/g, context.serial)
      .replace(/\{\{platform\}\}/g, context.platform)
      .replace(/\{\{port\}\}/g, String(context.port ?? ''))
      .replace(/\{\{job_id\}\}/g, context.jobId ?? '');
  }

  /**
   * Build environment variables for hook subprocess.
   * Provides all context values as DEVICE_FARM_* env vars.
   *
   * Per-invocation `vars` are exposed as `DEVICE_FARM_VAR_<KEY>` for any key
   * whose name is a valid identifier (matches /^[A-Z][A-Z0-9_]*$/i after
   * upper-casing). Non-identifier keys are skipped so the env var name stays
   * shell-safe. The full vars bag is also serialised into
   * `DEVICE_FARM_VARS_JSON` for shell hooks that want to `jq` the lot.
   */
  private buildEnv(context: HookContext): Record<string, string> {
    const base: Record<string, string> = {
      ...process.env as Record<string, string>,
      DEVICE_FARM_DEVICE_ID: context.deviceId,
      DEVICE_FARM_EMULATOR_ID: context.emulatorId,
      DEVICE_FARM_SERIAL: context.serial,
      DEVICE_FARM_PLATFORM: context.platform,
      DEVICE_FARM_PORT: String(context.port ?? ''),
      DEVICE_FARM_JOB_ID: context.jobId ?? '',
    };
    if (context.vars) {
      base.DEVICE_FARM_VARS_JSON = JSON.stringify(context.vars);
      for (const [k, v] of Object.entries(context.vars)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          base[`DEVICE_FARM_VAR_${k.toUpperCase()}`] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      }
    }
    return base;
  }
}

export class HookError extends Error {
  readonly hookName: string;
  readonly event: HookEvent;

  constructor(hookName: string, event: HookEvent, message: string) {
    super(`Hook "${hookName}" failed on ${event}: ${message}`);
    this.name = 'HookError';
    this.hookName = hookName;
    this.event = event;
  }
}
