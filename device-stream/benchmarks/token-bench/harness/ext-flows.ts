/**
 * Live flow drivers for the fork-vs-upstream extension configs:
 *
 *   F1     — fork `run-script`, Android emulator (1 describe + 1 run-script).
 *   F2     — fork `run-script`, iOS simulator (same shape).
 *   A1-ios — upstream argent defaults, iOS simulator (verb-per-call + auto-capture).
 *   A4-ios — upstream argent run-sequence, iOS simulator (one sequence + auto-capture).
 *
 * Shared with the Android argent driver (`argent-flow.ts`): both talk to `argent
 * mcp` over stdio and let argent bundle its auto-capture (screenshot + element
 * tree) into each action's result. What is new here:
 *
 *   - Describe parsing: a direct `describe` call returns a JSON object
 *     (`{"description": "<tree>", ...}`) on BOTH platforms, while the auto-capture
 *     appended after an action is plain text (`--- Elements after action …`).
 *     `parseTree` normalizes both to the raw element tree.
 *   - iOS accommodations (see scenario-ios.json): argent `launch-app` returns
 *     init_failed (the RN devtools dylib is absent), so Settings is foregrounded
 *     via `xcrun simctl launch`; `simctl launch` restores the last sub-screen, so
 *     the flow resets to the root by tapping the `BackButton` element until it is
 *     gone; iOS taps are fire-and-forget (#547) so each tap is verified.
 *   - The fork `run-script` tool is flag-gated: the driver spawns argent with a
 *     throwaway cwd whose `.argent/flags.json` enables `run-script` (the same
 *     throwaway-flag mechanism `argent-flow.ts` uses for disable-auto-screenshot).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpTarget } from './mcp-client.js';
import { captureCall, type McpToolResult } from './capture.js';
import type { TokenCounter } from './tokens.js';
import type { CallRecord } from './types.js';
import { BENCH_ROOT } from './paths.js';

/* ---------- tree parsing (shared) ----------------------------------------- */

/**
 * Normalize a describe result to the raw element tree. A direct `describe` call
 * returns a JSON object whose `description` field holds the tree (with escaped
 * quotes/newlines); auto-capture appends the tree as plain text. Returns the
 * input unchanged when it is already a plain tree.
 */
export function parseTree(text: string): string {
  const m = text.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return text;
    }
  }
  return text;
}

export interface TreeElement {
  label: string;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Parse `AXType "label" [value=…] [id="…"] (x, y, w, h)` lines from a tree. */
export function parseElements(tree: string): TreeElement[] {
  const re =
    /AX\w+\s+"([^"]*)"(?:\s+value="[^"]*")?(?:\s+id="([^"]+)")?[^(]*\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)/g;
  const out: TreeElement[] = [];
  for (const m of tree.matchAll(re)) {
    out.push({ label: m[1], id: m[2] ?? '', x: +m[3], y: +m[4], w: +m[5], h: +m[6] });
  }
  return out;
}

export function elementById(tree: string, id: string): TreeElement | undefined {
  return parseElements(tree).find((e) => e.id === id);
}
export function hasId(tree: string, id: string): boolean {
  return parseElements(tree).some((e) => e.id === id);
}

/** Extract argent's `Source: <backend>` label from a describe tree (the hierarchy backend). */
export function parseSource(tree: string): string | undefined {
  return tree.match(/Source:\s*([a-z-]+)/)?.[1];
}

function textOf(result: McpToolResult): string {
  return (result.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
}

/* ---------- iOS scenario data --------------------------------------------- */

interface IosScenario {
  target: { rootMarkerId: string; backButtonId: string };
  coords: Record<string, { x: number; y: number }>;
}
function loadIosScenario(): IosScenario {
  return JSON.parse(readFileSync(join(BENCH_ROOT, 'scenario-ios.json'), 'utf8')) as IosScenario;
}

/* ---------- flag cwd for the fork run-script tool ------------------------- */

function makeFlagCwd(flags: Record<string, boolean>): string {
  const dir = join(tmpdir(), `argent-flags-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.argent'), { recursive: true });
  writeFileSync(join(dir, '.argent', 'flags.json'), JSON.stringify({ flags }));
  return dir;
}

/* ---------- run-script bodies (validated live) ---------------------------- */

/**
 * F1 Android body. Direct + search navigation, all via the injected `ui` facade.
 * Uses the exact search-result label `Use Battery Saver` (argent's facade matches
 * a whole selector field and has no substring operator, unlike the DSL's
 * `{ text: { contains } }`), which deep-links to the Battery Saver screen.
 */
export const F1_ANDROID_SCRIPT = `
await ui.tap({ text: 'Network & internet' });
await ui.await('visible', { text: 'Internet' });
await ui.button('back');
await ui.tap({ text: 'Search settings' });
await ui.fill({ text: 'Search settings' }, 'battery');
await ui.tap({ text: 'Use Battery Saver' });
await ui.await('visible', { text: 'Battery Saver' });
await ui.button('back');
console.log('android-flow-complete');
`.trim();

/**
 * F2 iOS body. Navigation by stable `com.apple.settings.*` / `BackButton`
 * accessibility identifiers (locale-proof; the sim is pt-BR). `ui.tap` settles +
 * verifies each tap (iOS taps are fire-and-forget, #547).
 */
export const F2_IOS_SCRIPT = `
await ui.tap({ identifier: 'com.apple.settings.general' });
await ui.await('visible', { identifier: 'BackButton' });
await ui.tap({ identifier: 'BackButton' });
await ui.tap({ identifier: 'com.apple.settings.accessibility' });
await ui.await('visible', { identifier: 'BackButton' });
await ui.tap({ identifier: 'BackButton' });
await ui.tap({ identifier: 'com.apple.settings.camera' });
await ui.await('visible', { identifier: 'BackButton' });
await ui.tap({ identifier: 'BackButton' });
await ui.await('visible', { identifier: 'com.apple.settings.general' });
console.log('ios-flow-complete');
`.trim();

/**
 * FX Android body (integration branch, open-device-server + run-script on). Uses
 * RICH selectors (`{ text: { contains, caseInsensitive } }`, verified to type-check
 * and match against the open-device-server tree). Direct navigation rather than
 * F1's search-result tap: the open-device-server accessibility tree flattens the
 * Settings search results into non-clickable StaticText rows plus standalone Switch
 * widgets, so the row-tap F1 used on the uiautomator tree has no clickable target.
 * Same logical shape (navigate → assert → back → navigate to Battery → Battery
 * Saver → assert → back), so the round-trip / token cost stays comparable to F1.
 */
export const FX_ANDROID_SCRIPT = `
await ui.tap({ text: { contains: 'Network & internet' } });
await ui.await('visible', { text: { contains: 'Internet', caseInsensitive: true } });
await ui.button('back');
await ui.tap({ text: { contains: 'Battery' } });
await ui.await('visible', { text: { contains: 'Battery Saver', caseInsensitive: true } });
await ui.tap({ text: { contains: 'Battery Saver', caseInsensitive: true } });
await ui.await('visible', { text: { contains: 'Battery Saver' } });
await ui.button('back');
await ui.button('back');
console.log('fx-android-complete');
`.trim();

/* ---------- device reset helpers ------------------------------------------ */

const ANDROID_SETTINGS = 'com.android.settings';
const IOS_SETTINGS = 'com.apple.Preferences';

/** Foreground Android Settings at a fresh root (the DSL/monkey launch can't). */
function resetAndroidRoot(adb: string, serial: string): void {
  try {
    execFileSync(adb, ['-s', serial, 'shell', 'am', 'force-stop', ANDROID_SETTINGS], { stdio: 'ignore' });
    execFileSync(
      adb,
      ['-s', serial, 'shell', 'am', 'start', '-n', 'com.android.settings/.Settings', '--activity-clear-task'],
      { stdio: 'ignore' },
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Foreground iOS Settings and climb back to the root list. `simctl launch`
 * restores the last sub-screen, so tap the `BackButton` element until it is gone
 * and the root marker (`com.apple.settings.general`) is present.
 */
async function resetIosRoot(
  target: McpTarget,
  udid: string,
  xcrun: string,
  scenario: IosScenario,
): Promise<boolean> {
  try {
    execFileSync(xcrun, ['simctl', 'launch', udid, IOS_SETTINGS], { stdio: 'ignore' });
  } catch {
    /* the app may already be foregrounded */
  }
  await sleep(2500);
  for (let i = 0; i < 10; i++) {
    const tree = parseTree(textOf(await target.callTool('describe', { udid })));
    const back = elementById(tree, scenario.target.backButtonId);
    if (!back && hasId(tree, scenario.target.rootMarkerId)) return true;
    if (back) {
      await target.callTool('gesture-tap', { udid, x: back.x + back.w / 2, y: back.y + back.h / 2 });
      await sleep(1300);
    } else {
      await sleep(700);
    }
  }
  const tree = parseTree(textOf(await target.callTool('describe', { udid })));
  return hasId(tree, scenario.target.rootMarkerId);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ---------- F1 / F2: fork run-script -------------------------------------- */

export interface ForkScriptFlowOptions {
  forkCli: string;
  forkRoot: string;
  platform: 'android' | 'ios';
  udid: string;
  counter: TokenCounter;
  adb?: string;
  xcrun?: string;
  /**
   * Feature flags to enable. Default `{ 'run-script': true }` (F1/F2). Config FX
   * passes `{ 'run-script': true, 'open-device-server': true }`.
   */
  flags?: Record<string, boolean>;
  /**
   * Working directory for `argent mcp`. When set (FX uses the integration clone
   * root), the flags are read from `<cwd>/.argent/flags.json` and the tool-server
   * resolves to that clone; when omitted (F1/F2), a throwaway flag cwd is created.
   */
  cwd?: string;
  /**
   * `ARGENT_PORT` for an isolated tool-server. Required for FX so the client does
   * not attach to a globally-installed argent's shared tool-server on the default
   * port (which would run upstream code without the open-device-server).
   */
  port?: number;
  /** Override the Android / iOS run-script body (FX uses rich-selector scripts). */
  androidScript?: string;
  iosScript?: string;
}

/**
 * Drive one run-script configuration (F1/F2 fork, or FX integration): reset
 * Settings to its root, measure the orientation describe, then issue exactly one
 * `run-script` call whose body drives the whole 10-step flow. argent bundles its
 * auto-capture (screenshot + element tree) into the run-script result, so the two
 * captured round-trips already carry the auto-capture cost. Records the describe
 * backend (`Source:` label) so FX can prove open-device-server was used.
 */
export async function runForkScriptFlow(
  opts: ForkScriptFlowOptions,
): Promise<{
  calls: CallRecord[];
  describeSize?: { bytes: number; tokens: number };
  describeSource?: string;
}> {
  const flags = opts.flags ?? { 'run-script': true };
  // FX pins cwd to the clone root (project flags + local tool-server resolution);
  // F1/F2 use a throwaway flag cwd.
  const usingProvidedCwd = Boolean(opts.cwd);
  if (usingProvidedCwd) {
    mkdirSync(join(opts.cwd!, '.argent'), { recursive: true });
    writeFileSync(join(opts.cwd!, '.argent', 'flags.json'), JSON.stringify({ flags }));
  }
  const cwd = opts.cwd ?? makeFlagCwd(flags);
  const target = new McpTarget({
    command: process.execPath,
    args: [opts.forkCli, 'mcp'],
    env: {
      ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1',
      ...(opts.port ? { ARGENT_PORT: String(opts.port) } : {}),
    },
    cwd,
  });
  const calls: CallRecord[] = [];
  let describeSize: { bytes: number; tokens: number } | undefined;
  let describeSource: string | undefined;
  const scenario = loadIosScenario();
  try {
    await target.connect();

    if (opts.platform === 'android') {
      resetAndroidRoot(opts.adb ?? 'adb', opts.udid);
      await sleep(3000);
    } else {
      await resetIosRoot(target, opts.udid, opts.xcrun ?? 'xcrun', scenario);
    }

    // Orientation describe (step 1-2), also the measured root describe size + backend.
    const d = await target.callTool('describe', { udid: opts.udid });
    const dTree = parseTree(textOf(d));
    describeSize = { bytes: Buffer.byteLength(dTree, 'utf8'), tokens: await opts.counter.countText(dTree) };
    describeSource = parseSource(dTree);
    calls.push(
      await captureCall(
        { step: 2, tool: 'describe', origin: 'agent', requestArgs: { udid: opts.udid }, result: d },
        opts.counter,
      ),
    );

    // The whole flow in one run-script round-trip (result carries auto-capture).
    const script =
      opts.platform === 'android'
        ? opts.androidScript ?? F1_ANDROID_SCRIPT
        : opts.iosScript ?? F2_IOS_SCRIPT;
    const args = { udid: opts.udid, script, timeout_ms: 120000 };
    const res = await target.callTool('run-script', args);
    calls.push(
      await captureCall(
        { step: 3, tool: 'run-script', origin: 'agent', requestArgs: args, result: res },
        opts.counter,
      ),
    );
  } finally {
    await target.close();
    if (!usingProvidedCwd) {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
  return { calls, describeSize, describeSource };
}

/* ---------- A1-ios / A4-ios: upstream argent on iOS ----------------------- */

export interface IosArgentFlowOptions {
  argentCli: string;
  udid: string;
  counter: TokenCounter;
  xcrun: string;
  mode: 'verbs' | 'sequence';
}

/**
 * A1-ios: verb-per-call, exactly what an agent driving argent's atomic tools does.
 * Every gesture-tap / await-ui-element returns argent's auto-capture (screenshot +
 * element tree) bundled in. Taps are located by re-describing and matching the
 * scenario's stable ids; each tap is verified (fire-and-forget, #547).
 */
async function runIosVerbFlow(
  target: McpTarget,
  opts: IosArgentFlowOptions,
  scenario: IosScenario,
): Promise<CallRecord[]> {
  const calls: CallRecord[] = [];
  const udid = opts.udid;

  // Step 1: argent launch-app (init_failed on iOS, but a real measured call).
  const launchArgs = { udid, bundleId: IOS_SETTINGS };
  const launchRes = await target.callTool('launch-app', launchArgs);
  calls.push(
    await captureCall(
      { step: 1, tool: 'launch-app', origin: 'agent', requestArgs: launchArgs, result: launchRes },
      opts.counter,
    ),
  );
  // launch-app does not foreground Settings here; reset to root out-of-band.
  await resetIosRoot(target, udid, opts.xcrun, scenario);

  // Step 2: explicit orientation describe.
  const orient = await target.callTool('describe', { udid });
  calls.push(
    await captureCall(
      { step: 2, tool: 'describe', origin: 'agent', requestArgs: { udid }, result: orient },
      opts.counter,
    ),
  );

  const backId = scenario.target.backButtonId;
  const rootId = scenario.target.rootMarkerId;

  // Tap the element with `id`, verifying the screen changed (id gone or a
  // BackButton appeared). Records the gesture-tap round-trip with auto-capture.
  const tapId = async (step: number, id: string): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      const tree = parseTree(textOf(await target.callTool('describe', { udid })));
      const el = elementById(tree, id);
      if (!el) {
        await sleep(600);
        continue;
      }
      const args = { udid, x: el.x + el.w / 2, y: el.y + el.h / 2 };
      const res = await target.callTool('gesture-tap', args);
      calls.push(
        await captureCall({ step, tool: 'gesture-tap', origin: 'agent', requestArgs: args, result: res }, opts.counter),
      );
      await sleep(1400);
      const after = parseTree(textOf(await target.callTool('describe', { udid })));
      if (!hasId(after, id) || (id !== backId && hasId(after, backId))) return;
    }
  };
  const awaitVisible = async (step: number, id: string, note: string): Promise<void> => {
    const args = { udid, condition: 'visible', selector: { identifier: id } };
    const res = await target.callTool('await-ui-element', args);
    calls.push(
      await captureCall({ step, tool: 'await-ui-element', origin: 'agent', requestArgs: args, result: res }, opts.counter),
    );
    void note;
  };

  await tapId(3, 'com.apple.settings.general'); // step 3 navigate
  await awaitVisible(4, backId, 'General sub-screen'); // step 4 assert
  await tapId(5, backId); // step 5 back
  await tapId(6, 'com.apple.settings.accessibility'); // step 6 navigate
  await awaitVisible(7, backId, 'Accessibility sub-screen'); // step 7 assert
  await tapId(8, backId); // step 8 back
  await tapId(9, 'com.apple.settings.camera'); // step 9 navigate
  await awaitVisible(9, backId, 'Camera sub-screen'); // step 9 assert transition
  await tapId(10, backId); // step 10 back
  await awaitVisible(10, rootId, 'Settings root'); // step 10 assert home
  return calls;
}

/** A4-ios: one run-sequence of blind coordinate taps (no re-describe), then auto-capture. */
async function runIosSequenceFlow(
  target: McpTarget,
  opts: IosArgentFlowOptions,
  scenario: IosScenario,
): Promise<CallRecord[]> {
  const udid = opts.udid;
  const c = scenario.coords;
  const args = {
    udid,
    steps: [
      { tool: 'gesture-tap', args: { x: c.general.x, y: c.general.y } },
      { tool: 'gesture-tap', args: { x: c.backButton.x, y: c.backButton.y } },
      { tool: 'gesture-tap', args: { x: c.accessibility.x, y: c.accessibility.y } },
      { tool: 'gesture-tap', args: { x: c.backButton.x, y: c.backButton.y } },
      { tool: 'gesture-tap', args: { x: c.camera.x, y: c.camera.y } },
      { tool: 'gesture-tap', args: { x: c.backButton.x, y: c.backButton.y } },
    ],
  };
  const res = await target.callTool('run-sequence', args);
  return [
    await captureCall({ step: 1, tool: 'run-sequence', origin: 'agent', requestArgs: args, result: res }, opts.counter),
  ];
}

/** Drive one upstream-argent iOS configuration (A1-ios verbs / A4-ios sequence). */
export async function runIosArgentFlow(
  opts: IosArgentFlowOptions,
): Promise<{ calls: CallRecord[]; describeSize?: { bytes: number; tokens: number } }> {
  const target = new McpTarget({
    command: process.execPath,
    args: [opts.argentCli, 'mcp'],
    env: { ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1' },
  });
  const scenario = loadIosScenario();
  let describeSize: { bytes: number; tokens: number } | undefined;
  try {
    await target.connect();
    // Measure the iOS Settings root describe size once, before the flow.
    await resetIosRoot(target, opts.udid, opts.xcrun, scenario);
    const d = await target.callTool('describe', { udid: opts.udid });
    const dTree = parseTree(textOf(d));
    describeSize = { bytes: Buffer.byteLength(dTree, 'utf8'), tokens: await opts.counter.countText(dTree) };

    const calls =
      opts.mode === 'sequence'
        ? await runIosSequenceFlow(target, opts, scenario)
        : await runIosVerbFlow(target, opts, scenario);
    return { calls, describeSize };
  } finally {
    await target.close();
  }
}
