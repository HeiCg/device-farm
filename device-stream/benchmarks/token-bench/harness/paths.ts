/**
 * Filesystem locations the harness reads. Every one is overridable by env so the
 * reproduction in run.md is not pinned to one machine. Defaults match this repo's
 * layout and the argent clone in the session scratchpad.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // harness/
export const BENCH_ROOT = resolve(HERE, '..');
export const RESULTS_DIR = join(BENCH_ROOT, 'results');

/** device-farm repo root (…/device-farm). */
export const REPO_ROOT = resolve(BENCH_ROOT, '..', '..', '..');
export const DEVICE_STREAM_ROOT = resolve(BENCH_ROOT, '..', '..');

/** Built device-stream MCP server entry (node …/mcp/dist/index.js). */
export const MCP_ENTRY =
  process.env.TOKENBENCH_MCP_ENTRY ?? join(REPO_ROOT, 'mcp', 'dist', 'index.js');

/** @device-stream/dsl built .d.ts surface the script agent needs. */
export const DSL_INDEX_DTS =
  process.env.TOKENBENCH_DSL_INDEX_DTS ??
  join(DEVICE_STREAM_ROOT, 'packages', 'dsl', 'dist', 'index.d.ts');
export const DSL_TYPES_DTS =
  process.env.TOKENBENCH_DSL_TYPES_DTS ??
  join(DEVICE_STREAM_ROOT, 'packages', 'dsl', 'dist', 'types.d.ts');

/** argent read-only clone (pinned SHA recorded in run.md / RESULTS.md). */
export const ARGENT_ROOT =
  process.env.TOKENBENCH_ARGENT_ROOT ??
  '/private/tmp/claude-501/-Users-heicg-Desktop-projects-device-farm-device-stream/f494020d-4d6d-4533-9918-a025d7c363ad/scratchpad/argent-research';

export const ARGENT_CLI = join(ARGENT_ROOT, 'packages', 'argent', 'dist', 'cli.js');
export const ARGENT_RULE = join(ARGENT_ROOT, 'packages', 'skills', 'rules', 'argent.md');
export const ARGENT_SKILLS_DIR = join(ARGENT_ROOT, 'packages', 'skills', 'skills');

/**
 * argent FORK clone (branch `feat/run-script`, base a2ed83e0). Built like the
 * vendor clone; native binaries copied in post-build (see run.md). Drives the F
 * configs (fork `run-script` tool). Its SHA is recorded alongside the upstream
 * SHA in RESULTS.md.
 */
export const FORK_ROOT =
  process.env.TOKENBENCH_FORK_ROOT ??
  '/private/tmp/claude-501/-Users-heicg-Desktop-projects-device-farm-device-stream/f494020d-4d6d-4533-9918-a025d7c363ad/scratchpad/argent-fork';

export const FORK_CLI = join(FORK_ROOT, 'packages', 'argent', 'dist', 'cli.js');
export const FORK_RULE = join(FORK_ROOT, 'packages', 'skills', 'rules', 'argent.md');
export const FORK_SKILLS_DIR = join(FORK_ROOT, 'packages', 'skills', 'skills');
/** The run-script authoring `.d.ts` block lives in this skill body. */
export const FORK_RUN_SCRIPT_SKILL = join(
  FORK_SKILLS_DIR,
  'argent-device-interact',
  'SKILL.md',
);

/**
 * argent INTEGRATION clone (branch `integration/device-stream`, base a2ed83e0):
 * run-script + rich-selectors + android-system-verbs + android-open-server merged,
 * EXPECTED_TOOL_COUNT 81. Drives config FX with BOTH `run-script` and
 * `open-device-server` flags enabled. Built like the other clones; native binaries
 * + the android-device-server APK copied in post-build (see run.md §6).
 */
export const INT_ROOT =
  process.env.TOKENBENCH_INT_ROOT ??
  '/private/tmp/claude-501/-Users-heicg-Desktop-projects-device-farm-device-stream/f494020d-4d6d-4533-9918-a025d7c363ad/scratchpad/argent-integration';

export const INT_CLI = join(INT_ROOT, 'packages', 'argent', 'dist', 'cli.js');
export const INT_RULE = join(INT_ROOT, 'packages', 'skills', 'rules', 'argent.md');
export const INT_SKILLS_DIR = join(INT_ROOT, 'packages', 'skills', 'skills');
export const INT_RUN_SCRIPT_SKILL = join(
  INT_SKILLS_DIR,
  'argent-device-interact',
  'SKILL.md',
);

/** Android device target (from the environment the MCP servers themselves read). */
export const DEVICE_SERIAL = process.env.DEVICE_STREAM_SERIAL ?? 'emulator-5554';
export const DEVICE_PLATFORM = process.env.DEVICE_STREAM_PLATFORM ?? 'android';

/** iOS simulator target (QA-iPhone17, iOS 26.4). */
export const IOS_UDID =
  process.env.TOKENBENCH_IOS_UDID ?? 'DBF8B093-58A2-4B57-812A-60D6CF8594BD';
/** `xcrun` path for the iOS accommodations (simctl launch to foreground Settings). */
export const XCRUN = process.env.TOKENBENCH_XCRUN ?? 'xcrun';
