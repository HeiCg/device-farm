//go:build !darwin && !linux

package mmap

import "errors"

// Region keeps the same shape as the unix build so callers compile on
// unsupported platforms — the runtime call to New will fail explicitly.
type Region struct {
	Path  string
	Bytes []byte
}

func New(capacity int) (*Region, error) {
	return nil, errors.New("mmap: unsupported OS — Phase 33 requires darwin or linux")
}

func (r *Region) URL() string { return "" }

func (r *Region) Close() error { return nil }
