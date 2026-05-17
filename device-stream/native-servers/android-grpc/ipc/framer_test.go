package ipc

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"testing"
)

// Each kind round-trips: Encode → bytes.NewReader → Decode → equal payload.
func TestFramerRoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		kind    uint8
		payload []byte
	}{
		{"0x01 SPS+PPS", KindParamSets, []byte{0x01, 0x67, 0x42, 0x00, 0x1E}},
		{"0x02 H.264 AU", KindAVCCAccessUnit, bytes.Repeat([]byte{0xAB}, 1024)},
		{"0x03 metadata", KindMetadata, EncodeMetadata(MetadataPayload{Width: 1080, Height: 1920, FPS: 30})},
		{"0x10 ack", KindAck, nil},
		{"0xFF error", KindError, []byte("encoder failed")},
		{"0xC1 touch", KindTouch, EncodeTouch(TouchPayload{X: 0.5, Y: 0.25, Phase: 1, Pressure: 1.0, ID: 42})},
		{"0xC2 key", KindKey, EncodeKey(KeyPayload{EventType: 0, KeyCode: 0x07, ModMask: 0})},
		{"0xC9 quit", KindQuit, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			frame := Encode(tc.kind, tc.payload)

			// Header: 4-byte BE length covering kind + payload.
			wantLen := uint32(1 + len(tc.payload))
			gotLen := binary.BigEndian.Uint32(frame[0:4])
			if gotLen != wantLen {
				t.Fatalf("header length = %d, want %d", gotLen, wantLen)
			}
			if frame[4] != tc.kind {
				t.Fatalf("kind byte = %#x, want %#x", frame[4], tc.kind)
			}

			kind, payload, err := Decode(bytes.NewReader(frame))
			if err != nil {
				t.Fatalf("Decode: %v", err)
			}
			if kind != tc.kind {
				t.Fatalf("decoded kind = %#x, want %#x", kind, tc.kind)
			}
			if !bytes.Equal(payload, tc.payload) {
				t.Fatalf("decoded payload mismatch")
			}
		})
	}
}

func TestFramerTouchPayload(t *testing.T) {
	in := TouchPayload{X: 0.5, Y: 0.25, Phase: 1, Pressure: 1.0, ID: 42}
	b := EncodeTouch(in)
	if len(b) != 29 {
		t.Fatalf("EncodeTouch length = %d, want 29", len(b))
	}
	// Phase 32 fixture: kind=0xC1 with this payload gives header [0x00 0x00 0x00 0x1E 0xC1].
	frame := Encode(KindTouch, b)
	wantHeader := []byte{0x00, 0x00, 0x00, 0x1E, 0xC1}
	if !bytes.Equal(frame[:5], wantHeader) {
		t.Fatalf("header bytes mismatch:\n got: % x\nwant: % x", frame[:5], wantHeader)
	}

	out, err := DecodeTouch(b)
	if err != nil {
		t.Fatalf("DecodeTouch: %v", err)
	}
	if math.Abs(out.X-in.X) > 1e-12 ||
		math.Abs(out.Y-in.Y) > 1e-12 ||
		math.Abs(out.Pressure-in.Pressure) > 1e-12 ||
		out.Phase != in.Phase || out.ID != in.ID {
		t.Fatalf("round-trip mismatch: %+v vs %+v", out, in)
	}

	if _, err := DecodeTouch(b[:10]); err == nil {
		t.Fatalf("DecodeTouch on short input must error")
	}
}

func TestFramerKeyPayload(t *testing.T) {
	in := KeyPayload{EventType: 0, KeyCode: 0x07, ModMask: 0}
	b := EncodeKey(in)
	if len(b) != 9 {
		t.Fatalf("EncodeKey length = %d, want 9", len(b))
	}
	out, err := DecodeKey(b)
	if err != nil {
		t.Fatalf("DecodeKey: %v", err)
	}
	if out != in {
		t.Fatalf("round-trip mismatch: %+v vs %+v", out, in)
	}
	if _, err := DecodeKey(b[:3]); err == nil {
		t.Fatalf("DecodeKey on short input must error")
	}
}

func TestFramerMetadataPayload(t *testing.T) {
	in := MetadataPayload{Width: 1080, Height: 1920, FPS: 30}
	b := EncodeMetadata(in)
	if len(b) != 12 {
		t.Fatalf("EncodeMetadata length = %d, want 12", len(b))
	}
	out, err := DecodeMetadata(b)
	if err != nil {
		t.Fatalf("DecodeMetadata: %v", err)
	}
	if out != in {
		t.Fatalf("round-trip mismatch: %+v vs %+v", out, in)
	}
	if _, err := DecodeMetadata(b[:8]); err == nil {
		t.Fatalf("DecodeMetadata on short input must error")
	}
}

// Truncated input on Decode must surface as an EOF-class error.
func TestFramerTruncatedInput(t *testing.T) {
	// 3 bytes — not even the 4-byte length header.
	_, _, err := Decode(bytes.NewReader([]byte{0x00, 0x00, 0x00}))
	if err == nil || (!errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF)) {
		t.Fatalf("Decode on truncated input: got err=%v, want EOF-class", err)
	}
}
