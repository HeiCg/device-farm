// Plugin index for eslint-plugin-local-rules auto-discovery.
// Consumers see rules as `local-rules/no-imperative-event-names` and
// `local-rules/no-direct-bus-emit` once the plugin is registered in
// eslint.config.mjs.
module.exports = {
  'no-imperative-event-names': require('./no-imperative-event-names.js'),
  'no-direct-bus-emit': require('./no-direct-bus-emit.js'),
};
