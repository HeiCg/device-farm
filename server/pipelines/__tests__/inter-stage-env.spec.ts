import { describe, it, expect } from 'vitest';
import { createMarkerParser, type EnvSink } from '../internal/inter-stage-env.js';

describe('inter-stage env marker parser', () => {
  it('extracts single marker, strips it from the log line', () => {
    const exported: Record<string, string> = {};
    const logged: string[] = [];
    const sink: EnvSink = {
      set: (k, v) => { exported[k] = v; },
      log: (line) => { logged.push(line); },
    };
    const parser = createMarkerParser(sink);

    parser.write('some prelude\n');
    parser.write('##device-farm[setvariable name=FOO]bar\n');
    parser.write('more output\n');
    parser.end();

    expect(exported).toEqual({ FOO: 'bar' });
    expect(logged).toEqual(['some prelude', 'more output']);
  });

  it('handles markers split across chunks', () => {
    const exported: Record<string, string> = {};
    const sink: EnvSink = { set: (k, v) => { exported[k] = v; }, log: () => {} };
    const parser = createMarkerParser(sink);

    parser.write('##device-farm[setvar');
    parser.write('iable name=CODE]xyz\n');
    parser.end();

    expect(exported).toEqual({ CODE: 'xyz' });
  });

  it('masks values whose name is in secretNames (forward only)', () => {
    // Streaming parser: lines are emitted as soon as they arrive. Lines that
    // appear BEFORE the secret marker are not retroactively masked (they were
    // already streamed). Lines that appear AFTER the marker are masked.
    // Callers must export the secret marker before producing log lines that
    // could include the secret value.
    const logged: string[] = [];
    const sink: EnvSink = { set: () => {}, log: (line) => { logged.push(line); } };
    const parser = createMarkerParser(sink, { secretNames: ['PASSWORD'] });

    parser.write('##device-farm[setvariable name=PASSWORD]hunter2\n');
    parser.write('login: ok with pwd=hunter2 done\n');
    parser.write('next line hunter2 appears\n');
    parser.end();

    expect(logged.join('\n')).not.toContain('hunter2');
    expect(logged.join('\n')).toContain('***');
  });

  it('emits log lines in real time (does not buffer until end)', () => {
    const logged: string[] = [];
    const sink: EnvSink = { set: () => {}, log: (line) => { logged.push(line); } };
    const parser = createMarkerParser(sink);

    parser.write('line one\n');
    expect(logged).toEqual(['line one']);
    parser.write('line two\n');
    expect(logged).toEqual(['line one', 'line two']);
    parser.end();
  });

  it('handles multiple markers in one stream', () => {
    const exported: Record<string, string> = {};
    const sink: EnvSink = { set: (k, v) => { exported[k] = v; }, log: () => {} };
    const parser = createMarkerParser(sink);

    parser.write('##device-farm[setvariable name=A]1\n##device-farm[setvariable name=B]2\n');
    parser.end();

    expect(exported).toEqual({ A: '1', B: '2' });
  });

  it('masks pre-seeded secret values from the first line (callback-exported secrets)', () => {
    // Simulates the internal-clone PASSWORD: it never appears as a setvariable
    // marker in this stage's stream, so it must be seeded into secretValues up
    // front. The value must be masked even on the very first log line.
    const logged: string[] = [];
    const sink: EnvSink = { set: () => {}, log: (line) => { logged.push(line); } };
    const parser = createMarkerParser(sink, { secretValues: ['hunter2'] });

    parser.write('login as admin with pwd=hunter2\n');
    parser.end();

    expect(logged.join('\n')).not.toContain('hunter2');
    expect(logged.join('\n')).toContain('***');
  });

  it('reports secret marker names via set opts.secret', () => {
    const seen: Array<{ k: string; secret: boolean | undefined }> = [];
    const sink: EnvSink = {
      set: (k, _v, o) => { seen.push({ k, secret: o?.secret }); },
      log: () => {},
    };
    const parser = createMarkerParser(sink, { secretNames: ['PASSWORD'] });

    parser.write('##device-farm[setvariable name=PASSWORD]s3cret\n');
    parser.write('##device-farm[setvariable name=PUBLIC]hello\n');
    parser.end();

    expect(seen).toEqual([
      { k: 'PASSWORD', secret: true },
      { k: 'PUBLIC', secret: false },
    ]);
  });

  it('caps a newline-free flood: flushes truncated (masked) chunk and resets', () => {
    const logged: string[] = [];
    const sink: EnvSink = { set: () => {}, log: (line) => { logged.push(line); } };
    const parser = createMarkerParser(sink, { secretValues: ['topsecret'] });

    // 200 KB with no newline — well over the 64 KB cap. Embed a secret to prove
    // the flushed chunk is still masked.
    parser.write('topsecret' + 'x'.repeat(200 * 1024));
    parser.end();

    expect(logged.length).toBeGreaterThanOrEqual(1);
    const joined = logged.join('');
    expect(joined).not.toContain('topsecret');
    expect(joined).toContain('***');
    // The pending buffer was reset — total flushed stays bounded near the cap,
    // not the full 200 KB in one unbounded line.
    expect(logged[0].length).toBeLessThanOrEqual(64 * 1024 + 16);
  });

  it('ignores malformed markers', () => {
    const exported: Record<string, string> = {};
    const logged: string[] = [];
    const sink: EnvSink = {
      set: (k, v) => { exported[k] = v; },
      log: (l) => { logged.push(l); },
    };
    const parser = createMarkerParser(sink);

    parser.write('##device-farm[setvariable]missing-name\n');
    parser.write('##device-farm[setvariable name=]missing-value\n');
    parser.end();

    expect(exported).toEqual({});
    expect(logged).toHaveLength(2);
  });
});
