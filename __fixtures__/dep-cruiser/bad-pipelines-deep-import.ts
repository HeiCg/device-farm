/**
 * Fixture for Phase 25 dep-cruiser rule 9 (no-deep-imports-into-pipelines-internal).
 * This file deliberately reaches into server/pipelines/internal/ from OUTSIDE the
 * pipelines module — depcruise must flag it as a violation when invoked against
 * this fixture. Used by server/hooks/__tests__/dep-cruiser.spec.ts to prove
 * structural enforcement (test at runtime; CI graph excludes __fixtures__/ via
 * the `includeOnly: '^server/'` filter, so this fixture does NOT add to the
 * baseline violation count).
 */
// @ts-expect-error — intentional rule violation for spec
import { createPipelinesModule } from '../../server/pipelines/internal/module.js';

export const _violation = createPipelinesModule;
