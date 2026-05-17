/**
 * Phase 23 / Plan 23-00 — Fixture for dep-cruiser rule 7 (no-deep-imports-into-jobs-internal).
 *
 * This file lives outside server/ so it does NOT contribute to the npm run
 * dep-check graph, but is targeted explicitly by the dep-cruiser.spec via
 * --include-only override (Phase 16 Plan 16-03 pattern). Importing
 * server/jobs/internal/module.js from this path fires rule 7.
 *
 * @ts-expect-error — intentional rule violation (test-only)
 */
import { createJobsModule } from '../../server/jobs/internal/module.js';

// Reference the import so TypeScript does not tree-shake it away in fixture compilation.
void createJobsModule;
