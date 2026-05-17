package streaming

import (
	"encoding/json"
	"time"
)

// WsMessageType identifies the kind of WebSocket message from the server.
type WsMessageType string

const (
	MsgLog     WsMessageType = "log"
	MsgStep    WsMessageType = "step"
	MsgMetrics WsMessageType = "metrics"
	MsgStatus  WsMessageType = "status"
)

// JobMessage is the top-level envelope for all WebSocket messages.
type JobMessage struct {
	Type      WsMessageType   `json:"type"`
	Data      json.RawMessage `json:"data"`
	Timestamp string          `json:"timestamp"`
}

// LogData carries a single log line with stream identifier.
type LogData struct {
	Line   string `json:"line"`
	Stream string `json:"stream"`
}

// StepData carries a Maestro step update.
type StepData struct {
	FlowName   string `json:"flowName"`
	Command    *string `json:"command"`
	Status     string  `json:"status"`
	DurationMs *int    `json:"durationMs"`
}

// StatusData carries the overall job status.
type StatusData struct {
	Status string `json:"status"`
}

// MetricsData carries device memory metrics.
type MetricsData struct {
	TotalPss   int `json:"totalPss"`
	NativeHeap int `json:"nativeHeap"`
	JavaHeap   int `json:"javaHeap"`
}

// FailedFlow records a flow and the step where it failed.
type FailedFlow struct {
	FlowName    string
	FailingStep string
}

// JobSummary holds aggregated results after job completion.
type JobSummary struct {
	Passed      int
	Failed      int
	Skipped     int
	Total       int
	Duration    time.Duration
	DeviceName  string
	FailedFlows []FailedFlow
}

// IsTerminalStatus returns true if the status indicates the job is done.
func IsTerminalStatus(status string) bool {
	switch status {
	case "passed", "failed", "cancelled", "timeout":
		return true
	}
	return false
}

// MessageHandler processes parsed WebSocket messages.
type MessageHandler interface {
	HandleLog(LogData)
	HandleStep(StepData)
	HandleStatus(StatusData)
	HandleMetrics(MetricsData)
}
