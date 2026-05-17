/**
 * Phase 35 Plan 35-02 — in-process MCP agent tools spec.
 *
 * Each `tool(name, desc, schema, handler)` from @anthropic-ai/claude-agent-sdk
 * returns `{name, description, inputSchema, handler}`. We invoke handler()
 * directly with a stubbed `db` (in-memory model) + emit + StuckDetector and
 * assert on:
 *   - explore_save_screen: budget gate, similarity gate, stuck detection wiring,
 *     emit.screenDiscovered fires for new screens, emit.stuck fires when window trips.
 *   - explore_save_transition: action_hash dedup, emit.transition fires when created.
 *   - explore_mark_element_explored: handler shape only (jsonb update is DB-gated).
 *   - explore_get_unexplored: returns array shape (DB-gated proper test in store.spec).
 *   - explore_finish: returns finishRequested:true + reason.
 *   - Input schema validation: handler errors on bad input via Zod.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildExplorationTools, type AgentToolDeps } from '../internal/agent-tools.js';
import { StuckDetector } from '../internal/stuck-detector.js';

const FIXTURE_DIR = resolve(
  process.cwd(),
  'server/explorations/__tests__/__fixtures__',
);

interface ScreenRow {
  id: string;
  runId: string;
  screenId: string;
  title: string;
  phash: string | null;
  screenshotArtifactId: string;
  elements: unknown[];
  notes: string | null;
  bfsDepth: number;
}

interface TransitionRow {
  id: string;
  runId: string;
  fromScreenId: string;
  toScreenId: string;
  action: Record<string, unknown>;
  actionHash: string;
  isBackEdge: boolean;
  bfsOrder: number;
}

/**
 * Build a stub Drizzle-shaped db that the store helpers can use against an
 * in-memory backing store. We use vi.fn pass-through implementations for the
 * methods explore_* tools actually invoke.
 */
function buildStubDb() {
  const screens: ScreenRow[] = [];
  const transitions: TransitionRow[] = [];
  let nextId = 1;

  const db = {
    _screens: screens,
    _transitions: transitions,
    // .select() chain — we model only the shapes store.ts uses:
    //   1) probe screens by (runId, screenId) → returning [{id}]
    //   2) getScreenCount → SELECT COUNT(*)::int FROM screens WHERE runId
    //   3) getScreensForSimilarity → SELECT (screenId, phash, screenshotArtifactId) FROM screens WHERE runId
    select: vi.fn((cols?: Record<string, unknown>) => {
      const isCount = cols && 'count' in cols;
      const isSimilarity = cols && 'phash' in cols;
      const where = (_pred: unknown) => {
        if (isCount) return Promise.resolve([{ count: 0 }]);
        if (isSimilarity) return Promise.resolve([]); // no similarity candidates by default
        return {
          limit: (_n: number) => Promise.resolve([]),
        };
      };
      return { from: (_tbl: unknown) => ({ where }) };
    }) as never,
    insert: vi.fn((_tbl: unknown) => ({
      values: (vals: Record<string, unknown>) => ({
        onConflictDoUpdate: () => {
          screens.push({
            id: `screen-${nextId++}`,
            runId: vals.runId as string,
            screenId: vals.screenId as string,
            title: vals.title as string,
            phash: (vals.phash ?? null) as string | null,
            screenshotArtifactId: vals.screenshotArtifactId as string,
            elements: (vals.elements as unknown[]) ?? [],
            notes: (vals.notes ?? null) as string | null,
            bfsDepth: (vals.bfsDepth as number) ?? 0,
          });
          return Promise.resolve();
        },
        onConflictDoNothing: () => ({
          returning: (_cols: unknown) => {
            const hash = vals.actionHash as string;
            const exists = transitions.some(
              (t) =>
                t.runId === vals.runId &&
                t.fromScreenId === vals.fromScreenId &&
                t.toScreenId === vals.toScreenId &&
                t.actionHash === hash,
            );
            if (exists) return Promise.resolve([]);
            transitions.push({
              id: `transition-${nextId++}`,
              runId: vals.runId as string,
              fromScreenId: vals.fromScreenId as string,
              toScreenId: vals.toScreenId as string,
              action: vals.action as Record<string, unknown>,
              actionHash: hash,
              isBackEdge: vals.isBackEdge as boolean,
              bfsOrder: vals.bfsOrder as number,
            });
            return Promise.resolve([{ id: `transition-${nextId - 1}` }]);
          },
        }),
      }),
    })) as never,
    update: vi.fn(() => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    })) as never,
    execute: vi.fn(async () => ({ rows: [] })) as never,
  };
  return db as unknown as AgentToolDeps['db'] & {
    _screens: ScreenRow[];
    _transitions: TransitionRow[];
  };
}

function buildEmitStub() {
  return {
    started: vi.fn(),
    screenDiscovered: vi.fn(),
    transition: vi.fn(),
    stuck: vi.fn(),
    toolCall: vi.fn(),
    finished: vi.fn(),
    failed: vi.fn(),
  } as unknown as AgentToolDeps['emit'] & Record<string, ReturnType<typeof vi.fn>>;
}

let homeBuf: Buffer = Buffer.alloc(0);

beforeEach(async () => {
  homeBuf = await readFile(resolve(FIXTURE_DIR, 'screenshot-home.png'));
});

describe('explorations/agent-tools', () => {
  describe('shape', () => {
    it('returns 5 tools with name + description + inputSchema + handler', () => {
      const tools = buildExplorationTools('run-1', {
        db: buildStubDb() as never,
        emit: buildEmitStub() as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        'explore_finish',
        'explore_get_unexplored',
        'explore_mark_element_explored',
        'explore_save_screen',
        'explore_save_transition',
      ]);
      for (const t of tools) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(t.description.length).toBeGreaterThan(20);
        expect(typeof t.handler).toBe('function');
        expect(t.inputSchema).toBeDefined();
      }
    });
  });

  describe('explore_save_screen', () => {
    it('saves a NEW screen + emits screenDiscovered', async () => {
      const db = buildStubDb();
      const emit = buildEmitStub();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_save_screen')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Home Screen',
          elements: [{ label: 'Shop tab', element_type: 'tab' }],
          notes: undefined,
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );
      const sc = (res as { structuredContent: { isDuplicate: boolean; screen_id: string } }).structuredContent;
      expect(sc.isDuplicate).toBe(false);
      expect(sc.screen_id).toBe('home-screen');
      expect(db._screens.length).toBe(1);
      expect(db._screens[0]!.title).toBe('Home Screen');
      expect(emit.screenDiscovered).toHaveBeenCalledTimes(1);
      expect(emit.stuck).not.toHaveBeenCalled();
    });

    it('reports budget_exceeded when screen count >= budgetScreens', async () => {
      const db = buildStubDb();
      // Seed the in-memory screens array so getScreenCount returns the cap.
      // But the stub.select() returns []; we need a real screen count path.
      // Patch the .select() to return a non-empty result for COUNT(*) probes.
      const realDb = db as unknown as {
        select: ReturnType<typeof vi.fn>;
      };
      let probeCallCount = 0;
      realDb.select = vi.fn((_cols?: Record<string, unknown>) => ({
        from: (_tbl: unknown) => ({
          where: (_pred: unknown) => {
            probeCallCount++;
            return {
              limit: (_n: number) => Promise.resolve([]),
            };
          },
        }),
      })) as never;
      // Override getScreenCount path: store.getScreenCount calls
      //   db.select({count:sql...}).from(t).where(eq)
      // which returns NO limit chain — it awaits the .where() result directly.
      // Re-patch:
      realDb.select = vi.fn((cols?: Record<string, unknown>) => ({
        from: (_tbl: unknown) => ({
          where: (_pred: unknown) => {
            // Detect "count" column probe.
            if (cols && 'count' in cols) {
              return Promise.resolve([{ count: 999 }]);
            }
            return {
              limit: (_n: number) => Promise.resolve([]),
            };
          },
        }),
      })) as never;
      const emit = buildEmitStub();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_save_screen')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Home',
          elements: [],
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );
      const sc = (res as { structuredContent: { error?: string; screenCount?: number } }).structuredContent;
      expect(sc.error).toBe('budget_exceeded');
      expect(sc.screenCount).toBe(999);
      expect(emit.screenDiscovered).not.toHaveBeenCalled();
    });

    it('stuck-detector wired: 3 identical pHashes → 3rd call returns stuck:true + emit.stuck fires', async () => {
      const db = buildStubDb();
      // Make findSimilarScreen return a match every time by overriding select
      // to return one candidate with the SAME phash we compute below.
      // We make loadArtifact return the SAME buffer (homeBuf) so:
      //   - new pHash = pHash(homeBuf) = ph
      //   - candidate.phash = ph  (we seed it via the select() return)
      // RMSE between homeBuf and homeBuf = 0 → match.
      let firstCall = true;
      const realDb = db as unknown as { select: ReturnType<typeof vi.fn> };
      realDb.select = vi.fn((cols?: Record<string, unknown>) => ({
        from: (_tbl: unknown) => ({
          where: (_pred: unknown) => {
            if (cols && 'count' in cols) {
              return Promise.resolve([{ count: 1 }]);
            }
            if (cols && 'phash' in cols) {
              // getScreensForSimilarity probe. Return the seeded candidate
              // ONLY after the first save (so the first explore_save_screen
              // gets isDuplicate=false; subsequent calls match).
              return Promise.resolve([
                {
                  screenId: 'home-screen',
                  phash: 'will-be-set-below',
                  screenshotArtifactId: '11111111-1111-1111-1111-111111111111',
                },
              ]);
            }
            return {
              limit: (_n: number) => Promise.resolve([]),
            };
          },
        }),
      })) as never;
      // Precompute the phash we expect for homeBuf and stuff it into the response.
      const sharpPhashMod = (await import('sharp-phash')).default as unknown as (buf: Buffer) => Promise<string>;
      const expectedPhash = await sharpPhashMod(homeBuf);
      realDb.select = vi.fn((cols?: Record<string, unknown>) => ({
        from: (_tbl: unknown) => ({
          where: (_pred: unknown) => {
            if (cols && 'count' in cols) {
              return Promise.resolve([{ count: 1 }]);
            }
            if (cols && 'phash' in cols) {
              return Promise.resolve([
                {
                  screenId: 'home-screen',
                  phash: expectedPhash,
                  screenshotArtifactId: '11111111-1111-1111-1111-111111111111',
                },
              ]);
            }
            return {
              limit: (_n: number) => Promise.resolve([]),
            };
          },
        }),
      })) as never;

      const emit = buildEmitStub();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(3),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_save_screen')!;

      const r1 = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Anything',
          elements: [],
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );
      const r2 = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Anything',
          elements: [],
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );
      const r3 = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          title: 'Anything',
          elements: [],
          screenshot_artifact_id: '11111111-1111-1111-1111-111111111111',
        },
        {},
      );

      // All 3 are duplicates (matched the seeded home pHash).
      expect((r1 as { structuredContent: { isDuplicate: boolean } }).structuredContent.isDuplicate).toBe(true);
      expect((r2 as { structuredContent: { isDuplicate: boolean } }).structuredContent.isDuplicate).toBe(true);
      expect((r3 as { structuredContent: { isDuplicate: boolean; stuck?: boolean } }).structuredContent.isDuplicate).toBe(true);
      // Stuck fires on 3rd consecutive.
      expect((r3 as { structuredContent: { stuck?: boolean; stuckCount: number } }).structuredContent.stuck).toBe(true);
      expect((r3 as { structuredContent: { stuckCount: number } }).structuredContent.stuckCount).toBe(3);
      expect(emit.stuck).toHaveBeenCalledTimes(1);
      expect(emit.stuck).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ runId: 'run-1', screenId: 'home-screen', consecutive: 3 }),
      );
    });
  });

  describe('explore_save_transition', () => {
    it('records a new transition + emits transition + increments bfsOrder', async () => {
      const db = buildStubDb();
      const emit = buildEmitStub();
      const bfsOrderCounter = { value: 5 };
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter,
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_save_transition')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        {
          from_screen_id: 'home',
          to_screen_id: 'shop',
          action: { tool: 'device_tap_by_description', target: 'Shop tab' },
          is_back_edge: false,
        },
        {},
      );
      const sc = (res as { structuredContent: { created: boolean; ok: boolean } }).structuredContent;
      expect(sc.created).toBe(true);
      expect(sc.ok).toBe(true);
      expect(db._transitions.length).toBe(1);
      expect(db._transitions[0]!.bfsOrder).toBe(5);
      expect(bfsOrderCounter.value).toBe(6);
      expect(emit.transition).toHaveBeenCalledTimes(1);
    });

    it('action-hash dedup: same action twice → second is created:false, no second emit', async () => {
      const db = buildStubDb();
      const emit = buildEmitStub();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: emit as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_save_transition')!;
      const args = {
        from_screen_id: 'home',
        to_screen_id: 'shop',
        action: { tool: 'device_tap_by_description', target: 'Shop tab' },
        is_back_edge: false,
      };
      await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(args, {});
      const res2 = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(args, {});
      const sc = (res2 as { structuredContent: { created: boolean } }).structuredContent;
      expect(sc.created).toBe(false);
      expect(db._transitions.length).toBe(1);
      expect(emit.transition).toHaveBeenCalledTimes(1);
    });
  });

  describe('explore_finish', () => {
    it('returns finishRequested:true with reason + message', async () => {
      const tools = buildExplorationTools('run-1', {
        db: buildStubDb() as never,
        emit: buildEmitStub() as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_finish')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        { reason: 'complete', message: 'BFS exhausted' },
        {},
      );
      const sc = (res as {
        structuredContent: { finishRequested: boolean; reason: string; message: string };
      }).structuredContent;
      expect(sc.finishRequested).toBe(true);
      expect(sc.reason).toBe('complete');
      expect(sc.message).toBe('BFS exhausted');
    });
  });

  describe('explore_mark_element_explored', () => {
    it('returns ok:true and runs the UPDATE query', async () => {
      const db = buildStubDb();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: buildEmitStub() as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_mark_element_explored')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)(
        { screen_id: 'home', element_label: 'Shop tab', leads_to: 'shop' },
        {},
      );
      expect((res as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
      expect(db.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('explore_get_unexplored', () => {
    it('returns screens array (empty in stub)', async () => {
      const db = buildStubDb();
      const tools = buildExplorationTools('run-1', {
        db: db as never,
        emit: buildEmitStub() as never,
        stuckDetector: new StuckDetector(),
        bfsOrderCounter: { value: 0 },
        budgetScreens: 60,
        loadArtifact: async () => homeBuf,
      });
      const t = tools.find((t) => t.name === 'explore_get_unexplored')!;
      const res = await (t.handler as (a: unknown, e: unknown) => Promise<unknown>)({}, {});
      const sc = (res as { structuredContent: { screens: unknown[] } }).structuredContent;
      expect(Array.isArray(sc.screens)).toBe(true);
    });
  });
});
