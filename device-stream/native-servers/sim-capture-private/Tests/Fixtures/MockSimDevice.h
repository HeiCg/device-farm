// MockSimDevice.h — Fake SimDevice + SimDeviceLegacyHIDClient for unit
// tests.  Wave 0 shipped interface-only; Plan 32-02 (T-32.3) fills in the
// MockHIDClient send-capture path so `bridge_send_touch` can be exercised
// without booting a real simulator.
//
// MockHIDClient implements the same selector signature
// `-sendWithMessage:freeWhenDone:completionQueue:completion:` that
// SimulatorKit.SimDeviceLegacyHIDClient exposes.  `bridge_send_touch`
// dispatches via `objc_msgSend` against that selector, so the mock is
// duck-typed — no `objc_allocateClassPair` needed.  The class name
// distinction is irrelevant to the call site.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MockSimDevice : NSObject

+ (instancetype)deviceWithUDID:(NSUUID *)udid;

@property (nonatomic, readonly) NSUUID *UDID;
@property (nonatomic, copy, nullable) void (^onHIDSend)(NSData *messageBytes);

@end

/// Fake SimDeviceLegacyHIDClient.  Captures the message bytes via the
/// `onSend` block, invokes the completion callback on the supplied
/// completion queue with `nil` error.
@interface MockHIDClient : NSObject

@property (nonatomic, copy, nullable) void (^onSend)(NSData *messageBytes);

- (void)sendWithMessage:(id)message
           freeWhenDone:(BOOL)freeWhenDone
        completionQueue:(dispatch_queue_t)completionQueue
             completion:(void (^)(NSError *_Nullable))completion;

@end

NS_ASSUME_NONNULL_END
