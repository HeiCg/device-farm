package output

import (
	"encoding/json"
	"io"
)

// PrintJSON outputs pretty-printed JSON to a writer.
func PrintJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
