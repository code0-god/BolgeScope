# Build artifact report

Packaging run:

```text
release/0.1.0-20260927-202823
```

Classification: **local-development-preview** for macOS arm64.

## Artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `BolgeScope.app/Contents/MacOS/bolgescope-desktop` | 10,310,752 | `e5ce0d160017140a0f9f496ff174741731070fcce6e6a688685d582b9520764e` |
| `BolgeScope-0.1.0-arm64.zip` | 4,002,116 | `b9ccbf9abf34f8b266cefd732f840da254d73aeedcad5e183730a1aede7c488b` |
| `BolgeScope-0.1.0-arm64.dmg` | 4,395,315 | `4b1cb0270374ea4c940aeffd095ef046436095b736be03bbeef232d95471edb5` |

The `.app` bundle contains 10,315,806 bytes of regular files.
Source of record:
`release/0.1.0-20260927-202823/artifacts.json` and
`release/latest-build.json`.

## Integrity

| Check | Status |
| --- | --- |
| Tauri release build | PASS |
| App bundle creation | PASS |
| `codesign --verify --deep --strict` | PASS |
| ZIP `unzip -t` | PASS |
| DMG creation | PASS |
| DMG `hdiutil verify` | PASS |
| Release binary hash match | PASS |
| ZIP hash match | PASS |
| DMG hash match | PASS |
| WebDriver/test-feature marker scan | PASS — none found |

Signing is ad-hoc (`-`). `spctl --assess` rejected the bundle as expected for an
ad-hoc, unnotarized build. Developer ID signing, notarization, and public
Gatekeeper approval are **NOT_RUN**, not claimed as PASS.

## Uninstrumented smoke

The `.app` was launched directly from the isolated release directory, not
installed over any user application. A process appeared at the expected bundle
path, a real on-screen native window became available, and its complete initial
UI was captured at:

```text
evidence/review-fixes/20260927-1448-fce3990/logs/release-window.png
```

The smoke process was terminated after capture. No test HTTP listener or
WebDriver marker was present in the release executable.

## Remaining release limits

- Developer ID signing: **NOT_RUN**.
- Apple notarization: **NOT_RUN**.
- Installation and launch on another Mac: **NOT_RUN**.
- Full native picker/disk interaction: **BLOCKED** in the separate acceptance
  environment; see `native.md`.
