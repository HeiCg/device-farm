/**
 * Explorations agent prompt loader (Phase 35 Plan 35-02).
 *
 * Reads `prompts/exploration.md` from the project root once, caches the
 * content for the lifetime of the process, returns it on every call.
 *
 * The file lives at the repo top-level (not embedded in TS) so prompt edits
 * do not require a TypeScript recompile. The agent-runner loads it at
 * startup and passes it as `options.systemPrompt` to the Claude Agent SDK
 * `query()` call.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let cached: string | null = null;

/**
 * Resolve + read `prompts/exploration.md` from the current working directory.
 * Returns the cached string on subsequent calls (identical reference, so
 * `===` comparisons in tests can prove the cache).
 */
export async function loadExplorationPrompt(): Promise<string> {
  if (cached !== null) return cached;
  const path = resolve(process.cwd(), 'prompts/exploration.md');
  cached = await readFile(path, 'utf-8');
  return cached;
}

/**
 * Test-only — reset the in-process cache between tests. Production code
 * should never call this.
 */
export function _resetPromptCache(): void {
  cached = null;
}
