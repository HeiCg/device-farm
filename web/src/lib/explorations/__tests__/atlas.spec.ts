/**
 * Phase 35 Plan 35-05 — atlas component + ws-client spec.
 *
 * Replaces the Plan 35-00 stub. Covers:
 *   (a) file existence for each component shipped in Plan 35-05
 *   (b) ws-client dispatchFrame translates camelCase server frames to
 *       snake_case domain shapes
 *   (c) ws-client dispatchFrame ignores unknown discriminators silently
 *   (d) ws-client dispatchFrame handles missing optional handlers
 *       gracefully (`onToolCall`, `onStuck`, `onFinished`, `onError`)
 *
 * Does NOT mount the Svelte components — the web/ workspace ships no
 * Svelte test-renderer infrastructure (vite-plugin-svelte + jsdom is
 * needed). Component-level rendering happens at the
 * `human-verify`-equivalent stage (manual `npm run web:dev` smoke).
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatchFrame, type OpenWsOpts } from '../ws-client.js';
import type { Screen, Transition } from '../atlas-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(HERE, '..');

function noopHandlers(
  overrides: Partial<OpenWsOpts> = {},
): OpenWsOpts {
  return {
    runId: 'run-1',
    baseUrl: 'http://localhost:3000',
    onScreenDiscovered: vi.fn<(s: Screen) => void>(),
    onTransition: vi.fn<(t: Transition) => void>(),
    ...overrides,
  };
}

describe('Plan 35-05 atlas components (file existence)', () => {
  for (const f of [
    'atlas-graph.svelte',
    'screen-node.svelte',
    'start-end-node.svelte',
    'screen-panel.svelte',
    'journey-panel.svelte',
    'ws-client.ts',
    'atlas-types.ts',
    'layout-graph.ts',
    'enumerate-paths.ts',
    'flow-tag.ts',
  ]) {
    it(`ships ${f}`, () => {
      expect(existsSync(resolve(LIB, f))).toBe(true);
    });
  }
});

describe('dispatchFrame (ws-client)', () => {
  it('translates `screen-discovered` to snake_case Screen and invokes onScreenDiscovered', () => {
    const onScreenDiscovered = vi.fn();
    const handlers = noopHandlers({ onScreenDiscovered });
    dispatchFrame(
      {
        v: 1,
        type: 'screen-discovered',
        ts: '2026-05-16T20:00:00.000Z',
        correlationId: null,
        data: {
          runId: 'run-1',
          screenId: 'screen-home',
          title: 'Home',
          screenshotArtifactId: '11111111-2222-3333-4444-555555555555',
          bfsDepth: 0,
        },
      },
      handlers,
    );
    expect(onScreenDiscovered).toHaveBeenCalledTimes(1);
    const arg = onScreenDiscovered.mock.calls[0][0] as Screen;
    expect(arg.screen_id).toBe('screen-home');
    expect(arg.title).toBe('Home');
    expect(arg.screenshot_artifact_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(arg.bfs_depth).toBe(0);
    expect(arg.elements).toEqual([]);
  });

  it('translates `transition` to snake_case Transition', () => {
    const onTransition = vi.fn();
    const handlers = noopHandlers({ onTransition });
    dispatchFrame(
      {
        type: 'transition',
        data: {
          runId: 'r',
          fromScreenId: 's1',
          toScreenId: 's2',
          action: { kind: 'tap', target: 'btn' },
          isBackEdge: true,
        },
      },
      handlers,
    );
    expect(onTransition).toHaveBeenCalledTimes(1);
    const t = onTransition.mock.calls[0][0] as Transition;
    expect(t.from_screen_id).toBe('s1');
    expect(t.to_screen_id).toBe('s2');
    expect(t.action).toEqual({ kind: 'tap', target: 'btn' });
    expect(t.is_back_edge).toBe(true);
  });

  it('invokes onToolCall when handler present', () => {
    const onToolCall = vi.fn();
    dispatchFrame(
      {
        type: 'tool-call',
        data: { runId: 'r', name: 'tap', args: { x: 100 }, durationMs: 45 },
      },
      noopHandlers({ onToolCall }),
    );
    expect(onToolCall).toHaveBeenCalledWith({
      name: 'tap',
      args: { x: 100 },
      durationMs: 45,
    });
  });

  it('invokes onStuck with snake_case screen_id', () => {
    const onStuck = vi.fn();
    dispatchFrame(
      { type: 'stuck', data: { runId: 'r', screenId: 's1', consecutive: 3 } },
      noopHandlers({ onStuck }),
    );
    expect(onStuck).toHaveBeenCalledWith({ screen_id: 's1', consecutive: 3 });
  });

  it('invokes onFinished with stats payload', () => {
    const onFinished = vi.fn();
    dispatchFrame(
      {
        type: 'finished',
        data: {
          runId: 'r',
          reason: 'budget',
          stats: {
            screensDiscovered: 12,
            transitionsTotal: 18,
            tapsTaken: 30,
            durationMs: 60_000,
          },
        },
      },
      noopHandlers({ onFinished }),
    );
    expect(onFinished).toHaveBeenCalledWith({
      reason: 'budget',
      stats: {
        screensDiscovered: 12,
        transitionsTotal: 18,
        tapsTaken: 30,
        durationMs: 60_000,
      },
    });
  });

  it('invokes onError with message string', () => {
    const onError = vi.fn();
    dispatchFrame(
      { type: 'error', data: { runId: 'r', message: '[lease] no devices' } },
      noopHandlers({ onError }),
    );
    expect(onError).toHaveBeenCalledWith('[lease] no devices');
  });

  it('ignores unknown frame types silently', () => {
    const handlers = noopHandlers();
    expect(() =>
      dispatchFrame({ type: 'never-heard-of-this', data: {} }, handlers),
    ).not.toThrow();
    expect(handlers.onScreenDiscovered).not.toHaveBeenCalled();
    expect(handlers.onTransition).not.toHaveBeenCalled();
  });

  it('ignores frames without a string `type` field', () => {
    const handlers = noopHandlers();
    expect(() => dispatchFrame({ data: {} }, handlers)).not.toThrow();
    expect(() => dispatchFrame(null, handlers)).not.toThrow();
    expect(() => dispatchFrame(undefined, handlers)).not.toThrow();
    expect(handlers.onScreenDiscovered).not.toHaveBeenCalled();
  });

  it('does NOT throw when optional handlers are missing (tool-call / stuck / finished / error)', () => {
    const handlers = noopHandlers();
    expect(() =>
      dispatchFrame({ type: 'tool-call', data: { name: 'x', args: {}, durationMs: 0 } }, handlers),
    ).not.toThrow();
    expect(() =>
      dispatchFrame({ type: 'stuck', data: { screenId: 's', consecutive: 1 } }, handlers),
    ).not.toThrow();
    expect(() =>
      dispatchFrame({ type: 'error', data: { message: 'x' } }, handlers),
    ).not.toThrow();
  });
});
