# Ticket: phase 3i — the ~90 ms host/transport cost of an idle open describe

Repo: ARGENT FORK. Worktree: create
`/private/tmp/claude-501/-Users-heicg-Desktop-projects-device-farm-device-stream/f494020d-4d6d-4533-9918-a025d7c363ad/scratchpad/argent-p3i`
on branch `feat/android-open-server-p3i` from `feat/android-open-server`
(now d13cbec7 = 3g+3g-b). Never edit other worktrees. NO local emulator/adb.
Most of this ticket is OFFLINE (fixture-driven micro-bench); CI only at the
end via `feat/bench-ci-3i` + `gh workflow run … -f suite=latency`.

## Evidence (CI runs 33736918373 / 33738386658, x86_64)
Idle `describe`: OFF 68–72 ms p50; ON 108–112 ms. Server-side stages on ON
sum to ≈22 ms (rootMs 1–2, rootsMs 1–5, serializeMs 5–7, encodeMs 10–18,
idleMs 0). So ~85–90 ms is outside the Kotlin handler: NDJSON write/read
over `adb forward` TCP, host JSON.parse of the nested tree (1892 B rendered,
but the wire payload is the FULL nested tree — how many KB?), `nestedToParsed`
+ v2 trim + `formatDescribeTree`, the tool wrapper (registry, flags, mutex,
service ref resolution), and `getScreenSize`/other side RPCs if any remain
on the describe path. The proprietary path pays one HTTP call to a local
Rust server that returns an already-trimmed XML.

## Work
1. **Host micro-bench (offline, no device).** `packages/tool-server/scripts/bench-describe-host.ts`:
   load a captured nested-tree JSON fixture (add one from the goldens or
   capture in CI step and commit as fixture), and time N=200 each:
   `JSON.parse`, `nestedToParsed`, trim (`buildDescribeTreeFromParsedRoot`),
   `formatDescribeTree`, o200k tokenization. Report p50 per stage and the
   payload size. Unit-test the script's harness.
2. **Wire cost.** In the describe open path, count RPCs per describe (must
   be exactly 1 `getNestedState`) and bytes on the wire; add `wireBytes`
   and `hostParseMs`/`hostRenderMs` to the describe metadata (next to
   `timings`). Log them in the bench scoreboard as a stage row.
3. **Cut what the numbers say.** Candidates, in order of expected gain:
   (a) payload: server sends only fields the trim reads and omits nodes
   the trim drops when `compact:true` is requested (move the v2 trim's
   node-drop rules server-side; keep the host render identical — goldens
   are the contract); (b) `serialization: "json"` per line → keep NDJSON
   but avoid re-stringify/`toString()` double encode (encodeMs 10–18 on
   device suggests `JSONObject.toString`; consider a streaming writer);
   (c) host: avoid `JSON.parse` → object → parsed → tree copies (parse
   straight into the parsed shape); (d) tool wrapper overhead: measure the
   registry/mutex/flag path with the device mocked (unit-level timer) and
   remove per-call flag file reads if any remain (flags are read from disk
   on every `isFlagEnabled` — cache per process with invalidation).
4. **Nagle/TCP:** confirm `setNoDelay(true)` on the host socket and
   `tcpNoDelay` on the Kotlin accepted socket; measure `ping` p50 in CI
   (should be ~1 ms).
5. CI run: append "v10 / phase 3i" to
   `/Users/heicg/Desktop/projects/device-farm/docs/specs/2026-09-02-open-vs-proprietary-results-v4.md`
   with idle describe OFF vs ON p50/p95, the host stage table, wire bytes
   before/after. Target: ON idle describe ≤ OFF + 10 ms on the same run;
   tokens and goldens unchanged.
Commit + push branches; report numbers and run URL.
