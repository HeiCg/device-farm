import { describe, it, expect } from 'vitest';
import { generateJUnitXML, escapeXml } from '../junit-generator.js';

describe('escapeXml', () => {
  it('escapes < > & " \' characters', () => {
    expect(escapeXml('<test>')).toBe('&lt;test&gt;');
    expect(escapeXml('a & b')).toBe('a &amp; b');
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('handles strings with no special characters', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });
});

describe('generateJUnitXML', () => {
  const job = { id: 'job-123' };

  it('produces valid XML with testsuites/testsuite/testcase structure', () => {
    const steps = [
      { flowName: 'Login Flow', status: 'passed', durationMs: 1500, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('<testcase');
    expect(xml).toContain('</testsuites>');
  });

  it('produces self-closing testcase for passed steps', () => {
    const steps = [
      { flowName: 'Login', status: 'passed', durationMs: 1000, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toMatch(/<testcase[^>]*\/>/);
  });

  it('includes failure element for failed steps', () => {
    const steps = [
      { flowName: 'Login', status: 'failed', durationMs: 2000, error: 'Button not found' },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('<failure');
    expect(xml).toContain('Button not found');
    expect(xml).toContain('type="MaestroFailure"');
    expect(xml).toContain('</testcase>');
  });

  it('includes skipped element for skipped steps', () => {
    const steps = [
      { flowName: 'Login', status: 'skipped', durationMs: 0, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('<skipped');
    expect(xml).toContain('</testcase>');
  });

  it('computes summary attributes correctly', () => {
    const steps = [
      { flowName: 'A', status: 'passed', durationMs: 1000, error: null },
      { flowName: 'B', status: 'failed', durationMs: 2000, error: 'err' },
      { flowName: 'C', status: 'skipped', durationMs: 0, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('errors="0"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('time="3.000"');
  });

  it('handles empty steps array with 0 counts', () => {
    const xml = generateJUnitXML(job, []);

    expect(xml).toContain('tests="0"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('time="0.000"');
    expect(xml).toContain('<?xml');
  });

  it('escapes special characters in flow names and error messages', () => {
    const steps = [
      { flowName: '<Login & Sign-up>', status: 'failed', durationMs: 1000, error: 'Error: "timeout" < 5s' },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('&lt;Login &amp; Sign-up&gt;');
    expect(xml).toContain('&quot;timeout&quot;');
    expect(xml).not.toContain('<Login');
  });

  it('uses duration in seconds with 3 decimal places', () => {
    const steps = [
      { flowName: 'Test', status: 'passed', durationMs: 1234, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('time="1.234"');
  });

  it('handles null flowName with "unknown"', () => {
    const steps = [
      { flowName: null, status: 'passed', durationMs: 1000, error: null },
    ];
    const xml = generateJUnitXML(job, steps);

    expect(xml).toContain('name="unknown"');
  });
});
