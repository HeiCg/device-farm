import { describe, it, expect } from 'vitest';
import {
  extractFrontmatter,
  buildFixedContext,
  alwaysLoadSubset,
  dslSubset,
  dslScriptTool,
  argentRunScriptTool,
  extractRunScriptDts,
} from '../fixed-context.js';
import type { ListedTool } from '../mcp-client.js';
import type { FixedArtifact } from '../types.js';

describe('fixed-context helpers', () => {
  it('extracts a leading YAML frontmatter block', () => {
    const md = '---\ndescription: hi\nalwaysApply: true\n---\n\n# body\ntext';
    expect(extractFrontmatter(md)).toBe('---\ndescription: hi\nalwaysApply: true\n---');
  });

  it('returns empty string when there is no frontmatter', () => {
    expect(extractFrontmatter('# just a body\n')).toBe('');
  });

  it('buildFixedContext sums bytes and tokens', () => {
    const arts: FixedArtifact[] = [
      { name: 'a', bytes: 100, tokens: 25 },
      { name: 'b', bytes: 200, tokens: 40 },
    ];
    const fc = buildFixedContext('Z', arts);
    expect(fc.totalBytes).toBe(300);
    expect(fc.totalTokens).toBe(65);
    expect(fc.artifacts).toHaveLength(2);
  });

  const tools: ListedTool[] = [
    { name: 'gesture-tap', _meta: { 'anthropic/alwaysLoad': true } },
    { name: 'run-sequence' },
    { name: 'run-script' },
    { name: 'dsl_tap' },
    { name: 'dsl_describe' },
    { name: 'dsl_run_script' },
  ];

  it('argentRunScriptTool isolates the run-script tool', () => {
    expect(argentRunScriptTool(tools).map((t) => t.name)).toEqual(['run-script']);
  });

  it('extractRunScriptDts pulls the ```ts interface Ui block', () => {
    const md = [
      '# skill',
      'prose',
      '```json',
      '{ "not": "this one" }',
      '```',
      '```ts',
      'interface Ui {',
      '  tap(selector): Promise<void>;',
      '}',
      '```',
      'more prose',
    ].join('\n');
    const dts = extractRunScriptDts(md);
    expect(dts).toContain('interface Ui');
    expect(dts).toContain('tap(selector)');
    expect(dts).not.toContain('not');
  });

  it('extractRunScriptDts returns empty string when absent', () => {
    expect(extractRunScriptDts('# skill\nno code here')).toBe('');
  });

  it('alwaysLoadSubset keeps only alwaysLoad-flagged tools', () => {
    expect(alwaysLoadSubset(tools).map((t) => t.name)).toEqual(['gesture-tap']);
  });

  it('dslSubset keeps dsl_* except dsl_run_script', () => {
    expect(dslSubset(tools).map((t) => t.name)).toEqual(['dsl_tap', 'dsl_describe']);
  });

  it('dslScriptTool isolates dsl_run_script', () => {
    expect(dslScriptTool(tools).map((t) => t.name)).toEqual(['dsl_run_script']);
  });
});
