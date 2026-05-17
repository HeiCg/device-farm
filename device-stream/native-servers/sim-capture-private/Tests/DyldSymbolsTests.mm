// DyldSymbolsTests.mm — XCTest harness for the dyld exports-trie walker
// (Plan 32-01 / T-32.1).
//
// Implements SIM-PRIV-02 acceptance: 8/8 critical symbols resolve on
// Xcode 15.4+ (current local Xcode + the CI matrix versions).
#import <XCTest/XCTest.h>

#import "Bridge.h"
#import "DyldSymbols.h"

@interface DyldSymbolsTests : XCTestCase
@end

@implementation DyldSymbolsTests

// SIM-PRIV-02 — the trie walker must resolve the stable mangled prefix used by
// SimDevice.screenAdapter (Swift extension getter) on the developer's local
// Xcode install.
- (void)testResolveStableSymbol {
    XCTAssertEqual(DSLoadPrivateFrameworks(), 0,
                   @"dlopen CoreSimulator + SimulatorKit must succeed first (Pitfall 2)");
    void *p = DSResolveSwiftSymbol(
        "$sSo9SimDeviceC12SimulatorKitE13screenAdapter", "vg",
        "SimDevice.screenAdapter.getter");
    XCTAssertTrue(p != NULL,
                      @"screenAdapter getter must resolve on Xcode 15.4+ "
                      @"(if this fails, the symbol prefix likely renamed)");
}

// Missing symbol must return NULL without crashing.  Logs `missing role=...`
// exactly once (NSLock-guarded set in DSLogMissingSymbolOnce).
- (void)testResolveMissingSymbolReturnsNullWithoutCrash {
    XCTAssertEqual(DSLoadPrivateFrameworks(), 0);
    void *p = DSResolveSwiftSymbol(
        "$sFAKEFAKEFAKEDOESNOTEXIST_test_only", "vg", "test-missing");
    XCTAssertTrue(p == NULL, @"fake symbol must not resolve");
    // Calling twice with same key must still return NULL (and only log once,
    // but we can't directly assert the log content — at least assert no
    // crash + no false positive).
    void *p2 = DSResolveSwiftSymbol(
        "$sFAKEFAKEFAKEDOESNOTEXIST_test_only", "vg", "test-missing");
    XCTAssertTrue(p2 == NULL);
}

// 8-symbol critical set probe — drives SIM-PRIV-02 acceptance.  When this
// fails the probe binary will exit non-zero and the matrix CI catches the
// regression next nightly cron.
- (void)testProbeReturnsEight {
    int n = DSProbeCriticalSymbols();
    XCTAssertEqual(n, kDSCriticalSymbolCount,
                   @"8/8 critical symbols must resolve on Xcode 15.4+ "
                   @"(saw %d/%d). MISSING lines are written to stderr.",
                   n, kDSCriticalSymbolCount);
}

// Lock the critical-symbol table (per 32-RESEARCH.md Open Question #2 — once
// the set is locked, future plans must NOT silently extend it).
- (void)testCriticalSymbolCountIsExactlyEight {
    XCTAssertEqual(kDSCriticalSymbolCount, 8,
                   @"Plan 32-01 locks the critical-symbol set at 8; downstream "
                   @"plans should not extend this without bumping the contract.");
}

@end
