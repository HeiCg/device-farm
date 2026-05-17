/**
 * Phase 24 / Plan 24-01 — Maestro events full body spec.
 *
 * Proves:
 *   - MAESTRO_EVENT_NAMES (2 keys, EVENTS-03 dotted past-tense)
 *   - maestroRegistry has 2 entries; both transient (TRACE-08); aggregateType='maestro'
 *   - MAESTRO_AGGREGATE_ID == uuidv5('maestro', URL_NS)
 *   - payload schemas accept valid + reject malformed samples
 *   - makeMaestroEmitters returns 2 typed function helpers
 */
import { describe, it, expect } from 'vitest';
import { v5 as uuidv5 } from 'uuid';

import { TypedBus } from '../../bus/bus.js';
import {
  MAESTRO_EVENT_NAMES,
  MAESTRO_AGGREGATE_ID,
  maestroRegistry,
  makeMaestroEmitters,
  maestroHierarchyFetchedPayload,
  maestroDeviceInfoCollectedPayload,
} from '../events.js';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('maestro events.ts (Plan 24-01)', () => {
  it('exposes 2 dotted past-tense event names per EVENTS-03', () => {
    const values = Object.values(MAESTRO_EVENT_NAMES);
    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(2);
    for (const name of values) {
      expect(name).toMatch(/^maestro\.[a-z-]+\.[a-z]+$/);
    }
  });

  it('maestroRegistry has 2 entries; both transient; aggregateType=maestro', () => {
    const keys = Object.keys(maestroRegistry);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      const entry = (maestroRegistry as Record<string, { persisted: boolean; aggregateType: string }>)[key];
      expect(entry.persisted).toBe(false);
      expect(entry.aggregateType).toBe('maestro');
    }
  });

  it('MAESTRO_AGGREGATE_ID matches uuidv5("maestro", URL_NS)', () => {
    const derived = uuidv5('maestro', URL_NAMESPACE);
    expect(MAESTRO_AGGREGATE_ID).toBe(derived);
  });

  it('maestroHierarchyFetchedPayload accepts valid + rejects invalid source', () => {
    const valid = maestroHierarchyFetchedPayload.safeParse({
      deviceId: '11111111-1111-4111-8111-111111111111',
      source: 'maestro-cli',
      elementCount: 5,
      fetchTimeMs: 12.5,
    });
    expect(valid.success).toBe(true);

    const invalid = maestroHierarchyFetchedPayload.safeParse({
      deviceId: '11111111-1111-4111-8111-111111111111',
      source: 'invalid-source',
      elementCount: 0,
      fetchTimeMs: 0,
    });
    expect(invalid.success).toBe(false);
  });

  it('maestroDeviceInfoCollectedPayload accepts nullable os/model + rejects bad UUID', () => {
    const valid = maestroDeviceInfoCollectedPayload.safeParse({
      deviceId: '22222222-2222-4222-8222-222222222222',
      osVersion: null,
      model: null,
    });
    expect(valid.success).toBe(true);

    const invalid = maestroDeviceInfoCollectedPayload.safeParse({
      deviceId: 'not-a-uuid',
      osVersion: '14',
      model: 'Pixel 6',
    });
    expect(invalid.success).toBe(false);
  });

  it('makeMaestroEmitters returns 2 typed function helpers', () => {
    const bus = new TypedBus(maestroRegistry);
    const emit = makeMaestroEmitters(bus);
    expect(Object.keys(emit)).toEqual(['hierarchyFetched', 'deviceInfoCollected']);
    expect(typeof emit.hierarchyFetched).toBe('function');
    expect(typeof emit.deviceInfoCollected).toBe('function');
  });
});
