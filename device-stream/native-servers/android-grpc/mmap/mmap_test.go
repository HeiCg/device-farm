package mmap

import (
	"os"
	"testing"
)

func TestRegion_RoundTrip(t *testing.T) {
	// Allocate a small region (1 MiB is enough for round-trip semantics).
	const cap = 1 << 20
	r, err := New(cap)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer r.Close()

	if len(r.Bytes) != cap {
		t.Fatalf("Bytes length = %d, want %d", len(r.Bytes), cap)
	}
	if r.Path == "" {
		t.Fatalf("Path is empty")
	}
	if _, err := os.Stat(r.Path); err != nil {
		t.Fatalf("backing file missing: %v", err)
	}

	// Write some bytes via the mmap'd slice.
	want := []byte{0xDE, 0xAD, 0xBE, 0xEF}
	copy(r.Bytes[0:4], want)

	// Re-open the backing file and confirm the bytes landed on disk.
	f, err := os.Open(r.Path)
	if err != nil {
		t.Fatalf("open backing file: %v", err)
	}
	defer f.Close()
	got := make([]byte, 4)
	if _, err := f.Read(got); err != nil {
		t.Fatalf("read: %v", err)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("byte %d: got %#x want %#x", i, got[i], want[i])
		}
	}

	// URL must include the file:// scheme and the absolute path.
	if got, want := r.URL(), "file://"+r.Path; got != want {
		t.Fatalf("URL = %q want %q", got, want)
	}
}

func TestRegion_Close(t *testing.T) {
	r, err := New(1 << 20)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	path := r.Path

	if err := r.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("backing file still exists after Close: err=%v", err)
	}

	// Idempotent: second Close must not panic and must return nil.
	if err := r.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}

	// Close on a nil receiver must be safe too.
	var nilR *Region
	if err := nilR.Close(); err != nil {
		t.Fatalf("nil Close: %v", err)
	}
}
