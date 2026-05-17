// Phase 37 Plan 37-01 — macho parser tests.
//
// Fixture strategy: rather than committing a binary .ipa (would exceed
// reasonable repo size — minimal iOS app is ≥ 2 MB Mach-O), tests feed
// pre-captured `otool -ov` / `otool -l` text output to the pure-function
// parser cores. The full ParseObjCClasslist / ParseSwift5Types wrappers
// (which shell to otool) are exercised in TestParseObjCClasslistOnRealBinary
// — t.Skip when otool is unavailable.
//
// Test fixtures under __tests__/fixtures/:
//   - xctrunner-objc-classlist.txt — real `otool -ov` output from
//     /Applications/Xcode.app/.../XCTRunner.app/XCTRunner trimmed to the
//     first __objc_classlist section (~1100 lines, ~67 KB).
//   - swift5-loadcmds.txt — synthetic `otool -l` output containing a
//     __swift5_types section header for offset/size parsing.

package macho

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("__tests__", "fixtures", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	return data
}

func TestParseObjCClasslistFromFixture(t *testing.T) {
	data := loadFixture(t, "xctrunner-objc-classlist.txt")
	classes := parseObjCClasslistOutput(data)
	if len(classes) < 1 {
		t.Fatalf("expected at least 1 ObjCClass, got %d", len(classes))
	}
	// XCTRunner ships with _XCTRunnerAppDelegate — assert it's present.
	found := false
	for _, c := range classes {
		if c.MangledName == "" {
			t.Errorf("class has empty MangledName: %+v", c)
		}
		if c.MangledName == "_XCTRunnerAppDelegate" || c.MangledName == "_XCTRunnerWindowScene" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected to find _XCTRunnerAppDelegate or _XCTRunnerWindowScene; got: %+v", classes)
	}
}

func TestParseObjCClasslistSkipsMetaClass(t *testing.T) {
	// Synthetic mini-fixture exercising the Meta Class skip behaviour.
	sample := []byte(`Contents of (__DATA_CONST,__objc_classlist) section
0000000100005130 0x100007268 _OBJC_CLASS_$_HomeViewController
    isa        0x100007240 _OBJC_METACLASS_$_HomeViewController
    superclass 0x0 _OBJC_CLASS_$_UIViewController
    cache      0x0 __objc_empty_cache
    data       0x1000070a8 __OBJC_CLASS_RO_$_HomeViewController
        name           0x1000039c1 HomeViewController
Meta Class
    isa        0x0 _OBJC_METACLASS_$_NSObject
    superclass 0x0 _OBJC_METACLASS_$_NSObject
    data       0x100006ea0 __OBJC_METACLASS_RO_$_HomeViewController
        name           0x1000033bb MetaShouldBeIgnored
0000000100005140 0x100007270 _OBJC_CLASS_$_LoginViewController
    isa        0x100007248 _OBJC_METACLASS_$_LoginViewController
    superclass 0x0 _OBJC_CLASS_$_UIViewController
    data       0x1000070b0 __OBJC_CLASS_RO_$_LoginViewController
        name           0x1000039d0 LoginViewController
`)
	classes := parseObjCClasslistOutput(sample)
	if len(classes) != 2 {
		t.Fatalf("expected exactly 2 ObjCClasses (Meta Class skipped), got %d: %+v", len(classes), classes)
	}
	if classes[0].MangledName != "HomeViewController" {
		t.Errorf("expected first class HomeViewController, got %q", classes[0].MangledName)
	}
	if classes[0].SuperclassExternal != "UIViewController" {
		t.Errorf("expected superclass UIViewController, got %q", classes[0].SuperclassExternal)
	}
	if classes[1].MangledName != "LoginViewController" {
		t.Errorf("expected second class LoginViewController, got %q", classes[1].MangledName)
	}
}

func TestParseObjCClasslistOnRealBinary(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("otool only available on macOS")
	}
	if _, err := exec.LookPath("otool"); err != nil {
		t.Skip("otool not in PATH")
	}
	// XCTRunner is part of Xcode's iPhoneSimulator platform; skip when absent.
	const xctRunner = "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/XCTRunner.app/XCTRunner"
	if _, err := os.Stat(xctRunner); err != nil {
		t.Skipf("XCTRunner not present (%v)", err)
	}
	classes, err := ParseObjCClasslist(xctRunner)
	if err != nil {
		t.Fatalf("ParseObjCClasslist: %v", err)
	}
	if len(classes) < 1 {
		t.Fatalf("expected at least 1 class from real XCTRunner binary, got %d", len(classes))
	}
}

func TestParseSwift5TypesFromFixture(t *testing.T) {
	data := loadFixture(t, "swift5-loadcmds.txt")
	offset, size := ParseSwift5TypesPair(data)
	if offset != 36448 {
		t.Errorf("expected __swift5_types offset 36448, got %d", offset)
	}
	if size != 0x150 {
		t.Errorf("expected __swift5_types size 0x150, got 0x%x", size)
	}
}

func TestParseSwift5TypesAbsentSection(t *testing.T) {
	// Empty load-cmds output → section absent → returns (0, 0).
	offset, size := ParseSwift5TypesPair([]byte("Mach header\n  magic 0xfeedfacf\n"))
	if offset != 0 || size != 0 {
		t.Errorf("expected (0,0) for absent section, got (%d, %d)", offset, size)
	}
}

func TestParseSwift5TypesOnRealBinary(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("otool only available on macOS")
	}
	if _, err := exec.LookPath("otool"); err != nil {
		t.Skip("otool not in PATH")
	}
	const xctRunner = "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/XCTRunner.app/XCTRunner"
	if _, err := os.Stat(xctRunner); err != nil {
		t.Skipf("XCTRunner not present (%v)", err)
	}
	// XCTRunner has no __swift5_types section → expect empty slice, nil error.
	types, err := ParseSwift5Types(xctRunner)
	if err != nil {
		t.Fatalf("ParseSwift5Types: %v", err)
	}
	// Allow either empty (Obj-C-only binary) or populated (some Xcode versions
	// link Swift runtime which adds metadata). Both are valid outcomes.
	t.Logf("ParseSwift5Types on XCTRunner returned %d types", len(types))
}

func TestDemangleBatchChunksAt2000(t *testing.T) {
	// Ensure SwiftDemangleBatchSize invariant is preserved.
	if SwiftDemangleBatchSize != 2000 {
		t.Fatalf("SwiftDemangleBatchSize must be 2000 per Pitfall 2 (got %d)", SwiftDemangleBatchSize)
	}
	if runtime.GOOS != "darwin" {
		t.Skip("xcrun only available on macOS")
	}
	if _, err := exec.LookPath("xcrun"); err != nil {
		t.Skip("xcrun not in PATH")
	}
	// 5000 inputs → expect 3 invocations (2000+2000+1000) implicit via length match.
	inputs := make([]string, 5000)
	for i := range inputs {
		inputs[i] = "raw_symbol_not_actually_swift_" // not a real mangling — demangle returns it unchanged
	}
	out, err := DemangleBatch(inputs)
	if err != nil {
		t.Fatalf("DemangleBatch: %v", err)
	}
	if len(out) != len(inputs) {
		t.Fatalf("expected output length %d, got %d", len(inputs), len(out))
	}
}

func TestDemangleBatchEmpty(t *testing.T) {
	out, err := DemangleBatch([]string{})
	if err != nil {
		t.Fatalf("expected nil error on empty input, got %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected empty output, got %v", out)
	}
}

func TestClassifyName(t *testing.T) {
	cases := []struct {
		name       string
		wantConf   Confidence
		wantKind   Kind
		wantInc    bool
	}{
		{"FooViewController", ConfidenceHigh, KindViewController, true},
		{"FooScreen", ConfidenceHigh, KindScreen, true},
		{"FooPage", ConfidenceMedium, KindScreen, true},
		{"FooSheet", ConfidenceMedium, KindScreen, true},
		{"FooModal", ConfidenceMedium, KindScreen, true},
		{"BadgeView", ConfidenceLow, KindUnknown, false},
		{"IconView", ConfidenceLow, KindUnknown, false},
		{"CustomDataView", ConfidenceLow, KindView, true},
		{"MyApp.HomeViewController", ConfidenceHigh, KindViewController, true},
		{"NSObject", ConfidenceLow, KindUnknown, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			conf, kind, inc := ClassifyName(tc.name)
			if conf != tc.wantConf {
				t.Errorf("conf: got %s, want %s", conf, tc.wantConf)
			}
			if kind != tc.wantKind {
				t.Errorf("kind: got %s, want %s", kind, tc.wantKind)
			}
			if inc != tc.wantInc {
				t.Errorf("inc: got %v, want %v", inc, tc.wantInc)
			}
		})
	}
}

func TestRegexAnchorsCompile(t *testing.T) {
	if ClassHeaderRe == nil || NameLineRe == nil || SuperLineRe == nil {
		t.Fatal("regex anchors must be non-nil")
	}
}
