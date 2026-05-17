import { sql, lt, eq, and, or, type SQL } from 'drizzle-orm';
import { jobs } from '../db/schema.js';

export interface CursorData {
  createdAt: Date;
  id: string;
}

export interface MetadataFilter {
  key: string;
  value: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Encode a (createdAt, id) pair into a base64url cursor string.
 */
export function encodeCursor(item: CursorData): string {
  const payload = JSON.stringify({
    c: item.createdAt.toISOString(),
    i: item.id,
  });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

/**
 * Decode a base64url cursor string back into (createdAt, id).
 * Throws on invalid input.
 */
export function decodeCursor(cursor: string): CursorData {
  if (!cursor) {
    throw new Error('Cursor cannot be empty');
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    const createdAt = new Date(parsed.c);
    if (isNaN(createdAt.getTime())) {
      throw new Error('Invalid date in cursor');
    }
    if (typeof parsed.i !== 'string' || !parsed.i) {
      throw new Error('Invalid id in cursor');
    }
    return { createdAt, id: parsed.i };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid')) {
      throw error;
    }
    throw new Error('Invalid cursor format');
  }
}

/**
 * Build a Drizzle WHERE clause for keyset pagination using (createdAt, id).
 * Returns: (createdAt < cursorDate) OR (createdAt = cursorDate AND id < cursorId)
 */
export function buildCursorWhere(cursor: string): SQL {
  const { createdAt, id } = decodeCursor(cursor);
  return or(
    lt(jobs.createdAt, createdAt),
    and(eq(jobs.createdAt, createdAt), lt(jobs.id, id)),
  )!;
}

/**
 * Extract metadata.* query parameters and return filter descriptors.
 * e.g. { 'metadata.branch': 'main' } -> [{ key: 'branch', value: 'main' }]
 */
export function buildMetadataFilters(
  query: Record<string, string>,
): MetadataFilter[] {
  const filters: MetadataFilter[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('metadata.')) {
      const jsonKey = key.slice('metadata.'.length);
      if (jsonKey) {
        filters.push({ key: jsonKey, value });
      }
    }
  }
  return filters;
}

/**
 * Convert metadata filter descriptors to Drizzle SQL conditions for JSONB queries.
 */
export function buildMetadataSQL(filters: MetadataFilter[]): SQL[] {
  return filters.map(
    (f) => sql`${jobs.metadata}->>${f.key} = ${f.value}`,
  );
}

/**
 * Build a paginated response from a query result.
 * Expects items fetched with limit + 1 to detect hasMore.
 * If items.length > limit, removes the last item and returns cursor for the last visible item.
 */
export function buildPaginatedResponse<T>(
  items: T[],
  limit: number,
  encodeFn: (item: T) => string,
): PaginatedResponse<T> {
  if (items.length > limit) {
    const data = items.slice(0, limit);
    const lastItem = data[data.length - 1];
    return {
      data,
      cursor: encodeFn(lastItem),
      hasMore: true,
    };
  }
  return {
    data: items,
    cursor: null,
    hasMore: false,
  };
}
