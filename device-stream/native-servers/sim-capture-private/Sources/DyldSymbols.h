// DyldSymbols.h — dyld exports-trie symbol resolver for SimulatorKit private
// API surface.
//
// Implemented in Plan 32-01 (T-32.1). Verbatim port of the symbol-resolution
// machinery from kittyfarm `DFPrivateSimulatorDisplayBridge.m` lines 225-548
// with `DF` → `DS` prefix renames only.
//
// External Dependencies Policy: this file embeds knowledge transcribed from
// the kittyfarm reference repo — kittyfarm itself is NOT a linked dependency
// of device-farm. See `.planning/phases/32-simulatorkit-bridge/32-CONTEXT.md`.
#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// dlopen-loads CoreSimulator (/Library/Developer/PrivateFrameworks/...) and
/// SimulatorKit ($(DEVELOPER_DIR)/Library/PrivateFrameworks/...).  Idempotent
/// via dispatch_once.  MUST be called before any `DSResolveSwiftSymbol`
/// invocation (Pitfall 2 from 32-RESEARCH.md — without dlopen the trie walker
/// finds the image but the Obj-C runtime hasn't registered the classes).
///
/// Returns 0 on success, -1 if either dlopen fails (diagnostic printed to
/// stderr with the dlerror() string).  The status is sticky after the first
/// call — subsequent invocations replay the cached result.
int DSLoadPrivateFrameworks(void);

/// Resolves a mangled Swift symbol exported from `SimulatorKit` by walking
/// the LC_DYLD_EXPORTS_TRIE (or legacy LC_DYLD_INFO_ONLY export section) of
/// the in-memory Mach-O image and matching on (prefix, suffix).  Results are
/// cached per-key; missing symbols are logged exactly once with the supplied
/// `role` (so Apple symbol renames between Xcode releases produce a single
/// human-readable line rather than spamming the log).
///
/// Returns NULL if the symbol cannot be resolved.
void * _Nullable DSResolveSwiftSymbol(const char *prefix,
                                      const char *suffix,
                                      const char *role);

/// Invokes a Swift property getter through the ARM64 calling convention used
/// by Swift extensions on Obj-C classes — `self` lives in `x20` rather than
/// the standard Obj-C `x0`.  Byte-equivalent to kittyfarm
/// DFPrivateSimulatorDisplayBridge.m:533-548.  Returns nil if either arg is
/// nil or the function pointer cannot be safely invoked.
id _Nullable DSCallSwiftSelfGetterByFunction(id selfObject, void *function);

NS_ASSUME_NONNULL_END
