// Package encode — H.264 encoder bridge.
//
// On darwin, encoder_darwin.{go,mm} bridges to VideoToolbox VTCompressionSession
// using a configuration that DUPLICATES (does not link) Phase 32's
// sim-capture-private/Sources/H264Encoder.h:18-23 — Baseline Auto, RealTime,
// AllowFrameReordering=NO, MaxKeyFrameInterval=30, AverageBitRate=4_000_000,
// ExpectedFrameRate=30. The duplication is deliberate per
// 33-RESEARCH.md Open Question #3.
//
// On non-darwin, encoder_fallback.go returns an error pointing operators at
// the DEVICE_STREAM_ANDROID_GRPC=0 escape hatch.
package encode

// Callback is invoked by the encoder for each emitted IPC frame:
//   - kind 0x01: SPS+PPS avcC blob (one-shot on first IDR)
//   - kind 0x02: AVCC H.264 access unit (every frame)
type Callback func(kind uint8, payload []byte)

// Encoder is the platform-agnostic interface. Implementations are constructed
// via New (defined in the platform-specific file).
type Encoder interface {
	EncodePixelBuffer(rgba []byte, w, h int, ptsUs int64, forceIDR bool) error
	Close() error
}

// New creates a platform encoder. Returns an error on non-darwin or when
// VTCompressionSessionCreate fails.
func New(width, height, fps, bitrate int, cb Callback) (Encoder, error) {
	return newEncoder(width, height, fps, bitrate, cb)
}
