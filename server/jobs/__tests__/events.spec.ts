/**
 * Phase 23 / Plan 23-00 — events.spec stub (MOD-04 tests-as-spec entry).
 *
 * Plan 23-00 ships ONE test asserting EVENTS-03 shape (11 dotted past-tense
 * keys, no duplicates). Plan 23-01 extends with payload schema parses,
 * jobsRegistry persistence flags (TRACE-08), and emit-helper envelope
 * stamping (correlationId from ALS). Plan 23-04 may add more cases.
 *
 * MOD-04 alignment: this file is .spec.ts (not .test.ts); the existing
 * Phase 1-era *.test.ts files in this directory get renamed via `git mv`
 * 100% similarity in Plan 23-07 (job-service.test.ts → .spec.ts etc.).
 */
import { describe, it, expect } from 'vitest';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import {
  JOB_EVENT_NAMES,
  jobsRegistry,
  makeJobsEmitters,
  jobAllocatedPayload,
  jobRunningPayload,
  jobRecordingRequestedPayload,
  jobCleanupRequestedPayload,
  jobFailedPayload,
  systemDrainCompletedPayload,
  systemDrainResumedPayload,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';
import type { Envelope } from '../../events/envelope.js';

describe('jobs/events.ts JOB_EVENT_NAMES — Phase 23 Plan 23-00 substrate', () => {
  it('has exactly 13 keys (Phase 22 bridgehead 6 + Phase 23 keystone 5 + Plan 23-05 drain 2)', () => {
    const keys = Object.keys(JOB_EVENT_NAMES);
    expect(keys).toHaveLength(13);
  });

  it('every value matches dotted-past-tense pattern (EVENTS-03)', () => {
    const values = Object.values(JOB_EVENT_NAMES);
    const pattern = /^[a-z]+(\.[a-z]+)+$/;
    for (const v of values) {
      expect(v).toMatch(pattern);
    }
  });

  it('values are unique (no accidental duplicates after Phase 23 extension)', () => {
    const values = Object.values(JOB_EVENT_NAMES);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it('contains the 5 Phase 23 keystone names verbatim', () => {
    expect(JOB_EVENT_NAMES.ALLOCATED).toBe('job.allocated');
    expect(JOB_EVENT_NAMES.RUNNING).toBe('job.running');
    expect(JOB_EVENT_NAMES.RECORDING_REQUESTED).toBe('job.recording.requested');
    expect(JOB_EVENT_NAMES.CLEANUP_REQUESTED).toBe('job.cleanup.requested');
    expect(JOB_EVENT_NAMES.FAILED).toBe('job.failed');
  });

  it('contains the 2 Phase 23 Plan 23-05 system.drain.* names verbatim', () => {
    expect(JOB_EVENT_NAMES.DRAIN_COMPLETED).toBe('system.drain.completed');
    expect(JOB_EVENT_NAMES.DRAIN_RESUMED).toBe('system.drain.resumed');
  });
});

describe('jobs/events.ts jobsRegistry + makeJobsEmitters — Phase 23 Plan 23-01', () => {
  it('jobsRegistry has exactly 13 entries (Phase 22 bridgehead 6 + Phase 23 keystone 5 + Plan 23-05 drain 2)', () => {
    expect(Object.keys(jobsRegistry)).toHaveLength(13);
  });

  it('TRACE-08 persistence flags: 6 persisted, 7 transient', () => {
    const entries = Object.values(jobsRegistry);
    const persisted = entries.filter((e) => e.persisted);
    const transient = entries.filter((e) => !e.persisted);
    expect(persisted).toHaveLength(6);
    expect(transient).toHaveLength(7);

    // Specifics — only completed/recording.requested/cleanup.requested/failed are persisted
    expect(jobsRegistry['job.completed'].persisted).toBe(true);
    expect(jobsRegistry['job.recording.requested'].persisted).toBe(true);
    expect(jobsRegistry['job.cleanup.requested'].persisted).toBe(true);
    expect(jobsRegistry['job.failed'].persisted).toBe(true);
    // Plan 23-05 — system.drain.* are persisted (TRACE-08 operational telemetry).
    expect(jobsRegistry['system.drain.completed'].persisted).toBe(true);
    expect(jobsRegistry['system.drain.resumed'].persisted).toBe(true);

    // Specifics — allocated/running are NOT persisted (transient saga state)
    expect(jobsRegistry['job.allocated'].persisted).toBe(false);
    expect(jobsRegistry['job.running'].persisted).toBe(false);
  });

  it('11 entries have aggregateType="job", 2 entries have aggregateType="system" (Plan 23-05 DEFERRED-23-B)', () => {
    const entries = Object.values(jobsRegistry);
    const job = entries.filter((e) => e.aggregateType === 'job');
    const system = entries.filter((e) => e.aggregateType === 'system');
    expect(job).toHaveLength(11);
    expect(system).toHaveLength(2);

    // Specifics — system.drain.* events use aggregateType:'system'
    expect(jobsRegistry['system.drain.completed'].aggregateType).toBe('system');
    expect(jobsRegistry['system.drain.resumed'].aggregateType).toBe('system');
  });

  it('systemDrainCompletedPayload parses valid + rejects malformed', () => {
    expect(systemDrainCompletedPayload.safeParse({
      drainedAt: '2026-05-08T12:00:00.000Z',
      durationMs: 1234,
    }).success).toBe(true);
    expect(systemDrainCompletedPayload.safeParse({
      drainedAt: 'not-an-iso',
      durationMs: 1234,
    }).success).toBe(false);
    expect(systemDrainCompletedPayload.safeParse({
      drainedAt: '2026-05-08T12:00:00.000Z',
      durationMs: -5,
    }).success).toBe(false);
  });

  it('systemDrainResumedPayload parses valid + rejects malformed', () => {
    expect(systemDrainResumedPayload.safeParse({
      resumedAt: '2026-05-08T12:00:00.000Z',
    }).success).toBe(true);
    expect(systemDrainResumedPayload.safeParse({
      resumedAt: 'bad',
    }).success).toBe(false);
    expect(systemDrainResumedPayload.safeParse({}).success).toBe(false);
  });

  it('jobAllocatedPayload parses valid + rejects malformed', () => {
    expect(jobAllocatedPayload.safeParse({ jobId: 'j1', deviceId: 'd1', platform: 'android' }).success).toBe(true);
    expect(jobAllocatedPayload.safeParse({ jobId: 'j1', deviceId: 'd1' }).success).toBe(false); // missing platform
    expect(jobAllocatedPayload.safeParse({ jobId: 'j1', deviceId: 'd1', platform: 'web' }).success).toBe(false); // bad enum
  });

  it('jobRunningPayload parses valid + rejects malformed', () => {
    expect(jobRunningPayload.safeParse({ jobId: 'j1', deviceId: 'd1', platform: 'ios' }).success).toBe(true);
    expect(jobRunningPayload.safeParse({ jobId: 'j1' }).success).toBe(false);
  });

  it('jobRecordingRequestedPayload parses valid + rejects malformed', () => {
    expect(jobRecordingRequestedPayload.safeParse({ jobId: 'j1', recordingId: 'r1', outputPath: '/tmp/r.mp4' }).success).toBe(true);
    expect(jobRecordingRequestedPayload.safeParse({ jobId: 'j1', recordingId: 'r1' }).success).toBe(false);
  });

  it('jobCleanupRequestedPayload parses valid', () => {
    expect(jobCleanupRequestedPayload.safeParse({ jobId: 'j1' }).success).toBe(true);
  });

  it('jobFailedPayload parses valid + rejects bad step enum', () => {
    expect(jobFailedPayload.safeParse({ jobId: 'j1', step: 'allocate', reason: 'no devices' }).success).toBe(true);
    expect(jobFailedPayload.safeParse({ jobId: 'j1', step: 'run', reason: 'maestro exit 1' }).success).toBe(true);
    expect(jobFailedPayload.safeParse({ jobId: 'j1', step: 'unknown', reason: 'foo' }).success).toBe(false);
  });

  it('makeJobsEmitters returns 13 typed helpers including 5 keystone + 2 drain helpers', () => {
    const bus = new TypedBus(jobsRegistry);
    const emit = makeJobsEmitters(bus);
    const keys = Object.keys(emit).sort();
    expect(keys).toEqual([
      'allocated',
      'cleanupRequested',
      'completed',
      'drainCompleted',
      'drainResumed',
      'failed',
      'log',
      'maestroLogWritten',
      'recordingRequested',
      'running',
      'started',
      'status',
      'step',
    ]);
    // Sanity: each is a function
    for (const k of keys) {
      expect(typeof (emit as Record<string, unknown>)[k]).toBe('function');
    }
  });

  it('emit.failed stamps envelope with type=job.failed + correlationId + aggregateType=job + aggregateId=jobId', async () => {
    const bus = new TypedBus(jobsRegistry);
    const captured: Envelope[] = [];
    const emit = makeJobsEmitters(bus, (env) => captured.push(env));

    const cid = randomUUID();
    const jobId = randomUUID();
    // Plain-object ALS store shape (Phase 20+ canonical).
    await asyncLocalStorage.run(
      { correlationId: cid, currentEventId: null, actor: 'events-spec' } as never,
      async () => {
        emit.failed(jobId, { jobId, step: 'allocate', reason: 'no devices available' });
      },
    );

    expect(captured).toHaveLength(1);
    const env = captured[0];
    expect(env.type).toBe('job.failed');
    expect(env.correlationId).toBe(cid);
    expect(env.aggregateType).toBe('job');
    expect(env.aggregateId).toBe(jobId);
    expect(env.payload).toEqual({ jobId, step: 'allocate', reason: 'no devices available' });
  });
});
