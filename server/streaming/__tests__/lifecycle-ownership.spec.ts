/**
 * Phase 22 / Plan 22-04 — Streaming lifecycle ownership spec (SC2 structural).
 *
 * Proves that Plan 22-02's surgery landed + stays landed:
 *   - Zero imperative this.jobBroadcaster?.emit() or this.jobBroadcaster!.emit()
 *     callsites in server/jobs/job-service.ts (SC2 main clause).
 *   - At least 7 this.jobsEmit?.log|step|status() callsites (replacement path).
 *   - Exactly 1 this.jobBroadcaster!.cleanup() call KEPT (buffer lifecycle;
 *     SC2 non-violation per RESEARCH §Pitfall 6 Option A; MODULE.md §Non-Goals
 *     landed in Plan 22-05).
 *
 * Also asserts the substitute path exists in streaming/internal/module.ts:
 *   - wsEnvelopeSchema.safeParse call (subscriber wraps + validates).
 *   - 3 jobsModule.bus.on(...) subscriptions.
 *
 * Non-DB; pure readFileSync + regex-count. Runs in <100ms on all hosts.
 * Complements integration-level proof in Plan 22-03 subscriber.spec +
 * correlation.spec — those prove the substitute path WORKS; this spec proves
 * the imperative path is GONE and stays gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const jobServicePath = resolve(__dirname, '../../jobs/job-service.ts');
const jobServiceSource = readFileSync(jobServicePath, 'utf8');

const streamingModulePath = resolve(__dirname, '../internal/module.ts');
const streamingModuleSource = readFileSync(streamingModulePath, 'utf8');

function countMatches(source: string, pattern: string): number {
  // Patterns are hardcoded test strings (not user input) — ReDoS not applicable.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const re = new RegExp(pattern, 'g');
  return (source.match(re) || []).length;
}

describe('[Phase 22 SC2] streaming lifecycle ownership', () => {
  it('job-service.ts has zero imperative jobBroadcaster.emit callsites (SC2 main clause)', () => {
    // Optional-chained emit calls
    expect(
      countMatches(jobServiceSource, 'this\\.jobBroadcaster\\?\\.emit\\('),
    ).toBe(0);
    // Non-null-asserted emit calls (inside onFlowStart/onFlowResult/onCommandStatus/onStdoutLine)
    expect(
      countMatches(jobServiceSource, 'this\\.jobBroadcaster!\\.emit\\('),
    ).toBe(0);
  });

  it('job-service.ts has the 7 substitute jobsEmit callsites (SC2 substitute clause)', () => {
    const logCount = countMatches(jobServiceSource, 'this\\.jobsEmit\\?\\.log\\(');
    const stepCount = countMatches(jobServiceSource, 'this\\.jobsEmit\\?\\.step\\(');
    const statusCount = countMatches(jobServiceSource, 'this\\.jobsEmit\\?\\.status\\(');

    // Plan 22-02 callsite map:
    //   status: 2 callsites (running + terminal)
    //   log: 3 callsites (hook + command + stdout)
    //   step: 2 callsites (onFlowStart + onFlowResult)
    expect(logCount).toBeGreaterThanOrEqual(3);
    expect(stepCount).toBeGreaterThanOrEqual(2);
    expect(statusCount).toBeGreaterThanOrEqual(2);
    expect(logCount + stepCount + statusCount).toBeGreaterThanOrEqual(7);
  });

  it('[Phase 22 SC2 non-violation] this.jobBroadcaster.cleanup() KEPT for buffer lifecycle (MODULE.md §Non-Goals)', () => {
    // The 5-second-delayed cleanup at server/jobs/job-service.ts is buffer
    // lifecycle — NOT an emit. SC2 ("no producer calls broadcaster.emit
    // directly") is about EMIT. Cleanup is exempt. Documented in Plan 22-05
    // MODULE.md §Non-Goals. Planner chose Option A from RESEARCH §Pitfall 6
    // (keep cleanup; Phase 23 saga rewrites executeJob can replace with
    // job.cleanup.requested event then).
    expect(
      countMatches(jobServiceSource, 'this\\.jobBroadcaster!\\.cleanup\\('),
    ).toBe(1);
  });

  it('streaming/internal/module.ts has the substitute subscriber path', () => {
    // Proves the SC2 substitute path exists (integration-tested in Plan 22-03).

    // Subscriber wraps in envelope + validates via safeParse.
    expect(
      countMatches(streamingModuleSource, 'wsEnvelopeSchema\\.safeParse\\('),
    ).toBeGreaterThanOrEqual(1);

    // Subscribes to 3 event types on fastify.jobsModule.bus.
    expect(
      countMatches(streamingModuleSource, 'jobsModule\\.bus\\.on\\('),
    ).toBeGreaterThanOrEqual(3);

    // emit.frameDropped fires on safeParse failure (drop path).
    expect(
      countMatches(streamingModuleSource, 'emit\\.frameDropped\\('),
    ).toBeGreaterThanOrEqual(1);

    // broadcaster.emit is the wire to live WS clients + ring buffer.
    expect(
      countMatches(streamingModuleSource, 'jobBroadcaster\\.emit\\('),
    ).toBeGreaterThanOrEqual(1);
  });
});
