package streaming

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestParseLogMessage(t *testing.T) {
	raw := `{"type":"log","data":{"line":"Running tests...","stream":"stdout"},"timestamp":"2024-01-01T00:00:00Z"}`

	var msg JobMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("unmarshal JobMessage: %v", err)
	}

	if msg.Type != MsgLog {
		t.Errorf("type = %q, want %q", msg.Type, MsgLog)
	}

	var d LogData
	if err := json.Unmarshal(msg.Data, &d); err != nil {
		t.Fatalf("unmarshal LogData: %v", err)
	}

	if d.Line != "Running tests..." {
		t.Errorf("line = %q, want %q", d.Line, "Running tests...")
	}
	if d.Stream != "stdout" {
		t.Errorf("stream = %q, want %q", d.Stream, "stdout")
	}
}

func TestParseStepMessage(t *testing.T) {
	cmd := "Tap on \"Login\""
	dur := 1234
	raw, _ := json.Marshal(JobMessage{
		Type:      MsgStep,
		Data:      mustMarshal(StepData{FlowName: "login-flow", Command: &cmd, Status: "passed", DurationMs: &dur}),
		Timestamp: "2024-01-01T00:00:01Z",
	})

	var msg JobMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	var d StepData
	if err := json.Unmarshal(msg.Data, &d); err != nil {
		t.Fatalf("unmarshal StepData: %v", err)
	}

	if d.FlowName != "login-flow" {
		t.Errorf("flowName = %q, want %q", d.FlowName, "login-flow")
	}
	if d.Command == nil || *d.Command != cmd {
		t.Errorf("command = %v, want %q", d.Command, cmd)
	}
	if d.Status != "passed" {
		t.Errorf("status = %q, want %q", d.Status, "passed")
	}
	if d.DurationMs == nil || *d.DurationMs != 1234 {
		t.Errorf("durationMs = %v, want 1234", d.DurationMs)
	}
}

func TestParseStatusMessage(t *testing.T) {
	tests := []struct {
		status   string
		terminal bool
	}{
		{"running", false},
		{"passed", true},
		{"failed", true},
		{"cancelled", true},
		{"timeout", true},
	}

	for _, tt := range tests {
		raw, _ := json.Marshal(JobMessage{
			Type:      MsgStatus,
			Data:      mustMarshal(StatusData{Status: tt.status}),
			Timestamp: "2024-01-01T00:00:00Z",
		})

		var msg JobMessage
		json.Unmarshal(raw, &msg)

		var d StatusData
		json.Unmarshal(msg.Data, &d)

		if got := IsTerminalStatus(d.Status); got != tt.terminal {
			t.Errorf("IsTerminalStatus(%q) = %v, want %v", tt.status, got, tt.terminal)
		}
	}
}

func TestSummaryOutput(t *testing.T) {
	summary := &JobSummary{
		Passed:     5,
		Failed:     1,
		Skipped:    0,
		Total:      6,
		Duration:   12345 * time.Millisecond,
		DeviceName: "pixel_6_api34",
		FailedFlows: []FailedFlow{
			{FlowName: "login-flow", FailingStep: "Tap on \"Submit\""},
		},
	}

	var buf bytes.Buffer
	PrintSummary(&buf, summary, false) // non-TTY for predictable output

	out := buf.String()

	expects := []string{
		"5 passed",
		"1 failed",
		"0 skipped",
		"12.3s",
		"pixel_6_api34",
		"login-flow > Tap on \"Submit\"",
		"Failed:",
	}

	for _, want := range expects {
		if !bytes.Contains([]byte(out), []byte(want)) {
			t.Errorf("summary output missing %q\nGot:\n%s", want, out)
		}
	}
}

func TestSummaryNilSafe(t *testing.T) {
	var buf bytes.Buffer
	PrintSummary(&buf, nil, false)
	if buf.Len() != 0 {
		t.Errorf("PrintSummary(nil) should produce no output, got %q", buf.String())
	}
}

func mustMarshal(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
