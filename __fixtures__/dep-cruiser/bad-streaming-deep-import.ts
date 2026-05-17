/**
 * Phase 22 / Plan 22-00 — dep-cruiser fixture for `no-deep-imports-into-streaming-internal`.
 *
 * This file DELIBERATELY imports from server/streaming/internal/* — outside
 * the allowed scope `pathNot: '^server/streaming/'`. dep-cruiser (via the rule
 * added in .dependency-cruiser.cjs in this plan) should flag this import as
 * a violation.
 *
 * @ts-expect-error suppresses the TS error that would fire because Plan 22-00
 * only ships a throw-stub at server/streaming/internal/module.ts. Plan 22-02
 * overwrites that file with the real createStreamingModule factory.
 */
// @ts-expect-error — intentional fixture triggering no-deep-imports-into-streaming-internal
import { createStreamingModule } from '../../server/streaming/internal/module.js';

// Reference the import so esbuild/tsx doesn't tree-shake it away.
void createStreamingModule;
