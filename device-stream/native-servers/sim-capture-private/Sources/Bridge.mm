// Bridge.mm — locked critical-symbol table + probe driver + bridge_attach stub.
//
// Plan 32-01 (T-32.1).  Critical-symbol set is hard-coded per
// 32-RESEARCH.md Open Question #2.  Downstream plans MUST NOT silently
// extend this array — `kDSCriticalSymbolCount` is asserted in the XCTest
// suite.
#import "Bridge.h"
#import "DyldSymbols.h"

#import <Foundation/Foundation.h>
#import <objc/runtime.h>

// Note (deviation from 32-RESEARCH.md Open Question #2):
//   The interfaces literal in 32-01-PLAN.md listed bare Obj-C class names
//   (`SimDeviceScreen`, `SimDeviceLegacyHIDClient`) and one wrong selector
//   (`contextForDeveloperDir:`).  On the local Xcode 26.4 install these
//   classes are actually registered under their full Swift names
//   (`SimulatorKit.SimDeviceScreen`, `SimulatorKit.SimDeviceLegacyHIDClient`)
//   and the SimServiceContext class method is `serviceContextForDeveloperDir:
//   connectionType:error:`.  Probe #7 was originally
//   `SimDeviceScreen -registerScreenCallbacksWithUUID:...` but that selector
//   lives on an internal CoreSimulator class that loads lazily — there is no
//   safe way to probe it statically without booting a real simulator.
//   Replaced with `SimulatorKit.SimDeviceScreen -screen` (the property that
//   yields the `rawScreen` instance kittyfarm subsequently calls
//   `registerScreenCallbacksWithUUID:` on at runtime).
//   See `32-01-SUMMARY.md` "Deviations" for full rationale.
const DSSymbolSpec kDSCriticalSymbols[] = {
    // Swift mangled symbols (trie-resolved via DSResolveSwiftSymbol).
    {.prefix = "$sSo9SimDeviceC12SimulatorKitE13screenAdapter",
     .suffix = "vg",
     .classOrSelector = NULL,
     .selectorIfClass = NULL,
     .role = "SimDevice.screenAdapter.getter"},
    {.prefix = "$s12SimulatorKit22SimDeviceScreenAdapterC7screens",
     .suffix = "vg",
     .classOrSelector = NULL,
     .selectorIfClass = NULL,
     .role = "SimDeviceScreenAdapter.screens.getter"},
    {.prefix = "$s12SimulatorKit24SimDisplayRenderableViewC7connect",
     .suffix = "FTj",
     .classOrSelector = NULL,
     .selectorIfClass = NULL,
     .role = "SimDisplayRenderableView.connect(screen:)"},

    // Obj-C selector existence probes (NSClassFromString +
    // respondsToSelector / instancesRespondToSelector).
    {.prefix = NULL, .suffix = NULL,
     .classOrSelector = "SimServiceContext",
     .selectorIfClass = "serviceContextForDeveloperDir:connectionType:error:",
     .role = "SimServiceContext +serviceContextForDeveloperDir:"},
    {.prefix = NULL, .suffix = NULL,
     .classOrSelector = "SimulatorKit.SimDeviceLegacyHIDClient",
     .selectorIfClass = "initWithDevice:error:",
     .role = "SimDeviceLegacyHIDClient -initWithDevice:"},
    {.prefix = NULL, .suffix = NULL,
     .classOrSelector = "SimulatorKit.SimDeviceScreen",
     .selectorIfClass = "initWithDevice:screenID:",
     .role = "SimDeviceScreen -initWithDevice:screenID:"},
    // Probe #7: kittyfarm-style usage calls registerScreenCallbacksWith... on
    // the rawScreen instance returned by SimDeviceScreen.screen.  Since the
    // owning class loads lazily (cannot be probed statically), check the
    // SimDeviceScreen.screen property getter — the symbol that yields that
    // rawScreen instance.  Plan 32-02 will runtime-probe the inner selector
    // before invoking it.
    {.prefix = NULL, .suffix = NULL,
     .classOrSelector = "SimulatorKit.SimDeviceScreen",
     .selectorIfClass = "screen",
     .role = "SimDeviceScreen -screen (rawScreen accessor; gates registerScreenCallbacksWithUUID:)"},
    {.prefix = NULL, .suffix = NULL,
     .classOrSelector = "SimulatorKit.SimDeviceLegacyHIDClient",
     .selectorIfClass = "sendWithMessage:freeWhenDone:completionQueue:completion:",
     .role = "SimDeviceLegacyHIDClient -sendWithMessage:"},
};
const int kDSCriticalSymbolCount =
    (int)(sizeof(kDSCriticalSymbols) / sizeof(kDSCriticalSymbols[0]));

int DSProbeCriticalSymbols(void) {
    if (DSLoadPrivateFrameworks() != 0) {
        return 0;
    }

    int resolved = 0;
    for (int i = 0; i < kDSCriticalSymbolCount; i++) {
        const DSSymbolSpec *s = &kDSCriticalSymbols[i];
        BOOL ok = NO;

        if (s->prefix != NULL && s->suffix != NULL) {
            // Swift trie probe.
            ok = DSResolveSwiftSymbol(s->prefix, s->suffix, s->role) != NULL;
        } else if (s->classOrSelector != NULL) {
            Class c = NSClassFromString(@(s->classOrSelector));
            if (c == Nil) {
                ok = NO;
            } else if (s->selectorIfClass != NULL) {
                SEL sel = NSSelectorFromString(@(s->selectorIfClass));
                ok = [c respondsToSelector:sel] || [c instancesRespondToSelector:sel];
            } else {
                ok = YES; // class-existence-only probe (none used today)
            }
        }

        if (ok) {
            resolved++;
        } else {
            fprintf(stderr, "MISSING: %s\n", s->role);
        }
    }
    return resolved;
}

// Plan 32-02 (T-32.2) — bridge_attach delegates to ScreenAttach.
int bridge_attach(const char *udid,
                  DSFrameCallback frame_cb,
                  DSErrorCallback error_cb,
                  void *userData) {
    return DSAttachToSimulator(udid, frame_cb, error_cb, userData);
}

void bridge_detach(void) {
    DSDetach();
}
