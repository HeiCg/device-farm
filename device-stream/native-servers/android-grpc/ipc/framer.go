// Package ipc — Phase 32 IPC wire-format framer
// ([u32 BE length][u8 kind][payload]) plus Phase 33 additive kinds 0x03
// (metadata) and 0xC2 (key event).
//
// Phase 32 reference (translate-don't-link policy):
//   device-stream/native-servers/sim-capture-private/Sources/IpcServer.{h,mm}
//   device-stream/native-servers/sim-capture-private/Tests/IpcFramerTests.mm
package ipc

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
)

// Kind constants — LOCKED by Phase 32 + Phase 33 additive extensions.
// Phase 32 server→client: 0x01 0x02 0x10 0xFF
// Phase 32 client→server: 0xC1 0xC9
// Phase 33 ADDS: 0x03 server→client (metadata); 0xC2 client→server (key event)
const (
	KindParamSets      uint8 = 0x01 // SPS+PPS avcC blob
	KindAVCCAccessUnit uint8 = 0x02 // length-prefixed H.264 NALs
	KindMetadata       uint8 = 0x03 // [u32 BE w][u32 BE h][u32 BE fps]
	KindAck            uint8 = 0x10
	KindError          uint8 = 0xFF
	KindTouch          uint8 = 0xC1 // 29-byte payload
	KindKey            uint8 = 0xC2 // 9-byte payload (Phase 33)
	KindQuit           uint8 = 0xC9
)

// Encode produces [u32 BE length (= 1 + len(payload))][u8 kind][payload].
func Encode(kind uint8, payload []byte) []byte {
	out := make([]byte, 4+1+len(payload))
	binary.BigEndian.PutUint32(out[0:4], uint32(1+len(payload)))
	out[4] = kind
	copy(out[5:], payload)
	return out
}

// Decode blocks until one full frame has been read from r, then returns
// (kind, payload, nil). EOF on the length header surfaces as io.EOF or
// io.ErrUnexpectedEOF (per io.ReadFull contract).
func Decode(r io.Reader) (uint8, []byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return 0, nil, err
	}
	length := binary.BigEndian.Uint32(hdr[:])
	if length < 1 {
		return 0, nil, errors.New("ipc: frame length < 1")
	}
	frame := make([]byte, length)
	if _, err := io.ReadFull(r, frame); err != nil {
		return 0, nil, err
	}
	return frame[0], frame[1:], nil
}

// ---------------------------------------------------------------------------
// Touch payload (29 bytes): [f64 BE x][f64 BE y][u8 phase][f64 BE pressure][u32 BE id]
// ---------------------------------------------------------------------------

// TouchPayload mirrors Phase 32 DSFramerDecodeTouchPayload — see
// sim-capture-private/Sources/IpcServer.mm.
type TouchPayload struct {
	X, Y, Pressure float64
	Phase          uint8 // 0=began 1=moved 2=ended 3=cancelled
	ID             uint32
}

func EncodeTouch(p TouchPayload) []byte {
	buf := make([]byte, 29)
	binary.BigEndian.PutUint64(buf[0:8], math.Float64bits(p.X))
	binary.BigEndian.PutUint64(buf[8:16], math.Float64bits(p.Y))
	buf[16] = p.Phase
	binary.BigEndian.PutUint64(buf[17:25], math.Float64bits(p.Pressure))
	binary.BigEndian.PutUint32(buf[25:29], p.ID)
	return buf
}

func DecodeTouch(b []byte) (TouchPayload, error) {
	if len(b) != 29 {
		return TouchPayload{}, errors.New("ipc: touch payload must be 29 bytes")
	}
	return TouchPayload{
		X:        math.Float64frombits(binary.BigEndian.Uint64(b[0:8])),
		Y:        math.Float64frombits(binary.BigEndian.Uint64(b[8:16])),
		Phase:    b[16],
		Pressure: math.Float64frombits(binary.BigEndian.Uint64(b[17:25])),
		ID:       binary.BigEndian.Uint32(b[25:29]),
	}, nil
}

// ---------------------------------------------------------------------------
// Key payload (9 bytes): [u8 eventType][u32 BE keyCode][u32 BE modMask]
// Phase 33 ADDITIVE.
// ---------------------------------------------------------------------------

type KeyPayload struct {
	EventType uint8 // 0=down 1=up
	KeyCode   uint32
	ModMask   uint32
}

func EncodeKey(p KeyPayload) []byte {
	buf := make([]byte, 9)
	buf[0] = p.EventType
	binary.BigEndian.PutUint32(buf[1:5], p.KeyCode)
	binary.BigEndian.PutUint32(buf[5:9], p.ModMask)
	return buf
}

func DecodeKey(b []byte) (KeyPayload, error) {
	if len(b) != 9 {
		return KeyPayload{}, errors.New("ipc: key payload must be 9 bytes")
	}
	return KeyPayload{
		EventType: b[0],
		KeyCode:   binary.BigEndian.Uint32(b[1:5]),
		ModMask:   binary.BigEndian.Uint32(b[5:9]),
	}, nil
}

// ---------------------------------------------------------------------------
// Metadata payload (12 bytes): [u32 BE width][u32 BE height][u32 BE fps]
// Phase 33 ADDITIVE (kind 0x03).
// ---------------------------------------------------------------------------

type MetadataPayload struct {
	Width, Height, FPS uint32
}

func EncodeMetadata(p MetadataPayload) []byte {
	buf := make([]byte, 12)
	binary.BigEndian.PutUint32(buf[0:4], p.Width)
	binary.BigEndian.PutUint32(buf[4:8], p.Height)
	binary.BigEndian.PutUint32(buf[8:12], p.FPS)
	return buf
}

func DecodeMetadata(b []byte) (MetadataPayload, error) {
	if len(b) != 12 {
		return MetadataPayload{}, errors.New("ipc: metadata payload must be 12 bytes")
	}
	return MetadataPayload{
		Width:  binary.BigEndian.Uint32(b[0:4]),
		Height: binary.BigEndian.Uint32(b[4:8]),
		FPS:    binary.BigEndian.Uint32(b[8:12]),
	}, nil
}
