import type {
  DeviceStreamSession,
  ElementHandle,
  WaitHandle,
} from './index';
import type {
  HardwareKey,
  SessionOptions,
  Selector,
  UIElement,
} from './types';
import { ElementNotFoundError } from './types';
import type { Driver } from './drivers/types';
import { AndroidDriver } from './drivers/android';
import { IOSDriver } from './drivers/ios';
import { centerOf, elementMatches, findElement } from './selectors/matcher';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 250;

export class DeviceStreamSessionImpl implements DeviceStreamSession {
  readonly serial: string;
  readonly platform: 'android' | 'ios';
  private readonly driver: Driver;
  private readonly defaultTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(driver: Driver, opts: SessionOptions) {
    this.driver = driver;
    this.serial = driver.serial;
    this.platform = driver.platform;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  async openUrl(url: string): Promise<void> { return this.driver.openUrl(url); }
  async openDownloads(): Promise<void> { return this.driver.openDownloads(); }
  async pressKey(key: HardwareKey): Promise<void> { return this.driver.pressKey(key); }
  async screenshot(): Promise<Buffer> { return this.driver.screenshot(); }
  async hierarchy(): Promise<UIElement[]> { return this.driver.hierarchy(); }
  async launchApp(id: string): Promise<void> { return this.driver.launchApp(id); }
  async stopApp(id: string): Promise<void> { return this.driver.stopApp(id); }
  async installApp(path: string): Promise<void> { return this.driver.installApp(path); }
  async enableInstallByThirdParty(pkg: string): Promise<void> {
    return this.driver.enableInstallByThirdParty(pkg);
  }
  async grantPermissions(pkg: string, perms: string[] | '*' = '*'): Promise<void> {
    return this.driver.grantPermissions(pkg, perms);
  }
  async setLocation(latitude: number, longitude: number): Promise<void> {
    return this.driver.setLocation(latitude, longitude);
  }
  async close(): Promise<void> { return this.driver.close(); }

  get(selector: Selector): ElementHandle {
    return new ElementHandleImpl(this.driver, selector, this.defaultTimeoutMs, this.pollIntervalMs);
  }

  async tapOn(selector: Selector): Promise<void> {
    await this.get(selector).tap();
  }

  async copyText(selector: Selector): Promise<string> {
    return this.get(selector).text();
  }

  awaitUntil(selector: Selector, opts?: { timeoutMs?: number }): WaitHandle {
    return new WaitHandleImpl(
      this.driver,
      selector,
      opts?.timeoutMs ?? this.defaultTimeoutMs,
      this.pollIntervalMs,
    );
  }
}

class ElementHandleImpl implements ElementHandle {
  constructor(
    private readonly driver: Driver,
    private readonly selector: Selector,
    private readonly timeoutMs: number,
    private readonly pollIntervalMs: number,
  ) {}

  then<TResult1 = UIElement, TResult2 = never>(
    onfulfilled?: ((value: UIElement) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.waitFor().then(onfulfilled, onrejected);
  }

  async waitFor(opts?: { timeoutMs?: number }): Promise<UIElement> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;
    const el = await waitForElement(this.driver, this.selector, timeoutMs, this.pollIntervalMs);
    if (!el) throw new ElementNotFoundError(this.selector, timeoutMs);
    return el;
  }

  async exists(): Promise<boolean> {
    const tree = await this.driver.hierarchy();
    return findElement(tree, this.selector) !== undefined;
  }

  async text(): Promise<string> {
    const el = await this.waitFor();
    return el.text ?? '';
  }

  async tap(): Promise<void> {
    const el = await this.waitFor();
    const { x, y } = centerOf(el);
    await this.driver.tap(x, y);
  }

  async longPress(durationMs = 800): Promise<void> {
    const el = await this.waitFor();
    const { x, y } = centerOf(el);
    await this.driver.longPress(x, y, durationMs);
  }

  async clear(): Promise<void> {
    await this.tap();
    for (let i = 0; i < 50; i++) {
      await this.driver.pressKey('back' as HardwareKey).catch(() => {});
    }
  }

  async fill(text: string): Promise<void> {
    await this.tap();
    await this.driver.typeText(text);
  }
}

class WaitHandleImpl implements WaitHandle {
  constructor(
    private readonly driver: Driver,
    private readonly selector: Selector,
    private readonly timeoutMs: number,
    private readonly pollIntervalMs: number,
  ) {}

  async toAppear(): Promise<void> {
    const el = await waitForElement(this.driver, this.selector, this.timeoutMs, this.pollIntervalMs);
    if (!el) throw new ElementNotFoundError(this.selector, this.timeoutMs);
  }

  async toDisappear(): Promise<void> {
    const ok = await pollUntil(
      async () => {
        const tree = await this.driver.hierarchy();
        return findElement(tree, this.selector) === undefined;
      },
      this.timeoutMs,
      this.pollIntervalMs,
    );
    if (!ok) throw new Error(`Selector ${JSON.stringify(this.selector)} still present after ${this.timeoutMs}ms`);
  }

  async changeTo(target: Selector): Promise<void> {
    const ok = await pollUntil(
      async () => {
        const tree = await this.driver.hierarchy();
        const sourceGone = findElement(tree, this.selector) === undefined ||
          tree.some((el) => elementMatches(el, this.selector) && elementMatches(el, target));
        const targetPresent = findElement(tree, target) !== undefined;
        return sourceGone && targetPresent;
      },
      this.timeoutMs,
      this.pollIntervalMs,
    );
    if (!ok) {
      throw new Error(
        `Selector ${JSON.stringify(this.selector)} did not change to ${JSON.stringify(target)} within ${this.timeoutMs}ms`,
      );
    }
  }
}

async function waitForElement(
  driver: Driver,
  selector: Selector,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<UIElement | undefined> {
  let found: UIElement | undefined;
  await pollUntil(
    async () => {
      const tree = await driver.hierarchy();
      found = findElement(tree, selector);
      return found !== undefined;
    },
    timeoutMs,
    pollIntervalMs,
  );
  return found;
}

async function pollUntil(
  pred: () => Promise<boolean>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await pred()) return true;
    } catch {
      /* swallow transient errors */
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createDriver(opts: SessionOptions): Driver {
  if (opts.platform === 'android') {
    return new AndroidDriver(opts.serial, opts.androidServerUrl);
  }
  return new IOSDriver({ serial: opts.serial, kind: opts.iosKind, wdaUrl: opts.wdaUrl, sessionId: opts.wdaSessionId });
}
