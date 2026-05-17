//go:build darwin

package encode

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation -framework VideoToolbox -framework CoreMedia -framework CoreVideo -framework CoreFoundation
#include "encoder_darwin.h"

// dsGetCallback is implemented in encoder_cgo_bridge.c (separate translation
// unit) — that file includes _cgo_export.h and casts the //export'd Go
// trampoline to ds_encoder_cb. Forward-decl here so the prolog compiles.
ds_encoder_cb dsGetCallback(void);

static DSEncoder* dsNew(int width, int height, int fps, int bitrate, void* user) {
    return ds_encoder_new(width, height, fps, bitrate, dsGetCallback(), user);
}
static int dsEncode(DSEncoder* e, const unsigned char* rgba, int width, int height, long long pts_us, int force_idr) {
    return ds_encoder_encode(e, (const uint8_t*)rgba, width, height, (int64_t)pts_us, force_idr);
}
static void dsClose(DSEncoder* e) { ds_encoder_close(e); }
*/
import "C"

import (
	"errors"
	"runtime/cgo"
	"unsafe"
)

// vtEncoder wraps the C-side DSEncoder + a cgo.Handle that bridges the
// VideoToolbox output callback into the Go Callback closure.
type vtEncoder struct {
	handle *C.DSEncoder
	cbHnd  cgo.Handle
}

//export goEncoderCallback
func goEncoderCallback(user unsafe.Pointer, kind C.uchar, payload *C.uchar, length C.int) {
	h := cgo.Handle(uintptr(user))
	cb, ok := h.Value().(Callback)
	if !ok || cb == nil {
		return
	}
	cb(uint8(kind), C.GoBytes(unsafe.Pointer(payload), length))
}

func newEncoder(width, height, fps, bitrate int, cb Callback) (Encoder, error) {
	if cb == nil {
		return nil, errors.New("encode: nil callback")
	}
	hnd := cgo.NewHandle(cb)
	e := C.dsNew(
		C.int(width), C.int(height), C.int(fps), C.int(bitrate),
		unsafe.Pointer(uintptr(hnd)),
	)
	if e == nil {
		hnd.Delete()
		return nil, errors.New("encode: VTCompressionSessionCreate failed")
	}
	return &vtEncoder{handle: e, cbHnd: hnd}, nil
}

func (v *vtEncoder) EncodePixelBuffer(rgba []byte, w, h int, ptsUs int64, forceIDR bool) error {
	if v == nil || v.handle == nil {
		return errors.New("encode: closed encoder")
	}
	if len(rgba) < w*h*4 {
		return errors.New("encode: rgba buffer too small")
	}
	force := C.int(0)
	if forceIDR {
		force = 1
	}
	rc := C.dsEncode(
		v.handle,
		(*C.uchar)(unsafe.Pointer(&rgba[0])),
		C.int(w), C.int(h),
		C.longlong(ptsUs),
		force,
	)
	if rc != 0 {
		return errors.New("encode: VT encode failed")
	}
	return nil
}

func (v *vtEncoder) Close() error {
	if v == nil || v.handle == nil {
		return nil
	}
	C.dsClose(v.handle)
	v.handle = nil
	v.cbHnd.Delete()
	return nil
}
