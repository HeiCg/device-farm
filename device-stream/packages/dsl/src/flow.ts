import type { DeviceStreamSession } from './index';
import type { HardwareKey, ScrollDirection, Selector } from './types';

/**
 * A recorded DSL interaction. `args` is a plain JSON object whose shape depends
 * on `action` (see {@link executeFlow}). Flows persist as YAML and replay
 * deterministically — useful for repro, fixtures, and CI.
 */
export interface FlowStep {
  action: string;
  args: Record<string, unknown>;
}

export interface Flow {
  name: string;
  steps: FlowStep[];
}

// ---------------------------------------------------------------------------
// Serialization. Structured payloads are emitted as JSON (valid YAML flow
// scalars), so round-tripping is exact while the file stays human-readable.
// ---------------------------------------------------------------------------

export function serializeFlow(flow: Flow): string {
  const lines = ['# device-stream flow', `name: ${flow.name}`, 'steps:'];
  for (const step of flow.steps) {
    lines.push(`  - action: ${step.action}`);
    lines.push(`    args: ${JSON.stringify(step.args ?? {})}`);
  }
  return lines.join('\n') + '\n';
}

export function parseFlow(yaml: string): Flow {
  let name = '';
  const steps: FlowStep[] = [];
  let current: FlowStep | undefined;

  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === 'steps:') continue;

    if (trimmed.startsWith('name:')) {
      name = trimmed.slice('name:'.length).trim();
      continue;
    }
    if (trimmed.startsWith('- action:')) {
      current = { action: trimmed.slice('- action:'.length).trim(), args: {} };
      steps.push(current);
      continue;
    }
    if (trimmed.startsWith('args:')) {
      const json = trimmed.slice('args:'.length).trim();
      if (current) current.args = json ? JSON.parse(json) : {};
      continue;
    }
  }
  return { name, steps };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export async function executeFlow(session: DeviceStreamSession, flow: Flow): Promise<void> {
  for (const step of flow.steps) {
    await runStep(session, step);
  }
}

async function runStep(session: DeviceStreamSession, step: FlowStep): Promise<void> {
  const a = step.args ?? {};
  switch (step.action) {
    case 'launchApp': return void (await session.launchApp(a.id as string));
    case 'stopApp': return void (await session.stopApp(a.id as string));
    case 'openUrl': return void (await session.openUrl(a.url as string));
    case 'tapOn': return void (await session.tapOn(a.selector as Selector));
    case 'fill': return void (await session.get(a.selector as Selector).fill(a.text as string));
    case 'longPress': return void (await session.get(a.selector as Selector).longPress(a.durationMs as number | undefined));
    case 'pressKey': return void (await session.pressKey(a.key as HardwareKey));
    case 'scroll': return void (a.opts
      ? await session.scroll(a.direction as ScrollDirection, a.opts as never)
      : await session.scroll(a.direction as ScrollDirection));
    case 'swipe': return void (await session.swipe(a as never));
    case 'scrollUntilVisible': return void (a.opts
      ? await session.scrollUntilVisible(a.selector as Selector, a.opts as never)
      : await session.scrollUntilVisible(a.selector as Selector));
    case 'waitForIdle': return void (await session.waitForIdle(a.timeoutMs as number | undefined));
    default: throw new Error(`Unknown flow action: ${step.action}`);
  }
}

// ---------------------------------------------------------------------------
// Recording — mirrors the common session verbs, recording + forwarding live.
// ---------------------------------------------------------------------------

export class FlowRecorder {
  private readonly steps: FlowStep[] = [];

  constructor(private readonly session: DeviceStreamSession, private readonly name: string) {}

  private record(action: string, args: Record<string, unknown>): void {
    this.steps.push({ action, args });
  }

  async launchApp(id: string): Promise<void> {
    this.record('launchApp', { id });
    await this.session.launchApp(id);
  }

  async stopApp(id: string): Promise<void> {
    this.record('stopApp', { id });
    await this.session.stopApp(id);
  }

  async openUrl(url: string): Promise<void> {
    this.record('openUrl', { url });
    await this.session.openUrl(url);
  }

  async tapOn(selector: Selector): Promise<void> {
    this.record('tapOn', { selector });
    await this.session.tapOn(selector);
  }

  async fill(selector: Selector, text: string): Promise<void> {
    this.record('fill', { selector, text });
    await this.session.get(selector).fill(text);
  }

  async pressKey(key: HardwareKey): Promise<void> {
    this.record('pressKey', { key });
    await this.session.pressKey(key);
  }

  async scroll(direction: ScrollDirection): Promise<void> {
    this.record('scroll', { direction });
    await this.session.scroll(direction);
  }

  async scrollUntilVisible(selector: Selector): Promise<void> {
    this.record('scrollUntilVisible', { selector });
    await this.session.scrollUntilVisible(selector);
  }

  finish(): Flow {
    return { name: this.name, steps: [...this.steps] };
  }
}
