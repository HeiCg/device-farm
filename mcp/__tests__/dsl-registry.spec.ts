/**
 * DSL→MCP tool registry spec.
 *
 * Verifies the DSL-backed tools map cleanly onto @device-stream/dsl session
 * verbs (rich selectors, scroll-until-visible, describe, fill, flow replay).
 * Uses a fake DeviceStreamSession with vi.fn() spies — no device, no SDK.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildDslToolRegistry, getDslTool } from '../src/dsl/registry.js';

function fakeSession(over: Record<string, unknown> = {}): any {
  const fill = vi.fn(async () => {});
  const longPress = vi.fn(async () => {});
  return {
    serial: 'emulator-5554',
    platform: 'android',
    tapOn: vi.fn(async () => {}),
    get: vi.fn(() => ({ fill, longPress })),
    _fill: fill,
    copyText: vi.fn(async () => 'hello'),
    pressKey: vi.fn(async () => {}),
    swipe: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    scrollUntilVisible: vi.fn(async () => ({ id: 'btn', text: 'Buy', bounds: { x: 0, y: 0, width: 1, height: 1 }, enabled: true, selected: false })),
    waitForIdle: vi.fn(async () => {}),
    describeText: vi.fn(async () => 'Window\n  Button "Buy" @5,5'),
    screenshot: vi.fn(async () => Buffer.from('PNGBYTES')),
    launchApp: vi.fn(async () => {}),
    stopApp: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    installApp: vi.fn(async () => {}),
    grantPermissions: vi.fn(async () => {}),
    setLocation: vi.fn(async () => {}),
    ...over,
  };
}

describe('buildDslToolRegistry', () => {
  it('exposes the rich DSL verbs that the legacy pixel tools lack', () => {
    const names = buildDslToolRegistry().map((t) => t.name);
    for (const expected of [
      'dsl_tap', 'dsl_fill', 'dsl_scroll', 'dsl_scroll_until_visible',
      'dsl_describe', 'dsl_screenshot', 'dsl_press_key', 'dsl_run_flow',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('every tool has a description and an inputSchema object', () => {
    for (const tool of buildDslToolRegistry()) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe('object');
    }
  });
});

describe('DSL tool execution', () => {
  it('dsl_tap forwards the selector to session.tapOn', async () => {
    const s = fakeSession();
    await getDslTool('dsl_tap')!.execute(s, { selector: { text: { contains: 'Buy' } } });
    expect(s.tapOn).toHaveBeenCalledWith({ text: { contains: 'Buy' } });
  });

  it('dsl_fill taps the selector then types the text', async () => {
    const s = fakeSession();
    await getDslTool('dsl_fill')!.execute(s, { selector: { id: 'email' }, text: 'a@b.com' });
    expect(s.get).toHaveBeenCalledWith({ id: 'email' });
    expect(s._fill).toHaveBeenCalledWith('a@b.com');
  });

  it('dsl_scroll_until_visible returns the found element as text', async () => {
    const s = fakeSession();
    const res = await getDslTool('dsl_scroll_until_visible')!.execute(s, { selector: { text: 'Buy' }, direction: 'down' });
    expect(s.scrollUntilVisible).toHaveBeenCalledWith({ text: 'Buy' }, { direction: 'down', maxScrolls: undefined });
    expect(JSON.stringify(res)).toContain('Buy');
  });

  it('dsl_describe returns the rendered outline text', async () => {
    const s = fakeSession();
    const res = await getDslTool('dsl_describe')!.execute(s, {});
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toContain('Buy');
  });

  it('dsl_screenshot returns an image content block', async () => {
    const s = fakeSession();
    const res = await getDslTool('dsl_screenshot')!.execute(s, {});
    expect(res.content[0].type).toBe('image');
    expect(res.content[0].mimeType).toBe('image/png');
    expect(res.content[0].data).toBe(Buffer.from('PNGBYTES').toString('base64'));
  });

  it('dsl_run_flow parses YAML and replays each step', async () => {
    const s = fakeSession();
    const flowYaml = [
      'name: t',
      'steps:',
      '  - action: tapOn',
      '    args: {"selector":{"text":"Buy"}}',
      '  - action: pressKey',
      '    args: {"key":"enter"}',
    ].join('\n');
    await getDslTool('dsl_run_flow')!.execute(s, { flowYaml });
    expect(s.tapOn).toHaveBeenCalledWith({ text: 'Buy' });
    expect(s.pressKey).toHaveBeenCalledWith('enter');
  });

  it('returns isError content when the session throws', async () => {
    const s = fakeSession({ tapOn: vi.fn(async () => { throw new Error('boom'); }) });
    const res = await getDslTool('dsl_tap')!.execute(s, { selector: { text: 'x' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('boom');
  });
});
