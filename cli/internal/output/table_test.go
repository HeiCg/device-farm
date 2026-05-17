package output

import (
	"bytes"
	"strings"
	"testing"
)

func TestPrintTableBasic(t *testing.T) {
	var buf bytes.Buffer
	headers := []string{"Name", "Status"}
	rows := [][]string{
		{"device-1", "running"},
		{"device-2", "idle"},
		{"device-3", "error"},
	}

	PrintTable(&buf, headers, rows)
	out := buf.String()

	// Verify headers are uppercase
	if !strings.Contains(out, "NAME") {
		t.Errorf("expected uppercase header NAME, got:\n%s", out)
	}
	if !strings.Contains(out, "STATUS") {
		t.Errorf("expected uppercase header STATUS, got:\n%s", out)
	}

	// Verify all rows are present
	for _, row := range rows {
		for _, cell := range row {
			if !strings.Contains(out, cell) {
				t.Errorf("expected cell %q in output, got:\n%s", cell, out)
			}
		}
	}

	// Verify output has aligned columns (4 lines: 1 header + 3 rows)
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 4 {
		t.Errorf("expected 4 lines (1 header + 3 rows), got %d:\n%s", len(lines), out)
	}
}

func TestPrintTableEmpty(t *testing.T) {
	var buf bytes.Buffer
	headers := []string{"ID", "Platform", "Status"}

	PrintTable(&buf, headers, nil)
	out := buf.String()

	// Headers should still be printed
	if !strings.Contains(out, "ID") {
		t.Errorf("expected header ID in output, got:\n%s", out)
	}
	if !strings.Contains(out, "PLATFORM") {
		t.Errorf("expected header PLATFORM in output, got:\n%s", out)
	}

	// Should be exactly one line (headers only)
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 1 {
		t.Errorf("expected 1 line (headers only), got %d:\n%s", len(lines), out)
	}
}

func TestPrintTableSingleColumn(t *testing.T) {
	var buf bytes.Buffer
	headers := []string{"Name"}
	rows := [][]string{
		{"alpha"},
		{"beta"},
	}

	PrintTable(&buf, headers, rows)
	out := buf.String()

	// Single column should render without extra tabs
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 3 {
		t.Errorf("expected 3 lines, got %d:\n%s", len(lines), out)
	}

	// Each line should be a single value (trimmed)
	if strings.TrimSpace(lines[0]) != "NAME" {
		t.Errorf("expected header NAME, got %q", strings.TrimSpace(lines[0]))
	}
	if strings.TrimSpace(lines[1]) != "alpha" {
		t.Errorf("expected row alpha, got %q", strings.TrimSpace(lines[1]))
	}
}

func TestPrintTableAlignment(t *testing.T) {
	var buf bytes.Buffer
	headers := []string{"Name", "Status"}
	rows := [][]string{
		{"a", "running"},
		{"very-long-device-name", "idle"},
	}

	PrintTable(&buf, headers, rows)
	out := buf.String()

	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 3 {
		t.Errorf("expected 3 lines, got %d:\n%s", len(lines), out)
	}

	// The "Status" column values should start at the same position
	// due to tabwriter alignment. Find the position of the second column
	// in each line.
	headerIdx := strings.Index(lines[0], "STATUS")
	row1Idx := strings.Index(lines[1], "running")
	row2Idx := strings.Index(lines[2], "idle")

	if headerIdx < 0 || row1Idx < 0 || row2Idx < 0 {
		t.Fatalf("could not find column values in output:\n%s", out)
	}

	// All second-column values should be aligned (same start position)
	if headerIdx != row1Idx || headerIdx != row2Idx {
		t.Errorf("columns not aligned: header=%d, row1=%d, row2=%d\nOutput:\n%s",
			headerIdx, row1Idx, row2Idx, out)
	}
}
