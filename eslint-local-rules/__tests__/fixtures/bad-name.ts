// INTENTIONALLY INVALID — exercised by RuleTester and by direct `npx eslint`
// runs. These emit calls violate `no-imperative-event-names`.
//
// NOTE: this file is in the eslint.config.mjs `ignores` list so
// `npm run lint` on the whole tree stays green. Force a lint pass with
// `npx eslint --no-ignore eslint-local-rules/__tests__/fixtures/bad-name.ts`.
declare const bus: { emit: (t: string, p: unknown) => void };

bus.emit('job.create', {}); // imperative (`create` is present-tense)
bus.emit('JobCompleted', {}); // malformed (uppercase, no dot)
bus.emit('job', {}); // malformed (single segment)
