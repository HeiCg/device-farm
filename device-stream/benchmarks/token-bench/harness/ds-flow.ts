/**
 * Live flow driver for the device-stream configurations (B1/C1/C2).
 *
 * These talk to the device-stream MCP server, which drives the emulator through
 * `@device-stream/dsl` → android-server (TCP JSON-RPC on :9008). Unlike argent,
 * our tools return exactly what the registry produces — no server-side
 * auto-capture — so each captured call is a single agent round-trip.
 *
 *   B1  — atomic dsl_* tools; a dsl_describe before each context-dependent step.
 *   C1  — one orientation dsl_describe + one dsl_run_script (whole flow).
 *   C2  — C1 plus a first dsl_run_script that hits a selector miss (WS1
 *         diagnostic error), then a corrected re-submit.
 *
 * PRECONDITION: the android-server instrumentation must be RUNNING and holding
 * UiAutomation (the opposite of the argent configs). Settings is force-stopped
 * first so the flow starts at the root, not a remembered subscreen.
 */
import { execFileSync } from 'node:child_process';
import { McpTarget } from './mcp-client.js';
import { captureCall } from './capture.js';
import type { TokenCounter } from './tokens.js';
import type { CallRecord } from './types.js';

export interface DsFlowOptions {
  mcpEntry: string;
  serial: string;
  counter: TokenCounter;
  adb: string;
  /** 'B1' | 'C1' | 'C2' */
  config: 'B1' | 'C1' | 'C2';
}

const PKG = 'com.android.settings';

/** One planned atomic call for B1, resolved to concrete selector args. */
interface PlannedDsCall {
  step: number;
  tool: string;
  args: Record<string, unknown>;
}

/** B1: the 10 logical steps expanded to atomic dsl_* calls (selectors are data). */
export function b1Plan(): PlannedDsCall[] {
  return [
    { step: 1, tool: 'dsl_launch_app', args: { id: PKG } },
    { step: 2, tool: 'dsl_describe', args: {} },
    { step: 3, tool: 'dsl_tap', args: { selector: { text: 'Network & internet' } } },
    { step: 4, tool: 'dsl_describe', args: {} },
    { step: 5, tool: 'dsl_press_key', args: { key: 'back' } },
    { step: 6, tool: 'dsl_describe', args: {} },
    { step: 6, tool: 'dsl_tap', args: { selector: { text: 'Search settings' } } },
    { step: 6, tool: 'dsl_fill', args: { selector: { id: { contains: 'search_view_edit_text' } }, text: 'battery' } },
    { step: 7, tool: 'dsl_describe', args: {} },
    { step: 7, tool: 'dsl_tap', args: { selector: { text: { contains: 'Battery' } } } },
    { step: 8, tool: 'dsl_describe', args: {} },
    { step: 9, tool: 'dsl_describe', args: {} },
    { step: 9, tool: 'dsl_tap', args: { selector: { text: { contains: 'Battery Saver' } } } },
    { step: 9, tool: 'dsl_describe', args: {} },
    { step: 10, tool: 'dsl_press_key', args: { key: 'back' } },
    { step: 10, tool: 'dsl_describe', args: {} },
  ];
}

/**
 * The whole flow as a typed dsl_run_script body (config C, happy path).
 *
 * NOTE: `ds.launchApp('com.android.settings')` is intentionally omitted. On this
 * emulator image the DSL's launchApp shells `monkey -c android.intent.category.
 * LAUNCHER`, which does NOT foreground Settings (no matching launcher activity),
 * so the harness foregrounds Settings via `adb am start` before the script and the
 * script drives from the root. Every other verb is real DSL.
 */
export const C_SCRIPT = `
await ds.tapOn({ text: 'Network & internet' });
await ds.awaitUntil({ text: 'Internet' }).toAppear();
await ds.pressKey('back');
await ds.tapOn({ text: 'Search settings' });
await ds.get({ id: { contains: 'search_view_edit_text' } }).fill('battery');
await ds.tapOn({ text: { contains: 'Battery' } });
await ds.awaitUntil({ text: { contains: 'Battery' } }).toAppear();
await ds.tapOn({ text: { contains: 'Battery Saver' } });
await ds.pressKey('back');
console.log('flow-complete');
`.trim();

/** C2 first attempt: a selector miss that triggers the WS1 diagnostic error. */
export const C_SCRIPT_MISS = `
await ds.tapOn({ text: 'Netwrok & internet' });
console.log('unreachable');
`.trim();

function forceStopSettings(adb: string, serial: string): void {
  try {
    execFileSync(adb, ['-s', serial, 'shell', 'am', 'force-stop', PKG], { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
}

/** Foreground Settings at its root — the DSL's monkey-based launchApp can't here. */
function amStartSettings(adb: string, serial: string): void {
  try {
    // --activity-clear-task forces a fresh root; without it Settings restores its
    // last sub-screen (e.g. the search view) across a force-stop.
    execFileSync(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'com.android.settings/.Settings', '--activity-clear-task'], { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
}

/**
 * Measure dsl_describe on the current screen, retrying: a describe issued during
 * a transition can race to a near-empty tree, so keep the largest of a few reads.
 */
async function measureDescribe(
  target: McpTarget,
  counter: TokenCounter,
): Promise<{ bytes: number; tokens: number } | undefined> {
  let best = '';
  for (let i = 0; i < 8; i++) {
    const d = await target.callTool('dsl_describe', {});
    const txt = (d.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
    if (txt.length > best.length) best = txt;
    if (best.length > 2200) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!best) return undefined;
  return { bytes: Buffer.byteLength(best, 'utf8'), tokens: await counter.countText(best) };
}

/** Drive one device-stream configuration; returns its captured calls + describe size. */
export async function runDsFlow(opts: DsFlowOptions): Promise<{ calls: CallRecord[]; describeSize?: { bytes: number; tokens: number } }> {
  const target = new McpTarget({
    command: process.execPath,
    args: [opts.mcpEntry],
    env: {
      DEVICE_FARM_TOKEN: process.env.DEVICE_FARM_TOKEN ?? 'token-bench-dummy',
      DEVICE_STREAM_SERIAL: opts.serial,
      DEVICE_STREAM_PLATFORM: 'android',
    },
  });
  const calls: CallRecord[] = [];
  let describeSize: { bytes: number; tokens: number } | undefined;
  try {
    await target.connect();

    // Clean root + a describe-size measurement on the Settings root. `am start`
    // rather than dsl_launch_app: the DSL's monkey-based launch can't foreground
    // Settings on this image (see C_SCRIPT note).
    forceStopSettings(opts.adb, opts.serial);
    amStartSettings(opts.adb, opts.serial);
    await new Promise((r) => setTimeout(r, 3500));
    describeSize = await measureDescribe(target, opts.counter);

    // Reset to a clean root before the actual flow.
    forceStopSettings(opts.adb, opts.serial);
    amStartSettings(opts.adb, opts.serial);
    await new Promise((r) => setTimeout(r, 3000));

    if (opts.config === 'B1') {
      for (const c of b1Plan()) {
        const res = await target.callTool(c.tool, c.args);
        calls.push(await captureCall({ step: c.step, tool: c.tool, origin: 'agent', requestArgs: c.args, result: res }, opts.counter));
        // dsl_launch_app(monkey) is a no-op here; keep Settings foregrounded so
        // the remaining steps measure real screens (the call itself is captured).
        if (c.tool === 'dsl_launch_app') {
          amStartSettings(opts.adb, opts.serial);
          await new Promise((r) => setTimeout(r, 2500));
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    } else {
      // C1 / C2: orientation describe first.
      const d = await target.callTool('dsl_describe', {});
      calls.push(await captureCall({ step: 1, tool: 'dsl_describe', origin: 'agent', requestArgs: {}, result: d }, opts.counter));

      if (opts.config === 'C2') {
        const miss = await target.callTool('dsl_run_script', { script: C_SCRIPT_MISS });
        calls.push(await captureCall({ step: 1, tool: 'dsl_run_script', origin: 'agent', requestArgs: { script: C_SCRIPT_MISS }, result: miss }, opts.counter));
        // Recover to a clean root before the corrected re-submit.
        forceStopSettings(opts.adb, opts.serial);
        amStartSettings(opts.adb, opts.serial);
        await new Promise((r) => setTimeout(r, 3000));
      }

      const run = await target.callTool('dsl_run_script', { script: C_SCRIPT });
      calls.push(await captureCall({ step: 1, tool: 'dsl_run_script', origin: 'agent', requestArgs: { script: C_SCRIPT }, result: run }, opts.counter));
    }
  } finally {
    await target.close();
  }
  return { calls, describeSize };
}
