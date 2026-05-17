import { describe, it, expect } from 'vitest';
import { parsePipeline } from '../internal/parser.js';
import { interpolateVariables } from '../internal/variables.js';

const VALID_YAML = `
name: "test-pipeline"
description: "A test pipeline"
trigger:
  - api
stages:
  - name: setup
    script: echo "hello"
    timeout: 60
  - name: cleanup
    script: echo "done"
    when: always
`;

const INVALID_YAML_NO_NAME = `
stages:
  - name: setup
    script: echo "hello"
`;

const INVALID_YAML_NO_STAGES = `
name: "bad-pipeline"
`;

const YAML_WITH_VARIABLES = `
name: "var-pipeline"
trigger:
  - api
variables:
  APP_ID: com.test
stages:
  - name: setup
    script: echo "{{APP_ID}} on {{branch}}"
`;

describe('parsePipeline', () => {
  it('parses a valid pipeline YAML', () => {
    const result = parsePipeline(VALID_YAML);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('test-pipeline');
    expect(result.data.stages).toHaveLength(2);
    expect(result.data.stages[0].name).toBe('setup');
    expect(result.data.stages[0].script).toBe('echo "hello"');
    expect(result.data.stages[0].timeout).toBe(60);
    expect(result.data.stages[0].when).toBe('success');
    expect(result.data.stages[1].when).toBe('always');
  });

  it('rejects YAML without name', () => {
    const result = parsePipeline(INVALID_YAML_NO_NAME);
    expect(result.success).toBe(false);
  });

  it('rejects YAML without stages', () => {
    const result = parsePipeline(INVALID_YAML_NO_STAGES);
    expect(result.success).toBe(false);
  });

  it('parses variables block', () => {
    const result = parsePipeline(YAML_WITH_VARIABLES);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.variables).toEqual({ APP_ID: 'com.test' });
  });

  it('defaults trigger to api when omitted', () => {
    const yaml = 'name: "simple"\nstages:\n  - name: s1\n    script: echo hi';
    const result = parsePipeline(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toEqual([{ type: 'api' }]);
  });

  it('parses schedule triggers', () => {
    const yaml = `
name: "scheduled"
trigger:
  - api
  - schedule: "0 2 * * *"
stages:
  - name: s1
    script: echo hi
`;
    const result = parsePipeline(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toHaveLength(2);
    expect(result.data.trigger[1]).toEqual({ type: 'schedule', cron: '0 2 * * *' });
  });

  it('rejects invalid YAML syntax', () => {
    const result = parsePipeline('not: valid: yaml: [[[');
    expect(result.success).toBe(false);
  });
});

describe('extended schema (Task 3)', () => {
  it('accepts azure-pr trigger', () => {
    const yaml = `
name: x
trigger:
  - azure_pr:
      repo_id: trampo-automation
stages:
  - name: a
    script: "echo hi"
`;
    const r = parsePipeline(yaml);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.trigger[0]).toEqual({ type: 'azure-pr', repoId: 'trampo-automation' });
    }
  });

  it('accepts device-stream-script stage type', () => {
    const yaml = `
name: x
stages:
  - name: setup
    type: device-stream-script
    script_path: ./setup.js
    platform: ios
`;
    const r = parsePipeline(yaml);
    expect(r.success).toBe(true);
  });

  it('accepts internal-clone and internal-release stage types', () => {
    const yaml = `
name: x
stages:
  - name: clone
    type: internal-clone
  - name: release
    type: internal-release
`;
    const r = parsePipeline(yaml);
    expect(r.success).toBe(true);
  });

  it('still accepts legacy script/maestro types', () => {
    const yaml = `
name: x
stages:
  - name: a
    script: "true"
  - name: b
    type: maestro
    platform: android
    flows: "Tests/**/*.yaml"
`;
    const r = parsePipeline(yaml);
    expect(r.success).toBe(true);
  });
});

describe('interpolateVariables', () => {
  it('replaces {{var}} placeholders with values', () => {
    const result = interpolateVariables('echo {{name}}', { name: 'world' });
    expect(result).toBe('echo world');
  });

  it('replaces multiple occurrences', () => {
    const result = interpolateVariables('{{a}} and {{b}}', { a: '1', b: '2' });
    expect(result).toBe('1 and 2');
  });

  it('leaves unknown variables as-is', () => {
    const result = interpolateVariables('echo {{unknown}}', {});
    expect(result).toBe('echo {{unknown}}');
  });

  it('handles empty string values', () => {
    const result = interpolateVariables('echo {{val}}', { val: '' });
    expect(result).toBe('echo ');
  });

  it('handles no placeholders', () => {
    const result = interpolateVariables('echo hello', { name: 'world' });
    expect(result).toBe('echo hello');
  });
});
