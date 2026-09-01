/**
 * `dsl_run_script` — agent-authored typed automation scripts.
 *
 * The agent writes a TypeScript body that drives the connected device through
 * the `@device-stream/dsl` session (`ds`) in a single round-trip, instead of
 * issuing many atomic `dsl_*` calls. Execution is delegated to the shared
 * `runScript` runtime (the same one lifecycle hooks use), so the prelude
 * contract is identical: `ds`, `vars`, and standard globals are in scope and
 * top-level await works.
 *
 * This layer adds the caps the hook runner deliberately lacks:
 *   - stdout+stderr combined capped at 4000 chars (tail-truncated).
 *   - on throw: error message (already diagnostics-capped) + top-3 stack frames,
 *     with the temp `.mts` path rewritten to `<script>` so the agent never sees
 *     internal `.df-hook-tmp/` paths.
 */
import { z } from 'zod/v3';
import { runScript, type SessionOptions } from '@device-stream/dsl';
import type { DslToolResult } from './registry.js';

export const SCRIPT_TOOL_NAME = 'dsl_run_script';

/** Fixed context — keep lean. ≤600 chars. */
export const scriptToolDescription =
  'Execute a TypeScript snippet against the connected device in ONE round-trip. ' +
  'RUNS ARBITRARY LOCAL CODE via repo-local tsx (same trust level as the other dsl_* tools). ' +
  'In scope: `ds` (the @device-stream/dsl session — see its .d.ts for the full API: ' +
  'ds.get(sel).fill(t), ds.tapOn(sel), ds.scrollUntilVisible(sel), ds.describe(), ' +
  'ds.awaitUntil(sel).changeTo(sel), ds.launchApp(id), ds.pressKey(k)) and `vars` ({}). ' +
  'Use top-level await; console.log to return data. On success returns `ok` + captured ' +
  'stdout (output is capped). Prefer this over chaining many atomic calls for multi-step tasks.';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export const scriptInputShape = {
  script: z.string().describe('TypeScript body run with `ds` and `vars` in scope. Top-level await allowed.'),
  timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional()
    .describe(`Kill the script after this many ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`),
};

const OUTPUT_CAP = 4000;

/** Keep the tail (most recent output) with a leading truncation marker. */
export function capTail(s: string, cap = OUTPUT_CAP): string {
  if (s.length <= cap) return s;
  return `…(truncated, ${s.length} chars total)\n` + s.slice(s.length - cap);
}

/**
 * Render a child-process failure: full (already-capped) error message + the
 * top 3 stack frames, with any `.df-hook-tmp/*.mts` path rewritten to `<script>`.
 */
export function renderScriptError(stderrText: string): string {
  const cleaned = stderrText
    // keep the trailing :line:col by stopping the match at `.mts`
    .replace(/[^\s'"()]*\.df-hook-tmp[^\s'"()]*?\.mts/g, '<script>')
    // sweep up any remaining temp-dir references (no `.mts` suffix)
    .replace(/[^\s'"()]*\.df-hook-tmp[^\s'"()]*/g, '<script>');

  const lines = cleaned.split('\n');
  const firstFrame = lines.findIndex((l) => /^\s*at\s/.test(l));
  const errIdx = lines.findIndex((l) => /Error\b/.test(l) && !/^\s*at\s/.test(l));
  const msgStart = errIdx >= 0 ? errIdx : 0;
  const messageBlock = lines
    .slice(msgStart, firstFrame >= 0 ? firstFrame : undefined)
    .join('\n')
    .trim();
  const frames = lines
    .slice(firstFrame >= 0 ? firstFrame : lines.length)
    .filter((l) => /^\s*at\s/.test(l))
    .slice(0, 3)
    .map((l) => l.trim());

  const rendered = [messageBlock, ...frames].filter(Boolean).join('\n') || 'script failed';
  return capTail(rendered);
}

interface ExecFailure {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  message?: string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  code?: number | string;
}

/**
 * Run an agent-authored script against `sessionConfig` and render a capped
 * result. Never rejects — failures become `isError` text results.
 */
export async function executeScript(
  args: Record<string, unknown>,
  sessionConfig: SessionOptions,
  cwd?: string,
): Promise<DslToolResult> {
  const script = args.script;
  if (typeof script !== 'string' || script.trim() === '') {
    return { content: [{ type: 'text', text: `${SCRIPT_TOOL_NAME} failed: 'script' must be a non-empty string` }], isError: true };
  }
  const requested = typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(1, Math.floor(requested)), MAX_TIMEOUT_MS);

  try {
    const { stdout, stderr } = await runScript({
      script,
      session: sessionConfig,
      vars: {},
      timeoutMs,
      cwd,
    });
    const combined = [stdout, stderr].filter((s) => s && s.length > 0).join('\n');
    const body = combined ? `ok\n${capTail(combined)}` : 'ok';
    return { content: [{ type: 'text', text: body }] };
  } catch (err) {
    const e = err as ExecFailure;
    if (e && e.killed) {
      const partial = [
        e.stdout != null ? e.stdout.toString() : '',
        e.stderr != null ? e.stderr.toString() : '',
      ].filter((s) => s.length > 0).join('\n');
      const base = `${SCRIPT_TOOL_NAME} failed: script timed out after ${timeoutMs}ms and was killed`;
      const text = partial ? `${base}\n${capTail(partial)}` : base;
      return {
        content: [{ type: 'text', text }],
        isError: true,
      };
    }
    const stderrText = e && e.stderr != null ? e.stderr.toString() : (e && e.message) || String(err);
    return { content: [{ type: 'text', text: renderScriptError(stderrText) }], isError: true };
  }
}
