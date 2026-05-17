// INTENTIONALLY INVALID — this path does NOT match any entry in the
// no-direct-bus-emit allowlist (events.ts, tests, bus internals), so the
// rule fires on every bus.emit(...) call below.
//
// NOTE: this file is in the eslint.config.mjs `ignores` list so
// `npm run lint` on the whole tree stays green. Force a lint pass with
// `npx eslint --no-ignore eslint-local-rules/__tests__/fixtures/bad-emit.ts`.
declare const bus: { emit: (t: string, p: unknown) => void };

bus.emit('job.completed', {}); // forbidden: not events.ts / test
