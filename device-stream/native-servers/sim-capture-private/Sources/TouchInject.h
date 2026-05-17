// TouchInject.h — HID touch injection via SimulatorKit private API.
//
// Implemented in Plan 32-02 (T-32.3).  Verbatim port (with `DF`→`DS`
// rename only) of the HID send path from kittyfarm
// `DFPrivateSimulatorDisplayBridge.m` lines 884-988.  Reference repo is
// STUDY-ONLY — no linked dependency.
//
// Touch coordinates are normalized ratios `[0..1]` in device-screen space.
// The helper passes them straight through to
// `IndigoHIDMessageForMouseNSEvent` alongside `SimDeviceScreen.bounds`
// (the display pixel size captured by `ScreenAttach.mm`'s frame
// callback).  NO pre-multiplication — resolves Research Open
// Question #4.
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Touch phase enum (matches the upstream IPC contract).
///   0 = touch down  (NSEventTypeLeftMouseDown)
///   1 = touch move  (NSEventTypeLeftMouseDragged)
///   2 = touch up    (NSEventTypeLeftMouseUp)
///   3 = touch cancel (mapped to NSEventTypeLeftMouseUp)
typedef NS_ENUM(uint8_t, DSTouchPhase) {
    DSTouchPhaseDown = 0,
    DSTouchPhaseMove = 1,
    DSTouchPhaseUp = 2,
    DSTouchPhaseCancel = 3,
};

/// Injects a single HID touch event.  Returns 0 on success.
///
/// Pipeline (kittyfarm DisplayBridge.m:884-988):
///   1. Look up current HID client (DSCurrentHIDClient).  -1 if not attached.
///   2. Read current display size (DSDisplayPixelSize).  -2 if no frames yet.
///   3. Build an NSEvent at (x*width, y*height) for diagnostic / fallback;
///      pass the ratio CGPoint directly into IndigoHIDMessageForMouseNSEvent.
///   4. Wrap the returned malloc'd bytes in a DSIndigoMessage (lifecycle).
///   5. Dispatch -sendWithMessage:freeWhenDone:completionQueue:completion:
///      with a dispatch_semaphore-blocked completion.
///   6. Return 0 / -3 (message create failed) / -4 (send timeout) /
///      -5 (completion error).
///
/// Negative return codes:
///   -1: not attached (no HID client)
///   -2: display size unknown (no frame callback fired yet)
///   -3: IndigoHIDMessageForMouseNSEvent returned NULL/empty
///   -4: send timed out (2s default)
///   -5: send completion reported NSError
int bridge_send_touch(double x_ratio,
                      double y_ratio,
                      uint8_t phase,
                      double pressure,
                      uint32_t touchId);

#ifdef SIM_PRIVATE_TESTING
/// Test-only synthetic Indigo payload — emitted by `bridge_send_touch`
/// when `IndigoHIDMessageForMouseNSEvent` is unavailable (unit-test
/// runner doesn't reliably load CoreSimulator).  The struct layout
/// here mirrors the file-internal `DSSyntheticIndigoPayload` so tests
/// can assert that x_ratio/y_ratio are passed through verbatim (Open
/// Question #4 — no pre-multiplication).  Production builds do NOT
/// define this struct.
#define DS_SYNTHETIC_INDIGO_MAGIC 0x44534948u  // 'DSIH'
typedef struct {
    uint32_t magic;
    double xRatio;
    double yRatio;
    uint8_t phase;
    uint8_t reserved[3];
    uint32_t touchId;
    double pressure;
    double displayWidth;
    double displayHeight;
} DSTestSyntheticIndigoPayload;
#endif

NS_ASSUME_NONNULL_END
