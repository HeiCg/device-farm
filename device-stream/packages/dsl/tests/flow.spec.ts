import { describe, it, expect, vi } from 'vitest';
import { serializeFlow, parseFlow, executeFlow, FlowRecorder, type Flow } from '../src/flow';

const FLOW: Flow = {
  name: 'checkout',
  steps: [
    { action: 'launchApp', args: { id: 'com.example' } },
    { action: 'tapOn', args: { selector: { text: 'Buy' } } },
    { action: 'fill', args: { selector: { id: 'qty' }, text: '3' } },
    { action: 'scroll', args: { direction: 'down' } },
    { action: 'scrollUntilVisible', args: { selector: { text: 'Place order' } } },
    { action: 'pressKey', args: { key: 'enter' } },
  ],
};

describe('serializeFlow / parseFlow', () => {
  it('round-trips a flow through YAML', () => {
    const yaml = serializeFlow(FLOW);
    expect(yaml).toContain('name: checkout');
    expect(yaml).toContain('- action: tapOn');
    expect(parseFlow(yaml)).toEqual(FLOW);
  });

  it('produces valid YAML with JSON-inline args (human readable)', () => {
    const yaml = serializeFlow(FLOW);
    expect(yaml).toContain('args: {"selector":{"text":"Buy"}}');
  });
});

describe('executeFlow', () => {
  it('dispatches each step to the matching session method', async () => {
    const fill = vi.fn(async () => {});
    const get = vi.fn(() => ({ fill }));
    const session: any = {
      launchApp: vi.fn(async () => {}),
      tapOn: vi.fn(async () => {}),
      get,
      scroll: vi.fn(async () => {}),
      scrollUntilVisible: vi.fn(async () => ({})),
      pressKey: vi.fn(async () => {}),
    };
    await executeFlow(session, FLOW);
    expect(session.launchApp).toHaveBeenCalledWith('com.example');
    expect(session.tapOn).toHaveBeenCalledWith({ text: 'Buy' });
    expect(get).toHaveBeenCalledWith({ id: 'qty' });
    expect(fill).toHaveBeenCalledWith('3');
    expect(session.scroll).toHaveBeenCalledWith('down');
    expect(session.scrollUntilVisible).toHaveBeenCalledWith({ text: 'Place order' });
    expect(session.pressKey).toHaveBeenCalledWith('enter');
  });

  it('throws on an unknown action', async () => {
    await expect(executeFlow({} as any, { name: 'x', steps: [{ action: 'frobnicate', args: {} }] }))
      .rejects.toThrow(/unknown flow action/i);
  });
});

describe('FlowRecorder', () => {
  it('records actions while forwarding them to the live session', async () => {
    const session: any = {
      launchApp: vi.fn(async () => {}),
      tapOn: vi.fn(async () => {}),
    };
    const rec = new FlowRecorder(session, 'login');
    await rec.launchApp('com.example');
    await rec.tapOn({ text: 'Sign In' });
    const flow = rec.finish();

    expect(session.launchApp).toHaveBeenCalledWith('com.example');
    expect(session.tapOn).toHaveBeenCalledWith({ text: 'Sign In' });
    expect(flow).toEqual({
      name: 'login',
      steps: [
        { action: 'launchApp', args: { id: 'com.example' } },
        { action: 'tapOn', args: { selector: { text: 'Sign In' } } },
      ],
    });
  });
});
