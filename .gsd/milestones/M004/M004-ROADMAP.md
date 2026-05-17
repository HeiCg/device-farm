# M004: 

## Vision
Transform Device Farm from a pure execution engine into a test management platform. Store, organize, and label test cases with structured steps. Group into suites. Execute manually or auto-link to Maestro job results. Full CRUD + execution tracking UI.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Schema + Labels CRUD | low | — | ✅ | Labels can be created/edited/deleted in Settings page, all 9 DB tables exist with proper indexes |
| S02 | Test Cases CRUD | medium | S01 | ✅ | Create a test case with title, steps, labels, and priority. List page filters by label and status. Detail page shows steps and metadata. |
| S03 | Test Suites | low | S02 | ✅ | Create a suite, add test cases, drag to reorder. Suite detail shows ordered cases with labels. |
| S04 | Test Executions — Manual | medium | S02 | ✅ | Create a manual execution from a suite. Record pass/fail per test case and per step. View execution summary with pass rate. |
| S05 | Auto-link Jobs to Test Cases | medium | S04 | ✅ | Run a Maestro job. After completion, an execution is auto-created with results linked to matching test cases. |
| S06 | Navigation + Dashboard Integration | low | S02, S04 | ✅ | Sidebar shows Test Cases, Test Suites, Executions nav items. Dashboard shows test case stats widget. |
