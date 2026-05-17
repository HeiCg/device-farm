// encoder_cgo_bridge.c — bridges the //export'd Go trampoline to a typed
// ds_encoder_cb. Lives in its own translation unit so the cgo prolog of
// encoder_darwin.go can stay free of conflicting prototypes for the
// auto-generated goEncoderCallback.

#include "_cgo_export.h"
#include "encoder_darwin.h"

// dsGetCallback returns the Go trampoline cast to the encoder's callback
// type. Called by encoder_darwin.go via static wrapper.
ds_encoder_cb dsGetCallback(void) {
    return (ds_encoder_cb)goEncoderCallback;
}
