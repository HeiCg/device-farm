/**
 * Spec for QUEUE_NAMES central module — Phase 15 Plan 05, Task 5.1.
 *
 * Validates charset rules for pg-boss v12 queue names (RESEARCH §1 pitfall #6):
 *   - Must start with a lowercase letter
 *   - Remaining characters limited to [a-z0-9._-]
 *   - No uppercase, whitespace, or punctuation outside the allowlist
 *
 * Also pins the invariant that every `QUEUE_NAMES[*]` constant satisfies the regex,
 * so downstream modules cannot ship an illegal queue name via the shared module.
 */
import { describe, it, expect } from 'vitest';
import { isValidQueueName, QUEUE_NAMES } from '../names.js';

const QUEUE_NAME_RE = /^[a-z][a-z0-9._-]*$/;

describe('isValidQueueName', () => {
  it('accepts a standard dotted lowercase name', () => {
    expect(isValidQueueName('job.execute')).toBe(true);
  });

  it('rejects an uppercase letter anywhere in the name', () => {
    expect(isValidQueueName('Job.Execute')).toBe(false);
  });

  it('rejects a colon (pg-boss v12 forbids colons)', () => {
    expect(isValidQueueName('job:execute')).toBe(false);
  });

  it('rejects a name that does not start with a letter', () => {
    expect(isValidQueueName('123abc')).toBe(false);
  });
});

describe('QUEUE_NAMES registry', () => {
  it('every value matches the pg-boss v12 charset regex', () => {
    for (const value of Object.values(QUEUE_NAMES)) {
      expect(value, `QUEUE_NAMES entry "${value}" must satisfy ${QUEUE_NAME_RE}`)
        .toMatch(QUEUE_NAME_RE);
    }
  });

  it('exposes the DEMO queue used by Phase 15 spikes + integration tests', () => {
    expect(QUEUE_NAMES.DEMO).toBe('demo');
  });

  it('Phase 25 — PIPELINE_SCHEDULED_EXECUTE entry exists + valid', () => {
    expect(QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE).toBe('pipeline.scheduled.execute');
    expect(isValidQueueName(QUEUE_NAMES.PIPELINE_SCHEDULED_EXECUTE)).toBe(true);
  });

  it('Phase 35 — EXPLORATION_RUN entry exists + valid', () => {
    expect(QUEUE_NAMES.EXPLORATION_RUN).toBe('exploration.run');
    expect(isValidQueueName(QUEUE_NAMES.EXPLORATION_RUN)).toBe(true);
  });
});
