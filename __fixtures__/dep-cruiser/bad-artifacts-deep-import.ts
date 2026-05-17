/**
 * Phase 21 / Plan 21-00 — dep-cruiser fixture for `no-deep-imports-into-artifacts-internal`.
 *
 * This file DELIBERATELY imports from server/artifacts/internal/* — outside
 * the allowed scope `pathNot: '^server/artifacts/'`. dep-cruiser (via the rule
 * added in .dependency-cruiser.cjs) should flag this import as a violation.
 *
 * @ts-expect-error suppresses the TS error that would fire because Plan 21-00
 * only ships a throw-stub at server/artifacts/internal/module.ts. Plan 21-04
 * overwrites that file with the real createArtifactsModule factory.
 */
// @ts-expect-error — intentional fixture triggering no-deep-imports-into-artifacts-internal
import { createArtifactsModule } from '../../server/artifacts/internal/module.js';

// Reference the import so esbuild/tsx doesn't tree-shake it away.
void createArtifactsModule;
