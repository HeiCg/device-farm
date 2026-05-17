import { describe, it, expect } from 'vitest';
import { parsePrDescription } from '../internal/pr-parser.js';

describe('PR description parser', () => {
  it('returns "no-block" when no fence is present', () => {
    const r = parsePrDescription('Hi I am opening this PR for X.');
    expect(r.kind).toBe('no-block');
  });

  it('parses a well-formed block', () => {
    const desc = '```device-script\nurl: https://x.com/dl\naccount: name_1\nplatform: ios\nsuite: SmokeTests, LoginTests\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.block.url).toBe('https://x.com/dl');
      expect(r.block.account).toBe('name_1');
      expect(r.block.platform).toBe('ios');
      expect(r.block.suite).toEqual(['SmokeTests', 'LoginTests']);
    }
  });

  it('returns "multiple-blocks" when 2+ fences present', () => {
    const desc =
      '```device-script\nurl: https://x\naccount: a\nplatform: ios\nsuite: s\n```\n\n' +
      '```device-script\nurl: https://y\naccount: b\nplatform: ios\nsuite: s\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('multiple-blocks');
    if (r.kind === 'multiple-blocks') expect(r.count).toBe(2);
  });

  it('returns "parse-error" on invalid YAML', () => {
    const desc = '```device-script\nurl: [unclosed\naccount: a\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('parse-error');
  });

  it('returns "validation-error" on missing required field', () => {
    const desc = '```device-script\nurl: https://x.com\nplatform: ios\nsuite: A\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('validation-error');
    if (r.kind === 'validation-error') {
      expect(r.issues.some(i => i.path.includes('account'))).toBe(true);
    }
  });

  it('rejects non-URL url field', () => {
    const desc = '```device-script\nurl: not-a-url\naccount: a\nplatform: ios\nsuite: A\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('validation-error');
  });

  it('trims whitespace and filters empty entries in suite list', () => {
    const desc = '```device-script\nurl: https://x.com\naccount: a\nplatform: android\nsuite: A , , B  ,  C\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.block.suite).toEqual(['A', 'B', 'C']);
  });

  it('rejects platform values outside android|ios', () => {
    const desc = '```device-script\nurl: https://x.com\naccount: a\nplatform: windows\nsuite: A\n```';
    const r = parsePrDescription(desc);
    expect(r.kind).toBe('validation-error');
  });
});
