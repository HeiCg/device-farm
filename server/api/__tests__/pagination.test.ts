import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  buildMetadataFilters,
  buildPaginatedResponse,
} from '../pagination.js';
import { listJobsQuerySchema, createJobSchema } from '../validation.js';

describe('cursor encoding/decoding', () => {
  it('roundtrip preserves createdAt and id', () => {
    const createdAt = new Date('2026-01-15T10:30:00Z');
    const id = '550e8400-e29b-41d4-a716-446655440000';

    const cursor = encodeCursor({ createdAt, id });
    const decoded = decodeCursor(cursor);

    expect(decoded.createdAt.getTime()).toBe(createdAt.getTime());
    expect(decoded.id).toBe(id);
  });

  it('produces a base64url string without padding', () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: 'abc-123',
    });

    // base64url: no +, no /, no =
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('decodeCursor throws on garbage input', () => {
    expect(() => decodeCursor('not-a-valid-cursor!!!')).toThrow();
  });

  it('decodeCursor throws on empty string', () => {
    expect(() => decodeCursor('')).toThrow();
  });
});

describe('buildMetadataFilters', () => {
  it('extracts metadata.* keys and returns filter descriptors', () => {
    const query = {
      'metadata.branch': 'main',
      'metadata.pr': '42',
      status: 'running',
      limit: '20',
    };

    const filters = buildMetadataFilters(query);

    expect(filters).toHaveLength(2);
    expect(filters).toContainEqual({ key: 'branch', value: 'main' });
    expect(filters).toContainEqual({ key: 'pr', value: '42' });
  });

  it('ignores non-metadata keys', () => {
    const query = {
      status: 'running',
      limit: '20',
      cursor: 'abc',
    };

    const filters = buildMetadataFilters(query);
    expect(filters).toHaveLength(0);
  });

  it('handles empty query', () => {
    const filters = buildMetadataFilters({});
    expect(filters).toHaveLength(0);
  });
});

describe('buildPaginatedResponse', () => {
  const encodeFn = (item: { id: string }) => `cursor-${item.id}`;

  it('returns hasMore=true when items exceed limit', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const result = buildPaginatedResponse(items, 2, encodeFn);

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('cursor-2');
  });

  it('returns hasMore=false when items fit within limit', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = buildPaginatedResponse(items, 5, encodeFn);

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it('returns hasMore=false for empty items', () => {
    const result = buildPaginatedResponse([], 10, encodeFn);

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it('handles exactly limit items as no more pages', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = buildPaginatedResponse(items, 2, encodeFn);

    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });
});

describe('listJobsQuerySchema', () => {
  it('accepts valid query with defaults', () => {
    const result = listJobsQuerySchema.parse({});

    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.platform).toBeUndefined();
  });

  it('coerces string limit to number', () => {
    const result = listJobsQuerySchema.parse({ limit: '50' });
    expect(result.limit).toBe(50);
  });

  it('rejects limit below 1', () => {
    expect(() => listJobsQuerySchema.parse({ limit: '0' })).toThrow();
  });

  it('rejects limit above 100', () => {
    expect(() => listJobsQuerySchema.parse({ limit: '101' })).toThrow();
  });

  it('accepts valid status values', () => {
    const result = listJobsQuerySchema.parse({ status: 'running' });
    expect(result.status).toBe('running');
  });

  it('rejects invalid status', () => {
    expect(() => listJobsQuerySchema.parse({ status: 'invalid' })).toThrow();
  });

  it('accepts valid platform values', () => {
    const result = listJobsQuerySchema.parse({ platform: 'ios' });
    expect(result.platform).toBe('ios');
  });
});

describe('createJobSchema', () => {
  it('accepts valid platform', () => {
    const result = createJobSchema.parse({ platform: 'android' });
    expect(result.platform).toBe('android');
  });

  it('rejects invalid platform', () => {
    expect(() => createJobSchema.parse({ platform: 'windows' })).toThrow();
  });
});
