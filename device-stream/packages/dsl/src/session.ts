import type {
  DeviceStreamSession,
  ElementHandle,
  WaitHandle,
} from './index';
import type {
  HardwareKey,
  ScrollDirection,
  SessionOptions,
  Selector,
  SwipeOptions,
  ScrollOptions,
  ScreenshotOptions,
  ScrollUntilVisibleOptions,
  UIElement,
} from './types';
import { ElementNotFoundError } from './types';
import type { Driver } from './drivers/types';
import { AndroidDriver } from './drivers/android';
import { IOSDriver } from './drivers/ios';
import { centerOf, elementMatches, findElement, flattenTree } from './selectors/matcher';
import {
  buildElementNotFoundDiagnostics,
  describeElements,
  renderDescription,
  type DescribedNode,
} from './selectors/describe';

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
  async screenshot(opts?: ScreenshotOptions): Promise<Buffer> { return this.driver.screenshot(opts); }
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

  async swipe(opts: SwipeOptions): Promise<void> {
    await this.driver.swipe(opts.fromX, opts.fromY, opts.toX, opts.toY, opts.durationMs ?? 300);
  }

  async scroll(direction: ScrollDirection, opts: ScrollOptions = {}): Promise<void> {
    const { width, height } = await this.driver.screenSize();
    const distance = clamp01(opts.distance ?? 0.6);
    const near = 0.5 + distance / 2;
    const far = 0.5 - distance / 2;
    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);
    const px = (f: number) => Math.round(f * width);
    const py = (f: number) => Math.round(f * height);
    const durationMs = opts.durationMs ?? 300;

    // `direction` is the direction the user wants to travel through content;
    // the finger moves the opposite way (scroll down => finger swipes up).
    switch (direction) {
      case 'down': return this.driver.swipe(cx, py(near), cx, py(far), durationMs);
      case 'up': return this.driver.swipe(cx, py(far), cx, py(near), durationMs);
      case 'right': return this.driver.swipe(px(near), cy, px(far), cy, durationMs);
      case 'left': return this.driver.swipe(px(far), cy, px(near), cy, durationMs);
    }
  }

  async waitForIdle(timeoutMs = 2000): Promise<void> {
    await this.driver.waitForIdle(timeoutMs);
  }

  async describe(): Promise<DescribedNode[]> {
    return describeElements(await this.driver.hierarchy());
  }

  async describeText(): Promise<string> {
    return renderDescription(describeElements(await this.driver.hierarchy()));
  }

  async scrollUntilVisible(
    selector: Selector,
    opts: ScrollUntilVisibleOptions = {},
  ): Promise<UIElement> {
    const direction = opts.direction ?? 'down';
    const maxScrolls = opts.maxScrolls ?? 10;
    const visibleSel: Selector = { ...selector, visible: selector.visible ?? true };

    let lastTree: UIElement[] = [];
    for (let i = 0; i <= maxScrolls; i++) {
      lastTree = await this.driver.hierarchy();
      const found = findElement(lastTree, visibleSel);
      if (found) return found;
      if (i === maxScrolls) break;
      await this.scroll(direction, { distance: opts.distance, durationMs: opts.durationMs });
      await this.driver.waitForIdle(opts.settleTimeoutMs ?? 2000);
    }
    throw new ElementNotFoundError(selector, 0, buildElementNotFoundDiagnostics(lastTree, selector));
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
    const { el, tree } = await waitForElement(this.driver, this.selector, timeoutMs, this.pollIntervalMs);
    if (!el) {
      throw new ElementNotFoundError(
        this.selector,
        timeoutMs,
        buildElementNotFoundDiagnostics(tree, this.selector),
      );
    }
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
    // Focus the field, then clear via the platform's dedicated clear path.
    // Never press BACK — on Android that dismisses the IME and walks out of the
    // app (keycode 4); on iOS it throws and no-ops. See spec B1.
    await this.tap();
    await this.driver.clearText();
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
    const { el, tree } = await waitForElement(this.driver, this.selector, this.timeoutMs, this.pollIntervalMs);
    if (!el) {
      throw new ElementNotFoundError(
        this.selector,
        this.timeoutMs,
        buildElementNotFoundDiagnostics(tree, this.selector),
      );
    }
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
          flattenTree(tree).some((el) => elementMatches(el, this.selector) && elementMatches(el, target));
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

/**
 * Poll for `selector`, returning the found element (if any) alongside the last
 * tree polled — so a caller can build not-found diagnostics without an extra
 * device round-trip.
 */
async function waitForElement(
  driver: Driver,
  selector: Selector,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<{ el: UIElement | undefined; tree: UIElement[] }> {
  let found: UIElement | undefined;
  let lastTree: UIElement[] = [];
  await pollUntil(
    async () => {
      lastTree = await driver.hierarchy();
      found = findElement(lastTree, selector);
      return found !== undefined;
    },
    timeoutMs,
    pollIntervalMs,
  );
  return { el: found, tree: lastTree };
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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function createDriver(opts: SessionOptions): Driver {
  if (opts.platform === 'android') {
    return new AndroidDriver(opts.serial, opts.androidServerUrl, {
      maxElements: opts.androidMaxElements,
    });
  }
  return new IOSDriver({
    serial: opts.serial,
    kind: opts.iosKind,
    wdaUrl: opts.wdaUrl,
    sessionId: opts.wdaSessionId,
    timeoutMs: opts.wdaTimeoutMs,
  });
}
