package client

// Ring is a 2-frame copy-on-borrow buffer pair.
//
// Per 33-RESEARCH.md §Borrow problem: the emulator reuses the SAME MMAP offset
// for every frame, so by the time the encoder is mid-frame the gRPC dispatcher
// may already be writing frame N+1 onto the same bytes. We memcpy each frame
// into the inactive slot so the encoder always reads from a stable buffer.
//
// At 1440p RGBA8888 each slot is ~17 MiB; copying both at 30fps is ~510 MB/s,
// well within DDR5 bandwidth on Apple Silicon.
type Ring struct {
	bufs [2][]byte
	idx  int
}

// NewRing pre-allocates a pair of maxLen-sized buffers so Next never grows.
func NewRing(maxLen int) *Ring {
	return &Ring{bufs: [2][]byte{
		make([]byte, maxLen),
		make([]byte, maxLen),
	}}
}

// Next returns a slice of length `length` (clipped to maxLen) from the next
// slot, then advances the index. Two consecutive Next() calls always return
// slices backed by DIFFERENT arrays.
func (r *Ring) Next(length int) []byte {
	if length > len(r.bufs[r.idx]) {
		length = len(r.bufs[r.idx])
	}
	b := r.bufs[r.idx][:length]
	r.idx = (r.idx + 1) % 2
	return b
}
