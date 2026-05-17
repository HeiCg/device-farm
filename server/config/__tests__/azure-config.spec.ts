import { describe, it, expect } from 'vitest';
import { configSchema } from '../schema.js';

describe('azure_devops config', () => {
  it('accepts well-formed azure_devops block', () => {
    const result = configSchema.parse({
      azure_devops: {
        pat: 'somepat',
        webhook_basic_auth: { username: 'u', password: 'p' },
        pr_integrations: [{
          id: 'trampo',
          repo_url: 'https://dev.azure.com/o/p/_git/r',
          target_branch: 'main',
        }],
      },
    });
    expect(result.azure_devops?.pr_integrations).toHaveLength(1);
    expect(result.azure_devops?.pr_integrations[0].target_branch).toBe('main');
  });

  it('makes azure_devops optional (omitting disables feature)', () => {
    const result = configSchema.parse({});
    expect(result.azure_devops).toBeUndefined();
  });

  it('defaults target_branch to "main"', () => {
    const result = configSchema.parse({
      azure_devops: {
        pat: 'p',
        webhook_basic_auth: { username: 'u', password: 'p' },
        pr_integrations: [{ id: 'x', repo_url: 'https://dev.azure.com/o/p/_git/r' }],
      },
    });
    expect(result.azure_devops?.pr_integrations[0].target_branch).toBe('main');
  });

  it('rejects repo_url that is not a URL', () => {
    expect(() => configSchema.parse({
      azure_devops: {
        pat: 'p',
        webhook_basic_auth: { username: 'u', password: 'p' },
        pr_integrations: [{ id: 'x', repo_url: 'not-a-url' }],
      },
    })).toThrow();
  });

  it('accepts pipelines.max_concurrent_runs', () => {
    const result = configSchema.parse({ pipelines: { max_concurrent_runs: 3 } });
    expect(result.pipelines.max_concurrent_runs).toBe(3);
  });

  it('defaults pipelines.max_concurrent_runs to 2', () => {
    const result = configSchema.parse({});
    expect(result.pipelines.max_concurrent_runs).toBe(2);
  });
});
