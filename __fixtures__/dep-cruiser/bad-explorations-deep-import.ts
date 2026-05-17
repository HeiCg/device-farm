/**
 * Fixture for Phase 35 dep-cruiser rule 12 (no-deep-imports-into-explorations-internal).
 * This file deliberately reaches into server/explorations/internal/ from OUTSIDE the
 * explorations module — depcruise must flag it as a violation when invoked against
 * this fixture. Used by server/hooks/__tests__/dep-cruiser.spec.ts to prove
 * structural enforcement (test at runtime; CI graph excludes __fixtures__/ via
 * the `includeOnly: '^server/'` filter, so this fixture does NOT add to the
 * baseline violation count).
 */
// @ts-expect-error — intentional rule violation for spec
import { createExplorationsModule } from '../../server/explorations/internal/module.js';

export const _violation = createExplorationsModule;
