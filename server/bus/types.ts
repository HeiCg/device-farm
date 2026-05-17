/**
 * Phase 15 / Plan 15-04 / Task 4.1 — event registry types.
 *
 * Every event known to the bus is declared once in a registry entry:
 *   - `schema` — Zod schema for the payload (validated at emit()).
 *   - `persisted` — whether the bus middleware should INSERT this event into
 *     the `events` table (TRACE-08).
 *   - `aggregateType` — the noun the event belongs to (`'job'`, `'device'`, ...),
 *     used to stamp `envelope.aggregateType` without repeating the first dotted
 *     segment everywhere.
 *
 * `EventRegistry` is indexed by the literal event-type string. TS narrowing in
 * `TypedBus.on<T>` / `.emit<T>` works off this object (keyof R & string) so
 * callers get payload inference directly from the event-type string literal.
 *
 * `PayloadOf<R, T>` infers the payload type for a given event — used by the
 * bus methods and by the per-module emit helpers (plan 15-04 Task 4.2).
 */
import type { z } from 'zod';

export interface EventRegistryEntry<S extends z.ZodType> {
  readonly schema: S;
  readonly persisted: boolean;
  readonly aggregateType: string;
}

export type EventRegistry = {
  readonly [type: string]: EventRegistryEntry<z.ZodType>;
};

export type PayloadOf<R extends EventRegistry, T extends keyof R & string> =
  z.infer<R[T]['schema']>;
