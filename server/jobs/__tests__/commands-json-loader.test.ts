import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCommandTimestamps } from '../internal/commands-json-loader.js';

describe('loadCommandTimestamps', () => {
  it('returns empty map when directory has no commands-*.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(0);
  });

  it('parses commands-*.json with epoch timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-login.json'), JSON.stringify([
      { command: 'tapOn("Email")',  startedAtMs: 1700000000000, endedAtMs: 1700000000500 },
      { command: 'tapOn("Submit")', startedAtMs: 1700000000700, endedAtMs: 1700000001900 },
    ]));

    const result = await loadCommandTimestamps(dir);
    expect(result.get('tapOn("Email")')).toEqual({
      startedAt: new Date(1700000000000),
      endedAt:   new Date(1700000000500),
    });
  });

  it('skips entries missing timestamps and logs nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-x.json'), JSON.stringify([
      { command: 'tapOn("A")' },
      { command: 'tapOn("B")', startedAtMs: 1, endedAtMs: 2 },
    ]));
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(1);
    expect(result.has('tapOn("B")')).toBe(true);
  });

  it('returns empty map on malformed JSON without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-bad.json'), '{not json');
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(0);
  });
});
