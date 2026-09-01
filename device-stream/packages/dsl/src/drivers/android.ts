import type { HardwareKey, ScreenshotOptions, UIElement } from '../types';
import { adb, adbShell } from '../shell';
import type { Driver } from './types';
import { AndroidRpcClient, parseAndroidServerEndpoint } from './android-rpc';

interface AndroidHierarchyNode {
  index: number;
  className?: string;
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  clickable?: boolean;
  scrollable?: boolean;
  focused?: boolean;
  enabled?: boolean;
  checked?: boolean;
  selected?: boolean;
}

const ANDROID_KEYCODES: Record<HardwareKey, number> = {
  back: 4,
  home: 3,
  menu: 82,
  enter: 66,
  volumeUp: 24,
  volumeDown: 25,
  power: 26,
};

export class AndroidDriver implements Driver {
  readonly platform = 'android' as const;
  readonly serial: string;
  private readonly rpc: AndroidRpcClient;

  /**
   * @param serverUrl address of `@device-stream/android-server`. Accepts
   *   `host:port` (preferred) or, for backward compatibility, a legacy
   *   `http://host:port` URL whose scheme is ignored — the server speaks TCP
   *   JSON-RPC, not HTTP. Defaults to `localhost:9008`.
   */
  constructor(serial: string, serverUrl?: string) {
    this.serial = serial;
    const { host, port } = parseAndroidServerEndpoint(serverUrl);
    this.rpc = new AndroidRpcClient(host, port);
  }

  async tap(x: number, y: number): Promise<void> {
    await this.rpc.call('tap', { x, y });
  }

  async longPress(x: number, y: number, durationMs: number): Promise<void> {
    await this.rpc.call('longPress', { x, y, durationMs });
  }

  async swipe(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): Promise<void> {
    // android-server's swipe is parameterised by step count, not duration.
    // UiAutomator dispatches ~5ms per step, so map duration -> steps.
    const steps = Math.max(1, Math.round(durationMs / 5));
    await this.rpc.call('swipe', { startX: fromX, startY: fromY, endX: toX, endY: toY, steps });
  }

  async screenSize(): Promise<{ width: number; height: number }> {
    const info = (await this.rpc.call('getInfo')) as { screenWidth?: number; screenHeight?: number };
    if (typeof info.screenWidth !== 'number' || typeof info.screenHeight !== 'number') {
      throw new Error('android-server getInfo did not return screenWidth/screenHeight');
    }
    return { width: info.screenWidth, height: info.screenHeight };
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    await this.rpc.call('waitForIdle', { timeoutMs });
  }

  async typeText(text: string): Promise<void> {
    await this.rpc.call('typeText', { text });
  }

  async pressKey(key: HardwareKey): Promise<void> {
    const keyCode = ANDROID_KEYCODES[key];
    if (keyCode === undefined) throw new Error(`Unknown Android key: ${key}`);
    await this.rpc.call('key', { keyCode });
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> {
    // android-server downscales the bitmap capture-side via the `scale`
    // param, so a low scale shrinks the encoded JPEG before it ever leaves the
    // device. Clamp to (0, 1]; default 1 preserves prior behavior for callers
    // that don't ask (the MCP layer passes 0.25). The reply carries the image
    // as base64 in `result.data`; decode to a Buffer for the public API.
    const scale = Math.min(1, Math.max(0.01, opts?.scale ?? 1));
    const res = (await this.rpc.call('screenshot', { quality: 80, scale })) as { data?: string };
    if (typeof res.data !== 'string') {
      throw new Error('android-server screenshot did not return base64 data');
    }
    return Buffer.from(res.data, 'base64');
  }

  async hierarchy(): Promise<UIElement[]> {
    const raw = (await this.rpc.call('getAccessibilityTree', { maxElements: 200 })) as {
      tree: AndroidHierarchyNode[];
    };
    // android-server returns a flat, visibility-less node list. Derive `visible`
    // from bounds and reconstruct containment so `describeElements` can prune the
    // same way it does for the natively-nested iOS tree.
    const display = displayBoundsFor(raw.tree);
    const flat = raw.tree.map((node) => toUIElement(node, display));
    return reconstructHierarchy(flat);
  }

  async openUrl(url: string): Promise<void> {
    await adbShell(this.serial, ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  async openDownloads(): Promise<void> {
    await adbShell(this.serial, [
      'am', 'start',
      '-a', 'android.intent.action.VIEW',
      '-d', 'content://com.android.externalstorage.documents/root/primary%3ADownload',
      '-t', 'resource/folder',
    ]);
  }

  async launchApp(packageName: string): Promise<void> {
    await adbShell(this.serial, ['monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
  }

  async stopApp(packageName: string): Promise<void> {
    await adbShell(this.serial, ['am', 'force-stop', packageName]);
  }

  async installApp(apkPath: string): Promise<void> {
    await adb(this.serial, ['install', '-r', '-g', apkPath], 180_000);
  }

  async enableInstallByThirdParty(packageName: string): Promise<void> {
    await adbShell(this.serial, [
      'appops', 'set', packageName, 'REQUEST_INSTALL_PACKAGES', 'allow',
    ]);
  }

  async grantPermissions(packageName: string, permissions: string[] | '*'): Promise<void> {
    if (permissions === '*') {
      const { stdout } = await adbShell(this.serial, ['dumpsys', 'package', packageName]);
      const declared = parseRequestedPermissions(stdout);
      for (const perm of declared) {
        await adbShell(this.serial, ['pm', 'grant', packageName, perm]).catch(() => {});
      }
      return;
    }
    for (const perm of permissions) {
      await adbShell(this.serial, ['pm', 'grant', packageName, perm]);
    }
  }

  async setLocation(latitude: number, longitude: number): Promise<void> {
    // `adb emu geo fix` only works against emulators that have the geo console
    // enabled. Real Android devices have no general "set location" without an
    // installed mock-location provider; surface that limitation explicitly.
    await adb(this.serial, ['emu', 'geo', 'fix', String(longitude), String(latitude)]);
  }

  async close(): Promise<void> {
    this.rpc.close();
  }
}

/** Rectangle in the same coordinate space as {@link UIElement.bounds}. */
type Rect = UIElement['bounds'];

/**
 * Map one flat android-server node to a {@link UIElement}. `display` is the
 * screen rectangle used to derive `visible` (see {@link isBoundsVisible}).
 */
export function toUIElement(node: AndroidHierarchyNode, display: Rect): UIElement {
  const bounds: Rect = {
    x: node.bounds.x1,
    y: node.bounds.y1,
    width: node.bounds.x2 - node.bounds.x1,
    height: node.bounds.y2 - node.bounds.y1,
  };
  return {
    id: node.resourceId,
    text: node.text,
    contentDescription: node.contentDesc,
    className: node.className,
    bounds,
    enabled: node.enabled ?? true,
    selected: node.selected ?? false,
    checked: node.checked,
    focused: node.focused,
    visible: isBoundsVisible(bounds, display),
  };
}

/**
 * A node is visible iff it has non-zero area AND intersects the display. The
 * android-server payload carries no visibility flag, so this is derived from
 * `getBoundsInScreen` geometry alone.
 */
export function isBoundsVisible(b: Rect, display: Rect): boolean {
  if (b.width <= 0 || b.height <= 0) return false;
  return (
    b.x < display.x + display.width &&
    b.x + b.width > display.x &&
    b.y < display.y + display.height &&
    b.y + b.height > display.y
  );
}

/**
 * The display rectangle for a flat android-server tree. The device display size
 * is not carried in the `/hierarchy` payload, so we take the largest-area node
 * (the full-screen decor/root container) as the display; offscreen nodes fall
 * outside it and are ruled invisible. Falls back to an empty rect.
 */
export function displayBoundsFor(nodes: AndroidHierarchyNode[]): Rect {
  let best: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let bestArea = -1;
  for (const n of nodes) {
    const w = n.bounds.x2 - n.bounds.x1;
    const h = n.bounds.y2 - n.bounds.y1;
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { x: n.bounds.x1, y: n.bounds.y1, width: w, height: h };
    }
  }
  return best;
}

/**
 * Reconstruct a containment forest from a flat, document-ordered element list by
 * bounds nesting: each element's parent is the smallest-area element that fully
 * contains it (ties broken by document order — the earlier node is the parent).
 * Used only so the "anonymous container" pruning heuristic in `describeElements`
 * has the hierarchy it needs; the returned nodes are the same objects with their
 * `children` arrays populated, and only roots are returned.
 */
export function reconstructHierarchy(elements: UIElement[]): UIElement[] {
  const area = (e: UIElement): number => e.bounds.width * e.bounds.height;
  const contains = (a: UIElement, b: UIElement): boolean =>
    a.bounds.x <= b.bounds.x &&
    a.bounds.y <= b.bounds.y &&
    a.bounds.x + a.bounds.width >= b.bounds.x + b.bounds.width &&
    a.bounds.y + a.bounds.height >= b.bounds.y + b.bounds.height;

  for (const el of elements) el.children = [];
  const roots: UIElement[] = [];

  for (let i = 0; i < elements.length; i++) {
    const child = elements[i];
    let parent: UIElement | undefined;
    let parentArea = Infinity;
    for (let j = 0; j < elements.length; j++) {
      if (i === j) continue;
      const cand = elements[j];
      if (!contains(cand, child)) continue;
      const ca = area(cand);
      const cha = area(child);
      // A parent must be at least as large; equal-area containers only qualify
      // when they precede the child in document order (avoids mutual parenting).
      if (ca < cha) continue;
      if (ca === cha && j > i) continue;
      if (ca < parentArea) {
        parent = cand;
        parentArea = ca;
      }
    }
    if (parent) parent.children!.push(child);
    else roots.push(child);
  }
  return roots;
}

function parseRequestedPermissions(dumpsysOutput: string): string[] {
  const result: string[] = [];
  const lines = dumpsysOutput.split('\n');
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'requested permissions:') {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (trimmed.startsWith('android.permission.') || trimmed.includes('.permission.')) {
        const perm = trimmed.split(':')[0]?.trim();
        if (perm && perm.includes('.permission.')) result.push(perm);
      } else if (trimmed === '' || trimmed.endsWith(':')) {
        break;
      }
    }
  }
  return result;
}
