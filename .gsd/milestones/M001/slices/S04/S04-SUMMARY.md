---
id: S04
milestone: M001
provides:
  - JobCard component migrated to farm-* tokens + Material Symbols
  - StepList component migrated (Lucide icons → Material Symbols)
  - MetricsPanel component migrated to farm-* tokens
  - Jobs list page on farm-* tokens, no Lucide
  - Job detail page on farm-* tokens + Material Symbols
requires:
  - slice: S01
    provides: StatusBadge, farm-* tokens, Material Symbols pattern
affects: [S05]
key_files:
  - web/src/lib/components/jobs/JobCard.svelte
  - web/src/lib/components/jobs/StepList.svelte
  - web/src/lib/components/jobs/MetricsPanel.svelte
  - web/src/routes/jobs/+page.svelte
  - web/src/routes/jobs/[id]/+page.svelte
key_decisions:
  - "Removed breadcrumb from job detail — Header.svelte already provides route-aware breadcrumbs"
  - "Renamed 'Workflow runs' → 'Build History' to match Jenkins terminology"
patterns_established:
  - "Material Symbols icon mapping: Clock→schedule, Smartphone→smartphone, Cpu→memory, ChevronRight→chevron_right, ArrowLeft→(removed), Inbox→inbox"
drill_down_paths: []
duration: 10min
verification_result: pass
completed_at: 2026-03-16T01:50:00Z
---

# S04: Jobs pages reskin

**All 5 jobs-related files migrated: JobCard, StepList, MetricsPanel, jobs list, job detail — zero gh-*/Lucide references**

## What Happened

Mechanical migration of 5 files. JobCard: removed Lucide Clock/Smartphone, replaced with Material Symbols, farm-* tokens. StepList: replaced 5 Lucide icons (CheckCircle2, XCircle, Loader2, MinusCircle, ChevronRight) with Material Symbols equivalents. MetricsPanel: all gh-* → farm-*. Jobs list: removed Lucide Inbox, farm-* tokens, renamed to "Build History". Job detail: removed redundant breadcrumb (Header handles it), replaced 4 Lucide icons, all gh-* → farm-*.

## Deviations

Removed the manual breadcrumb from job detail page — the Header component from S02 already provides route-aware breadcrumbs including job detail (`Build History » {id}`).

## Files Created/Modified

- `web/src/lib/components/jobs/JobCard.svelte` — farm-* tokens, Material Symbols
- `web/src/lib/components/jobs/StepList.svelte` — Material Symbols, farm-* tokens
- `web/src/lib/components/jobs/MetricsPanel.svelte` — farm-* tokens
- `web/src/routes/jobs/+page.svelte` — farm-* tokens, "Build History" title
- `web/src/routes/jobs/[id]/+page.svelte` — farm-* tokens, Material Symbols, breadcrumb removed
