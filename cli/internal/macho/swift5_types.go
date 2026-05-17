// Phase 37 Plan 37-01 — Swift5 type extraction.
//
// Walks the __swift5_types section of a Mach-O binary, reading 4-byte
// little-endian relative offsets to nominal type descriptors. For each
// descriptor, follows the offset to read the mangled type name.
//
// Implementation strategy follows app_explorer/skeleton/ios.py Swift5
// extractor: shell to `otool -l <binary>` to discover the __swift5_types
// section offset + size, then read those bytes from the binary directly.
//
// Returns an empty slice (not an error) when the section is absent — the
// binary simply has no Swift code.

package macho

import (
	"bufio"
	"bytes"
	enc "encoding/binary"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// Swift5Type is one mangled type entry from the __swift5_types section.
// `Module` is the demangled module name (e.g. "MyApp"); empty until
// swift-demangle has run.
type Swift5Type struct {
	MangledName string
	Module      string
}

// ParseSwift5Types reads __swift5_types from the binary and returns the
// mangled type list. Returns an empty slice (not an error) when the
// section is absent.
//
// Algorithm:
//  1. `otool -l <binary>` enumerates load commands; find the section
//     named __swift5_types and parse its `offset` and `size`.
//  2. Open the binary, seek to offset, read size bytes.
//  3. The section is an array of 4-byte little-endian relative offsets
//     each pointing to a nominal type descriptor. Each descriptor begins
//     with flags + parent + name (relative offset to a null-terminated
//     mangled name string).
//  4. We use a pragmatic heuristic compatible with app-explorer: walk
//     the section bytes, follow each 4-byte int32 offset relative to its
//     own position, read a null-terminated string at the target, validate
//     it looks like a mangled Swift type ($s prefix or printable ASCII),
//     collect it.
//
// This is a best-effort port — it handles the common cases (Swift 5+
// builds) but does NOT walk parent/flags fields. Wave 2+ may swap for a
// full descriptor walker if false-negative rate proves too high.
func ParseSwift5Types(binaryPath string) ([]Swift5Type, error) {
	offset, size, err := findSwift5TypesSection(binaryPath)
	if err != nil {
		return nil, err
	}
	if size == 0 {
		// Section absent — not an error.
		return []Swift5Type{}, nil
	}

	f, err := os.Open(binaryPath)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", binaryPath, err)
	}
	defer f.Close()

	if _, err := f.Seek(int64(offset), io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek to __swift5_types: %w", err)
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(f, buf); err != nil {
		return nil, fmt.Errorf("read __swift5_types: %w", err)
	}

	// The section is a flat array of int32 relative offsets. Each pointer
	// resolves to a nominal type descriptor whose first ~3 fields are
	// flags/parent/name. The name field is itself a 4-byte relative
	// offset to a null-terminated mangled string.
	//
	// For app-explorer parity we walk each 4-byte offset, follow it to
	// the target, then attempt to read the descriptor's name pointer at
	// fixed offset +8 (flags=4 + parent=4 = 8 bytes before name).
	//
	// All pointer resolution is RELATIVE to the pointer's own position in
	// the binary (not the section). We need the absolute file offset of
	// each pointer for that calculation.
	out := []Swift5Type{}
	for i := 0; i+4 <= len(buf); i += 4 {
		rel := int32(enc.LittleEndian.Uint32(buf[i : i+4]))
		if rel == 0 {
			continue
		}
		// Absolute file offset of this pointer.
		ptrFileOff := int64(offset) + int64(i)
		// Target descriptor file offset.
		descOff := ptrFileOff + int64(rel)
		if descOff < 0 || descOff >= 1<<31 {
			continue
		}
		// Read name relative offset at descOff+8.
		nameRelOff := descOff + 8
		nameRel, err := readInt32At(f, nameRelOff)
		if err != nil {
			continue
		}
		nameFileOff := nameRelOff + int64(nameRel)
		name, err := readCStringAt(f, nameFileOff, 256)
		if err != nil || !looksLikeMangledType(name) {
			continue
		}
		out = append(out, Swift5Type{MangledName: name})
	}
	return out, nil
}

// findSwift5TypesSection runs `otool -l <binary>` and parses the output
// for the __swift5_types section, returning the file offset and size in
// bytes. Returns (0, 0, nil) when the section is absent.
func findSwift5TypesSection(binaryPath string) (offset, size uint64, err error) {
	cmd := exec.Command("otool", "-l", binaryPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, runErr := cmd.Output()
	if runErr != nil {
		return 0, 0, fmt.Errorf("otool -l %s: %w (stderr: %s)", binaryPath, runErr, stderr.String())
	}
	offset, size = parseSwift5TypesSection(out)
	return offset, size, nil
}

// parseSwift5TypesSection scans `otool -l` output for the __swift5_types
// section header and returns its file offset + size. Returns (0, 0) when
// absent.
//
// Section block from otool -l looks like:
//
//	Section
//	  sectname __swift5_types
//	   segname __TEXT
//	      addr 0x100008e60
//	      size 0x00000150
//	    offset 36448
//	     align 2^2 (4)
//	    reloff 0
//	    nreloc 0
//	      type S_REGULAR
//	attributes (none)
//	 reserved1 0
//	 reserved2 0
func parseSwift5TypesSection(out []byte) (offset, size uint64) {
	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	inSection := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "sectname ") {
			inSection = line == "sectname __swift5_types"
			continue
		}
		if !inSection {
			continue
		}
		if strings.HasPrefix(line, "offset ") {
			val := strings.TrimSpace(strings.TrimPrefix(line, "offset"))
			n, err := strconv.ParseUint(val, 10, 64)
			if err == nil {
				offset = n
			}
		}
		if strings.HasPrefix(line, "size ") {
			val := strings.TrimSpace(strings.TrimPrefix(line, "size"))
			n, err := parseHexOrDec(val)
			if err == nil {
				size = n
			}
		}
		// Once both offset+size populated within section, return.
		if offset != 0 && size != 0 {
			return offset, size
		}
	}
	return offset, size
}

func parseHexOrDec(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		return strconv.ParseUint(s[2:], 16, 64)
	}
	return strconv.ParseUint(s, 10, 64)
}

// readInt32At reads a 4-byte little-endian int32 from the given file offset.
func readInt32At(f *os.File, off int64) (int32, error) {
	var buf [4]byte
	if _, err := f.ReadAt(buf[:], off); err != nil {
		return 0, err
	}
	return int32(enc.LittleEndian.Uint32(buf[:])), nil
}

// readCStringAt reads a null-terminated string at the given file offset.
// Caps at maxLen bytes (returns the truncated prefix without error if the
// terminator is not found in range).
func readCStringAt(f *os.File, off int64, maxLen int) (string, error) {
	if off < 0 {
		return "", fmt.Errorf("negative offset")
	}
	buf := make([]byte, maxLen)
	n, err := f.ReadAt(buf, off)
	if err != nil && err != io.EOF {
		return "", err
	}
	for i := 0; i < n; i++ {
		if buf[i] == 0 {
			return string(buf[:i]), nil
		}
	}
	return string(buf[:n]), nil
}

// looksLikeMangledType returns true when the candidate string plausibly
// contains a Swift mangled type name. Filters obvious garbage (control
// chars, all-whitespace) without being too strict — actual demangling
// happens in DemangleBatch.
func looksLikeMangledType(s string) bool {
	if s == "" || len(s) > 256 {
		return false
	}
	// Swift 5 mangling prefixes
	if strings.HasPrefix(s, "$s") || strings.HasPrefix(s, "_$s") || strings.HasPrefix(s, "_T") {
		return true
	}
	// Allow plain ASCII identifiers too (some symbols are pre-demangled).
	for _, r := range s {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}

// ParseSwift5TypesPair is the (offset, size) accessor preferred over the
// pair-via-side-return parseSwift5TypesSectionFromOtool. It's exported for
// tests to verify the otool parser without hitting a real Swift binary.
func ParseSwift5TypesPair(otoolOutput []byte) (offset, size uint64) {
	return parseSwift5TypesSection(otoolOutput)
}
