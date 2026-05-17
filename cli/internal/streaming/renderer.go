package streaming

import (
	"fmt"
	"io"
	"time"

	"github.com/device-farm/cli/internal/output"
)

// Renderer implements MessageHandler with TTY-aware step display.
type Renderer struct {
	w               io.Writer
	isTTY           bool
	startTime       time.Time
	currentFlowName string
	completedSteps  []StepData
	failedFlows     []FailedFlow
	passed          int
	failed          int
	skipped         int
	total           int
	finalStatus     string
	deviceName      string
}

// NewRenderer creates a Renderer that writes to w with TTY awareness.
func NewRenderer(w io.Writer, isTTY bool) *Renderer {
	return &Renderer{
		w:         w,
		isTTY:     isTTY,
		startTime: time.Now(),
	}
}

// Summary returns the accumulated JobSummary.
func (r *Renderer) Summary() *JobSummary {
	return &JobSummary{
		Passed:      r.passed,
		Failed:      r.failed,
		Skipped:     r.skipped,
		Total:       r.total,
		Duration:    time.Since(r.startTime),
		DeviceName:  r.deviceName,
		FailedFlows: r.failedFlows,
	}
}

// HandleLog prints a log line.
func (r *Renderer) HandleLog(d LogData) {
	if r.isTTY {
		fmt.Fprintln(r.w, d.Line)
	} else {
		if d.Stream == "stderr" {
			fmt.Fprintf(r.w, "[stderr] %s\n", d.Line)
		} else {
			fmt.Fprintln(r.w, d.Line)
		}
	}
}

// HandleStep renders a step update with TTY inline updating.
func (r *Renderer) HandleStep(d StepData) {
	cmd := ""
	if d.Command != nil {
		cmd = *d.Command
	}

	symbol := output.StatusSymbol(d.Status, r.isTTY)

	if d.Status == "running" {
		if r.isTTY {
			// Clear current line and write running step
			line := fmt.Sprintf("  %s %s", symbol, formatStep(d.FlowName, cmd))
			// If we had a previous running line, move up and clear
			if r.currentFlowName != "" {
				fmt.Fprintf(r.w, "\033[1A\033[2K")
			}
			fmt.Fprintln(r.w, line)
			r.currentFlowName = d.FlowName
		} else {
			fmt.Fprintf(r.w, "%s %s\n", symbol, formatStep(d.FlowName, cmd))
		}
		return
	}

	// Completed step (passed, failed, etc.)
	r.completedSteps = append(r.completedSteps, d)
	r.total++

	switch d.Status {
	case "passed":
		r.passed++
	case "failed":
		r.failed++
		r.failedFlows = append(r.failedFlows, FailedFlow{
			FlowName:    d.FlowName,
			FailingStep: cmd,
		})
	default:
		r.skipped++
	}

	if r.isTTY {
		// If there was a running line, clear it first
		if r.currentFlowName != "" {
			fmt.Fprintf(r.w, "\033[1A\033[2K")
			r.currentFlowName = ""
		}
		c := output.StatusColor(d.Status)
		line := fmt.Sprintf("  %s %s", symbol, formatStep(d.FlowName, cmd))
		if d.DurationMs != nil {
			line += fmt.Sprintf(" (%dms)", *d.DurationMs)
		}
		c.Fprintln(r.w, line)
	} else {
		line := fmt.Sprintf("%s %s", symbol, formatStep(d.FlowName, cmd))
		if d.DurationMs != nil {
			line += fmt.Sprintf(" (%dms)", *d.DurationMs)
		}
		fmt.Fprintln(r.w, line)
	}
}

// HandleStatus records the final job status.
func (r *Renderer) HandleStatus(d StatusData) {
	r.finalStatus = d.Status
}

// HandleMetrics is a no-op in v1 (metrics display is Web UI concern).
func (r *Renderer) HandleMetrics(_ MetricsData) {}

func formatStep(flowName, command string) string {
	if command != "" {
		return fmt.Sprintf("%s > %s", flowName, command)
	}
	return flowName
}
