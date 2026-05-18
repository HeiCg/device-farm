import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  text,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const platformEnum = pgEnum('platform', ['android', 'ios']);

export const deviceStatusEnum = pgEnum('device_status', [
  'booting',
  'idle',
  'allocated',
  'running',
  'cleanup',
  'error',
  'offline',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'allocated',                          // Phase 23 Plan 23-03 saga state (DEBT-02 / CLI-05)
  'running',
  'passed',
  'failed',
  'cancelled',
  'timeout',
]);

export const fileTypeEnum = pgEnum('file_type', [
  'flow',
  'config',
  'app_file',
  'other',
]);

export const stepStatusEnum = pgEnum('step_status', [
  'running',
  'passed',
  'failed',
  'skipped',
]);

// Phase 31 Plan 31-01 (SC1) — classification of WHY a job failed.
// Nullable on `jobs`; populated automatically by the streaming subscriber
// on first crash-marker detection (server/streaming/internal/module.ts).
// Future taxonomy phases extend this enum without touching detection code.
export const failureClassEnum = pgEnum('failure_class', [
  'crash',
  'timeout',
  'cancelled',
]);

// Tables

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: platformEnum('type').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  status: deviceStatusEnum('status').notNull().default('idle'),
  currentJobId: uuid('current_job_id'),
  emulatorId: varchar('emulator_id', { length: 255 }).notNull(),
  port: integer('port'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  status: jobStatusEnum('status').notNull().default('queued'),
  platform: platformEnum('platform').notNull(),
  deviceId: uuid('device_id').references(() => devices.id),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  resultSummary: jsonb('result_summary'),
  maestroOutput: text('maestro_output'),
  errorMessage: text('error_message'),
  // Phase 31 Plan 31-01 (SC1) — set by streaming subscriber on first crash.
  // Nullable, no default; existing rows backfill to NULL automatically.
  failureClass: failureClassEnum('failure_class'),
});

export const jobFiles = pgTable('job_files', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  filename: varchar('filename', { length: 512 }).notNull(),
  content: text('content').notNull(),
  fileType: fileTypeEnum('file_type').notNull().default('flow'),
});

export const jobSteps = pgTable('job_steps', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  stepIndex: integer('step_index').notNull(),
  flowName: varchar('flow_name', { length: 512 }),
  command: varchar('command', { length: 1024 }),
  status: stepStatusEnum('status').notNull().default('running'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  screenshotPath: varchar('screenshot_path', { length: 1024 }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const artifactTypeEnum = pgEnum('artifact_type', [
  'video',
  'screenshot',
  'memory',
  'log',
]);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  recordingId: uuid('recording_id'),  // Phase 21 / Plan 21-01 — SC3 DB-layer idempotency
  type: artifactTypeEnum('type').notNull(),
  filePath: varchar('file_path', { length: 1024 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  compressed: boolean('compressed').notNull().default(false),
  compressedAt: timestamp('compressed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // NEW — Phase 1: populated only when type='video', null otherwise.
  // Wall-clock instant when the screen recording actually started, used to
  // derive per-step offsets in the report viewer.
  videoStartedAt: timestamp('video_started_at', { withTimezone: true }),
}, (table) => [
  index('artifacts_job_id_idx').on(table.jobId),
  index('artifacts_created_at_idx').on(table.createdAt),
  index('artifacts_type_idx').on(table.type),
  uniqueIndex('artifacts_recording_id_idx').on(table.recordingId),  // Phase 21 / Plan 21-01 — SC3
]);

// API Keys table for authentication
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  keySalt: varchar('key_salt', { length: 64 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
  // Phase 26 — DEFERRED-23-A admin claim. JSONB so future claim shapes
  // (e.g., `{admin: true, scopes: ['jobs:write']}`) can extend without migration.
  // Default '{}' on new rows; existing rows backfilled to '{}' via migration
  // 0005_api_keys_claims.sql defensive UPDATE (per Phase 26 Pitfall 5).
  claims: jsonb('claims').notNull().default(sql`'{}'::jsonb`),
});

// Test Case Management (TCM) — REMOVED 2026-05-15.
// All TCM tables/enums (labels, testCases, testCaseSteps, testCaseLabels,
// testSuites, testSuiteCases, testExecutions, testExecutionResults,
// testStepResults + related enums) were dropped from the application.
// Existing database rows are not touched by this commit — generate a
// drop migration via `npx drizzle-kit generate` if you want them removed.

// ── Pipeline Engine ──────────────────────────────────────────────

export const pipelineTriggerTypeEnum = pgEnum('pipeline_trigger_type', [
  'api',
  'schedule',
  'manual',
  'azure-pr',
]);

export const pipelineRunStatusEnum = pgEnum('pipeline_run_status', [
  'pending',
  'running',
  'passed',
  'failed',
  'cancelled',
]);

export const pipelineStageStatusEnum = pgEnum('pipeline_stage_status', [
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
]);

export const pipelineStageTypeEnum = pgEnum('pipeline_stage_type', [
  'script',
  'maestro',
  'device-stream-script',
  'internal-clone',
  'internal-release',
]);

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  yamlContent: text('yaml_content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
  triggerType: pipelineTriggerTypeEnum('trigger_type').notNull(),
  status: pipelineRunStatusEnum('status').notNull().default('pending'),
  variables: jsonb('variables'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  sourceBranch: text('source_branch'),
  sourceCommit: text('source_commit'),
  azurePrId: text('azure_pr_id'),
  azurePrUrl: text('azure_pr_url'),
  azurePrCommentId: text('azure_pr_comment_id'),          // NEW — PR-bot thread ID to PATCH
  azurePrIntegrationId: text('azure_pr_integration_id'),  // NEW — routes webhooks to config
  // Phase 37 Plan 37-00 — GitHub PR-bot columns (mirror azure_pr_* shape).
  // Per Anti-Pattern in 37-RESEARCH.md, we store installation_id (not
  // integration_id) because GitHub Apps are provisioned per-installation.
  githubPrId: text('github_pr_id'),
  githubPrUrl: text('github_pr_url'),
  githubPrCommentId: text('github_pr_comment_id'),
  githubInstallationId: bigint('github_installation_id', { mode: 'number' }),
  githubRepoOwner: text('github_repo_owner'),
  githubRepoName: text('github_repo_name'),
  errorMessage: text('error_message'),
}, (table) => [
  // Phase 37 Plan 37-00 — partial index for GitHub PR-bot lookup
  index('pipeline_runs_github_pr_idx')
    .on(table.githubInstallationId, table.githubPrId)
    .where(sql`${table.githubPrId} IS NOT NULL`),
]);

export const pipelineStageRuns = pgTable('pipeline_stage_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid('run_id').notNull().references(() => pipelineRuns.id),
  stageName: varchar('stage_name', { length: 255 }).notNull(),
  stageIndex: integer('stage_index').notNull(),
  type: pipelineStageTypeEnum('type').notNull().default('script'),
  status: pipelineStageStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  logs: text('logs'),
  errorMessage: text('error_message'),
});

export const pipelineStageJobs = pgTable('pipeline_stage_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  stageRunId: uuid('stage_run_id').notNull().references(() => pipelineStageRuns.id),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  matrixName: varchar('matrix_name', { length: 255 }),
});

export const pipelineSecrets = pgTable('pipeline_secrets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull().unique(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pipelineSchedules = pgTable('pipeline_schedules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
  cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  variables: jsonb('variables'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
});

// ── Event Sourcing (TRACE-07) ──────────────────────────────────────
//
// Append-only `events` table — every domain event flagged `persisted: true`
// in the registry is written here by the bus middleware (Phase 15 Plan 04).
//
// NOTE: `payload` intentionally has NO default. Per RESEARCH §6 Pitfall #5,
// setting a JSONB default on this column causes drizzle-kit diff-churn.
// Every row supplies `payload` (it is notNull).
export const events = pgTable('events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  eventVersion: integer('event_version').notNull().default(1),
  correlationId: uuid('correlation_id').notNull(),
  causationId: uuid('causation_id'),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actor: varchar('actor', { length: 255 }).notNull().default('system'),
}, (table) => [
  index('events_correlation_id_idx').on(table.correlationId),
  index('events_event_type_idx').on(table.eventType),
  index('events_occurred_at_idx').on(table.occurredAt),
  index('events_aggregate_idx').on(table.aggregateType, table.aggregateId),
]);

// ── Hook Runs (Phase 16 Plan 01 — QUEUE-06 + EVENTS-06 idempotency proof table) ──
//
// Each row represents one attempted execution of a registered hook in response to a
// bus event. `operation_key = ${triggerEventId}:${hookName}` is the idempotency key
// claimed via `INSERT ... ON CONFLICT (operation_key) DO NOTHING RETURNING operation_key`.
// Replay of the same bus trigger re-enqueues no-op at the queue boundary (singletonKey)
// AND re-insert no-op at the DB boundary (PK conflict). Both layers together guarantee
// at-most-one hook invocation per (triggerEventId, hookName) pair.
//
// No FK on event_id — bus envelope ids may not be persisted (registry.persisted=false
// events) when their triggered hooks run. See RESEARCH §2.
export const hookRuns = pgTable('hook_runs', {
  operationKey: text('operation_key').primaryKey(),
  hookName: varchar('hook_name', { length: 255 }).notNull(),
  eventId: uuid('event_id').notNull(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  status: varchar('status', { length: 32 }).notNull().default('running'),  // running | completed | failed
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms'),
}, (table) => [
  index('hook_runs_hook_name_idx').on(table.hookName),
  index('hook_runs_event_id_idx').on(table.eventId),
  index('hook_runs_triggered_at_idx').on(table.triggeredAt),
]);

/**
 * Phase 23 / Plan 23-00 — Generic key/value system state table for cross-module
 * operational flags. First consumer: drain procedure (Plan 23-05) writes
 * `drain_requested_at` row; enqueue admission (Plan 23-04) reads it.
 *
 * Intentionally generic so Phase 25 pipelines / Phase 26 auth feature flags
 * can reuse without speculating use cases (CONTEXT §Specifics).
 */
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Sessions (Phase 34 Plan 34-00) ──────────────────────────────────
//
// Interactive lease/release surface for tap/type/swipe/screenshot/install
// over REST + WS. See 34-RESEARCH.md §Schema for the rationale.
//
// `ownerActor` mirrors `events.actor` (Phase 26 TRACE-10 literal: apikey:<id>
// | user:<id> | system | cron). Nullable when auth.enabled=false (dev mode).
//
// Partial unique index `WHERE status = 'active'` enforces single-active-
// session-per-device at the DB layer — Plan 34-01 surfaces 23505 as RFC 7807
// 409 `device_already_leased`. Multi-session-per-device is v3.1 deferred.
//
// `metadata` jsonb has NO default (per Phase 15 RESEARCH §6 pitfall #5 —
// JSONB defaults cause drizzle-kit diff-churn).

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'released',
  'expired',
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  ownerApiKeyId: uuid('owner_api_key_id').references(() => apiKeys.id),
  ownerActor: varchar('owner_actor', { length: 255 }),
  status: sessionStatusEnum('status').notNull().default('active'),
  ttlSeconds: integer('ttl_seconds').notNull().default(600),
  leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
}, (table) => [
  uniqueIndex('sessions_device_active_idx')
    .on(table.deviceId)
    .where(sql`${table.status} = 'active'`),
  index('sessions_lease_until_idx').on(table.leaseUntil),
  index('sessions_status_idx').on(table.status),
  index('sessions_owner_idx').on(table.ownerApiKeyId),
]);

// ── Explorations (Phase 35 Plan 35-00) ──────────────────────────────
//
// App Explorer + Atlas Graph substrate. Claude-driven BFS over an
// interactive session that produces a persisted screen graph + Atlas viz.
// 3 tables: explorations (run row), exploration_screens (BFS nodes),
// exploration_transitions (BFS edges with action dedup hash).
//
// `phash` stored as varchar(64) (NOT bytea) — sharp-phash emits 64-char
// bitstrings, distance comparisons are trivial at scale (Open Q#1 resolved).
//
// Partial-unique semantics:
//   - exploration_screens(run_id, screen_id) UNIQUE — agent re-visits same
//     screen_id within a run must be idempotent.
//   - exploration_transitions(run_id, from, to, action_hash) UNIQUE —
//     prevents duplicate edge inserts when the agent reattempts an action.
//
// `metadata`/`stats` jsonb columns intentionally NO default (per Phase 15
// RESEARCH §6 pitfall #5 — JSONB defaults cause drizzle-kit diff-churn).
// `config` is notNull (every row supplies it at insert time).

export const explorationStatusEnum = pgEnum('exploration_status', [
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled',
]);

export const explorations = pgTable('explorations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  // FK target: sessions.id (Phase 34). Sessions table exists since Plan 34-00.
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  appArtifactId: uuid('app_artifact_id').notNull().references(() => artifacts.id),
  bundleId: text('bundle_id').notNull(),
  platform: platformEnum('platform').notNull(),
  status: explorationStatusEnum('status').notNull().default('queued'),
  startScreenId: text('start_screen_id'),
  budgetTaps: integer('budget_taps').notNull().default(200),
  budgetScreens: integer('budget_screens').notNull().default(60),
  budgetSeconds: integer('budget_seconds').notNull().default(1800),
  config: jsonb('config').notNull(),
  stats: jsonb('stats'),
  ownerApiKeyId: uuid('owner_api_key_id').references(() => apiKeys.id),
  ownerActor: varchar('owner_actor', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
}, (table) => [
  index('explorations_device_idx').on(table.deviceId),
  index('explorations_session_idx').on(table.sessionId),
  index('explorations_status_idx').on(table.status),
  index('explorations_owner_idx').on(table.ownerApiKeyId),
  index('explorations_created_idx').on(table.createdAt),
]);

export const explorationScreens = pgTable('exploration_screens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid('run_id').notNull().references(() => explorations.id, { onDelete: 'cascade' }),
  screenId: text('screen_id').notNull(),
  title: text('title').notNull(),
  screenshotArtifactId: uuid('screenshot_artifact_id').notNull().references(() => artifacts.id),
  // sharp-phash emits 64-char bitstring — Open Q#1 resolved (text storage).
  phash: varchar('phash', { length: 64 }),
  elements: jsonb('elements').notNull(),
  notes: text('notes'),
  bfsDepth: integer('bfs_depth').notNull().default(0),
  visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('exploration_screens_run_screen_idx').on(table.runId, table.screenId),
  index('exploration_screens_phash_idx').on(table.phash),
  index('exploration_screens_run_idx').on(table.runId),
]);

export const explorationTransitions = pgTable('exploration_transitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  runId: uuid('run_id').notNull().references(() => explorations.id, { onDelete: 'cascade' }),
  fromScreenId: text('from_screen_id').notNull(),
  toScreenId: text('to_screen_id').notNull(),
  action: jsonb('action').notNull(),
  actionHash: varchar('action_hash', { length: 64 }).notNull(),
  isBackEdge: boolean('is_back_edge').notNull().default(false),
  bfsOrder: integer('bfs_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('exploration_transitions_dedup_idx').on(
    table.runId, table.fromScreenId, table.toScreenId, table.actionHash,
  ),
  index('exploration_transitions_run_idx').on(table.runId),
  index('exploration_transitions_from_idx').on(table.runId, table.fromScreenId),
]);

// ── Analyses (Phase 37 Plan 37-00 Track A) ──────────────────────────
//
// Stores iOS skeleton analyses ingested from `device-farm analyze`.
// Server side ONLY persists — the Go CLI does the binary extraction
// (cli/internal/macho/). Each row is one snapshot of a build artifact
// or ad-hoc CLI invocation. payload jsonb follows skeletonPayloadSchema
// (server/analysis/schemas.ts) with schema_version:1.
//
// FK: jobId → jobs(id) ON DELETE SET NULL — preserves analysis history
// even after the originating job is purged.
//
// `payload` jsonb intentionally has NO default (Phase 15 RESEARCH §6
// pitfall #5 — JSONB defaults cause drizzle-kit diff-churn). Every row
// supplies payload (it is notNull).

export const analyses = pgTable('analyses', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  buildArtifactId: uuid('build_artifact_id'),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  platform: platformEnum('platform').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('analyses_job_id_idx').on(table.jobId),
  index('analyses_build_artifact_idx').on(table.buildArtifactId),
]);

// ── Preflight Runs (Phase 37 Plan 37-00 Track B) ────────────────────
//
// Stores Greenlight App Store preflight scan results. Each row is one
// scan invocation (POST /api/preflight). No FK — preflight is decoupled
// from jobs/pipelines so it can run standalone on dev binaries before
// CI is wired.
//
// `blockers` + `warnings` default to `[]::jsonb` (NOT a literal default
// in Drizzle — the DB default lives in the migration SQL; reading the
// column always returns an array so the service layer can rely on it).
//
// `status` is a free text column (not a pg enum) because the value set
// is small + stable and a pg enum extension requires a separate migration
// per change. Validation happens at the Zod layer (preflightReportSchema).

export const preflightRuns = pgTable('preflight_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  platform: platformEnum('platform').notNull(),
  filename: text('filename').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  rulesVersion: text('rules_version').notNull(),
  status: text('status').notNull(), // 'pass' | 'pass_with_warnings' | 'blocked'
  blockers: jsonb('blockers').default(sql`'[]'::jsonb`).notNull(),
  warnings: jsonb('warnings').default(sql`'[]'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('preflight_runs_created_idx').on(table.createdAt),
  index('preflight_runs_status_idx').on(table.status),
]);
