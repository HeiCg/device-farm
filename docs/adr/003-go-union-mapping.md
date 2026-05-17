# ADR-003: Go Discriminated-Union Mapping for WebSocket Messages

## Status

Accepted — 2026-04-17 — supersedes nothing.

## Context

Phase 17 locks the Zod → OpenAPI 3.1 → Go codegen pipeline (CLI-01 / CLI-03).
The Go generator we chose is `omissis/go-jsonschema` — narrow-scope, converts
a JSON Schema `components.schemas` block into flat Go structs with `json:`
tags. It does NOT emit idiomatic Go unions for `oneOf` schemas.

Our WS protocol is a classic tagged union. The server emits envelopes shaped
like `{type: "log"|"step"|"status", ...payload}`; Zod's `z.discriminatedUnion('type', [...])`
produces OpenAPI `oneOf` with a `discriminator.propertyName` annotation. When
`go-jsonschema` sees `oneOf`, it either emits a struct with an embedded
`interface{}` field (kills type safety) or panics on the schema (newer
versions). Neither outcome is acceptable for a CLI that marshals WS frames.

Alternatives considered:
- `oapi-codegen` — does not yet support OpenAPI 3.1 (waiting on kin-openapi upstream)
- `ogen-go/ogen` — OpenAPI 3.1 `type: [X, "null"]` unmarshal bugs unresolved as of 2026
- Hand-roll everything — misses flat-type codegen benefits for non-union structs

The cost-minimal path: use `go-jsonschema` for every flat schema, then
maintain a short `cli/internal/types/unions.go` with one `UnmarshalJSON`
per discriminated variant. The two files combined give idiomatic Go types
end-to-end.

## Decision

Hand-roll `cli/internal/types/unions.go` with a discriminator peek +
per-variant `encoding/json.Unmarshal`. The pattern is:

```go
// cli/internal/types/unions.go
package types

import (
    "encoding/json"
    "fmt"
)

type JobMessage struct {
    Type   string
    Log    *JobLogPayload
    Step   *JobStepPayload
    Status *JobStatusPayload
}

type unionPeek struct {
    Type string `json:"type"`
}

func (m *JobMessage) UnmarshalJSON(b []byte) error {
    var peek unionPeek
    if err := json.Unmarshal(b, &peek); err != nil {
        return fmt.Errorf("JobMessage: peek discriminator: %w", err)
    }
    m.Type = peek.Type
    switch peek.Type {
    case "log":
        var p JobLogPayload
        if err := json.Unmarshal(b, &p); err != nil {
            return fmt.Errorf("JobMessage[log]: %w", err)
        }
        m.Log = &p
    case "step":
        var p JobStepPayload
        if err := json.Unmarshal(b, &p); err != nil {
            return fmt.Errorf("JobMessage[step]: %w", err)
        }
        m.Step = &p
    case "status":
        var p JobStatusPayload
        if err := json.Unmarshal(b, &p); err != nil {
            return fmt.Errorf("JobMessage[status]: %w", err)
        }
        m.Status = &p
    default:
        return fmt.Errorf("JobMessage: unknown discriminator %q", peek.Type)
    }
    return nil
}
```

`MarshalJSON` mirrors the switch by re-serializing the populated variant.

Variant payload structs (`JobLogPayload`, `JobStepPayload`, `JobStatusPayload`)
are emitted by `go-jsonschema` into `cli/internal/types/generated.go`. Only
the union wrapper + its un/marshaler live in the hand-rolled file.

When adding a new variant:
1. Add the Zod variant schema to the module's `ws-schemas.ts`
2. Re-run `npm run openapi:generate && make -C cli types` to regenerate `generated.go`
3. Add a field + `case` arm to `unions.go` in this same commit
4. Add a canonical fixture to `contracts/ws-fixtures/<name>.sample.json`
5. `cli/internal/types/generated_test.go` round-trip test auto-covers the new variant

## Consequences

**Positive:**
- Strongly-typed Go WS decoder that reflects every Zod variant exactly
- Round-trip test against canonical fixtures catches schema drift in CI
- No dep on a Go library that may be slow to ship OpenAPI 3.1 support

**Negative:**
- `unions.go` must be edited by hand when adding a variant (~5 lines per variant)
- If a variant is added to Zod but `unions.go` is forgotten, the `UnmarshalJSON`
  returns `"unknown discriminator"` at runtime — mitigated by the round-trip test
  refusing to accept fixtures for unknown variants

**Reversible if:**
- `oapi-codegen` ships OpenAPI 3.1 support with idiomatic `oneOf` output
- `ogen-go/ogen` resolves OpenAPI 3.1 nullable handling and provides tagged-union support
- Either becomes the standard; swap is mechanical.

## References

- Phase 17 RESEARCH §4 Go discriminator mapping (file: .planning/phases/17-contracts-pipeline-ops-hygiene/17-RESEARCH.md)
- Phase 17 RESEARCH §Pitfall 4 (go-jsonschema oneOf limitations)
- `omissis/go-jsonschema` README: https://github.com/omissis/go-jsonschema
