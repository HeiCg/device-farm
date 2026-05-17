package streaming

import (
	"fmt"
	"io"

	"github.com/device-farm/cli/internal/output"
)

// PrintSummary writes a compact summary block after job completion.
func PrintSummary(w io.Writer, s *JobSummary, isTTY bool) {
	if s == nil {
		return
	}

	fmt.Fprintln(w)
	fmt.Fprintln(w, "---")

	// Results line
	passColor := output.StatusColor("passed")
	failColor := output.StatusColor("failed")

	durationStr := fmt.Sprintf("%.1fs", s.Duration.Seconds())

	if isTTY {
		fmt.Fprintf(w, "Results: ")
		passColor.Fprintf(w, "%d passed", s.Passed)
		fmt.Fprintf(w, ", ")
		if s.Failed > 0 {
			failColor.Fprintf(w, "%d failed", s.Failed)
		} else {
			fmt.Fprintf(w, "%d failed", s.Failed)
		}
		fmt.Fprintf(w, ", %d skipped (%s)\n", s.Skipped, durationStr)
	} else {
		fmt.Fprintf(w, "Results: %d passed, %d failed, %d skipped (%s)\n",
			s.Passed, s.Failed, s.Skipped, durationStr)
	}

	if s.DeviceName != "" {
		fmt.Fprintf(w, "Device: %s\n", s.DeviceName)
	}

	if len(s.FailedFlows) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "Failed:")
		failSymbol := output.StatusSymbol("failed", isTTY)
		for _, f := range s.FailedFlows {
			step := f.FlowName
			if f.FailingStep != "" {
				step = fmt.Sprintf("%s > %s", f.FlowName, f.FailingStep)
			}
			if isTTY {
				failColor.Fprintf(w, "  %s %s\n", failSymbol, step)
			} else {
				fmt.Fprintf(w, "  %s %s\n", failSymbol, step)
			}
		}
	}
}
