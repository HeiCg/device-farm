// INTENTIONALLY INVALID — this file imports a deep internal path that the
// .dependency-cruiser.cjs `no-deep-imports-into-lifecycle-internal` rule forbids.
//
// This file exists only to exercise the dep-cruiser rule from a test;
// it is excluded from `npm run dep-check` via the config's `includeOnly: '^server/'`.
// The spec at server/hooks/__tests__/dep-cruiser.spec.ts (Phase 18 extension)
// invokes depcruise explicitly against THIS file and asserts the rule fires.
//
// The target file server/lifecycle/internal/module.ts is created by plan 18-03.
// BEFORE plan 18-03 ships, the import path is syntactically valid at TS level
// (path is a string specifier; the resolver still errors but the depcruise rule
// fires BEFORE module-resolution — it matches on the IMPORT STRING regex).
//
// If the import below breaks TypeScript compilation for this fixture file at a
// later date, suppress with a directive rather than deleting:
//   // @ts-expect-error — plan 18-03 creates the target
// @ts-expect-error — plan 18-03 creates server/lifecycle/internal/module.ts
import { createLifecycleModule } from '../../server/lifecycle/internal/module.js';

// Keep the symbol referenced so TS does not tree-shake the import.
export const _proof = typeof createLifecycleModule;
