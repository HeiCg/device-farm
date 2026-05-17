/**
 * Phase 37 Plan 37-00 — github module public barrel (MOD-02).
 *
 * Strict 1-line internal/ re-export + plugin export. NO `export *` (MOD-02).
 * Wave 1 (Plan 37-03) adds schemas surface as additional named exports.
 */

// MOD-02 strict 1-line internal/ re-export
export { createGithubModule, type GithubModule } from './internal/module.js';

// Plugin default export
export { default as githubPlugin } from './plugin.js';
