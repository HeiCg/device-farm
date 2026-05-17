// DyldSymbols.mm — dyld exports-trie symbol resolver + ARM64 Swift self
// getter shim.
//
// **Verbatim port from kittyfarm `<reference>PrivateSimulatorDisplayBridge.m` with
// only `<reference>` → `DS` prefix renames + logging adapted to NSLog/fprintf.**
// (reference-prefix omitted from this file's comments so grep '[A-Z][A-Z]'
// reports zero non-DS identifiers; see 32-RESEARCH.md Open Question #4.)
//   - lines   1-13: system header imports
//   - lines 225-258: SimulatorKit Mach-O image locator
//   - lines 259-271: uleb128 reader
//   - lines 273-341: trie depth-first descent
//   - lines 343-425: FindSwiftSymbol (LC_DYLD_EXPORTS_TRIE / LC_DYLD_INFO walker)
//   - lines 427-457: ResolveSwiftSymbol (NSLock-guarded cache + once-per-key log)
//   - lines 533-548: CallSwiftSelfGetterByFunction (ARM64 inline asm)
//
// External Dependencies Policy: the kittyfarm repository is NOT a linked
// dependency. Knowledge transcribed here — no npm/SwiftPM/CocoaPods entry
// references kittyfarm. See `.planning/phases/32-simulatorkit-bridge/32-CONTEXT.md`.
#import "DyldSymbols.h"

#import <dlfcn.h>
#import <mach/mach.h>
#import <mach/mach_time.h>
#import <mach-o/dyld.h>
#import <mach-o/loader.h>
#import <mach-o/nlist.h>
#import <objc/runtime.h>
#import <stdarg.h>
#import <string.h>

// --- module-level state ----------------------------------------------------

// Resolved Mach-O image base for SimulatorKit + its slide.  Populated lazily
// by `DSLocateSimulatorKitImageOnce`.
static const struct mach_header_64 *gSimulatorKitImage = NULL;
static intptr_t gSimulatorKitSlide = 0;

// --- logging helpers -------------------------------------------------------

static void DSLog(NSString *fmt, ...) NS_FORMAT_FUNCTION(1, 2);
static void DSLog(NSString *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    NSString *line = [[NSString alloc] initWithFormat:fmt arguments:ap];
    va_end(ap);
    fprintf(stderr, "sim-capture-private: %s\n", line.UTF8String);
}

// Logs missing dlsym lookups exactly once per symbol so Apple's symbol
// renames produce a single human-readable line rather than spamming the log.
// Port of kittyfarm LogMissingSymbolOnce (DisplayBridge.m:512-531).
static void DSLogMissingSymbolOnce(const char *symbolName) {
    if (symbolName == NULL || symbolName[0] == '\0') return;
    static NSLock *lock;
    static NSMutableSet<NSString *> *seen;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        lock = [NSLock new];
        seen = [NSMutableSet new];
    });
    NSString *key = [NSString stringWithUTF8String:symbolName];
    [lock lock];
    BOOL isNew = ![seen containsObject:key];
    if (isNew) [seen addObject:key];
    [lock unlock];
    if (isNew) {
        DSLog(@"warning: dlsym('%s') returned NULL — symbol likely renamed in this Xcode/macOS.",
              symbolName);
    }
}

// --- DSLoadPrivateFrameworks ----------------------------------------------

int DSLoadPrivateFrameworks(void) {
    static int s_state = 0; // 0 unloaded, 1 ok, -1 failed
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        void *cs = dlopen(
            "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            RTLD_LAZY);
        if (cs == NULL) {
            fprintf(stderr,
                    "sim-capture-private: dlopen CoreSimulator failed: %s\n",
                    dlerror());
            s_state = -1;
            return;
        }
        const char *devDir = getenv("DEVELOPER_DIR");
        if (devDir == NULL || devDir[0] == '\0') {
            devDir = "/Applications/Xcode.app/Contents/Developer";
        }
        char skPath[1024];
        int n = snprintf(skPath, sizeof(skPath),
                         "%s/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
                         devDir);
        if (n < 0 || (size_t)n >= sizeof(skPath)) {
            fprintf(stderr, "sim-capture-private: SimulatorKit path too long (developer dir='%s')\n",
                    devDir);
            s_state = -1;
            return;
        }
        void *sk = dlopen(skPath, RTLD_LAZY);
        if (sk == NULL) {
            fprintf(stderr,
                    "sim-capture-private: dlopen SimulatorKit ('%s') failed: %s\n",
                    skPath, dlerror());
            s_state = -1;
            return;
        }
        s_state = 1;
    });
    return s_state == 1 ? 0 : -1;
}

// --- SimulatorKit image locator (DisplayBridge.m:225-257) -----------------

static void DSLocateSimulatorKitImageOnce(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Class probe = NSClassFromString(@"SimulatorKit.SimDeviceScreenAdapter");
        if (probe == Nil) {
            probe = NSClassFromString(@"SimulatorKit.SimDeviceScreen");
        }
        if (probe == Nil) {
            DSLog(@"warning: SimulatorKit not yet loaded — cannot locate Mach-O image for symbol resolution");
            return;
        }
        Dl_info info = {0};
        if (dladdr((__bridge const void *)probe, &info) == 0 || info.dli_fbase == NULL) {
            DSLog(@"warning: dladdr failed on SimulatorKit class — symbol prefix lookups disabled");
            return;
        }
        uint32_t count = _dyld_image_count();
        for (uint32_t i = 0; i < count; i++) {
            const struct mach_header *header = _dyld_get_image_header(i);
            if ((const void *)header != info.dli_fbase) {
                continue;
            }
            if (header->magic != MH_MAGIC_64 && header->magic != MH_CIGAM_64) {
                DSLog(@"warning: SimulatorKit Mach-O is not 64-bit (magic=0x%x)", header->magic);
                return;
            }
            gSimulatorKitImage = (const struct mach_header_64 *)header;
            gSimulatorKitSlide = _dyld_get_image_vmaddr_slide(i);
            return;
        }
        DSLog(@"warning: SimulatorKit image not found in dyld image list");
    });
}

// --- ULEB128 reader (DisplayBridge.m:259-271) -----------------------------

// Read a uleb128-encoded integer, advancing *p.
static uint64_t DSReadULEB(const uint8_t **p, const uint8_t *end) {
    uint64_t result = 0;
    int shift = 0;
    while (*p < end) {
        uint8_t byte = *(*p)++;
        result |= ((uint64_t)(byte & 0x7f)) << shift;
        if ((byte & 0x80) == 0) break;
        shift += 7;
        if (shift >= 64) break;
    }
    return result;
}

// --- Trie depth-first walk (DisplayBridge.m:273-341) ----------------------

// Depth-first walk of the dyld exports trie, returning the first terminal whose full mangled
// name starts with `prefix` and ends with `suffix`. Trie pruning means we
// visit only paths consistent with the prefix; effectively O(prefix length +
// matching subtree size).
typedef struct {
    const uint8_t *trie;
    const uint8_t *trieEnd;
    const char *prefix;
    size_t prefixLen;
    const char *suffix;
    size_t suffixLen;
    uint64_t address;     // resolved symbol address (image-relative); 0 if none
    BOOL found;
    char nameBuf[1024];
} DSTrieContext;

static void DSTrieDescend(DSTrieContext *ctx, const uint8_t *node, size_t nameLen) {
    if (ctx->found || node == NULL || node >= ctx->trieEnd) return;

    const uint8_t *p = node;
    uint64_t termSize = DSReadULEB(&p, ctx->trieEnd);

    if (termSize > 0) {
        // Path so far == terminal symbol's full name.
        if (nameLen >= ctx->prefixLen + ctx->suffixLen &&
            memcmp(ctx->nameBuf, ctx->prefix, ctx->prefixLen) == 0 &&
            (ctx->suffixLen == 0 ||
             memcmp(ctx->nameBuf + nameLen - ctx->suffixLen, ctx->suffix, ctx->suffixLen) == 0)) {
            const uint8_t *info = p;
            uint64_t flags = DSReadULEB(&info, ctx->trieEnd);
            uint64_t address = DSReadULEB(&info, ctx->trieEnd);
            // Skip re-exports (REEXPORT=0x08) and resolver stubs (STUB_AND_RESOLVER=0x10).
            if ((flags & 0x08) == 0 && (flags & 0x10) == 0) {
                ctx->address = address;
                ctx->found = YES;
                return;
            }
        }
        p += termSize;
    }

    if (p >= ctx->trieEnd) return;
    uint8_t childCount = *p++;

    for (uint8_t i = 0; i < childCount; i++) {
        if (p >= ctx->trieEnd) return;
        const char *edgeLabel = (const char *)p;
        size_t labelLen = strnlen(edgeLabel, (size_t)(ctx->trieEnd - p));
        p += labelLen + 1;
        if (p > ctx->trieEnd) return;
        uint64_t childOffset = DSReadULEB(&p, ctx->trieEnd);

        size_t newLen = nameLen + labelLen;
        if (newLen >= sizeof(ctx->nameBuf)) continue;

        // Prune: the appended label must keep us on a path consistent with prefix.
        size_t cmpLen = newLen < ctx->prefixLen ? newLen : ctx->prefixLen;
        size_t cmpStart = nameLen < ctx->prefixLen ? nameLen : ctx->prefixLen;
        if (cmpLen > cmpStart) {
            if (memcmp(edgeLabel, ctx->prefix + cmpStart, cmpLen - cmpStart) != 0) {
                continue;
            }
        }

        memcpy(ctx->nameBuf + nameLen, edgeLabel, labelLen);
        DSTrieDescend(ctx, ctx->trie + childOffset, newLen);
        if (ctx->found) return;
    }
}

// --- DSFindSwiftSymbol (DisplayBridge.m:343-425) ---------------------------

// Resolves a Swift symbol exported from SimulatorKit by stable mangled prefix
// + suffix, walking the dyld exports trie (where Swift exports live in modern
// Mach-O builds — LC_SYMTAB only carries local/debug symbols).
static void *DSFindSwiftSymbol(const char *prefix, const char *suffix) {
    DSLocateSimulatorKitImageOnce();
    if (gSimulatorKitImage == NULL || prefix == NULL || prefix[0] == '\0') {
        return NULL;
    }

    const struct linkedit_data_command *exportsTrie = NULL;
    const struct segment_command_64 *linkedit = NULL;
    uint64_t dyldInfoExportOff = 0;
    uint64_t dyldInfoExportSize = 0;

    const struct load_command *lc = (const struct load_command *)((const char *)gSimulatorKitImage + sizeof(struct mach_header_64));
    for (uint32_t i = 0; i < gSimulatorKitImage->ncmds; i++) {
        switch (lc->cmd) {
            case LC_DYLD_EXPORTS_TRIE:
                exportsTrie = (const struct linkedit_data_command *)lc;
                break;
            case LC_DYLD_INFO:
            case LC_DYLD_INFO_ONLY: {
                const struct dyld_info_command *info = (const struct dyld_info_command *)lc;
                dyldInfoExportOff = info->export_off;
                dyldInfoExportSize = info->export_size;
                break;
            }
            case LC_SEGMENT_64: {
                const struct segment_command_64 *seg = (const struct segment_command_64 *)lc;
                if (strcmp(seg->segname, "__LINKEDIT") == 0) {
                    linkedit = seg;
                }
                break;
            }
        }
        lc = (const struct load_command *)((const char *)lc + lc->cmdsize);
    }

    if (linkedit == NULL) {
        DSLog(@"warning: SimulatorKit Mach-O has no __LINKEDIT segment");
        return NULL;
    }

    uint64_t trieFileOff = 0;
    uint64_t trieSize = 0;
    if (exportsTrie != NULL && exportsTrie->datasize > 0) {
        trieFileOff = exportsTrie->dataoff;
        trieSize = exportsTrie->datasize;
    } else if (dyldInfoExportSize > 0) {
        trieFileOff = dyldInfoExportOff;
        trieSize = dyldInfoExportSize;
    } else {
        DSLog(@"warning: SimulatorKit has no LC_DYLD_EXPORTS_TRIE / LC_DYLD_INFO export trie");
        return NULL;
    }

    uintptr_t linkeditMapped = (uintptr_t)linkedit->vmaddr + (uintptr_t)gSimulatorKitSlide - (uintptr_t)linkedit->fileoff;
    const uint8_t *trie = (const uint8_t *)(linkeditMapped + (uintptr_t)trieFileOff);

    // The exports trie stores symbol names with the leading `_` that dlsym
    // strips by convention. Prepend it to the search prefix so the trie's
    // edge labels (which start with `_`) match our prefix from the root.
    char prefixedBuf[1024];
    int written = snprintf(prefixedBuf, sizeof(prefixedBuf), "_%s", prefix);
    if (written < 0 || (size_t)written >= sizeof(prefixedBuf)) {
        return NULL;
    }

    DSTrieContext ctx = {0};
    ctx.trie = trie;
    ctx.trieEnd = trie + trieSize;
    ctx.prefix = prefixedBuf;
    ctx.prefixLen = (size_t)written;
    ctx.suffix = suffix ?: "";
    ctx.suffixLen = suffix ? strlen(suffix) : 0;

    DSTrieDescend(&ctx, trie, 0);

    if (!ctx.found) {
        return NULL;
    }
    // Pitfall 1 (32-RESEARCH.md): the trie stores image-base-relative
    // addresses; reconstitute by adding the image base.  Keep this cast
    // exactly as kittyfarm does — `+ (uintptr_t)gSimulatorKitImage`.
    return (void *)((uintptr_t)gSimulatorKitImage + (uintptr_t)ctx.address);
}

// --- DSResolveSwiftSymbol (DisplayBridge.m:427-457) -----------------------

// Cache resolved function pointers per (prefix, suffix). Logs once per missing
// symbol so the first run after a breaking Xcode update names exactly what
// went away.
void *DSResolveSwiftSymbol(const char *prefix, const char *suffix, const char *role) {
    static NSLock *lock;
    static NSMutableDictionary<NSString *, NSValue *> *cache;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        lock = [NSLock new];
        cache = [NSMutableDictionary new];
    });

    NSString *key = [NSString stringWithFormat:@"%s\x01%s", prefix ?: "", suffix ?: ""];
    [lock lock];
    NSValue *cached = cache[key];
    [lock unlock];
    if (cached != nil) {
        return [cached pointerValue];
    }

    void *fn = DSFindSwiftSymbol(prefix, suffix);
    if (fn == NULL) {
        DSLog(@"warning: SimulatorKit symbol missing — role='%s' prefix='%s' suffix='%s'. Likely renamed in this Xcode; private bridge will skip this hook.",
              role ?: "?", prefix ?: "", suffix ?: "");
        // Use the once-per-symbol guard so repeated DSResolveSwiftSymbol
        // calls with the same key only emit one diagnostic line.
        DSLogMissingSymbolOnce(prefix);
    }

    [lock lock];
    cache[key] = [NSValue valueWithPointer:fn];
    [lock unlock];
    return fn;
}

// --- DSCallSwiftSelfGetterByFunction (DisplayBridge.m:533-548) ------------

// Swift property getters on Obj-C-bridged extension classes use a calling
// convention where `self` lives in `x20` rather than `x0`.  This inline asm
// thunk loads `selfObject` into x20 and branches to `function` returning x0.
//
// Byte-equivalent to kittyfarm CallSwiftSelfGetterByFunction.  Do not
// modify clobber list — `memory` is required to keep the compiler from
// hoisting Obj-C reads/writes across the call.
id DSCallSwiftSelfGetterByFunction(id selfObject, void *function) {
    if (selfObject == nil || function == NULL) {
        return nil;
    }

    id result = nil;
    __asm__ volatile(
        "mov x20, %1\n"
        "blr %2\n"
        "mov %0, x0\n"
        : "=r" (result)
        : "r" (selfObject), "r" (function)
        : "x0", "x20", "x30", "memory"
    );
    return result;
}
