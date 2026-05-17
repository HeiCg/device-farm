# macho Test Fixtures

Phase 37 Plan 37-01 chose the **text-fixture fallback** strategy over committing
binary `.ipa` files:

- A minimal native iOS app produces a ≥ 2 MB Mach-O binary.
- A minimal RN-Hermes IPA is ≥ 5 MB.
- Combined > 10 MB hurts clone time without proportional test-coverage value.

Instead, tests feed pre-captured `otool` text output to the pure-function
parser cores (`parseObjCClasslistOutput`, `parseSwift5TypesSection`,
`extractScreensFromStrings`). The full pipeline wrappers (`ParseObjCClasslist`,
`ParseSwift5Types`, `ExtractHermesScreens`) are exercised against:

- **Real Apple-shipped binaries** when present (e.g. XCTRunner from Xcode) —
  tests `t.Skip` when the binary or `otool` is missing.
- **Synthetic Hermes bundle** built inline (`HermesMagic` + embedded JS
  strings) for the screen-extraction round-trip.

## Files

| Fixture | Source | Purpose |
| --- | --- | --- |
| `xctrunner-objc-classlist.txt` | `otool -arch arm64 -ov $XCODE/.../XCTRunner.app/XCTRunner`, trimmed to the first `__objc_classlist` section | TestParseObjCClasslistFromFixture |
| `swift5-loadcmds.txt` | Synthetic `otool -l` excerpt with a `__swift5_types` section header | TestParseSwift5TypesFromFixture / TestParseSwift5TypesAbsentSection |
| `xctrunner-arm64-loadcmds.txt` | Real `otool -arch arm64 -l XCTRunner` — reference for what real load-cmd output looks like | reserved for future regression tests |

## Regenerating

```bash
XCTRUNNER=/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Xcode/Agents/XCTRunner.app/XCTRunner
otool -arch arm64 -ov $XCTRUNNER | \
  awk '/^Contents of \(__DATA_CONST,__objc_classlist\) section/{flag=1; print; next} flag && /^Contents of/{flag=0} flag' \
  > xctrunner-objc-classlist.txt
```

If Xcode/XCTRunner changes shape and the fixture becomes stale, regenerate
with the command above. Test cases assert the presence of either
`_XCTRunnerAppDelegate` or `_XCTRunnerWindowScene` — both are stable
class names that have been present since at least Xcode 15.
