// .dependency-cruiser.cjs — Phase 16 Plan 03 (MOD-02 structural enforcement);
//                            Phase 18 Plan 00 extends with lifecycle/internal rule;
//                            Phase 19 Plan 00 extends with reporting/internal rule;
//                            Phase 20 Plan 00 extends with pool/internal rule;
//                            Phase 21 Plan 00 extends with artifacts/internal rule;
//                            Phase 22 Plan 00 extends with streaming/internal rule;
//                            Phase 23 Plan 00 extends with jobs/internal rule;
//                            Phase 24 Plan 00 extends with maestro/internal rule;
//                            Phase 25 Plan 00 extends with pipelines/internal rule;
//                            Phase 26 Plan 00 extends with auth/internal rule;
//                            Phase 34 Plan 00 extends with sessions/internal rule;
//                            Phase 35 Plan 00 extends with explorations/internal rule;
//                            Phase 36 Plan 00 extends with discovery sole-caller rule.
//
// Fourteen forbidden rules:
//   1. no-deep-imports-into-hooks-internal — nothing outside server/hooks/**
//      may reach into server/hooks/internal/**. Public API comes from
//      server/hooks/index.ts barrel.
//   2. no-deep-imports-into-lifecycle-internal — Phase 18 MOD-02 mirror of rule 1
//      for the lifecycle module (ready for plan 18-03 which creates
//      server/lifecycle/internal/).
//   3. no-deep-imports-into-reporting-internal — Phase 19 MOD-02 mirror of rules 1+2
//      for the reporting module (plan 19-00 adds this rule; plan 19-03 creates real
//      server/reporting/internal/module.ts body that replaces the stub).
//   4. no-deep-imports-into-pool-internal — Phase 20 MOD-02 mirror of rules 1/2/3
//      for the pool module (plan 20-00 adds this rule; plan 20-03 creates real
//      server/pool/internal/module.ts body that replaces the stub).
//   5. no-deep-imports-into-artifacts-internal — Phase 21 MOD-02 mirror of rules 1/2/3/4
//      for the artifacts module (plan 21-00 adds this rule; plan 21-04 creates real
//      server/artifacts/internal/module.ts body that replaces the stub).
//   6. no-deep-imports-into-streaming-internal — Phase 22 MOD-02 mirror of rules 1/2/3/4/5
//      for the streaming module (plan 22-00 adds this rule; plan 22-02 creates real
//      server/streaming/internal/module.ts body + moves existing top-level files under
//      internal/ via git mv).
//   7. no-deep-imports-into-jobs-internal — Phase 23 MOD-02 mirror of rules 1/2/3/4/5/6
//      for the jobs keystone module (plan 23-00 adds this rule; plan 23-04 creates real
//      server/jobs/internal/module.ts body + moves existing top-level files under
//      internal/ via git mv).
//   8. no-deep-imports-into-maestro-internal — Phase 24 MOD-02 mirror of rules 1/2/3/4/5/6/7
//      for the maestro module (plan 24-00 adds this rule; plan 24-03 creates real
//      server/maestro/internal/module.ts body + moves existing top-level files under
//      internal/ via git mv).
//   9. no-deep-imports-into-pipelines-internal — Phase 25 MOD-02 mirror of rules 1/2/3/4/5/6/7/8
//      for the pipelines module (plan 25-00 adds this rule; plan 25-03 creates real
//      server/pipelines/internal/module.ts body that replaces the stub).
//  10. no-deep-imports-into-auth-internal — Phase 26 MOD-02 mirror of rules 1/2/3/4/5/6/7/8/9
//      for the auth module (plan 26-00 adds this rule; plan 26-03 creates real
//      server/auth/internal/{module,auth-service,key-routes,require-admin,actor}.ts
//      bodies that replace the stub).
//  11. no-deep-imports-into-sessions-internal — Phase 34 MOD-02 mirror of rules 1/2/3/4/5/6/7/8/9/10
//      for the sessions module (plan 34-00 adds this rule; plan 34-01 creates real
//      server/sessions/internal/{module,routes,protocol,dispatch}.ts bodies that
//      replace the throw-stub).
//  12. no-deep-imports-into-explorations-internal — Phase 35 MOD-02 mirror of rules 1-11
//      for the explorations module (plan 35-00 adds this rule; plan 35-01 creates real
//      server/explorations/internal/module.ts body that replaces the throw-stub).
//  13. no-bare-adb-list-outside-discovery — Phase 36 DISC-SVC sole-caller rule.
//      Only server/pool/internal/discovery/adapters/** may shell out to bare
//      `adb devices` or `simctl list devices` (without -s <serial> filter).
//      Per-device probes (adb -s X get-state) are unrestricted. The dep-cruiser
//      rule is path-based (module-name) — runtime enforcement lives in
//      server/pool/__tests__/discovery-sole-caller.spec.ts (grep-guard pattern).
//  14. no-direct-bus-emit-outside-events-ts — belt-and-suspenders graph-level
//      guard complementing the ESLint rule of the same name.
//
// options.tsConfig + enhancedResolveOptions.conditionNames are REQUIRED for
// TypeScript NodeNext .js specifiers to resolve to their .ts sources without
// spurious "unresolvable dependency" errors (see RESEARCH §Pitfall 3).
module.exports = {
  forbidden: [
    {
      name: 'no-deep-imports-into-hooks-internal',
      comment:
        'Nothing outside server/hooks/** may reach into server/hooks/internal/**. ' +
        'Public API comes from server/hooks/index.ts barrel. Phase 16 ADR-002 + MOD-02.',
      severity: 'error',
      from: {
        pathNot: '^server/hooks/',
      },
      to: {
        path: '^server/hooks/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-lifecycle-internal',
      comment:
        'Nothing outside server/lifecycle/** may reach into server/lifecycle/internal/**. ' +
        'Public API comes from server/lifecycle/index.ts barrel. Phase 18 MOD-02. ' +
        'Mirrors the Phase 16 hooks rule — see RESEARCH §Phase 16 Module Pattern Comparison.',
      severity: 'error',
      from: {
        pathNot: '^server/lifecycle/',
      },
      to: {
        path: '^server/lifecycle/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-reporting-internal',
      comment:
        'Nothing outside server/reporting/** may reach into server/reporting/internal/**. ' +
        'Public API comes from server/reporting/index.ts barrel. Phase 19 MOD-02. ' +
        'Mirrors the Phase 16 hooks rule + Phase 18 lifecycle rule — ' +
        'see RESEARCH §Open Question Q5 (copy-paste lifecycle rule + s/lifecycle/reporting/).',
      severity: 'error',
      from: {
        pathNot: '^server/reporting/',
      },
      to: {
        path: '^server/reporting/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-pool-internal',
      comment:
        'Nothing outside server/pool/** may reach into server/pool/internal/**. ' +
        'Public API comes from server/pool/index.ts barrel. Phase 20 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting rules — ' +
        'see RESEARCH §Dep-Cruiser Rule.',
      severity: 'error',
      from: {
        pathNot: '^server/pool/',
      },
      to: {
        path: '^server/pool/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-artifacts-internal',
      comment:
        'Nothing outside server/artifacts/** may reach into server/artifacts/internal/**. ' +
        'Public API comes from server/artifacts/index.ts barrel. Phase 21 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool rules — ' +
        'see 21-RESEARCH §Anti-Patterns.',
      severity: 'error',
      from: {
        pathNot: '^server/artifacts/',
      },
      to: {
        path: '^server/artifacts/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-streaming-internal',
      comment:
        'Nothing outside server/streaming/** may reach into server/streaming/internal/**. ' +
        'Public API comes from server/streaming/index.ts barrel. Phase 22 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts rules — ' +
        'see 22-RESEARCH §Dependency-Cruiser 6th Rule.',
      severity: 'error',
      from: {
        pathNot: '^server/streaming/',
      },
      to: {
        path: '^server/streaming/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-jobs-internal',
      comment:
        'Nothing outside server/jobs/** may reach into server/jobs/internal/**. ' +
        'Public API comes from server/jobs/index.ts barrel. Phase 23 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming rules — ' +
        'see 23-RESEARCH §Module Mechanics.',
      severity: 'error',
      from: {
        pathNot: '^server/jobs/',
      },
      to: {
        path: '^server/jobs/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-maestro-internal',
      comment:
        'Nothing outside server/maestro/** may reach into server/maestro/internal/**. ' +
        'Public API comes from server/maestro/index.ts barrel. Phase 24 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming + Phase 23 jobs rules — ' +
        'see 24-RESEARCH §Validation Architecture Wave 0 Gaps.',
      severity: 'error',
      from: {
        pathNot: '^server/maestro/',
      },
      to: {
        path: '^server/maestro/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-pipelines-internal',
      comment:
        'Nothing outside server/pipelines/** may reach into server/pipelines/internal/**. ' +
        'Public API comes from server/pipelines/index.ts barrel. Phase 25 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming + Phase 23 jobs + Phase 24 maestro rules — ' +
        'see 25-RESEARCH §Dep-Cruiser 9th Rule.',
      severity: 'error',
      from: {
        pathNot: '^server/pipelines/',
      },
      to: {
        path: '^server/pipelines/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-auth-internal',
      comment:
        'Nothing outside server/auth/** may reach into server/auth/internal/**. ' +
        'Public API comes from server/auth/index.ts barrel. Phase 26 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming + Phase 23 jobs + Phase 24 maestro + Phase 25 pipelines rules — ' +
        'see 26-RESEARCH §Pattern 3 (10th dep-cruiser rule).',
      severity: 'error',
      from: {
        pathNot: '^server/auth/',
      },
      to: {
        path: '^server/auth/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-sessions-internal',
      comment:
        'Nothing outside server/sessions/** may reach into server/sessions/internal/**. ' +
        'Public API comes from server/sessions/index.ts barrel. Phase 34 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming + Phase 23 jobs + Phase 24 maestro + Phase 25 pipelines + Phase 26 auth rules — ' +
        'see 34-RESEARCH §Module Pattern (11th dep-cruiser rule).',
      severity: 'error',
      from: {
        pathNot: '^server/sessions/',
      },
      to: {
        path: '^server/sessions/internal/',
      },
    },
    {
      name: 'no-deep-imports-into-explorations-internal',
      comment:
        'Nothing outside server/explorations/** may reach into server/explorations/internal/**. ' +
        'Public API comes from server/explorations/index.ts barrel. Phase 35 MOD-02. ' +
        'Mirrors the Phase 16 hooks + Phase 18 lifecycle + Phase 19 reporting + Phase 20 pool + Phase 21 artifacts + Phase 22 streaming + Phase 23 jobs + Phase 24 maestro + Phase 25 pipelines + Phase 26 auth + Phase 34 sessions rules — ' +
        'see 35-RESEARCH §Module Pattern (12th dep-cruiser rule).',
      severity: 'error',
      from: {
        pathNot: '^server/explorations/',
      },
      to: {
        path: '^server/explorations/internal/',
      },
    },
    {
      name: 'no-bare-adb-list-outside-discovery',
      comment:
        'Only server/pool/internal/discovery/adapters/** may shell out to bare ' +
        '`adb devices` or `simctl list devices` (without -s <serial> filter). ' +
        'Per-device probes (adb -s X get-state) are unrestricted. Phase 36 DISC-SVC. ' +
        'NOTE: this dep-cruiser rule is path-based (module-name); the runtime ' +
        'enforcement comes from the grep-guard spec in discovery-sole-caller.spec.ts. ' +
        'Should anyone create a `bare-adb-list.ts` helper module inside the discovery ' +
        'adapters layer, this rule structurally bans importing it from outside discovery.',
      severity: 'error',
      from: {
        pathNot: '^server/pool/internal/discovery/',
      },
      to: {
        path: '^server/pool/internal/discovery/adapters/',
      },
    },
    {
      name: 'no-direct-bus-emit-outside-events-ts',
      comment:
        'Runtime equivalent of the eslint-local-rules/no-direct-bus-emit rule. ' +
        'Kept here as a belt-and-suspenders graph-level guard. ' +
        'Allow: any events.ts (emit site), any spec/test file, bus internals ' +
        '(bus/helpers/plugin/index), and MOD-06 module factories at server/*/internal/module.ts ' +
        'which legitimately construct `new TypedBus(registry)` per the Phase 16 canonical pattern.',
      severity: 'error',
      from: {
        pathNot:
          '(events\\.ts$|\\.spec\\.ts$|\\.test\\.ts$|server/bus/(bus|helpers|plugin|index)\\.ts$|server/[^/]+/internal/module\\.ts$)',
      },
      to: {
        path: 'server/bus/bus\\.ts$',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    includeOnly: '^server/',
    doNotFollow: { path: 'node_modules' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
