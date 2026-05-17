// encoder_darwin.h — C ABI for the VideoToolbox H.264 encoder.
//
// Used by encoder_darwin.go (cgo) and implemented in encoder_darwin.mm.
// All configuration constants live in encoder_darwin.mm and DUPLICATE
// (do not link) sim-capture-private/Sources/H264Encoder.h:18-23.

#ifndef ENCODER_DARWIN_H
#define ENCODER_DARWIN_H

#include <stdint.h>

typedef struct DSEncoder DSEncoder;

// Callback fired by the VideoToolbox output callback. The same callback is
// used for both kinds (0x01 SPS+PPS and 0x02 AVCC AU).
typedef void (*ds_encoder_cb)(void* user, uint8_t kind, const uint8_t* payload, int len);

// ds_encoder_new returns NULL on failure. user is opaque and passed back to cb.
DSEncoder* ds_encoder_new(int width, int height, int fps, int bitrate,
                          ds_encoder_cb cb, void* user);

// ds_encoder_encode submits one RGBA frame. forceIDR != 0 forces a keyframe.
// Returns 0 on success, non-zero on failure.
int ds_encoder_encode(DSEncoder* e, const uint8_t* rgba,
                      int width, int height, int64_t pts_us, int force_idr);

void ds_encoder_close(DSEncoder* e);

#endif
