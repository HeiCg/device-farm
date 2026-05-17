---
estimated_steps: 6
estimated_files: 1
skills_used: []
---

# T05: Test Case detail page

Create web/src/routes/test-cases/[id]/+page.svelte — detail page with:
- Title, metadata sidebar (priority, status, automation status, flow filename, dates)
- Steps table (index, action, expected result, test data)
- Labels as colored pills
- Edit button, delete (soft-delete) button with confirmation
- Future: execution history section (placeholder for S04)

## Inputs

- `web/src/routes/jobs/[id]/+page.svelte`

## Expected Output

- `web/src/routes/test-cases/[id]/+page.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
