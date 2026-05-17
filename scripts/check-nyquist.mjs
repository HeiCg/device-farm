// Usage: node scripts/check-nyquist.mjs
// Prerequisite: npm run test:coverage  (produces coverage/coverage-summary.json)
// Fails (exit 1) if current lines coverage regressed > 2pp below the captured baseline.
import { readFileSync, existsSync } from 'node:fs';

const BASELINE = '.planning/nyquist-baseline.json';
const SUMMARY  = 'coverage/coverage-summary.json';

if (!existsSync(BASELINE)) {
  console.error('No baseline — run `npm run nyquist:capture` first');
  process.exit(1);
}
if (!existsSync(SUMMARY)) {
  console.error('No coverage — run `npm run test:coverage` first');
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const cur  = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const delta = cur.total.lines.pct - base.coverage.lines;

console.log(`baseline.lines = ${base.coverage.lines}, current.lines = ${cur.total.lines.pct}, delta = ${delta.toFixed(2)}pp`);

if (delta < -2) {
  console.error(`Coverage regressed ${delta.toFixed(2)}pp below baseline (-2pp threshold)`);
  process.exit(1);
}

console.log('OK: coverage within -2pp of baseline');
