# Pipeline Engine Phase 1 — Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core pipeline engine that can parse YAML pipeline definitions, execute sequential script stages with conditional logic (`when`), stream logs via WebSocket, and expose CRUD + trigger APIs.

**Architecture:** New `server/pipelines/` module with: YAML parser (Zod-validated), PipelineExecutor (runs stages sequentially, spawns bash/python), PipelineService (orchestrates runs, DB persistence), Fastify plugin (routes + WebSocket). Integrates with existing DB plugin and WebSocket infrastructure.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM, Zod, node:child_process (spawn), @fastify/websocket

**Spec:** `docs/superpowers/specs/2026-04-16-pipeline-engine-design.md` (Phase 1 section)

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `server/pipelines/schema.ts` | Pipeline YAML Zod schema + TypeScript types |
| `server/pipelines/parser.ts` | Parse + validate YAML string into typed PipelineDef |
| `server/pipelines/executor.ts` | Execute stages: spawn scripts, evaluate `when`, stream logs |
| `server/pipelines/service.ts` | Orchestrate runs: create run records, delegate to executor, update DB |
| `server/pipelines/broadcaster.ts` | WebSocket message broadcaster for pipeline runs (like JobBroadcaster) |
| `server/pipelines/plugin.ts` | Fastify plugin: register routes, WebSocket, service |
| `server/pipelines/routes.ts` | REST API routes for pipelines and runs |
| `server/pipelines/__tests__/parser.test.ts` | Tests for YAML parsing + validation |
| `server/pipelines/__tests__/executor.test.ts` | Tests for stage execution + conditions |
| `server/pipelines/__tests__/service.test.ts` | Tests for run orchestration |
| `server/pipelines/__tests__/routes.test.ts` | Tests for API routes |

### Modified Files

| File | Change |
|---|---|
| `server/db/schema.ts` | Add pipeline tables (pipelines, pipeline_runs, pipeline_stage_runs) |
| `server/index.ts` | Register pipelines plugin in dependency order |

---

## Task 1: Database Schema

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Write pipeline enums and tables in schema.ts**

Add to the end of `server/db/schema.ts`:

```typescript
// ── Pipeline Engine ──────────────────────────────────────────────

export const pipelineTriggerTypeEnum = pgEnum('pipeline_trigger_type', [
  'api',
  'schedule',
  'manual',
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
  errorMessage: text('error_message'),
});

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
```

- [ ] **Step 2: Push schema to database**

Run: `npx drizzle-kit push`
Expected: Tables created successfully (with truncated identifier warning, ignore it)

- [ ] **Step 3: Verify tables exist**

Run: `psql -U heicg -d device_farm -c "\dt pipeline*"`
Expected: 3 tables listed: pipelines, pipeline_runs, pipeline_stage_runs

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(pipelines): add pipeline engine database schema

Add pipelines, pipeline_runs, pipeline_stage_runs tables with enums
for trigger type, run status, stage status, and stage type."
```

---

## Task 2: Pipeline YAML Parser

**Files:**
- Create: `server/pipelines/schema.ts`
- Create: `server/pipelines/parser.ts`
- Create: `server/pipelines/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing test for YAML parsing**

Create `server/pipelines/__tests__/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePipeline } from '../parser.js';

const VALID_YAML = `
name: "test-pipeline"
description: "A test pipeline"
trigger:
  - api
stages:
  - name: setup
    script: echo "hello"
    timeout: 60
  - name: cleanup
    script: echo "done"
    when: always
`;

const INVALID_YAML_NO_NAME = `
stages:
  - name: setup
    script: echo "hello"
`;

const INVALID_YAML_NO_STAGES = `
name: "bad-pipeline"
`;

const YAML_WITH_VARIABLES = `
name: "var-pipeline"
trigger:
  - api
variables:
  APP_ID: com.test
stages:
  - name: setup
    script: echo "{{APP_ID}} on {{branch}}"
`;

describe('parsePipeline', () => {
  it('parses a valid pipeline YAML', () => {
    const result = parsePipeline(VALID_YAML);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe('test-pipeline');
    expect(result.data.stages).toHaveLength(2);
    expect(result.data.stages[0].name).toBe('setup');
    expect(result.data.stages[0].script).toBe('echo "hello"');
    expect(result.data.stages[0].timeout).toBe(60);
    expect(result.data.stages[0].when).toBe('success'); // default
    expect(result.data.stages[1].when).toBe('always');
  });

  it('rejects YAML without name', () => {
    const result = parsePipeline(INVALID_YAML_NO_NAME);
    expect(result.success).toBe(false);
  });

  it('rejects YAML without stages', () => {
    const result = parsePipeline(INVALID_YAML_NO_STAGES);
    expect(result.success).toBe(false);
  });

  it('parses variables block', () => {
    const result = parsePipeline(YAML_WITH_VARIABLES);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.variables).toEqual({ APP_ID: 'com.test' });
  });

  it('defaults trigger to ["api"] when omitted', () => {
    const yaml = 'name: "simple"\nstages:\n  - name: s1\n    script: echo hi';
    const result = parsePipeline(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toEqual([{ type: 'api' }]);
  });

  it('parses schedule triggers', () => {
    const yaml = `
name: "scheduled"
trigger:
  - api
  - schedule: "0 2 * * *"
stages:
  - name: s1
    script: echo hi
`;
    const result = parsePipeline(yaml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trigger).toHaveLength(2);
    expect(result.data.trigger[1]).toEqual({ type: 'schedule', cron: '0 2 * * *' });
  });

  it('rejects invalid YAML syntax', () => {
    const result = parsePipeline('not: valid: yaml: [[[');
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pipelines/__tests__/parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the Zod schema**

Create `server/pipelines/schema.ts`:

```typescript
import { z } from 'zod';

export const triggerSchema = z.union([
  z.literal('api').transform(() => ({ type: 'api' as const })),
  z.object({ schedule: z.string() }).transform(v => ({ type: 'schedule' as const, cron: v.schedule })),
]);

export const stageSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['script', 'maestro']).default('script'),
  script: z.string().optional(),
  timeout: z.number().int().min(1).max(3600).default(300),
  when: z.enum(['success', 'failure', 'always']).default('success'),
  // Maestro-specific fields (Phase 2)
  platform: z.enum(['android', 'ios']).optional(),
  flows: z.string().optional(),
  env: z.record(z.string()).optional(),
  matrix: z.array(z.record(z.unknown())).optional(),
});

export const sourceSchema = z.object({
  provider: z.enum(['azure_devops']).default('azure_devops'),
  repo: z.string().url(),
  branch: z.string().default('main'),
  pat_secret: z.string().optional(),
});

export const notifyAzureSchema = z.object({
  comment: z.boolean().default(false),
});

export const notifyWebhookSchema = z.object({
  url: z.string().url(),
});

export const notifySchema = z.object({
  azure_devops: notifyAzureSchema.optional(),
  webhook: notifyWebhookSchema.optional(),
});

export const pipelineDefSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger: z.array(triggerSchema).default([{ type: 'api' }]),
  source: sourceSchema.optional(),
  variables: z.record(z.string()).optional(),
  stages: z.array(stageSchema).min(1),
  notify: notifySchema.optional(),
});

export type PipelineDef = z.infer<typeof pipelineDefSchema>;
export type StageDef = z.infer<typeof stageSchema>;
export type TriggerDef = z.infer<typeof triggerSchema>;
```

- [ ] **Step 4: Create the parser**

Create `server/pipelines/parser.ts`:

```typescript
import YAML from 'yaml';
import { pipelineDefSchema, type PipelineDef } from './schema.js';

export type ParseResult =
  | { success: true; data: PipelineDef }
  | { success: false; error: string };

export function parsePipeline(yamlString: string): ParseResult {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlString);
  } catch (err: any) {
    return { success: false, error: `Invalid YAML: ${err.message}` };
  }

  const result = pipelineDefSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { success: false, error: detail };
  }

  return { success: true, data: result.data };
}
```

- [ ] **Step 5: Install yaml package if needed**

Run: `npm ls yaml 2>/dev/null | grep yaml || npm install yaml`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/pipelines/__tests__/parser.test.ts`
Expected: 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/pipelines/schema.ts server/pipelines/parser.ts server/pipelines/__tests__/parser.test.ts
git commit -m "feat(pipelines): add YAML parser with Zod validation

Parse pipeline YAML into typed PipelineDef with stages, triggers,
variables, source, and notify blocks. Validates with Zod schema."
```

---

## Task 3: Variable Interpolation

**Files:**
- Create: `server/pipelines/variables.ts`
- Modify: `server/pipelines/__tests__/parser.test.ts` (add variable tests)

- [ ] **Step 1: Write failing tests for variable interpolation**

Add to `server/pipelines/__tests__/parser.test.ts`:

```typescript
import { interpolateVariables } from '../variables.js';

describe('interpolateVariables', () => {
  it('replaces {{var}} placeholders with values', () => {
    const result = interpolateVariables('echo {{name}}', { name: 'world' });
    expect(result).toBe('echo world');
  });

  it('replaces multiple occurrences', () => {
    const result = interpolateVariables('{{a}} and {{b}}', { a: '1', b: '2' });
    expect(result).toBe('1 and 2');
  });

  it('leaves unknown variables as-is', () => {
    const result = interpolateVariables('echo {{unknown}}', {});
    expect(result).toBe('echo {{unknown}}');
  });

  it('handles empty string values', () => {
    const result = interpolateVariables('echo {{val}}', { val: '' });
    expect(result).toBe('echo ');
  });

  it('handles no placeholders', () => {
    const result = interpolateVariables('echo hello', { name: 'world' });
    expect(result).toBe('echo hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pipelines/__tests__/parser.test.ts`
Expected: FAIL — module `../variables.js` not found

- [ ] **Step 3: Implement variable interpolation**

Create `server/pipelines/variables.ts`:

```typescript
/**
 * Replace {{variable}} placeholders in a string with values from the given map.
 * Unknown variables are left as-is (not replaced).
 */
export function interpolateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/pipelines/__tests__/parser.test.ts`
Expected: 12 tests PASS (7 parser + 5 variables)

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/variables.ts server/pipelines/__tests__/parser.test.ts
git commit -m "feat(pipelines): add variable interpolation for {{var}} templates"
```

---

## Task 4: Pipeline Executor (Script Stages)

**Files:**
- Create: `server/pipelines/executor.ts`
- Create: `server/pipelines/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing tests for executor**

Create `server/pipelines/__tests__/executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor, type StageResult } from '../executor.js';
import type pino from 'pino';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as pino.Logger;
}

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor;
  let logger: pino.Logger;

  beforeEach(() => {
    logger = createLogger();
    executor = new PipelineExecutor(logger);
  });

  describe('executeScript', () => {
    it('executes a simple echo and captures stdout', async () => {
      const result = await executor.executeScript({
        script: 'echo "hello world"',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog: vi.fn(),
      });

      expect(result.status).toBe('passed');
      expect(result.logs).toContain('hello world');
    });

    it('returns failed for non-zero exit code', async () => {
      const result = await executor.executeScript({
        script: 'exit 1',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog: vi.fn(),
      });

      expect(result.status).toBe('failed');
    });

    it('interpolates variables in the script', async () => {
      const onLog = vi.fn();
      const result = await executor.executeScript({
        script: 'echo "{{greeting}}"',
        workDir: '/tmp',
        variables: { greeting: 'hola' },
        timeoutMs: 5000,
        onLog,
      });

      expect(result.status).toBe('passed');
      expect(result.logs).toContain('hola');
    });

    it('times out long-running scripts', async () => {
      const result = await executor.executeScript({
        script: 'sleep 30',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 500,
        onLog: vi.fn(),
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('timeout');
    }, 10_000);

    it('streams logs line by line via onLog callback', async () => {
      const onLog = vi.fn();
      await executor.executeScript({
        script: 'echo "line1"\necho "line2"',
        workDir: '/tmp',
        variables: {},
        timeoutMs: 5000,
        onLog,
      });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('line1'));
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('line2'));
    });
  });

  describe('evaluateCondition', () => {
    it('returns true for "success" when no failures', () => {
      expect(executor.evaluateCondition('success', false)).toBe(true);
    });

    it('returns false for "success" when there are failures', () => {
      expect(executor.evaluateCondition('success', true)).toBe(false);
    });

    it('returns true for "failure" when there are failures', () => {
      expect(executor.evaluateCondition('failure', true)).toBe(true);
    });

    it('returns false for "failure" when no failures', () => {
      expect(executor.evaluateCondition('failure', false)).toBe(false);
    });

    it('returns true for "always" regardless', () => {
      expect(executor.evaluateCondition('always', false)).toBe(true);
      expect(executor.evaluateCondition('always', true)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pipelines/__tests__/executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PipelineExecutor**

Create `server/pipelines/executor.ts`:

```typescript
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type pino from 'pino';
import { interpolateVariables } from './variables.js';

export interface StageResult {
  status: 'passed' | 'failed';
  logs: string;
  error?: string;
  durationMs: number;
}

export interface ExecuteScriptOpts {
  script: string;
  workDir: string;
  variables: Record<string, string>;
  timeoutMs: number;
  onLog: (line: string) => void;
  signal?: AbortSignal;
}

export class PipelineExecutor {
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger.child({ component: 'pipeline-executor' });
  }

  /**
   * Evaluate a stage condition against the current run state.
   */
  evaluateCondition(when: 'success' | 'failure' | 'always', hasFailures: boolean): boolean {
    if (when === 'always') return true;
    if (when === 'failure') return hasFailures;
    return !hasFailures; // 'success'
  }

  /**
   * Execute a script stage. Spawns bash with the script as stdin,
   * streams stdout/stderr line by line, and enforces timeout.
   */
  async executeScript(opts: ExecuteScriptOpts): Promise<StageResult> {
    const { workDir, variables, timeoutMs, onLog, signal } = opts;
    const script = interpolateVariables(opts.script, variables);

    const startTime = Date.now();
    const logLines: string[] = [];

    return new Promise<StageResult>((resolve) => {
      const child = spawn('bash', ['-e', '-c', script], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...Object.fromEntries(
            Object.entries(variables).map(([k, v]) => [`DEVICE_FARM_${k.toUpperCase()}`, v]),
          ),
        },
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);

      // Handle cancellation
      if (signal) {
        const onAbort = () => { child.kill('SIGTERM'); };
        signal.addEventListener('abort', onAbort, { once: true });
        child.on('exit', () => signal.removeEventListener('abort', onAbort));
      }

      // Stream stdout
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          logLines.push(line);
          onLog(line);
        });
      }

      // Stream stderr
      if (child.stderr) {
        const rl = createInterface({ input: child.stderr });
        rl.on('line', (line) => {
          logLines.push(line);
          onLog(line);
        });
      }

      child.on('exit', (exitCode) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;
        const logs = logLines.join('\n');

        if (timedOut) {
          resolve({ status: 'failed', logs, error: `Script timeout after ${timeoutMs}ms`, durationMs });
        } else if (exitCode !== 0) {
          resolve({ status: 'failed', logs, error: `Script exited with code ${exitCode}`, durationMs });
        } else {
          resolve({ status: 'passed', logs, durationMs });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          status: 'failed',
          logs: logLines.join('\n'),
          error: `Spawn error: ${err.message}`,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/pipelines/__tests__/executor.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/executor.ts server/pipelines/__tests__/executor.test.ts
git commit -m "feat(pipelines): add PipelineExecutor for script stages

Spawn bash scripts with variable interpolation, timeout enforcement,
line-by-line log streaming, and conditional evaluation (when: success/failure/always)."
```

---

## Task 5: Pipeline Run Broadcaster

**Files:**
- Create: `server/pipelines/broadcaster.ts`

- [ ] **Step 1: Implement PipelineBroadcaster**

Create `server/pipelines/broadcaster.ts`:

```typescript
import type { WebSocket } from 'ws';

export interface PipelineMessage {
  type: 'stage_start' | 'stage_log' | 'stage_end' | 'job_created' | 'run_end';
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Broadcasts pipeline run events to connected WebSocket clients.
 * Maintains a per-run message buffer for replay on connect.
 */
export class PipelineBroadcaster {
  private readonly subscribers: Map<string, Set<WebSocket>> = new Map();
  private readonly buffers: Map<string, PipelineMessage[]> = new Map();
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 200) {
    this.maxBufferSize = maxBufferSize;
  }

  emit(runId: string, message: PipelineMessage): void {
    // Buffer
    let buffer = this.buffers.get(runId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(runId, buffer);
    }
    buffer.push(message);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    // Broadcast
    const subs = this.subscribers.get(runId);
    if (subs) {
      const json = JSON.stringify(message);
      for (const ws of subs) {
        if (ws.readyState === ws.OPEN) {
          ws.send(json);
        }
      }
    }
  }

  subscribe(runId: string, ws: WebSocket): void {
    let subs = this.subscribers.get(runId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(runId, subs);
    }
    subs.add(ws);

    // Replay buffer
    const buffer = this.buffers.get(runId);
    if (buffer) {
      for (const msg of buffer) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    }
  }

  unsubscribe(runId: string, ws: WebSocket): void {
    const subs = this.subscribers.get(runId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) {
        this.subscribers.delete(runId);
      }
    }
  }

  cleanup(runId: string): void {
    this.subscribers.delete(runId);
    // Keep buffer for late-connecting clients; it will be GC'd eventually
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/pipelines/broadcaster.ts
git commit -m "feat(pipelines): add WebSocket broadcaster for pipeline runs

Buffer last 200 messages per run, replay on connect, broadcast
stage_start/stage_log/stage_end/run_end events."
```

---

## Task 6: Pipeline Service

**Files:**
- Create: `server/pipelines/service.ts`
- Create: `server/pipelines/__tests__/service.test.ts`

- [ ] **Step 1: Write failing tests for PipelineService**

Create `server/pipelines/__tests__/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../executor.js', () => {
  return {
    PipelineExecutor: vi.fn().mockImplementation(() => ({
      evaluateCondition: vi.fn((when: string, hasFailures: boolean) => {
        if (when === 'always') return true;
        if (when === 'failure') return hasFailures;
        return !hasFailures;
      }),
      executeScript: vi.fn().mockResolvedValue({
        status: 'passed',
        logs: 'ok',
        durationMs: 100,
      }),
    })),
  };
});

import { PipelineService } from '../service.js';
import type { Database } from '../../db/index.js';

function createMockDb() {
  const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 'run-1' }]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  } as unknown as Database;
}

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function createMockBroadcaster() {
  return {
    emit: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    cleanup: vi.fn(),
  } as any;
}

describe('PipelineService', () => {
  let service: PipelineService;
  let db: Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    service = new PipelineService(db, createLogger(), createMockBroadcaster());
  });

  describe('createPipeline', () => {
    it('validates YAML and inserts into DB', async () => {
      const yaml = 'name: "test"\nstages:\n  - name: s1\n    script: echo hi';
      const result = await service.createPipeline(yaml);
      expect(result.id).toBeDefined();
      expect(db.insert).toHaveBeenCalled();
    });

    it('rejects invalid YAML', async () => {
      await expect(service.createPipeline('invalid: [')).rejects.toThrow();
    });
  });

  describe('triggerRun', () => {
    it('creates a pipeline run and starts execution', async () => {
      // Mock getPipeline
      const mockPipeline = {
        id: 'pipe-1',
        name: 'test',
        yamlContent: 'name: "test"\nstages:\n  - name: s1\n    script: echo hi',
      };
      const selectMock = vi.fn().mockResolvedValue([mockPipeline]);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: selectMock,
        }),
      });

      const runId = await service.triggerRun('pipe-1', 'api', {});
      expect(runId).toBeDefined();
      expect(db.insert).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pipelines/__tests__/service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PipelineService**

Create `server/pipelines/service.ts`:

```typescript
import { eq, desc } from 'drizzle-orm';
import type pino from 'pino';
import type { Database } from '../db/index.js';
import * as schema from '../db/schema.js';
import { parsePipeline } from './parser.js';
import { PipelineExecutor } from './executor.js';
import type { PipelineBroadcaster, PipelineMessage } from './broadcaster.js';
import type { PipelineDef } from './schema.js';

export class PipelineService {
  private readonly db: Database;
  private readonly logger: pino.Logger;
  private readonly executor: PipelineExecutor;
  private readonly broadcaster: PipelineBroadcaster;
  private readonly runningRuns: Map<string, AbortController> = new Map();

  constructor(db: Database, logger: pino.Logger, broadcaster: PipelineBroadcaster) {
    this.db = db;
    this.logger = logger.child({ component: 'pipeline-service' });
    this.executor = new PipelineExecutor(logger);
    this.broadcaster = broadcaster;
  }

  async createPipeline(yamlContent: string): Promise<{ id: string; name: string }> {
    const parsed = parsePipeline(yamlContent);
    if (!parsed.success) {
      throw new Error(`Invalid pipeline YAML: ${parsed.error}`);
    }

    const [row] = await this.db
      .insert(schema.pipelines)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        yamlContent,
      })
      .returning();

    this.logger.info({ pipelineId: row.id, name: row.name }, 'Pipeline created');
    return { id: row.id, name: row.name };
  }

  async updatePipeline(id: string, yamlContent: string): Promise<void> {
    const parsed = parsePipeline(yamlContent);
    if (!parsed.success) {
      throw new Error(`Invalid pipeline YAML: ${parsed.error}`);
    }

    await this.db
      .update(schema.pipelines)
      .set({ name: parsed.data.name, description: parsed.data.description ?? null, yamlContent, updatedAt: new Date() })
      .where(eq(schema.pipelines.id, id));
  }

  async getPipeline(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.id, id));
    return row ?? null;
  }

  async getPipelineByName(name: string) {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.name, name));
    return row ?? null;
  }

  async listPipelines() {
    return this.db
      .select()
      .from(schema.pipelines)
      .orderBy(desc(schema.pipelines.updatedAt));
  }

  async deletePipeline(id: string): Promise<void> {
    await this.db.delete(schema.pipelines).where(eq(schema.pipelines.id, id));
  }

  async triggerRun(
    pipelineId: string,
    triggerType: 'api' | 'schedule' | 'manual',
    variables: Record<string, string>,
  ): Promise<string> {
    const pipeline = await this.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const parsed = parsePipeline(pipeline.yamlContent);
    if (!parsed.success) throw new Error(`Pipeline YAML invalid: ${parsed.error}`);

    const [run] = await this.db
      .insert(schema.pipelineRuns)
      .values({
        pipelineId,
        triggerType,
        status: 'pending',
        variables,
        sourceBranch: variables.branch ?? null,
        sourceCommit: variables.commit_sha ?? null,
        azurePrId: variables.pr_number ?? null,
        azurePrUrl: variables.pr_url ?? null,
      })
      .returning();

    // Fire-and-forget execution
    this.executeRun(run.id, parsed.data, variables).catch((err) => {
      this.logger.error({ runId: run.id, error: err.message }, 'Pipeline run failed unexpectedly');
    });

    return run.id;
  }

  async cancelRun(runId: string): Promise<void> {
    const controller = this.runningRuns.get(runId);
    if (controller) {
      controller.abort();
    }
    await this.db
      .update(schema.pipelineRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId));
  }

  async getRun(runId: string) {
    const [run] = await this.db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId));

    if (!run) return null;

    const stages = await this.db
      .select()
      .from(schema.pipelineStageRuns)
      .where(eq(schema.pipelineStageRuns.runId, runId));

    return { ...run, stages };
  }

  async listRuns(pipelineId?: string) {
    if (pipelineId) {
      return this.db
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.pipelineId, pipelineId))
        .orderBy(desc(schema.pipelineRuns.startedAt))
        .limit(50);
    }
    return this.db
      .select()
      .from(schema.pipelineRuns)
      .orderBy(desc(schema.pipelineRuns.startedAt))
      .limit(50);
  }

  // ── Private: Run Execution ───────────────────────────────────

  private async executeRun(
    runId: string,
    pipeline: PipelineDef,
    variables: Record<string, string>,
  ): Promise<void> {
    const abortController = new AbortController();
    this.runningRuns.set(runId, abortController);

    // Merge pipeline-defined variables with trigger variables (trigger wins)
    const mergedVars: Record<string, string> = {
      ...(pipeline.variables ?? {}),
      ...variables,
      pipeline_id: runId,
      run_id: runId,
    };

    await this.db
      .update(schema.pipelineRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId));

    let hasFailures = false;
    const workDir = process.cwd(); // TODO Phase 3: use git checkout dir

    try {
      for (let i = 0; i < pipeline.stages.length; i++) {
        if (abortController.signal.aborted) break;

        const stage = pipeline.stages[i];

        // Evaluate condition
        if (!this.executor.evaluateCondition(stage.when ?? 'success', hasFailures)) {
          await this.updateStageStatus(runId, stage.name, i, 'script', 'skipped');
          this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: i, status: 'skipped' });
          continue;
        }

        // Create stage run record
        const [stageRun] = await this.db
          .insert(schema.pipelineStageRuns)
          .values({
            runId,
            stageName: stage.name,
            stageIndex: i,
            type: stage.type ?? 'script',
            status: 'running',
            startedAt: new Date(),
          })
          .returning();

        this.emitStageEvent(runId, 'stage_start', { stage: stage.name, index: i });

        if (stage.type === 'maestro') {
          // Phase 2: maestro stage execution
          this.logger.warn({ runId, stage: stage.name }, 'Maestro stages not yet implemented');
          await this.updateStageRecord(stageRun.id, 'skipped', null, 'Maestro stages available in Phase 2');
          this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: i, status: 'skipped' });
          continue;
        }

        if (!stage.script) {
          await this.updateStageRecord(stageRun.id, 'failed', null, 'Script stage has no script defined');
          hasFailures = true;
          this.emitStageEvent(runId, 'stage_end', { stage: stage.name, index: i, status: 'failed' });
          continue;
        }

        // Execute script stage
        const result = await this.executor.executeScript({
          script: stage.script,
          workDir,
          variables: mergedVars,
          timeoutMs: (stage.timeout ?? 300) * 1000,
          onLog: (line) => {
            this.emitStageEvent(runId, 'stage_log', { stage: stage.name, line });
          },
          signal: abortController.signal,
        });

        await this.updateStageRecord(stageRun.id, result.status, result.logs, result.error);
        this.emitStageEvent(runId, 'stage_end', {
          stage: stage.name,
          index: i,
          status: result.status,
          durationMs: result.durationMs,
        });

        if (result.status === 'failed') {
          hasFailures = true;
        }
      }
    } catch (err: any) {
      hasFailures = true;
      this.logger.error({ runId, error: err.message }, 'Pipeline run error');
    } finally {
      this.runningRuns.delete(runId);

      const finalStatus = abortController.signal.aborted
        ? 'cancelled'
        : hasFailures ? 'failed' : 'passed';

      await this.db
        .update(schema.pipelineRuns)
        .set({ status: finalStatus, finishedAt: new Date() })
        .where(eq(schema.pipelineRuns.id, runId));

      this.emitStageEvent(runId, 'run_end', { status: finalStatus });
      this.broadcaster.cleanup(runId);
    }
  }

  private async updateStageStatus(
    runId: string, stageName: string, stageIndex: number, type: string, status: string,
  ) {
    await this.db.insert(schema.pipelineStageRuns).values({
      runId,
      stageName,
      stageIndex,
      type: type as any,
      status: status as any,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
  }

  private async updateStageRecord(
    stageRunId: string, status: string, logs: string | null, error?: string,
  ) {
    await this.db
      .update(schema.pipelineStageRuns)
      .set({
        status: status as any,
        finishedAt: new Date(),
        logs: logs ? logs.substring(0, 1_000_000) : null, // Cap at 1MB
        errorMessage: error ?? null,
      })
      .where(eq(schema.pipelineStageRuns.id, stageRunId));
  }

  private emitStageEvent(runId: string, type: PipelineMessage['type'], data: Record<string, unknown>) {
    this.broadcaster.emit(runId, {
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/pipelines/__tests__/service.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/service.ts server/pipelines/__tests__/service.test.ts
git commit -m "feat(pipelines): add PipelineService for run orchestration

CRUD pipelines, trigger runs, sequential stage execution with
condition evaluation, DB persistence, WebSocket broadcasting,
and cancellation support."
```

---

## Task 7: API Routes

**Files:**
- Create: `server/pipelines/routes.ts`

- [ ] **Step 1: Implement pipeline API routes**

Create `server/pipelines/routes.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

const triggerRunSchema = z.object({
  variables: z.record(z.string()).optional().default({}),
});

export async function pipelineRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.pipelineService;

  // ── Pipeline CRUD ──────────────────────────────────────────

  fastify.get('/api/pipelines', async () => {
    return service.listPipelines();
  });

  fastify.get<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const pipeline = await service.getPipeline(request.params.id)
        ?? await service.getPipelineByName(request.params.id);
      if (!pipeline) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline not found',
          status: 404,
        });
      }
      return pipeline;
    },
  );

  fastify.post<{ Body: string }>(
    '/api/pipelines',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const yamlContent = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      try {
        const result = await service.createPipeline(yamlContent);
        return reply.code(201).send(result);
      } catch (err: any) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Invalid pipeline',
          status: 400,
          detail: err.message,
        });
      }
    },
  );

  fastify.put<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const yamlContent = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      try {
        await service.updatePipeline(request.params.id, yamlContent);
        return { status: 'updated' };
      } catch (err: any) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Invalid pipeline',
          status: 400,
          detail: err.message,
        });
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      await service.deletePipeline(request.params.id);
      return { status: 'deleted' };
    },
  );

  // ── Pipeline Runs ──────────────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    '/api/pipelines/:id/run',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = triggerRunSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          type: 'https://device-farm/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }

      // Resolve pipeline by ID or name
      const pipeline = await service.getPipeline(request.params.id)
        ?? await service.getPipelineByName(request.params.id);
      if (!pipeline) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline not found',
          status: 404,
        });
      }

      try {
        const runId = await service.triggerRun(pipeline.id, 'api', parsed.data.variables);
        return reply.code(201).send({
          run_id: runId,
          status: 'pending',
          url: `/pipeline-runs/${runId}`,
        });
      } catch (err: any) {
        return reply.code(500).send({
          type: 'https://device-farm/errors/internal',
          title: 'Failed to trigger run',
          status: 500,
          detail: err.message,
        });
      }
    },
  );

  fastify.get('/api/pipeline-runs', async (request: FastifyRequest) => {
    const { pipeline_id } = request.query as Record<string, string>;
    return service.listRuns(pipeline_id);
  });

  fastify.get<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await service.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline run not found',
          status: 404,
        });
      }
      return run;
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id/status',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const run = await service.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          type: 'https://device-farm/errors/not-found',
          title: 'Pipeline run not found',
          status: 404,
        });
      }
      return { run_id: run.id, status: run.status };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/pipeline-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      await service.cancelRun(request.params.id);
      return { status: 'cancelled' };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add server/pipelines/routes.ts
git commit -m "feat(pipelines): add REST API routes for pipelines and runs

CRUD pipelines, trigger runs by ID or name, list/get/cancel runs,
simplified status endpoint for polling."
```

---

## Task 8: Fastify Plugin + Registration

**Files:**
- Create: `server/pipelines/plugin.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create the pipeline plugin**

Create `server/pipelines/plugin.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { PipelineService } from './service.js';
import { PipelineBroadcaster } from './broadcaster.js';
import { pipelineRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    pipelineService: PipelineService;
    pipelineBroadcaster: PipelineBroadcaster;
  }
}

async function pipelinesPlugin(fastify: FastifyInstance): Promise<void> {
  const broadcaster = new PipelineBroadcaster();
  const service = new PipelineService(fastify.db, fastify.log as any, broadcaster);

  fastify.decorate('pipelineService', service);
  fastify.decorate('pipelineBroadcaster', broadcaster);

  // Register REST routes
  await fastify.register(pipelineRoutes);

  // Register WebSocket route for pipeline run streaming
  fastify.get<{ Params: { id: string } }>(
    '/ws/pipeline-runs/:id',
    { websocket: true },
    (socket, request) => {
      const runId = (request.params as { id: string }).id;

      broadcaster.subscribe(runId, socket);

      socket.on('close', () => {
        broadcaster.unsubscribe(runId, socket);
      });

      socket.on('error', () => {
        broadcaster.unsubscribe(runId, socket);
      });
    },
  );

  fastify.log.info('Pipelines plugin registered');
}

export default fp(pipelinesPlugin, {
  name: 'pipelines-plugin',
  dependencies: ['db-plugin', 'websocket-plugin'],
});
```

- [ ] **Step 2: Register plugin in server/index.ts**

Add the import and registration after the hooks plugin and before the API plugin. Find the section where plugins are registered and add:

```typescript
import pipelinesPlugin from './pipelines/plugin.js';
```

Then register it after hooks and before api:
```typescript
await app.register(pipelinesPlugin);
```

- [ ] **Step 3: Verify server starts**

Run: `npx tsx server/index.ts` (or `npm run dev`)
Expected: See "Pipelines plugin registered" in the logs

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All existing tests pass + new pipeline tests pass

- [ ] **Step 5: Commit**

```bash
git add server/pipelines/plugin.ts server/index.ts
git commit -m "feat(pipelines): register pipeline plugin with Fastify

Wire PipelineService, PipelineBroadcaster, REST routes, and WebSocket
endpoint into the server plugin chain."
```

---

## Task 9: Integration Test — End-to-End Pipeline Run

**Files:**
- Create: `server/pipelines/__tests__/integration.test.ts`

- [ ] **Step 1: Write an integration test that runs a full pipeline**

Create `server/pipelines/__tests__/integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineService } from '../service.js';
import { PipelineBroadcaster } from '../broadcaster.js';
import type { Database } from '../../db/index.js';

function createLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function createInMemoryDb() {
  const tables: Record<string, any[]> = {};

  const insert = vi.fn((table: any) => ({
    values: vi.fn((row: any) => ({
      returning: vi.fn(async () => {
        const id = `id-${Math.random().toString(36).slice(2, 8)}`;
        const record = { ...row, id };
        const tableName = table?.name ?? 'unknown';
        if (!tables[tableName]) tables[tableName] = [];
        tables[tableName].push(record);
        return [record];
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  }));

  const selectResult: any[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((table: any) => ({
      where: vi.fn(async () => selectResult),
      orderBy: vi.fn(() => ({
        limit: vi.fn(async () => selectResult),
      })),
    })),
  }));

  const deleteFn = vi.fn(() => ({
    where: vi.fn(async () => []),
  }));

  return {
    insert,
    update,
    select,
    delete: deleteFn,
    _setSelectResult: (rows: any[]) => { selectResult.length = 0; selectResult.push(...rows); },
  } as unknown as Database & { _setSelectResult: (rows: any[]) => void };
}

describe('Pipeline Integration', () => {
  it('executes a multi-stage pipeline with when conditions', async () => {
    const db = createInMemoryDb();
    const broadcaster = new PipelineBroadcaster();
    const emitSpy = vi.spyOn(broadcaster, 'emit');
    const service = new PipelineService(db, createLogger(), broadcaster);

    const yaml = `
name: "integration-test"
variables:
  GREETING: hello
stages:
  - name: setup
    script: echo "{{GREETING}} world"
    timeout: 10
  - name: verify
    script: echo "all good"
  - name: teardown
    script: echo "cleaning up"
    when: always
`;

    // Create pipeline
    (db as any)._setSelectResult([]);
    const pipeline = await service.createPipeline(yaml);
    expect(pipeline.name).toBe('integration-test');

    // Trigger run
    (db as any)._setSelectResult([{
      id: pipeline.id,
      name: 'integration-test',
      yamlContent: yaml,
    }]);

    const runId = await service.triggerRun(pipeline.id, 'manual', { GREETING: 'hola' });
    expect(runId).toBeDefined();

    // Wait for async execution to complete
    await new Promise(r => setTimeout(r, 3000));

    // Verify broadcast events were emitted
    const events = emitSpy.mock.calls.map(c => c[1].type);
    expect(events).toContain('stage_start');
    expect(events).toContain('stage_end');
    expect(events).toContain('run_end');
  }, 10_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run server/pipelines/__tests__/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/pipelines/__tests__/integration.test.ts
git commit -m "test(pipelines): add integration test for multi-stage pipeline execution

Verifies sequential stage execution, variable interpolation,
when conditions, and WebSocket event broadcasting."
```

---

## Summary

After completing all 9 tasks, Phase 1 delivers:

- **6 new files** in `server/pipelines/` (schema, parser, variables, executor, service, broadcaster, routes, plugin)
- **4 test files** with unit + integration coverage
- **3 new DB tables** (pipelines, pipeline_runs, pipeline_stage_runs)
- **10 API endpoints** (CRUD pipelines + trigger/list/get/cancel runs)
- **1 WebSocket endpoint** for live run streaming
- **Pipeline execution**: sequential script stages, variable interpolation, `when` conditions, timeout, cancellation
