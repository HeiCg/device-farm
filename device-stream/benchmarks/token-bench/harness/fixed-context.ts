/**
 * Gather the fixed (always-in-context) artifacts for each configuration and size
 * them. Two kinds of source:
 *
 *   - Live: a server's `tools/list` wire payload + its MCP `instructions` string,
 *     captured by actually connecting to the spawned server.
 *   - On-disk: argent's `rules/argent.md` and its 16 skill SKILL.md frontmatters
 *     (always-applied guidance), and the `@device-stream/dsl` `.d.ts` surface the
 *     script agent needs.
 *
 * The summation (`buildFixedContext`) is pure and unit-tested; the gatherers do IO.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TokenCounter } from './tokens.js';
import type { FixedArtifact, FixedContext } from './types.js';
import { measureText } from './capture.js';
import { toolWireObject, isAlwaysLoad, type ListedTool } from './mcp-client.js';

/** Sum a list of measured artifacts into a FixedContext. Pure. */
export function buildFixedContext(configId: string, artifacts: FixedArtifact[]): FixedContext {
  return {
    configId,
    artifacts,
    totalBytes: artifacts.reduce((a, x) => a + x.bytes, 0),
    totalTokens: artifacts.reduce((a, x) => a + x.tokens, 0),
  };
}

/**
 * Extract the YAML frontmatter block (the leading `--- … ---`) from a markdown
 * file. Returns '' if there is none. The frontmatter is what a skill contributes
 * to always-in-context cost; the body loads on demand.
 */
export function extractFrontmatter(md: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  return m ? m[0] : '';
}

/** Measure argent's 16 skill frontmatters as one artifact (concatenated). */
export async function measureArgentFrontmatters(
  skillsDir: string,
  counter: TokenCounter,
): Promise<FixedArtifact> {
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const blocks: string[] = [];
  let count = 0;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(skillsDir, e.name, 'SKILL.md');
    try {
      const fm = extractFrontmatter(readFileSync(p, 'utf8'));
      if (fm) {
        blocks.push(fm);
        count++;
      }
    } catch {
      /* skill without a SKILL.md — skip */
    }
  }
  const joined = blocks.join('\n');
  const m = await measureText(joined, counter);
  return { name: `argent skill frontmatters (${count} skills)`, ...m, note: 'concatenated YAML frontmatter of each SKILL.md; bodies load on demand' };
}

/** Measure a plain file as one named artifact. */
export async function measureFile(
  name: string,
  path: string,
  counter: TokenCounter,
  note?: string,
): Promise<FixedArtifact> {
  const m = await measureText(readFileSync(path, 'utf8'), counter);
  return { name, ...m, note };
}

/** Measure a tool subset from a live `tools/list` as one artifact (wire bytes). */
export async function measureToolList(
  name: string,
  tools: ListedTool[],
  counter: TokenCounter,
  note?: string,
): Promise<FixedArtifact> {
  // The wire cost of the tools array is the serialized array of wire objects.
  const payload = JSON.stringify(tools.map(toolWireObject));
  const m = await measureText(payload, counter);
  return { name, ...m, note };
}

/** Select the argent alwaysLoad subset from a full listing. */
export function alwaysLoadSubset(tools: ListedTool[]): ListedTool[] {
  return tools.filter(isAlwaysLoad);
}

/** Select device-stream DSL tools (dsl_*) from a full listing. */
export function dslSubset(tools: ListedTool[]): ListedTool[] {
  return tools.filter((t) => t.name.startsWith('dsl_') && t.name !== 'dsl_run_script');
}

export function dslScriptTool(tools: ListedTool[]): ListedTool[] {
  return tools.filter((t) => t.name === 'dsl_run_script');
}

/** Select the fork's `run-script` tool def from a full listing. */
export function argentRunScriptTool(tools: ListedTool[]): ListedTool[] {
  return tools.filter((t) => t.name === 'run-script');
}

/**
 * Extract the `run-script` authoring `.d.ts` block from the argent-device-interact
 * SKILL.md — the ```ts fenced block that declares `interface Ui`. This is the
 * script-authoring surface an agent needs to write a run-script body, the exact
 * argent analog of the `@device-stream/dsl` `.d.ts` that config C1 counts. Returns
 * '' if the block is absent.
 */
export function extractRunScriptDts(skillMd: string): string {
  const fence = /```ts\r?\n([\s\S]*?)```/g;
  for (let m = fence.exec(skillMd); m; m = fence.exec(skillMd)) {
    if (m[1].includes('interface Ui')) return m[1].trimEnd();
  }
  return '';
}

/** Measure the run-script authoring `.d.ts` block from a skill file. */
export async function measureRunScriptDts(
  skillPath: string,
  counter: TokenCounter,
): Promise<FixedArtifact> {
  const dts = extractRunScriptDts(readFileSync(skillPath, 'utf8'));
  const m = await measureText(dts, counter);
  return {
    name: 'run-script ui .d.ts (argent-device-interact skill)',
    ...m,
    note: 'script authoring surface (progressively loaded from the skill body; counted like C1 counts the dsl .d.ts)',
  };
}

/** Measure the MCP `instructions` string as an artifact. */
export async function measureInstructions(
  name: string,
  instructions: string | undefined,
  counter: TokenCounter,
): Promise<FixedArtifact> {
  const m = await measureText(instructions ?? '', counter);
  return { name, ...m, note: instructions ? 'MCP server instructions (initialize result)' : 'none' };
}
