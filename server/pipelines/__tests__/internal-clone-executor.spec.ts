import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInternalCloneStage } from '../internal/internal-clone-executor.js';

const fakeLogger: any = { info: () => {}, error: () => {}, warn: () => {}, child: () => fakeLogger };

describe('internal-clone executor', () => {
  it('resolves account to password from config.js', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'icx-'));
    await writeFile(
      join(workDir, 'config.js'),
      `module.exports = { USERNAMES: { name_1: { password: 'secret123' } } };`,
    );

    const exported: Record<string, string> = {};
    const result = await runInternalCloneStage({
      workDir,
      account: 'name_1',
      onExport: (k, v) => { exported[k] = v; },
      logger: fakeLogger,
    });

    expect(result.ok).toBe(true);
    expect(exported.PASSWORD).toBe('secret123');
    expect(exported.WORKSPACE_DIR).toBe(workDir);
  });

  it('fails when account is missing from config.js', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'icx-'));
    await writeFile(
      join(workDir, 'config.js'),
      `module.exports = { USERNAMES: { other: { password: 'x' } } };`,
    );

    const result = await runInternalCloneStage({
      workDir,
      account: 'name_1',
      onExport: () => {},
      logger: fakeLogger,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown account.*name_1/i);
  });

  it('fails when config.js is missing', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'icx-'));
    const result = await runInternalCloneStage({
      workDir,
      account: 'name_1',
      onExport: () => {},
      logger: fakeLogger,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/config\.js/i);
  });

  it('fails when config.js does not export USERNAMES', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'icx-'));
    await writeFile(join(workDir, 'config.js'), `module.exports = { other: {} };`);
    const result = await runInternalCloneStage({
      workDir,
      account: 'name_1',
      onExport: () => {},
      logger: fakeLogger,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/USERNAMES/);
  });
});
