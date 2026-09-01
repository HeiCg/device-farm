import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import type pino from 'pino';

export interface InternalCloneStageOpts {
  workDir: string;
  account: string;
  onExport(key: string, value: string, opts?: { secret?: boolean }): void;
  logger: pino.Logger;
}

export interface InternalCloneStageResult {
  ok: boolean;
  error?: string;
}

export async function runInternalCloneStage(
  opts: InternalCloneStageOpts,
): Promise<InternalCloneStageResult> {
  const configPath = join(opts.workDir, 'config.js');

  try {
    await access(configPath);
  } catch {
    return { ok: false, error: `config.js not found at ${configPath}` };
  }

  const source = await readFile(configPath, 'utf8');

  let usernames: Record<string, { password: string }> | undefined;
  try {
    const sandbox: Record<string, unknown> = { module: { exports: {} }, exports: {} };
    const ctx = createContext(sandbox, {
      name: 'config.js',
      codeGeneration: { strings: false },
    });
    const script = new Script(source, { filename: configPath });
    script.runInContext(ctx, { timeout: 1000 });
    const mod = sandbox.module as { exports?: { USERNAMES?: Record<string, { password: string }> } };
    usernames = mod.exports?.USERNAMES;
  } catch (err) {
    return { ok: false, error: `failed to evaluate config.js: ${(err as Error).message}` };
  }

  if (!usernames || typeof usernames !== 'object') {
    return { ok: false, error: 'config.js does not export USERNAMES' };
  }

  const account = usernames[opts.account];
  if (!account?.password) {
    return { ok: false, error: `unknown account '${opts.account}' in config.js USERNAMES` };
  }

  opts.onExport('PASSWORD', account.password, { secret: true });
  opts.onExport('WORKSPACE_DIR', opts.workDir);
  opts.logger.info({ account: opts.account }, 'internal-clone: account resolved');
  return { ok: true };
}
