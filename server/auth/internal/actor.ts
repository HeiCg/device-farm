/**
 * Auth module — TRACE-10 actor schema + helpers.
 *
 * Phase 26 SUBSTRATE (Plan 26-00). Lives at substrate level because
 * Plan 26-02 lifecycle-ownership.spec readFileSync grep-guards import
 * `actorSchema` to assert zero `'anonymous'` literals leak through.
 *
 * Format: flat string `<type>:<id>` for typed actors, bare string for
 * untyped. Persisted to events.actor TEXT column (already exists per
 * Phase 15 schema — TRACE-07 satisfied). 4 forms:
 *   - `user:{userId}`        — authenticated request via user account (future)
 *   - `apikey:{apiKeyId}`    — authenticated request via Bearer API key
 *   - `system`               — boot-time emit / no-context default
 *   - `cron[:{queueName}]`   — pg-boss scheduled worker (queue suffix optional)
 *
 * ANTI-PATTERN: do NOT include `'anonymous'` in this regex. The Phase 26
 * fallback default migration (Plan 26-02) replaces `'anonymous' → 'system'`
 * at server/bus/helpers.ts:94. Any grandfathered events.actor row with
 * `'anonymous'` is left as-is (column is TEXT, no FK); only NEW emits
 * route through this schema.
 */
import { z } from 'zod';

export const actorSchema = z.string().regex(
  /^(user:[a-z0-9-]+|apikey:[a-z0-9-]+|system|cron(:[a-z0-9-]+)?)$/,
  { message: 'actor must match user:<id> | apikey:<id> | system | cron[:<queue>]' },
);

export type Actor = z.infer<typeof actorSchema>;

/** Construct an apikey actor literal — `apikey:{apiKeyId}`. */
export function asApiKeyActor(apiKeyId: string): Actor {
  return `apikey:${apiKeyId}`;
}

/** Construct a user actor literal — `user:{userId}`. */
export function asUserActor(userId: string): Actor {
  return `user:${userId}`;
}

/** Boot-time / no-context default actor literal. */
export const SYSTEM_ACTOR: Actor = 'system';

/** pg-boss scheduled worker default actor literal. */
export const CRON_ACTOR: Actor = 'cron';
