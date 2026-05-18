import { describe, it, expect } from 'vitest';
import { MaestroParser } from '../maestro-parser.js';

describe('MaestroParser wallclock', () => {
  it('records timestamps per command transition', () => {
    let now = 1_700_000_000_000;
    const clock = () => new Date(now);

    const parser = new MaestroParser({
      onFlowStart: () => {},
      onCommandStatus: () => {},
      onFlowResult: () => {},
      onSummary: () => {},
    }, { clock });

    parser.parseLine('Running flow login.yaml');
    parser.parseLine('tapOn("Email") RUNNING');
    now += 500;
    parser.parseLine('tapOn("Email") COMPLETED');
    now += 200;
    parser.parseLine('tapOn("Submit") RUNNING');
    now += 1200;
    parser.parseLine('tapOn("Submit") FAILED');

    const ts = parser.getCommandTimestamps();
    expect(ts.get('tapOn("Email")')).toEqual({
      startedAt: new Date(1_700_000_000_000),
      endedAt:   new Date(1_700_000_000_500),
    });
    expect(ts.get('tapOn("Submit")')).toEqual({
      startedAt: new Date(1_700_000_000_700),
      endedAt:   new Date(1_700_000_001_900),
    });
  });

  it('uses real clock by default', () => {
    const parser = new MaestroParser({
      onFlowStart: () => {},
      onCommandStatus: () => {},
      onFlowResult: () => {},
      onSummary: () => {},
    });
    parser.parseLine('tapOn("X") RUNNING');
    parser.parseLine('tapOn("X") COMPLETED');
    const ts = parser.getCommandTimestamps().get('tapOn("X")');
    expect(ts?.startedAt).toBeInstanceOf(Date);
    expect(ts?.endedAt).toBeInstanceOf(Date);
  });
});
