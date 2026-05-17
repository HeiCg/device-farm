// INTENTIONALLY INVALID — this file imports a deep internal path that the
// .dependency-cruiser.cjs `no-deep-imports-into-hooks-internal` rule forbids.
//
// This file exists only to exercise the dep-cruiser rule from a test;
// it is excluded from `npm run dep-check` via the config's `includeOnly: '^server/'`.
// The spec at server/hooks/__tests__/dep-cruiser.spec.ts invokes depcruise
// explicitly against THIS file and asserts the rule fires.
import { HookExecutor } from '../../server/hooks/internal/hook-executor.js';

// Keep the symbol referenced so TS does not tree-shake the import on strict settings.
export const _proof = HookExecutor.name;
