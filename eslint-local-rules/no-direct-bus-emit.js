// Rule: no-direct-bus-emit
//
// Enforces EVENTS-08: `bus.emit(...)` (and `fastify.bus.emit(...)`) may only
// be called from each module's `events.ts` emit helpers or from tests. All
// other call sites must route through `createEventHelpers(bus).emit(type)(...)`
// so the envelope, correlationId, causationId, and persistence gating are
// applied consistently.
//
// Allowlist notes:
//   - `**/events.ts`       — canonical emit-helper home for every module
//   - `**/*.spec.ts`       — vitest specs (colocated or inside __tests__/)
//   - `**/*.test.ts`       — vitest tests (colocated or inside __tests__/)
//   - `**/bus/bus.ts`      — TypedBus internals (this.ee.emit in impl)
//   - `**/bus/helpers.ts`  — emit-helpers factory (wraps bus.emit)
//   - `**/bus/plugin.ts`   — Fastify plugin side-channel envelope forwarding
//
// The last three are allowlisted defensively: the bus internals genuinely
// invoke `bus.emit(...)` or `this.ee.emit(...)` as part of implementing the
// abstraction itself.
//
// NOTE: an earlier draft allowlisted the entire `/__tests__/` subtree with
// `/\/__tests__\//`. That over-matched fixture files under
// `eslint-local-rules/__tests__/fixtures/` (intentionally-invalid TS files
// that SHOULD trip the rule). Narrowing to the `.(spec|test).ts` extension
// is sufficient — all vitest specs conform, and fixtures stay out of the
// allowlist so they continue to exercise the rule.
const ALLOW = [
  /\/events\.ts$/,
  /\.(spec|test)\.ts$/,
  /\/bus\/bus\.ts$/,
  /\/bus\/helpers\.ts$/,
  /\/bus\/plugin\.ts$/,
];

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'bus.emit() may only be called from events.ts or tests' },
    schema: [],
    messages: {
      forbidden:
        'bus.emit() is forbidden here. Use emit helpers from the module events.ts.',
    },
  },
  create(context) {
    // context.filename (ESLint 9) / context.getFilename() (legacy) — support both.
    const filename =
      typeof context.filename === 'string' ? context.filename : context.getFilename();
    const allowed = ALLOW.some((re) => re.test(filename));
    if (allowed) return {};

    return {
      // bus.emit(...)
      'CallExpression[callee.object.name="bus"][callee.property.name="emit"]'(node) {
        context.report({ node, messageId: 'forbidden' });
      },
      // fastify.bus.emit(...) / app.bus.emit(...)
      'CallExpression[callee.object.property.name="bus"][callee.property.name="emit"]'(
        node,
      ) {
        context.report({ node, messageId: 'forbidden' });
      },
    };
  },
};
