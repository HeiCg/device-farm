import { describe, it, expect } from 'vitest';
import { buildPipelineYaml } from '../internal/template-builder.js';

describe('template builder', () => {
  const baseBlock = {
    url: 'https://download.example/build',
    account: 'name_1',
    platform: 'ios' as const,
    suite: ['SmokeTests'],
  };
  const integration = {
    id: 'trampo',
    repo_url: 'https://dev.azure.com/o/p/_git/r',
    target_branch: 'main',
  };
  const prMeta = { prId: 42, sourceRefName: 'refs/heads/feat/x', commit: 'abc1234567' };

  it('emits the 4 stage groups for 1 suite', () => {
    const yaml = buildPipelineYaml(baseBlock, integration, prMeta);
    expect(yaml).toMatch(/name: clone\b/);
    expect(yaml).toMatch(/name: pre-setup\b/);
    expect(yaml).toMatch(/name: test-SmokeTests\b/);
    expect(yaml).toMatch(/name: teardown\b/);
  });

  it('expands N suites into N maestro stages', () => {
    const yaml = buildPipelineYaml({ ...baseBlock, suite: ['A', 'B', 'C'] }, integration, prMeta);
    expect(yaml).toMatch(/name: test-A\b/);
    expect(yaml).toMatch(/name: test-B\b/);
    expect(yaml).toMatch(/name: test-C\b/);
  });

  it('sets platform on pre-setup and test stages', () => {
    const yaml = buildPipelineYaml({ ...baseBlock, platform: 'android' }, integration, prMeta);
    const matches = yaml.match(/platform:\s*android/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('teardown has when: always', () => {
    const yaml = buildPipelineYaml(baseBlock, integration, prMeta);
    expect(yaml).toMatch(/name:\s*teardown[\s\S]*?when:\s*always/);
  });

  it('test stages have when: always (suites independent)', () => {
    const yaml = buildPipelineYaml({ ...baseBlock, suite: ['A', 'B'] }, integration, prMeta);
    const blocks = yaml.split('- name: test-').slice(1);
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(b).toMatch(/when:\s*always/);
  });

  it('includes URL and ACCOUNT in pre-setup env', () => {
    const yaml = buildPipelineYaml(baseBlock, integration, prMeta);
    expect(yaml).toContain('URL: https://download.example/build');
    expect(yaml).toContain('ACCOUNT: name_1');
  });

  it('emits the azure_pr trigger pointing at the integration id', () => {
    const yaml = buildPipelineYaml(baseBlock, integration, prMeta);
    expect(yaml).toMatch(/trigger:[\s\S]*azure_pr:[\s\S]*repo_id: trampo/);
  });
});
