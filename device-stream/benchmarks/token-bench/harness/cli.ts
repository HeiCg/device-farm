/**
 * Benchmark CLI.
 *
 *   tsx harness/cli.ts fixed          # capture live fixed context for every config
 *   tsx harness/cli.ts fixed A1 B1    # ...only the named configs
 *   tsx harness/cli.ts report         # (re)generate results/RESULTS.md from captures
 *   tsx harness/cli.ts flow <id>      # best-effort: drive the live device flow
 *
 * `fixed` connects to each real MCP server over stdio, reads `tools/list` and the
 * `instructions` string, and combines them with the on-disk always-in-context
 * artifacts. It does NOT need the on-device driver, so it produces live numbers
 * even when the flow itself is pending.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADAPTERS, getAdapter, type AdapterConfig } from '../adapters.js';
import { resolveCounter, counterDisclaimer } from './tokens.js';
import type { ConfigCapture, FixedArtifact } from './types.js';
import {
  buildFixedContext,
  measureArgentFrontmatters,
  measureFile,
  measureToolList,
  measureInstructions,
  measureRunScriptDts,
  alwaysLoadSubset,
  dslSubset,
  dslScriptTool,
  argentRunScriptTool,
} from './fixed-context.js';
import { McpTarget, type ListedTool } from './mcp-client.js';
import { measureArgentDescribe, runArgentFlow } from './argent-flow.js';
import { runDsFlow } from './ds-flow.js';
import { runForkScriptFlow, runIosArgentFlow, FX_ANDROID_SCRIPT } from './ext-flows.js';
import type { CallRecord } from './types.js';
import { renderResults, type RunMeta } from './report.js';
import { renderSummary } from './summary.js';
import {
  RESULTS_DIR,
  MCP_ENTRY,
  ARGENT_CLI,
  ARGENT_ROOT,
  ARGENT_RULE,
  ARGENT_SKILLS_DIR,
  DSL_INDEX_DTS,
  DSL_TYPES_DTS,
  DEVICE_SERIAL,
  DEVICE_PLATFORM,
  FORK_CLI,
  FORK_ROOT,
  FORK_RULE,
  FORK_SKILLS_DIR,
  FORK_RUN_SCRIPT_SKILL,
  INT_CLI,
  INT_ROOT,
  INT_RULE,
  INT_SKILLS_DIR,
  INT_RUN_SCRIPT_SKILL,
  IOS_UDID,
  XCRUN,
} from './paths.js';

const EMULATOR_IMAGE = 'Pixel 7, Android 15 (API 35), google_apis arm64-v8a';
const IOS_IMAGE = 'QA-iPhone17, iOS 26.4 simulator (pt-BR locale), Xcode 26.4';
const PENDING_REASON_DS =
  'Fixed context is live. Flow blocked by two device-stream issues, both outside this task\'s file ' +
  'scope (benchmarks/token-bench/ only): (1) the DSL AndroidDriver is an HTTP REST client ' +
  '(GET /hierarchy, POST /tap, GET /info→{width,height}) but the deployed @device-stream/android-server ' +
  'on :9008 speaks TCP JSON-RPC (getAccessibilityTree, getInfo→{screenWidth}) — different transport, ' +
  'method names, and field names; dsl_describe returns "fetch failed". (2) Even reached directly over ' +
  'TCP, getAccessibilityTree returns {tree:[]} on a populated Settings screen (idle, foreground ' +
  'confirmed) — the on-device UiAutomation yields no nodes, so describe/selector navigation cannot work.';
const PENDING_REASON_ARGENT =
  'Fixed context is live (tools/list + instructions + rule + frontmatters); describe size measured ' +
  'live below. Flow per-step NOT reported, to avoid a measurement unfair in our favor: argent screenshot ' +
  'fails on this host — "simulator-server binary not found at packages/argent/bin/darwin/simulator-server" ' +
  '(a native binary the read-only clone does not ship; it comes from argent-private-releases). ' +
  'So auto-screenshot — the dominant per-action cost and the core of A1/A2/A4 — can never fire here; ' +
  'measuring argent without it would understate its cost, which the spec forbids. Additionally ' +
  '`uiautomator dump` (argent\'s Android describe) fails intermittently (~60% success), and its native ' +
  'device-driving path conflicts with the device-stream instrumentation for the single UiAutomation ' +
  'channel (only one server may drive at a time). Live tools/list exposes 75 tools (2 profiler tools ' +
  'gated by a missing trace-processor asset), vs 77 in a full install.';

function gitSha(root: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function argentGitInfo(): { sha: string; version: string } {
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(ARGENT_ROOT, 'server.json'), 'utf8')) as { version?: string };
    version = pkg.version ?? 'unknown';
  } catch {
    /* ignore */
  }
  return { sha: gitSha(ARGENT_ROOT), version };
}

/** A throwaway cwd whose `.argent/flags.json` enables the given flags. */
function flagCwd(flags: Record<string, boolean>): string {
  const dir = join(tmpdir(), `argent-flag-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.argent'), { recursive: true });
  writeFileSync(join(dir, '.argent', 'flags.json'), JSON.stringify({ flags }));
  return dir;
}

/**
 * Spawn a fork/integration `argent mcp` with the given flags and read tools +
 * instructions. `cwd` pins the working dir (integration uses the clone root so the
 * tool-server resolves locally and reads project flags); otherwise a throwaway
 * flag cwd is used. `port` isolates the tool-server from a global install's daemon.
 */
async function connectArgentBuild(
  cli: string,
  flags: Record<string, boolean>,
  opts: { cwd?: string; port?: number } = {},
): Promise<{ tools: ListedTool[]; instructions?: string; close: () => Promise<void> }> {
  const usingProvidedCwd = Boolean(opts.cwd);
  if (usingProvidedCwd) {
    mkdirSync(join(opts.cwd!, '.argent'), { recursive: true });
    writeFileSync(join(opts.cwd!, '.argent', 'flags.json'), JSON.stringify({ flags }));
  }
  const cwd = opts.cwd ?? flagCwd(flags);
  const target = new McpTarget({
    command: process.execPath,
    args: [cli, 'mcp'],
    env: {
      ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1',
      ...(opts.port ? { ARGENT_PORT: String(opts.port) } : {}),
    },
    cwd,
  });
  await target.connect();
  const tools = await target.listTools();
  return {
    tools,
    instructions: target.instructions(),
    close: async () => {
      await target.close();
      if (!usingProvidedCwd) {
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

/** Spawn the device-stream MCP server and read its tools + instructions. */
async function connectDeviceStream(): Promise<{ tools: ListedTool[]; instructions?: string; close: () => Promise<void> }> {
  const target = new McpTarget({
    command: process.execPath,
    args: [MCP_ENTRY],
    env: {
      DEVICE_FARM_TOKEN: process.env.DEVICE_FARM_TOKEN ?? 'token-bench-dummy',
      DEVICE_STREAM_SERIAL: DEVICE_SERIAL,
      DEVICE_STREAM_PLATFORM: DEVICE_PLATFORM,
    },
  });
  await target.connect();
  const tools = await target.listTools();
  return { tools, instructions: target.instructions(), close: () => target.close() };
}

/** Spawn `argent mcp` and read its tools + instructions. */
async function connectArgent(): Promise<{ tools: ListedTool[]; instructions?: string; close: () => Promise<void> }> {
  const target = new McpTarget({
    command: process.execPath,
    args: [ARGENT_CLI, 'mcp'],
    env: { ARGENT_TOOL_SERVER_SHUTDOWN_ON_MCP_EXIT: '1' },
    cwd: ARGENT_ROOT,
  });
  await target.connect();
  const tools = await target.listTools();
  return { tools, instructions: target.instructions(), close: () => target.close() };
}

async function captureArgentFixed(a: AdapterConfig): Promise<ConfigCapture> {
  const counter = resolveCounter();
  const git = argentGitInfo();
  const { tools, instructions, close } = await connectArgent();
  try {
    const all = tools;
    const always = alwaysLoadSubset(all);
    const toolSet = a.id === 'A2' ? all : always.length > 0 ? always : all;
    const toolLabel =
      a.id === 'A2'
        ? `all ${all.length} tool defs (live tools/list)`
        : `alwaysLoad subset (${always.length} tools, live tools/list)`;

    const artifacts: FixedArtifact[] = [
      await measureToolList(toolLabel, toolSet, counter, 'wire tools/list payload'),
      await measureFile('rules/argent.md (alwaysApply:true)', ARGENT_RULE, counter, 'always-applied rule'),
      await measureArgentFrontmatters(ARGENT_SKILLS_DIR, counter),
      await measureInstructions('MCP instructions', instructions, counter),
    ];
    let describeSize: { bytes: number; tokens: number } | undefined;
    if (process.env.TOKENBENCH_MEASURE_DESCRIBE === '1') {
      const measured = await measureArgentDescribe(ARGENT_ROOT, DEVICE_SERIAL, 'com.android.settings', counter).catch(() => null);
      if (measured) describeSize = measured;
    }
    return {
      configId: a.id,
      description: a.description,
      counter: counter.kind,
      counterApproximate: counter.isApproximate,
      live: false,
      pendingReason: PENDING_REASON_ARGENT,
      fixed: buildFixedContext(a.id, artifacts),
      calls: [],
      ...(describeSize ? { describeSize } : {}),
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await close();
    void git;
  }
}

const PENDING_REASON_FORK =
  'Fixed context is live (tools/list with the script flag enabled + run-script ui .d.ts + rule + ' +
  'frontmatters + MCP instructions). Flow pending: not yet driven against a device in this run.';

async function captureForkFixed(a: AdapterConfig): Promise<ConfigCapture> {
  const counter = resolveCounter();
  const integration = a.variant === 'integration';
  const cli = integration ? INT_CLI : FORK_CLI;
  const rule = integration ? INT_RULE : FORK_RULE;
  const skillsDir = integration ? INT_SKILLS_DIR : FORK_SKILLS_DIR;
  const skill = integration ? INT_RUN_SCRIPT_SKILL : FORK_RUN_SCRIPT_SKILL;
  const flags: Record<string, boolean> = integration
    ? { 'run-script': true, 'open-device-server': true }
    : { 'run-script': true };
  const connectOpts = integration ? { cwd: INT_ROOT, port: 47301 } : {};
  const { tools, instructions, close } = await connectArgentBuild(cli, flags, connectOpts);
  try {
    const always = alwaysLoadSubset(tools);
    const runScript = argentRunScriptTool(tools);
    const artifacts: FixedArtifact[] = [
      await measureToolList(`alwaysLoad subset (${always.length} tools, live tools/list)`, always, counter, 'wire tools/list payload'),
      await measureToolList('run-script tool def (live tools/list)', runScript, counter, 'wire tools/list payload (progressively loaded; the script tool the agent invokes)'),
      await measureRunScriptDts(skill, counter),
      await measureFile('rules/argent.md (alwaysApply:true)', rule, counter, 'always-applied rule'),
      await measureArgentFrontmatters(skillsDir, counter),
      await measureInstructions('MCP instructions', instructions, counter),
    ];
    return {
      configId: a.id,
      description: a.description,
      counter: counter.kind,
      counterApproximate: counter.isApproximate,
      live: false,
      pendingReason: PENDING_REASON_FORK,
      fixed: buildFixedContext(a.id, artifacts),
      calls: [],
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await close();
  }
}

async function captureDeviceStreamFixed(a: AdapterConfig): Promise<ConfigCapture> {
  const counter = resolveCounter();
  const { tools, close } = await connectDeviceStream();
  try {
    const artifacts: FixedArtifact[] = [];
    if (a.id === 'B1') {
      const subset = dslSubset(tools);
      artifacts.push(await measureToolList(`${subset.length} dsl_* tool defs (live tools/list)`, subset, counter, 'wire tools/list payload'));
    } else {
      // C1 / C2
      const scriptTool = dslScriptTool(tools);
      artifacts.push(await measureToolList('dsl_run_script tool def (live tools/list)', scriptTool, counter, 'wire tools/list payload'));
      artifacts.push(await measureFile('@device-stream/dsl index.d.ts', DSL_INDEX_DTS, counter, 'script documentation surface'));
      artifacts.push(await measureFile('@device-stream/dsl types.d.ts', DSL_TYPES_DTS, counter, 'script documentation surface'));
    }
    return {
      configId: a.id,
      description: a.description,
      counter: counter.kind,
      counterApproximate: counter.isApproximate,
      live: false,
      pendingReason: PENDING_REASON_DS,
      fixed: buildFixedContext(a.id, artifacts),
      calls: [],
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await close();
  }
}

async function captureFixed(ids: string[]): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });
  for (const id of ids) {
    const a = getAdapter(id);
    process.stderr.write(`[token-bench] capturing fixed context: ${id} (${a.server}/${a.variant})\n`);
    const capture =
      a.variant === 'fork' || a.variant === 'integration'
        ? await captureForkFixed(a)
        : a.server === 'argent'
          ? await captureArgentFixed(a)
          : await captureDeviceStreamFixed(a);
    writeFileSync(join(RESULTS_DIR, `${id}.capture.json`), JSON.stringify(capture, null, 2));
    writeFileSync(join(RESULTS_DIR, `${id}.jsonl`), capture.calls.map((c) => JSON.stringify(c)).join('\n') + (capture.calls.length ? '\n' : ''));
    process.stderr.write(`[token-bench]   fixed = ${capture.fixed.totalTokens} tok (${capture.fixed.totalBytes} B)\n`);
  }
}

/**
 * Drive the argent configurations live and fold their captured calls into the
 * existing capture.json (which already holds the live fixed context). A2's flow
 * is identical to A1's (only fixed context differs), so A1 is driven once and its
 * calls are reused for A2. B1/C1/C2 remain pending (device-stream flow blocked).
 *
 * PRECONDITION: the device-stream android-server instrumentation must be stopped
 * (it holds the single UiAutomation channel argent's `uiautomator dump` needs).
 */
async function runFlows(ids: string[]): Promise<void> {
  const counter = resolveCounter();
  const bundleId = 'com.android.settings';
  let a1Calls: CallRecord[] | null = null;
  let a1Describe: { bytes: number; tokens: number } | undefined;

  const flowFor = async (id: string): Promise<{ calls: CallRecord[]; describeSize?: { bytes: number; tokens: number } }> => {
    if (id === 'A2') {
      if (!a1Calls) {
        const a1 = await runArgentFlow({ argentRoot: ARGENT_ROOT, udid: DEVICE_SERIAL, bundleId, counter, autoScreenshot: true, mode: 'verbs' });
        a1Calls = a1.calls;
        a1Describe = a1.describeSize;
      }
      return { calls: a1Calls, describeSize: a1Describe };
    }
    const autoScreenshot = id !== 'A3';
    const mode = id === 'A4' ? 'sequence' : 'verbs';
    const r = await runArgentFlow({ argentRoot: ARGENT_ROOT, udid: DEVICE_SERIAL, bundleId, counter, autoScreenshot, mode });
    if (id === 'A1') {
      a1Calls = r.calls;
      a1Describe = r.describeSize;
    }
    return r;
  };

  const adb = process.env.TOKENBENCH_ADB ?? 'adb';

  const flowForId = async (
    id: string,
    a: AdapterConfig,
  ): Promise<{ calls: CallRecord[]; describeSize?: { bytes: number; tokens: number }; describeSource?: string }> => {
    if (a.variant === 'fork') {
      return runForkScriptFlow({
        forkCli: FORK_CLI,
        forkRoot: FORK_ROOT,
        platform: a.platform,
        udid: a.platform === 'ios' ? IOS_UDID : DEVICE_SERIAL,
        counter,
        adb,
        xcrun: XCRUN,
      });
    }
    if (a.variant === 'integration') {
      return runForkScriptFlow({
        forkCli: INT_CLI,
        forkRoot: INT_ROOT,
        platform: a.platform,
        udid: a.platform === 'ios' ? IOS_UDID : DEVICE_SERIAL,
        counter,
        adb,
        xcrun: XCRUN,
        flags: { 'run-script': true, 'open-device-server': true },
        cwd: INT_ROOT,
        port: 47302,
        ...(a.platform === 'android' ? { androidScript: FX_ANDROID_SCRIPT } : {}),
      });
    }
    if (a.server === 'argent' && a.platform === 'ios') {
      return runIosArgentFlow({
        argentCli: ARGENT_CLI,
        udid: IOS_UDID,
        counter,
        xcrun: XCRUN,
        mode: id === 'A4-ios' ? 'sequence' : 'verbs',
      });
    }
    if (a.server === 'argent') return flowFor(id);
    return runDsFlow({ mcpEntry: MCP_ENTRY, serial: DEVICE_SERIAL, counter, adb, config: id as 'B1' | 'C1' | 'C2' });
  };

  for (const id of ids) {
    const a = getAdapter(id);
    process.stderr.write(`[token-bench] driving live flow: ${id} (${a.variant}/${a.platform})\n`);
    const { calls, describeSize, describeSource } = await flowForId(id, a);
    const p = join(RESULTS_DIR, `${id}.capture.json`);
    const capture = JSON.parse(readFileSync(p, 'utf8')) as ConfigCapture;
    capture.calls = calls;
    capture.live = true;
    delete capture.pendingReason;
    if (describeSize) capture.describeSize = describeSize;
    if (describeSource) capture.describeSource = describeSource;
    capture.capturedAt = new Date().toISOString();
    writeFileSync(p, JSON.stringify(capture, null, 2));
    writeFileSync(join(RESULTS_DIR, `${id}.jsonl`), calls.map((c) => JSON.stringify(c)).join('\n') + (calls.length ? '\n' : ''));
    const rt = calls.length;
    process.stderr.write(`[token-bench]   ${id}: ${rt} round-trips captured\n`);
  }
}

function report(): void {
  const counter = resolveCounter();
  const git = argentGitInfo();
  const inputs = ADAPTERS.map((adapter) => {
    const p = join(RESULTS_DIR, `${adapter.id}.capture.json`);
    const capture = JSON.parse(readFileSync(p, 'utf8')) as ConfigCapture;
    return { adapter, capture };
  });
  const meta: RunMeta = {
    counter: counter.kind,
    counterApproximate: counter.isApproximate,
    counterDisclaimer: counterDisclaimer(counter),
    argentSha: git.sha,
    argentVersion: git.version,
    forkSha: gitSha(FORK_ROOT),
    forkBranch: 'feat/run-script',
    integrationSha: gitSha(INT_ROOT),
    integrationBranch: 'integration/device-stream',
    upstreamOriginalSha: 'b835de2326b2c396c010402b2a8f59613e23b462',
    fairnessNote:
      'Fork base = upstream a2ed83e0 (merge-base of feat/run-script). The upstream vendor clone was ' +
      'moved from the original benchmark SHA b835de2 (v0.22.1) to a2ed83e0 so fork and upstream share a ' +
      'base. The upstream tools/list wire payload is byte-identical at a2ed83e0 and b835de2 (same 75 ' +
      'tools, same 14 alwaysLoad), and rules/argent.md + skill frontmatters are unchanged between them ' +
      '(empty diff), so the A1-A4 Android fixed context and flow numbers (captured at b835de2) are ' +
      'unchanged as the upstream baseline; A-config Android flows were NOT re-run.',
    emulatorImage: EMULATOR_IMAGE,
    iosImage: IOS_IMAGE,
    scenarioName: 'android-settings-10-step',
    iosScenarioName: 'ios-settings-10-step',
    generatedAt: new Date().toISOString(),
    stepCount: 10,
  };
  const md = renderResults(inputs, meta);
  writeFileSync(join(RESULTS_DIR, 'RESULTS.md'), md);
  process.stderr.write(`[token-bench] wrote ${join(RESULTS_DIR, 'RESULTS.md')}\n`);
}

function summaryCmd(): void {
  const counter = resolveCounter();
  const git = argentGitInfo();
  const inputs = ADAPTERS.map((adapter) => {
    const p = join(RESULTS_DIR, `${adapter.id}.capture.json`);
    const capture = JSON.parse(readFileSync(p, 'utf8')) as ConfigCapture;
    return { adapter, capture };
  });
  const meta: RunMeta = {
    counter: counter.kind,
    counterApproximate: counter.isApproximate,
    counterDisclaimer: counterDisclaimer(counter),
    argentSha: git.sha,
    argentVersion: git.version,
    forkSha: gitSha(FORK_ROOT),
    forkBranch: 'feat/run-script',
    integrationSha: gitSha(INT_ROOT),
    integrationBranch: 'integration/device-stream',
    upstreamOriginalSha: 'b835de2326b2c396c010402b2a8f59613e23b462',
    emulatorImage: EMULATOR_IMAGE,
    iosImage: IOS_IMAGE,
    scenarioName: 'android-settings-10-step',
    iosScenarioName: 'ios-settings-10-step',
    generatedAt: new Date().toISOString(),
    stepCount: 10,
  };
  const md = renderSummary(inputs, meta);
  writeFileSync(join(RESULTS_DIR, 'SUMMARY.md'), md);
  process.stderr.write(`[token-bench] wrote ${join(RESULTS_DIR, 'SUMMARY.md')}\n`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'fixed') {
    const ids = rest.length > 0 ? rest : ADAPTERS.map((a) => a.id);
    await captureFixed(ids);
  } else if (cmd === 'report') {
    report();
  } else if (cmd === 'summary') {
    summaryCmd();
  } else if (cmd === 'flow') {
    const ids = rest.length > 0 ? rest : ['A1', 'A2', 'A3', 'A4'];
    await runFlows(ids);
  } else {
    process.stderr.write('usage: cli.ts <fixed [ids...] | report | summary | flow <ids...>>\n');
    process.exitCode = 1;
  }
}

// Only run when executed directly.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('cli.ts');
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[token-bench] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { captureFixed, report };
