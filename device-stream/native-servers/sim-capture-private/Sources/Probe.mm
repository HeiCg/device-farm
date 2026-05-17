// Probe.mm — 8-symbol critical-set probe driver (SIM-PRIV-02 acceptance).
//
// Plan 32-01 (T-32.1).  Invoked when argv[1] == "--probe".  Prints
// `OK: 8/8 symbols resolved` on success or `FAIL: <n>/<total> symbols
// resolved` on failure (MISSING lines for each unresolved symbol have
// already been written to stderr by DSProbeCriticalSymbols).
#import "Bridge.h"
#import "DyldSymbols.h"

#import <Foundation/Foundation.h>

int main_probe(int argc, const char *argv[]) {
    (void)argc;
    (void)argv;
    int resolved = DSProbeCriticalSymbols();
    const int total = kDSCriticalSymbolCount;
    fprintf(stdout, "%s: %d/%d symbols resolved\n",
            resolved == total ? "OK" : "FAIL",
            resolved, total);
    fflush(stdout);
    return resolved == total ? 0 : 1;
}
