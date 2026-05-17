import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitService } from '../internal/git-service.js';
import type { SecretsService } from '../internal/secrets.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function createMockSecretsService(secrets: Record<string, string> = {}) {
  return {
    get: vi.fn(async (name: string) => secrets[name] ?? null),
    create: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  } as unknown as SecretsService;
}

describe('GitService', () => {
  let service: GitService;
  let secretsService: ReturnType<typeof createMockSecretsService>;

  beforeEach(() => {
    secretsService = createMockSecretsService({ azure_pat: 'fake-pat-token' });
    service = new GitService(createLogger(), secretsService as any);
  });

  it('clones a public repository and returns workDir + commit', async () => {
    // Clone a small public repo to verify the full flow works
    const result = await service.clone({
      repo: 'https://github.com/octocat/Hello-World.git',
      branch: 'master',
      depth: 1,
    });

    expect(result.workDir).toBeTruthy();
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);

    // Clean up
    await service.cleanup(result.workDir);
  }, 30_000);

  it('throws when secret not found', async () => {
    const emptySecrets = createMockSecretsService({});
    const svc = new GitService(createLogger(), emptySecrets as any);

    await expect(svc.clone({
      repo: 'https://dev.azure.com/org/project/_git/repo',
      branch: 'main',
      patSecret: 'nonexistent',
    })).rejects.toThrow('Secret "nonexistent" not found');
  });

  it('throws on invalid repo URL', async () => {
    await expect(service.clone({
      repo: 'https://invalid-host-that-does-not-exist.example.com/repo.git',
      branch: 'main',
    })).rejects.toThrow('Git clone failed');
  }, 30_000);

  it('sanitizes PAT from error messages', async () => {
    const svc = new GitService(createLogger(), createMockSecretsService({ my_pat: 'super-secret-123' }) as any);

    try {
      await svc.clone({
        repo: 'https://invalid-host-that-does-not-exist.example.com/repo.git',
        branch: 'main',
        patSecret: 'my_pat',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      // The PAT value must never appear in the error message
      expect(err.message).not.toContain('super-secret-123');
      // The error must be wrapped with our sanitized prefix
      expect(err.message).toMatch(/^Git clone failed:/);
    }
  }, 30_000);
});

describe('GitService inline PAT (Task 5)', () => {
  it('does not consult secretsService when patInline is provided', async () => {
    const secretsGetSpy = vi.fn();
    const fakeSecrets = { get: secretsGetSpy } as unknown as SecretsService;
    const svc = new GitService(createLogger(), fakeSecrets);

    // Use a non-resolvable URL — clone will fail, but secrets.get must not be invoked.
    await svc.clone({
      repo: 'https://does-not-exist.invalid/r',
      branch: 'main',
      patInline: 'fake-pat',
    }).catch(() => undefined);

    expect(secretsGetSpy).not.toHaveBeenCalled();
  });
});
