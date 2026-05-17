// Usage: node scripts/capture-nyquist.mjs
// Prerequisite: npm run test:coverage  (produces coverage/coverage-summary.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SUMMARY_PATH = 'coverage/coverage-summary.json';
const OUT_PATH     = '.planning/nyquist-baseline.json';

if (!existsSync(SUMMARY_PATH)) {
  console.error(`Missing ${SUMMARY_PATH}. Run \`npm run test:coverage\` first.`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
const sha = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();

const baseline = {
  capturedAt: new Date().toISOString(),
  commit: sha,
  coverage: {
    lines:      summary.total.lines.pct,
    branches:   summary.total.branches.pct,
    functions:  summary.total.functions.pct,
    statements: summary.total.statements.pct,
  },
};

writeFileSync(OUT_PATH, JSON.stringify(baseline, null, 2) + '\n');
console.log(`Wrote ${OUT_PATH}`);
console.log(JSON.stringify(baseline, null, 2));
