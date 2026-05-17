// server/websocket/__tests__/frames.spec.ts
// Phase 17 Plan 17-02 — WebSocket frame round-trip canary.
//
// Proves each canonical fixture in contracts/ws-fixtures/ survives
// parse + re-serialize through its module's per-variant Zod schema
// without field loss. This is the TS lane of the dual round-trip harness;
// cli/internal/types/generated_test.go (17-03) is the Go lane.
//
// When the fixtures + schemas stay in lockstep, both lanes pass.
// If a schema field changes but a fixture doesn't, THIS test fails
// before the Go lane does — clear, early feedback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  jobLogMessage,
  jobStepMessage,
  jobStatusMessage,
  jobMessageUnion,
} from '../../jobs/ws-schemas.js';
import {
  devicePreviewMessage,
  poolMessageUnion,
} from '../../pool/ws-schemas.js';

const FIXTURES_DIR = resolve('contracts/ws-fixtures');

function loadFixture(name: string): unknown {
  const raw = readFileSync(resolve(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(raw);
}

describe('WebSocket frame round-trip (TS lane)', () => {
  describe('jobs — /ws/jobs/:id', () => {
    it('job-log.sample.json parses via jobLogMessage', () => {
      const sample = loadFixture('job-log.sample.json');
      const result = jobLogMessage.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('log');
        expect(result.data.level).toBeDefined();
      }
    });

    it('job-step.sample.json parses via jobStepMessage', () => {
      const sample = loadFixture('job-step.sample.json');
      const result = jobStepMessage.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('step');
        expect(result.data.stepIndex).toBeTypeOf('number');
      }
    });

    it('job-status.sample.json parses via jobStatusMessage', () => {
      const sample = loadFixture('job-status.sample.json');
      const result = jobStatusMessage.safeParse(sample);
      expect(result.success).toBe(true);
    });

    it.each([
      ['job-log.sample.json', 'log'],
      ['job-step.sample.json', 'step'],
      ['job-status.sample.json', 'status'],
    ])('%s dispatches via jobMessageUnion to %s', (fixture, expectedType) => {
      const sample = loadFixture(fixture);
      const result = jobMessageUnion.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(expectedType);
      }
    });

    it.each([
      ['job-log.sample.json'],
      ['job-step.sample.json'],
      ['job-status.sample.json'],
    ])('%s survives parse -> stringify -> parse round-trip', (fixture) => {
      const sample = loadFixture(fixture);
      const first = jobMessageUnion.safeParse(sample);
      expect(first.success).toBe(true);
      if (!first.success) return;
      const reSerialized = JSON.parse(JSON.stringify(first.data)) as unknown;
      const second = jobMessageUnion.safeParse(reSerialized);
      expect(second.success).toBe(true);
      if (second.success) {
        expect(second.data).toEqual(first.data);
      }
    });
  });

  describe('pool — /ws/devices/:id/preview', () => {
    it('device-preview.sample.json parses via devicePreviewMessage', () => {
      const sample = loadFixture('device-preview.sample.json');
      const result = devicePreviewMessage.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('preview');
        expect(result.data.frame.length).toBeGreaterThan(0);
      }
    });

    it('device-preview.sample.json dispatches via poolMessageUnion', () => {
      const sample = loadFixture('device-preview.sample.json');
      const result = poolMessageUnion.safeParse(sample);
      expect(result.success).toBe(true);
    });
  });

  describe('cross-variant rejection', () => {
    it('job-log fixture FAILS parse via jobStepMessage (discriminator mismatch)', () => {
      const sample = loadFixture('job-log.sample.json');
      const result = jobStepMessage.safeParse(sample);
      expect(result.success).toBe(false);
    });

    it('device-preview fixture FAILS parse via jobMessageUnion', () => {
      const sample = loadFixture('device-preview.sample.json');
      const result = jobMessageUnion.safeParse(sample);
      expect(result.success).toBe(false);
    });
  });
});
