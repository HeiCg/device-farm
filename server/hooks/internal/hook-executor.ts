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
}

export interface HookResult {
  hookName: string;
  event: HookEvent;
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
   * Execute a single hook command.
   */
  private async executeOne(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    const command = this.interpolate(hook.command, context);
    const timeout = hook.timeoutMs || DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    this.logger.debug({ hookName: hook.name, command, timeout }, 'Running hook');

    try {
      // Split command into shell execution via /bin/sh -c
      const { stdout, stderr } = await execFileAsync(
        '/bin/sh', ['-c', command],
        { timeout, env: this.buildEnv(context) },
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
        stdout: stdout.substring(0, 10_000), // Cap output
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
   */
  private buildEnv(context: HookContext): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      DEVICE_FARM_DEVICE_ID: context.deviceId,
      DEVICE_FARM_EMULATOR_ID: context.emulatorId,
      DEVICE_FARM_SERIAL: context.serial,
      DEVICE_FARM_PLATFORM: context.platform,
      DEVICE_FARM_PORT: String(context.port ?? ''),
      DEVICE_FARM_JOB_ID: context.jobId ?? '',
    };
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
