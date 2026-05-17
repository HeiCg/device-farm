/**
 * Phase 21 / Plan 21-02 — Artifacts events spec (MOD-03, EVENTS-03, TRACE-04, TRACE-08).
 *
 * Proves:
 *   1. ARTIFACTS_EVENT_NAMES shape (EVENTS-03 dotted past-tense).
 *   2. artifactsRegistry shape (3 entries; aggregateType='artifacts'; persistence flags).
 *   3. ARTIFACTS_AGGREGATE_ID equals uuidv5('artifacts', URL_NAMESPACE) — single-source-of-truth.
 *   4. Payload schemas accept valid + reject malformed.
 *   5. makeArtifactsEmitters returns {artifactCreated, recordingStarted, recordingStopped}.
 *   6. emit.artifactCreated stamps envelope with ALS correlationId + aggregateType +
 *      aggregateId + v=1 (TRACE-04).
 *   7. emit.recordingStarted stamps envelope with method discriminator.
 *
 * No DB. Uses asyncLocalStorage plain-object store shape (Phase 20 canonical —
 * NOT legacy Map shape; grep guard forbids `new` + `Map(` + array-array init in this file).
 */
import { describe, it, expect } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import { asyncLocalStorage } from '@fastify/request-context';
import { randomUUID } from 'node:crypto';

import {
  ARTIFACTS_EVENT_NAMES,
  ARTIFACTS_AGGREGATE_ID,
  artifactsRegistry,
  makeArtifactsEmitters,
  artifactCreatedPayload,
  recordingStartedPayload,
  recordingStoppedPayload,
} from '../events.js';
import { TypedBus } from '../../bus/bus.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('[Phase 21-02] ARTIFACTS_EVENT_NAMES (EVENTS-03)', () => {
  it('has 3 dotted past-tense event names', () => {
    expect(ARTIFACTS_EVENT_NAMES.ARTIFACT_CREATED).toBe('artifact.created');
    expect(ARTIFACTS_EVENT_NAMES.RECORDING_STARTED).toBe('recording.started');
    expect(ARTIFACTS_EVENT_NAMES.RECORDING_STOPPED).toBe('recording.stopped');
    expect(Object.keys(ARTIFACTS_EVENT_NAMES)).toHaveLength(3);
    for (const v of Object.values(ARTIFACTS_EVENT_NAMES)) {
      expect(v).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});

describe('[Phase 21-02] artifactsRegistry (MOD-03 + TRACE-08)', () => {
  it('has 3 entries with aggregateType="artifacts"', () => {
    const entries = Object.entries(artifactsRegistry);
    expect(entries).toHaveLength(3);
    for (const [, entry] of entries) {
      expect(entry.aggregateType).toBe('artifacts');
    }
  });

  it('persistence flags: artifact.created=true; recording.started/stopped=false (TRACE-08)', () => {
    expect(artifactsRegistry['artifact.created'].persisted).toBe(true);
    expect(artifactsRegistry['recording.started'].persisted).toBe(false);
    expect(artifactsRegistry['recording.stopped'].persisted).toBe(false);
  });
});

describe('[Phase 21-02] ARTIFACTS_AGGREGATE_ID v5 derivation', () => {
  it('matches uuidv5("artifacts", URL_NAMESPACE) — single source of truth', () => {
    expect(ARTIFACTS_AGGREGATE_ID).toBe(uuidv5('artifacts', URL_NAMESPACE));
  });

  it('matches v5 UUID regex shape (version=5, variant=RFC4122)', () => {
    expect(ARTIFACTS_AGGREGATE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('[Phase 21-02] payload schemas', () => {
  it('artifactCreatedPayload accepts valid sample', () => {
    const parsed = artifactCreatedPayload.safeParse({
      artifactId: randomUUID(),
      jobId: randomUUID(),
      type: 'video',
      filePath: '/tmp/job/recording.mp4',
      fileName: 'recording.mp4',
      mimeType: 'video/mp4',
      fileSizeBytes: 123456,
    });
    expect(parsed.success).toBe(true);
  });

  it('artifactCreatedPayload accepts null fileSizeBytes (adb fallback path)', () => {
    const parsed = artifactCreatedPayload.safeParse({
      artifactId: randomUUID(),
      jobId: randomUUID(),
      type: 'video',
      filePath: '/tmp/x.mp4',
      fileName: 'x.mp4',
      mimeType: 'video/mp4',
      fileSizeBytes: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('artifactCreatedPayload rejects missing required field (artifactId)', () => {
    const parsed = artifactCreatedPayload.safeParse({
      jobId: randomUUID(),
      type: 'video',
      filePath: '/tmp/x.mp4',
      fileName: 'x.mp4',
      mimeType: 'video/mp4',
      fileSizeBytes: null,
    });
    expect(parsed.success).toBe(false);
  });

  it('recordingStartedPayload enforces method discriminator enum', () => {
    const ok = recordingStartedPayload.safeParse({
      jobId: randomUUID(), recordingId: randomUUID(), deviceId: randomUUID(),
      platform: 'android', method: 'scrcpy',
    });
    expect(ok.success).toBe(true);

    const bad = recordingStartedPayload.safeParse({
      jobId: randomUUID(), recordingId: randomUUID(), deviceId: randomUUID(),
      platform: 'android', method: 'ffmpeg',   // not in enum
    });
    expect(bad.success).toBe(false);
  });

  it('recordingStoppedPayload requires frameCount and codec', () => {
    const parsed = recordingStoppedPayload.safeParse({
      jobId: randomUUID(), recordingId: randomUUID(),
      outputPath: '/tmp/x.mp4',
      durationSec: 12.5, frameCount: 375, codec: 'h264',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('[Phase 21-02] makeArtifactsEmitters + ALS envelope (TRACE-04)', () => {
  it('returns 3 typed helpers', () => {
    const bus = new TypedBus(artifactsRegistry);
    const emit = makeArtifactsEmitters(bus);
    expect(typeof emit.artifactCreated).toBe('function');
    expect(typeof emit.recordingStarted).toBe('function');
    expect(typeof emit.recordingStopped).toBe('function');
  });

  it('emit.artifactCreated stamps envelope with ALS correlationId + aggregateType + aggregateId + v=1', async () => {
    const bus = new TypedBus(artifactsRegistry);
    const captured: { envelope?: unknown } = {};
    const onEmit = (env: unknown) => { captured.envelope = env; };
    const emit = makeArtifactsEmitters(bus, onEmit as never);

    const corrId = randomUUID();
    const artifactId = randomUUID();

    // PLAIN-OBJECT ALS store shape per Phase 20 canonical — NOT legacy Map.
    await asyncLocalStorage.run(
      { correlationId: corrId, currentEventId: null, actor: 'events-spec' } as never,
      async () => {
        emit.artifactCreated(artifactId, {
          artifactId,
          jobId: randomUUID(),
          type: 'video',
          filePath: '/tmp/rec.mp4',
          fileName: 'rec.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 5000,
        });
      },
    );

    const env = captured.envelope as { type: string; v: number; correlationId: string; aggregateType: string; aggregateId: string };
    expect(env.type).toBe('artifact.created');
    expect(env.v).toBe(1);
    expect(env.correlationId).toBe(corrId);
    expect(env.aggregateType).toBe('artifacts');
    expect(env.aggregateId).toBe(artifactId);
  });
});
