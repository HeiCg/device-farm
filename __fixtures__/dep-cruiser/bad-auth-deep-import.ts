/**
 * Fixture for Phase 26 dep-cruiser rule 10 (no-deep-imports-into-auth-internal).
 * This file deliberately reaches into server/auth/internal/ from OUTSIDE the
 * auth module — depcruise must flag it as a violation when invoked against
 * this fixture. Used by server/hooks/__tests__/dep-cruiser.spec.ts to prove
 * structural enforcement (test at runtime; CI graph excludes __fixtures__/ via
 * the `includeOnly: '^server/'` filter, so this fixture does NOT add to the
 * baseline violation count).
 */
// @ts-expect-error — intentional rule violation for spec
import { createAuthModule } from '../../server/auth/internal/module.js';

export const _violation = createAuthModule;
