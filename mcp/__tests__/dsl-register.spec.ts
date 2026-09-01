/**
 * DSL tool wiring spec — verifies registerDslTools registers every DSL tool on
 * the MCP server and that each handler resolves a session lazily then dispatches.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerDslTools, memoizeSession } from '../src/dsl/register.js';
import { DSL_TOOL_NAMES } from '../src/dsl/registry.js';
import { SCRIPT_TOOL_NAME } from '../src/dsl/script-tool.js';

interface Captured {
  name: string;
  config: { description?: string; inputSchema?: Record<string, unknown> };
  handler: (args: unknown) => Promise<unknown>;
}

function fakeServer(): { captured: Captured[]; registerTool: ReturnType<typeof vi.fn> } {
  const captured: Captured[] = [];
  const registerTool = vi.fn((name: string, config: any, handler: any) => {
    captured.push({ name, config, handler });
  });
  return { captured, registerTool };
}

describe('registerDslTools', () => {
  it('registers every DSL tool by name, plus the script tool', () => {
    const srv = fakeServer();
    registerDslTools(srv as any, async () => ({}) as any);
    expect(srv.captured.map((c) => c.name).sort()).toEqual(
      [...DSL_TOOL_NAMES, SCRIPT_TOOL_NAME].sort(),
    );
  });

  it('resolves the session lazily and dispatches to it on call', async () => {
    const srv = fakeServer();
    const tapOn = vi.fn(async () => {});
    const getSession = vi.fn(async () => ({ tapOn }) as any);
    registerDslTools(srv as any, getSession);

    expect(getSession).not.toHaveBeenCalled(); // lazy — not on registration
    const tapTool = srv.captured.find((c) => c.name === 'dsl_tap')!;
    await tapTool.handler({ selector: { text: 'Buy' } });
    expect(getSession).toHaveBeenCalledOnce();
    expect(tapOn).toHaveBeenCalledWith({ text: 'Buy' });
  });
});

describe('memoizeSession', () => {
  it('does not cache a rejected session promise — a transient failure recovers', async () => {
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient connect fail');
      return { serial: 'recovered' } as any;
    });
    const memo = memoizeSession(factory);

    await expect(memo()).rejects.toThrow('transient connect fail');
    const session = await memo();
    expect(session.serial).toBe('recovered');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('caches a resolved session across calls', async () => {
    const factory = vi.fn(async () => ({ serial: 'stable' }) as any);
    const memo = memoizeSession(factory);
    const a = await memo();
    const b = await memo();
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledOnce();
  });
});
