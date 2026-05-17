# Test Case Management + Appium Hierarchy — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Milestones:** M004 (TCM), M005 (Appium)

## Overview

Two milestones that evolve Device Farm from a pure execution engine into a test management platform:

1. **M004 — Test Case Management**: Store, organize, label, and track test cases with structured steps. Group into suites. Execute manually or auto-link to Maestro job results. Full CRUD + execution tracking UI.

2. **M005 — Appium Hierarchy Source**: Add Appium as a 4th hierarchy source in the Device Inspector (alongside maestro-cli, device-server, native). Supports Android emulator/physical devices and iOS simulators via Appium's WebDriver session API.

## M004: Test Case Management

### Data Model

#### Enums

- `test_priority`: p0_critical, p1_high, p2_medium, p3_low
- `test_case_status`: draft, active, deprecated
- `automation_status`: not_automated, automated, can_be_automated, cannot_be_automated, needs_update
- `execution_status`: running, completed, aborted
- `result_status`: passed, failed, skipped, blocked, not_run
- `step_result_status`: passed, failed, skipped
- `execution_trigger`: manual, automated

#### Tables

**labels** — Reusable tags for categorizing test cases.
- id (uuid PK, gen_random_uuid)
- name (varchar 100, unique, not null)
- color (varchar 7, not null, e.g. "#00fd93")
- category (varchar 50, nullable — e.g. "feature", "priority", "type", "platform")
- created_at (timestamptz, default now)

**test_cases** — Individual test case definitions.
- id (uuid PK, gen_random_uuid)
- title (varchar 500, not null)
- description (text, nullable)
- preconditions (text, nullable)
- priority (test_priority enum, default p2_medium)
- status (test_case_status enum, default draft)
- automation_status (automation_status enum, default not_automated)
- flow_filename (varchar 512, nullable — for auto-linking to Maestro jobs)
- created_at (timestamptz, default now)
- updated_at (timestamptz, default now)

**test_case_steps** — Structured steps within a test case.
- id (uuid PK, gen_random_uuid)
- test_case_id (uuid FK → test_cases.id, ON DELETE CASCADE)
- step_index (integer, not null)
- action (text, not null)
- expected_result (text, not null)
- test_data (text, nullable)

**test_case_labels** — M:N junction.
- test_case_id (uuid FK → test_cases.id, ON DELETE CASCADE)
- label_id (uuid FK → labels.id, ON DELETE CASCADE)
- PK(test_case_id, label_id)

**test_suites** — Groupings of test cases.
- id (uuid PK, gen_random_uuid)
- name (varchar 255, not null)
- description (text, nullable)
- created_at (timestamptz, default now)
- updated_at (timestamptz, default now)

**test_suite_cases** — Ordered M:N junction.
- suite_id (uuid FK → test_suites.id, ON DELETE CASCADE)
- test_case_id (uuid FK → test_cases.id, ON DELETE CASCADE)
- sort_order (integer, not null, default 0)
- PK(suite_id, test_case_id)

**test_executions** — A run of a suite or ad-hoc case list.
- id (uuid PK, gen_random_uuid)
- name (varchar 255, not null)
- suite_id (uuid FK → test_suites.id, nullable)
- environment (varchar 255, nullable — e.g. "Android 15 Pixel 8", "iOS 17.5 iPhone 15")
- trigger (execution_trigger enum, not null)
- status (execution_status enum, default running)
- executed_by (varchar 255, nullable)
- job_id (uuid FK → jobs.id, nullable — when auto-linked from a Maestro job)
- started_at (timestamptz, default now)
- finished_at (timestamptz, nullable)

**test_execution_results** — Result per test case in an execution.
- id (uuid PK, gen_random_uuid)
- execution_id (uuid FK → test_executions.id, ON DELETE CASCADE)
- test_case_id (uuid FK → test_cases.id)
- status (result_status enum, default not_run)
- job_id (uuid FK → jobs.id, nullable — direct link to the specific job that tested this case)
- notes (text, nullable)
- executed_by (varchar 255, nullable)
- duration_ms (integer, nullable)
- started_at (timestamptz, nullable)
- finished_at (timestamptz, nullable)

**test_step_results** — Result per step within an execution result.
- id (uuid PK, gen_random_uuid)
- execution_result_id (uuid FK → test_execution_results.id, ON DELETE CASCADE)
- step_id (uuid FK → test_case_steps.id)
- status (step_result_status enum, default skipped)
- actual_result (text, nullable)
- notes (text, nullable)

### API Routes

```
# Labels
GET    /api/labels                                    list (filter: ?category=)
POST   /api/labels                                    create { name, color, category }
PUT    /api/labels/:id                                update
DELETE /api/labels/:id                                delete (cascade from junction)

# Test Cases
GET    /api/test-cases                                list (filter: ?label=&status=&automation_status=&priority=&search=&limit=&cursor=)
POST   /api/test-cases                                create { title, description, preconditions, priority, status, automation_status, flow_filename, steps[], labelIds[] }
GET    /api/test-cases/:id                            detail (includes steps, labels, recent executions)
PUT    /api/test-cases/:id                            update
DELETE /api/test-cases/:id                            soft-delete (status → deprecated)
PUT    /api/test-cases/:id/steps                      bulk upsert steps [{ id?, step_index, action, expected_result, test_data }]

# Test Suites
GET    /api/test-suites                               list
POST   /api/test-suites                               create { name, description, caseIds[] }
GET    /api/test-suites/:id                           detail (ordered cases with labels)
PUT    /api/test-suites/:id                           update (name, description, reorder cases)
DELETE /api/test-suites/:id                           delete

# Test Executions
GET    /api/test-executions                           list (filter: ?suite_id=&status=&trigger=&from=&to=&limit=&cursor=)
POST   /api/test-executions                           create { name, suite_id?, caseIds[]?, environment, trigger, executed_by }
GET    /api/test-executions/:id                       detail (all results with step results)
PUT    /api/test-executions/:id                       update (status, finish)

# Execution Results
PUT    /api/test-executions/:execId/results/:caseId   update { status, notes, executed_by, duration_ms, stepResults[] }
```

### UI Routes

| Route | Page |
|---|---|
| `/test-cases` | List: search, multi-label filter, status/priority/automation pills, bulk label action |
| `/test-cases/new` | Create form: title, desc, preconditions, structured steps editor, label picker, priority, automation status, flow filename |
| `/test-cases/[id]` | Detail: steps table, labels, metadata sidebar, execution history |
| `/test-cases/[id]/edit` | Edit form (pre-filled) |
| `/test-suites` | List: suite cards with case count, last execution pass rate |
| `/test-suites/[id]` | Detail: ordered case list (drag-to-reorder), add/remove cases, "Run" button |
| `/test-executions` | List: status badge, trigger type, duration, pass/fail/skip counts |
| `/test-executions/[id]` | Detail: case result grid, expandable step results, inline edit for manual results |

### Navigation Update

Sidebar nav items (supersedes D011):
Dashboard, Jobs, Devices, **Test Cases**, **Test Suites**, **Executions**, Settings

### Auto-linking Logic

When a Maestro job completes:
1. Get all flow filenames from `job_files` for that job
2. Match against `test_cases.flow_filename`
3. If matches found and no execution exists for this job:
   a. Create `test_execution` (trigger: automated, job_id: job.id, environment: device name + platform)
   b. For each matched test case, create `test_execution_result` with status mapped from job step results
   c. If job has per-step results, populate `test_step_results` where step indices align

### Slice Breakdown

- **S01**: Schema + Labels CRUD (DB migration, labels API, labels UI in Settings)
- **S02**: Test Cases CRUD (test_cases + steps tables, full API, list/create/edit/detail pages)
- **S03**: Test Suites (suites tables, API, suite pages with drag-to-reorder)
- **S04**: Test Executions — Manual (executions tables, create execution, manual result entry UI)
- **S05**: Auto-link Jobs ↔ Test Cases (job completion hook, matching logic, auto-create executions)
- **S06**: Navigation + Dashboard Integration (nav update, test stats on dashboard, filters polish)

## M005: Appium Hierarchy Source

### Architecture

AppiumService manages Appium sessions per device:

1. **Session creation** — `POST http://localhost:4723/session` with capabilities:
   - Android: `{ platformName: "Android", "appium:automationName": "UiAutomator2", "appium:udid": "<serial>" }`
   - iOS: `{ platformName: "iOS", "appium:automationName": "XCUITest", "appium:udid": "<udid>" }`
2. **Hierarchy fetch** — `GET /session/:sessionId/source` returns XML
3. **Session reuse** — cache active sessions per device, reuse while inspector is open
4. **Session cleanup** — `DELETE /session/:sessionId` when user leaves inspector or timeout

### Integration Points

- New `HierarchySource`: `'appium'` added to existing union type
- `HierarchyService.fetchBySource()` gets new `case 'appium'` branch
- `SourceSelector.svelte` gets 4th option
- Config: `appium.serverUrl` (default: `http://localhost:4723`)
- Dependency checker: validate `appium` binary + installed drivers

### Slice Breakdown

- **S01**: Appium Session Manager (AppiumService, session lifecycle, dependency checker, config)
- **S02**: Hierarchy Source + UI (4th source in HierarchyService, SourceSelector update, XML parser for both platforms)
