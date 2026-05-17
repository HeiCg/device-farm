/**
 * Explorations agent runner (Phase 35 Plan 35-02 / T-35.2).
 *
 * The pg-boss `exploration.run` queue worker calls `runExploration(runId, deps)`.
 * The runner:
 *   1. Loads the exploration row + decodes via Zod.
 *   2. Calls `markRunStarted` (status: 'queued' → 'running', startedAt = now).
 *   3. Emits `exploration.started` (persisted, audit-start).
 *   4. Builds shared per-run state (StuckDetector, Watchdog, tapCounter, bfsOrderCounter).
 *   5. Constructs the in-process MCP server via `createSdkMcpServer` with the
 *      5 `explore_*` tools from `buildExplorationTools`.
 *   6. Configures the external `@device-stream/mcp` stdio MCP server entry.
 *   7. Loads `prompts/exploration.md` via prompts-loader.
 *   8. Invokes Claude Agent SDK `query()` with the merged MCP server map +
 *      allowedTools whitelist + maxTurns derived from budgetTaps.
 *   9. Iterates the async generator. Per message:
 *        - tool_use of device_*  → increment tapCounter; if cap hit → watchdog.tripBudget().
 *        - tool_use of explore_* → emit toolCall envelope.
 *        - after each yield, check watchdog.shouldStop() → q.close() / break.
 *  10. On normal completion: markRunFinished('complete', stats) +
 *      emit `exploration.finished`.
 *  11. On thrown error: markRunFinished('failed', stats, message) +
 *      emit `exploration.failed`.
 *  12. Always disposes the watchdog in `finally`.
 */
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { eq } from 'drizzle-orm';
import type pino from 'pino';

import {
  explorations as explorationsTable,
} from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import { explorationRowSchema, type Exploration } from '../schemas.js';
import type { ExplorationsEmitters } from '../events.js';
import { buildExplorationTools } from './agent-tools.js';
import { StuckDetector } from './stuck-detector.js';
import { Watchdog, type WatchdogExitReason } from './watchdog.js';
import { loadExplorationPrompt } from './prompts-loader.js';
import * as store from './store.js';

/**
 * Shared dependencies threaded by the explorations module / queue worker.
 * Everything the runner needs without reaching back into Fastify directly.
 */
export interface ExplorationRunnerDeps {
  db: Database;
  emit: ExplorationsEmitters;
  /** Reads an artifact (screenshot) buffer by id — typically `fastify.artifactsModule` wrapper. */
  loadArtifact: (artifactId: string) => Promise<Buffer>;
  /** Server URL (e.g. http://localhost:3000) for the external device-stream MCP env. */
  serverUrl: string;
  /** Bearer/session token forwarded to the external MCP so it can authenticate against the device session. */
  sessionToken: string;
  logger?: pino.Logger;
  /**
   * Optional injection point for tests — substitute a fake `query` /
   * `createSdkMcpServer`. Production passes nothing (uses SDK imports).
   */
  sdk?: {
    query?: typeof query;
    createSdkMcpServer?: typeof createSdkMcpServer;
  };
  /**
   * Optional overrides for the external MCP server config (tests can stub
   * out the stdio child process entirely).
   */
  externalMcpConfig?: Record<string, unknown> | null;
}

const ALLOWED_TOOLS = [
  // Device-stream (external MCP)
  'device_screenshot',
  'device_tap',
  'device_tap_by_description',
  'device_type',
  'device_swipe',
  'device_key',
  'device_launch',
  // Exploration state (in-process MCP)
  'explore_save_screen',
  'explore_save_transition',
  'explore_mark_element_explored',
  'explore_get_unexplored',
  'explore_finish',
];

/** Build the initial user prompt sent into the query() call. */
function buildInitialPrompt(run: Exploration): string {
  return [
    `You are exploring the app "${run.bundleId}" on ${run.platform}.`,
    `Your sessionId is ${run.sessionId}. The app has been launched and is on its initial screen.`,
    '',
    `Budget: max ${run.budgetTaps} taps, ${run.budgetScreens} screens, ${run.budgetSeconds}s wall-clock.`,
    '',
    'Start by calling device_screenshot to see the current screen, then begin BFS exploration per your instructions.',
  ].join('\n');
}

/**
 * Run an exploration end-to-end. The pg-boss worker invokes this with the
 * payload-decoded runId.
 */
export async function runExploration(
  runId: string,
  deps: ExplorationRunnerDeps,
): Promise<void> {
  const logger = (deps.logger ?? (console as unknown as pino.Logger));

  // 1. Load + decode run row.
  const rows = await deps.db
    .select()
    .from(explorationsTable)
    .where(eq(explorationsTable.id, runId))
    .limit(1);
  if (rows.length === 0) {
    throw new Error(`runExploration: exploration ${runId} not found`);
  }
  const run = explorationRowSchema.parse(rows[0]);

  // 2. Mark started (queued → running, startedAt).
  await store.markRunStarted({ db: deps.db }, runId);

  // 3. Emit started (persisted).
  // startedBy is the actor literal recorded at POST time (apikey:<id> | system).
  // Default to 'system' for legacy rows without ownerActor.
  const startedBy = (run.ownerActor && /^(user:|apikey:|cron|system)/.test(run.ownerActor))
    ? run.ownerActor
    : 'system';
  deps.emit.started(runId, {
    runId,
    deviceId: run.deviceId,
    sessionId: run.sessionId,
    bundleId: run.bundleId,
    platform: run.platform,
    startedBy,
  });

  // 4. Shared per-run state.
  const stuckDetector = new StuckDetector();
  const tapCounter = { value: 0 };
  const bfsOrderCounter = { value: 0 };
  const startedAtMs = Date.now();

  let queryInstance: { return?: () => unknown } | null = null;

  const watchdog = new Watchdog({
    runId,
    budgetSeconds: run.budgetSeconds,
    onTrigger: (_reason) => {
      // Reach into the running query and ask it to stop.
      try {
        queryInstance?.return?.();
      } catch (err) {
        logger.warn?.({ err, runId }, 'watchdog: failed to terminate query early');
      }
    },
  });

  // 5. In-process MCP server.
  const createServerFn = deps.sdk?.createSdkMcpServer ?? createSdkMcpServer;
  const explorationServer = createServerFn({
    name: 'exploration-state',
    version: '1.0.0',
    tools: buildExplorationTools(runId, {
      db: deps.db,
      emit: deps.emit,
      stuckDetector,
      bfsOrderCounter,
      budgetScreens: run.budgetScreens,
      loadArtifact: deps.loadArtifact,
      logger: logger as pino.Logger,
    }),
  });

  // 6. External MCP server (device-stream) — testable via externalMcpConfig override.
  const externalMcpConfig = deps.externalMcpConfig ?? {
    type: 'stdio' as const,
    command: 'npx',
    args: ['@device-stream/mcp'],
    env: {
      DEVICE_FARM_URL: deps.serverUrl,
      DEVICE_FARM_TOKEN: deps.sessionToken,
      DEVICE_FARM_SESSION_ID: run.sessionId,
    },
  };

  // 7. Load prompt.
  const systemPrompt = await loadExplorationPrompt();

  // 8. Construct query.
  const queryFn = deps.sdk?.query ?? query;
  const q = queryFn({
    prompt: buildInitialPrompt(run),
    options: {
      model: ((run.config as { model?: string }).model ?? 'claude-sonnet-4-5') as never,
      systemPrompt: systemPrompt as never,
      mcpServers: {
        'exploration-state': explorationServer,
        'device-stream': externalMcpConfig,
      } as never,
      allowedTools: ALLOWED_TOOLS as never,
      permissionMode: 'default' as never,
      maxTurns: run.budgetTaps * 3,
    },
  });
  queryInstance = q as { return?: () => unknown };

  // 9. Iterate.
  let finalReason: WatchdogExitReason = 'complete';
  let finalErrorMessage: string | null = null;
  let finishRequested: { reason: string; message?: string | null } | null = null;

  try {
    for await (const msg of q as AsyncIterable<unknown>) {
      // Inspect the message — count taps + emit tool.called envelopes.
      // The SDK message shape varies; we only inspect the fields we care about.
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
      };

      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        for (const block of m.message.content) {
          if (block?.type === 'tool_use' && typeof block.name === 'string') {
            const toolName = block.name;
            const args = (block.input ?? {}) as Record<string, unknown>;

            // Tap counter — device_* tools count toward budgetTaps.
            if (toolName.startsWith('device_')) {
              tapCounter.value++;
              if (tapCounter.value > run.budgetTaps) {
                watchdog.tripBudget();
              }
            }

            // Detect explore_finish — record the requested reason for finalization.
            if (toolName === 'explore_finish') {
              const reason = typeof args.reason === 'string' ? args.reason : 'complete';
              const message = typeof args.message === 'string' ? args.message : null;
              finishRequested = { reason, message };
            }

            // Emit a transient tool.called envelope.
            deps.emit.toolCall(runId, {
              runId,
              name: toolName,
              args,
              durationMs: 0,
            });
          }
        }
      }

      if (watchdog.shouldStop()) {
        try {
          q.return?.();
        } catch {
          /* ignore — already closed */
        }
        break;
      }
    }
  } catch (err) {
    finalReason = 'complete'; // overridden below in the failed branch
    finalErrorMessage = err instanceof Error ? err.message : String(err);
    logger.error?.({ err, runId }, 'agent-runner: query iteration threw');

    const screensDiscovered = await store.getScreenCount({ db: deps.db }, runId);
    const transitionsTotal = await store.getTransitionCount({ db: deps.db }, runId);
    const stats = {
      screensDiscovered,
      transitionsTotal,
      tapsTaken: tapCounter.value,
      durationMs: Date.now() - startedAtMs,
    };
    await store.markRunFinished({ db: deps.db }, runId, 'budget', stats, finalErrorMessage).catch(() => {
      /* ignore secondary failures — primary error is logged */
    });
    deps.emit.failed(runId, {
      runId,
      step: 'agent',
      reason: finalErrorMessage ?? 'unknown',
    });
    watchdog.dispose();
    return;
  }

  // 10. Resolve final reason: prefer explicit explore_finish, else watchdog state.
  if (watchdog.shouldStop()) {
    finalReason = watchdog.exitReason();
  } else if (finishRequested) {
    const r = finishRequested.reason;
    if (r === 'complete' || r === 'budget' || r === 'stuck' || r === 'login_required') {
      finalReason = r === 'complete' ? 'complete' : r === 'budget' ? 'budget' : r === 'stuck' ? 'budget' : 'budget';
    } else {
      finalReason = 'complete';
    }
    finalErrorMessage = finishRequested.message ?? null;
  } else {
    finalReason = 'complete';
  }

  const screensDiscovered = await store.getScreenCount({ db: deps.db }, runId);
  const transitionsTotal = await store.getTransitionCount({ db: deps.db }, runId);
  const stats = {
    screensDiscovered,
    transitionsTotal,
    tapsTaken: tapCounter.value,
    durationMs: Date.now() - startedAtMs,
  };

  // 11. Finalize.
  try {
    const dbReason: 'complete' | 'budget' | 'time' | 'stuck' | 'login_required' | 'cancelled' =
      finalReason === 'budget' || finalReason === 'time' || finalReason === 'cancelled'
        ? finalReason
        : finalReason === 'complete'
          ? (finishRequested?.reason === 'stuck'
              ? 'stuck'
              : finishRequested?.reason === 'login_required'
                ? 'login_required'
                : 'complete')
          : 'complete';
    await store.markRunFinished(
      { db: deps.db },
      runId,
      dbReason,
      stats,
      finalErrorMessage,
    );
    const wsReason: 'complete' | 'budget' | 'stuck' | 'login_required' | 'cancelled' =
      dbReason === 'time' ? 'budget' : dbReason;
    deps.emit.finished(runId, {
      runId,
      reason: wsReason,
      stats,
    });
  } finally {
    watchdog.dispose();
  }
}
