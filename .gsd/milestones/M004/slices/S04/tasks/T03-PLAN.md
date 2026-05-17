---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T03: Test Executions UI — list + detail + result entry

Create /test-executions list page (cards with name, suite name, trigger badge, status badge, pass/fail/skip counts, date) and /test-executions/[id] detail page (case result grid with status toggle per case, expandable step results with per-step pass/fail toggle, notes field, complete/abort execution button). Create execution dialog from suite detail page (name, environment, trigger fields).

## Inputs

- `web/src/routes/test-suites/[id]/+page.svelte`
- `web/src/routes/test-cases/[id]/+page.svelte`

## Expected Output

- `web/src/routes/test-executions/+page.svelte`
- `web/src/routes/test-executions/[id]/+page.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
