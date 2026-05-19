/**
 * Runs a `kind: 'script'` hook by wrapping the user's TypeScript snippet
 * with a generated prelude that:
 *   1. Creates a `@device-stream/dsl` session bound to the hook's target device.
 *   2. Exposes the hook context (`ctx`) and user-supplied vars (`vars`).
 *   3. Destructures each top-level var whose name is a valid JS identifier
 *      so the user can write `${username}` instead of `${vars.username}`.
 *   4. Closes the session in a `finally` block.
 *
 * The generated file is `.mts` so `tsx` treats it as ESM and top-level await
 * in the user's snippet works naturally.
 *
 * Returned shape mirrors what `execFile` produces, so the existing
 * `executeOne` happy/error paths in HookExecutor can consume it unchanged.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import type { HookContext } from './hook-executor.js';

const execFileAsync = promisify(execFile);

/**
 * Resolve the tsx executable bundled in the project's node_modules.
 * Falls back to `npx tsx` if the binary is missing — useful in dev shells but
 * adds network/npm overhead, so we prefer the direct path when available.
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

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

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
  const vars = opts.vars ?? {};
  const validIdents = Object.keys(vars).filter((k) => IDENT_RE.test(k));
  const destructure = validIdents.length > 0
    ? `const { ${validIdents.join(', ')} } = vars as Record<string, any>;`
    : '';

  const iosKindLine = opts.iosKind
    ? `, iosKind: ${JSON.stringify(opts.iosKind)}`
    : '';

  const wrapped = [
    `import { createSession } from '@device-stream/dsl';`,
    ``,
    `const ctx = JSON.parse(process.env.DEVICE_FARM_HOOK_CTX ?? '{}');`,
    `const vars = JSON.parse(process.env.DEVICE_FARM_HOOK_VARS ?? '{}');`,
    destructure,
    ``,
    `const ds = await createSession({`,
    `  serial: ctx.serial,`,
    `  platform: ctx.platform${iosKindLine},`,
    `});`,
    ``,
    `try {`,
    opts.script,
    `} finally {`,
    `  await ds.close();`,
    `}`,
  ].join('\n');

  const projectRoot = opts.cwd ?? process.cwd();
  const baseDir = join(projectRoot, '.df-hook-tmp');
  await mkdir(baseDir, { recursive: true });
  const dir = await mkdtemp(join(baseDir, 'run-'));
  const file = join(dir, 'hook.mts');
  await writeFile(file, wrapped, 'utf8');

  const { cmd, args } = await resolveTsxBinary(projectRoot);

  try {
    const { stdout, stderr } = await execFileAsync(
      cmd, [...args, file],
      {
        timeout: opts.timeoutMs,
        cwd: projectRoot,
        env: {
          ...process.env as Record<string, string>,
          DEVICE_FARM_HOOK_CTX: JSON.stringify(opts.context),
          DEVICE_FARM_HOOK_VARS: JSON.stringify(vars),
        },
      },
    );
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
