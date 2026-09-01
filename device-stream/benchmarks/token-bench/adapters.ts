/**
 * Per-model adapter tables — the fairness artifact.
 *
 * Each configuration expands the SAME 10 logical scenario steps into a concrete
 * sequence of tool round-trips. This table is printed verbatim in RESULTS.md so a
 * reviewer can audit exactly which describes each model paid for, where argent's
 * server-side auto-capture (screenshot / element tree) is appended, and where the
 * script model collapses steps into one round-trip.
 *
 * A `PlannedCall` is one round-trip. `origin`:
 *   - 'agent'          : a call the agent issued.
 *   - 'auto-screenshot': a full screenshot argent's MCP adapter appends after the
 *                        agent call (A1/A2/A4 only; off in A3).
 *   - 'auto-describe'  : the element tree argent's MCP adapter appends after the
 *                        agent call (A1/A2/A3/A4 — argent's auto-describe).
 *
 * `coversSteps` lets one round-trip (run-sequence, a script body) account for
 * several logical steps; the report attributes its cost to the first covered step.
 */

export type Origin = 'agent' | 'auto-screenshot' | 'auto-describe';

export type Platform = 'android' | 'ios';

/**
 * Which server binary drives the config:
 *   - 'upstream'      : the read-only argent vendor clone (A configs, unmodified).
 *   - 'fork'          : the argent fork with the `run-script` tool (F configs).
 *   - 'device-stream' : the device-farm MCP server (B/C configs).
 */
export type Variant = 'upstream' | 'fork' | 'integration' | 'device-stream';

export interface PlannedCall {
  tool: string;
  origin: Origin;
  /** Logical scenario steps (1-based) this round-trip covers. */
  coversSteps: number[];
  /** Human note for the printed table. */
  note?: string;
}

export interface AdapterConfig {
  id: string;
  server: 'argent' | 'device-stream';
  /** Target platform for the live flow. */
  platform: Platform;
  /** Which server build backs this config (see Variant). */
  variant: Variant;
  description: string;
  /** How the fixed context is scoped for this configuration. */
  fixed: string;
  /** Whether argent auto-screenshot / auto-describe are active. */
  autoScreenshot: boolean;
  autoDescribe: boolean;
  plan: PlannedCall[];
}

const STEP_COUNT = 10;

/* ---------- argent building blocks ---------------------------------------- */

// An argent interaction that triggers auto-capture: the agent call, then the
// adapter-appended screenshot (if on) and element tree (if on).
function argentInteract(
  tool: string,
  steps: number[],
  autoScreenshot: boolean,
  autoDescribe: boolean,
  note?: string,
): PlannedCall[] {
  const calls: PlannedCall[] = [{ tool, origin: 'agent', coversSteps: steps, note }];
  if (autoScreenshot) {
    calls.push({ tool: 'screenshot', origin: 'auto-screenshot', coversSteps: steps, note: 'adapter-appended after action' });
  }
  if (autoDescribe) {
    calls.push({ tool: 'describe', origin: 'auto-describe', coversSteps: steps, note: 'adapter-appended element tree' });
  }
  return calls;
}

// The 10-step flow expressed as argent agent verbs (before auto-capture expansion).
// Step 2 (orient) is free under argent: the launch in step 1 already auto-describes.
const ARGENT_VERBS: Array<{ tool: string; steps: number[]; note?: string }> = [
  { tool: 'launch-app', steps: [1, 2], note: 'launch + orient (step 2 free via auto-describe)' },
  { tool: 'gesture-tap', steps: [3], note: "tap 'Network & internet'" },
  { tool: 'await-ui-element', steps: [4], note: "assert 'Internet' visible" },
  { tool: 'button', steps: [5], note: 'back' },
  { tool: 'gesture-tap', steps: [6], note: 'tap search' },
  { tool: 'keyboard', steps: [6], note: "type 'battery'" },
  { tool: 'gesture-tap', steps: [7], note: 'tap first result' },
  { tool: 'await-ui-element', steps: [8], note: 'assert battery element visible' },
  { tool: 'gesture-tap', steps: [9], note: 'toggle Battery Saver' },
  { tool: 'await-ui-element', steps: [9], note: 'assert state change' },
  { tool: 'button', steps: [10], note: 'back' },
  { tool: 'await-ui-element', steps: [10], note: 'assert Settings root visible' },
];

function argentPlan(autoScreenshot: boolean, autoDescribe: boolean): PlannedCall[] {
  return ARGENT_VERBS.flatMap((v) => argentInteract(v.tool, v.steps, autoScreenshot, autoDescribe, v.note));
}

// The iOS Settings flow (scenario-ios.json) expressed as argent verbs, before
// auto-capture expansion. Unlike Android, iOS `launch-app` returns init_failed
// here (the RN native-devtools dylib is not shipped) and does NOT auto-describe,
// so orientation (step 2) costs an EXPLICIT describe. Every subsequent action
// (tap / await) still triggers argent's auto-screenshot + auto-describe. The
// Android toggle step is realised on iOS as a navigate-into-a-section + assert
// transition (iOS 26 sim Settings has no shallow switch — see scenario-ios.json).
const ARGENT_VERBS_IOS: Array<{ tool: string; steps: number[]; note?: string }> = [
  { tool: 'gesture-tap', steps: [3], note: "tap 'Geral' (General)" },
  { tool: 'await-ui-element', steps: [4], note: 'assert General sub-screen (BackButton)' },
  { tool: 'gesture-tap', steps: [5], note: 'tap BackButton to root' },
  { tool: 'gesture-tap', steps: [6], note: "tap 'Acessibilidade' (Accessibility)" },
  { tool: 'await-ui-element', steps: [7], note: 'assert Accessibility sub-screen (BackButton)' },
  { tool: 'gesture-tap', steps: [8], note: 'tap BackButton to root' },
  { tool: 'gesture-tap', steps: [9], note: "tap 'Câmera' (Camera)" },
  { tool: 'await-ui-element', steps: [9], note: 'assert Camera sub-screen transition (BackButton)' },
  { tool: 'gesture-tap', steps: [10], note: 'tap BackButton to root' },
  { tool: 'await-ui-element', steps: [10], note: 'assert Settings root (General row)' },
];

function argentPlanIos(autoScreenshot: boolean, autoDescribe: boolean): PlannedCall[] {
  const head: PlannedCall[] = [
    { tool: 'launch-app', origin: 'agent', coversSteps: [1], note: 'launch Settings (init_failed on iOS: RN dylib absent; foregrounded via simctl; no auto-capture)' },
    { tool: 'describe', origin: 'agent', coversSteps: [2], note: 'explicit orientation (iOS launch-app does not auto-describe)' },
  ];
  return head.concat(
    ARGENT_VERBS_IOS.flatMap((v) => argentInteract(v.tool, v.steps, autoScreenshot, autoDescribe, v.note)),
  );
}

// A4-ios: the 10 iOS steps compressed into one argent run-sequence (blind
// coordinate taps — run-sequence cannot re-describe between steps), then the one
// auto-capture pair. Same best-case-amortization shape as Android A4.
const A4_IOS_PLAN: PlannedCall[] = [
  { tool: 'run-sequence', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: "one sequence call (blind coordinate taps); CAVEAT: run-sequence forbids dependent steps and cannot re-describe — argent's best-case amortization, reported with that caveat" },
  { tool: 'screenshot', origin: 'auto-screenshot', coversSteps: [10], note: 'auto-capture after the sequence' },
  { tool: 'describe', origin: 'auto-describe', coversSteps: [10], note: 'auto-capture after the sequence' },
];

// F1 (Android) / F2 (iOS): the fork's `run-script`. One orientation describe,
// then ONE run-script call that drives the whole flow (asserts included, via the
// injected `ui` facade in the script body). argent auto-capture (screenshot +
// element tree) is appended to the run-script result exactly like run-sequence.
function forkRunScriptPlan(): PlannedCall[] {
  return [
    { tool: 'describe', origin: 'agent', coversSteps: [1, 2], note: 'initial orientation' },
    { tool: 'run-script', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: 'entire flow, one round-trip' },
    { tool: 'screenshot', origin: 'auto-screenshot', coversSteps: [10], note: 'auto-capture after the script' },
    { tool: 'describe', origin: 'auto-describe', coversSteps: [10], note: 'auto-capture after the script' },
  ];
}

/* ---------- device-stream building blocks --------------------------------- */

// B1: atomic dsl_* tools. Our tools do NOT auto-describe, so the agent pays an
// explicit dsl_describe before each context-dependent step and for each assert.
const B1_PLAN: PlannedCall[] = [
  { tool: 'dsl_launch_app', origin: 'agent', coversSteps: [1] },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [2], note: 'orient (paid explicitly)' },
  { tool: 'dsl_tap', origin: 'agent', coversSteps: [3] },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [4], note: "assert 'Internet' visible" },
  { tool: 'dsl_press_key', origin: 'agent', coversSteps: [5], note: 'back' },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [6], note: 'locate search field' },
  { tool: 'dsl_tap', origin: 'agent', coversSteps: [6], note: 'tap search' },
  { tool: 'dsl_fill', origin: 'agent', coversSteps: [6], note: "type 'battery'" },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [7], note: 'locate first result' },
  { tool: 'dsl_tap', origin: 'agent', coversSteps: [7], note: 'tap first result' },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [8], note: 'assert battery element visible' },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [9], note: 'locate + read switch state' },
  { tool: 'dsl_tap', origin: 'agent', coversSteps: [9], note: 'toggle Battery Saver' },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [9], note: 'assert state change' },
  { tool: 'dsl_press_key', origin: 'agent', coversSteps: [10], note: 'back' },
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [10], note: 'assert Settings root visible' },
];

// C1: one initial dsl_describe for orientation, then ONE dsl_run_script that
// drives the whole flow (asserts included, via awaitUntil in the script body).
const C1_PLAN: PlannedCall[] = [
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [1, 2], note: 'initial orientation' },
  { tool: 'dsl_run_script', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: 'entire flow, one round-trip' },
];

// C2: cold path — the first script hits a selector miss (WS1 diagnostic error
// result), the agent re-submits a corrected script. Two script round-trips.
const C2_PLAN: PlannedCall[] = [
  { tool: 'dsl_describe', origin: 'agent', coversSteps: [1, 2], note: 'initial orientation' },
  { tool: 'dsl_run_script', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: 'first attempt: selector miss → WS1 diagnostic error' },
  { tool: 'dsl_run_script', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: 'corrected re-submit' },
];

/* ---------- the configuration set ----------------------------------------- */

export const ADAPTERS: AdapterConfig[] = [
  {
    id: 'A1',
    server: 'argent',
    platform: 'android',
    variant: 'upstream',
    description: 'argent, defaults (auto-describe + auto-screenshot on)',
    fixed: 'alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: argentPlan(true, true),
  },
  {
    id: 'A2',
    server: 'argent',
    platform: 'android',
    variant: 'upstream',
    description: 'argent, all 77 tools in context (no progressive loading)',
    fixed: 'all 77 tool defs + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: argentPlan(true, true),
  },
  {
    id: 'A3',
    server: 'argent',
    platform: 'android',
    variant: 'upstream',
    description: 'argent, disable-auto-screenshot (element tree only)',
    fixed: 'alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: false,
    autoDescribe: true,
    plan: argentPlan(false, true),
  },
  {
    id: 'A4',
    server: 'argent',
    platform: 'android',
    variant: 'upstream',
    description: "argent run-sequence (10 steps as one sequence call)",
    fixed: 'alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: [
      { tool: 'run-sequence', origin: 'agent', coversSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], note: "one sequence call; CAVEAT: run-sequence's own description forbids dependent steps — this is argent's best-case amortization, reported with that caveat" },
      { tool: 'screenshot', origin: 'auto-screenshot', coversSteps: [10], note: 'auto-capture after the sequence' },
      { tool: 'describe', origin: 'auto-describe', coversSteps: [10], note: 'auto-capture after the sequence' },
    ],
  },
  {
    id: 'B1',
    server: 'device-stream',
    platform: 'android',
    variant: 'device-stream',
    description: 'device-stream atomic dsl_* tools (describe before each context-dependent step)',
    fixed: '18 dsl_* tool defs (no rule, no frontmatters, no MCP instructions today)',
    autoScreenshot: false,
    autoDescribe: false,
    plan: B1_PLAN,
  },
  {
    id: 'C1',
    server: 'device-stream',
    platform: 'android',
    variant: 'device-stream',
    description: 'dsl_run_script (1 orientation describe + 1 script round-trip)',
    fixed: 'dsl_run_script tool def + @device-stream/dsl .d.ts surface (index.d.ts + types.d.ts)',
    autoScreenshot: false,
    autoDescribe: false,
    plan: C1_PLAN,
  },
  {
    id: 'C2',
    server: 'device-stream',
    platform: 'android',
    variant: 'device-stream',
    description: 'dsl_run_script, cold (selector-miss recovery: 2 script round-trips)',
    fixed: 'dsl_run_script tool def + @device-stream/dsl .d.ts surface (index.d.ts + types.d.ts)',
    autoScreenshot: false,
    autoDescribe: false,
    plan: C2_PLAN,
  },
  {
    id: 'F1',
    server: 'argent',
    platform: 'android',
    variant: 'fork',
    description: 'argent fork run-script, Android (1 orientation describe + 1 run-script round-trip)',
    fixed: 'alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: forkRunScriptPlan(),
  },
  {
    id: 'F2',
    server: 'argent',
    platform: 'ios',
    variant: 'fork',
    description: 'argent fork run-script, iOS simulator (1 orientation describe + 1 run-script round-trip)',
    fixed: 'alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: forkRunScriptPlan(),
  },
  {
    id: 'FX',
    server: 'argent',
    platform: 'android',
    variant: 'integration',
    description: 'argent integration branch run-script, Android (both flags on: run-script + open-device-server)',
    fixed: 'alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: forkRunScriptPlan(),
  },
  {
    id: 'FX-ios',
    server: 'argent',
    platform: 'ios',
    variant: 'integration',
    description: 'argent integration branch run-script, iOS simulator (both flags on; open-device-server is Android-only)',
    fixed: 'alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: forkRunScriptPlan(),
  },
  {
    id: 'A1-ios',
    server: 'argent',
    platform: 'ios',
    variant: 'upstream',
    description: 'argent defaults, iOS simulator (auto-describe + auto-screenshot on)',
    fixed: 'alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: argentPlanIos(true, true),
  },
  {
    id: 'A4-ios',
    server: 'argent',
    platform: 'ios',
    variant: 'upstream',
    description: 'argent run-sequence, iOS simulator (10 steps as one sequence call)',
    fixed: 'alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions',
    autoScreenshot: true,
    autoDescribe: true,
    plan: A4_IOS_PLAN,
  },
];

export function getAdapter(id: string): AdapterConfig {
  const a = ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown configuration '${id}'`);
  return a;
}

export function stepCount(): number {
  return STEP_COUNT;
}

/** Round-trip count for a configuration — structural, independent of any device. */
export function roundTripCount(a: AdapterConfig): number {
  return a.plan.length;
}
