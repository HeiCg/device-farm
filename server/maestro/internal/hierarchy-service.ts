/**
 * HierarchyService — fetches the live UI element tree from a running device.
 *
 * Strategy per platform:
 *  - Android: device-stream android-server `/hierarchy` endpoint (fast, ~100-200ms)
 *    Fallback: `maestro hierarchy --device <serial>` (slower, ~2-3s)
 *  - iOS: WDA `/session/:id/source` endpoint
 *    Fallback: `maestro hierarchy --device <udid>` (slower)
 *
 * Also supports `maestro query` for element search.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pino from 'pino';
import type { Platform } from '../../types/index.js';
import type { AppiumService } from './appium-service.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 15_000;

/** The four hierarchy data sources the user can select */
export type HierarchySource = 'maestro-cli' | 'device-server' | 'native' | 'appium';

export interface HierarchyNode {
  /** Element class/type (e.g. "android.widget.Button", "XCUIElementTypeButton") */
  type: string;
  /** Resource ID (Android) or accessibility identifier (iOS) */
  id: string | null;
  /** Visible text content */
  text: string | null;
  /** Content description (Android) or accessibility label (iOS) */
  description: string | null;
  /** Whether element is enabled for interaction */
  enabled: boolean;
  /** Whether element is visible on screen */
  visible: boolean;
  /** Whether element is focused */
  focused: boolean;
  /** Whether element is clickable/tappable */
  clickable: boolean;
  /** Bounding rect in pixels: [left, top, right, bottom] */
  bounds: [number, number, number, number] | null;
  /** Child elements */
  children: HierarchyNode[];
}

export interface HierarchyResult {
  /** Structured tree */
  tree: HierarchyNode[];
  /** Source of the data: 'device-server' | 'wda' | 'maestro-cli' */
  source: string;
  /** Time taken to fetch in ms */
  fetchTimeMs: number;
  /** Timestamp of capture */
  capturedAt: string;
  /** Total element count */
  elementCount: number;
}

export interface QueryResult {
  /** Matching elements */
  matches: HierarchyNode[];
  /** Query that was executed */
  query: string;
  /** Source of the data */
  source: string;
}

/** Config for device-server endpoints */
export interface DeviceServerConfig {
  /** Port where android device-server is running (default: 9008) */
  androidServerPort: number;
  /** Port where WDA is running for iOS (default: 8100) */
  wdaPort: number;
}

const DEFAULT_SERVER_CONFIG: DeviceServerConfig = {
  androidServerPort: 9008,
  wdaPort: 8100,
};

export class HierarchyService {
  private readonly logger: pino.Logger;
  private readonly serverConfig: DeviceServerConfig;
  private readonly appiumService?: AppiumService;

  constructor(logger: pino.Logger, serverConfig?: Partial<DeviceServerConfig>, appiumService?: AppiumService) {
    this.logger = logger.child({ component: 'hierarchy-service' });
    this.serverConfig = { ...DEFAULT_SERVER_CONFIG, ...serverConfig };
    this.appiumService = appiumService;
  }

  /**
   * Fetch the full UI hierarchy for a device.
   * When `source` is provided, uses that strategy directly.
   * When omitted, tries fast device-server path first, falls back to maestro CLI.
   */
  async getHierarchy(
    platform: Platform,
    deviceId: string,
    port: number | null,
    source?: HierarchySource,
  ): Promise<HierarchyResult> {
    const start = Date.now();

    this.logger.debug({ platform, deviceId, source: source ?? 'auto' }, 'Fetching hierarchy');

    // When a specific source is requested, go directly to that strategy
    if (source) {
      return this.fetchBySource(platform, deviceId, port, source, start);
    }

    // Auto-detection: try fast path first, fall back
    if (platform === 'android') {
      return this.getAndroidHierarchy(deviceId, port, start);
    }
    return this.getIosHierarchy(deviceId, start);
  }

  /**
   * Route to a specific hierarchy strategy by source name.
   */
  private async fetchBySource(
    platform: Platform,
    deviceId: string,
    port: number | null,
    source: HierarchySource,
    startTime: number,
  ): Promise<HierarchyResult> {
    const serial = platform === 'android' && port != null ? `emulator-${port}` : deviceId;

    switch (source) {
      case 'device-server': {
        if (platform === 'android') {
          const result = await this.fetchAndroidDeviceServer();
          if (!result) throw new Error('device-server is not available');
          const fetchTimeMs = Date.now() - startTime;
          return {
            tree: result,
            source: 'device-server',
            fetchTimeMs,
            capturedAt: new Date().toISOString(),
            elementCount: this.countNodes(result),
          };
        }
        // iOS uses WDA as the "device-server" equivalent
        const result = await this.fetchWdaSource();
        if (!result) throw new Error('WDA device-server is not available');
        const fetchTimeMs = Date.now() - startTime;
        return {
          tree: result,
          source: 'wda',
          fetchTimeMs,
          capturedAt: new Date().toISOString(),
          elementCount: this.countNodes(result),
        };
      }

      case 'maestro-cli': {
        const tree = await this.fetchMaestroHierarchy(serial);
        const fetchTimeMs = Date.now() - startTime;
        return {
          tree,
          source: 'maestro-cli',
          fetchTimeMs,
          capturedAt: new Date().toISOString(),
          elementCount: this.countNodes(tree),
        };
      }

      case 'native': {
        return this.fetchNativeHierarchy(platform, deviceId, port, startTime);
      }

      case 'appium': {
        return this.fetchAppiumHierarchy(platform, deviceId, port, startTime);
      }

      default:
        throw new Error(`Unknown hierarchy source: ${source}`);
    }
  }

  /**
   * Query elements matching a text or id pattern.
   */
  async queryElements(
    platform: Platform,
    deviceId: string,
    port: number | null,
    query: { text?: string; id?: string },
  ): Promise<QueryResult> {
    // Try maestro query first (it's the purpose-built tool for this)
    const serial = platform === 'android' && port != null ? `emulator-${port}` : deviceId;
    const queryStr = query.text
      ? `text=${query.text}`
      : query.id
        ? `id=${query.id}`
        : '';

    if (!queryStr) {
      throw new Error('Either text or id must be provided for query');
    }

    try {
      const { stdout } = await execFileAsync(
        'maestro', ['--device', serial, 'query', queryStr],
        { timeout: DEFAULT_TIMEOUT },
      );

      return {
        matches: this.parseMaestroQueryOutput(stdout),
        query: queryStr,
        source: 'maestro-cli',
      };
    } catch (err: any) {
      this.logger.warn({ error: err.message, query: queryStr }, 'maestro query failed, falling back to tree search');

      // Fallback: get full hierarchy and filter
      const hierarchy = await this.getHierarchy(platform, deviceId, port);
      const matches = this.searchTree(hierarchy.tree, query);

      return {
        matches,
        query: queryStr,
        source: `${hierarchy.source}+filter`,
      };
    }
  }

  // --- Native adb/idb strategy ---

  /**
   * Fetch hierarchy via native platform tools (adb uiautomator dump for Android).
   * Returns raw UI hierarchy without requiring Maestro or device-server APK.
   */
  async fetchNativeHierarchy(
    platform: Platform,
    deviceId: string,
    port: number | null,
    startTime: number,
  ): Promise<HierarchyResult> {
    if (platform === 'ios') {
      throw new Error('Native iOS hierarchy not yet implemented');
    }

    const serial = port != null ? `emulator-${port}` : deviceId;
    this.logger.debug({ serial }, 'Fetching native hierarchy via adb uiautomator dump');

    try {
      // Dump to a file on the device (more reliable than /dev/tty for physical devices)
      const remotePath = '/sdcard/window_dump.xml';
      await execFileAsync(
        'adb', ['-s', serial, 'shell', 'uiautomator', 'dump', remotePath],
        { timeout: DEFAULT_TIMEOUT },
      );

      // Read the dumped XML
      const { stdout } = await execFileAsync(
        'adb', ['-s', serial, 'shell', 'cat', remotePath],
        { timeout: DEFAULT_TIMEOUT },
      );

      // Clean up the temp file (fire-and-forget)
      execFileAsync('adb', ['-s', serial, 'shell', 'rm', '-f', remotePath]).catch(() => {});

      // uiautomator dump outputs the XML followed by "UI hierachy dumped to: /dev/tty"
      // Extract just the XML portion
      const xmlContent = this.extractUiautomatorXml(stdout);
      const tree = this.parseUiautomatorXml(xmlContent);
      const fetchTimeMs = Date.now() - startTime;

      return {
        tree,
        source: 'native',
        fetchTimeMs,
        capturedAt: new Date().toISOString(),
        elementCount: this.countNodes(tree),
      };
    } catch (err: any) {
      this.logger.error({ error: err.message, serial }, 'Native hierarchy fetch failed');
      throw new Error(`Failed to fetch native hierarchy for ${serial}: ${err.message}`);
    }
  }

  /**
   * Extract XML content from uiautomator dump stdout.
   * The output may contain the XML followed by a status line.
   */
  extractUiautomatorXml(output: string): string {
    // Find the XML portion — starts with <?xml or <hierarchy
    const xmlStart = output.indexOf('<?xml');
    const altStart = output.indexOf('<hierarchy');
    const start = xmlStart >= 0 ? xmlStart : altStart;

    if (start < 0) {
      throw new Error('No XML content found in uiautomator dump output');
    }

    // XML ends at the last closing tag
    const hierarchyEnd = output.lastIndexOf('</hierarchy>');
    if (hierarchyEnd >= 0) {
      return output.slice(start, hierarchyEnd + '</hierarchy>'.length);
    }

    // Fallback: strip trailing status line
    return output.slice(start).replace(/\nUI hierarch?y dumped to:.*$/i, '').trim();
  }

  /**
   * Parse uiautomator XML dump into HierarchyNode[].
   *
   * The XML format is:
   * ```xml
   * <hierarchy rotation="0">
   *   <node class="..." text="..." resource-id="..." bounds="[l,t][r,b]"
   *         content-desc="..." clickable="true" enabled="true" focused="false" ...>
   *     <node .../>
   *   </node>
   * </hierarchy>
   * ```
   *
   * We parse with a simple regex-based approach since the XML is well-formed
   * and we avoid adding an XML parser dependency.
   */
  parseUiautomatorXml(xml: string): HierarchyNode[] {
    // Use a stack-based parser for the <node> elements
    const nodes: HierarchyNode[] = [];
    const stack: HierarchyNode[] = [];

    // Match opening <node ...>, self-closing <node .../>, and closing </node>
    const tagRegex = /<(node)\s+([^>]*?)\/?>|<\/node>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(xml)) !== null) {
      const fullMatch = match[0];

      if (fullMatch === '</node>') {
        // Closing tag — pop from stack
        if (stack.length > 0) {
          stack.pop();
        }
        continue;
      }

      // Opening or self-closing <node>
      const attrs = match[2];
      const node = this.parseNodeAttributes(attrs);
      const isSelfClosing = fullMatch.endsWith('/>');

      // Add to parent or root
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        nodes.push(node);
      }

      // Push onto stack if not self-closing
      if (!isSelfClosing) {
        stack.push(node);
      }
    }

    return nodes;
  }

  /**
   * Parse attributes from a <node> element's attribute string.
   */
  private parseNodeAttributes(attrs: string): HierarchyNode {
    const get = (name: string): string | null => {
      const re = new RegExp(`${name}="([^"]*)"`, 'i');
      const m = attrs.match(re);
      return m ? m[1] : null;
    };

    const boundsStr = get('bounds');

    return {
      type: get('class') ?? 'Unknown',
      id: get('resource-id') || null,
      text: get('text') || null,
      description: get('content-desc') || null,
      enabled: get('enabled') !== 'false',
      visible: true, // uiautomator only dumps visible elements
      focused: get('focused') === 'true',
      clickable: get('clickable') === 'true',
      bounds: boundsStr ? this.parseAndroidBounds(boundsStr) : null,
      children: [],
    };
  }

  // --- Appium strategy ---

  /**
   * Fetch hierarchy via Appium WebDriver session.
   * Android: getPageSource returns UiAutomator-style XML (same as native dump).
   * iOS: getPageSource returns XCUITest XML with different attribute names.
   */
  private async fetchAppiumHierarchy(
    platform: Platform,
    deviceId: string,
    port: number | null,
    startTime: number,
  ): Promise<HierarchyResult> {
    if (!this.appiumService) {
      throw new Error('Appium is not configured — AppiumService not available');
    }

    const udid = platform === 'android' && port != null ? `emulator-${port}` : deviceId;

    this.logger.debug({ platform, deviceId, udid }, 'Fetching hierarchy via Appium');

    const sessionId = await this.appiumService.getOrCreateSession(platform, deviceId, udid);
    const xml = await this.appiumService.getPageSource(sessionId);

    let tree: HierarchyNode[];
    if (platform === 'android') {
      // Android getPageSource returns the same XML format as uiautomator dump
      const xmlContent = this.extractUiautomatorXml(xml);
      tree = this.parseUiautomatorXml(xmlContent);
    } else {
      // iOS getPageSource returns XCUITest XML
      tree = this.parseXcuiTestXml(xml);
    }

    const fetchTimeMs = Date.now() - startTime;
    return {
      tree,
      source: 'appium',
      fetchTimeMs,
      capturedAt: new Date().toISOString(),
      elementCount: this.countNodes(tree),
    };
  }

  /**
   * Parse iOS XCUITest page source XML into HierarchyNode[].
   *
   * XCUITest XML format:
   * ```xml
   * <AppiumAUT>
   *   <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" ...
   *     x="0" y="0" width="375" height="812">
   *     <XCUIElementTypeButton type="XCUIElementTypeButton" name="loginBtn" label="Log In" ...>
   *     </XCUIElementTypeButton>
   *   </XCUIElementTypeApplication>
   * </AppiumAUT>
   * ```
   */
  parseXcuiTestXml(xml: string): HierarchyNode[] {
    const nodes: HierarchyNode[] = [];
    const stack: HierarchyNode[] = [];

    // Match opening tags with attributes, self-closing tags, and closing tags
    // Skip the root <AppiumAUT> wrapper
    const tagRegex = /<(XCUIElementType\w+|AppiumAUT)\s+([^>]*?)\/?>|<\/(XCUIElementType\w+|AppiumAUT)>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(xml)) !== null) {
      const fullMatch = match[0];

      // Closing tag
      if (fullMatch.startsWith('</')) {
        const tagName = match[3];
        if (tagName !== 'AppiumAUT' && stack.length > 0) {
          stack.pop();
        }
        continue;
      }

      const tagName = match[1];
      const attrs = match[2];
      const isSelfClosing = fullMatch.endsWith('/>');

      // Skip AppiumAUT wrapper
      if (tagName === 'AppiumAUT') {
        if (!isSelfClosing) continue; // just skip, don't push to stack
        continue;
      }

      const node = this.parseXcuiTestAttributes(tagName, attrs);

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        nodes.push(node);
      }

      if (!isSelfClosing) {
        stack.push(node);
      }
    }

    return nodes;
  }

  /**
   * Parse XCUITest element attributes.
   */
  private parseXcuiTestAttributes(tagName: string, attrs: string): HierarchyNode {
    const get = (name: string): string | null => {
      const re = new RegExp(`${name}="([^"]*)"`, 'i');
      const m = attrs.match(re);
      return m ? m[1] : null;
    };

    const x = parseInt(get('x') ?? '0', 10);
    const y = parseInt(get('y') ?? '0', 10);
    const width = parseInt(get('width') ?? '0', 10);
    const height = parseInt(get('height') ?? '0', 10);

    const bounds: [number, number, number, number] | null =
      (width > 0 || height > 0) ? [x, y, x + width, y + height] : null;

    return {
      type: get('type') ?? tagName,
      id: get('name') || null,
      text: get('value') || get('label') || null,
      description: get('label') || null,
      enabled: get('enabled') !== 'false',
      visible: get('visible') !== 'false',
      focused: get('focused') === 'true',
      clickable: get('accessible') === 'true',
      bounds,
      children: [],
    };
  }

  // --- Android ---

  private async getAndroidHierarchy(
    emulatorId: string,
    port: number | null,
    startTime: number,
  ): Promise<HierarchyResult> {
    const serial = port != null ? `emulator-${port}` : emulatorId;

    // Strategy 1: device-stream android-server (fastest, ~100-200ms)
    try {
      const result = await this.fetchAndroidDeviceServer();
      if (result) {
        const fetchTimeMs = Date.now() - startTime;
        return {
          tree: result,
          source: 'device-server',
          fetchTimeMs,
          capturedAt: new Date().toISOString(),
          elementCount: this.countNodes(result),
        };
      }
    } catch (err: any) {
      this.logger.debug({ error: err.message }, 'device-server hierarchy unavailable, trying maestro');
    }

    // Strategy 2: maestro hierarchy (works universally, ~2-3s)
    try {
      const tree = await this.fetchMaestroHierarchy(serial);
      const fetchTimeMs = Date.now() - startTime;
      return {
        tree,
        source: 'maestro-cli',
        fetchTimeMs,
        capturedAt: new Date().toISOString(),
        elementCount: this.countNodes(tree),
      };
    } catch (err: any) {
      this.logger.error({ error: err.message, serial }, 'All hierarchy methods failed for Android');
      throw new Error(`Failed to fetch hierarchy for Android device ${serial}: ${err.message}`);
    }
  }

  /**
   * Fetch from device-stream android-server /hierarchy endpoint.
   * Returns parsed HierarchyNode[] or null if server is not running.
   */
  private async fetchAndroidDeviceServer(): Promise<HierarchyNode[] | null> {
    const url = `http://localhost:${this.serverConfig.androidServerPort}/hierarchy`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return null;

      const data = await resp.json() as any;
      clearTimeout(timeout);

      // device-server returns UiAutomator XML as JSON; normalize to our format
      return this.normalizeAndroidHierarchy(data);
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  /**
   * Normalize android device-server hierarchy response to HierarchyNode format.
   * The server returns UiAutomator's view hierarchy.
   */
  private normalizeAndroidHierarchy(data: any): HierarchyNode[] {
    if (!data) return [];

    // Handle array or single root
    const roots = Array.isArray(data) ? data : data.children ?? [data];

    return roots.map((node: any) => this.normalizeAndroidNode(node));
  }

  private normalizeAndroidNode(node: any): HierarchyNode {
    const bounds = this.parseAndroidBounds(node.bounds ?? node.boundsInScreen);

    return {
      type: node.className ?? node.class ?? node.type ?? 'Unknown',
      id: node.resourceId ?? node.resourceName ?? node['resource-id'] ?? null,
      text: node.text ?? null,
      description: node.contentDescription ?? node['content-desc'] ?? null,
      enabled: node.enabled !== false,
      visible: node.visibleToUser !== false && node.visible !== false,
      focused: node.focused === true,
      clickable: node.clickable === true,
      bounds,
      children: (node.children ?? []).map((child: any) => this.normalizeAndroidNode(child)),
    };
  }

  /**
   * Parse Android bounds string "[left,top][right,bottom]" to [l,t,r,b] array.
   */
  private parseAndroidBounds(bounds: string | any): [number, number, number, number] | null {
    if (!bounds) return null;

    // Array format [l,t,r,b]
    if (Array.isArray(bounds) && bounds.length === 4) {
      return bounds as [number, number, number, number];
    }

    // String format "[l,t][r,b]"
    if (typeof bounds === 'string') {
      const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (match) {
        return [
          parseInt(match[1], 10),
          parseInt(match[2], 10),
          parseInt(match[3], 10),
          parseInt(match[4], 10),
        ];
      }
    }

    return null;
  }

  // --- iOS ---

  private async getIosHierarchy(
    udid: string,
    startTime: number,
  ): Promise<HierarchyResult> {
    // Strategy 1: WDA /session/:id/source (if WDA is running)
    try {
      const result = await this.fetchWdaSource();
      if (result) {
        const fetchTimeMs = Date.now() - startTime;
        return {
          tree: result,
          source: 'wda',
          fetchTimeMs,
          capturedAt: new Date().toISOString(),
          elementCount: this.countNodes(result),
        };
      }
    } catch (err: any) {
      this.logger.debug({ error: err.message }, 'WDA hierarchy unavailable, trying maestro');
    }

    // Strategy 2: maestro hierarchy
    try {
      const tree = await this.fetchMaestroHierarchy(udid);
      const fetchTimeMs = Date.now() - startTime;
      return {
        tree,
        source: 'maestro-cli',
        fetchTimeMs,
        capturedAt: new Date().toISOString(),
        elementCount: this.countNodes(tree),
      };
    } catch (err: any) {
      this.logger.error({ error: err.message, udid }, 'All hierarchy methods failed for iOS');
      throw new Error(`Failed to fetch hierarchy for iOS device ${udid}: ${err.message}`);
    }
  }

  /**
   * Fetch hierarchy from WDA /source endpoint.
   * WDA returns XML; we parse and normalize to HierarchyNode[].
   */
  private async fetchWdaSource(): Promise<HierarchyNode[] | null> {
    const url = `http://localhost:${this.serverConfig.wdaPort}/source`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      // WDA /source can return JSON when Accept: application/json
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) return null;

      const data = await resp.json() as any;
      clearTimeout(timeout);

      // WDA returns { value: { ... tree ... } }
      const tree = data.value ?? data;
      return this.normalizeIosHierarchy(tree);
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private normalizeIosHierarchy(data: any): HierarchyNode[] {
    if (!data) return [];
    const roots = Array.isArray(data) ? data : [data];
    return roots.map((node: any) => this.normalizeIosNode(node));
  }

  private normalizeIosNode(node: any): HierarchyNode {
    const rect = node.rect ?? node.frame;
    let bounds: [number, number, number, number] | null = null;
    if (rect) {
      bounds = [
        rect.x ?? rect.origin?.x ?? 0,
        rect.y ?? rect.origin?.y ?? 0,
        (rect.x ?? 0) + (rect.width ?? rect.size?.width ?? 0),
        (rect.y ?? 0) + (rect.height ?? rect.size?.height ?? 0),
      ];
    }

    return {
      type: node.type ?? node.elementType ?? 'Unknown',
      id: node.identifier ?? node.name ?? null,
      text: node.label ?? node.value ?? null,
      description: node.label ?? null,
      enabled: node.isEnabled !== false && node.enabled !== false,
      visible: node.isVisible !== false && node.visible !== false,
      focused: node.hasFocus === true || node.focused === true,
      clickable: node.isAccessible !== false,
      bounds,
      children: (node.children ?? []).map((child: any) => this.normalizeIosNode(child)),
    };
  }

  // --- Maestro CLI fallback ---

  /**
   * Run `maestro --device <serial> hierarchy` and parse the JSON output.
   * In Maestro >=2.x, --device is a global flag (before the subcommand)
   * and hierarchy outputs structured JSON.
   */
  private async fetchMaestroHierarchy(deviceSerial: string): Promise<HierarchyNode[]> {
    const { stdout } = await execFileAsync(
      'maestro', ['--device', deviceSerial, 'hierarchy'],
      { timeout: DEFAULT_TIMEOUT },
    );

    // Maestro 2.x outputs JSON; try to parse it first
    try {
      const data = JSON.parse(stdout);
      return this.normalizeMaestroJson(data);
    } catch {
      // Fallback: legacy text-based output (Maestro 1.x)
      return this.parseMaestroHierarchyOutput(stdout);
    }
  }

  /**
   * Normalize Maestro 2.x JSON hierarchy output to HierarchyNode[].
   * Maestro outputs: { attributes: {}, children: [ { attributes: {...}, children: [...], clickable, enabled, ... } ] }
   */
  private normalizeMaestroJson(data: any): HierarchyNode[] {
    if (!data) return [];
    // Root node wraps the tree — process its children
    const roots = data.children ?? (Array.isArray(data) ? data : [data]);
    return roots.map((node: any) => this.normalizeMaestroNode(node));
  }

  private normalizeMaestroNode(node: any): HierarchyNode {
    const attrs = node.attributes ?? {};
    const boundsStr = attrs.bounds ?? attrs.boundsInScreen;

    return {
      type: attrs.class ?? attrs.className ?? 'Unknown',
      id: attrs['resource-id'] ?? attrs.resourceId ?? null,
      text: attrs.text || attrs.accessibilityText || null,
      description: attrs.hintText || attrs['content-desc'] || null,
      enabled: node.enabled ?? attrs.enabled === 'true',
      visible: true,
      focused: node.focused ?? attrs.focused === 'true',
      clickable: node.clickable ?? attrs.clickable === 'true',
      bounds: boundsStr ? this.parseAndroidBounds(boundsStr) : null,
      children: (node.children ?? []).map((child: any) => this.normalizeMaestroNode(child)),
    };
  }

  /**
   * Parse maestro hierarchy text output into structured nodes.
   * The output format is indented lines like:
   *   ClassName - text: "Hello" id: "btn_ok" bounds: [0,0][100,50]
   */
  private parseMaestroHierarchyOutput(output: string): HierarchyNode[] {
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    const root: HierarchyNode[] = [];
    const stack: Array<{ node: HierarchyNode; indent: number }> = [];

    for (const line of lines) {
      const indent = line.search(/\S/);
      if (indent < 0) continue;

      const content = line.trim();
      const node = this.parseMaestroLine(content);

      // Pop stack until we find the parent level
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, indent });
    }

    return root;
  }

  /**
   * Parse a single maestro hierarchy line.
   */
  private parseMaestroLine(line: string): HierarchyNode {
    // Try to extract className, text, id, bounds from the line
    const typeMatch = line.match(/^(\S+)/);
    const textMatch = line.match(/text:\s*"([^"]*)"/);
    const idMatch = line.match(/id:\s*"([^"]*)"/);
    const boundsMatch = line.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

    return {
      type: typeMatch?.[1] ?? 'Unknown',
      id: idMatch?.[1] ?? null,
      text: textMatch?.[1] ?? null,
      description: null,
      enabled: true,
      visible: true,
      focused: false,
      clickable: false,
      bounds: boundsMatch
        ? [
            parseInt(boundsMatch[1], 10),
            parseInt(boundsMatch[2], 10),
            parseInt(boundsMatch[3], 10),
            parseInt(boundsMatch[4], 10),
          ]
        : null,
      children: [],
    };
  }

  /**
   * Parse maestro query output into HierarchyNode[].
   */
  private parseMaestroQueryOutput(output: string): HierarchyNode[] {
    // maestro query outputs matching elements, similar format to hierarchy but flat
    return this.parseMaestroHierarchyOutput(output);
  }

  // --- Tree utilities ---

  /**
   * Search a hierarchy tree for elements matching a query.
   */
  private searchTree(
    nodes: HierarchyNode[],
    query: { text?: string; id?: string },
  ): HierarchyNode[] {
    const results: HierarchyNode[] = [];

    const walk = (node: HierarchyNode) => {
      let matches = true;

      if (query.text) {
        const pattern = new RegExp(query.text, 'i');
        const hasText = (node.text && pattern.test(node.text)) ||
                       (node.description && pattern.test(node.description));
        if (!hasText) matches = false;
      }

      if (query.id) {
        const pattern = new RegExp(query.id, 'i');
        if (!node.id || !pattern.test(node.id)) matches = false;
      }

      if (matches && (query.text || query.id)) {
        results.push({ ...node, children: [] }); // Return match without children
      }

      for (const child of node.children) {
        walk(child);
      }
    };

    for (const root of nodes) {
      walk(root);
    }

    return results;
  }

  /**
   * Count total nodes in a tree.
   */
  private countNodes(nodes: HierarchyNode[]): number {
    let count = 0;
    const walk = (node: HierarchyNode) => {
      count++;
      for (const child of node.children) walk(child);
    };
    for (const root of nodes) walk(root);
    return count;
  }
}
