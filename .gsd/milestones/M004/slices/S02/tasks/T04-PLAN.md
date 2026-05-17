---
estimated_steps: 7
estimated_files: 4
skills_used: []
---

# T04: Test Case create/edit form page

Create web/src/routes/test-cases/new/+page.svelte and web/src/routes/test-cases/[id]/edit/+page.svelte (shared StepEditor component).
- Title, description (textarea), preconditions (textarea)
- Priority dropdown, status dropdown, automation_status dropdown
- Flow filename input (for auto-linking)
- StepEditor: ordered list of steps with action, expected_result, test_data fields. Add/remove/reorder steps.
- LabelPicker: multi-select from existing labels with colored pills
- Save button → POST or PUT

## Inputs

- `web/src/lib/components/labels/LabelForm.svelte`

## Expected Output

- `web/src/routes/test-cases/new/+page.svelte`
- `web/src/routes/test-cases/[id]/edit/+page.svelte`
- `web/src/lib/components/test-cases/StepEditor.svelte`
- `web/src/lib/components/test-cases/LabelPicker.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
