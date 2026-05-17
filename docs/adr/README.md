# Architecture Decision Records (ADR)

This directory holds the Device Farm ADRs — the durable, LLM-readable record of structural decisions that shape the codebase across milestones.

## Convention

- **Filename pattern:** `NNN-slug.md` — zero-padded 3-digit sequence number followed by a kebab-case slug (e.g., `001-spec-driven-architecture.md`).
- **Format:** Michael Nygard ADR template with four top-level H2 sections in order: `## Status`, `## Context`, `## Decision`, `## Consequences`.
- **Append-only:** ADRs are immutable once Accepted. To change a decision, write a new ADR that `Supersedes NNN` — do not edit the original.

## Index

| #   | Title                                             | Status   | Date       |
| --- | ------------------------------------------------- | -------- | ---------- |
| 001 | Spec-Driven + Event-Driven Architecture for v3.0  | Accepted | 2026-04-17 |
| 002 | Repo-wide File-Naming Convention                  | Accepted | 2026-04-17 |
| 003 | [Go Union Mapping](003-go-union-mapping.md)       | Accepted | 2026-04-17 |

## Numbering

- `004+`: assigned as needed; claim a number by writing the file with that prefix.

To mint a new ADR, pick the next unused `NNN`, create `NNN-your-slug.md`, and add a row to the Index table in this README as part of the same commit.
