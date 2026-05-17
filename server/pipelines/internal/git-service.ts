import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pino from 'pino';
import type { SecretsService } from './secrets.js';

export interface CloneOpts {
  repo: string;      // Full repo URL (https://dev.azure.com/org/project/_git/repo)
  branch: string;    // Branch to checkout
  patSecret?: string; // Name of secret containing PAT
  patInline?: string; // PAT value provided directly (takes priority over patSecret)
  depth?: number;    // Shallow clone depth (default: 1)
}

export interface CloneResult {
  workDir: string;   // Path to cloned directory
  commit: string;    // HEAD commit SHA
}

export class GitService {
  private readonly logger: pino.Logger;
  private readonly secretsService: SecretsService;

  constructor(logger: pino.Logger, secretsService: SecretsService) {
    this.logger = logger.child({ component: 'git-service' });
    this.secretsService = secretsService;
  }

  /**
   * Clone a git repository into a temp directory and checkout the specified branch.
   * Returns the work directory path and HEAD commit SHA.
   */
  async clone(opts: CloneOpts): Promise<CloneResult> {
    const { repo, branch, patSecret, patInline, depth = 1 } = opts;

    // Build auth URL if PAT provided (patInline takes priority over patSecret)
    let authUrl = repo;
    if (patInline) {
      authUrl = repo.replace('https://', `https://pat:${patInline}@`);
    } else if (patSecret) {
      const pat = await this.secretsService.get(patSecret);
      if (!pat) {
        throw new Error(`Secret "${patSecret}" not found`);
      }
      // Insert PAT into URL: https://pat@dev.azure.com/...
      authUrl = repo.replace('https://', `https://pat:${pat}@`);
    }

    // Create temp directory
    const workDir = await mkdtemp(join(tmpdir(), 'device-farm-pipeline-'));

    try {
      // Clone with shallow depth
      const cloneArgs = ['clone', '--branch', branch, '--depth', String(depth), '--single-branch', authUrl, workDir];
      await this.execGit(cloneArgs, undefined, 120_000);

      // Get HEAD commit SHA
      const commit = await this.execGitOutput(['rev-parse', 'HEAD'], workDir);

      this.logger.info({ repo, branch, commit: commit.substring(0, 8), workDir }, 'Repository cloned');

      return { workDir, commit: commit.trim() };
    } catch (err: any) {
      // Clean up on failure
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      // Sanitize error message to remove PAT
      const sanitizedMsg = err.message?.replace(/pat:[^@]+@/g, 'pat:***@') ?? 'Unknown error';
      throw new Error(`Git clone failed: ${sanitizedMsg}`);
    }
  }

  /**
   * Clean up a cloned directory.
   */
  async cleanup(workDir: string): Promise<void> {
    await rm(workDir, { recursive: true, force: true });
    this.logger.info({ workDir }, 'Clone directory cleaned up');
  }

  private execGit(args: string[], cwd?: string, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git ${args[0]} exited with code ${code}: ${stderr.trim()}`));
      });

      child.on('error', (err) => reject(err));
    });
  }

  private execGitOutput(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('exit', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`git ${args[0]} failed: ${stderr.trim()}`));
      });

      child.on('error', (err) => reject(err));
    });
  }
}
