// Package ui contains small, dependency-free terminal-rendering helpers used
// by CLI command implementations.
package ui

import (
	"fmt"
	"strings"
)

// RenderUpdateBanner returns a multi-line ASCII box advertising an available
// update from currentVer -> latestVer.
//
// Example output:
//
//	+-------------------------------------------+
//	|  Update available: v1.0.0 -> v2.0.0       |
//	|  Run: device-farm self-update             |
//	+-------------------------------------------+
//
// Uses only +, -, | for maximum portability (no Unicode box-drawing chars).
// No third-party dependencies — CONTEXT decision for Phase 31.
func RenderUpdateBanner(currentVer, latestVer string) string {
	line1 := fmt.Sprintf("  Update available: %s -> %s  ", currentVer, latestVer)
	line2 := "  Run: device-farm self-update  "

	// Width is the longest body line so the right border stays aligned.
	width := len(line1)
	if len(line2) > width {
		width = len(line2)
	}

	border := "+" + strings.Repeat("-", width) + "+"

	var b strings.Builder
	b.WriteString(border)
	b.WriteString("\n")
	b.WriteString("|" + padRight(line1, width) + "|")
	b.WriteString("\n")
	b.WriteString("|" + padRight(line2, width) + "|")
	b.WriteString("\n")
	b.WriteString(border)
	b.WriteString("\n")
	return b.String()
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
