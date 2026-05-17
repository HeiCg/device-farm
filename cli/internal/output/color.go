package output

import "github.com/fatih/color"

// StatusColor maps job/device statuses to terminal colors.
func StatusColor(status string) *color.Color {
	switch status {
	case "passed", "idle":
		return color.New(color.FgGreen)
	case "failed", "timeout", "error", "offline":
		return color.New(color.FgRed)
	case "running", "booting", "allocated":
		return color.New(color.FgCyan)
	case "queued", "cancelled", "cleanup":
		return color.New(color.FgYellow)
	default:
		return color.New(color.Reset)
	}
}
