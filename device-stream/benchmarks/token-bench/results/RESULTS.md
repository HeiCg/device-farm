# Token benchmark — results

Layer 1 (mechanical payload capture). No LLM in the loop.

## Method

- Token counter: `js-tiktoken/o200k_base` (APPROXIMATE)
  - Token counts produced by js-tiktoken (o200k_base), an APPROXIMATION — not Claude's tokenizer. Set ANTHROPIC_API_KEY to recount via the Anthropic count_tokens API (claude-sonnet-5) for authoritative numbers.
- argent upstream: `0.22.1` @ `a2ed83e041e13e1db5cc865d7da6451f8ca8a1b2` (cloned read-only, unmodified)
- argent fork: `feat/run-script` @ `ced349ba5bd94bd743649f3893d604475b8739ce` (adds the run-script tool)
- argent integration: `integration/device-stream` @ `0e5c08cabc2bb5766c7104b43566214bd456ca0e` (run-script + rich-selectors + android-system-verbs + open-device-server; both flags default OFF)
- original upstream benchmark SHA: `b835de2326b2c396c010402b2a8f59613e23b462`
- Fork-vs-upstream fairness: Fork base = upstream a2ed83e0 (merge-base of feat/run-script). The upstream vendor clone was moved from the original benchmark SHA b835de2 (v0.22.1) to a2ed83e0 so fork and upstream share a base. The upstream tools/list wire payload is byte-identical at a2ed83e0 and b835de2 (same 75 tools, same 14 alwaysLoad), and rules/argent.md + skill frontmatters are unchanged between them (empty diff), so the A1-A4 Android fixed context and flow numbers (captured at b835de2) are unchanged as the upstream baseline; A-config Android flows were NOT re-run.
- device-stream: current working tree (WS1–WS5)
- Emulator image: Pixel 7, Android 15 (API 35), google_apis arm64-v8a
- iOS simulator image: QA-iPhone17, iOS 26.4 simulator (pt-BR locale), Xcode 26.4
- Scenario (Android): `android-settings-10-step` (10 logical steps)
- Scenario (iOS): `ios-settings-10-step` (10 logical steps; navigation mirror, see scenario-ios.json)
- Generated: 2026-09-01T00:33:27.492Z
- `added_i = requestTokens_i + resultTokens_i` (transcript growth per round-trip).
- `billedCached = fixed + Σ added_i` (perfect prompt caching — RFC primary).
- `billedUncached = Σ_t (fixed + Σ_{i≤t} added_i)` (no caching, quadratic bound).
- Image blocks counted by the Anthropic formula `ceil(w·h/750)` on decoded PNG dimensions, NOT by tokenizing base64. base64 byte size recorded separately.

## Comparison — Android

| config | fixed | flowAdded | billedCached | billedUncached | round-trips | live |
|--------|------:|----------:|-------------:|---------------:|------------:|:----:|
| A1 | 14977 | 8713 | 23690 | 241547 | 12 | yes |
| A2 | 43139 | 8713 | 51852 | 579491 | 12 | yes |
| A3 | 14977 | 6025 | 21002 | 224646 | 12 | yes |
| A4 | 14977 | 1156 | 16133 | 16133 | 1 | yes |
| B1 | 2293 | 5326 | 7619 | 80850 | 16 | yes |
| C1 | 2425 | 911 | 3336 | 6514 | 2 | yes |
| C2 | 2425 | 1605 | 4030 | 11080 | 3 | yes |
| F1 | 16106 | 2061 | 18167 | 35243 | 2 | yes |
| FX | 16877 | 3857 | 20734 | 39887 | 2 | yes |

## Comparison — iOS simulator

| config | fixed | flowAdded | billedCached | billedUncached | round-trips | live |
|--------|------:|----------:|-------------:|---------------:|------------:|:----:|
| F2 | 16106 | 3215 | 19321 | 36958 | 2 | yes |
| FX-ios | 16877 | 3219 | 20096 | 38506 | 2 | yes |
| A1-ios | 14977 | 13253 | 28230 | 275460 | 12 | yes |
| A4-ios | 14977 | 1910 | 16887 | 16887 | 1 | yes |

`*` round-trips for a pending config are the structural count from the adapter table (device-independent).

## Cross-platform summary (fork run-script vs upstream)

| platform | config | variant | fixed | billedCached | billedUncached | round-trips | live |
|----------|--------|---------|------:|-------------:|---------------:|------------:|:----:|
| android | A1 | upstream | 14977 | 23690 | 241547 | 12 | yes |
| android | A4 | upstream | 14977 | 16133 | 16133 | 1 | yes |
| android | F1 | fork | 16106 | 18167 | 35243 | 2 | yes |
| android | FX | integration | 16877 | 20734 | 39887 | 2 | yes |
| ios | A1-ios | upstream | 14977 | 28230 | 275460 | 12 | yes |
| ios | A4-ios | upstream | 14977 | 16887 | 16887 | 1 | yes |
| ios | F2 | fork | 16106 | 19321 | 36958 | 2 | yes |
| ios | FX-ios | integration | 16877 | 20096 | 38506 | 2 | yes |

## Per-step added tokens (live configurations)

| step | A1 | A2 | A3 | A4 | B1 | C1 | C2 | F1 | F2 | FX | FX-ios | A1-ios | A4-ios |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 969 | 969 | 701 | 1156 | 124 | 911 | 1605 | 0 | 0 | 0 | 0 | 1651 | 1910 |
| 2 | 0 | 0 | 0 | 0 | 753 | 0 | 0 | 970 | 1531 | 2276 | 1533 | 1532 | 0 |
| 3 | 927 | 927 | 659 | 0 | 10 | 0 | 0 | 1091 | 1684 | 1581 | 1686 | 1492 | 0 |
| 4 | 35 | 35 | 35 | 0 | 638 | 0 | 0 | 0 | 0 | 0 | 0 | 55 | 0 |
| 5 | 956 | 956 | 688 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 1524 | 0 |
| 6 | 2102 | 2102 | 1566 | 0 | 780 | 0 | 0 | 0 | 0 | 0 | 0 | 1703 | 0 |
| 7 | 1331 | 1331 | 1063 | 0 | 700 | 0 | 0 | 0 | 0 | 0 | 0 | 55 | 0 |
| 8 | 35 | 35 | 35 | 0 | 536 | 0 | 0 | 0 | 0 | 0 | 0 | 1524 | 0 |
| 9 | 1367 | 1367 | 1099 | 0 | 1084 | 0 | 0 | 0 | 0 | 0 | 0 | 2136 | 0 |
| 10 | 991 | 991 | 179 | 0 | 695 | 0 | 0 | 0 | 0 | 0 | 0 | 1581 | 0 |

## Measured describe sizes (Settings root list)

| config | describe bytes | describe tokens | backend (Source) |
|--------|---------------:|----------------:|------------------|
| A1 | 2140 | 744 |  |
| A2 | 2140 | 744 |  |
| A3 | 2005 | 692 |  |
| A4 | 2140 | 744 |  |
| B1 | 2688 | 752 |  |
| C1 | 2688 | 752 |  |
| C2 | 2688 | 752 |  |
| F1 | 1895 | 657 |  |
| F2 | 2753 | 1136 |  |
| FX | 4307 | 1916 | open-device-server |
| FX-ios | 2753 | 1136 | ax-service |
| A1-ios | 2753 | 1136 |  |
| A4-ios | 2753 | 1136 |  |

## Fixed-context breakdown

### A1 — argent, defaults (auto-describe + auto-screenshot on)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **63885** | **14977** | |

### A2 — argent, all 77 tools in context (no progressive loading)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| all 75 tool defs (live tools/list) | 166682 | 38105 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **189321** | **43139** | |

### A3 — argent, disable-auto-screenshot (element tree only)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **63885** | **14977** | |

### A4 — argent run-sequence (10 steps as one sequence call)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **63885** | **14977** | |

### B1 — device-stream atomic dsl_* tools (describe before each context-dependent step)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| 18 dsl_* tool defs (live tools/list) | 9568 | 2293 | wire tools/list payload |
| **total** | **9568** | **2293** | |

### C1 — dsl_run_script (1 orientation describe + 1 script round-trip)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| dsl_run_script tool def (live tools/list) | 1044 | 259 | wire tools/list payload |
| @device-stream/dsl index.d.ts | 4442 | 1021 | script documentation surface |
| @device-stream/dsl types.d.ts | 4901 | 1145 | script documentation surface |
| **total** | **10387** | **2425** | |

### C2 — dsl_run_script, cold (selector-miss recovery: 2 script round-trips)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| dsl_run_script tool def (live tools/list) | 1044 | 259 | wire tools/list payload |
| @device-stream/dsl index.d.ts | 4442 | 1021 | script documentation surface |
| @device-stream/dsl types.d.ts | 4901 | 1145 | script documentation surface |
| **total** | **10387** | **2425** | |

### F1 — argent fork run-script, Android (1 orientation describe + 1 run-script round-trip)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| run-script tool def (live tools/list) | 3257 | 739 | wire tools/list payload (progressively loaded; the script tool the agent invokes) |
| run-script ui .d.ts (argent-device-interact skill) | 1555 | 338 | script authoring surface (progressively loaded from the skill body; counted like C1 counts the dsl .d.ts) |
| rules/argent.md (alwaysApply:true) | 15812 | 3624 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **68932** | **16106** | |

### F2 — argent fork run-script, iOS simulator (1 orientation describe + 1 run-script round-trip)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| run-script tool def (live tools/list) | 3257 | 739 | wire tools/list payload (progressively loaded; the script tool the agent invokes) |
| run-script ui .d.ts (argent-device-interact skill) | 1555 | 338 | script authoring surface (progressively loaded from the skill body; counted like C1 counts the dsl .d.ts) |
| rules/argent.md (alwaysApply:true) | 15812 | 3624 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **68932** | **16106** | |

### FX — argent integration branch run-script, Android (both flags on: run-script + open-device-server)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 44424 | 10633 | wire tools/list payload |
| run-script tool def (live tools/list) | 3620 | 820 | wire tools/list payload (progressively loaded; the script tool the agent invokes) |
| run-script ui .d.ts (argent-device-interact skill) | 1555 | 338 | script authoring surface (progressively loaded from the skill body; counted like C1 counts the dsl .d.ts) |
| rules/argent.md (alwaysApply:true) | 15812 | 3624 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **72473** | **16877** | |

### FX-ios — argent integration branch run-script, iOS simulator (both flags on; open-device-server is Android-only)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 44424 | 10633 | wire tools/list payload |
| run-script tool def (live tools/list) | 3620 | 820 | wire tools/list payload (progressively loaded; the script tool the agent invokes) |
| run-script ui .d.ts (argent-device-interact skill) | 1555 | 338 | script authoring surface (progressively loaded from the skill body; counted like C1 counts the dsl .d.ts) |
| rules/argent.md (alwaysApply:true) | 15812 | 3624 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **72473** | **16877** | |

### A1-ios — argent defaults, iOS simulator (auto-describe + auto-screenshot on)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **63885** | **14977** | |

### A4-ios — argent run-sequence, iOS simulator (10 steps as one sequence call)

| artifact | bytes | tokens | note |
|----------|------:|-------:|------|
| alwaysLoad subset (14 tools, live tools/list) | 41246 | 9943 | wire tools/list payload |
| rules/argent.md (alwaysApply:true) | 15577 | 3572 | always-applied rule |
| argent skill frontmatters (16 skills) | 6240 | 1306 | concatenated YAML frontmatter of each SKILL.md; bodies load on demand |
| MCP instructions | 822 | 156 | MCP server instructions (initialize result) |
| **total** | **63885** | **14977** | |

## Per-model adapter tables (fairness audit)

Each configuration expands the same 10 logical steps into these round-trips.

### A1 — argent, defaults (auto-describe + auto-screenshot on)

- fixed context: alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | launch-app | agent | 1,2 | launch + orient (step 2 free via auto-describe) |
| 2 | screenshot | auto-screenshot | 1,2 | adapter-appended after action |
| 3 | describe | auto-describe | 1,2 | adapter-appended element tree |
| 4 | gesture-tap | agent | 3 | tap 'Network & internet' |
| 5 | screenshot | auto-screenshot | 3 | adapter-appended after action |
| 6 | describe | auto-describe | 3 | adapter-appended element tree |
| 7 | await-ui-element | agent | 4 | assert 'Internet' visible |
| 8 | screenshot | auto-screenshot | 4 | adapter-appended after action |
| 9 | describe | auto-describe | 4 | adapter-appended element tree |
| 10 | button | agent | 5 | back |
| 11 | screenshot | auto-screenshot | 5 | adapter-appended after action |
| 12 | describe | auto-describe | 5 | adapter-appended element tree |
| 13 | gesture-tap | agent | 6 | tap search |
| 14 | screenshot | auto-screenshot | 6 | adapter-appended after action |
| 15 | describe | auto-describe | 6 | adapter-appended element tree |
| 16 | keyboard | agent | 6 | type 'battery' |
| 17 | screenshot | auto-screenshot | 6 | adapter-appended after action |
| 18 | describe | auto-describe | 6 | adapter-appended element tree |
| 19 | gesture-tap | agent | 7 | tap first result |
| 20 | screenshot | auto-screenshot | 7 | adapter-appended after action |
| 21 | describe | auto-describe | 7 | adapter-appended element tree |
| 22 | await-ui-element | agent | 8 | assert battery element visible |
| 23 | screenshot | auto-screenshot | 8 | adapter-appended after action |
| 24 | describe | auto-describe | 8 | adapter-appended element tree |
| 25 | gesture-tap | agent | 9 | toggle Battery Saver |
| 26 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 27 | describe | auto-describe | 9 | adapter-appended element tree |
| 28 | await-ui-element | agent | 9 | assert state change |
| 29 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 30 | describe | auto-describe | 9 | adapter-appended element tree |
| 31 | button | agent | 10 | back |
| 32 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 33 | describe | auto-describe | 10 | adapter-appended element tree |
| 34 | await-ui-element | agent | 10 | assert Settings root visible |
| 35 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 36 | describe | auto-describe | 10 | adapter-appended element tree |

### A2 — argent, all 77 tools in context (no progressive loading)

- fixed context: all 77 tool defs + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | launch-app | agent | 1,2 | launch + orient (step 2 free via auto-describe) |
| 2 | screenshot | auto-screenshot | 1,2 | adapter-appended after action |
| 3 | describe | auto-describe | 1,2 | adapter-appended element tree |
| 4 | gesture-tap | agent | 3 | tap 'Network & internet' |
| 5 | screenshot | auto-screenshot | 3 | adapter-appended after action |
| 6 | describe | auto-describe | 3 | adapter-appended element tree |
| 7 | await-ui-element | agent | 4 | assert 'Internet' visible |
| 8 | screenshot | auto-screenshot | 4 | adapter-appended after action |
| 9 | describe | auto-describe | 4 | adapter-appended element tree |
| 10 | button | agent | 5 | back |
| 11 | screenshot | auto-screenshot | 5 | adapter-appended after action |
| 12 | describe | auto-describe | 5 | adapter-appended element tree |
| 13 | gesture-tap | agent | 6 | tap search |
| 14 | screenshot | auto-screenshot | 6 | adapter-appended after action |
| 15 | describe | auto-describe | 6 | adapter-appended element tree |
| 16 | keyboard | agent | 6 | type 'battery' |
| 17 | screenshot | auto-screenshot | 6 | adapter-appended after action |
| 18 | describe | auto-describe | 6 | adapter-appended element tree |
| 19 | gesture-tap | agent | 7 | tap first result |
| 20 | screenshot | auto-screenshot | 7 | adapter-appended after action |
| 21 | describe | auto-describe | 7 | adapter-appended element tree |
| 22 | await-ui-element | agent | 8 | assert battery element visible |
| 23 | screenshot | auto-screenshot | 8 | adapter-appended after action |
| 24 | describe | auto-describe | 8 | adapter-appended element tree |
| 25 | gesture-tap | agent | 9 | toggle Battery Saver |
| 26 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 27 | describe | auto-describe | 9 | adapter-appended element tree |
| 28 | await-ui-element | agent | 9 | assert state change |
| 29 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 30 | describe | auto-describe | 9 | adapter-appended element tree |
| 31 | button | agent | 10 | back |
| 32 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 33 | describe | auto-describe | 10 | adapter-appended element tree |
| 34 | await-ui-element | agent | 10 | assert Settings root visible |
| 35 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 36 | describe | auto-describe | 10 | adapter-appended element tree |

### A3 — argent, disable-auto-screenshot (element tree only)

- fixed context: alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: false · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | launch-app | agent | 1,2 | launch + orient (step 2 free via auto-describe) |
| 2 | describe | auto-describe | 1,2 | adapter-appended element tree |
| 3 | gesture-tap | agent | 3 | tap 'Network & internet' |
| 4 | describe | auto-describe | 3 | adapter-appended element tree |
| 5 | await-ui-element | agent | 4 | assert 'Internet' visible |
| 6 | describe | auto-describe | 4 | adapter-appended element tree |
| 7 | button | agent | 5 | back |
| 8 | describe | auto-describe | 5 | adapter-appended element tree |
| 9 | gesture-tap | agent | 6 | tap search |
| 10 | describe | auto-describe | 6 | adapter-appended element tree |
| 11 | keyboard | agent | 6 | type 'battery' |
| 12 | describe | auto-describe | 6 | adapter-appended element tree |
| 13 | gesture-tap | agent | 7 | tap first result |
| 14 | describe | auto-describe | 7 | adapter-appended element tree |
| 15 | await-ui-element | agent | 8 | assert battery element visible |
| 16 | describe | auto-describe | 8 | adapter-appended element tree |
| 17 | gesture-tap | agent | 9 | toggle Battery Saver |
| 18 | describe | auto-describe | 9 | adapter-appended element tree |
| 19 | await-ui-element | agent | 9 | assert state change |
| 20 | describe | auto-describe | 9 | adapter-appended element tree |
| 21 | button | agent | 10 | back |
| 22 | describe | auto-describe | 10 | adapter-appended element tree |
| 23 | await-ui-element | agent | 10 | assert Settings root visible |
| 24 | describe | auto-describe | 10 | adapter-appended element tree |

### A4 — argent run-sequence (10 steps as one sequence call)

- fixed context: alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | run-sequence | agent | 1,2,3,4,5,6,7,8,9,10 | one sequence call; CAVEAT: run-sequence's own description forbids dependent steps — this is argent's best-case amortization, reported with that caveat |
| 2 | screenshot | auto-screenshot | 10 | auto-capture after the sequence |
| 3 | describe | auto-describe | 10 | auto-capture after the sequence |

### B1 — device-stream atomic dsl_* tools (describe before each context-dependent step)

- fixed context: 18 dsl_* tool defs (no rule, no frontmatters, no MCP instructions today)
- auto-screenshot: false · auto-describe: false

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | dsl_launch_app | agent | 1 |  |
| 2 | dsl_describe | agent | 2 | orient (paid explicitly) |
| 3 | dsl_tap | agent | 3 |  |
| 4 | dsl_describe | agent | 4 | assert 'Internet' visible |
| 5 | dsl_press_key | agent | 5 | back |
| 6 | dsl_describe | agent | 6 | locate search field |
| 7 | dsl_tap | agent | 6 | tap search |
| 8 | dsl_fill | agent | 6 | type 'battery' |
| 9 | dsl_describe | agent | 7 | locate first result |
| 10 | dsl_tap | agent | 7 | tap first result |
| 11 | dsl_describe | agent | 8 | assert battery element visible |
| 12 | dsl_describe | agent | 9 | locate + read switch state |
| 13 | dsl_tap | agent | 9 | toggle Battery Saver |
| 14 | dsl_describe | agent | 9 | assert state change |
| 15 | dsl_press_key | agent | 10 | back |
| 16 | dsl_describe | agent | 10 | assert Settings root visible |

### C1 — dsl_run_script (1 orientation describe + 1 script round-trip)

- fixed context: dsl_run_script tool def + @device-stream/dsl .d.ts surface (index.d.ts + types.d.ts)
- auto-screenshot: false · auto-describe: false

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | dsl_describe | agent | 1,2 | initial orientation |
| 2 | dsl_run_script | agent | 1,2,3,4,5,6,7,8,9,10 | entire flow, one round-trip |

### C2 — dsl_run_script, cold (selector-miss recovery: 2 script round-trips)

- fixed context: dsl_run_script tool def + @device-stream/dsl .d.ts surface (index.d.ts + types.d.ts)
- auto-screenshot: false · auto-describe: false

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | dsl_describe | agent | 1,2 | initial orientation |
| 2 | dsl_run_script | agent | 1,2,3,4,5,6,7,8,9,10 | first attempt: selector miss → WS1 diagnostic error |
| 3 | dsl_run_script | agent | 1,2,3,4,5,6,7,8,9,10 | corrected re-submit |

### F1 — argent fork run-script, Android (1 orientation describe + 1 run-script round-trip)

- fixed context: alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | describe | agent | 1,2 | initial orientation |
| 2 | run-script | agent | 1,2,3,4,5,6,7,8,9,10 | entire flow, one round-trip |
| 3 | screenshot | auto-screenshot | 10 | auto-capture after the script |
| 4 | describe | auto-describe | 10 | auto-capture after the script |

### F2 — argent fork run-script, iOS simulator (1 orientation describe + 1 run-script round-trip)

- fixed context: alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | describe | agent | 1,2 | initial orientation |
| 2 | run-script | agent | 1,2,3,4,5,6,7,8,9,10 | entire flow, one round-trip |
| 3 | screenshot | auto-screenshot | 10 | auto-capture after the script |
| 4 | describe | auto-describe | 10 | auto-capture after the script |

### FX — argent integration branch run-script, Android (both flags on: run-script + open-device-server)

- fixed context: alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | describe | agent | 1,2 | initial orientation |
| 2 | run-script | agent | 1,2,3,4,5,6,7,8,9,10 | entire flow, one round-trip |
| 3 | screenshot | auto-screenshot | 10 | auto-capture after the script |
| 4 | describe | auto-describe | 10 | auto-capture after the script |

### FX-ios — argent integration branch run-script, iOS simulator (both flags on; open-device-server is Android-only)

- fixed context: alwaysLoad subset + run-script tool def + run-script ui .d.ts + rules/argent.md + skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | describe | agent | 1,2 | initial orientation |
| 2 | run-script | agent | 1,2,3,4,5,6,7,8,9,10 | entire flow, one round-trip |
| 3 | screenshot | auto-screenshot | 10 | auto-capture after the script |
| 4 | describe | auto-describe | 10 | auto-capture after the script |

### A1-ios — argent defaults, iOS simulator (auto-describe + auto-screenshot on)

- fixed context: alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | launch-app | agent | 1 | launch Settings (init_failed on iOS: RN dylib absent; foregrounded via simctl; no auto-capture) |
| 2 | describe | agent | 2 | explicit orientation (iOS launch-app does not auto-describe) |
| 3 | gesture-tap | agent | 3 | tap 'Geral' (General) |
| 4 | screenshot | auto-screenshot | 3 | adapter-appended after action |
| 5 | describe | auto-describe | 3 | adapter-appended element tree |
| 6 | await-ui-element | agent | 4 | assert General sub-screen (BackButton) |
| 7 | screenshot | auto-screenshot | 4 | adapter-appended after action |
| 8 | describe | auto-describe | 4 | adapter-appended element tree |
| 9 | gesture-tap | agent | 5 | tap BackButton to root |
| 10 | screenshot | auto-screenshot | 5 | adapter-appended after action |
| 11 | describe | auto-describe | 5 | adapter-appended element tree |
| 12 | gesture-tap | agent | 6 | tap 'Acessibilidade' (Accessibility) |
| 13 | screenshot | auto-screenshot | 6 | adapter-appended after action |
| 14 | describe | auto-describe | 6 | adapter-appended element tree |
| 15 | await-ui-element | agent | 7 | assert Accessibility sub-screen (BackButton) |
| 16 | screenshot | auto-screenshot | 7 | adapter-appended after action |
| 17 | describe | auto-describe | 7 | adapter-appended element tree |
| 18 | gesture-tap | agent | 8 | tap BackButton to root |
| 19 | screenshot | auto-screenshot | 8 | adapter-appended after action |
| 20 | describe | auto-describe | 8 | adapter-appended element tree |
| 21 | gesture-tap | agent | 9 | tap 'Câmera' (Camera) |
| 22 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 23 | describe | auto-describe | 9 | adapter-appended element tree |
| 24 | await-ui-element | agent | 9 | assert Camera sub-screen transition (BackButton) |
| 25 | screenshot | auto-screenshot | 9 | adapter-appended after action |
| 26 | describe | auto-describe | 9 | adapter-appended element tree |
| 27 | gesture-tap | agent | 10 | tap BackButton to root |
| 28 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 29 | describe | auto-describe | 10 | adapter-appended element tree |
| 30 | await-ui-element | agent | 10 | assert Settings root (General row) |
| 31 | screenshot | auto-screenshot | 10 | adapter-appended after action |
| 32 | describe | auto-describe | 10 | adapter-appended element tree |

### A4-ios — argent run-sequence, iOS simulator (10 steps as one sequence call)

- fixed context: alwaysLoad tool subset + rules/argent.md + 16 skill frontmatters + MCP instructions
- auto-screenshot: true · auto-describe: true

| # | tool | origin | covers steps | note |
|--:|------|--------|--------------|------|
| 1 | run-sequence | agent | 1,2,3,4,5,6,7,8,9,10 | one sequence call (blind coordinate taps); CAVEAT: run-sequence forbids dependent steps and cannot re-describe — argent's best-case amortization, reported with that caveat |
| 2 | screenshot | auto-screenshot | 10 | auto-capture after the sequence |
| 3 | describe | auto-describe | 10 | auto-capture after the sequence |

