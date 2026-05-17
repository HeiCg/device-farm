package output

// StatusSymbol returns Unicode symbols for TTY and plain text for non-TTY.
func StatusSymbol(status string, isTTY bool) string {
	if isTTY {
		return ttySymbol(status)
	}
	return plainSymbol(status)
}

func ttySymbol(status string) string {
	switch status {
	case "passed", "idle":
		return "\u2713" // checkmark
	case "failed", "timeout", "error":
		return "\u2717" // X
	case "running", "booting", "allocated":
		return "\u25CF" // filled circle
	case "queued", "cleanup":
		return "\u25CB" // circle
	case "cancelled", "offline":
		return "\u26A0" // warning triangle
	default:
		return "?"
	}
}

func plainSymbol(status string) string {
	switch status {
	case "passed", "idle":
		return "[PASS]"
	case "failed", "timeout", "error":
		return "[FAIL]"
	case "running", "booting", "allocated":
		return "[RUN]"
	case "queued", "cleanup":
		return "[PEND]"
	case "cancelled", "offline":
		return "[WARN]"
	default:
		return "[?]"
	}
}
