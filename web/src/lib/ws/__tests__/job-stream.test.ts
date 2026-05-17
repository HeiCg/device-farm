// @vitest-environment jsdom
//
// Phase 31 Plan 31-02 SC2: this test file was a Wave 0 RED scaffold that
// expected Wave 1 to either (a) install vitest in web/ and turn the suite
// green, or (b) defer web-side automated coverage to manual DevTools
// observation per 31-RESEARCH.md Open Question 4 + 31-VALIDATION.md
// "Manual-Only Verifications".
//
// Wave 1 chose option (b): web/ has no vitest infrastructure (no vitest
// devDependency, no vitest.config.*, no Svelte test helpers), and adding
// it just for these three tests would pull in ~50MB of deps (vitest +
// jsdom + @testing-library/svelte + @sveltejs/vite-plugin-svelte) for
// three unit assertions that are equally well-covered by the server-side
// FlushQueue spec (which already proves the {type:'batch', items:[...]}
// shape on the wire) and a 30-second DevTools Network → WS frame-count
// inspection of a real 10k-line job.
//
// The web-side dispatch logic — batch unwrap, flat passthrough, and
// malformed-JSON graceful drop — is implemented in
// web/src/lib/ws/job-stream.svelte.ts (see `handleMessage` and
// `dispatchEnvelope`). Manual verification steps are catalogued in
// 31-VALIDATION.md.
//
// The scaffold tests are kept as `describe.skip` so they remain a visible
// reminder of the planned automated coverage if web testing infra is
// added later (out-of-scope for Phase 31).

import { describe, it } from 'vitest';

describe.skip('job-stream batch unwrap (DEFERRED to manual DevTools verification)', () => {
  it('batch unwrap: dispatches each inner envelope', () => {
    // See 31-02-SUMMARY.md "Web-Side Test Defer" + 31-VALIDATION.md
    // "Manual-Only Verifications" for the DevTools steps.
  });

  it('flat passthrough: dispatches single envelope unchanged', () => {
    // Covered by manual smoke test against a job submitted with ?nobatch=1.
  });

  it('malformed JSON: no dispatch, no throw', () => {
    // Covered by manual inspection — console.warn fires, no exception.
  });
});
