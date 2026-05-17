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
