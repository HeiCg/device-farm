//go:build darwin || linux

// Package mmap — RW shared-memory region for the emulator gRPC MMAP image
// transport. Port of kittyfarm AndroidSharedImageTransport
// (GRPCFrameService.swift:66-137) — translate, do not link.
//
// The emulator process opens the backing file and writes RGBA8888 frames
// directly into the mapped pages. The Go side reads via Bytes[:] and copies
// into the Ring before handing to the encoder. The capacity is 64 MiB (large
// enough for 4032x2268x4 = ~37 MiB worst-case Android display).
package mmap

import (
	"os"
	"syscall"
)

// Region owns a single mmap'd file. Construct via New, release via Close.
type Region struct {
	Path  string
	Bytes []byte
	fd    int
}

// New creates a temp file, truncates it to capacity bytes, and mmaps it RW
// MAP_SHARED so the emulator can write into the same pages this process reads.
//
// Pitfall 1 (33-RESEARCH.md): the file MUST be truncated BEFORE Mmap, otherwise
// macOS returns SIGBUS on any access beyond the original (zero) size.
func New(capacity int) (*Region, error) {
	f, err := os.CreateTemp("", "android-grpc-*.rgba")
	if err != nil {
		return nil, err
	}
	if err := f.Truncate(int64(capacity)); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return nil, err
	}
	b, err := syscall.Mmap(int(f.Fd()), 0, capacity,
		syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	if err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return nil, err
	}
	// We can close the fd here on most Unix systems, but holding it lets
	// Close() do an explicit syscall.Close which surfaces unusual failures.
	return &Region{Path: f.Name(), Bytes: b, fd: int(f.Fd())}, nil
}

// URL returns the file:// URL the emulator expects in
// ImageTransport{Channel: MMAP, Handle: <url>}. Pitfall 2 (33-RESEARCH.md):
// the "file://" prefix is mandatory — bare paths get rejected.
func (r *Region) URL() string { return "file://" + r.Path }

// Close munmaps, closes the fd, and removes the backing file. Idempotent —
// safe to call multiple times, and safe on a nil receiver.
func (r *Region) Close() error {
	if r == nil || r.Bytes == nil {
		return nil
	}
	_ = syscall.Munmap(r.Bytes)
	r.Bytes = nil
	_ = syscall.Close(r.fd)
	_ = os.Remove(r.Path)
	return nil
}
