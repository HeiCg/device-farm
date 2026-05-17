// Phase 37 Plan 37-01 — swift-demangle batched wrapper.
//
// Wraps `xcrun swift-demangle -compact` with stdin batching. Batch size is
// fixed at SwiftDemangleBatchSize (2000) per Pitfall 2 in 37-RESEARCH.md —
// larger batches deadlock the macOS pipe (64KB buffer cap).
//
// Apple's swift-demangle is the canonical demangler; reaching for any other
// implementation would be reinventing it.

package macho

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

// SwiftDemangleBatchSize is the maximum number of symbols sent to a single
// `xcrun swift-demangle` invocation. Source: app-explorer constant
// SWIFT_DEMANGLE_BATCH = 2000 (see 37-RESEARCH.md Pitfall 2).
const SwiftDemangleBatchSize = 2000

// DemangleBatch demangles the input symbols by spawning swift-demangle once
// per chunk of at most SwiftDemangleBatchSize symbols.
//
// The result slice has the same length and order as inputs. On subprocess
// failure the partial results are discarded and the error is returned.
func DemangleBatch(symbols []string) ([]string, error) {
	if len(symbols) == 0 {
		return []string{}, nil
	}
	out := make([]string, 0, len(symbols))
	for start := 0; start < len(symbols); start += SwiftDemangleBatchSize {
		end := start + SwiftDemangleBatchSize
		if end > len(symbols) {
			end = len(symbols)
		}
		batch := symbols[start:end]
		demangled, err := runSwiftDemangle(batch)
		if err != nil {
			return nil, err
		}
		// Defensive: if the subprocess emitted fewer lines than inputs,
		// pad with the raw mangled forms so the result length matches.
		if len(demangled) != len(batch) {
			padded := make([]string, len(batch))
			for i := range batch {
				if i < len(demangled) {
					padded[i] = demangled[i]
				} else {
					padded[i] = batch[i]
				}
			}
			demangled = padded
		}
		out = append(out, demangled...)
	}
	return out, nil
}

// runSwiftDemangle spawns one `xcrun swift-demangle -compact` process,
// writes the inputs (newline-separated) to stdin, reads stdout, and
// splits on newlines.
func runSwiftDemangle(inputs []string) ([]string, error) {
	cmd := exec.Command("xcrun", "swift-demangle", "-compact")
	cmd.Stdin = strings.NewReader(strings.Join(inputs, "\n") + "\n")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("xcrun swift-demangle: %w (stderr: %s)", err, stderr.String())
	}
	// Split on \n; trim trailing empty entry caused by the final newline.
	lines := strings.Split(strings.TrimRight(stdout.String(), "\n"), "\n")
	return lines, nil
}
