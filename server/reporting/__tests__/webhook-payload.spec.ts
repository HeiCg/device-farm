/**
 * Phase 37 Plan 37-05 — webhook payload extension spec.
 *
 * Proves the Phase 37 additive payload fields (preflight / analysis / parallelDeploy)
 * land on the webhook envelope without breaking pre-37 consumers (SPEC-08 additive
 * invariant). The builder reads from optional analysis + preflight module repos;
 * when those modules are not configured (config absence), the fields are null
 * but the rest of the body is unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildWebhookPayload, type WebhookPayloadDeps } from '../internal/webhook-payload.js';
import type { JobLike } from '../internal/webhook-payload.js';

// ---------- shared fixtures ----------

function makeBaseJob(overrides: Partial<JobLike> = {}): JobLike {
  return {
    id: 'job-123',
    status: 'passed',
    platform: 'android',
    metadata: null,
    ...overrides,
  };
}

function noopDeps(): WebhookPayloadDeps {
  return { analysisModule: null, preflightModule: null };
}

describe('phase-37 webhook payload extension', () => {
  it('preserves existing v3 fields when phase-37 modules absent', async () => {
    const job = makeBaseJob();
    const payload = await buildWebhookPayload(noopDeps(), job, 'job.completed');

    expect(payload.event).toBe('job.completed');
    expect(payload.job).toMatchObject({ id: 'job-123', status: 'passed', platform: 'android' });
    expect(typeof payload.timestamp).toBe('string');
    // Phase-37 fields present but null (additive — SPEC-08).
    expect(payload.analysis).toBeNull();
    expect(payload.preflight).toBeNull();
    expect(payload.parallelDeploy).toBeNull();
  });

  it('populates analysis when analyses row exists for jobId', async () => {
    const analysisRow = {
      id: 'analysis-1',
      jobId: 'job-123',
      buildArtifactId: null,
      platform: 'ios' as const,
      payload: {
        schema_version: 1 as const,
        platform: 'ios' as const,
        app: { bundle_id: 'com.example.app', version: '1.0.0' },
        react_native_bundle: null,
        stats: { candidate_screens: 3, total_classes: 0, total_swift_types: 0 },
        candidate_screens: [],
        deep_link_entries: [
          { scheme: 'exampleapp', is_oauth_callback: false },
          { scheme: 'examplehttps', is_oauth_callback: true },
        ],
        known_gaps: [],
      },
      createdAt: new Date('2026-05-16T00:00:00Z'),
    };
    const deps: WebhookPayloadDeps = {
      analysisModule: {
        repo: {
          getByJobId: vi.fn(async () => analysisRow),
        },
      },
      preflightModule: null,
    };

    const payload = await buildWebhookPayload(deps, makeBaseJob({ platform: 'ios' }), 'job.completed');

    expect(payload.analysis).not.toBeNull();
    expect(payload.analysis?.analysisId).toBe('analysis-1');
    expect(payload.analysis?.candidateScreensCount).toBe(3);
    expect(payload.analysis?.deepLinks).toEqual([
      { scheme: 'exampleapp', is_oauth_callback: false },
      { scheme: 'examplehttps', is_oauth_callback: true },
    ]);
  });

  it('populates preflight when job.metadata.preflightRunId set', async () => {
    const preflightRow = {
      id: 'preflight-1',
      platform: 'ios' as const,
      filename: 'app.ipa',
      fileSizeBytes: 1024,
      rulesVersion: '2026-05-17',
      status: 'pass_with_warnings',
      blockers: [],
      warnings: [
        {
          rule_id: 'ENCRYPTION-EXPORT-MISSING',
          severity: 'warning' as const,
          message: 'missing ITSAppUsesNonExemptEncryption',
        },
      ],
      createdAt: new Date(),
    };
    const deps: WebhookPayloadDeps = {
      analysisModule: null,
      preflightModule: {
        repo: {
          getById: vi.fn(async () => preflightRow),
        },
      },
    };
    const job = makeBaseJob({
      platform: 'ios',
      metadata: { preflightRunId: 'preflight-1' },
    });

    const payload = await buildWebhookPayload(deps, job, 'job.completed');

    expect(payload.preflight).not.toBeNull();
    expect(payload.preflight?.pass).toBe(true);
    expect(payload.preflight?.rulesVersion).toBe('2026-05-17');
    expect(payload.preflight?.blockers).toEqual([]);
    expect(payload.preflight?.warnings).toHaveLength(1);
    expect(payload.preflight?.warnings[0].rule_id).toBe('ENCRYPTION-EXPORT-MISSING');
  });

  it('populates parallelDeploy from job.metadata.parallelDeploy', async () => {
    const job = makeBaseJob({
      metadata: {
        mode: 'parallel-deploy',
        parallelDeploy: {
          deviceCount: 3,
          devices: [
            { deviceId: 'd1', status: 'passed', durationMs: 120 },
            { deviceId: 'd2', status: 'passed', durationMs: 130 },
            { deviceId: 'd3', status: 'failed', error: 'install failure' },
          ],
        },
      },
    });

    const payload = await buildWebhookPayload(noopDeps(), job, 'job.completed');

    expect(payload.parallelDeploy).not.toBeNull();
    expect(payload.parallelDeploy?.deviceCount).toBe(3);
    expect(payload.parallelDeploy?.devices).toHaveLength(3);
    expect(payload.parallelDeploy?.devices[2].status).toBe('failed');
  });

  it('all phase-37 fields null when no associated data', async () => {
    const deps: WebhookPayloadDeps = {
      analysisModule: {
        repo: { getByJobId: vi.fn(async () => null) },
      },
      preflightModule: {
        repo: { getById: vi.fn(async () => null) },
      },
    };
    const job = makeBaseJob();

    const payload = await buildWebhookPayload(deps, job, 'job.completed');

    expect(payload.analysis).toBeNull();
    expect(payload.preflight).toBeNull();
    expect(payload.parallelDeploy).toBeNull();
  });

  it('preflight status="blocked" maps to pass:false', async () => {
    const preflightRow = {
      id: 'preflight-2',
      platform: 'ios' as const,
      filename: 'app.ipa',
      fileSizeBytes: 2048,
      rulesVersion: '2026-05-17',
      status: 'blocked',
      blockers: [
        {
          rule_id: 'ITMS-91053-USERDEFAULTS',
          severity: 'blocker' as const,
          message: 'missing reason',
        },
      ],
      warnings: [],
      createdAt: new Date(),
    };
    const deps: WebhookPayloadDeps = {
      analysisModule: null,
      preflightModule: {
        repo: {
          getById: vi.fn(async () => preflightRow),
        },
      },
    };
    const job = makeBaseJob({
      metadata: { preflightRunId: 'preflight-2' },
    });

    const payload = await buildWebhookPayload(deps, job, 'job.completed');

    expect(payload.preflight?.pass).toBe(false);
    expect(payload.preflight?.blockers).toHaveLength(1);
  });
});
