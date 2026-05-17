import { describe, expect, it } from 'vitest';
import { ZodError, type ZodType } from 'zod';
import {
  ArtifactIdSchema,
  DeviceIdSchema,
  JobIdSchema,
  PipelineIdSchema,
  RecordingIdSchema,
  toArtifactId,
  toDeviceId,
  toJobId,
  toPipelineId,
  toRecordingId,
} from '../ids.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const INVALID_UUID = 'not-a-uuid';

type BrandRow = [name: string, schema: ZodType<unknown, unknown>, toFn: (v: string) => unknown];

const rows: BrandRow[] = [
  ['JobId', JobIdSchema as unknown as ZodType<unknown, unknown>, toJobId as (v: string) => unknown],
  ['DeviceId', DeviceIdSchema as unknown as ZodType<unknown, unknown>, toDeviceId as (v: string) => unknown],
  ['PipelineId', PipelineIdSchema as unknown as ZodType<unknown, unknown>, toPipelineId as (v: string) => unknown],
  ['ArtifactId', ArtifactIdSchema as unknown as ZodType<unknown, unknown>, toArtifactId as (v: string) => unknown],
  ['RecordingId', RecordingIdSchema as unknown as ZodType<unknown, unknown>, toRecordingId as (v: string) => unknown],
];

describe('branded ID schemas', () => {
  it.each(rows)('%s schema parses a valid UUID', (_name, schema) => {
    expect(schema.parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each(rows)('%s schema rejects an invalid UUID with ZodError', (_name, schema) => {
    expect(() => schema.parse(INVALID_UUID)).toThrow(ZodError);
  });

  it.each(rows)('%s toFn mirrors schema parse behaviour', (_name, _schema, toFn) => {
    expect(toFn(VALID_UUID)).toBe(VALID_UUID);
    expect(() => toFn(INVALID_UUID)).toThrow(ZodError);
  });
});
