/**
 * Live flow driver for the argent configurations (A1/A2/A3/A4).
 *
 * argent's MCP adapter bundles its auto-capture (screenshot + element tree) into
 * the SAME tool result as the triggering action — one MCP round-trip returns the
 * action ack plus, when enabled, `--- Screen after action ---` + an image and
 * `--- Elements after action (describe) ---` + the tree. So the harness issues
 * only the agent verbs; the auto-capture cost is captured as part of each verb's
 * result, which is exactly the transcript growth the model pays for that turn.
 *
 * A2's flow behaviour is identical to A1's (only the fixed context differs), so
 * the runner captures A1 once and the CLI reuses those calls for A2.
 *
 * Auto-capture is toggled per config through argent's project-scoped
 * `.argent/flags.json` (`disable-auto-screenshot`) placed in a throwaway cwd, so
 * the user's real `~/.argent` is never touched.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpTarget } from './mcp-client.js';
import { captureCall, type McpToolResult } from './capture.js';
import type { TokenCounter } from './tokens.js';
import type { CallRecord } from './types.js';

export interface ArgentFlowOptions {
  argentRoot: string;
  udid: string;
  bundleId: string;
  counter: TokenCounter;
  /** false ⇒ set the disable-auto-screenshot flag (config A3). */
  autoScreenshot: boolean;
  /** 'verbs' (A1/A2/A3) or 'sequence' (A4). */
  mode: 'verbs' | 'sequence';
}

/** Retry an async op with exponential backoff until it returns truthy or attempts run out. */
export async function withRetry<T>(
  fn: () => Promise<T | null>,
  attempts = 6,
  baseDelayMs = 400,
): Promise<T | null> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (last) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(1.6, i)));
  }
  return last;
}

/** Parse argent's normalized describe tree; return the tap centre for a label. */
export function findTapTarget(tree: string, label: string): { x: number; y: number } | null {
  const lc = label.toLowerCase();
  // Lines look like: Type "Some Label" id="..." [flags]  (x, y, w, h)
  const lineRe = /"([^"]*)"[^()]*\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g;
  let best: { x: number; y: number; area: number } | null = null;
  for (const m of tree.matchAll(lineRe)) {
    const text = m[1].toLowerCase();
    if (!text.includes(lc)) continue;
    const x = parseFloat(m[2]);
    const y = parseFloat(m[3]);
    const w = parseFloat(m[4]);
    const h = parseFloat(m[5]);
    const area = w * h;
    // Prefer the smallest matching element (most specific control).
    if (!best || area < best.area) best = { x: x + w / 2, y: y + h / 2, area };
  }
  return best ? { x: best.x, y: best.y } : null;
}

/** Pull the appended `--- Elements after action (describe) ---` tree, if any. */
function treeFromResult(result: McpToolResult): string {
  const texts = (result.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  const joined = texts.join('\n');
  const marker = joined.indexOf('Elements after action');
  return marker >= 0 ? joined.slice(marker) : joined;
}

interface Step {
  n: number;
  tool: string;
  args: Record<string, unknown> | ((tree: string) => Record<string, unknown> | null);
}

/** The 10-step Android Settings flow as argent verbs. */
function verbSteps(udid: string, bundleId: string): Step[] {
  const tap = (label: string) => (tree: string) => {
    const t = findTapTarget(tree, label);
    return t ? { udid, x: t.x, y: t.y } : null;
  };
  const awaitVisible = (label: string) => ({ udid, condition: 'visible', selector: { text: label } });
  return [
    { n: 1, tool: 'launch-app', args: { udid, bundleId } },
    { n: 3, tool: 'gesture-tap', args: tap('Network & internet') },
    { n: 4, tool: 'await-ui-element', args: awaitVisible('Internet') },
    { n: 5, tool: 'button', args: { udid, button: 'back' } },
    { n: 6, tool: 'gesture-tap', args: tap('Search settings') },
    { n: 6, tool: 'keyboard', args: { udid, text: 'battery' } },
    { n: 7, tool: 'gesture-tap', args: tap('Battery') },
    { n: 8, tool: 'await-ui-element', args: awaitVisible('Battery') },
    { n: 9, tool: 'gesture-tap', args: tap('Battery Saver') },
    { n: 9, tool: 'await-ui-element', args: awaitVisible('Battery Saver') },
    { n: 10, tool: 'button', args: { udid, button: 'back' } },
    { n: 10, tool: 'await-ui-element', args: awaitVisible('Settings') },
  ];
}

/** The 10 steps compressed into one argent run-sequence (config A4). */
function sequenceSteps(udid: string, bundleId: string): Record<string, unknown> {
  // Each step is { tool, args:{...} }; udid is shared at the top level.
  return {
    udid,
    steps: [
      { tool: 'launch-app', args: { bundleId } },
      { tool: 'gesture-tap', args: { x: 0.5, y: 0.33 } },
      { tool: 'button', args: { button: 'back' } },
      { tool: 'gesture-tap', args: { x: 0.5, y: 0.28 } },
      { tool: 'keyboard', args: { text: 'battery' } },
      { tool: 'gesture-tap', args: { x: 0.5, y: 0.2 } },
      { tool: 'button', args: { button: 'back' } },
    ],
  };
}

function makeCwd(autoScreenshot: boolean): string {
  const dir = join(tmpdir(), `argent-flow-${autoScreenshot ? 'on' : 'noshot'}-${Date.now()}`);
  mkdirSync(join(dir, '.argent'), { recursive: true });
  // On-disk format is { flags: { <name>: bool } } (see configuration-core/flags.ts).
  const flags: Record<string, boolean> = {};
  if (!autoScreenshot) flags['disable-auto-screenshot'] = true;
  writeFileSync(join(dir, '.argent', 'flags.json'), JSON.stringify({ flags }));
  return dir;
}

/**
 * Measure argent's `describe` size on the Settings root, tolerating the flaky
 * `uiautomator dump` (retries until a real tree comes back). Returns null if
 * every attempt failed. This is the measured Android describe size the spec asks
 * for (replacing the extrapolated "6-10 KB" estimate).
 */
export async function measureArgentDescribe(
  argentRoot: string,
  udid: string,
  bundleId: string,
  counter: TokenCounter,
  attempts = 6,
): Promise<{ bytes: number; tokens: number } | null> {
  const target = new McpTarget({
    command: process.execPath,
    args: [join(argentRoot, 'packages', 'argent', 'dist', 'cli.js'), 'mcp'],
    env: { ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1' },
    cwd: argentRoot,
  });
  try {
    await target.connect();
    await target.callTool('launch-app', { udid, bundleId });
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < attempts; i++) {
      const d = await target.callTool('describe', { udid });
      const tree = (d.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
      if (tree.includes('ROOT')) {
        return { bytes: Buffer.byteLength(tree, 'utf8'), tokens: await counter.countText(tree) };
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  } finally {
    await target.close();
  }
}

/** Drive one argent configuration end-to-end, returning its captured calls. */
export async function runArgentFlow(opts: ArgentFlowOptions): Promise<{ calls: CallRecord[]; describeSize?: { bytes: number; tokens: number } }> {
  const cwd = makeCwd(opts.autoScreenshot);
  const target = new McpTarget({
    command: process.execPath,
    args: [join(opts.argentRoot, 'packages', 'argent', 'dist', 'cli.js'), 'mcp'],
    env: { ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1' },
    cwd,
  });
  const calls: CallRecord[] = [];
  let describeSize: { bytes: number; tokens: number } | undefined;
  try {
    await target.connect();

    // Measure argent's describe on the Settings root once, before the flow.
    await target.callTool('launch-app', { udid: opts.udid, bundleId: opts.bundleId });
    await new Promise((r) => setTimeout(r, 2500));
    const d = await target.callTool('describe', { udid: opts.udid });
    const dTree = treeFromResult(d);
    describeSize = { bytes: Buffer.byteLength(dTree, 'utf8'), tokens: await opts.counter.countText(dTree) };
    let lastTree = (d.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');

    const hasTree = (s: string): boolean => s.includes('ROOT') || s.includes('Elements after action');

    if (opts.mode === 'sequence') {
      const args = sequenceSteps(opts.udid, opts.bundleId);
      const res = await target.callTool('run-sequence', args);
      calls.push(await captureCall({ step: 1, tool: 'run-sequence', origin: 'agent', requestArgs: args, result: res }, opts.counter));
    } else {
      for (const step of verbSteps(opts.udid, opts.bundleId)) {
        let args = typeof step.args === 'function' ? step.args(lastTree) : step.args;
        // Tap target not in the current tree (a flaky auto-describe left us
        // without a fresh one): pay an explicit describe with backoff to
        // refresh, exactly as an agent would, and record that round-trip.
        if (!args && typeof step.args === 'function') {
          const refreshed = await withRetry(async () => {
            const dd = await target.callTool('describe', { udid: opts.udid });
            const txt = (dd.content ?? []).map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n');
            return hasTree(txt) ? { dd, txt } : null;
          });
          if (refreshed) {
            calls.push(await captureCall({ step: step.n, tool: 'describe', origin: 'agent', requestArgs: { udid: opts.udid }, result: refreshed.dd }, opts.counter));
            lastTree = refreshed.txt;
            args = (step.args as (t: string) => Record<string, unknown> | null)(lastTree);
          }
        }
        if (!args) {
          calls.push({ step: step.n, tool: step.tool, origin: 'agent', requestBytes: 0, requestTokens: 0, resultBytes: 0, resultTokens: 0, contentTypes: ['skipped-target-not-found'] });
          continue;
        }
        const res = await target.callTool(step.tool, args);
        calls.push(await captureCall({ step: step.n, tool: step.tool, origin: 'agent', requestArgs: args, result: res }, opts.counter));
        const t = treeFromResult(res);
        // Only trust it as the navigation tree when it actually is one — an
        // await-ui-element ack must not clobber the last real tree.
        if (hasTree(t)) lastTree = t;
      }
    }
  } finally {
    await target.close();
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  return { calls, describeSize };
}
