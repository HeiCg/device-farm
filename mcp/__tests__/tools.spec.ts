/**
 * Tool routing spec — Phase 34 Plan 34-05.
 *
 * Verifies each of the 12 tool registrars wires its handler to the right
 * DeviceFarmClient method with parsed input args. Uses a fake McpServer that
 * captures the (name, config, handler) tuple from each registerTool call and
 * a stubbed DeviceFarmClient with vi.fn() spies.
 *
 * We test routing semantics, not MCP protocol — the protocol smoke lives in
 * `index.spec.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { DeviceFarmClient } from '../src/client.js';
import { registerDeviceLease } from '../src/tools/device-lease.js';
import { registerDeviceRelease } from '../src/tools/device-release.js';
import { registerDeviceList } from '../src/tools/device-list.js';
import { registerDeviceTap } from '../src/tools/device-tap.js';
import { registerDeviceTapByDescription } from '../src/tools/device-tap-by-description.js';
import { registerDeviceType } from '../src/tools/device-type.js';
import { registerDeviceSwipe } from '../src/tools/device-swipe.js';
import { registerDeviceKey } from '../src/tools/device-key.js';
import { registerDeviceScreenshot } from '../src/tools/device-screenshot.js';
import { registerDeviceInstall } from '../src/tools/device-install.js';
import { registerDeviceLaunch } from '../src/tools/device-launch.js';
import { registerDeviceUninstall } from '../src/tools/device-uninstall.js';
import { registerAllTools, TOOL_NAMES } from '../src/tools/index.js';

interface CapturedTool {
  name: string;
  config: { title?: string; description?: string; inputSchema?: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<{ content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }>;
}

function fakeServer(): { capturedTools: CapturedTool[]; registerTool: ReturnType<typeof vi.fn> } {
  const capturedTools: CapturedTool[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerTool = vi.fn((name: string, config: any, handler: any) => {
    capturedTools.push({ name, config, handler });
  });
  return { capturedTools, registerTool };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asServer(s: { registerTool: any }): any {
  return s;
}

function fakeClient(overrides: Partial<DeviceFarmClient> = {}): DeviceFarmClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any = {
    opts: { baseUrl: 'http://test', token: 'tok' },
    lease: vi.fn().mockResolvedValue({
      sessionId: '11111111-1111-1111-1111-111111111111',
      deviceId: '22222222-2222-2222-2222-222222222222',
      deviceName: 'pixel-8',
      platform: 'android',
      wsUrl: 'ws://test/ws',
      leaseUntil: '2030-01-01T00:00:00Z',
      ttlSeconds: 600,
    }),
    release: vi.fn().mockResolvedValue({ sessionId: '11111111-1111-1111-1111-111111111111', released: true }),
    listDevices: vi.fn().mockResolvedValue({ devices: [] }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    sendAction: vi.fn().mockResolvedValue(null),
    closeAll: vi.fn().mockResolvedValue(undefined),
  };
  return Object.assign(base, overrides) as unknown as DeviceFarmClient;
}

describe('@device-stream/mcp tool routing (Plan 34-05)', () => {
  it('registerAllTools registers exactly 12 tools in the expected order', () => {
    const s = fakeServer();
    registerAllTools(asServer(s), fakeClient());
    expect(s.capturedTools).toHaveLength(12);
    expect(s.capturedTools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('device_lease forwards args to client.lease()', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceLease(asServer(s), c);
    const { handler } = s.capturedTools[0];
    const result = await handler({ platform: 'android', ttlSeconds: 900 });
    expect(c.lease).toHaveBeenCalledWith(expect.objectContaining({ platform: 'android', ttlSeconds: 900 }));
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('pixel-8');
  });

  it('device_release forwards sessionId to client.release()', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceRelease(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: '11111111-1111-1111-1111-111111111111' });
    expect(c.release).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('device_list forwards to client.listDevices()', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceList(asServer(s), c);
    const { handler } = s.capturedTools[0];
    const result = await handler({});
    expect(c.listDevices).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
  });

  it('device_tap forwards x/y as a tap envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceTap(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', x: 10, y: 20 });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'tap', x: 10, y: 20 }));
  });

  it('device_tap_by_description forwards target as a tapByDescription envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceTapByDescription(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', target: 'Sign In button' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'tapByDescription', target: 'Sign In button' }));
  });

  it('device_type forwards text as a type envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceType(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', text: 'hello' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'type', text: 'hello' }));
  });

  it('device_swipe forwards coordinates + optional duration', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceSwipe(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', x1: 0, y1: 0, x2: 100, y2: 200, durationMs: 750 });
    expect(c.sendAction).toHaveBeenCalledWith(
      'abc',
      expect.objectContaining({ type: 'swipe', x1: 0, y1: 0, x2: 100, y2: 200, durationMs: 750 }),
    );
  });

  it('device_swipe omits durationMs when not provided (server default applies)', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceSwipe(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', x1: 0, y1: 0, x2: 100, y2: 200 });
    const callArgs = (c.sendAction as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.durationMs).toBeUndefined();
  });

  it('device_key forwards key code', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceKey(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', code: 'home' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'key', code: 'home' }));
  });

  it('device_install forwards artifactId as installApp envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceInstall(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', artifactId: 'art-1' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'installApp', artifactId: 'art-1' }));
  });

  it('device_launch forwards bundleId as launchApp envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceLaunch(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', bundleId: 'com.app' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'launchApp', bundleId: 'com.app' }));
  });

  it('device_uninstall forwards bundleId as uninstallApp envelope', async () => {
    const s = fakeServer();
    const c = fakeClient();
    registerDeviceUninstall(asServer(s), c);
    const { handler } = s.capturedTools[0];
    await handler({ sessionId: 'abc', bundleId: 'com.app' });
    expect(c.sendAction).toHaveBeenCalledWith('abc', expect.objectContaining({ type: 'uninstallApp', bundleId: 'com.app' }));
  });

  it('device_screenshot returns image + text content blocks from a fetched PNG', async () => {
    const s = fakeServer();
    // Minimal 1x1 PNG (8-byte signature + IHDR + IDAT + IEND). Bytes don't
    // need to be a valid image — the tool just base64-encodes whatever it
    // gets and forwards.
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(fakePng, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );
    try {
      const c = fakeClient({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendAction: vi.fn().mockResolvedValue({
          artifactId: 'art-shot',
          url: 'http://test/artifacts/art-shot.png',
          width: 1080,
          height: 1920,
        }) as any,
      });
      registerDeviceScreenshot(asServer(s), c);
      const { handler } = s.capturedTools[0];
      const result = await handler({ sessionId: 'abc' });
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(typeof result.content[0].data).toBe('string');
      expect(result.content[1].type).toBe('text');
      expect(result.content[1].text).toContain('1080x1920');
      expect(result.content[1].text).toContain('art-shot');
      expect(fetchSpy).toHaveBeenCalledWith('http://test/artifacts/art-shot.png', expect.any(Object));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('error path: tool returns isError:true on client method rejection', async () => {
    const s = fakeServer();
    const c = fakeClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendAction: vi.fn().mockRejectedValue(new Error('boom')) as any,
    });
    registerDeviceTap(asServer(s), c);
    const { handler } = s.capturedTools[0];
    const result = await handler({ sessionId: 'abc', x: 1, y: 2 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });
});
