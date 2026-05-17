/**
 * Verifies PR-bot context wiring through PipelineService.triggerRun.
 *
 * Covers final-review Critical fixes #2 and #3:
 *   #2 — PAT from server config.azure_devops.pat is threaded into gitService.clone
 *        as `patInline` (template-builder.ts intentionally omits pat_secret).
 *   #3 — `azurePrContext.account` (from the parsed device-script block) is
 *        threaded into the internal-clone executor as the USERNAMES lookup key.
 *
 * Strategy: in-process PipelineService with a fake DB, a stubbed GitService
 * (so we can assert what was passed to clone()), no real pool. We craft a
 * pipeline YAML that has a `source:` block (so the source clone runs) plus
 * an internal-clone stage backed by a temp config.js, then drive the run via
 * triggerRun with an azurePrContext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PipelineService } from '../internal/service.js';
import { PipelineBroadcaster } from '../internal/broadcaster.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function createMockDb(pipelineRow: any) {
  let nextRunRow: any = null;
  const inserts: any[] = [];
  const updates: any[] = [];
  return {
    insert: vi.fn().mockImplementation((_tbl: any) => ({
      values: vi.fn().mockImplementation((row: any) => {
        inserts.push(row);
        return {
          returning: vi.fn().mockImplementation(async () => {
            // First insert is pipelineRuns (has triggerType); subsequent are stage runs.
            if ('triggerType' in row) {
              nextRunRow = { id: `run-${Math.random().toString(36).slice(2, 8)}`, ...row };
              return [nextRunRow];
            }
            return [{ id: `stage-${Math.random().toString(36).slice(2, 8)}`, ...row }];
          }),
          // Some inserts (jobFiles / pipelineStageJobs) skip .returning() — provide a thenable.
          then: (cb: any) => Promise.resolve().then(cb),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((v: any) => ({
        where: vi.fn().mockImplementation(() => {
          updates.push(v);
          return Promise.resolve();
        }),
      })),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([pipelineRow]),
        orderBy: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockResolvedValue([]) })),
      })),
    })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue([]) })),
    _inserts: inserts,
    _updates: updates,
  } as any;
}

const PIPELINE_YAML = `
name: "pr-bot-wiring-test"
source:
  provider: azure_devops
  repo: https://dev.azure.com/org/project/_git/repo
  branch: feat/x
stages:
  - name: clone
    type: internal-clone
    timeout: 60
  - name: noop
    script: echo done
    timeout: 5
`;

describe('PR-bot context wiring (triggerRun → clone PAT + internal-clone account)', () => {
  let workDir: string;
  let clonedSnapshots: Array<Record<string, unknown>>;
  let fakeGit: any;

  beforeEach(async () => {
    clonedSnapshots = [];

    // Real workspace dir with a config.js that exports USERNAMES for the
    // PR-bot account we pass via azurePrContext.
    workDir = await mkdtemp(join(tmpdir(), 'prbot-ctx-'));
    await writeFile(
      join(workDir, 'config.js'),
      `module.exports = { USERNAMES: { name_1: { password: 's3cret' } } };`,
    );

    fakeGit = {
      clone: vi.fn().mockImplementation(async (opts: any) => {
        // Snapshot so we can assert patInline reached the git service.
        clonedSnapshots.push({ ...opts });
        return { workDir, commit: 'deadbeefcafe' };
      }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('threads PR-bot PAT into gitService.clone and account into internal-clone', async () => {
    const pipelineRow = { id: 'p1', name: 'pr-bot-wiring-test', yamlContent: PIPELINE_YAML };
    const db = createMockDb(pipelineRow);
    const broadcaster = new PipelineBroadcaster();

    const svc = new PipelineService(
      db,
      createLogger(),
      broadcaster,
      undefined, // jobService
      fakeGit as any,
      undefined, // secretsService
      undefined, // emit
      undefined, // boss
      undefined, // concurrencyGuard
      undefined, // pool — not needed: pipeline has no device-stream-script
    );

    const runId = await svc.triggerRun(
      'p1',
      'azure-pr',
      { pr_number: '42', pr_url: 'https://example/pr/42', branch: 'feat/x', commit_sha: 'deadbeef' },
      undefined,
      { integrationId: 'trampo', pat: 'super-secret-pat', account: 'name_1' },
    );

    expect(runId).toBeTruthy();
    // Wait a tick for the internal-clone stage promise chain.
    await new Promise((r) => setTimeout(r, 50));

    // #2 assertion: clone received the inline PAT.
    expect(fakeGit.clone).toHaveBeenCalledOnce();
    expect(clonedSnapshots[0]).toMatchObject({
      repo: 'https://dev.azure.com/org/project/_git/repo',
      branch: 'feat/x',
      patInline: 'super-secret-pat',
    });

    // #3 assertion: the run row was inserted with the integration id, proving
    // azurePrContext propagated from triggerRun → DB insert path.
    const runInsert = db._inserts.find((r: any) => 'triggerType' in r);
    expect(runInsert.azurePrIntegrationId).toBe('trampo');
    expect(runInsert.triggerType).toBe('azure-pr');
  });
});
