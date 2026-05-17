// Bridge.h — bridge surface for SimulatorKit private API access.
//
// Plan 32-01 (T-32.1) lands:
//   - kDSCriticalSymbols / kDSCriticalSymbolCount — locked 8-symbol set
//   - DSProbeCriticalSymbols() — probe driver invoked by `--probe`
//   - bridge_attach() — stub (real implementation: Plan 32-02 / T-32.2)
//
// Plan 32-02 (T-32.2) fills `bridge_attach` body + frame subscription.
// Plan 32-03 (T-32.4) wires IpcServer.
#pragma once

#import <Foundation/Foundation.h>

#import "ScreenAttach.h"

NS_ASSUME_NONNULL_BEGIN

/// A single entry in the locked critical-symbol set (Plan 32-01).  Either:
///   • Swift mangled trie symbol — `prefix` + `suffix` non-NULL, resolved via
///     `DSResolveSwiftSymbol`; OR
///   • Obj-C selector existence probe — `classOrSelector` (class name) +
///     `selectorIfClass` (instance/class selector name) non-NULL, resolved
///     via `NSClassFromString` + `respondsToSelector` /
///     `instancesRespondToSelector`.
///
/// `role` is a human-readable label written to stderr when the probe misses.
typedef struct DSSymbolSpec {
    const char *prefix;             // NULL if Obj-C probe
    const char *suffix;             // NULL if Obj-C probe
    const char *classOrSelector;    // NULL if Swift trie probe
    const char *selectorIfClass;    // NULL if class-existence-only probe
    const char *role;
} DSSymbolSpec;

/// Locked 8-symbol critical set (Plan 32-01; see 32-RESEARCH.md
/// Open Question #2 for the lock rationale).  Downstream plans MUST NOT
/// silently extend this array — the count is asserted in
/// `DyldSymbolsTests.testCriticalSymbolCountIsExactlyEight`.
extern const DSSymbolSpec kDSCriticalSymbols[];
extern const int kDSCriticalSymbolCount;

/// Runs the 8 critical-symbol probes (after `DSLoadPrivateFrameworks`).
/// Returns the number resolved (0..8).  Writes a `MISSING: <role>` line to
/// stderr for each failure so a regression on the CI matrix surfaces the
/// exact rename.
int DSProbeCriticalSymbols(void);

/// Attach a SimulatorKit bridge to the simulator with `udid`.  Delegates
/// to `DSAttachToSimulator` from `ScreenAttach.h` (Plan 32-02 / T-32.2).
/// Returns 0 on success; non-zero on failure with diagnostic emitted to
/// `error_cb` and stderr.
int bridge_attach(const char *udid,
                  DSFrameCallback frame_cb,
                  DSErrorCallback error_cb,
                  void *_Nullable userData);

/// Detach. Idempotent.
void bridge_detach(void);

NS_ASSUME_NONNULL_END
