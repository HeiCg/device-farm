---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T03: Test Suites UI — list + detail pages

Create /test-suites list page (suite cards with name, description, case count, created date) and /test-suites/[id] detail page (ordered case list with move up/down buttons, add cases modal/picker, remove case, name/description editing, delete suite). Create button on list page.

## Inputs

- `web/src/routes/test-cases/+page.svelte`
- `web/src/routes/test-cases/[id]/+page.svelte`

## Expected Output

- `web/src/routes/test-suites/+page.svelte`
- `web/src/routes/test-suites/[id]/+page.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
