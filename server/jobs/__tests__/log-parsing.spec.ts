import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogcatLine, type ParsedLogcat } from '../log-parsing.js';

const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

// Phase 31 Wave 0: RED state. The production module `server/jobs/log-parsing.ts` is
// implemented by Wave 1 plan 31-01. Until then, this spec MUST fail with a module
// resolution error — that's the test-first signal Wave 1 turns green.

describe('parseLogcatLine — threadtime format', () => {
  it('valid threadtime line returns structured payload with isCrash=false', () => {
    const line = '12-15 10:23:45.123  1234  1234 I ActivityManager: Start proc 5678:com.example.app/u0a123 for activity {com.example.app/.MainActivity}';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('I');
    expect(result!.tag).toBe('ActivityManager');
    expect(result!.isCrash).toBe(false);
    expect(result!.msg).toContain('Start proc');
  });

  it('malformed line (no threadtime prefix) returns null', () => {
    const line = 'This is just a random string with no threadtime metadata at all';
    expect(parseLogcatLine(line)).toBeNull();
  });
});

describe('parseLogcatLine — crash 3-of-3 detection', () => {
  it('detects AndroidRuntime FATAL EXCEPTION (level E + threadtime + keyword)', () => {
    const line = '12-15 10:23:45.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('E');
    expect(result!.isCrash).toBe(true);
  });

  it('detects native sigsegv ("Fatal signal 11") at level E', () => {
    const line = '12-15 10:24:01.456  5678  5678 E DEBUG   : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0 in tid 5678 (com.example.app)';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('E');
    expect(result!.isCrash).toBe(true);
  });

  it('detects "beginning of crash" marker at level E', () => {
    const line = '12-15 10:23:45.000  1234  1234 E AndroidRuntime: --------- beginning of crash';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('E');
    expect(result!.isCrash).toBe(true);
  });

  it('detects "AndroidRuntime: FATAL" subclass marker', () => {
    const line = '12-15 10:23:45.999  1234  1234 E SomeOtherTag: AndroidRuntime: FATAL ERROR encountered';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('E');
    expect(result!.isCrash).toBe(true);
  });
});

describe('parseLogcatLine — false positive defense', () => {
  it('level I line containing "FATAL EXCEPTION" does NOT trigger crash (level gate)', () => {
    const line = '12-15 10:25:30.123  1111  1111 I MyApp   : Caught and recovered: FATAL EXCEPTION was logged';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('I');
    expect(result!.isCrash).toBe(false);
  });

  it('line with no threadtime prefix returns null (regex gate)', () => {
    const line = 'E/AndroidRuntime: FATAL EXCEPTION: main';
    expect(parseLogcatLine(line)).toBeNull();
  });

  it('user app log mentioning "FATAL" word with non-E level does NOT trigger crash', () => {
    const line = '12-15 10:26:00.123  2222  2222 W MyApp   : I think this is FATAL but it is just a warning';
    const result = parseLogcatLine(line);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('W');
    expect(result!.isCrash).toBe(false);
  });
});

describe('parseLogcatLine — fixtures', () => {
  function parseFixture(name: string): { parsed: ParsedLogcat[]; expectedCrashCount: number } {
    const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8');
    const lines = content.split('\n');
    const header = lines.find((l) => l.startsWith('# expected_crash_count:'));
    if (!header) {
      throw new Error(`Fixture ${name} missing expected_crash_count header`);
    }
    const expectedCrashCount = Number.parseInt(header.replace('# expected_crash_count:', '').trim(), 10);
    const dataLines = lines.filter((l) => l && !l.startsWith('#'));
    const parsed = dataLines
      .map(parseLogcatLine)
      .filter((p): p is ParsedLogcat => p !== null);
    return { parsed, expectedCrashCount };
  }

  it('logcat-crash-androidruntime: detects at least 1 crash', () => {
    const { parsed, expectedCrashCount } = parseFixture('logcat-crash-androidruntime.txt');
    const crashCount = parsed.filter((p) => p.isCrash).length;
    expect(crashCount).toBeGreaterThanOrEqual(expectedCrashCount);
  });

  it('logcat-crash-native-sigsegv: detects at least 1 crash', () => {
    const { parsed, expectedCrashCount } = parseFixture('logcat-crash-native-sigsegv.txt');
    const crashCount = parsed.filter((p) => p.isCrash).length;
    expect(crashCount).toBeGreaterThanOrEqual(expectedCrashCount);
  });

  it('logcat-anr: detects 0 crashes (ANR is not yet in marker set)', () => {
    const { parsed, expectedCrashCount } = parseFixture('logcat-anr.txt');
    const crashCount = parsed.filter((p) => p.isCrash).length;
    expect(crashCount).toBe(expectedCrashCount);
  });

  it('logcat-normal-verbose: detects 0 crashes', () => {
    const { parsed, expectedCrashCount } = parseFixture('logcat-normal-verbose.txt');
    const crashCount = parsed.filter((p) => p.isCrash).length;
    expect(crashCount).toBe(expectedCrashCount);
  });

  it('logcat-mixed: detects at least 1 crash within mixed traffic', () => {
    const { parsed, expectedCrashCount } = parseFixture('logcat-mixed.txt');
    const crashCount = parsed.filter((p) => p.isCrash).length;
    expect(crashCount).toBeGreaterThanOrEqual(expectedCrashCount);
  });
});
