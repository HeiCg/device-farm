---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T04: Labels UI — LabelManager component + Settings integration

Create LabelManager.svelte component with: list of labels as colored pills, create button, inline edit (name + color + category), delete with two-click confirmation (D021 pattern). Add color picker using native input[type=color]. Category dropdown with preset options (feature, type, priority, platform, custom). Integrate into Settings page below the hooks section.

## Inputs

- `web/src/routes/settings/+page.svelte`
- `web/src/lib/components/hooks/HookList.svelte`

## Expected Output

- `web/src/lib/components/labels/LabelManager.svelte`
- `web/src/lib/components/labels/LabelForm.svelte`

## Verification

npx svelte-check --threshold error && npm run web:build
