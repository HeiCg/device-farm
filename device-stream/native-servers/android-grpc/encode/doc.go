// Package encode — H.264 encoder (cgo VideoToolbox on darwin/arm64) consuming
// RGBA frames from package mmap and emitting [u32 BE length][u8 kind][payload]
// frames to the IPC framer.
// (Wave 5 fills in the encoder; Wave 0 ships scaffolds only.)
package encode
