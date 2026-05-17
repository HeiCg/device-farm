// Rule: no-imperative-event-names
//
// Enforces EVENTS-03: event names emitted through the typed bus MUST be
// `noun.verbed` past-tense dotted strings (e.g. `job.completed`,
// `device.booted`, `artifact.created`).
//
// Scoping decision (deviation from RESEARCH §10 "Rule 1" sample):
// The research snippet used the selector `CallExpression[callee.property.name="emit"] Literal`
// which fires on ANY `.emit()` call (e.g. Node EventEmitter `this.emit('stateChange')`,
// pino `logger.emit`, Fastify `broadcaster.emit(jobId, ...)`). That caused false
// positives on existing v2 code (server/pool/device.ts, server/streaming/* tests).
//
// We narrow the selector to match the bus-event surface only:
//   - `bus.emit(<literal>, ...)`        (local TypedBus instance)
//   - `fastify.bus.emit(<literal>, ...)` (plugin-decorated)
//   - `app.bus.emit(<literal>, ...)`
//
// This mirrors the exact same callee shape that `no-direct-bus-emit` watches,
// keeping the rule pair coherent. Non-bus EventEmitter `.emit` calls are
// intentionally out of scope.

const DOTTED_PAST_TENSE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const IMPERATIVE_LAST = /\.(create|update|delete|run|start|stop|send|build|queue)$/;

function reportIfBad(context, node) {
  // The first argument to bus.emit(type, payload) must be the event-type
  // string literal. RuleTester `Literal` nodes have `value` set.
  if (typeof node.value !== 'string') return;
  if (!DOTTED_PAST_TENSE.test(node.value)) {
    context.report({ node, messageId: 'malformed', data: { name: node.value } });
  } else if (IMPERATIVE_LAST.test(node.value)) {
    context.report({ node, messageId: 'imperative', data: { name: node.value } });
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'event names must be noun.verbed past-tense dotted' },
    schema: [],
    messages: {
      imperative:
        'Event name "{{name}}" uses imperative verb. Use past tense (e.g. "job.completed", "device.booted").',
      malformed:
        'Event name "{{name}}" is not noun.verbed dotted (expect /^[a-z]+(\\.[a-z]+)+$/).',
    },
  },
  create(context) {
    return {
      // bus.emit('x.y', ...)
      'CallExpression[callee.object.name="bus"][callee.property.name="emit"] > Literal:first-child'(
        node,
      ) {
        reportIfBad(context, node);
      },
      // fastify.bus.emit('x.y', ...) / app.bus.emit('x.y', ...)
      'CallExpression[callee.object.property.name="bus"][callee.property.name="emit"] > Literal:first-child'(
        node,
      ) {
        reportIfBad(context, node);
      },
    };
  },
};
