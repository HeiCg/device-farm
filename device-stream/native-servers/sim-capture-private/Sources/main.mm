// main.mm — entry dispatcher.
//
// Modes:
//   --probe <udid>                  — Plan 32-01 symbol-resolution probe
//   --udid <UDID> --socket <path>   — Plan 32-03 daemon mode (T-32.4):
//     1. ignore SIGPIPE (Pitfall 8)
//     2. start DSIpcServer at the socket path (unlink stale, bind, listen, accept one client)
//     3. attach to SimulatorKit via DSAttachToSimulator
//     4. frame callback -> DSH264Encoder.encodePixelBuffer -> kind 0x01/0x02 frames over IPC
//     5. control reader -> 0xC1 touch -> bridge_send_touch / 0xC9 quit -> exit(0)
//     6. run loop
#import <Foundation/Foundation.h>
#import <signal.h>
#import <string.h>
#import <stdlib.h>
#import <stdio.h>

#import "Bridge.h"
#import "ScreenAttach.h"
#import "TouchInject.h"
#import "IpcServer.h"
#import "H264Encoder.h"

int main_probe(int argc, const char *argv[]);

#pragma mark - daemon globals

static DSIpcServer *g_ipc = nil;
static DSH264Encoder *g_encoder = nil;

#pragma mark - encoded-frame and frame callbacks

static void on_encoded(DSEncodedKind kind,
                       const uint8_t *bytes,
                       size_t len,
                       void *userData) {
    (void)userData;
    if (!g_ipc || !bytes || len == 0) return;
    NSData *payload = [NSData dataWithBytes:bytes length:len];
    [g_ipc writeFrameKind:(uint8_t)kind payload:payload];
}

static void on_frame(CVPixelBufferRef pb,
                     double widthPx,
                     double heightPx,
                     void *userData) {
    (void)userData;
    if (!pb || widthPx <= 0 || heightPx <= 0) return;
    if (!g_encoder) {
        g_encoder = [[DSH264Encoder alloc] initWithWidth:(int)widthPx
                                                  height:(int)heightPx
                                                     fps:30
                                                 bitrate:4000000
                                          outputCallback:on_encoded
                                                userData:NULL];
        if (!g_encoder) {
            fprintf(stderr, "DSH264Encoder init failed (w=%d h=%d)\n",
                    (int)widthPx, (int)heightPx);
            return;
        }
    }
    [g_encoder encodePixelBuffer:pb forceKeyframe:NO];
}

static void on_attach_error(const char *msg, void *userData) {
    (void)userData;
    if (!msg) return;
    fprintf(stderr, "attach error: %s\n", msg);
    if (g_ipc) {
        NSData *payload = [NSData dataWithBytes:msg length:strlen(msg)];
        [g_ipc writeFrameKind:0xFF payload:payload];
    }
}

#pragma mark - control handlers

static void on_touch(double x, double y, uint8_t phase, double pressure,
                     uint32_t touchId, void *userData) {
    (void)userData;
    int rc = bridge_send_touch(x, y, phase, pressure, touchId);
    if (rc != 0) {
        char buf[128];
        snprintf(buf, sizeof(buf), "touch rc=%d", rc);
        if (g_ipc) {
            NSData *p = [NSData dataWithBytes:buf length:strlen(buf)];
            [g_ipc writeFrameKind:0xFF payload:p];
        }
    }
}

static void on_quit(void *userData) {
    (void)userData;
    fprintf(stderr, "quit requested by peer\n");
    if (g_encoder) [g_encoder teardown];
    if (g_ipc) [g_ipc stop];
    bridge_detach();
    exit(0);
}

#pragma mark - entry

int main(int argc, const char *argv[]) {
    // Ignore SIGPIPE process-wide (Pitfall 8). The accepted client fd
    // also sets SO_NOSIGPIPE in DSIpcServer.
    signal(SIGPIPE, SIG_IGN);

    @autoreleasepool {
        if (argc >= 2 && strcmp(argv[1], "--probe") == 0) {
            return main_probe(argc, argv);
        }

        // Daemon mode: --udid <UDID> --socket <path>
        const char *udid = NULL;
        const char *sockPath = NULL;
        for (int i = 1; i + 1 < argc; i++) {
            if (strcmp(argv[i], "--udid") == 0) {
                udid = argv[++i];
            } else if (strcmp(argv[i], "--socket") == 0) {
                sockPath = argv[++i];
            }
        }
        if (!udid || !sockPath) {
            fprintf(stderr,
                    "sim-capture-private: usage:\n"
                    "  %s --probe <udid>\n"
                    "  %s --udid <UDID> --socket <path>\n",
                    argv[0], argv[0]);
            return 64;  // EX_USAGE
        }

        g_ipc = [[DSIpcServer alloc] initWithSocketPath:@(sockPath)];
        [g_ipc setTouchHandler:on_touch userData:NULL];
        [g_ipc setQuitHandler:on_quit userData:NULL];

        NSError *err = nil;
        fprintf(stderr, "ipc: listening at %s\n", sockPath);
        if (![g_ipc startAndAcceptOneClientOrFail:&err]) {
            fprintf(stderr, "ipc start failed: %s\n",
                    err ? [err.localizedDescription UTF8String] : "unknown");
            return 2;
        }
        fprintf(stderr, "ipc: client connected\n");
        [g_ipc startReaderLoop];

        int rc = bridge_attach(udid, on_frame, on_attach_error, NULL);
        if (rc != 0) {
            fprintf(stderr, "bridge_attach rc=%d\n", rc);
            [g_ipc stop];
            return 3;
        }
        fprintf(stderr, "bridge: attached udid=%s\n", udid);

        [[NSRunLoop currentRunLoop] run];
    }
    return 0;
}
