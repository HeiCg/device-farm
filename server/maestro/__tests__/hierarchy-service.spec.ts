import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HierarchyResult } from '../internal/hierarchy-service.js';

// Use vi.hoisted so these are available to vi.mock factories (which are hoisted)
const { mockExecFileAsync, mockFetch } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockFetch: vi.fn(),
}));

// Mock child_process.execFile + util.promisify to return our controllable mock
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));

// Mock global fetch for device-server / WDA calls
vi.stubGlobal('fetch', mockFetch);

import { HierarchyService, type HierarchySource } from '../internal/hierarchy-service.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

describe('HierarchyService', () => {
  let service: HierarchyService;
  let logger: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
    service = new HierarchyService(logger);
  });

  // -------------------------------------------------------
  // Source routing
  // -------------------------------------------------------
  describe('source parameter routing', () => {
    it('when source="maestro-cli", calls only maestro-cli strategy', async () => {
      // Maestro 2.x returns JSON
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          attributes: {},
          children: [{
            attributes: { class: 'android.widget.FrameLayout', bounds: '[0,0][1080,2340]' },
            children: [],
            enabled: true,
            clickable: false,
            focused: false,
            checked: false,
            selected: false,
          }],
        }),
      });

      const result = await service.getHierarchy('android', 'emu-1', 5554, 'maestro-cli');

      expect(result.source).toBe('maestro-cli');
      // maestro --device <serial> hierarchy was called (global flag before subcommand in 2.x)
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'maestro',
        ['--device', 'emulator-5554', 'hierarchy'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      // fetch should NOT have been called (device-server skipped)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('when source="device-server", calls only device-server strategy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          className: 'android.widget.FrameLayout',
          children: [],
        }),
      });

      const result = await service.getHierarchy('android', 'emu-1', 5554, 'device-server');

      expect(result.source).toBe('device-server');
      // fetch was called for device-server
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/hierarchy'),
        expect.any(Object),
      );
      // execFileAsync should NOT be called (maestro CLI skipped)
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('when source="native", calls native adb strategy', async () => {
      const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" text="" resource-id="" bounds="[0,0][1080,2340]" enabled="true" clickable="false" focused="false" content-desc="">
    <node class="android.widget.Button" text="OK" resource-id="com.app:id/btn_ok" bounds="[100,200][300,250]" enabled="true" clickable="true" focused="false" content-desc="Confirm" />
  </node>
</hierarchy>`;

      // Native strategy now does: dump to file → cat file → rm file
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'UI hierchary dumped to: /sdcard/window_dump.xml\n' })  // dump
        .mockResolvedValueOnce({ stdout: sampleXml })  // cat
        .mockResolvedValueOnce({ stdout: '' });  // rm (fire-and-forget)

      const result = await service.getHierarchy('android', 'emu-1', 5554, 'native');

      expect(result.source).toBe('native');
      // First call: dump to file
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      // Second call: cat the file
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'cat', '/sdcard/window_dump.xml'],
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      // fetch should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('when source is omitted, uses auto-detection (device-server first, then maestro)', async () => {
      // Simulate device-server failure, then maestro success
      mockFetch.mockRejectedValue(new Error('connection refused'));
      mockExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          attributes: {},
          children: [{
            attributes: { class: 'android.widget.FrameLayout' },
            children: [],
          }],
        }),
      });

      const result = await service.getHierarchy('android', 'emu-1', 5554);

      // Should have tried fetch (device-server) and then fallen back to maestro
      expect(mockFetch).toHaveBeenCalled();
      expect(mockExecFileAsync).toHaveBeenCalled();
      expect(result.source).toBe('maestro-cli');
    });

    it('when source="native" for iOS, throws not-implemented error', async () => {
      await expect(
        service.getHierarchy('ios', 'UDID-123', null, 'native'),
      ).rejects.toThrow('Native iOS hierarchy not yet implemented');
    });
  });

  // -------------------------------------------------------
  // Native XML parsing
  // -------------------------------------------------------
  describe('uiautomator XML parsing', () => {
    it('parses a well-formed uiautomator dump into HierarchyNode tree', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" text="" resource-id="" bounds="[0,0][1080,2340]" enabled="true" clickable="false" focused="false" content-desc="">
    <node class="android.widget.LinearLayout" text="" resource-id="com.app:id/container" bounds="[0,0][1080,2340]" enabled="true" clickable="false" focused="false" content-desc="">
      <node class="android.widget.Button" text="OK" resource-id="com.app:id/btn_ok" bounds="[100,200][300,250]" enabled="true" clickable="true" focused="true" content-desc="Confirm" />
      <node class="android.widget.TextView" text="Hello World" resource-id="" bounds="[50,300][500,350]" enabled="true" clickable="false" focused="false" content-desc="" />
    </node>
  </node>
</hierarchy>`;

      const tree = service.parseUiautomatorXml(xml);

      // Root: FrameLayout
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('android.widget.FrameLayout');
      expect(tree[0].bounds).toEqual([0, 0, 1080, 2340]);

      // Child: LinearLayout
      expect(tree[0].children).toHaveLength(1);
      const container = tree[0].children[0];
      expect(container.type).toBe('android.widget.LinearLayout');
      expect(container.id).toBe('com.app:id/container');

      // Grandchildren: Button + TextView
      expect(container.children).toHaveLength(2);

      const btn = container.children[0];
      expect(btn.type).toBe('android.widget.Button');
      expect(btn.text).toBe('OK');
      expect(btn.id).toBe('com.app:id/btn_ok');
      expect(btn.description).toBe('Confirm');
      expect(btn.clickable).toBe(true);
      expect(btn.focused).toBe(true);
      expect(btn.bounds).toEqual([100, 200, 300, 250]);
      expect(btn.children).toHaveLength(0);

      const tv = container.children[1];
      expect(tv.type).toBe('android.widget.TextView');
      expect(tv.text).toBe('Hello World');
      expect(tv.clickable).toBe(false);
    });

    it('correctly parses bounds string "[0,0][1080,2340]" → [0, 0, 1080, 2340]', () => {
      const xml = `<hierarchy><node class="View" text="" resource-id="" bounds="[0,0][1080,2340]" enabled="true" clickable="false" focused="false" content-desc="" /></hierarchy>`;
      const tree = service.parseUiautomatorXml(xml);

      expect(tree[0].bounds).toEqual([0, 0, 1080, 2340]);
    });

    it('parses self-closing <node .../> elements correctly', () => {
      const xml = `<hierarchy>
        <node class="android.widget.Button" text="Go" resource-id="btn" bounds="[10,20][30,40]" enabled="true" clickable="true" focused="false" content-desc="" />
        <node class="android.widget.Button" text="Stop" resource-id="btn2" bounds="[50,60][70,80]" enabled="false" clickable="false" focused="false" content-desc="" />
      </hierarchy>`;

      const tree = service.parseUiautomatorXml(xml);
      expect(tree).toHaveLength(2);
      expect(tree[0].text).toBe('Go');
      expect(tree[0].enabled).toBe(true);
      expect(tree[1].text).toBe('Stop');
      expect(tree[1].enabled).toBe(false);
    });

    it('handles empty resource-id and text as null', () => {
      const xml = `<hierarchy><node class="View" text="" resource-id="" bounds="[0,0][100,100]" enabled="true" clickable="false" focused="false" content-desc="" /></hierarchy>`;
      const tree = service.parseUiautomatorXml(xml);

      expect(tree[0].id).toBeNull();
      expect(tree[0].text).toBeNull();
      expect(tree[0].description).toBeNull();
    });
  });

  // -------------------------------------------------------
  // XML extraction from uiautomator dump output
  // -------------------------------------------------------
  describe('extractUiautomatorXml', () => {
    it('extracts XML when followed by status line', () => {
      const output = `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0"><node class="View" text="" resource-id="" bounds="[0,0][1080,2340]" enabled="true" clickable="false" focused="false" content-desc="" /></hierarchy>\nUI hierachy dumped to: /dev/tty`;

      const xml = service.extractUiautomatorXml(output);
      expect(xml).toContain('<hierarchy');
      expect(xml).toContain('</hierarchy>');
      expect(xml).not.toContain('dumped to');
    });

    it('throws when output has no XML content', () => {
      expect(() => service.extractUiautomatorXml('Error: device not found')).toThrow('No XML content');
    });
  });
});
