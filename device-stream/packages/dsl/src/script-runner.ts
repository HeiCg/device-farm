/**
 * Shared runtime for executing an agent- or hook-authored TypeScript snippet
 * against a live `@device-stream/dsl` session.
 *
 * The snippet is wrapped with a generated prelude that:
 *   1. Creates a `@device-stream/dsl` session from the supplied `SessionOptions`.
 *   2. Exposes `ctx` (arbitrary context object) and `vars` (key/value bag).
 *   3. Destructures each top-level var whose name is a valid JS identifier so
 *      the snippet can write `${username}` instead of `${vars.username}`.
 *   4. Closes the session in a `finally` block.
 *
 * The generated file is `.mts` so `tsx` treats it as ESM and top-level await in
 * the snippet works naturally.
 *
 * This module is deliberately I/O-shaped like `execFile`: on a non-zero child
 * exit it REJECTS with an Error carrying `.stdout` / `.stderr` / `.killed` /
 * `.code`. Callers layer their own output caps / error rendering on top — the
 * lifecycle hook runner keeps raw behavior; the MCP tool caps.
 *
 * Robustness (ported from the argent run-script hardening):
 *   - Manual `spawn` wrapper: on the deadline we send SIGTERM, escalate to
 *     SIGKILL after a grace window, and SETTLE the promise at the deadline
 *     regardless of whether `close` ever fires — a snippet that ignores
 *     SIGTERM can no longer hang the caller (and its per-device mutex).
 *   - Process-group kill (`detached: true` + `process.kill(-pid, sig)`) so
 *     adb/xcrun grandchildren die with the script and release the stdio pipe.
 *   - Curated child env (no raw `process.env` spread) so `DEVICE_FARM_TOKEN`,
 *     `GITHUB_TOKEN`, DB URLs, etc. don't leak into the script or its shell-outs.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import type { SessionOptions } from './types';

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/** Grace between SIGTERM and SIGKILL after the deadline fires. */
const KILL_GRACE_MS = 5_000;

/** Combined stdout+stderr cap (matches the previous execFile maxBuffer). */
const MAX_BUFFER = 16 * 1024 * 1024;

/** Sweep `.df-hook-tmp/run-*` dirs older than this on first run. */
const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Names/prefixes that would collide with the prelude's own bindings (`ds`,
 * `ctx`, `vars`) or silently shadow standard globals. Rejected up front with a
 * clear error rather than producing a confusing redeclaration SyntaxError.
 */
const RESERVED_VAR_KEYS = new Set(['ds', 'ctx', 'vars', 'console', 'process', 'require']);

/**
 * Curated child-env allowlist. The child (and every adb/xcrun/go-ios
 * grandchild it spawns) inherits ONLY these — never a raw `process.env` spread.
 */
const ENV_PASSTHROUGH_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'NODE_OPTIONS',
  // Set by the shell hook executor for `jq`-style consumers; harmless here.
  'DEVICE_FARM_VARS_JSON',
];
const ENV_PASSTHROUGH_PREFIXES = ['ANDROID_', 'JAVA_', 'XDG_', 'DEVICE_FARM_VAR_'];

export interface RunScriptOptions {
  /** TypeScript body executed with `ds`, `ctx`, `vars` (+ destructured idents) in scope. */
  script: string;
  /** How the child builds its `ds` session — same device the caller is driving. */
  session: SessionOptions;
  /** Exposed as `vars` in scope; valid-identifier keys are also destructured. */
  vars?: Record<string, unknown>;
  /** Exposed as `ctx` in scope. */
  ctx?: Record<string, unknown>;
  /** Kill the child after this many ms. */
  timeoutMs: number;
  /** Project root that owns `node_modules/.bin/tsx` + the `.df-hook-tmp` scratch dir. */
  cwd?: string;
  /**
   * Explicit escape hatch merged last onto the curated child env — lets callers
   * opt specific vars in without reopening the full-`process.env` firehose.
   */
  extraEnv?: Record<string, string>;
}

export interface RunScriptResult {
  stdout: string;
  stderr: string;
}

/** Shape of the Error a failed run rejects with (execFile-compatible). */
interface ScriptExecError extends Error {
  stdout: string;
  stderr: string;
  killed: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Resolve the tsx executable bundled in the project's node_modules.
 * Falls back to `npx tsx` if the binary is missing.
 */
async function resolveTsxBinary(projectRoot: string): Promise<{ cmd: string; args: string[] }> {
  const local = join(projectRoot, 'node_modules', '.bin', 'tsx');
  try {
    await access(local, fsConstants.X_OK);
    return { cmd: local, args: [] };
  } catch {
    return { cmd: 'npx', args: ['--yes', 'tsx'] };
  }
}

/** Build the child env from a curated base — never a raw `process.env` spread. */
function buildChildEnv(
  session: SessionOptions,
  ctx: Record<string, unknown>,
  vars: Record<string, unknown>,
  extraEnv?: Record<string, string>,
): Record<string, string> {
  const src = process.env;
  const env: Record<string, string> = {};

  for (const name of ENV_PASSTHROUGH_NAMES) {
    const v = src[name];
    if (v !== undefined) env[name] = v;
  }
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (ENV_PASSTHROUGH_PREFIXES.some((p) => k.startsWith(p))) env[k] = v;
  }

  env.DS_SCRIPT_CTX = JSON.stringify(ctx);
  env.DS_SCRIPT_VARS = JSON.stringify(vars);
  env.DS_SCRIPT_SESSION = JSON.stringify(session);

  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) env[k] = v;
  }
  return env;
}

/** Signal the child's process group, falling back to the child alone on throw. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

let sweepStarted = false;

/**
 * Best-effort, once-per-process sweep of leftover `run-*` scratch dirs older
 * than 24h (hard kills can leave these behind). Lazy, non-blocking, silent.
 */
function sweepStaleTmp(baseDir: string): void {
  if (sweepStarted) return;
  sweepStarted = true;
  void (async () => {
    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      const cutoff = Date.now() - SWEEP_MAX_AGE_MS;
      await Promise.all(
        entries.map(async (e) => {
          if (!e.isDirectory() || !e.name.startsWith('run-')) return;
          const p = join(baseDir, e.name);
          try {
            const st = await stat(p);
            if (st.mtimeMs < cutoff) await rm(p, { recursive: true, force: true });
          } catch {
            /* ignore per-entry */
          }
        }),
      );
    } catch {
      /* ignore — sweep is best-effort */
    }
  })();
}

function buildPrelude(script: string, vars: Record<string, unknown>): string {
  const validIdents = Object.keys(vars).filter((k) => IDENT_RE.test(k));
  const destructure = validIdents.length > 0
    ? `const { ${validIdents.join(', ')} } = vars as Record<string, any>;`
    : '';

  return [
    `import { createSession } from '@device-stream/dsl';`,
    ``,
    `const ctx = JSON.parse(process.env.DS_SCRIPT_CTX ?? '{}');`,
    `const vars = JSON.parse(process.env.DS_SCRIPT_VARS ?? '{}');`,
    `const __session = JSON.parse(process.env.DS_SCRIPT_SESSION ?? '{}');`,
    destructure,
    ``,
    `const ds = await createSession(__session);`,
    ``,
    `try {`,
    script,
    `} finally {`,
    `  await ds.close();`,
    `}`,
  ].join('\n');
}

export async function runScript(opts: RunScriptOptions): Promise<RunScriptResult> {
  const vars = opts.vars ?? {};
  const ctx = opts.ctx ?? {};

  const reserved = Object.keys(vars).filter((k) => RESERVED_VAR_KEYS.has(k));
  if (reserved.length > 0) {
    throw new Error(
      `reserved vars key(s): ${reserved.join(', ')} — ` +
        `these names collide with script-scope bindings (${[...RESERVED_VAR_KEYS].join(', ')}); rename them`,
    );
  }

  const wrapped = buildPrelude(opts.script, vars);

  const projectRoot = opts.cwd ?? process.cwd();
  const baseDir = join(projectRoot, '.df-hook-tmp');
  await mkdir(baseDir, { recursive: true });
  sweepStaleTmp(baseDir);
  const dir = await mkdtemp(join(baseDir, 'run-'));
  const file = join(dir, 'hook.mts');
  await writeFile(file, wrapped, 'utf8');

  const { cmd, args } = await resolveTsxBinary(projectRoot);
  const env = buildChildEnv(opts.session, ctx, vars, opts.extraEnv);

  try {
    return await new Promise<RunScriptResult>((resolvePromise, rejectPromise) => {
      const child = spawn(cmd, [...args, file], {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      let stdout = '';
      let stderr = '';
      let total = 0;
      let settled = false;
      let timedOut = false;
      let overflowed = false;
      let killTimer: NodeJS.Timeout | undefined;

      const clearKillTimer = () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = undefined;
        }
      };

      const escalateKill = () => {
        const pid = child.pid;
        if (pid == null) return;
        killGroup(pid, 'SIGTERM');
        killTimer = setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS);
        killTimer.unref?.();
      };

      const makeError = (message: string, extra: Partial<ScriptExecError>): ScriptExecError => {
        const e = new Error(message) as ScriptExecError;
        e.stdout = stdout;
        e.stderr = stderr;
        e.killed = extra.killed ?? false;
        e.code = extra.code ?? null;
        e.signal = extra.signal ?? null;
        return e;
      };

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearKillTimer();
        resolvePromise({ stdout, stderr });
      };
      const settleReject = (err: ScriptExecError) => {
        if (settled) return;
        settled = true;
        rejectPromise(err);
      };

      const deadline = setTimeout(() => {
        timedOut = true;
        escalateKill();
        // Settle at the deadline regardless of whether `close` fires — a
        // SIGTERM-ignoring child must not hold the caller hostage.
        settleReject(
          makeError(
            `script timed out after ${opts.timeoutMs}ms and was killed`,
            { killed: true, signal: 'SIGTERM' },
          ),
        );
      }, opts.timeoutMs);
      deadline.unref?.();

      const collect = (isErr: boolean) => (chunk: Buffer | string) => {
        const s = chunk.toString();
        total += s.length;
        if (total > MAX_BUFFER) {
          if (!overflowed) {
            overflowed = true;
            escalateKill();
            settleReject(makeError('stdout/stderr maxBuffer exceeded', { killed: true }));
          }
          return;
        }
        if (isErr) stderr += s;
        else stdout += s;
      };

      child.stdout?.on('data', collect(false));
      child.stderr?.on('data', collect(true));

      child.on('error', (err) => {
        clearTimeout(deadline);
        settleReject(makeError(err.message, {}));
      });

      child.on('close', (code, signal) => {
        clearTimeout(deadline);
        if (settled) return;
        if (timedOut || overflowed) return; // already rejected at deadline/overflow
        if (code === 0) {
          settleResolve();
        } else {
          settleReject(
            makeError(
              `script exited with ${code != null ? `code ${code}` : `signal ${signal}`}`,
              { code: code ?? null, signal: signal ?? null },
            ),
          );
        }
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
