---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T02: Job detail → execution link UI

Update job detail page (/jobs/[id]) to show a link to the auto-created execution if one exists. Add executionId to job detail API response. Show as a banner or link in the job detail metadata.

## Inputs

- `web/src/routes/jobs/[id]/+page.svelte`

## Expected Output

- `web/src/routes/jobs/[id]/+page.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
