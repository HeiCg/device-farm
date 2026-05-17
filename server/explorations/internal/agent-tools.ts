/**
 * Explorations agent in-process MCP tools (Phase 35 Plan 35-02 / T-35.2).
 *
 * 5 tools wrapped via `tool(name, description, zodSchema, handler)` from
 * @anthropic-ai/claude-agent-sdk, returned as an array suitable for
 * `createSdkMcpServer({tools: ...})`:
 *
 *   - explore_save_screen           — pHash + similarity + stuck wiring + bus emit + DB upsert.
 *   - explore_save_transition       — DB insert (action-hash dedup) + bus emit.
 *   - explore_mark_element_explored — UPDATE elements jsonb (no bus emit).
 *   - explore_get_unexplored        — jsonb query for screens with unexplored elements.
 *   - explore_finish                — declarative finish intent; agent-runner finalizes.
 *
 * `buildExplorationTools(runId, deps)` returns the array. `deps` carries the
 * shared per-run state (StuckDetector, tapCounter, bfsOrderCounter, loadArtifact,
 * budgetScreens) so each handler can both consult and mutate it.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type pino from 'pino';

import type { Database } from '../../db/index.js';
import type { ExplorationsEmitters } from '../events.js';
import { computePhash } from './similarity.js';
import { StuckDetector } from './stuck-detector.js';
import * as store from './store.js';

/**
 * Per-run dependencies wired by the agent-runner. Mutable counters (taps,
 * bfsOrder) are tracked here so the handlers can update them; budgetScreens
 * is read-only.
 */
export interface AgentToolDeps {
  /** Database handle (Drizzle) — passed straight through to store helpers. */
  db: Database;
  /** Emitters from the explorations module — handlers fire screenDiscovered / transition / stuck. */
  emit: ExplorationsEmitters;
  /** Sliding-window pHash detector — shared with the runner so external observers see the same window. */
  stuckDetector: StuckDetector;
  /** Mutable BFS order counter, incremented per saved transition. */
  bfsOrderCounter: { value: number };
  /** Screen-cap enforcement (server-side) — handler returns budget_exceeded when reached. */
  budgetScreens: number;
  /** Artifact loader — reads a screenshot artifact (binary buffer) by id. */
  loadArtifact: (artifactId: string) => Promise<Buffer>;
  /** Optional logger (child of the module logger). */
  logger?: pino.Logger;
}

const elementSchema = z.object({
  label: z.string().min(1).max(200),
  element_type: z.enum([
    'button',
    'input',
    'link',
    'tab',
    'list_item',
    'icon',
    'text',
  ]),
  notes: z.string().optional(),
});

/**
 * Slugify a screen title into a stable kebab-case screen_id.
 * Falls back to a short hash-like fragment when the title slugs to empty.
 */
function slugify(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || `screen-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build all 5 in-process MCP tools for a single exploration run.
 * The returned array is ready to be passed to `createSdkMcpServer({tools})`.
 */
export function buildExplorationTools(runId: string, deps: AgentToolDeps) {
  return [
    tool(
      'explore_save_screen',
      // Description shown to the agent — keep concise.
      'Save a newly-discovered screen with its title, screenshot (referenced by artifact id from a prior device_screenshot call), and interactive elements. Server runs perceptual-hash similarity against existing screens — if matched, returns isDuplicate=true so the agent can record a back-edge instead of re-exploring. Returns {error:"budget_exceeded"} if the per-run budgetScreens cap is hit.',
      {
        title: z.string().min(1).max(200),
        elements: z.array(elementSchema),
        notes: z.string().optional(),
        screenshot_artifact_id: z.string().uuid(),
      },
      async ({ title, elements, notes, screenshot_artifact_id }) => {
        // 1. Budget gate (server-side, not trusted to the agent).
        const screenCount = await store.getScreenCount({ db: deps.db }, runId);
        if (screenCount >= deps.budgetScreens) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Budget exceeded: ${screenCount}/${deps.budgetScreens} screens. Call explore_finish({reason:'budget'}) immediately.`,
              },
            ],
            structuredContent: {
              error: 'budget_exceeded',
              screenCount,
              budgetScreens: deps.budgetScreens,
            },
          };
        }

        // 2. Compute pHash + check for duplicates.
        let phash: string;
        try {
          const buf = await deps.loadArtifact(screenshot_artifact_id);
          phash = (await computePhash(buf)).phash;
        } catch (err) {
          deps.logger?.warn(
            { err, runId, screenshot_artifact_id },
            'explore_save_screen: failed to load artifact for pHash; continuing without similarity check',
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to load screenshot artifact ${screenshot_artifact_id}. Try device_screenshot again.`,
              },
            ],
            structuredContent: { error: 'artifact_load_failed' },
          };
        }

        const existing = await store.findSimilarScreen(
          { db: deps.db, loadArtifact: deps.loadArtifact },
          runId,
          await deps.loadArtifact(screenshot_artifact_id),
        );

        // 3. Stuck detection — sliding-window pHash observe (always called).
        const stuck = deps.stuckDetector.observe(phash);

        // 4. Duplicate path — emit stuck if window tripped.
        if (existing) {
          if (stuck.stuck) {
            deps.emit.stuck(runId, {
              runId,
              screenId: existing.screenId,
              consecutive: stuck.consecutive,
            });
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Duplicate of "${existing.screenId}" (rmse=${existing.rmse.toFixed(4)})${
                  stuck.stuck ? `; STUCK consecutive=${stuck.consecutive}` : ''
                }`,
              },
            ],
            structuredContent: {
              screen_id: existing.screenId,
              isDuplicate: true,
              matched: existing.screenId,
              rmse: existing.rmse,
              stuckCount: stuck.consecutive,
              stuck: stuck.stuck,
            },
          };
        }

        // 5. New screen — INSERT (or upsert by (runId, screenId) UNIQUE).
        const screenId = slugify(title);
        await store.saveScreen(
          { db: deps.db },
          {
            runId,
            screenId,
            title,
            elements: elements.map((e) => ({
              label: e.label,
              element_type: e.element_type,
              notes: e.notes ?? null,
              explored: false,
            })),
            notes: notes ?? null,
            screenshotArtifactId: screenshot_artifact_id,
            phash,
            bfsDepth: 0,
          },
        );

        // 6. Emit non-persisted screenDiscovered (WS broadcaster fans out).
        deps.emit.screenDiscovered(runId, {
          runId,
          screenId,
          title,
          bfsDepth: 0,
          screenshotArtifactId: screenshot_artifact_id,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Saved screen "${title}" as ${screenId} (${elements.length} elements)`,
            },
          ],
          structuredContent: {
            screen_id: screenId,
            isDuplicate: false,
            stuckCount: stuck.consecutive,
          },
        };
      },
    ),

    tool(
      'explore_save_transition',
      'Record a navigation edge between two known screen_ids. The action is a JSON object describing what was tapped/typed/swiped. action_hash dedup means re-recording the same transition is a no-op. Pass is_back_edge=true for explicit back-navigation edges.',
      {
        from_screen_id: z.string().min(1),
        to_screen_id: z.string().min(1),
        action: z.record(z.string(), z.unknown()),
        is_back_edge: z.boolean().default(false),
      },
      async ({ from_screen_id, to_screen_id, action, is_back_edge }) => {
        const order = deps.bfsOrderCounter.value++;
        const { created } = await store.saveTransition(
          { db: deps.db },
          {
            runId,
            fromScreenId: from_screen_id,
            toScreenId: to_screen_id,
            action,
            isBackEdge: is_back_edge,
            bfsOrder: order,
          },
        );
        if (created) {
          deps.emit.transition(runId, {
            runId,
            fromScreenId: from_screen_id,
            toScreenId: to_screen_id,
            action,
            isBackEdge: is_back_edge,
          });
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: created
                ? `Transition recorded: ${from_screen_id} → ${to_screen_id}`
                : `Transition already exists (skipped): ${from_screen_id} → ${to_screen_id}`,
            },
          ],
          structuredContent: { ok: true, created },
        };
      },
    ),

    tool(
      'explore_mark_element_explored',
      'Mark an element on a screen as explored. Optionally set leads_to to the screen_id it navigated to (or null for elements that produced no navigation).',
      {
        screen_id: z.string().min(1),
        element_label: z.string().min(1),
        leads_to: z.string().nullable().optional(),
      },
      async ({ screen_id, element_label, leads_to }) => {
        await store.markElementExplored(
          { db: deps.db },
          runId,
          screen_id,
          element_label,
          leads_to ?? null,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Marked element "${element_label}" on screen "${screen_id}" as explored${
                leads_to ? ` (leads_to=${leads_to})` : ''
              }`,
            },
          ],
          structuredContent: { ok: true },
        };
      },
    ),

    tool(
      'explore_get_unexplored',
      'Return all screens that still have at least one unexplored element. Use this between exploration rounds to find the next screen to navigate to.',
      {},
      async () => {
        const screens = await store.getUnexplored({ db: deps.db }, runId);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                screens.length === 0
                  ? 'No screens with unexplored elements remain — call explore_finish({reason:"complete"}).'
                  : JSON.stringify(screens, null, 2),
            },
          ],
          structuredContent: { screens },
        };
      },
    ),

    tool(
      'explore_finish',
      'Mark the exploration as complete. Reason: "complete" (BFS exhausted), "budget" (server budget cap hit), "stuck" (could not back out), "login_required" (auth wall). The server-side runner finalizes the run row + emits exploration.finished after this returns.',
      {
        reason: z.enum(['complete', 'budget', 'stuck', 'login_required']),
        message: z.string().optional(),
      },
      async ({ reason, message }) => {
        // The runner observes the structuredContent.finishRequested signal
        // and finalizes from outside. We do NOT mutate DB state here.
        return {
          content: [
            {
              type: 'text' as const,
              text: `Finish requested: ${reason}${message ? ` — ${message}` : ''}`,
            },
          ],
          structuredContent: { finishRequested: true, reason, message: message ?? null },
        };
      },
    ),
  ];
}
