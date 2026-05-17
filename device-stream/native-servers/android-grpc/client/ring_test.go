package client

import (
	"testing"
	"unsafe"
)

func TestRing_Next_Rotates(t *testing.T) {
	const max = 1024
	r := NewRing(max)

	a := r.Next(100)
	b := r.Next(100)
	c := r.Next(100)

	if len(a) != 100 || len(b) != 100 || len(c) != 100 {
		t.Fatalf("Next length mismatch: %d %d %d", len(a), len(b), len(c))
	}

	// a and c must be backed by the SAME underlying array (slot 0 reused);
	// b is the other slot.
	if unsafe.SliceData(a) != unsafe.SliceData(c) {
		t.Fatalf("Ring did not alternate: slot0 pointer differs across cycle")
	}
	if unsafe.SliceData(a) == unsafe.SliceData(b) {
		t.Fatalf("Ring returned same buffer for two consecutive calls (would tear)")
	}

	// Asking for more than maxLen must clip to maxLen, never panic.
	clipped := r.Next(max * 2)
	if len(clipped) != max {
		t.Fatalf("Ring.Next over-length: got len=%d want %d", len(clipped), max)
	}
}
