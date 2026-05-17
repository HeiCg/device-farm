// Package auth — Go port of kittyfarm AndroidEmulatorAuth.swift:44-101
// (READ-ONLY reference at /Users/heicg/Desktop/projects/_reference/kittyfarm — NOT a dependency).
package auth

import "strings"

// parseSimpleIni parses flat INI content (no [section] headers). Split on first
// '=' per line, trim whitespace, ignore lines without '='. Matches the
// kittyfarm AndroidEmulatorAuth.swift:90-100 inline parser.
func parseSimpleIni(data []byte) map[string]string {
	out := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		i := strings.IndexByte(line, '=')
		if i < 0 {
			continue
		}
		out[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
	}
	return out
}
