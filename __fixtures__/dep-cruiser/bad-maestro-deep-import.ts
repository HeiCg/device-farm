/**
 * Phase 24 / Plan 24-00 — dep-cruiser fixture for `no-deep-imports-into-maestro-internal`.
 *
 * This file DELIBERATELY imports from server/maestro/internal/* — outside
 * the allowed scope `pathNot: '^server/maestro/'`. dep-cruiser (via the rule
 * added in .dependency-cruiser.cjs in this plan) should flag this import as
 * a violation.
 *
 * @ts-expect-error suppresses the TS error that would fire because Plan 24-00
 * only ships a throw-stub at server/maestro/internal/module.ts. Plan 24-03
 * overwrites that file with the real createMaestroModule factory.
 */
// @ts-expect-error — intentional fixture triggering no-deep-imports-into-maestro-internal
import { createMaestroModule } from '../../server/maestro/internal/module.js';

// Reference the import so esbuild/tsx doesn't tree-shake it away.
void createMaestroModule;
