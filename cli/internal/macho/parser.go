// Package macho — iOS skeleton extraction primitives.
//
// Ports app_explorer/skeleton/ios.py (722 LOC Python) to Go using Apple's own
// toolchain (`otool` / `nm` / `xcrun swift-demangle`). Public API:
//
//   - ParseObjCClasslist(binary) -> []ObjCClass
//   - ParseSwift5Types(binary)    -> []Swift5Type
//   - DemangleBatch(symbols)      -> []string  (xcrun swift-demangle wrapper)
//   - IsHermes(bundlePath)        -> bool      (magic byte detect, hermes.go)
//   - ExtractHermesScreens(...)   -> []string  (strings + regex + artifact filter)
//   - ClassifyName(name)          -> Confidence + Kind (heuristics.go)
//
// Phase 37 Plan 37-01 Wave 1 — implements the Wave 0 stubs.

package macho

import (
	"bufio"
	"bytes"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// ObjCClass is one entry from `otool -ov`'s __objc_classlist section.
// Mirrors the Python dataclass from app_explorer/skeleton/ios.py:136-172.
type ObjCClass struct {
	MangledName        string // e.g. "MyApp.HomeViewController" or "ViewController"
	SuperclassExternal string // e.g. "UIViewController" (empty when local)
}

// ParseObjCClasslist parses `otool -ov <binary>` output for the
// __objc_classlist section, returning all classes found.
//
// Implementation strategy (matches Pattern 3 in 37-RESEARCH.md and
// app_explorer/skeleton/ios.py:136-172):
//  1. Shell to `otool -ov <binary>`.
//  2. Walk the output line by line.
//  3. Switch state to inClasslist when a "Contents of (...__objc_classlist...)"
//     header is encountered.
//  4. Skip Meta Class sub-entries.
//  5. Capture `superclass 0x... <name>` for the current class.
//  6. On a `name 0x... <name>` line, append an ObjCClass and reset.
//
// Returns an empty slice (not nil error) when the section is missing — the
// binary is simply not an ObjC binary.
func ParseObjCClasslist(binary string) ([]ObjCClass, error) {
	cmd := exec.Command("otool", "-ov", binary)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("otool -ov %s: %w (stderr: %s)", binary, err, stderr.String())
	}
	return parseObjCClasslistOutput(out), nil
}

// parseObjCClasslistOutput is the pure-function core extracted for tests.
// Accepts the raw bytes of `otool -ov` and returns the parsed class list.
//
// Algorithm:
//  1. Track section state via "Contents of (...)" headers — only emit while
//     inside an __objc_classlist section.
//  2. A class header line ("<hex16> 0x<hex> [_OBJC_CLASS_$_X]") starts a
//     new class. When the trailing symbol is present, capture it as the
//     primary class name. Reset metaclass + superclass state.
//  3. "Meta Class" line switches to metaclass mode — every subsequent
//     field is ignored until the next class header.
//  4. Indented "superclass" line stores the external superclass symbol.
//  5. Indented (8-space) "name" line is the fallback class name source for
//     older otool output that omitted the symbol from the header.
//
// Each emit produces one ObjCClass; subsequent fields for the same class
// (method names, etc.) are ignored because we only emit on the first
// header (when the symbol is on the header line) or the first 8-space
// name line (when fallback is needed).
func parseObjCClasslistOutput(out []byte) []ObjCClass {
	classes := []ObjCClass{}
	inClasslist := false
	sawMeta := false
	var currentSuper string
	var pendingName string
	emitted := false

	flush := func() {
		if !emitted && pendingName != "" {
			classes = append(classes, ObjCClass{
				MangledName:        pendingName,
				SuperclassExternal: currentSuper,
			})
			emitted = true
		}
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		// Section header switch.
		if strings.HasPrefix(line, "Contents of") {
			flush()
			inClasslist = strings.Contains(line, "__objc_classlist")
			sawMeta = false
			currentSuper = ""
			pendingName = ""
			emitted = false
			continue
		}
		if !inClasslist {
			continue
		}
		// Meta Class block marker — ignore until next class header.
		if strings.HasPrefix(strings.TrimSpace(line), "Meta Class") {
			sawMeta = true
			continue
		}
		// New class header.
		if ClassHeaderRe.MatchString(line) {
			flush()
			sawMeta = false
			currentSuper = ""
			pendingName = ""
			emitted = false
			// Try to capture class name directly from header symbol.
			if m := ClassHeaderWithSymbolRe.FindStringSubmatch(line); m != nil && len(m) >= 2 {
				pendingName = strings.TrimPrefix(m[1], "_OBJC_CLASS_$_")
			}
			continue
		}
		if sawMeta {
			continue
		}
		// 4-space "superclass" line.
		if m := SuperLineRe.FindStringSubmatch(line); m != nil {
			if len(m) >= 2 {
				currentSuper = strings.TrimPrefix(m[1], "_OBJC_CLASS_$_")
			}
			continue
		}
		// 8-space "name" line — fallback class name source. Emit
		// immediately so subsequent method "name" lines (12-space indent)
		// don't re-trigger.
		if m := NameLineRe.FindStringSubmatch(line); m != nil && len(m) >= 2 {
			if !emitted {
				name := strings.TrimPrefix(m[1], "_OBJC_CLASS_$_")
				if pendingName == "" {
					pendingName = name
				}
				classes = append(classes, ObjCClass{
					MangledName:        pendingName,
					SuperclassExternal: currentSuper,
				})
				emitted = true
			}
		}
	}
	flush()
	return classes
}

// Exported regex anchors. Wave 1 wires them into ParseObjCClasslist; Wave 0
// exposes them as compiled constants so the test file can verify they
// compile and the patterns are exactly the ones used by app-explorer.
//
// Source: app_explorer/skeleton/ios.py:136-172.
var (
	// ClassHeaderRe matches a line like "00000001000c4f78 0x1000c4f78"
	// or "0000000100005130 0x100007268 _OBJC_CLASS_$__XCTRunnerAppDelegate".
	// The trailing class symbol is optional — modern otool includes it; older
	// versions do not.
	ClassHeaderRe = regexp.MustCompile(`^[0-9a-f]{16} 0x[0-9a-f]+(?:\s+\S+)?\s*$`)

	// ClassHeaderWithSymbolRe captures the trailing class symbol (e.g.
	// "_OBJC_CLASS_$_HomeViewController") when present on the class header
	// line. Used as a primary source for the class name; the indented "name"
	// line is the fallback.
	ClassHeaderWithSymbolRe = regexp.MustCompile(`^[0-9a-f]{16} 0x[0-9a-f]+\s+(\S+)\s*$`)

	// NameLineRe matches "        name   0x1000... HomeViewController".
	NameLineRe = regexp.MustCompile(`^ {8}name\s+0x[0-9a-f]+\s+(\S+)\s*$`)

	// SuperLineRe matches "    superclass 0x...   UIViewController" (last
	// token optional — empty token means superclass is in the same image).
	SuperLineRe = regexp.MustCompile(`^    superclass\s+0x[0-9a-f]+(?:\s+(\S+))?\s*$`)
)
