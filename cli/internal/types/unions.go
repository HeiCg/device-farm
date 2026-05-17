// cli/internal/types/unions.go
// Hand-rolled Go discriminated-union wrappers per ADR-003.
// go-jsonschema does NOT emit idiomatic Go `oneOf` types — this file provides
// the discriminator-based decoders that every `z.discriminatedUnion` variant
// in server/*/ws-schemas.ts maps to.
//
// Discriminator field: `type` (matches server envelope convention).
// When adding a new variant: (1) add to JobMessage struct below, (2) add to
// the switch in UnmarshalJSON + MarshalJSON, (3) add a canonical fixture in
// contracts/ws-fixtures/, (4) update the round-trip test.
package types

import (
	"encoding/json"
	"fmt"
)

// JobMessage is the top-level envelope for /ws/jobs/:id frames.
// Exactly one of Log / Step / Status is non-nil after UnmarshalJSON.
type JobMessage struct {
	Type   string
	Log    *JobLogMessage
	Step   *JobStepMessage
	Status *JobStatusMessage
}

// unionPeek extracts only the discriminator field before the full decode so
// we can dispatch to the right variant struct.
type unionPeek struct {
	Type string `json:"type"`
}

// UnmarshalJSON decodes a job-channel WS frame into the correct variant
// pointer based on the `type` discriminator. Unknown discriminators are a
// hard error (per ADR-003 Consequences) — callers should never silently drop
// frames they do not understand.
func (m *JobMessage) UnmarshalJSON(b []byte) error {
	var peek unionPeek
	if err := json.Unmarshal(b, &peek); err != nil {
		return fmt.Errorf("JobMessage: peek discriminator: %w", err)
	}
	m.Type = peek.Type
	switch peek.Type {
	case "log":
		var p JobLogMessage
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[log]: %w", err)
		}
		m.Log = &p
	case "step":
		var p JobStepMessage
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[step]: %w", err)
		}
		m.Step = &p
	case "status":
		var p JobStatusMessage
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("JobMessage[status]: %w", err)
		}
		m.Status = &p
	default:
		return fmt.Errorf("JobMessage: unknown discriminator %q", peek.Type)
	}
	return nil
}

// MarshalJSON re-serialises the populated variant. The Type field acts as the
// selector; callers must set Type alongside the matching pointer when
// constructing a JobMessage by hand.
func (m JobMessage) MarshalJSON() ([]byte, error) {
	switch m.Type {
	case "log":
		if m.Log == nil {
			return nil, fmt.Errorf("JobMessage[log]: nil payload")
		}
		return json.Marshal(m.Log)
	case "step":
		if m.Step == nil {
			return nil, fmt.Errorf("JobMessage[step]: nil payload")
		}
		return json.Marshal(m.Step)
	case "status":
		if m.Status == nil {
			return nil, fmt.Errorf("JobMessage[status]: nil payload")
		}
		return json.Marshal(m.Status)
	}
	return nil, fmt.Errorf("JobMessage: empty or unknown discriminator %q", m.Type)
}
