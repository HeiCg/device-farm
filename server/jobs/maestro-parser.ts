import stripAnsi from 'strip-ansi';
import type { JobStep, JobSummary, ParserCallbacks } from './types.js';

const FLOW_START = /^(?:\[shard \d+\] )?Running flow (.+)$/;
const COMMAND_STATUS =
  /^(?:\[shard \d+\] )?(.+?) (COMPLETED|FAILED|SKIPPED|RUNNING)$/;
const FLOW_RESULT =
  /^(?:\[shard \d+\] )?\[(Passed|Failed|Canceled)\] (.+?) \((\d+)s\)$/;
const SUITE_SUMMARY = /^(\d+)\/(\d+) Flows? (Passed|Failed)/;

export interface MaestroParserOpts {
  clock?: () => Date;
}

export class MaestroParser {
  private callbacks: ParserCallbacks;
  private clock: () => Date;
  private currentFlow: string | null = null;
  private flowResults: Map<string, 'passed' | 'failed' | 'skipped'> =
    new Map();
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

  parseLine(rawLine: string): void {
    const line = stripAnsi(rawLine).trim();
    if (!line) return;

    // Match patterns in priority order: SUITE_SUMMARY > FLOW_RESULT > COMMAND_STATUS > FLOW_START
    let match: RegExpMatchArray | null;

    match = line.match(SUITE_SUMMARY);
    if (match) {
      const passed = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      this.suiteSummary = { passed, total };
      this.callbacks.onSummary(passed, total);
      return;
    }

    match = line.match(FLOW_RESULT);
    if (match) {
      const status = match[1]; // Passed, Failed, Canceled
      const flow = match[2];
      const durationMs = parseInt(match[3], 10) * 1000;

      let normalizedStatus: 'passed' | 'failed' | 'skipped';
      if (status === 'Passed') {
        normalizedStatus = 'passed';
      } else if (status === 'Failed') {
        normalizedStatus = 'failed';
      } else {
        normalizedStatus = 'skipped';
      }

      this.flowResults.set(flow, normalizedStatus);
      this.flowDurations.set(flow, durationMs);

      this.steps.push({
        flowName: flow,
        command: null,
        status: normalizedStatus,
        durationMs,
      });

      this.callbacks.onFlowResult(flow, status, durationMs);
      return;
    }

    match = line.match(COMMAND_STATUS);
    if (match) {
      const command = match[1];
      const status = match[2];

      // Track individual command steps (Maestro emits these for each action)
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
          const now = this.clock();
          this.commandTimestamps.set(key, { startedAt: now, endedAt: now });
        }
      }

      // Deduplicate: Maestro emits command status twice (RUNNING then COMPLETED/FAILED).
      // Only keep the terminal status by replacing or adding.
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

    match = line.match(FLOW_START);
    if (match) {
      const flowName = match[1];
      this.currentFlow = flowName;
      this.callbacks.onFlowStart(flowName);
      return;
    }

    // Unrecognized line
    this.rawOutput.push(line);
  }

  /**
   * Get steps. Returns flow-level steps when available (multi-flow runs),
   * or command-level steps for single-flow runs where Maestro doesn't emit
   * [Passed]/[Failed] flow result lines.
   */
  getSteps(): JobStep[] {
    if (this.steps.length > 0) {
      return [...this.steps];
    }
    // Single-flow mode: return command-level steps
    return [...this.commandSteps];
  }

  /** Get only command-level steps (always populated). */
  getCommandSteps(): JobStep[] {
    return [...this.commandSteps];
  }

  getCommandTimestamps(): Map<string, { startedAt: Date; endedAt?: Date }> {
    return new Map(this.commandTimestamps);
  }

  getSummary(): JobSummary {
    // If we have flow-level results, use those
    if (this.flowResults.size > 0) {
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      for (const status of this.flowResults.values()) {
        if (status === 'passed') passed++;
        else if (status === 'failed') failed++;
        else if (status === 'skipped') skipped++;
      }
      return { total: passed + failed + skipped, passed, failed, skipped };
    }

    // Fallback: derive summary from command steps
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const step of this.commandSteps) {
      if (step.status === 'passed') passed++;
      else if (step.status === 'failed') failed++;
      else if (step.status === 'skipped') skipped++;
    }
    return { total: passed + failed + skipped, passed, failed, skipped };
  }

  getRawOutput(): string {
    return this.rawOutput.join('\n');
  }
}
