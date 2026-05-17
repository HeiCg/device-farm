/**
 * Fixture for Phase 34 dep-cruiser rule 11 (no-deep-imports-into-sessions-internal).
 * This file deliberately reaches into server/sessions/internal/ from OUTSIDE the
 * sessions module — depcruise must flag it as a violation when invoked against
 * this fixture. Used by server/hooks/__tests__/dep-cruiser.spec.ts to prove
 * structural enforcement (test at runtime; CI graph excludes __fixtures__/ via
 * the `includeOnly: '^server/'` filter, so this fixture does NOT add to the
 * baseline violation count).
 */
// @ts-expect-error — intentional rule violation for spec
import { createSessionsModule } from '../../server/sessions/internal/module.js';

export const _violation = createSessionsModule;
