/**
 * Phase 20 / Plan 20-00 — dep-cruiser fixture for `no-deep-imports-into-pool-internal`.
 *
 * This file DELIBERATELY imports from server/pool/internal/* — outside
 * the allowed scope `pathNot: '^server/pool/'`. dep-cruiser (via the rule
 * added in .dependency-cruiser.cjs) should flag this import as a violation.
 *
 * @ts-expect-error suppresses the TS error that would fire because Plan 20-00
 * only ships a throw-stub at server/pool/internal/module.ts. Plan 20-03
 * overwrites that file with the real createPoolModule factory.
 */
// @ts-expect-error — intentional fixture triggering no-deep-imports-into-pool-internal
import { createPoolModule } from '../../server/pool/internal/module.js';

// Reference the import so esbuild/tsx doesn't tree-shake it away.
void createPoolModule;
