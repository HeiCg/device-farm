// MockSimDevice.mm — Plan 32-02 (T-32.3) implementation.
//
// MockHIDClient captures the DSIndigoMessage bytes via -bytes / -length
// selectors (the same accessors SimDeviceLegacyHIDClient reads in
// production), wraps them in NSData, and invokes `onSend` on the calling
// thread.  The completion callback fires on `completionQueue` with `nil`
// error so `dispatch_semaphore_wait` in `bridge_send_touch` unblocks
// cleanly.
#import "MockSimDevice.h"

#import <objc/message.h>

#pragma mark - MockSimDevice

@implementation MockSimDevice

+ (instancetype)deviceWithUDID:(NSUUID *)udid {
    MockSimDevice *m = [MockSimDevice new];
    m->_UDID = udid;
    return m;
}

@end

#pragma mark - MockHIDClient

@implementation MockHIDClient

- (void)sendWithMessage:(id)message
           freeWhenDone:(BOOL)freeWhenDone
        completionQueue:(dispatch_queue_t)completionQueue
             completion:(void (^)(NSError *_Nullable))completion {
    (void)freeWhenDone;

    NSData *captured = nil;
    if (message != nil) {
        SEL bytesSel = sel_registerName("bytes");
        SEL lengthSel = sel_registerName("length");
        if ([message respondsToSelector:bytesSel] &&
            [message respondsToSelector:lengthSel]) {
            const void *bytes = ((const void *(*)(id, SEL))objc_msgSend)(
                message, bytesSel);
            NSUInteger length = ((NSUInteger(*)(id, SEL))objc_msgSend)(
                message, lengthSel);
            if (bytes != NULL && length > 0) {
                captured = [NSData dataWithBytes:bytes length:length];
            } else if (bytes != NULL) {
                // length == 0 — the production path encodes length inside
                // the buffer; we can't safely measure it from the outside,
                // so synthesize a small placeholder so onSend always gets
                // non-empty data.
                captured = [NSData data];
            }
        }
    }

    if (self.onSend != nil) {
        self.onSend(captured ?: [NSData data]);
    }

    if (completion != nil) {
        dispatch_async(completionQueue ?: dispatch_get_main_queue(), ^{
            completion(nil);
        });
    }
}

@end
