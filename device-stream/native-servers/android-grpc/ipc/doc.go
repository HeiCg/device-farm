// Package ipc — Phase 32 IPC wire-format framer ([u32 BE length][u8 kind][payload]).
// Reuses the byte-for-byte format from sim-capture-private's IpcServer and
// adds Phase 33 additive kinds (0x03 metadata, 0xC2 key event).
// (Wave 2 fills in Framer; Wave 0 ships scaffolds only.)
package ipc
