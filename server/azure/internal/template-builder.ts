import { stringify } from 'yaml';
import type { PrBlock } from './pr-parser.js';

export interface IntegrationMeta {
  id: string;
  repo_url: string;
  target_branch: string;
}

export interface PrMeta {
  prId: number;
  sourceRefName: string;
  commit: string;
}

export function buildPipelineYaml(
  block: PrBlock,
  integration: IntegrationMeta,
  pr: PrMeta,
): string {
  const stages: Array<Record<string, unknown>> = [
    { name: 'clone', type: 'internal-clone', timeout: 120, when: 'success' },
    {
      name: 'pre-setup',
      type: 'device-stream-script',
      script_path: '.device-farm/pre-setup.js',
      platform: block.platform,
      timeout: 600,
      when: 'success',
      env: { URL: block.url, ACCOUNT: block.account, PLATFORM: block.platform },
    },
    ...block.suite.map((s) => ({
      name: `test-${s}`,
      type: 'maestro',
      platform: block.platform,
      flows: `Tests/${s}/**/*.yaml`,
      timeout: 1800,
      when: 'always',
    })),
    { name: 'teardown', type: 'internal-release', timeout: 60, when: 'always' },
  ];

  const def = {
    name: `pr-${integration.id}-${pr.prId}`,
    description: `Auto-generated PR-bot pipeline for PR #${pr.prId} (commit ${pr.commit.slice(0, 7)})`,
    trigger: [{ azure_pr: { repo_id: integration.id } }],
    source: {
      provider: 'azure_devops',
      repo: integration.repo_url,
      branch: pr.sourceRefName.replace(/^refs\/heads\//, ''),
    },
    stages,
  };

  return stringify(def);
}
