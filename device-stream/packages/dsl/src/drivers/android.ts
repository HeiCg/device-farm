import type { HardwareKey, UIElement } from '../types';
import { adb, adbShell } from '../shell';
import type { Driver } from './types';

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
  private readonly baseUrl: string;

  constructor(serial: string, baseUrl = 'http://localhost:9008') {
    this.serial = serial;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      throw new Error(`android-server ${path} ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`android-server ${path} ${res.status}: ${await res.text()}`);
    }
    if (path.startsWith('/screenshot')) {
      return Buffer.from(await res.arrayBuffer());
    }
    return res.json();
  }

  async tap(x: number, y: number): Promise<void> {
    await this.post('/tap', { x, y });
  }

  async longPress(x: number, y: number, durationMs: number): Promise<void> {
    await this.post('/longPress', { x, y, durationMs });
  }

  async typeText(text: string): Promise<void> {
    await this.post('/type', { text });
  }

  async pressKey(key: HardwareKey): Promise<void> {
    const keyCode = ANDROID_KEYCODES[key];
    if (keyCode === undefined) throw new Error(`Unknown Android key: ${key}`);
    await this.post('/key', { keyCode });
  }

  async screenshot(): Promise<Buffer> {
    return (await this.get('/screenshot?quality=80&scale=1')) as Buffer;
  }

  async hierarchy(): Promise<UIElement[]> {
    const raw = (await this.get('/hierarchy?maxElements=200')) as { tree: AndroidHierarchyNode[] };
    return raw.tree.map(toUIElement);
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
    /* HTTP client is stateless; nothing to release */
  }
}

function toUIElement(node: AndroidHierarchyNode): UIElement {
  return {
    id: node.resourceId,
    text: node.text,
    contentDescription: node.contentDesc,
    className: node.className,
    bounds: {
      x: node.bounds.x1,
      y: node.bounds.y1,
      width: node.bounds.x2 - node.bounds.x1,
      height: node.bounds.y2 - node.bounds.y1,
    },
    enabled: node.enabled ?? true,
    selected: node.selected ?? false,
    checked: node.checked,
    focused: node.focused,
  };
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
