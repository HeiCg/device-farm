/**
 * Phase 37 Plan 37-01 — analysis repo spec.
 *
 * DB-gated. Tests the create/getByJobId/getById round-trip.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../../db/schema.js';
import type { Database } from '../../db/index.js';
import * as repo from '../internal/repo.js';
import type { SkeletonPayload } from '../schemas.js';

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

const samplePayload: SkeletonPayload = {
  schema_version: 1,
  platform: 'ios',
  app: { bundle_id: 'com.example.repo', version: '0.1.0', executable: 'RepoTest' },
  react_native_bundle: { detected: true, hermes: true, bundle_path: 'main.jsbundle' },
  stats: { total_classes: 1, total_swift_types: 0 },
  candidate_screens: [{ name: 'HomeScreen', source: 'hermes_strings', confidence: 'high' }],
  deep_link_entries: [],
  known_gaps: [],
};

describeDb('Phase 37 — analysis repo (DB-gated)', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let testJobId: string;
  let testDeviceId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    client = postgres(DB_URL!, { max: 5 });
    db = drizzle(client, { schema }) as unknown as Database;

    testDeviceId = randomUUID();
    await db.insert(schema.devices).values({
      id: testDeviceId, type: 'ios', name: 'test-device-repo', status: 'idle', emulatorId: 'em-repo',
    }).onConflictDoNothing();

    testJobId = randomUUID();
    await db.insert(schema.jobs).values({
      id: testJobId, status: 'passed', platform: 'ios', deviceId: testDeviceId,
    });
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await db.delete(schema.analyses).where(inArray(schema.analyses.id, createdIds));
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    await db.delete(schema.jobs).where(eq(schema.jobs.id, testJobId));
    await db.delete(schema.devices).where(eq(schema.devices.id, testDeviceId));
    await client.end();
  });

  it('create + getByJobId round-trip', async () => {
    const { id } = await repo.create(db, {
      jobId: testJobId, buildArtifactId: null, platform: 'ios', payload: samplePayload,
    });
    createdIds.push(id);
    expect(id).toMatch(/[0-9a-f-]{36}/);

    const got = await repo.getByJobId(db, testJobId);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(id);
    expect(got!.platform).toBe('ios');
    expect(got!.payload.app.bundle_id).toBe('com.example.repo');
  });

  it('getById returns the inserted row', async () => {
    const { id } = await repo.create(db, {
      jobId: testJobId, buildArtifactId: null, platform: 'ios', payload: samplePayload,
    });
    createdIds.push(id);
    const got = await repo.getById(db, id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(id);
  });

  it('getByJobId returns null for unknown id', async () => {
    const got = await repo.getByJobId(db, randomUUID());
    expect(got).toBeNull();
  });

  it('getByJobId returns the MOST RECENT analysis when multiple exist', async () => {
    const { id: id1 } = await repo.create(db, {
      jobId: testJobId, buildArtifactId: null, platform: 'ios', payload: samplePayload,
    });
    createdIds.push(id1);
    await new Promise((r) => setTimeout(r, 10));
    const { id: id2 } = await repo.create(db, {
      jobId: testJobId, buildArtifactId: null, platform: 'ios', payload: samplePayload,
    });
    createdIds.push(id2);
    const got = await repo.getByJobId(db, testJobId);
    expect(got!.id).toBe(id2);
  });
});
