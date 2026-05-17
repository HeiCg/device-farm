package output

import (
	"io"
	"strings"
	"text/tabwriter"
)

// PrintTable renders column-aligned output with headers using tabwriter.
// It produces kubectl-style aligned columns with no box-drawing characters.
func PrintTable(w io.Writer, headers []string, rows [][]string) {
	tw := tabwriter.NewWriter(w, 0, 8, 2, ' ', 0)

	// Print headers in uppercase, tab-separated
	upper := make([]string, len(headers))
	for i, h := range headers {
		upper[i] = strings.ToUpper(h)
	}
	_, _ = tw.Write([]byte(strings.Join(upper, "\t") + "\n"))

	// Print each row tab-separated
	for _, row := range rows {
		_, _ = tw.Write([]byte(strings.Join(row, "\t") + "\n"))
	}

	tw.Flush()
}
