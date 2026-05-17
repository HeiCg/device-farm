// INTENTIONALLY INVALID — this file imports a deep internal path that the
// .dependency-cruiser.cjs `no-deep-imports-into-reporting-internal` rule forbids.
//
// This file exists only to exercise the dep-cruiser rule from a test;
// it is excluded from `npm run dep-check` via the config's `includeOnly: '^server/'`.
// The spec at server/hooks/__tests__/dep-cruiser.spec.ts (Phase 19 extension)
// invokes depcruise explicitly against THIS file and asserts the rule fires.
//
// The target file server/reporting/internal/module.ts is a 4-line stub until
// plan 19-03 overwrites it with the real createReportingModule factory. The
// @ts-expect-error directive below suppresses any transient TS resolution issue
// during the overwrite window.
// @ts-expect-error — plan 19-03 overwrites server/reporting/internal/module.ts with the real factory
import { createReportingModule } from '../../server/reporting/internal/module.js';

// Keep the symbol referenced so TS does not tree-shake the import.
export const _proof = typeof createReportingModule;
