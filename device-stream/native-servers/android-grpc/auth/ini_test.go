// Cases mirror kittyfarm AndroidEmulatorAuth.swift:90-100 inline INI parser +
// 33-RESEARCH.md §Auth token discovery.
package auth

import "testing"

func TestParseSimpleIni_Trim(t *testing.T) {
	in := []byte("key = value\nkey2= value2\n   key3=value3   \n")
	got := parseSimpleIni(in)
	want := map[string]string{
		"key":  "value",
		"key2": "value2",
		"key3": "value3",
	}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: want=%d got=%d (%v)", len(want), len(got), got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("key %q: want=%q got=%q", k, v, got[k])
		}
	}
}

func TestParseSimpleIni_MultipleEquals(t *testing.T) {
	in := []byte("jwks.path=/foo=bar=baz\n")
	got := parseSimpleIni(in)
	if want := "/foo=bar=baz"; got["jwks.path"] != want {
		t.Fatalf("want=%q got=%q", want, got["jwks.path"])
	}
}

func TestParseSimpleIni_IgnoresEmptyAndCommentLines(t *testing.T) {
	in := []byte("\n\nnokey-here\nfoo=bar\n   \nbaz=qux\n")
	got := parseSimpleIni(in)
	if len(got) != 2 {
		t.Fatalf("want 2 entries got %d (%v)", len(got), got)
	}
	if got["foo"] != "bar" || got["baz"] != "qux" {
		t.Errorf("entries wrong: %v", got)
	}
}
