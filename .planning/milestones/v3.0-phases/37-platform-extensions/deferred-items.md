# Phase 37 deferred items

Carry-forwards from Phase 37 that did not ship in v3.0.

## Phase 37 deferrals

| ID | Description | Target | Source |
|----|-------------|--------|--------|
| DEFERRED-37-A | Android preflight rules (`.apk` rule pack — `nm`-equivalent symbol scan via `aapt`/`dexdump`) | v3.1 | 37-CONTEXT.md Deferred Ideas + Track B Out section |
| DEFERRED-37-B | GitLab MR integration (mirror Azure/GitHub path) | v3.1 | 37-CONTEXT.md Deferred Ideas |
| DEFERRED-37-C | Bitcode-based deeper iOS analysis | not-feasible | 37-CONTEXT.md — Apple deprecated bitcode in Xcode 14 |
| DEFERRED-37-D | Cross-platform skeleton (Android dex via aapt) | v3.1 fast-follow | 37-CONTEXT.md Deferred Ideas |
| DEFERRED-37-E | Figma checker | v3.1+ or backlog | 37-BRIEF.md Out section |
| DEFERRED-37-F | Push notification testing | v3.1 | 37-BRIEF.md Out section |
| DEFERRED-37-G | Security scanner / pentest | out-of-milestone | 37-BRIEF.md Out section |
| DEFERRED-37-H | OAuth (PAT) fallback for GitHub PR-bot | v3.1 if requested | 37-CONTEXT.md Claude's Discretion — GitHub App chosen for production |
| DEFERRED-37-I | Rule pack update mechanism (`npm run preflight:update`) | v3.1 | 37-RESEARCH.md Open Question #4 |
| DEFERRED-37-J | Hermes precision tuning on real customer apps | post-launch monitor | 37-RESEARCH.md Confidence LOW |
| DEFERRED-37-K | Live GitHub App + sandbox repo round-trip verification | operator first-deploy | Plan 37-05 Task 2 checkpoint — autonomous chain has no GitHub App |
| DEFERRED-37-L | semgrep CWE-79 false positive at `server/api/routes.ts:331` (artifact download stream) | future cleanup pass | 37-04 SUMMARY §Out-of-scope warnings |
| DEFERRED-37-M | semgrep CWE-319 (insecure WebSocket) at `cli/cmd/run.go` `buildWSURL` (pre-existing) | future cleanup pass | 37-03 + 37-04 SUMMARY §Out-of-scope warnings |

## Carry-forwards from prior phases

| ID | Description | Status |
|----|-------------|--------|
| DEFERRED-15-A | Map-vs-RequestContext tsc inheritance (9 pre-existing errors) | UNCHANGED by Phase 37 |
| DEFERRED-17-A | fastify-zod-openapi v5 required-emission bug | UNCHANGED (v6 not released through 2026-05-16) |
| DEFERRED-26-A | Bootstrap CLI `device-farm admin-grant <keyId>` | → Phase 28 (deferred from v3.0; still pending) |
