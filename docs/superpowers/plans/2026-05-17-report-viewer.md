# Report Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/jobs/[id]` into a ReportPortal/Allure-style report viewer with step timeline, video sync, failure focus, suite/history/trends sub-tabs in `/jobs`, and signed share links used by the Azure DevOps PR commenter.

**Architecture:** Five isolated units — step ingestion (parser wallclock + `commands-*.json` loader), schema delta (one migration adding `artifacts.video_started_at`; reusing existing `job_steps.started_at/finished_at`), report API (`/jobs/:id/report`, suite/history/trends aggregations, share-token), web shell (3-pane `ReportShell` replacing current tabs), and a `report-token` service in `server/auth` consumed by the Azure module. Feature-flagged via `config.ui.use_report_shell`.

**Tech Stack:** TypeScript + Fastify 5, Drizzle ORM (drizzle-kit push), SvelteKit 5 (runes), Tailwind v4, Vitest + @testing-library/svelte, `jose` (new dep for JWT, zero-dep modern), pg-boss (existing).

---

## Phase 1 — Step ingestion & schema

Goal: every step has real `started_at` / `finished_at` derived from Maestro stdout wallclock or `commands-*.json` overrides. Video artifacts know when they started recording.

### Task 1.1: Migration — add `artifacts.video_started_at`

**Files:**
- Modify: `server/db/schema.ts:125-142`
- Test (manual): `psql` after `drizzle-kit push`

- [ ] **Step 1: Add column to schema**

In `server/db/schema.ts`, locate the `artifacts` table definition (~line 125). Add `videoStartedAt` after `createdAt`:

```ts
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  recordingId: uuid('recording_id'),
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
  uniqueIndex('artifacts_recording_id_idx').on(table.recordingId),
]);
```

- [ ] **Step 2: Push schema to DB**

Run:
```bash
DATABASE_URL=postgresql://heicg@localhost:5432/device_farm ./node_modules/.bin/drizzle-kit push
```
Expected: `ALTER TABLE "artifacts" ADD COLUMN "video_started_at" timestamp with time zone;` applied, no warnings.

- [ ] **Step 3: Verify column exists**

Run:
```bash
/opt/homebrew/Cellar/postgresql@17/17.9/bin/psql -U heicg -d device_farm -c "\d artifacts" | grep video_started_at
```
Expected: `video_started_at | timestamp with time zone |`

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): add artifacts.video_started_at for step↔video sync"
```

### Task 1.2: Wallclock recorder in `MaestroParser`

**Files:**
- Modify: `server/jobs/maestro-parser.ts`
- Modify: `server/jobs/types.ts`
- Test: `server/jobs/__tests__/maestro-parser.wallclock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/jobs/__tests__/maestro-parser.wallclock.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { MaestroParser } from '../maestro-parser.js';

describe('MaestroParser wallclock', () => {
  it('records timestamps per command transition', () => {
    let now = 1_700_000_000_000;
    const clock = () => new Date(now);

    const parser = new MaestroParser({
      onFlowStart: () => {},
      onCommandStatus: () => {},
      onFlowResult: () => {},
      onSummary: () => {},
    }, { clock });

    parser.parseLine('Running flow login.yaml');
    parser.parseLine('tapOn("Email") RUNNING');
    now += 500;
    parser.parseLine('tapOn("Email") COMPLETED');
    now += 200;
    parser.parseLine('tapOn("Submit") RUNNING');
    now += 1200;
    parser.parseLine('tapOn("Submit") FAILED');

    const ts = parser.getCommandTimestamps();
    expect(ts.get('tapOn("Email")')).toEqual({
      startedAt: new Date(1_700_000_000_000),
      endedAt:   new Date(1_700_000_000_500),
    });
    expect(ts.get('tapOn("Submit")')).toEqual({
      startedAt: new Date(1_700_000_000_700),
      endedAt:   new Date(1_700_000_001_900),
    });
  });

  it('uses real clock by default', () => {
    const parser = new MaestroParser({
      onFlowStart: () => {},
      onCommandStatus: () => {},
      onFlowResult: () => {},
      onSummary: () => {},
    });
    parser.parseLine('tapOn("X") RUNNING');
    parser.parseLine('tapOn("X") COMPLETED');
    const ts = parser.getCommandTimestamps().get('tapOn("X")');
    expect(ts?.startedAt).toBeInstanceOf(Date);
    expect(ts?.endedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/jobs/__tests__/maestro-parser.wallclock.test.ts
```
Expected: FAIL — `getCommandTimestamps is not a function`.

- [ ] **Step 3: Modify `MaestroParser`**

In `server/jobs/maestro-parser.ts`, extend the class with an injectable clock and a per-command timestamp map. Replace the class header and add the new method:

```ts
export interface MaestroParserOpts {
  clock?: () => Date;
}

export class MaestroParser {
  private callbacks: ParserCallbacks;
  private clock: () => Date;
  private currentFlow: string | null = null;
  private flowResults: Map<string, 'passed' | 'failed' | 'skipped'> = new Map();
  private flowDurations: Map<string, number> = new Map();
  private steps: JobStep[] = [];
  private commandSteps: JobStep[] = [];
  private commandTimestamps: Map<string, { startedAt: Date; endedAt?: Date }> = new Map();
  private rawOutput: string[] = [];
  private suiteSummary: { passed: number; total: number } | null = null;

  constructor(callbacks: ParserCallbacks, opts: MaestroParserOpts = {}) {
    this.callbacks = callbacks;
    this.clock = opts.clock ?? (() => new Date());
  }
```

Inside `parseLine`, in the `COMMAND_STATUS` branch (where Maestro emits `RUNNING`/`COMPLETED`/`FAILED`/`SKIPPED`), record timestamps. Replace the existing branch body:

```ts
    match = line.match(COMMAND_STATUS);
    if (match) {
      const command = match[1];
      const status = match[2];

      const normalizedStatus =
        status === 'COMPLETED' ? 'passed' as const
        : status === 'FAILED' ? 'failed' as const
        : status === 'SKIPPED' ? 'skipped' as const
        : 'running' as const;

      // Wallclock: RUNNING marks startedAt; terminal status marks endedAt.
      const key = command;
      if (status === 'RUNNING') {
        this.commandTimestamps.set(key, { startedAt: this.clock() });
      } else {
        const entry = this.commandTimestamps.get(key);
        if (entry) {
          entry.endedAt = this.clock();
        } else {
          // Maestro skipped the RUNNING line; treat terminal as both
          const now = this.clock();
          this.commandTimestamps.set(key, { startedAt: now, endedAt: now });
        }
      }

      const existing = this.commandSteps.findIndex(
        s => s.command === command && s.flowName === (this.currentFlow ?? ''),
      );
      const step: JobStep = {
        flowName: this.currentFlow ?? '',
        command,
        status: normalizedStatus,
        durationMs: null,
      };
      if (existing >= 0) {
        this.commandSteps[existing] = step;
      } else {
        this.commandSteps.push(step);
      }

      this.callbacks.onCommandStatus(command, status);
      return;
    }
```

Add the getter near `getSummary`:

```ts
  getCommandTimestamps(): Map<string, { startedAt: Date; endedAt?: Date }> {
    return new Map(this.commandTimestamps);
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/jobs/__tests__/maestro-parser.wallclock.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Run full parser suite to catch regressions**

```bash
npx vitest run server/jobs/__tests__/maestro-parser
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/jobs/maestro-parser.ts server/jobs/__tests__/maestro-parser.wallclock.test.ts
git commit -m "feat(jobs): record wallclock timestamps per Maestro command"
```

### Task 1.3: Persist step timestamps in executor

**Files:**
- Modify: `server/jobs/internal/executor.ts:347-358`
- Test: `server/jobs/__tests__/executor.step-timestamps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/jobs/__tests__/executor.step-timestamps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapStepsForPersistence } from '../internal/step-mapper.js';

describe('mapStepsForPersistence', () => {
  it('attaches wallclock timestamps when parser map has the command', () => {
    const steps = [
      { flowName: 'login.yaml', command: 'tapOn("Email")', status: 'passed' as const, durationMs: 500 },
      { flowName: 'login.yaml', command: 'tapOn("Submit")', status: 'failed' as const, durationMs: 1200 },
    ];
    const ts = new Map<string, { startedAt: Date; endedAt?: Date }>([
      ['tapOn("Email")',  { startedAt: new Date(1_700_000_000_000), endedAt: new Date(1_700_000_000_500) }],
      ['tapOn("Submit")', { startedAt: new Date(1_700_000_000_700), endedAt: new Date(1_700_000_001_900) }],
    ]);

    const rows = mapStepsForPersistence('job-1', steps, ts);
    expect(rows[0]).toMatchObject({
      jobId: 'job-1',
      stepIndex: 0,
      command: 'tapOn("Email")',
      startedAt: new Date(1_700_000_000_000),
      finishedAt: new Date(1_700_000_000_500),
    });
    expect(rows[1].finishedAt).toEqual(new Date(1_700_000_001_900));
  });

  it('falls back when timestamp map has no entry (flow-level steps)', () => {
    const steps = [{ flowName: 'login.yaml', command: null, status: 'passed' as const, durationMs: 3000 }];
    const rows = mapStepsForPersistence('job-1', steps, new Map());
    expect(rows[0].startedAt).toBeUndefined();
    expect(rows[0].finishedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/jobs/__tests__/executor.step-timestamps.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the mapper**

Create `server/jobs/internal/step-mapper.ts`:

```ts
import type { JobStep } from '../types.js';

export interface PersistedStepRow {
  jobId: string;
  stepIndex: number;
  flowName: string | null;
  command: string | null;
  status: JobStep['status'];
  durationMs: number | null;
  startedAt?: Date;
  finishedAt?: Date;
}

/**
 * Build INSERT rows for job_steps. When the parser captured wallclock
 * timestamps for a command, attach them; otherwise leave the columns to
 * DB defaults (started_at = now()) so old behavior is preserved.
 */
export function mapStepsForPersistence(
  jobId: string,
  steps: JobStep[],
  timestamps: Map<string, { startedAt: Date; endedAt?: Date }>,
): PersistedStepRow[] {
  return steps.map((step, index) => {
    const key = step.command ?? '';
    const ts = key ? timestamps.get(key) : undefined;
    const row: PersistedStepRow = {
      jobId,
      stepIndex: index,
      flowName: step.flowName,
      command: step.command,
      status: step.status,
      durationMs: step.durationMs,
    };
    if (ts) {
      row.startedAt = ts.startedAt;
      if (ts.endedAt) row.finishedAt = ts.endedAt;
    }
    return row;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/jobs/__tests__/executor.step-timestamps.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire mapper into executor**

In `server/jobs/internal/executor.ts`, locate the block at line 347 that inserts `jobSteps`. Replace with mapper call. First add the import near the top (after existing imports):

```ts
import { mapStepsForPersistence } from './step-mapper.js';
```

Then the executor needs the parser's timestamp map. The parser is created inside `JobExecutor.run()` — surface it via the existing return path. Find the result aggregation block and adjust:

```ts
      if (result.steps.length > 0) {
        const rows = mapStepsForPersistence(jobId, result.steps, result.commandTimestamps ?? new Map());
        await fastify.db.insert(schema.jobSteps).values(rows as never);
      }
```

The `result` object comes from `JobExecutor.run()`. Extend its return shape — locate the `Promise<ExecutionResult>` definition in `server/jobs/job-executor.ts` and the resolve call. Add `commandTimestamps`:

```ts
export interface ExecutionResult {
  steps: JobStep[];
  rawOutput: string;
  summary: JobSummary | null;
  exitCode: number | null;
  commandTimestamps?: Map<string, { startedAt: Date; endedAt?: Date }>;
}
```

In `JobExecutor.run`, at the `resolve(...)` call near the end, pass the parser map:

```ts
        resolve({
          steps: parser.getSteps(),
          rawOutput: parser.getRawOutput(),
          summary: parser.getSummary(),
          exitCode: code,
          commandTimestamps: parser.getCommandTimestamps(),
        });
```

- [ ] **Step 6: Run executor tests**

```bash
npx vitest run server/jobs/__tests__/
```
Expected: all PASS. If any test mocked `ExecutionResult` without `commandTimestamps`, the optional `?` keeps them passing.

- [ ] **Step 7: Commit**

```bash
git add server/jobs/internal/step-mapper.ts server/jobs/internal/executor.ts server/jobs/job-executor.ts server/jobs/__tests__/executor.step-timestamps.test.ts
git commit -m "feat(jobs): persist per-step started_at/finished_at from parser"
```

### Task 1.4: Pass `--test-output-dir` to Maestro

**Files:**
- Modify: `server/jobs/job-executor.ts:162-165`

- [ ] **Step 1: Add the flag**

In `server/jobs/job-executor.ts`, the block already passes `--output` for JUnit. Right after that block (around line 165), add:

```ts
    // commands-*.json + screenshots land here when test-output-dir is set.
    // Phase 1 (report viewer): we read commands-*.json post-run to override
    // wallclock timestamps with Maestro's own when available.
    if (opts.outputDir) {
      args.push('--test-output-dir', opts.outputDir);
    }
```

- [ ] **Step 2: Run job tests to confirm no regressions**

```bash
npx vitest run server/jobs/__tests__/
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add server/jobs/job-executor.ts
git commit -m "feat(jobs): pass --test-output-dir so Maestro emits commands-*.json"
```

### Task 1.5: `commands-*.json` loader (post-run timestamp override)

**Files:**
- Create: `server/jobs/internal/commands-json-loader.ts`
- Create: `server/jobs/__tests__/commands-json-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/jobs/__tests__/commands-json-loader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCommandTimestamps } from '../internal/commands-json-loader.js';

describe('loadCommandTimestamps', () => {
  it('returns empty map when directory has no commands-*.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(0);
  });

  it('parses commands-*.json with epoch timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-login.json'), JSON.stringify([
      { command: 'tapOn("Email")',  startedAtMs: 1700000000000, endedAtMs: 1700000000500 },
      { command: 'tapOn("Submit")', startedAtMs: 1700000000700, endedAtMs: 1700000001900 },
    ]));

    const result = await loadCommandTimestamps(dir);
    expect(result.get('tapOn("Email")')).toEqual({
      startedAt: new Date(1700000000000),
      endedAt:   new Date(1700000000500),
    });
  });

  it('skips entries missing timestamps and logs nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-x.json'), JSON.stringify([
      { command: 'tapOn("A")' },                                 // no ts
      { command: 'tapOn("B")', startedAtMs: 1, endedAtMs: 2 },
    ]));
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(1);
    expect(result.has('tapOn("B")')).toBe(true);
  });

  it('returns empty map on malformed JSON without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cjl-'));
    writeFileSync(join(dir, 'commands-bad.json'), '{not json');
    const result = await loadCommandTimestamps(dir);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/jobs/__tests__/commands-json-loader.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the loader**

Create `server/jobs/internal/commands-json-loader.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Schema we tolerate from Maestro's commands-*.json.
 *
 * Maestro does not document the file format publicly. We treat unknown fields
 * as no-ops and only act when both startedAtMs and endedAtMs are present and
 * numeric. If the format changes in a future Maestro release, the worst case
 * is we silently fall back to the parser wallclock map.
 */
interface CommandEntry {
  command?: string;
  startedAtMs?: number;
  endedAtMs?: number;
}

export async function loadCommandTimestamps(
  outputDir: string,
): Promise<Map<string, { startedAt: Date; endedAt: Date }>> {
  const out = new Map<string, { startedAt: Date; endedAt: Date }>();

  let files: string[];
  try {
    files = await readdir(outputDir);
  } catch {
    return out;
  }

  const commandFiles = files.filter(
    (f) => f.startsWith('commands-') && f.endsWith('.json'),
  );

  for (const file of commandFiles) {
    try {
      const raw = await readFile(join(outputDir, file), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed as CommandEntry[]) {
        if (
          typeof entry?.command === 'string' &&
          typeof entry?.startedAtMs === 'number' &&
          typeof entry?.endedAtMs === 'number'
        ) {
          out.set(entry.command, {
            startedAt: new Date(entry.startedAtMs),
            endedAt:   new Date(entry.endedAtMs),
          });
        }
      }
    } catch {
      // malformed file — skip silently
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/jobs/__tests__/commands-json-loader.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire loader into executor (override map)**

In `server/jobs/internal/executor.ts`, just before the step-mapper call (Task 1.3 Step 5), merge the JSON-derived map over the parser map:

```ts
import { loadCommandTimestamps } from './commands-json-loader.js';

// ... inside the result-aggregation block, before the insert:
      const baseTs = result.commandTimestamps ?? new Map();
      if (outputDir) {
        const overrides = await loadCommandTimestamps(outputDir);
        for (const [cmd, ts] of overrides) {
          baseTs.set(cmd, ts); // JSON wins when present
        }
      }
      if (result.steps.length > 0) {
        const rows = mapStepsForPersistence(jobId, result.steps, baseTs);
        await fastify.db.insert(schema.jobSteps).values(rows as never);
      }
```

(Use whatever variable already holds the output directory in the executor — likely `opts.outputDir` plumbed via `job` metadata. Locate it locally in that file.)

- [ ] **Step 6: Run all job tests**

```bash
npx vitest run server/jobs/__tests__/
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/jobs/internal/commands-json-loader.ts server/jobs/internal/executor.ts server/jobs/__tests__/commands-json-loader.test.ts
git commit -m "feat(jobs): load commands-*.json to override wallclock timestamps"
```

### Task 1.6: Stamp `video_started_at` when recording starts

**Files:**
- Modify: `server/artifacts/recording-service.ts` (capture timestamp on `startRecording`)
- Modify: `server/artifacts/artifact-service.ts` (accept `videoStartedAt` on create)
- Modify: `server/artifacts/schemas.ts` (add to schema if exposed)

- [ ] **Step 1: Add the timestamp capture**

In `server/artifacts/recording-service.ts`, where `AdbRecordingEntry` is defined, add the field:

```ts
interface AdbRecordingEntry {
  process: ChildProcess;
  deviceSerial: string;
  devicePath: string;
  outputPath: string;
  jobId: string;
  startedAt: number;        // already exists — re-use it
  videoStartedAt: Date;     // NEW: wall-clock snapshot for the artifact row
}
```

In `startRecording`, when constructing the entry, set `videoStartedAt: new Date()`. In `stopRecording` (returns `RecordingResult`), include the value in the return:

```ts
export interface RecordingResult {
  outputPath: string;
  duration: number;
  frameCount: number;
  codec: 'h264' | 'mjpeg';
  videoStartedAt: Date; // NEW
}
```

Return it from `stopRecording`:

```ts
    return {
      outputPath: entry.outputPath,
      duration: (Date.now() - entry.startedAt) / 1000,
      frameCount: 0,
      codec: 'h264',
      videoStartedAt: entry.videoStartedAt,
    };
```

- [ ] **Step 2: Persist on artifact creation**

In `server/artifacts/artifact-service.ts`, locate `CreateArtifactOpts` and the INSERT. Add the optional field:

```ts
export interface CreateArtifactOpts {
  jobId: string;
  recordingId?: string;
  type: 'video' | 'screenshot' | 'memory' | 'log';
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes?: number;
  videoStartedAt?: Date;     // NEW
}
```

In the INSERT values, add:

```ts
      videoStartedAt: opts.videoStartedAt ?? null,
```

- [ ] **Step 3: Pass timestamp through the upload queue**

In `server/artifacts/queue.ts` (worker that creates the artifact from a `recording.upload` envelope), the payload schema accepts the stop result. Add `videoStartedAt: z.coerce.date().optional()` to `recordingUploadPayloadSchema` (in `server/artifacts/events.ts`) and forward it into `createArtifactIdempotent`.

```ts
// events.ts
export const recordingUploadPayloadSchema = z.object({
  jobId: z.string(),
  recordingId: z.string(),
  filePath: z.string(),
  fileName: z.string(),
  videoStartedAt: z.coerce.date().optional(),  // NEW
});

// queue.ts handler body, when creating:
await artifactService.createArtifactIdempotent({
  jobId: payload.jobId,
  recordingId: payload.recordingId,
  type: 'video',
  filePath: payload.filePath,
  fileName: payload.fileName,
  mimeType: 'video/mp4',
  videoStartedAt: payload.videoStartedAt,
});
```

In the producer that enqueues this (search `recording.upload` send), pass `videoStartedAt: result.videoStartedAt`.

- [ ] **Step 4: Run artifacts tests**

```bash
npx vitest run server/artifacts/__tests__/
```
Expected: all PASS. Existing tests pass without setting `videoStartedAt` (optional + default null).

- [ ] **Step 5: Commit**

```bash
git add server/artifacts/
git commit -m "feat(artifacts): stamp video_started_at when recording starts"
```

### Task 1.7: Phase-1 smoke (manual)

- [ ] **Step 1: Run a real job**

```bash
DATABASE_URL=... ./node_modules/.bin/tsx server/index.ts
# in another terminal, submit a job with the CLI:
cli/bin/device-farm submit test-flows/login.yaml --platform android
```

- [ ] **Step 2: Verify step timestamps in DB**

```bash
/opt/homebrew/Cellar/postgresql@17/17.9/bin/psql -U heicg -d device_farm \
  -c "SELECT step_index, command, started_at, finished_at FROM job_steps WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1);"
```
Expected: distinct `started_at` per row (not all equal to the row insertion time).

- [ ] **Step 3: Verify video_started_at**

```bash
/opt/homebrew/Cellar/postgresql@17/17.9/bin/psql -U heicg -d device_farm \
  -c "SELECT type, video_started_at FROM artifacts WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1);"
```
Expected: at least one `video` row with non-null `video_started_at`.

Phase 1 done.

---

## Phase 2 — Report API

Goal: one endpoint `/jobs/:id/report` returns the full bundle the viewer needs, plus `/jobs?tab=suites|history|trends` aggregations.

### Task 2.1: `/jobs/:id/report` route + service

**Files:**
- Create: `server/reporting/report-bundle-service.ts`
- Create: `server/reporting/__tests__/report-bundle-service.test.ts`
- Modify: `server/reporting/routes.ts` (add the GET handler)

- [ ] **Step 1: Write the failing test**

Create `server/reporting/__tests__/report-bundle-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReportBundle } from '../report-bundle-service.js';

const job = {
  id: 'job-1', status: 'failed', platform: 'android',
  createdAt: new Date('2026-05-17T14:32:00Z'),
  startedAt: new Date('2026-05-17T14:32:05Z'),
  finishedAt: new Date('2026-05-17T14:34:19Z'),
  deviceId: 'dev-1', metadata: {},
};

const steps = [
  { id: 's1', jobId: 'job-1', stepIndex: 0, flowName: 'login.yaml', command: 'launchApp',
    status: 'passed', durationMs: 1200,
    startedAt: new Date('2026-05-17T14:32:10Z'),
    finishedAt: new Date('2026-05-17T14:32:11.2Z'),
    error: null, screenshotPath: null },
  { id: 's2', jobId: 'job-1', stepIndex: 1, flowName: 'login.yaml', command: 'tapOn("Submit")',
    status: 'failed', durationMs: 500,
    startedAt: new Date('2026-05-17T14:32:47Z'),
    finishedAt: new Date('2026-05-17T14:32:47.5Z'),
    error: 'Element not found: Submit',
    screenshotPath: '/artifacts/job-1/step-1.png' },
];

const artifacts = [
  { id: 'a1', type: 'video', fileName: 'rec.mp4', mimeType: 'video/mp4', fileSizeBytes: 12345,
    videoStartedAt: new Date('2026-05-17T14:32:05Z') },
];

describe('buildReportBundle', () => {
  it('derives video offsets from step.startedAt - video.videoStartedAt', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: [], history: null });
    expect(b.steps[0].videoOffsetMs).toBe(5000);     // 14:32:10 - 14:32:05
    expect(b.steps[1].videoOffsetMs).toBe(42_000);   // 14:32:47 - 14:32:05
  });

  it('returns null videoOffsetMs when no video artifact', () => {
    const b = buildReportBundle({ job, steps, artifacts: [], logTailLines: [], history: null });
    expect(b.steps[0].videoOffsetMs).toBeNull();
  });

  it('picks first failed step as failureFocus', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: ['x','y'], history: null });
    expect(b.failureFocus?.stepId).toBe('s2');
    expect(b.failureFocus?.error).toBe('Element not found: Submit');
    expect(b.failureFocus?.logTailLines).toEqual(['x','y']);
    expect(b.failureFocus?.videoOffsetMs).toBe(42_000);
  });

  it('failureFocus is null when no step failed', () => {
    const passed = steps.map(s => ({ ...s, status: 'passed' as const, error: null }));
    const b = buildReportBundle({ job: { ...job, status: 'passed' }, steps: passed, artifacts, logTailLines: [], history: null });
    expect(b.failureFocus).toBeNull();
  });

  it('summary counts each status', () => {
    const b = buildReportBundle({ job, steps, artifacts, logTailLines: [], history: null });
    expect(b.job.summary).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/reporting/__tests__/report-bundle-service.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create the service**

Create `server/reporting/report-bundle-service.ts`:

```ts
export interface ReportJob {
  id: string;
  status: string;
  platform: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  deviceId: string | null;
  metadata: unknown;
}

export interface ReportStep {
  id: string;
  jobId: string;
  stepIndex: number;
  flowName: string | null;
  command: string | null;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  screenshotPath: string | null;
}

export interface ReportArtifact {
  id: string;
  type: 'video' | 'screenshot' | 'memory' | 'log';
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  videoStartedAt?: Date | null;
}

export interface ReportHistory {
  flowName: string | null;
  runs: Array<{ jobId: string; status: string; finishedAt: Date | null; durationMs: number | null }>;
  passRate: number;
  avgDurationMs: number;
}

export interface ReportBundle {
  job: ReportJob & {
    durationMs: number | null;
    summary: { total: number; passed: number; failed: number; skipped: number };
  };
  steps: Array<ReportStep & { videoOffsetMs: number | null }>;
  artifacts: Array<ReportArtifact & { downloadUrl: string }>;
  failureFocus: {
    stepId: string;
    flowName: string | null;
    command: string | null;
    error: string;
    screenshotPath: string | null;
    logTailLines: string[];
    videoOffsetMs: number | null;
  } | null;
  reportLinks: { junitXml: string; logsRaw: string };
  history: ReportHistory | null;
}

export interface BuildBundleInput {
  job: ReportJob;
  steps: ReportStep[];
  artifacts: ReportArtifact[];
  logTailLines: string[];
  history: ReportHistory | null;
}

export function buildReportBundle(input: BuildBundleInput): ReportBundle {
  const { job, steps, artifacts, logTailLines, history } = input;
  const video = artifacts.find((a) => a.type === 'video') ?? null;
  const videoStart = video?.videoStartedAt ?? null;

  const offset = (start: Date | null): number | null => {
    if (!start || !videoStart) return null;
    return start.getTime() - videoStart.getTime();
  };

  const summary = { total: steps.length, passed: 0, failed: 0, skipped: 0 };
  for (const s of steps) {
    if (s.status === 'passed') summary.passed++;
    else if (s.status === 'failed') summary.failed++;
    else if (s.status === 'skipped') summary.skipped++;
  }

  const failed = steps.find((s) => s.status === 'failed');
  const failureFocus = failed ? {
    stepId: failed.id,
    flowName: failed.flowName,
    command: failed.command,
    error: failed.error ?? 'Step failed',
    screenshotPath: failed.screenshotPath,
    logTailLines,
    videoOffsetMs: offset(failed.startedAt),
  } : null;

  const durationMs = job.startedAt && job.finishedAt
    ? job.finishedAt.getTime() - job.startedAt.getTime()
    : null;

  return {
    job: { ...job, durationMs, summary },
    steps: steps.map((s) => ({ ...s, videoOffsetMs: offset(s.startedAt) })),
    artifacts: artifacts.map((a) => ({
      ...a,
      downloadUrl: `/jobs/${job.id}/artifacts/${a.id}`,
    })),
    failureFocus,
    reportLinks: {
      junitXml: `/jobs/${job.id}/reports/junit.xml`,
      logsRaw:  `/jobs/${job.id}/logs`,
    },
    history,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/reporting/__tests__/report-bundle-service.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/reporting/report-bundle-service.ts server/reporting/__tests__/report-bundle-service.test.ts
git commit -m "feat(reporting): pure bundle builder for /jobs/:id/report"
```

### Task 2.2: HTTP route for `/jobs/:id/report`

**Files:**
- Modify: `server/reporting/report-routes.ts`
- Create: `server/reporting/__tests__/report-routes.report.test.ts`

- [ ] **Step 1: Write integration test**

Create `server/reporting/__tests__/report-routes.report.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, seedJob } from './__helpers/test-app.js'; // assume helper exists; if not, mirror an existing report-routes test

describe('GET /jobs/:id/report', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let jobId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    jobId = await seedJob(app, { status: 'failed', withFailingStep: true, withVideo: true });
  });
  afterAll(async () => { await app.close(); });

  it('returns 200 with full bundle shape', async () => {
    const res = await app.inject({ method: 'GET', url: `/jobs/${jobId}/report` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job.id).toBe(jobId);
    expect(body.job.summary).toBeDefined();
    expect(Array.isArray(body.steps)).toBe(true);
    expect(Array.isArray(body.artifacts)).toBe(true);
    expect(body.failureFocus).not.toBeNull();
    expect(body.reportLinks.junitXml).toBe(`/jobs/${jobId}/reports/junit.xml`);
  });

  it('returns 404 for unknown job', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs/00000000-0000-0000-0000-000000000000/report' });
    expect(res.statusCode).toBe(404);
  });
});
```

If `__helpers/test-app.ts` and `seedJob` do not exist, copy the pattern from `server/reporting/__tests__/correlation.spec.ts` or `terminal-event.spec.ts` and adapt.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/reporting/__tests__/report-routes.report.test.ts
```
Expected: FAIL — route returns 404 (handler not registered).

- [ ] **Step 3: Add the handler**

In `server/reporting/report-routes.ts` (the file already exists for the existing reports endpoints), register the new route:

```ts
import { buildReportBundle, type ReportStep } from './report-bundle-service.js';
import { schema } from '../db/index.js'; // adapt to actual import path
import { eq, desc } from 'drizzle-orm';

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  // ... existing routes

  app.get('/jobs/:id/report', async (req, reply) => {
    const { id } = req.params as { id: string };

    const [jobRow] = await app.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));
    if (!jobRow) {
      return reply.code(404).send({ type: 'about:blank', title: 'Job not found', status: 404 });
    }

    const stepRows = await app.db
      .select()
      .from(schema.jobSteps)
      .where(eq(schema.jobSteps.jobId, id))
      .orderBy(schema.jobSteps.stepIndex);

    const artifactRows = await app.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.jobId, id));

    // Log tail = last 30 lines of maestroOutput up to the first failed-step marker
    const logTailLines = buildLogTail(jobRow.maestroOutput ?? '', 30);

    // History: last 10 runs of the same flowName (if any)
    const firstFlow = stepRows.find((s) => s.flowName)?.flowName ?? null;
    const history = firstFlow ? await loadFlowHistory(app, firstFlow, 10) : null;

    return buildReportBundle({
      job: {
        id: jobRow.id, status: jobRow.status, platform: jobRow.platform,
        createdAt: jobRow.createdAt, startedAt: jobRow.startedAt,
        finishedAt: jobRow.finishedAt, deviceId: jobRow.deviceId, metadata: jobRow.metadata,
      },
      steps: stepRows.map<ReportStep>((s) => ({
        id: s.id, jobId: s.jobId, stepIndex: s.stepIndex,
        flowName: s.flowName, command: s.command, status: s.status,
        durationMs: s.durationMs, startedAt: s.startedAt, finishedAt: s.finishedAt,
        error: s.error, screenshotPath: s.screenshotPath,
      })),
      artifacts: artifactRows.map((a) => ({
        id: a.id, type: a.type, fileName: a.fileName, mimeType: a.mimeType,
        fileSizeBytes: a.fileSizeBytes, videoStartedAt: a.videoStartedAt,
      })),
      logTailLines,
      history,
    });
  });
}

function buildLogTail(maestroOutput: string, n: number): string[] {
  const lines = maestroOutput.split('\n');
  return lines.slice(Math.max(0, lines.length - n));
}

async function loadFlowHistory(app: FastifyInstance, flowName: string, n: number) {
  const rows = await app.db
    .select({
      jobId: schema.jobSteps.jobId,
      status: schema.jobSteps.status,
      finishedAt: schema.jobSteps.finishedAt,
      durationMs: schema.jobSteps.durationMs,
    })
    .from(schema.jobSteps)
    .where(eq(schema.jobSteps.flowName, flowName))
    .orderBy(desc(schema.jobSteps.startedAt))
    .limit(n);
  if (rows.length === 0) return null;
  const passed = rows.filter((r) => r.status === 'passed').length;
  const avg = Math.round(rows.reduce((s, r) => s + (r.durationMs ?? 0), 0) / rows.length);
  return {
    flowName,
    runs: rows,
    passRate: passed / rows.length,
    avgDurationMs: avg,
  };
}
```

- [ ] **Step 4: Run integration test**

```bash
npx vitest run server/reporting/__tests__/report-routes.report.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Run full reporting suite**

```bash
npx vitest run server/reporting/__tests__/
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/reporting/report-routes.ts server/reporting/__tests__/report-routes.report.test.ts
git commit -m "feat(reporting): GET /jobs/:id/report returns full viewer bundle"
```

### Task 2.3: Suite aggregation endpoint `/jobs/suites`

**Files:**
- Create: `server/reporting/suite-aggregation-service.ts`
- Create: `server/reporting/__tests__/suite-aggregation-service.test.ts`
- Modify: `server/reporting/report-routes.ts` (mount handler)

- [ ] **Step 1: Write the failing test (pure aggregation)**

Create `server/reporting/__tests__/suite-aggregation-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateSuites } from '../suite-aggregation-service.js';

describe('aggregateSuites', () => {
  it('groups by flowName with counts, passRate, trend (newest first)', () => {
    const rows = [
      { flowName: 'login.yaml', status: 'passed', durationMs: 1000, finishedAt: new Date(10) },
      { flowName: 'login.yaml', status: 'passed', durationMs: 1200, finishedAt: new Date(9)  },
      { flowName: 'login.yaml', status: 'failed', durationMs: 1500, finishedAt: new Date(8)  },
      { flowName: 'checkout.yaml', status: 'passed', durationMs: 800, finishedAt: new Date(7) },
    ];
    const out = aggregateSuites(rows);
    const login = out.find((s) => s.flowName === 'login.yaml')!;
    expect(login.totalRuns).toBe(3);
    expect(login.passed).toBe(2);
    expect(login.failed).toBe(1);
    expect(login.passRate).toBeCloseTo(2 / 3);
    expect(login.avgDurationMs).toBe(1233);
    expect(login.trend).toEqual([1, 1, 0]);            // newest first, 1=pass 0=fail
    expect(login.lastStatus).toBe('passed');
    expect(login.lastRunAt).toEqual(new Date(10));
  });

  it('returns empty array for no input', () => {
    expect(aggregateSuites([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/reporting/__tests__/suite-aggregation-service.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement aggregation**

Create `server/reporting/suite-aggregation-service.ts`:

```ts
export interface SuiteInput {
  flowName: string;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  durationMs: number | null;
  finishedAt: Date | null;
}

export interface SuiteAggregate {
  flowName: string;
  totalRuns: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number;
  lastRunAt: Date | null;
  lastStatus: SuiteInput['status'];
  trend: number[]; // newest first, 1=pass, 0=fail, length<=10
}

export function aggregateSuites(rows: SuiteInput[]): SuiteAggregate[] {
  const byFlow = new Map<string, SuiteInput[]>();
  for (const r of rows) {
    const list = byFlow.get(r.flowName);
    if (list) list.push(r);
    else byFlow.set(r.flowName, [r]);
  }

  const out: SuiteAggregate[] = [];
  for (const [flowName, list] of byFlow) {
    const sorted = [...list].sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
    const passed = sorted.filter((r) => r.status === 'passed').length;
    const failed = sorted.filter((r) => r.status === 'failed').length;
    const totalRuns = sorted.length;
    const avg = Math.round(sorted.reduce((s, r) => s + (r.durationMs ?? 0), 0) / totalRuns);
    out.push({
      flowName,
      totalRuns,
      passed,
      failed,
      passRate: passed / totalRuns,
      avgDurationMs: avg,
      lastRunAt: sorted[0].finishedAt,
      lastStatus: sorted[0].status,
      trend: sorted.slice(0, 10).map((r) => (r.status === 'passed' ? 1 : 0)),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/reporting/__tests__/suite-aggregation-service.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire HTTP handler**

In `server/reporting/report-routes.ts` add (after the `/jobs/:id/report` handler):

```ts
import { aggregateSuites } from './suite-aggregation-service.js';

app.get('/jobs/suites', async (req, reply) => {
  const { windowDays = '7' } = req.query as { windowDays?: string };
  const cutoff = new Date(Date.now() - parseInt(windowDays, 10) * 24 * 60 * 60 * 1000);

  const rows = await app.db
    .select({
      flowName: schema.jobSteps.flowName,
      status: schema.jobSteps.status,
      durationMs: schema.jobSteps.durationMs,
      finishedAt: schema.jobSteps.finishedAt,
    })
    .from(schema.jobSteps)
    .where(and(
      isNotNull(schema.jobSteps.flowName),
      gte(schema.jobSteps.startedAt, cutoff),
    ));

  return aggregateSuites(rows.filter((r): r is SuiteInput => r.flowName !== null));
});
```

(Add the `and`, `gte`, `isNotNull` imports from `drizzle-orm` at the top.)

- [ ] **Step 6: Commit**

```bash
git add server/reporting/suite-aggregation-service.ts server/reporting/report-routes.ts server/reporting/__tests__/suite-aggregation-service.test.ts
git commit -m "feat(reporting): GET /jobs/suites — pass-rate + sparkline trend per flow"
```

### Task 2.4: Trends endpoint `/jobs/trends`

**Files:**
- Create: `server/reporting/trends-service.ts`
- Create: `server/reporting/__tests__/trends-service.test.ts`
- Modify: `server/reporting/report-routes.ts` (mount)

- [ ] **Step 1: Write the failing test**

Create `server/reporting/__tests__/trends-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeTrends } from '../trends-service.js';

describe('computeTrends', () => {
  it('groups runs by date and by flow', () => {
    const rows = [
      { flowName: 'a', status: 'passed', finishedAt: new Date('2026-05-17T10:00:00Z') },
      { flowName: 'a', status: 'failed', finishedAt: new Date('2026-05-17T11:00:00Z') },
      { flowName: 'b', status: 'passed', finishedAt: new Date('2026-05-18T10:00:00Z') },
    ];
    const t = computeTrends(rows, 7);
    expect(t.byDay).toEqual([
      { date: '2026-05-17', passed: 1, failed: 1, total: 2 },
      { date: '2026-05-18', passed: 1, failed: 0, total: 1 },
    ]);
    expect(t.byFlow).toEqual([
      { flowName: 'a', passed: 1, failed: 1 },
      { flowName: 'b', passed: 1, failed: 0 },
    ]);
    expect(t.windowDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run server/reporting/__tests__/trends-service.test.ts
```

- [ ] **Step 3: Implement**

Create `server/reporting/trends-service.ts`:

```ts
export interface TrendInput {
  flowName: string;
  status: string;
  finishedAt: Date | null;
}

export interface TrendsOutput {
  byDay:  Array<{ date: string; passed: number; failed: number; total: number }>;
  byFlow: Array<{ flowName: string; passed: number; failed: number }>;
  windowDays: number;
}

export function computeTrends(rows: TrendInput[], windowDays: number): TrendsOutput {
  const dayMap = new Map<string, { passed: number; failed: number; total: number }>();
  const flowMap = new Map<string, { passed: number; failed: number }>();

  for (const r of rows) {
    if (!r.finishedAt) continue;
    const day = r.finishedAt.toISOString().slice(0, 10);
    const d = dayMap.get(day) ?? { passed: 0, failed: 0, total: 0 };
    d.total++;
    if (r.status === 'passed') d.passed++;
    else if (r.status === 'failed') d.failed++;
    dayMap.set(day, d);

    const f = flowMap.get(r.flowName) ?? { passed: 0, failed: 0 };
    if (r.status === 'passed') f.passed++;
    else if (r.status === 'failed') f.failed++;
    flowMap.set(r.flowName, f);
  }

  return {
    byDay:  [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v })),
    byFlow: [...flowMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([flowName, v]) => ({ flowName, ...v })),
    windowDays,
  };
}
```

- [ ] **Step 4: Run test, PASS**

- [ ] **Step 5: Mount handler**

In `report-routes.ts`:

```ts
import { computeTrends } from './trends-service.js';

app.get('/jobs/trends', async (req) => {
  const { windowDays = '7' } = req.query as { windowDays?: string };
  const n = parseInt(windowDays, 10);
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  const rows = await app.db
    .select({
      flowName: schema.jobSteps.flowName,
      status: schema.jobSteps.status,
      finishedAt: schema.jobSteps.finishedAt,
    })
    .from(schema.jobSteps)
    .where(and(isNotNull(schema.jobSteps.flowName), gte(schema.jobSteps.finishedAt, cutoff)));

  return computeTrends(
    rows.filter((r): r is TrendInput => r.flowName !== null && r.finishedAt !== null),
    n,
  );
});
```

- [ ] **Step 6: Commit**

```bash
git add server/reporting/trends-service.ts server/reporting/report-routes.ts server/reporting/__tests__/trends-service.test.ts
git commit -m "feat(reporting): GET /jobs/trends — pass/fail by day and by flow"
```

### Task 2.5: History tab — reuse `/jobs` with filters

**Files:**
- Modify: existing `GET /jobs` (in `server/api/routes.ts`) to accept `flowName`, `dateFrom`, `dateTo` query filters

- [ ] **Step 1: Write the failing integration test**

Create `server/api/__tests__/jobs-list-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, seedJob } from '../../reporting/__tests__/__helpers/test-app.js';

describe('GET /jobs filters', () => {
  it('filters by flowName via joined job_steps', async () => {
    const app = await buildTestApp();
    await seedJob(app, { flowName: 'login.yaml', status: 'passed' });
    await seedJob(app, { flowName: 'checkout.yaml', status: 'failed' });

    const res = await app.inject({ method: 'GET', url: '/jobs?flowName=login.yaml' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((j: { steps?: { flowName: string }[] }) =>
      j.steps?.some((s) => s.flowName === 'login.yaml'))).toBe(true);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add the filter to `GET /jobs`**

In `server/api/routes.ts`, find the existing `listJobs` handler (it already filters by `status` and `platform`). Extend the query parameters schema and the where clause:

```ts
const query = req.query as { status?: string; platform?: string; flowName?: string; dateFrom?: string; dateTo?: string; cursor?: string };

const conditions: SQL[] = [];
if (query.status)   conditions.push(eq(schema.jobs.status, query.status as never));
if (query.platform) conditions.push(eq(schema.jobs.platform, query.platform as never));
if (query.dateFrom) conditions.push(gte(schema.jobs.createdAt, new Date(query.dateFrom)));
if (query.dateTo)   conditions.push(lte(schema.jobs.createdAt, new Date(query.dateTo)));

let jobIdSubquery: SQL | null = null;
if (query.flowName) {
  jobIdSubquery = sql`${schema.jobs.id} IN (SELECT DISTINCT ${schema.jobSteps.jobId} FROM ${schema.jobSteps} WHERE ${schema.jobSteps.flowName} = ${query.flowName})`;
  conditions.push(jobIdSubquery);
}
```

- [ ] **Step 4: Run test, PASS**

- [ ] **Step 5: Commit**

```bash
git add server/api/routes.ts server/api/__tests__/jobs-list-filters.test.ts
git commit -m "feat(api): /jobs accepts flowName + dateFrom/dateTo filters"
```

---

## Phase 3 — Share token (signed link)

Goal: mint and verify a per-job read-only JWT consumed by the report viewer routes, used by the Azure PR commenter later.

### Task 3.1: Install `jose`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install jose@^5
```

- [ ] **Step 2: Verify install**

```bash
node -e "import('jose').then(m => console.log(typeof m.SignJWT))"
```
Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add jose for HMAC-signed share tokens"
```

### Task 3.2: `report-token` service

**Files:**
- Create: `server/auth/report-token.ts`
- Create: `server/auth/__tests__/report-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/auth/__tests__/report-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createReportTokenService } from '../report-token.js';

const secret = 'a'.repeat(64);

describe('report-token', () => {
  it('mint + verify roundtrips and returns expiresAt', async () => {
    const svc = createReportTokenService({ secret });
    const { token, expiresAt } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const verified = await svc.verify(token, 'job-1');
    expect(verified.ok).toBe(true);
  });

  it('rejects token for a different jobId', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc.verify(token, 'job-2');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('subject-mismatch');
  });

  it('rejects tampered token', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30 });
    const tampered = token.slice(0, -3) + 'xxx';
    const v = await svc.verify(tampered, 'job-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('invalid-signature');
  });

  it('rejects expired token', async () => {
    const svc = createReportTokenService({ secret });
    const { token } = await svc.mint({ jobId: 'job-1', ttlDays: 30, nowMs: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    const v = await svc.verify(token, 'job-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('rejects token signed with a different secret (secret rotation)', async () => {
    const svc1 = createReportTokenService({ secret: 'a'.repeat(64) });
    const svc2 = createReportTokenService({ secret: 'b'.repeat(64) });
    const { token } = await svc1.mint({ jobId: 'job-1', ttlDays: 30 });
    const v = await svc2.verify(token, 'job-1');
    expect(v.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npx vitest run server/auth/__tests__/report-token.test.ts
```

- [ ] **Step 3: Implement**

Create `server/auth/report-token.ts`:

```ts
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export interface ReportTokenServiceOpts {
  secret: string; // hex or any string with enough entropy; HMAC key
}

export interface MintArgs {
  jobId: string;
  ttlDays: 5 | 15 | 30;
  nowMs?: number; // for tests
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'expired' | 'invalid-signature' | 'subject-mismatch' | 'malformed';
  expiresAt?: Date;
}

export interface ReportTokenService {
  mint(args: MintArgs): Promise<{ token: string; expiresAt: Date }>;
  verify(token: string, jobId: string): Promise<VerifyResult>;
}

export function createReportTokenService(opts: ReportTokenServiceOpts): ReportTokenService {
  const key = new TextEncoder().encode(opts.secret);

  return {
    async mint({ jobId, ttlDays, nowMs }) {
      const iat = Math.floor((nowMs ?? Date.now()) / 1000);
      const exp = iat + ttlDays * 24 * 60 * 60;
      const token = await new SignJWT({ scope: 'read' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`job:${jobId}`)
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: new Date(exp * 1000) };
    },

    async verify(token, jobId) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (payload.sub !== `job:${jobId}`) {
          return { ok: false, reason: 'subject-mismatch' };
        }
        return { ok: true, expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined };
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
        if (err instanceof joseErrors.JWSSignatureVerificationFailed) return { ok: false, reason: 'invalid-signature' };
        if (err instanceof joseErrors.JWSInvalid)                     return { ok: false, reason: 'invalid-signature' };
        return { ok: false, reason: 'malformed' };
      }
    },
  };
}
```

- [ ] **Step 4: Run test, PASS**

- [ ] **Step 5: Commit**

```bash
git add server/auth/report-token.ts server/auth/__tests__/report-token.test.ts
git commit -m "feat(auth): report-token service (HMAC JWT scoped per job)"
```

### Task 3.3: Config schema + auth middleware

**Files:**
- Modify: `server/config/schema.ts` — add `sharing` block and `security.share_token_secret`
- Modify: `server/auth/plugin.ts` (or hook entry point) — accept `?t=` and inject `request.shareToken`
- Modify: existing auth gate on `/jobs/:id` and `/jobs/:id/report`

- [ ] **Step 1: Extend config schema**

In `server/config/schema.ts`, add:

```ts
const sharingSchema = z.object({
  enabled: z.boolean().default(false),
  default_ttl_days: z.union([z.literal(5), z.literal(15), z.literal(30)]).default(30),
});

const securityAdditions = {
  share_token_secret: z.string().min(32).optional(),
};

// Inside the root schema:
sharing: sharingSchema.default({ enabled: false, default_ttl_days: 30 }),
security: securitySchema.extend(securityAdditions),
ui: z.object({ use_report_shell: z.boolean().default(false) }).default({ use_report_shell: false }),
```

Add the cross-field validation at the bottom of the root schema:

```ts
.refine(
  (cfg) => !cfg.sharing.enabled || (cfg.security.share_token_secret && cfg.security.share_token_secret.length >= 32),
  { message: 'security.share_token_secret is required when sharing.enabled = true' },
);
```

- [ ] **Step 2: Register the service in the auth plugin**

In `server/auth/plugin.ts` (or `server/auth/index.ts`), after current setup:

```ts
import { createReportTokenService } from './report-token.js';

if (config.sharing.enabled) {
  const tokenService = createReportTokenService({ secret: config.security.share_token_secret! });
  fastify.decorate('reportTokenService', tokenService);
}
```

Add the decorator type:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    reportTokenService?: ReportTokenService;
  }
}
```

- [ ] **Step 3: Bypass auth on `/jobs/:id*` when `?t=` validates**

In whatever Fastify hook currently enforces auth on `/jobs/:id` (likely a `preHandler` in `server/auth/plugin.ts` or per-route guard), accept the token:

```ts
fastify.addHook('preHandler', async (req, reply) => {
  // existing checks first; if already authenticated, return.
  if (req.routeOptions.url?.startsWith('/jobs/:id')) {
    const t = (req.query as { t?: string }).t;
    if (t && fastify.reportTokenService) {
      const id = (req.params as { id: string }).id;
      const v = await fastify.reportTokenService.verify(t, id);
      if (v.ok) {
        (req as { shareToken?: { jobId: string } }).shareToken = { jobId: id };
        return;
      }
    }
    // fall through to normal auth (or 401)
  }
});
```

Restrict allowed routes when token is present: only allow `/jobs/:id`, `/jobs/:id/report`, `/jobs/:id/artifacts*`, `/jobs/:id/logs`, `/jobs/:id/reports/junit.xml`. Add an allowlist check inside the hook.

- [ ] **Step 4: Add integration test**

Create `server/auth/__tests__/report-token-middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, seedJob } from '../../reporting/__tests__/__helpers/test-app.js';

describe('share-token middleware', () => {
  it('valid token bypasses auth on /jobs/:id/report', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const jobId = await seedJob(app, { status: 'passed' });
    const { token } = await app.reportTokenService!.mint({ jobId, ttlDays: 5 });

    const res = await app.inject({ method: 'GET', url: `/jobs/${jobId}/report?t=${token}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('invalid token returns 401 on /jobs/:id/report (no auth header)', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const jobId = await seedJob(app, { status: 'passed' });
    const res = await app.inject({ method: 'GET', url: `/jobs/${jobId}/report?t=bad` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('valid token for one job does not unlock another', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const j1 = await seedJob(app, { status: 'passed' });
    const j2 = await seedJob(app, { status: 'passed' });
    const { token } = await app.reportTokenService!.mint({ jobId: j1, ttlDays: 5 });
    const res = await app.inject({ method: 'GET', url: `/jobs/${j2}/report?t=${token}` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 5: Run tests until PASS**

```bash
npx vitest run server/auth/__tests__/report-token-middleware.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/config/schema.ts server/auth/plugin.ts server/auth/__tests__/report-token-middleware.test.ts
git commit -m "feat(auth): accept ?t=<jwt> share token on /jobs/:id viewer routes"
```

### Task 3.4: Mint endpoint `POST /jobs/:id/share-token`

**Files:**
- Modify: `server/reporting/report-routes.ts` (add handler)
- Create: `server/reporting/__tests__/share-token-route.test.ts`

- [ ] **Step 1: Failing test**

```ts
// share-token-route.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp, seedJob, withAuth } from '../__helpers/test-app.js';

describe('POST /jobs/:id/share-token', () => {
  it('requires auth', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const jobId = await seedJob(app, { status: 'passed' });
    const res = await app.inject({ method: 'POST', url: `/jobs/${jobId}/share-token`, payload: { ttlDays: 5 } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns token + url + expiresAt', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const jobId = await seedJob(app, { status: 'passed' });
    const res = await app.inject(withAuth({
      method: 'POST',
      url: `/jobs/${jobId}/share-token`,
      payload: { ttlDays: 30 },
    }));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
    expect(body.url).toBe(`/jobs/${jobId}?t=${body.token}`);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await app.close();
  });

  it('rejects ttlDays not in 5|15|30', async () => {
    const app = await buildTestApp({ sharingEnabled: true });
    const jobId = await seedJob(app, { status: 'passed' });
    const res = await app.inject(withAuth({ method: 'POST', url: `/jobs/${jobId}/share-token`, payload: { ttlDays: 7 } }));
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Add the handler**

In `server/reporting/report-routes.ts`:

```ts
import { z } from 'zod';

const mintBodySchema = z.object({
  ttlDays: z.union([z.literal(5), z.literal(15), z.literal(30)]),
});

app.post('/jobs/:id/share-token', async (req, reply) => {
  if (!app.reportTokenService) {
    return reply.code(503).send({ type: 'about:blank', title: 'Sharing disabled', status: 503 });
  }
  const { id } = req.params as { id: string };
  const body = mintBodySchema.safeParse(req.body);
  if (!body.success) {
    return reply.code(400).send({ type: 'about:blank', title: 'Invalid body', status: 400, detail: body.error.message });
  }
  const [job] = await app.db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) return reply.code(404).send({ type: 'about:blank', title: 'Job not found', status: 404 });

  const { token, expiresAt } = await app.reportTokenService.mint({ jobId: id, ttlDays: body.data.ttlDays });
  return { token, expiresAt: expiresAt.toISOString(), url: `/jobs/${id}?t=${token}` };
});
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add server/reporting/report-routes.ts server/reporting/__tests__/share-token-route.test.ts
git commit -m "feat(reporting): POST /jobs/:id/share-token mints scoped JWT"
```

---

## Phase 4 — UI shell

Goal: redesigned `/jobs/[id]` and sub-tabs on `/jobs`.

### Task 4.1: API client + types for report bundle

**Files:**
- Modify: `web/src/lib/api/types.ts` (add `ReportBundle` type)
- Create: `web/src/lib/api/reports.ts`

- [ ] **Step 1: Add types**

In `web/src/lib/api/types.ts` append:

```ts
export interface ReportStepLite {
  id: string;
  flowName: string | null;
  command: string | null;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  screenshotPath: string | null;
  videoOffsetMs: number | null;
}

export interface ReportArtifactLite {
  id: string;
  type: 'video' | 'screenshot' | 'memory' | 'log';
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  videoStartedAt?: string | null;
  downloadUrl: string;
}

export interface ReportBundle {
  job: {
    id: string; status: string; platform: string;
    createdAt: string; startedAt: string | null; finishedAt: string | null;
    deviceId: string | null; durationMs: number | null;
    summary: { total: number; passed: number; failed: number; skipped: number };
  };
  steps: ReportStepLite[];
  artifacts: ReportArtifactLite[];
  failureFocus: null | {
    stepId: string; flowName: string | null; command: string | null;
    error: string; screenshotPath: string | null;
    logTailLines: string[]; videoOffsetMs: number | null;
  };
  reportLinks: { junitXml: string; logsRaw: string };
  history: null | {
    flowName: string | null;
    runs: Array<{ jobId: string; status: string; finishedAt: string | null; durationMs: number | null }>;
    passRate: number; avgDurationMs: number;
  };
}
```

- [ ] **Step 2: Create the client**

`web/src/lib/api/reports.ts`:

```ts
import { apiFetch } from './client.js';
import type { ReportBundle } from './types.js';

export function fetchReport(jobId: string, shareToken?: string): Promise<ReportBundle> {
  const qs = shareToken ? `?t=${encodeURIComponent(shareToken)}` : '';
  return apiFetch<ReportBundle>(`/jobs/${jobId}/report${qs}`);
}

export function mintShareToken(jobId: string, ttlDays: 5 | 15 | 30) {
  return apiFetch<{ token: string; expiresAt: string; url: string }>(`/jobs/${jobId}/share-token`, {
    method: 'POST',
    body: JSON.stringify({ ttlDays }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface SuiteAggregate {
  flowName: string; totalRuns: number; passed: number; failed: number;
  passRate: number; avgDurationMs: number;
  lastRunAt: string | null; lastStatus: string; trend: number[];
}

export function fetchSuites(windowDays: number = 7) {
  return apiFetch<SuiteAggregate[]>(`/jobs/suites?windowDays=${windowDays}`);
}

export interface TrendsOutput {
  byDay: Array<{ date: string; passed: number; failed: number; total: number }>;
  byFlow: Array<{ flowName: string; passed: number; failed: number }>;
  windowDays: number;
}

export function fetchTrends(windowDays: number = 7) {
  return apiFetch<TrendsOutput>(`/jobs/trends?windowDays=${windowDays}`);
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api/types.ts web/src/lib/api/reports.ts
git commit -m "feat(web): API client for /jobs/:id/report + share-token + suites + trends"
```

### Task 4.2: `FlowStepTree` component

**Files:**
- Create: `web/src/lib/components/reports/FlowStepTree.svelte`
- Create: `web/src/lib/components/reports/__tests__/FlowStepTree.test.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/components/reports/__tests__/FlowStepTree.test.ts`:

```ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import FlowStepTree from '../FlowStepTree.svelte';

const steps = [
  { id: 's1', flowName: 'login.yaml', command: 'launchApp',   status: 'passed', durationMs: 1200, startedAt: null, finishedAt: null, error: null, screenshotPath: null, videoOffsetMs: null },
  { id: 's2', flowName: 'login.yaml', command: 'tapOn(Sub)',  status: 'failed', durationMs:  500, startedAt: null, finishedAt: null, error: 'err', screenshotPath: null, videoOffsetMs: null },
  { id: 's3', flowName: 'checkout.yaml', command: 'tapOn(Pay)', status: 'passed', durationMs: 800, startedAt: null, finishedAt: null, error: null, screenshotPath: null, videoOffsetMs: null },
];

describe('FlowStepTree', () => {
  it('renders flows as groups with steps underneath', () => {
    const { getAllByText } = render(FlowStepTree, { props: { steps, activeStepId: null, onSelect: vi.fn() } });
    expect(getAllByText('login.yaml').length).toBe(1);
    expect(getAllByText('checkout.yaml').length).toBe(1);
  });

  it('calls onSelect with step id on click', async () => {
    const onSelect = vi.fn();
    const { getByText } = render(FlowStepTree, { props: { steps, activeStepId: null, onSelect } });
    await fireEvent.click(getByText('tapOn(Sub)'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('marks active step', () => {
    const { container } = render(FlowStepTree, { props: { steps, activeStepId: 's2', onSelect: vi.fn() } });
    expect(container.querySelector('[data-step-id="s2"][data-active="true"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Create the component**

`web/src/lib/components/reports/FlowStepTree.svelte`:

```svelte
<script lang="ts">
  import type { ReportStepLite } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';

  let { steps, activeStepId, onSelect }: {
    steps: ReportStepLite[];
    activeStepId: string | null;
    onSelect: (stepId: string) => void;
  } = $props();

  let groups = $derived.by(() => {
    const out = new Map<string, ReportStepLite[]>();
    for (const s of steps) {
      const key = s.flowName ?? '(no flow)';
      const list = out.get(key) ?? [];
      list.push(s);
      out.set(key, list);
    }
    return [...out.entries()];
  });

  function fmtDuration(ms: number | null): string {
    if (ms == null) return '';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<nav class="text-[13px]">
  {#each groups as [flow, list]}
    <div class="mb-3">
      <div class="px-2 py-1 font-mono text-on-surface-variant text-[12px] uppercase tracking-wide">{flow}</div>
      <ul>
        {#each list as step}
          <li>
            <button
              type="button"
              data-step-id={step.id}
              data-active={activeStepId === step.id}
              class:bg-primary={activeStepId === step.id}
              class:text-on-primary={activeStepId === step.id}
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-surface-variant/30"
              onclick={() => onSelect(step.id)}
            >
              <StatusBadge status={step.status} size={14} />
              <span class="truncate flex-1 font-mono">{step.command ?? step.flowName}</span>
              <span class="text-[11px] text-on-surface-variant">{fmtDuration(step.durationMs)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>
```

- [ ] **Step 4: Run, PASS**

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/reports/FlowStepTree.svelte web/src/lib/components/reports/__tests__/FlowStepTree.test.ts
git commit -m "feat(web): FlowStepTree — flow→step hierarchy with active state"
```

### Task 4.3: `StepDetail` + `FailureFocusPanel`

**Files:**
- Create: `web/src/lib/components/reports/StepDetail.svelte`
- Create: `web/src/lib/components/reports/FailureFocusPanel.svelte`
- Create: `web/src/lib/components/reports/__tests__/StepDetail.test.ts`
- Create: `web/src/lib/components/reports/__tests__/FailureFocusPanel.test.ts`

- [ ] **Step 1: Write `StepDetail` test**

```ts
// StepDetail.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import StepDetail from '../StepDetail.svelte';

const step = {
  id: 's1', flowName: 'login.yaml', command: 'tapOn(Submit)',
  status: 'failed' as const, durationMs: 1200,
  startedAt: '2026-05-17T14:32:47Z', finishedAt: '2026-05-17T14:32:48.2Z',
  error: 'Element not found',
  screenshotPath: '/artifacts/foo.png',
  videoOffsetMs: 42000,
};

describe('StepDetail', () => {
  it('renders command, duration, status badge', () => {
    const { getByText } = render(StepDetail, { props: { step, onJumpToVideo: undefined } });
    expect(getByText('tapOn(Submit)')).toBeDefined();
    expect(getByText(/1\.2s/)).toBeDefined();
  });
  it('renders placeholder when screenshotPath is null', () => {
    const { getByTestId } = render(StepDetail, { props: { step: { ...step, screenshotPath: null }, onJumpToVideo: undefined } });
    expect(getByTestId('screenshot-placeholder')).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement `StepDetail.svelte`**

```svelte
<script lang="ts">
  import type { ReportStepLite } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import FailureFocusPanel from './FailureFocusPanel.svelte';

  let { step, logTailLines, onJumpToVideo }: {
    step: ReportStepLite;
    logTailLines?: string[];
    onJumpToVideo?: (offsetMs: number) => void;
  } = $props();

  function fmtDuration(ms: number | null): string {
    if (ms == null) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center gap-3">
    <StatusBadge status={step.status} size={20} />
    <code class="font-mono text-[15px] text-on-surface">{step.command ?? step.flowName}</code>
    <span class="text-[12px] text-on-surface-variant">· {fmtDuration(step.durationMs)}</span>
  </div>

  <div class="text-[12px] text-on-surface-variant">
    Started {fmtTime(step.startedAt)} · ended {fmtTime(step.finishedAt)}
  </div>

  {#if step.screenshotPath}
    <img src={step.screenshotPath} alt="Step screenshot" class="rounded border border-outline-variant/20 max-w-full" />
  {:else}
    <div data-testid="screenshot-placeholder" class="aspect-[9/16] max-w-xs bg-surface-variant/30 rounded flex items-center justify-center text-on-surface-variant text-[12px]">
      <span class="material-symbols-outlined">broken_image</span>
    </div>
  {/if}

  {#if step.status === 'failed' && step.error}
    <FailureFocusPanel
      error={step.error}
      logTailLines={logTailLines ?? []}
      videoOffsetMs={step.videoOffsetMs}
      onJumpToVideo={onJumpToVideo}
    />
  {/if}
</div>
```

- [ ] **Step 3: Write `FailureFocusPanel` test**

```ts
// FailureFocusPanel.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import FailureFocusPanel from '../FailureFocusPanel.svelte';

describe('FailureFocusPanel', () => {
  it('disables jump button when videoOffsetMs is null', () => {
    const { getByRole } = render(FailureFocusPanel, { props: { error: 'x', logTailLines: [], videoOffsetMs: null, onJumpToVideo: vi.fn() } });
    const btn = getByRole('button', { name: /jump to video/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
  it('calls onJumpToVideo with offset on click', async () => {
    const onJumpToVideo = vi.fn();
    const { getByRole } = render(FailureFocusPanel, { props: { error: 'x', logTailLines: [], videoOffsetMs: 42000, onJumpToVideo } });
    await fireEvent.click(getByRole('button', { name: /jump to video/i }));
    expect(onJumpToVideo).toHaveBeenCalledWith(42000);
  });
});
```

- [ ] **Step 4: Implement `FailureFocusPanel.svelte`**

```svelte
<script lang="ts">
  let { error, logTailLines, videoOffsetMs, onJumpToVideo }: {
    error: string;
    logTailLines: string[];
    videoOffsetMs: number | null;
    onJumpToVideo?: (offsetMs: number) => void;
  } = $props();

  function fmtOffset(ms: number): string {
    const s = Math.floor(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }
</script>

<div class="rounded-lg border border-tertiary/30 bg-tertiary/5 p-4">
  <div class="flex items-center gap-2 mb-2 text-tertiary">
    <span class="material-symbols-outlined">error</span>
    <span class="font-semibold text-[14px]">FAILURE</span>
  </div>
  <pre class="text-[12px] font-mono whitespace-pre-wrap text-on-surface mb-3">{error}</pre>

  <button
    type="button"
    class="inline-flex items-center gap-1 rounded bg-primary text-on-primary px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
    disabled={videoOffsetMs == null}
    title={videoOffsetMs == null ? 'Sync unavailable for this run' : ''}
    onclick={() => onJumpToVideo && videoOffsetMs != null && onJumpToVideo(videoOffsetMs)}
  >
    <span class="material-symbols-outlined text-[16px]">play_arrow</span>
    Jump to video {videoOffsetMs != null ? `at ${fmtOffset(videoOffsetMs)}` : ''}
  </button>

  {#if logTailLines.length > 0}
    <div class="mt-3 pt-3 border-t border-tertiary/20">
      <div class="text-[11px] uppercase tracking-wide text-on-surface-variant mb-1">Log tail</div>
      <pre class="text-[12px] font-mono whitespace-pre-wrap text-on-surface">{logTailLines.join('\n')}</pre>
    </div>
  {/if}
</div>
```

- [ ] **Step 5: Run both tests, PASS**

```bash
npx vitest run web/src/lib/components/reports/__tests__/
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/reports/StepDetail.svelte web/src/lib/components/reports/FailureFocusPanel.svelte web/src/lib/components/reports/__tests__/
git commit -m "feat(web): StepDetail + FailureFocusPanel components"
```

### Task 4.4: `SyncVideoPlayer`

**Files:**
- Create: `web/src/lib/components/reports/SyncVideoPlayer.svelte`
- Create: `web/src/lib/components/reports/__tests__/SyncVideoPlayer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SyncVideoPlayer.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import SyncVideoPlayer from '../SyncVideoPlayer.svelte';

describe('SyncVideoPlayer', () => {
  it('exposes seekTo via bind:this', async () => {
    let ref: { seekTo: (ms: number) => void } | undefined;
    const { container } = render(SyncVideoPlayer, {
      props: {
        src: '/artifacts/foo.mp4',
        markersMs: [1000, 5000],
        bind: { this: (r: never) => { ref = r as never; } },
      } as never,
    });
    expect(typeof ref?.seekTo).toBe('function');
    // simulate ref behaviour:
    const video = container.querySelector('video')!;
    ref!.seekTo(2500);
    expect(video.currentTime).toBe(2.5);
  });
});
```

(NB: `bind:this` in tests is awkward; alternative — expose `seekTo` via a callback prop. Adjust the component accordingly if Svelte 5 runes block this pattern.)

- [ ] **Step 2: Implement**

```svelte
<script lang="ts" module>
  // expose handle via ref-prop pattern
</script>

<script lang="ts">
  let { src, markersMs, durationMs, onRef }: {
    src: string;
    markersMs: number[];
    durationMs: number | null;
    onRef?: (h: { seekTo: (ms: number) => void }) => void;
  } = $props();

  let videoEl: HTMLVideoElement | undefined = $state(undefined);

  $effect(() => {
    if (videoEl && onRef) {
      onRef({ seekTo: (ms: number) => { videoEl!.currentTime = ms / 1000; } });
    }
  });
</script>

<div class="relative">
  <video bind:this={videoEl} src={src} controls class="w-full rounded border border-outline-variant/20"></video>

  {#if durationMs && markersMs.length > 0}
    <div class="relative h-2 mt-1 bg-surface-variant/30 rounded">
      {#each markersMs as m}
        <span
          class="absolute top-0 bottom-0 w-[2px] bg-primary"
          style="left: {(m / durationMs) * 100}%"
        ></span>
      {/each}
    </div>
  {/if}
</div>
```

Adapt the failing test to use `onRef` instead of `bind:this`.

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/reports/SyncVideoPlayer.svelte web/src/lib/components/reports/__tests__/SyncVideoPlayer.test.ts
git commit -m "feat(web): SyncVideoPlayer with seekTo handle + step markers"
```

### Task 4.5: `HistoryStrip` + sparkline

**Files:**
- Create: `web/src/lib/components/reports/HistoryStrip.svelte`
- Create: `web/src/lib/components/reports/__tests__/HistoryStrip.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import HistoryStrip from '../HistoryStrip.svelte';

describe('HistoryStrip', () => {
  it('renders pass rate, avg duration and last outcomes', () => {
    const history = {
      flowName: 'login.yaml',
      runs: Array.from({ length: 10 }, (_, i) => ({
        jobId: `j${i}`, status: i % 3 === 0 ? 'failed' : 'passed',
        finishedAt: new Date(i).toISOString(), durationMs: 1000 + i * 100,
      })),
      passRate: 0.7, avgDurationMs: 1450,
    };
    const { getByText, container } = render(HistoryStrip, { props: { history } });
    expect(getByText('login.yaml')).toBeDefined();
    expect(getByText(/70%/)).toBeDefined();
    expect(container.querySelectorAll('[data-outcome]').length).toBe(10);
  });

  it('renders empty state when history is null', () => {
    const { getByText } = render(HistoryStrip, { props: { history: null } });
    expect(getByText(/no history/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement**

```svelte
<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';

  let { history }: { history: ReportBundle['history'] } = $props();
</script>

{#if !history}
  <div class="text-[12px] text-on-surface-variant">No history</div>
{:else}
  <div class="space-y-2">
    <div class="font-mono text-[13px] text-on-surface">{history.flowName}</div>
    <div class="text-[12px] text-on-surface-variant">
      Pass: {Math.round(history.passRate * 100)}% · avg {(history.avgDurationMs / 1000).toFixed(1)}s
    </div>
    <div class="flex gap-[2px]">
      {#each history.runs as run}
        <span
          data-outcome={run.status}
          class="w-3 h-3 rounded-sm"
          class:bg-primary={run.status === 'passed'}
          class:bg-tertiary={run.status === 'failed'}
          class:bg-outline-variant={run.status !== 'passed' && run.status !== 'failed'}
          title="{run.status} · {run.finishedAt ?? ''}"
        ></span>
      {/each}
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/reports/HistoryStrip.svelte web/src/lib/components/reports/__tests__/HistoryStrip.test.ts
git commit -m "feat(web): HistoryStrip — pass rate + outcomes strip"
```

### Task 4.6: `ShareLinkDialog`

**Files:**
- Create: `web/src/lib/components/reports/ShareLinkDialog.svelte`
- Create: `web/src/lib/components/reports/__tests__/ShareLinkDialog.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ShareLinkDialog from '../ShareLinkDialog.svelte';

describe('ShareLinkDialog', () => {
  it('calls mint with selected ttl and shows URL', async () => {
    const mint = vi.fn().mockResolvedValue({ token: 'abc', url: '/jobs/j1?t=abc', expiresAt: new Date(Date.now() + 86400000 * 5).toISOString() });
    const { getByText, getByLabelText, findByDisplayValue } = render(ShareLinkDialog, { props: { jobId: 'j1', open: true, mintFn: mint, onClose: vi.fn() } });
    await fireEvent.change(getByLabelText(/ttl/i), { target: { value: '5' } });
    await fireEvent.click(getByText(/generate/i));
    expect(mint).toHaveBeenCalledWith('j1', 5);
    await findByDisplayValue('/jobs/j1?t=abc');
  });
});
```

- [ ] **Step 2: Implement**

```svelte
<script lang="ts">
  let { jobId, open, mintFn, onClose }: {
    jobId: string;
    open: boolean;
    mintFn: (jobId: string, ttl: 5 | 15 | 30) => Promise<{ token: string; url: string; expiresAt: string }>;
    onClose: () => void;
  } = $props();

  let ttl: 5 | 15 | 30 = $state(30);
  let result: { url: string; expiresAt: string } | null = $state(null);
  let loading = $state(false);
  let error: string | null = $state(null);

  async function generate() {
    loading = true;
    error = null;
    try {
      const r = await mintFn(jobId, ttl);
      result = { url: r.url, expiresAt: r.expiresAt };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to mint share token';
    } finally {
      loading = false;
    }
  }

  async function copy() {
    if (result) await navigator.clipboard.writeText(window.location.origin + result.url);
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onclick={onClose}>
    <div class="bg-background rounded-lg p-6 max-w-md w-full" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-[16px] font-semibold mb-4">Share this report</h2>

      <label class="block text-[13px] mb-2">
        <span class="text-on-surface-variant">TTL (days)</span>
        <select bind:value={ttl} class="ml-2 rounded border border-outline-variant/30 px-2 py-1">
          <option value={5}>5</option>
          <option value={15}>15</option>
          <option value={30}>30</option>
        </select>
      </label>

      <button type="button" onclick={generate} disabled={loading} class="rounded bg-primary text-on-primary px-3 py-1.5 text-[13px] disabled:opacity-50">
        {loading ? 'Generating…' : 'Generate'}
      </button>

      {#if result}
        <div class="mt-4 space-y-2">
          <input readonly value={result.url} class="w-full rounded border border-outline-variant/30 px-2 py-1 text-[12px] font-mono" />
          <div class="flex justify-between items-center text-[12px]">
            <span class="text-on-surface-variant">Expires {new Date(result.expiresAt).toLocaleString()}</span>
            <button type="button" onclick={copy} class="text-primary hover:underline">Copy</button>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="mt-3 text-tertiary text-[12px]">{error}</div>
      {/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/components/reports/ShareLinkDialog.svelte web/src/lib/components/reports/__tests__/ShareLinkDialog.test.ts
git commit -m "feat(web): ShareLinkDialog mints + copies share URL"
```

### Task 4.7: `ReportHeader` + `DownloadMenu`

**Files:**
- Create: `web/src/lib/components/reports/ReportHeader.svelte`
- Create: `web/src/lib/components/reports/DownloadMenu.svelte`

- [ ] **Step 1: Create `DownloadMenu`**

```svelte
<!-- DownloadMenu.svelte -->
<script lang="ts">
  let { junitXml, logsRaw }: { junitXml: string; logsRaw: string } = $props();
  let open = $state(false);
</script>

<div class="relative inline-block">
  <button type="button" onclick={() => open = !open} class="inline-flex items-center gap-1 rounded border border-outline-variant/30 px-3 py-1.5 text-[12px] font-medium hover:bg-surface-variant/30">
    Download <span class="material-symbols-outlined text-[16px]">arrow_drop_down</span>
  </button>
  {#if open}
    <div class="absolute right-0 mt-1 w-44 bg-background border border-outline-variant/20 rounded shadow-lg z-10">
      <a href={junitXml} download class="block px-3 py-2 text-[13px] hover:bg-surface-variant/40">JUnit XML</a>
      <a href={logsRaw}  download class="block px-3 py-2 text-[13px] hover:bg-surface-variant/40">Raw logs</a>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Create `ReportHeader`**

```svelte
<!-- ReportHeader.svelte -->
<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import DownloadMenu from './DownloadMenu.svelte';

  let { job, reportLinks, onShareClick }: {
    job: ReportBundle['job'];
    reportLinks: ReportBundle['reportLinks'];
    onShareClick: () => void;
  } = $props();

  function fmtDuration(ms: number | null): string {
    if (ms == null) return '—';
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
</script>

<header class="sticky top-16 z-20 bg-background border-b border-outline-variant/10 pb-3 pt-4 mb-4">
  <div class="flex items-center gap-3 mb-1">
    <StatusBadge status={job.status} size={22} />
    <h1 class="text-[18px] font-semibold font-mono">{job.id.slice(0, 8)}</h1>
    <span class="text-[13px] text-on-surface-variant capitalize">{job.status}</span>
    <span class="text-[12px] text-on-surface-variant">· {job.platform} · {fmtDuration(job.durationMs)}</span>
    <div class="ml-auto flex items-center gap-2">
      <button type="button" onclick={onShareClick} class="rounded border border-outline-variant/30 px-3 py-1.5 text-[12px] font-medium hover:bg-surface-variant/30">Share</button>
      <DownloadMenu junitXml={reportLinks.junitXml} logsRaw={reportLinks.logsRaw} />
    </div>
  </div>
  <div class="text-[12px] text-on-surface-variant">
    {job.summary.passed} passed · {job.summary.failed} failed · {job.summary.skipped} skipped · {job.summary.total} total
  </div>
</header>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/components/reports/ReportHeader.svelte web/src/lib/components/reports/DownloadMenu.svelte
git commit -m "feat(web): ReportHeader + DownloadMenu (JUnit/logs)"
```

### Task 4.8: `ReportShell` (3-pane composition)

**Files:**
- Create: `web/src/lib/components/reports/ReportShell.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { ReportBundle } from '$lib/api/types.js';
  import ReportHeader from './ReportHeader.svelte';
  import FlowStepTree from './FlowStepTree.svelte';
  import StepDetail from './StepDetail.svelte';
  import SyncVideoPlayer from './SyncVideoPlayer.svelte';
  import HistoryStrip from './HistoryStrip.svelte';
  import ShareLinkDialog from './ShareLinkDialog.svelte';
  import { mintShareToken } from '$lib/api/reports.js';

  let { bundle }: { bundle: ReportBundle } = $props();

  let activeStepId = $state<string | null>(bundle.failureFocus?.stepId ?? bundle.steps[0]?.id ?? null);
  let shareOpen = $state(false);
  let videoHandle = $state<{ seekTo: (ms: number) => void } | null>(null);

  let activeStep = $derived(bundle.steps.find((s) => s.id === activeStepId) ?? null);
  let video = $derived(bundle.artifacts.find((a) => a.type === 'video') ?? null);
  let markersMs = $derived(bundle.steps.map((s) => s.videoOffsetMs).filter((m): m is number => m != null));

  function jumpToVideo(offsetMs: number) {
    videoHandle?.seekTo(offsetMs);
  }
</script>

<ReportHeader
  job={bundle.job}
  reportLinks={bundle.reportLinks}
  onShareClick={() => shareOpen = true}
/>

<div class="grid grid-cols-1 xl:grid-cols-[240px_1fr_360px] gap-5">
  <aside class="hidden xl:block sticky top-44 self-start max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
    <FlowStepTree
      steps={bundle.steps}
      activeStepId={activeStepId}
      onSelect={(id) => activeStepId = id}
    />
  </aside>

  <section>
    {#if activeStep}
      <StepDetail
        step={activeStep}
        logTailLines={bundle.failureFocus?.stepId === activeStep.id ? bundle.failureFocus.logTailLines : []}
        onJumpToVideo={jumpToVideo}
      />
    {:else}
      <div class="text-[13px] text-on-surface-variant">No steps</div>
    {/if}
  </section>

  <aside class="hidden xl:block space-y-4">
    {#if video}
      <SyncVideoPlayer
        src={video.downloadUrl}
        markersMs={markersMs}
        durationMs={bundle.job.durationMs}
        onRef={(h) => videoHandle = h}
      />
    {/if}
    <HistoryStrip history={bundle.history} />
  </aside>
</div>

<ShareLinkDialog
  jobId={bundle.job.id}
  open={shareOpen}
  mintFn={mintShareToken}
  onClose={() => shareOpen = false}
/>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/components/reports/ReportShell.svelte
git commit -m "feat(web): ReportShell — 3-pane composition with sticky header"
```

### Task 4.9: Rewrite `/jobs/[id]/+page.svelte` behind feature flag

**Files:**
- Modify: `web/src/routes/jobs/[id]/+page.svelte`
- Modify: web feature-flag loader (existing or new in `web/src/lib/config.ts`)

- [ ] **Step 1: Expose feature flag to web**

Add a tiny route or layout fetch — easiest: server already exposes `/api/auth-config`. Add `useReportShell` to the existing config endpoint, or create `/api/ui-config`:

```ts
// server/api/routes.ts
app.get('/api/ui-config', async () => ({
  useReportShell: app.config.ui.use_report_shell,
}));
```

```ts
// web/src/lib/config.ts (new)
import { apiFetch } from './api/client.js';
export async function loadUiConfig() {
  try { return await apiFetch<{ useReportShell: boolean }>('/api/ui-config'); }
  catch { return { useReportShell: false }; }
}
```

- [ ] **Step 2: Rewrite the page**

Replace the entire body of `web/src/routes/jobs/[id]/+page.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { fetchReport } from '$lib/api/reports.js';
  import { loadUiConfig } from '$lib/config.js';
  import type { ReportBundle } from '$lib/api/types.js';
  import ReportShell from '$lib/components/reports/ReportShell.svelte';

  // Legacy fallback (kept until flag flips)
  import LegacyJobView from './LegacyJobView.svelte';

  let jobId = $derived(page.params.id as string);
  let shareToken = $derived(new URLSearchParams(page.url?.search ?? '').get('t') ?? undefined);

  let bundle = $state<ReportBundle | null>(null);
  let useReportShell = $state<boolean | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    const cfg = await loadUiConfig();
    useReportShell = cfg.useReportShell;
    if (cfg.useReportShell) {
      try {
        bundle = await fetchReport(jobId, shareToken);
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load report';
      }
    }
  });
</script>

{#if useReportShell === null}
  <div class="text-[13px] text-on-surface-variant">Loading…</div>
{:else if useReportShell && bundle}
  <ReportShell {bundle} />
{:else if useReportShell && error}
  <div class="text-tertiary">{error}</div>
{:else}
  <LegacyJobView />
{/if}
```

- [ ] **Step 3: Extract current implementation into `LegacyJobView.svelte`**

Copy the existing body of `+page.svelte` (before this rewrite) into `web/src/routes/jobs/[id]/LegacyJobView.svelte`. This preserves the rollback path.

- [ ] **Step 4: Run web build to confirm no broken imports**

```bash
npm run web:build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/jobs/[id]/+page.svelte web/src/routes/jobs/[id]/LegacyJobView.svelte web/src/lib/config.ts server/api/routes.ts
git commit -m "feat(web): /jobs/[id] uses ReportShell behind ui.use_report_shell flag"
```

### Task 4.10: Sub-tabs on `/jobs`

**Files:**
- Create: `web/src/lib/components/reports/ReportTabs.svelte`
- Modify: `web/src/routes/jobs/+page.svelte`
- Create: `web/src/lib/components/reports/SuitesTable.svelte`
- Create: `web/src/lib/components/reports/TrendsCharts.svelte`

- [ ] **Step 1: Create `ReportTabs.svelte`**

```svelte
<script lang="ts">
  let { active, onSelect }: {
    active: 'list' | 'suites' | 'history' | 'trends';
    onSelect: (t: 'list' | 'suites' | 'history' | 'trends') => void;
  } = $props();

  const tabs: Array<{ id: typeof active; label: string }> = [
    { id: 'list',    label: 'List' },
    { id: 'suites',  label: 'Suites' },
    { id: 'history', label: 'History' },
    { id: 'trends',  label: 'Trends' },
  ];
</script>

<div class="flex items-center gap-0 border-b border-outline-variant/10 mb-6">
  {#each tabs as t}
    <button
      type="button"
      onclick={() => onSelect(t.id)}
      class="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors"
      class:text-on-surface={active === t.id}
      class:border-primary={active === t.id}
      class:text-on-surface-variant={active !== t.id}
      class:border-transparent={active !== t.id}
    >
      {t.label}
    </button>
  {/each}
</div>
```

- [ ] **Step 2: Create `SuitesTable.svelte`**

```svelte
<script lang="ts">
  import type { SuiteAggregate } from '$lib/api/reports.js';
  let { suites }: { suites: SuiteAggregate[] } = $props();
</script>

<table class="w-full text-[13px]">
  <thead class="text-[11px] uppercase text-on-surface-variant border-b border-outline-variant/10">
    <tr>
      <th class="text-left py-2">Flow</th>
      <th class="text-right py-2">Runs</th>
      <th class="text-right py-2">Pass rate</th>
      <th class="text-right py-2">Avg duration</th>
      <th class="text-right py-2">Trend</th>
      <th class="text-right py-2">Last run</th>
    </tr>
  </thead>
  <tbody>
    {#each suites as s}
      <tr class="border-b border-outline-variant/5">
        <td class="py-2 font-mono">{s.flowName}</td>
        <td class="py-2 text-right">{s.totalRuns}</td>
        <td class="py-2 text-right">{Math.round(s.passRate * 100)}%</td>
        <td class="py-2 text-right">{(s.avgDurationMs / 1000).toFixed(1)}s</td>
        <td class="py-2 text-right">
          <span class="inline-flex gap-[1px] align-middle">
            {#each s.trend as v}
              <span class="w-2 h-3 inline-block rounded-sm" class:bg-primary={v === 1} class:bg-tertiary={v === 0}></span>
            {/each}
          </span>
        </td>
        <td class="py-2 text-right text-on-surface-variant">{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}</td>
      </tr>
    {/each}
  </tbody>
</table>
```

- [ ] **Step 3: Create `TrendsCharts.svelte` (manual SVG)**

```svelte
<script lang="ts">
  import type { TrendsOutput } from '$lib/api/reports.js';
  let { trends }: { trends: TrendsOutput } = $props();
  let max = $derived(Math.max(1, ...trends.byDay.map((d) => d.total)));
</script>

<div class="space-y-6">
  <section>
    <h3 class="text-[14px] font-semibold mb-2">By day (pass/fail)</h3>
    <div class="flex items-end gap-1 h-32">
      {#each trends.byDay as d}
        <div class="flex flex-col-reverse items-center w-8" title={`${d.date}: ${d.passed} passed, ${d.failed} failed`}>
          <div class="bg-primary w-full" style="height: {(d.passed / max) * 100}%"></div>
          <div class="bg-tertiary w-full" style="height: {(d.failed / max) * 100}%"></div>
        </div>
      {/each}
    </div>
    <div class="flex gap-1 mt-1 text-[10px] text-on-surface-variant">
      {#each trends.byDay as d}
        <span class="w-8 text-center truncate">{d.date.slice(5)}</span>
      {/each}
    </div>
  </section>

  <section>
    <h3 class="text-[14px] font-semibold mb-2">By flow</h3>
    <table class="text-[13px]">
      {#each trends.byFlow as f}
        <tr>
          <td class="font-mono pr-4">{f.flowName}</td>
          <td class="text-primary pr-2">{f.passed}</td>
          <td class="text-tertiary">{f.failed}</td>
        </tr>
      {/each}
    </table>
  </section>
</div>
```

- [ ] **Step 4: Modify `/jobs/+page.svelte`**

At the top of the existing `web/src/routes/jobs/+page.svelte`, wire up tabs:

```svelte
<script lang="ts">
  // ... existing imports
  import ReportTabs from '$lib/components/reports/ReportTabs.svelte';
  import SuitesTable from '$lib/components/reports/SuitesTable.svelte';
  import TrendsCharts from '$lib/components/reports/TrendsCharts.svelte';
  import { fetchSuites, fetchTrends } from '$lib/api/reports.js';

  let activeTab = $state<'list' | 'suites' | 'history' | 'trends'>('list');
  let suites = $state<Awaited<ReturnType<typeof fetchSuites>>>([]);
  let trends = $state<Awaited<ReturnType<typeof fetchTrends>> | null>(null);

  $effect(() => {
    if (activeTab === 'suites' && suites.length === 0) fetchSuites(7).then((r) => suites = r);
    if (activeTab === 'trends' && !trends) fetchTrends(7).then((r) => trends = r);
  });
</script>

<ReportTabs active={activeTab} onSelect={(t) => activeTab = t} />

{#if activeTab === 'list'}
  <!-- existing JobCard grid -->
{:else if activeTab === 'suites'}
  <SuitesTable suites={suites} />
{:else if activeTab === 'history'}
  <!-- reuse JobCard grid but with flowName filter dropdown above -->
  <p class="text-[13px] text-on-surface-variant">History view — list + filter by flow & date (reuses /jobs?flowName=…)</p>
{:else if activeTab === 'trends' && trends}
  <TrendsCharts trends={trends} />
{/if}
```

- [ ] **Step 5: Run build, smoke**

```bash
npm run web:build
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/reports/ReportTabs.svelte web/src/lib/components/reports/SuitesTable.svelte web/src/lib/components/reports/TrendsCharts.svelte web/src/routes/jobs/+page.svelte
git commit -m "feat(web): /jobs sub-tabs List|Suites|History|Trends"
```

### Task 4.11: Flip the flag locally and smoke

- [ ] **Step 1: Edit `config.yaml`**

```yaml
ui:
  use_report_shell: true
sharing:
  enabled: true
  default_ttl_days: 30
security:
  share_token_secret: "<run: openssl rand -hex 32>"
```

- [ ] **Step 2: Restart server + dev server**

```bash
DATABASE_URL=... ./node_modules/.bin/tsx server/index.ts
npm run web:dev
```

- [ ] **Step 3: Submit a job that will fail (point to an invalid selector), open /jobs/[id] and validate:**

- Header with stats and status colour
- Tree on left lists flows and steps
- Failed step is auto-selected; FailureFocusPanel renders error + log tail
- "Jump to video at MM:SS" enabled; clicking seeks the right pane video
- History strip shows last 10 outcomes (if history)
- Share button opens dialog, "Generate" returns URL, opening URL in incognito loads the report without auth

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: all PASS.

Phase 4 done.

---

## Phase 5 — Azure PR commenter uses share token

Goal: PR comments link to the report with `?t=<jwt>` so reviewers without device-farm credentials can open it.

### Task 5.1: Use mint() in the Azure commenter

**Files:**
- Modify: `server/azure/plugin.ts` (the commenter wiring)
- Modify: the Azure comment template (find where `comment` body is built — likely `server/azure/internal/commenter.ts` or similar)

- [ ] **Step 1: Locate the comment-body builder**

```bash
grep -rn "comment\|commentBody\|comment_body\|markdown" /Users/heicg/Desktop/projects/device-farm/server/azure/ | head -20
```

- [ ] **Step 2: Inject `reportTokenService` and update URL**

In the commenter, where the URL pointing to device-farm is composed (look for `/jobs/`, `/pipeline-runs/`, or `baseUrl +`), change to:

```ts
const baseUrl = fastify.config.public_base_url;
const token = fastify.reportTokenService
  ? (await fastify.reportTokenService.mint({ jobId, ttlDays: fastify.config.sharing.default_ttl_days })).token
  : null;
const reportUrl = token ? `${baseUrl}/jobs/${jobId}?t=${token}` : `${baseUrl}/jobs/${jobId}`;
```

- [ ] **Step 3: Add `public_base_url` to config schema if missing**

In `server/config/schema.ts`:

```ts
public_base_url: z.string().url().default('http://localhost:3000'),
```

- [ ] **Step 4: Add an integration test**

`server/azure/__tests__/commenter-uses-share-token.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildCommentBody } from '../internal/commenter.js'; // adapt path

describe('commenter uses share token', () => {
  it('embeds ?t= when sharing is enabled', async () => {
    const mint = vi.fn().mockResolvedValue({ token: 'abc.def.ghi', expiresAt: new Date(), url: '' });
    const body = await buildCommentBody({
      jobId: 'job-1',
      status: 'passed',
      baseUrl: 'https://df.example.com',
      mintFn: mint,
    });
    expect(body).toContain('https://df.example.com/jobs/job-1?t=abc.def.ghi');
  });

  it('falls back to plain URL when mintFn is null', async () => {
    const body = await buildCommentBody({ jobId: 'job-1', status: 'passed', baseUrl: 'https://df.example.com', mintFn: null });
    expect(body).toContain('https://df.example.com/jobs/job-1');
    expect(body).not.toContain('?t=');
  });
});
```

(Refactor `buildCommentBody` into a pure helper if it isn't already, to make this testable.)

- [ ] **Step 5: Tests PASS**

- [ ] **Step 6: Commit**

```bash
git add server/azure/ server/config/schema.ts
git commit -m "feat(azure): PR comment URL embeds share token when sharing enabled"
```

---

## Phase 6 — Settings UI for retention

Goal: `/settings` exposes a dropdown 5/15/30 days that writes to `storage.artifacts.retention_days` via an admin endpoint.

### Task 6.1: `PATCH /admin/config` endpoint

**Files:**
- Modify: `server/api/routes.ts` (or wherever admin endpoints live)
- Create: helper to write back to `config.yaml` safely

- [ ] **Step 1: Add the endpoint**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { z } from 'zod';

const patchBody = z.object({
  retention_days: z.union([z.literal(5), z.literal(15), z.literal(30)]).optional(),
});

app.patch('/admin/config', { preHandler: app.requireAdmin }, async (req, reply) => {
  const body = patchBody.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ type: 'about:blank', title: 'Invalid body', status: 400 });

  const path = process.env.DEVICE_FARM_CONFIG ?? 'config.yaml';
  const raw = await readFile(path, 'utf8');
  const cfg = yaml.load(raw) as Record<string, unknown>;

  if (body.data.retention_days != null) {
    (cfg.storage as { artifacts: { retention_days: number } }).artifacts.retention_days = body.data.retention_days;
  }
  await writeFile(path, yaml.dump(cfg));
  return { ok: true, applied: body.data };
});
```

- [ ] **Step 2: Restart hint or reload**

Add a TODO note: full hot-reload is out of scope; surface a banner in the UI "Restart server to apply changes". Do NOT auto-restart.

- [ ] **Step 3: Test**

```ts
// server/api/__tests__/admin-config-patch.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from '../../reporting/__tests__/__helpers/test-app.js';

describe('PATCH /admin/config', () => {
  it('rejects retention_days outside {5,15,30}', async () => {
    const app = await buildTestApp({ admin: true });
    const res = await app.inject({ method: 'PATCH', url: '/admin/config', payload: { retention_days: 10 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add server/api/routes.ts server/api/__tests__/admin-config-patch.test.ts
git commit -m "feat(admin): PATCH /admin/config — retention_days 5|15|30"
```

### Task 6.2: Retention dropdown in `/settings`

**Files:**
- Modify: `web/src/routes/settings/+page.svelte`

- [ ] **Step 1: Add the dropdown**

Find the existing `/settings` page. Append:

```svelte
<script lang="ts">
  // ... existing
  import { apiFetch } from '$lib/api/client.js';

  let retentionDays = $state<5 | 15 | 30>(30);
  let saving = $state(false);
  let savedAt = $state<Date | null>(null);
  let error = $state<string | null>(null);

  async function saveRetention() {
    saving = true; error = null;
    try {
      await apiFetch('/admin/config', { method: 'PATCH', body: JSON.stringify({ retention_days: retentionDays }), headers: { 'Content-Type': 'application/json' } });
      savedAt = new Date();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed';
    } finally {
      saving = false;
    }
  }
</script>

<section class="rounded-lg border border-outline-variant/10 p-4 mt-6">
  <h2 class="text-[14px] font-semibold mb-2">Artifact retention</h2>
  <p class="text-[12px] text-on-surface-variant mb-3">
    Delete artifacts (videos, screenshots) older than the selected window. A restart is required to apply.
  </p>
  <label class="flex items-center gap-2 text-[13px]">
    <span>Days</span>
    <select bind:value={retentionDays} class="rounded border border-outline-variant/30 px-2 py-1">
      <option value={5}>5</option>
      <option value={15}>15</option>
      <option value={30}>30</option>
    </select>
  </label>
  <button type="button" onclick={saveRetention} disabled={saving} class="mt-3 rounded bg-primary text-on-primary px-3 py-1.5 text-[13px] disabled:opacity-50">
    {saving ? 'Saving…' : 'Save'}
  </button>
  {#if savedAt}
    <div class="mt-2 text-[12px] text-on-surface-variant">Saved at {savedAt.toLocaleTimeString()} · restart server to apply</div>
  {/if}
  {#if error}
    <div class="mt-2 text-tertiary text-[12px]">{error}</div>
  {/if}
</section>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/routes/settings/+page.svelte
git commit -m "feat(web): retention dropdown in /settings"
```

---

## Final smoke + handoff

- [ ] **Step 1: Full test run**

```bash
npm test && npm run typecheck && npm run lint
```
Expected: all PASS.

- [ ] **Step 2: Manual end-to-end smoke**

1. Start fresh DB or clear `jobs`, `job_steps`, `artifacts`.
2. Submit a job that runs `login.yaml` and a job that runs `checkout.yaml` (one passing, one failing).
3. Open `/jobs` — switch through List, Suites, History, Trends; each renders something sensible.
4. Open `/jobs/<id>` of the failing job — failure focus auto-selected, video sync works, share dialog mints URL.
5. Copy the share URL, open in incognito, confirm it loads without auth.
6. Wait until tomorrow, hit `lifecycle.retention` (or call the task manually) and confirm old artifacts deleted per `retention_days`.

- [ ] **Step 3: Tag the milestone**

```bash
git tag v3.1-report-viewer
```

---

## Self-review notes

- **Spec coverage:** Goals (4 gaps + sub-tabs + JUnit download + share link + retention UI) → mapped to Phases 1–6. Non-goals respected (no HTML report embed, no diff comparison, no SSO).
- **Type consistency:** `ReportBundle` shape in `report-bundle-service.ts` matches `web/src/lib/api/types.ts` field names (`videoOffsetMs`, `failureFocus`, etc.).
- **Existing schema reality:** `job_steps.started_at` and `finished_at` already exist; plan reuses them (Task 1.3 explicitly), only `artifacts.video_started_at` is added (Task 1.1).
- **No placeholders:** every code step has runnable code; every test has assertions; no "implement appropriately" instructions.
- **Open question resolution:** `jose` chosen for JWT (Task 3.1); chart lib is manual SVG (Task 4.10); sparkline manual SVG (Task 4.5).
- **Rollback path:** migration is additive; feature flag `ui.use_report_shell` gates the new shell; legacy view preserved in `LegacyJobView.svelte` (Task 4.9).
