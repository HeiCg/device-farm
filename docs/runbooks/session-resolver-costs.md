# Session Resolver Costs — Operator Runbook

**Phase 34 Plan 34-08.** Cost model and recommended-settings reference for
the natural-language target resolver chain (`device_tap_by_description`).

## Cost model

Two resolver backends ship in Phase 34:

| Backend            | Cost per resolve | Latency  | Network req? | Notes                                                                       |
| ------------------ | ---------------- | -------- | ------------ | --------------------------------------------------------------------------- |
| `maestro-ai`       | $0 (free)        | ~50-200ms | no           | Deterministic XML heuristic on the uiautomator / simctl hierarchy dump.      |
| `claude-vision`    | $0.005-0.01     | ~1.5-4s  | yes          | Anthropic Messages API (Claude Sonnet 4.5 by default; vision + JSON output). |

### Claude Vision cost math

- Sonnet 4.5 pricing (as of Phase 34 close): **$3 / Mtok input**, **$15 /
  Mtok output**.
- A single screenshot (1080×1920 PNG) consumes ~1500 input tokens after
  Anthropic's resizing.
- Hierarchy XML + system prompt + target description adds ~500-1500 input
  tokens.
- Output is a small JSON object (`{x, y, confidence}`) — ~50 output tokens.

Per-resolve estimate: ~$0.005-0.010. A 100-resolve agent session costs
roughly **$0.50-1.00**.

### Cache amortization

The `ClaudeVisionResolver` carries a module-level LRU cache:

- **Capacity:** 100 entries.
- **TTL:** 5 minutes.
- **Key:** `sha256(screenshot) + target` — identical screens + identical
  targets share a single API call.

The cache survives plugin re-registration (module-level singleton); it
clears only on server restart. Practical hit rates depend heavily on
agent behavior: tight tap-loops on the same screen amortize aggressively
(>80% hit rate), exploratory BFS agents amortize poorly (~5-10% hit rate).

## Recommended settings by use case

| Use case                       | `SESSION_RESOLVER` value       | Why                                                                                                       |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| CI / batch testing             | `maestro-ai` (default)         | Zero cost; deterministic. If a test relies on NL targeting at all, prefer hand-written XML selectors.     |
| Interactive dev / debugging    | `claude-vision` OK             | Cost is bounded by session length; latency is acceptable during interactive use; vision handles edge cases. |
| Production agent (PR review)   | `claude-vision` (fallback only) | The chained `FallbackResolver` tries Maestro AI first; escalates to Claude only when confidence < 0.5.    |
| Continuous exploration (Phase 35) | `claude-vision` OK + LRU helps | BFS over a single app re-visits screens; LRU amortizes substantially.                                     |

The resolver mode is set via the server-side `SESSION_RESOLVER` env var
read once at server boot (changing requires server restart). Default is
`maestro-ai`; setting `SESSION_RESOLVER=claude-vision` enables the
chained fallback. Anthropic credentials read from `ANTHROPIC_API_KEY`;
absent credentials downgrade to `maestro-ai` with a `warn` log
(graceful degrade — no plugin boot failure).

The model can be overridden via `SESSION_RESOLVER_MODEL` (default
`claude-sonnet-4-5`). Sonnet was chosen over Opus for cost+latency
balance — RESEARCH §Open Q #7.

## Cost-cap hooks (deferred)

**No per-session resolver call cap is enforced in Phase 34.**
DEFERRED-34-D — Phase 37 may add a configurable
`sessions.resolver.callsPerSession` ceiling after 30-day production usage
shows whether the cap is needed. Today the only operational ceiling is
the per-action 30-second timeout (which bounds Anthropic call latency)
and the per-session rate limit (30 actions / 10s — applies to all
envelopes, not just `tapByDescription`).

For ad-hoc cost monitoring inspect the server logs for the resolver
escalation line:

```
resolver: escalating to secondary { target: "Sign In button", firstConfidence: 0.32, firstBackend: "maestro-ai" }
```

Each escalation corresponds to one Anthropic API call.

## When to disable Claude Vision

Disable (`unset SESSION_RESOLVER` or set to `maestro-ai`) when:

- Bills exceed budget without commensurate test-effectiveness gain.
- Network egress costs from the device-farm host to api.anthropic.com
  dominate.
- Agent prompts produce many low-confidence Maestro AI results due to
  bad target descriptions (fix prompts first; switching backends just
  pushes cost without improving accuracy).
- Air-gapped deployment — Claude Vision requires outbound HTTPS to
  `api.anthropic.com`.

For deeper cost modeling, the `cached: true` field on the
`ResolveTargetResult` lets server-side logs distinguish hits vs misses;
filter on `backend: 'claude-vision' AND cached: false` to count paid
calls.
