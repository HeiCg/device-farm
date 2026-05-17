---
estimated_steps: 7
estimated_files: 1
skills_used: []
---

# T03: Test Cases list page

Create web/src/routes/test-cases/+page.svelte — list page with:
- Search input (debounced)
- Multi-filter: status pills, priority dropdown, automation_status dropdown, label multi-select
- Test case cards showing title, priority pill, status pill, automation status pill, label pills, step count
- Cursor pagination (Load More button)
- Link to detail page
- Create button linking to /test-cases/new

## Inputs

- `web/src/routes/jobs/+page.svelte`
- `web/src/lib/components/labels/LabelManager.svelte`

## Expected Output

- `web/src/routes/test-cases/+page.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
