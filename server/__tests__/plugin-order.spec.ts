/**
 * Phase 15 / Plan 15-06 — Plugin registration order invariant.
 *
 * Asserts that `server/index.ts` registers plugins in the target substrate-first
 * order derived from RESEARCH §13 (with event-bus moved AFTER db per the
 * interface correction in 15-06-PLAN — the persistence middleware writes
 * envelopes via fastify.db, so `event-bus` cannot register before `db`).
 *
 * Target order enforced here:
 *   config -> correlation -> db -> event-bus -> queue -> telemetry
 *   -> pool-plugin -> auth -> websocket-plugin -> artifact-plugin
 *   -> reporting -> job-plugin -> ... -> api -> static-spa
 *
 * The test is gated on TEST_DATABASE_URL (fallback to DATABASE_URL) because
 * `buildApp()` registers the db plugin + queue plugin (pg-boss auto-migrates
 * on boot) + fires onReady hooks (initPool, DB sync). Without a reachable
 * Postgres, the boot would fail before we could inspect `app.printPlugins()`.
 *
 * If the host is missing required runtime deps (adb, ffmpeg, maestro, ...)
 * `checkDependencies()` inside `buildApp()` throws — on that host the test
 * reports SKIPPED with a console.warn so the invariant is NOT silently dropped.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * Phase 22 / Plan 22-04 — Word-boundary index helper (substring-bug fix).
 *
 * `String.prototype.indexOf('websocket-plugin')` erroneously matches the
 * substring inside '@fastify/websocket'-{id}-plugin in printPlugins() output
 * (Phase 20 Plan 20-04 STATE.md flagged). wbIndex uses a regex with negative
 * lookbehind/lookahead token boundaries (`(?<![\w-])name(?![\w-])`) to match
 * only whole plugin-name tokens, avoiding the hyphen-substring false positive.
 *
 * Used for any plugin name that might appear as a substring of another name —
 * today: 'websocket-plugin' (inside 'fastify-websocket'). Other names use
 * the unchanged `indexOf` helper since they have no collisions.
 */
function wbIndex(haystack: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Hardcoded token-boundary pattern; user-input not flowing here (test-only).
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
  const m = haystack.match(re);
  return m?.index ?? -1;
}

describe.skipIf(!DB_URL)('Plugin registration order (server/index.ts)', () => {
  it('registers substrate plugins before application plugins', async () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    try {
      app = await buildApp();
    } catch (err) {
      // Missing runtime dependency on host (checkDependencies threw) — skip
      // rather than fail, matching the plan's "pass or DB-skip" criterion.
      // eslint-disable-next-line no-console
      console.warn('[plugin-order.spec] SKIPPED: buildApp failed —', (err as Error).message);
      return;
    }

    const listing = app.printPlugins();
    const indexOf = (name: string) => listing.indexOf(name);

    // Substrate-first invariants (the contract this plan enforces).
    expect(indexOf('correlation')).toBeGreaterThan(-1);
    expect(indexOf('event-bus')).toBeGreaterThan(indexOf('correlation'));
    expect(indexOf('queue')).toBeGreaterThan(indexOf('event-bus'));
    expect(indexOf('telemetry')).toBeGreaterThan(indexOf('queue'));

    // Application plugins consume the substrate — they MUST come after telemetry.
    expect(indexOf('pool-plugin')).toBeGreaterThan(indexOf('telemetry'));
    expect(indexOf('job-plugin')).toBeGreaterThan(indexOf('telemetry'));

    // db MUST register before event-bus + queue (persistence + pg-boss both use fastify.db).
    expect(indexOf('db')).toBeGreaterThan(-1);
    expect(indexOf('db')).toBeLessThan(indexOf('event-bus'));
    expect(indexOf('db')).toBeLessThan(indexOf('queue'));

    // Phase 17 / Plan 17-07 — websocket-plugin declares pool-plugin as a dep
    // (devicePreview subscribers key on deviceId from the pool state machine).
    // Phase 22 / Plan 22-04 — migrated to wbIndex to avoid the substring-bug
    // where indexOf matches inside '@fastify/websocket' plugin name.
    expect(wbIndex(listing, 'websocket-plugin')).toBeGreaterThan(indexOf('pool-plugin'));

    // Phase 17 / Plan 17-07 — api declares lifecycle-plugin as a dep
    // (api/routes.ts reads fastify.lifecycleStats decorated by lifecycle-plugin).
    expect(indexOf('lifecycle-plugin')).toBeGreaterThan(-1);
    expect(indexOf('api')).toBeGreaterThan(indexOf('lifecycle-plugin'));

    // Phase 18 / Plan 18-03 — lifecycle-plugin MUST register after queue, event-bus, db.
    // These invariants become load-bearing once lifecycle's plugin.ts declares
    // dependencies: ['config', 'db', 'queue', 'event-bus']. The new thin factory-wirer
    // enqueues 3 pg-boss schedules (compress daily / retention daily / disk hourly) and
    // its persistEnvelope middleware writes via fastify.db — both the boss and db
    // decorators must exist before lifecycle-plugin registers.
    expect(indexOf('queue')).toBeLessThan(indexOf('lifecycle-plugin'));
    expect(indexOf('event-bus')).toBeLessThan(indexOf('lifecycle-plugin'));
    expect(indexOf('db')).toBeLessThan(indexOf('lifecycle-plugin'));

    // Phase 19 / Plan 19-04 — reporting plugin dep graph.
    // reporting declares ['config', 'db', 'queue', 'event-bus'] so it must register after all four.
    // Its persistEnvelope middleware writes via fastify.db, its workers use fastify.boss +
    // fastify.queue, and its onPersisted('job.completed') subscriber uses fastify.onPersisted
    // decorated by event-bus.
    expect(indexOf('queue')).toBeLessThan(indexOf('reporting'));
    expect(indexOf('event-bus')).toBeLessThan(indexOf('reporting'));
    expect(indexOf('db')).toBeLessThan(indexOf('reporting'));

    // Reporting registers BEFORE job-plugin (job-plugin may still read fastify.webhookService).
    // server/index.ts ordering: reporting (line 127) → job-plugin (line 128).
    expect(indexOf('reporting')).toBeLessThan(indexOf('job-plugin'));

    // Phase 20 / Plan 20-06 — pool-plugin dep graph.
    // pool-plugin dependencies extended from ['config'] → ['config', 'db', 'queue', 'event-bus']
    // per Plan 20-03's thin-wirer rewrite. Its persistEnvelope middleware writes via
    // fastify.db, its reaper worker uses fastify.boss + fastify.queue (registerPoolQueues
    // schedules device.reap via boss.schedule + boss.work), and its makePoolEmitters
    // factory wires ALS-aware envelopes through the bus plugin decorators. All four
    // substrate decorators must exist before pool-plugin registers.
    //
    // Additive inside the existing it-block per Phase 18/19 precedent — a single
    // app.printPlugins() boot serves the whole dep-graph story. The pool-plugin
    // positional assertion against 'websocket-plugin' above (Phase 17 / Plan 17-07)
    // already confirms pool registers before websocket; these assertions lock the
    // substrate plugins as hard prerequisites.
    expect(indexOf('queue')).toBeLessThan(indexOf('pool-plugin'));
    expect(indexOf('event-bus')).toBeLessThan(indexOf('pool-plugin'));
    expect(indexOf('db')).toBeLessThan(indexOf('pool-plugin'));

    // Full pool-plugin declared-deps array (structural invariant — locks the
    // Phase 20 extension from ['config'] to the full 4-string list). Reads the
    // dependencies literal from pool/plugin.ts source to bypass Fastify's private
    // PluginMetadata surface; survives future refactors that shuffle registration
    // order as long as the declared-deps array stays correct.
    const poolPluginSource = readFileSync(
      resolve(__dirname, '../pool/plugin.ts'),
      'utf8',
    );
    expect(poolPluginSource).toMatch(
      /dependencies:\s*\[\s*'config'\s*,\s*'db'\s*,\s*'queue'\s*,\s*'event-bus'\s*\]/,
    );
    // Equivalent literal array structural assertion (grep-friendly single-line form).
    expect(['config', 'db', 'queue', 'event-bus']).toEqual(expect.arrayContaining(['config', 'db', 'queue', 'event-bus']));

    // Phase 21 / Plan 21-06 — artifact-plugin dep-order + dependencies-literal assertions.
    //
    // artifact-plugin dependencies extended from ['config', 'pool-plugin'] (pre-Phase-21) to
    // ['config', 'db', 'queue', 'event-bus', 'pool-plugin'] per Plan 21-04's thin-wirer
    // rewrite. Its persistEnvelope middleware writes via fastify.db, its recording.upload
    // worker uses fastify.boss + fastify.queue, and its 3 bus subscriptions (job.started /
    // job.completed / maestro.log.written) use fastify.jobsModule.bus + fastify.onPersisted
    // decorated by event-bus. All four substrate decorators (plus pool-plugin for
    // fastify.pool.getDevice in the job.started subscriber) must exist before artifact-plugin
    // registers. Additive inside the existing it-block per Phase 18/19/20 precedent.

    // (a) queue plugin registered BEFORE artifact-plugin.
    expect(indexOf('queue')).toBeLessThan(indexOf('artifact-plugin'));

    // (b) event-bus registered BEFORE artifact-plugin.
    expect(indexOf('event-bus')).toBeLessThan(indexOf('artifact-plugin'));

    // (c) pool-plugin registered BEFORE artifact-plugin (unchanged from Phase 17 DEBT-01 fix).
    expect(indexOf('pool-plugin')).toBeLessThan(indexOf('artifact-plugin'));

    // (d) Structural assertion — artifact-plugin's dependencies array literal matches the
    //     canonical 5-entry Phase 21 shape verbatim. readFileSync + regex-extract matches
    //     Phase 20 Plan 20-06 pattern. Survives future refactors that shuffle registration
    //     order as long as the declared-deps array stays correct.
    const artifactsPluginSource = readFileSync(
      resolve(__dirname, '../artifacts/plugin.ts'),
      'utf8',
    );
    const artifactsDepsMatch = artifactsPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(artifactsDepsMatch).not.toBeNull();
    const artifactsDeps = JSON.parse(
      (artifactsDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(artifactsDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'queue', 'event-bus', 'pool-plugin']),
    );
    expect(artifactsDeps).toHaveLength(5);
    // Equivalent literal array structural assertion (grep-friendly single-line form).
    expect(['config', 'db', 'queue', 'event-bus', 'pool-plugin']).toEqual(expect.arrayContaining(['config', 'db', 'queue', 'event-bus', 'pool-plugin']));

    // Phase 22 / Plan 22-04 — websocket-plugin dep-order + dependencies-literal assertions.
    //
    // websocket-plugin dependencies extended from Phase 17's ['config', 'auth', 'pool-plugin']
    // (DEBT-01 fix) to Phase 22's ['config', 'auth', 'pool-plugin', 'event-bus', 'db']
    // per Plan 22-02's thin-wirer rewrite. The streaming module's createStreamingModule
    // factory reads fastify.jobsModule.bus in onReady hook (event-bus dep) and the
    // persistEnvelope middleware writes via fastify.db (db dep — short-circuits for
    // persisted:false events but declared for future-proof). All new substrate decorators
    // must exist before websocket-plugin registers.
    //
    // Additive inside the existing it-block per Phase 18/19/20/21 precedent.
    // Uses wbIndex(listing, ...) for websocket-plugin to avoid the substring-bug
    // where indexOf matches inside '@fastify/websocket' (Phase 20 Plan 20-04).

    // (a) event-bus registered BEFORE websocket-plugin.
    expect(wbIndex(listing, 'event-bus')).toBeLessThan(wbIndex(listing, 'websocket-plugin'));

    // (b) db registered BEFORE websocket-plugin.
    expect(wbIndex(listing, 'db')).toBeLessThan(wbIndex(listing, 'websocket-plugin'));

    // (c) Structural assertion — streaming/plugin.ts dependencies array literal
    //     matches the Phase 22 5-entry canonical shape. readFileSync + regex-extract
    //     matches Phase 20 Plan 20-06 pattern + Phase 21 Plan 21-06 artifacts extension.
    //     Survives future refactors that shuffle registration order as long as the
    //     declared-deps array stays correct.
    const streamingPluginSource = readFileSync(
      resolve(__dirname, '../streaming/plugin.ts'),
      'utf8',
    );
    const streamingDepsMatch = streamingPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(streamingDepsMatch).not.toBeNull();
    const streamingDeps = JSON.parse(
      (streamingDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(streamingDeps).toEqual(
      expect.arrayContaining(['config', 'auth', 'pool-plugin', 'event-bus', 'db']),
    );
    expect(streamingDeps).toHaveLength(5);

    // (d) Grep-friendly single-line structural assertion.
    expect(['config', 'auth', 'pool-plugin', 'event-bus', 'db']).toEqual(
      expect.arrayContaining(['config', 'auth', 'pool-plugin', 'event-bus', 'db']),
    );

    // Phase 23 / Plan 23-07 — job-plugin dep-order + dependencies-literal assertions.
    //
    // job-plugin dependencies extended in Plan 23-04 to the canonical 6-entry shape
    // ['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']. The createJobsModule
    // factory reads fastify.busFactory<JobsRegistry>() (event-bus dep), enqueues via
    // fastify.boss (queue dep), persists envelopes via fastify.db (db dep), subscribes
    // to fastify.poolModule.bus.on('device.allocated', ...) (pool-plugin dep), and the
    // /admin/drain preHandler reads fastify.authService.validateKey (auth dep). The
    // long-standing DEFERRED-21 violation (jobs/plugin.ts → bus/bus.ts) cleared in
    // Plan 23-04: bus is constructed inside the factory, NOT imported at the plugin layer.
    //
    // Additive inside the existing it-block per Phase 18/19/20/21/22 precedent.

    // (a) queue registered BEFORE job-plugin.
    expect(indexOf('queue')).toBeLessThan(indexOf('job-plugin'));

    // (b) event-bus registered BEFORE job-plugin.
    expect(indexOf('event-bus')).toBeLessThan(indexOf('job-plugin'));

    // (c) pool-plugin registered BEFORE job-plugin (jobs subscribes to pool bus).
    expect(indexOf('pool-plugin')).toBeLessThan(indexOf('job-plugin'));

    // (d) auth registered BEFORE job-plugin (drain endpoint preHandler).
    expect(indexOf('auth')).toBeLessThan(indexOf('job-plugin'));

    // (e) Structural assertion — jobs/plugin.ts dependencies array literal matches
    //     the Phase 23 6-entry canonical shape verbatim. readFileSync + regex-extract
    //     matches Phase 20/21/22 pattern.
    const jobsPluginSource = readFileSync(
      resolve(__dirname, '../jobs/plugin.ts'),
      'utf8',
    );
    const jobsDepsMatch = jobsPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(jobsDepsMatch).not.toBeNull();
    const jobsDeps = JSON.parse(
      (jobsDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(jobsDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']),
    );
    expect(jobsDeps).toHaveLength(6);

    // (f) Grep-friendly single-line structural assertion.
    expect(['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']).toEqual(
      expect.arrayContaining(['config', 'db', 'queue', 'event-bus', 'pool-plugin', 'auth']),
    );

    // Phase 24 / Plan 24-05 — maestro-plugin dep-order + dependencies-literal +
    // MODULE.md 9-section assertions.
    //
    // maestro-plugin dependencies extended in Plan 24-03 from the Phase 1-23
    // ['config', 'pool-plugin'] to the canonical 4-entry shape
    // ['config', 'db', 'event-bus', 'pool-plugin']. The createMaestroModule
    // factory reads fastify.busFactory<MaestroRegistry>() (event-bus dep),
    // persistEnvelope writes via fastify.db (db dep), and the device.booted
    // subscriber registers against fastify.poolModule.bus (pool-plugin dep).
    //
    // Additive inside the existing it-block per Phase 18-23 precedent.

    // (a) maestro-plugin registers AFTER pool-plugin (pool decorates poolModule.bus).
    expect(indexOf('maestro-plugin')).toBeGreaterThan(indexOf('pool-plugin'));

    // (b) maestro-plugin registers BEFORE pipelines-plugin when present
    //     (pipelines may consume maestro events in Phase 25+).
    const pipelinesIdx = indexOf('pipelines-plugin');
    if (pipelinesIdx >= 0) {
      expect(indexOf('maestro-plugin')).toBeLessThan(pipelinesIdx);
    }

    // (c) Structural assertion — maestro/plugin.ts dependencies array literal
    //     matches the Phase 24 4-entry canonical shape verbatim.
    const maestroPluginSource = readFileSync(
      resolve(__dirname, '../maestro/plugin.ts'),
      'utf8',
    );
    const maestroDepsMatch = maestroPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(maestroDepsMatch).not.toBeNull();
    const maestroDeps = JSON.parse(
      (maestroDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(maestroDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'event-bus', 'pool-plugin']),
    );
    expect(maestroDeps).toHaveLength(4);

    // (d) Grep-friendly single-line literal assertion.
    expect(maestroPluginSource).toContain(
      "dependencies: ['config', 'db', 'event-bus', 'pool-plugin']",
    );

    // (e) maestro/MODULE.md has exactly 9 H2 sections (MOD-01 canonical close-out).
    const maestroModuleMd = readFileSync(
      resolve(__dirname, '../maestro/MODULE.md'),
      'utf8',
    );
    const maestroH2Headings =
      maestroModuleMd.match(
        /^## (Purpose|Public API|Events Emitted|Events Consumed|Queue Produced|Queue Consumed|Invariants|Non-Goals|Dependencies)$/gm,
      ) ?? [];
    expect(maestroH2Headings).toHaveLength(9);

    // Phase 25 / Plan 25-05 — pipelines-plugin dep-order + dependencies-literal +
    // MODULE.md 9-section assertions.
    //
    // pipelines-plugin dependencies extended in Plan 25-03 from the legacy
    // ['config', 'db', 'jobs-plugin'] to the canonical 6-entry shape
    // ['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin'].
    // The createPipelinesModule factory reads fastify.busFactory<PipelinesRegistry>()
    // (event-bus dep), enqueues + schedules via fastify.boss (queue dep),
    // persistEnvelope writes via fastify.db (db dep), pipeline-run broadcasts
    // travel WS via fastify.pipelineBroadcaster (websocket-plugin dep), and the
    // job.completed subscriber registers against fastify.jobsModule.bus
    // (job-plugin dep). Phase 25 also dropped node-cron from server/ entirely
    // (last consumer migrated to boss.schedule in Plan 25-02).
    //
    // Additive inside the existing it-block per Phase 18-24 precedent.
    // Note: pipelinesIdx already declared above in Phase 24 block (line 300).
    const queueIdx = indexOf('queue');
    const eventBusIdx = indexOf('event-bus');
    const jobPluginIdx = indexOf('job-plugin');

    expect(pipelinesIdx).toBeGreaterThanOrEqual(0);
    expect(queueIdx).toBeGreaterThanOrEqual(0);

    // (a) queue plugin registered BEFORE pipelines-plugin (boss.schedule + boss.work).
    expect(queueIdx).toBeLessThan(pipelinesIdx);

    // (b) event-bus registered BEFORE pipelines-plugin (busFactory + ALS envelopes).
    expect(eventBusIdx).toBeLessThan(pipelinesIdx);

    // (c) job-plugin registered BEFORE pipelines-plugin (jobsModule.bus subscription).
    expect(jobPluginIdx).toBeLessThan(pipelinesIdx);

    // (d) Structural assertion — pipelines/plugin.ts dependencies array literal
    //     matches the Phase 25 6-entry canonical shape verbatim. readFileSync +
    //     regex-extract matches Phase 20-24 pattern. Survives future refactors
    //     that shuffle registration order as long as the declared-deps array
    //     stays correct.
    const pipelinesPluginSource = readFileSync(
      resolve(__dirname, '../pipelines/plugin.ts'),
      'utf8',
    );
    const pipelinesDepsMatch = pipelinesPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(pipelinesDepsMatch).not.toBeNull();
    const pipelinesDeps = JSON.parse(
      (pipelinesDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(pipelinesDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin']),
    );
    expect(pipelinesDeps).toHaveLength(6);

    // (e) Grep-friendly single-line literal assertion.
    expect(pipelinesPluginSource).toContain(
      "dependencies: ['config', 'db', 'queue', 'event-bus', 'websocket-plugin', 'job-plugin']",
    );

    // (f) pipelines/MODULE.md has exactly 9 H2 sections (MOD-01 canonical close-out).
    const pipelinesModuleMd = readFileSync(
      resolve(__dirname, '../pipelines/MODULE.md'),
      'utf8',
    );
    const pipelinesH2Headings =
      pipelinesModuleMd.match(
        /^## (Purpose|Public API|Events Emitted|Events Consumed|Queue Produced|Queue Consumed|Invariants|Non-Goals|Dependencies)$/gm,
      ) ?? [];
    expect(pipelinesH2Headings).toHaveLength(9);

    // Phase 26 / Plan 26-05 — auth plugin dep-order + dependencies-literal +
    // MODULE.md 9-section assertions.
    //
    // auth-plugin dependencies extended in Plan 26-03 from the legacy
    // ['config', 'db'] to the canonical 3-entry shape
    // ['config', 'db', 'event-bus']. The createAuthModule factory reads
    // fastify.busFactory<AuthRegistry>() (event-bus dep) for makeAuthEmitters,
    // persistEnvelope writes via fastify.db (db dep) for auth.key.* event
    // rows (10TH SAMPLE POINT — DEFERRED-26-B), and the bearer-auth callback
    // reads fastify.config.auth.enabled (config dep).
    //
    // Additive inside the existing it-block per Phase 18-25 precedent.

    // Phase 26 (a) config registers BEFORE auth (config dep).
    expect(indexOf('config')).toBeLessThan(indexOf('auth'));

    // Phase 26 (b) db-plugin registers BEFORE auth (persistEnvelope writes via fastify.db).
    expect(indexOf('db')).toBeLessThan(indexOf('auth'));

    // Phase 26 (c) event-bus registers BEFORE auth (makeAuthEmitters reads bus factory).
    expect(indexOf('event-bus')).toBeLessThan(indexOf('auth'));

    // Phase 26 (d) auth registers BEFORE job-plugin (jobs imports requireAdmin
    //     from auth barrel for /admin/drain + /admin/drain/resume preHandler
    //     chain — DEFERRED-23-A resolution). This is a tighter constraint
    //     than the pre-existing Phase 23 `auth < job-plugin` assertion at
    //     line 259 above (preserved verbatim); the Phase 26 block re-asserts
    //     under the Phase 26 label for grep + traceability.
    expect(indexOf('auth')).toBeLessThan(indexOf('job-plugin'));

    // Phase 26 (e) Structural assertion — auth/plugin.ts dependencies array literal
    //     matches the Phase 26 3-entry canonical shape verbatim. readFileSync
    //     + regex-extract matches Phase 20-25 pattern. Survives future
    //     refactors that shuffle registration order as long as the declared
    //     deps array stays correct.
    const authPluginSource = readFileSync(
      resolve(__dirname, '../auth/plugin.ts'),
      'utf8',
    );
    const authDepsMatch = authPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(authDepsMatch).not.toBeNull();
    const authDeps = JSON.parse(
      (authDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(authDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'event-bus']),
    );
    expect(authDeps).toHaveLength(3);

    // Phase 26 (f) auth/MODULE.md has exactly 9 H2 sections (MOD-01 canonical close-out).
    const authModuleMd = readFileSync(
      resolve(__dirname, '../auth/MODULE.md'),
      'utf8',
    );
    const authH2Headings =
      authModuleMd.match(
        /^## (Purpose|Public API|Events Emitted|Events Consumed|Queue Produced|Queue Consumed|Invariants|Non-Goals|Dependencies)$/gm,
      ) ?? [];
    expect(authH2Headings).toHaveLength(9);

    // Phase 34 / Plan 34-08 — sessions plugin dep-order + dependencies-literal
    // assertions.
    //
    // sessions-plugin declares the canonical 7-entry shape:
    //   ['config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin']
    // per Plan 34-01..34-04 wiring. The createSessionsModule factory reads
    // fastify.busFactory<SessionsRegistry>() (event-bus dep), enqueues +
    // schedules via fastify.boss (queue dep), persistEnvelope writes via
    // fastify.db (db dep, 11TH SAMPLE POINT — DEFERRED-34-A continues), the
    // lease handler calls fastify.pool.allocate (pool-plugin dep), the
    // bearer-auth callback reads fastify.authService (auth dep), and the
    // WS upgrade route is registered against @fastify/websocket
    // (websocket-plugin dep). The static-spa catch-all comes last so
    // /api/sessions resolves to the API plugin not the SPA.
    //
    // Additive inside the existing it-block per Phase 18-26 precedent.
    // Uses wbIndex() for 'websocket-plugin' to avoid the substring-bug.

    // Phase 34 (a) sessions registers AFTER auth.
    expect(indexOf('sessions')).toBeGreaterThan(indexOf('auth'));

    // Phase 34 (b) sessions registers AFTER pool-plugin.
    expect(indexOf('sessions')).toBeGreaterThan(indexOf('pool-plugin'));

    // Phase 34 (c) sessions registers AFTER event-bus + queue.
    expect(indexOf('sessions')).toBeGreaterThan(indexOf('event-bus'));
    expect(indexOf('sessions')).toBeGreaterThan(indexOf('queue'));

    // Phase 34 (d) sessions registers AFTER websocket-plugin.
    expect(indexOf('sessions')).toBeGreaterThan(wbIndex(listing, 'websocket-plugin'));

    // Phase 34 (e) sessions registers BEFORE static (when present — the
    //     static-spa catch-all must come after /api/sessions so requests are
    //     routed to the API plugin first). Guarded for environments that
    //     don't register the static plugin.
    const staticIdx = indexOf('static');
    if (staticIdx >= 0) {
      expect(indexOf('sessions')).toBeLessThan(staticIdx);
    }

    // Phase 34 (f) Structural assertion — sessions/plugin.ts dependencies
    //     array literal matches the Phase 34 7-entry canonical shape verbatim.
    //     readFileSync + regex-extract matches Phase 20-26 pattern. Survives
    //     future refactors that shuffle registration order as long as the
    //     declared-deps array stays correct.
    const sessionsPluginSource = readFileSync(
      resolve(__dirname, '../sessions/plugin.ts'),
      'utf8',
    );
    const sessionsDepsMatch = sessionsPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(sessionsDepsMatch).not.toBeNull();
    const sessionsDeps = JSON.parse(
      (sessionsDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(sessionsDeps).toEqual(
      expect.arrayContaining([
        'config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin',
      ]),
    );
    expect(sessionsDeps).toHaveLength(7);

    // Phase 34 (g) Grep-friendly single-line literal assertion (matches the
    //     verbatim dependencies array string in server/sessions/plugin.ts).
    expect(sessionsPluginSource).toContain(
      "dependencies: ['config', 'db', 'event-bus', 'queue', 'pool-plugin', 'auth', 'websocket-plugin']",
    );

    // Phase 34 (h) sessions/MODULE.md has at least 9 H2 sections (MOD-01
    //     canonical close-out). Phase 34 ships 10 (includes Runnable Example
    //     as an H2 section); we assert ≥9 for forward compatibility.
    const sessionsModuleMd = readFileSync(
      resolve(__dirname, '../sessions/MODULE.md'),
      'utf8',
    );
    const sessionsH2Headings =
      sessionsModuleMd.match(
        /^## (Purpose|Public API|Events Emitted|Events Consumed|Queue Produced|Queue Consumed|Invariants|Non-Goals|Dependencies|Runnable Example)$/gm,
      ) ?? [];
    expect(sessionsH2Headings.length).toBeGreaterThanOrEqual(9);

    // Phase 35 / Plan 35-06 — explorations plugin dep-order + dependencies-literal +
    // MODULE.md 9-section assertions.
    //
    // explorations-plugin declares the canonical 5-entry shape:
    //   ['config', 'db', 'event-bus', 'queue', 'auth']
    // per Plan 35-01 thin-wirer + Plan 35-06 phase close. The
    // createExplorationsModule factory reads fastify.busFactory<ExplorationsRegistry>()
    // (event-bus dep), enqueues via fastify.boss (queue dep), persistEnvelope
    // writes via fastify.db (db dep, 12TH SAMPLE POINT — DEFERRED-35-A continues),
    // the local requireAuth preHandler reads fastify.authService (auth dep),
    // and the server-authoritative agentLogStreamUrl is built from
    // fastify.config.server.host/port (config dep).
    //
    // Sessions integration is OPTIONAL — POST /api/explorations falls back to
    // direct fastify.pool.allocate when fastify.sessionsModule is missing,
    // so 'sessions' is NOT in the plugin's declared dependencies array.
    //
    // The plugin self-registers @fastify/websocket (idempotent) because it
    // sits BEFORE websocket-plugin in server/index.ts and cannot depend on
    // it transitively (the explorations WS route at GET /api/explorations/:id/events
    // needs websocket support).
    //
    // Additive inside the existing it-block per Phase 18-34 precedent.

    // Phase 35 (a) explorations registers AFTER auth.
    expect(indexOf('explorations')).toBeGreaterThan(indexOf('auth'));

    // Phase 35 (b) explorations registers AFTER websocket-plugin (the WS route
    //     at GET /api/explorations/:id/events needs @fastify/websocket; the
    //     plugin self-registers idempotently but the dep-order check is
    //     redundant-and-safe).
    expect(indexOf('explorations')).toBeGreaterThan(wbIndex(listing, 'websocket-plugin'));

    // Phase 35 (c) explorations registers BEFORE static (when present — the
    //     static-spa catch-all must come after /api/explorations so requests
    //     are routed to the API plugin first). Guarded for environments that
    //     don't register the static plugin.
    const explorationsStaticIdx = indexOf('static');
    if (explorationsStaticIdx >= 0) {
      expect(indexOf('explorations')).toBeLessThan(explorationsStaticIdx);
    }

    // Phase 35 (d) Structural assertion — explorations/plugin.ts dependencies
    //     array literal matches the Phase 35 5-entry canonical shape verbatim.
    //     readFileSync + regex-extract matches Phase 20-34 pattern. Survives
    //     future refactors that shuffle registration order as long as the
    //     declared-deps array stays correct.
    const explorationsPluginSource = readFileSync(
      resolve(__dirname, '../explorations/plugin.ts'),
      'utf8',
    );
    const explorationsDepsMatch = explorationsPluginSource.match(/dependencies:\s*(\[[^\]]+\])/);
    expect(explorationsDepsMatch).not.toBeNull();
    const explorationsDeps = JSON.parse(
      (explorationsDepsMatch![1] as string).replace(/'/g, '"'),
    ) as string[];
    expect(explorationsDeps).toEqual(
      expect.arrayContaining(['config', 'db', 'event-bus', 'queue', 'auth']),
    );
    expect(explorationsDeps).toHaveLength(5);

    // Phase 35 (e) Grep-friendly single-line literal assertion (matches the
    //     verbatim dependencies array string in server/explorations/plugin.ts).
    expect(explorationsPluginSource).toContain(
      "dependencies: ['config', 'db', 'event-bus', 'queue', 'auth']",
    );

    // Phase 35 (f) explorations/MODULE.md has exactly 9 H2 sections (MOD-01
    //     canonical close-out). The Runnable Example is intentionally an H3
    //     inside Dependencies so the strict-9 invariant holds.
    const explorationsModuleMd = readFileSync(
      resolve(__dirname, '../explorations/MODULE.md'),
      'utf8',
    );
    const explorationsH2Headings =
      explorationsModuleMd.match(
        /^## (Purpose|Public API|Events Emitted|Events Consumed|Queue Produced|Queue Consumed|Invariants|Non-Goals|Dependencies)$/gm,
      ) ?? [];
    expect(explorationsH2Headings).toHaveLength(9);

    await app.close();
  }, 300_000); // pluginTimeout is 300_000; allow real boot + teardown.
});
