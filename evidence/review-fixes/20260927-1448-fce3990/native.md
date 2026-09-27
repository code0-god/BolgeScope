# macOS native verification

## Instrumented acceptance application

Build:

```text
npm run tauri:build -w @bolgescope/desktop -- \
  --debug --bundles app --features e2e-webdriver \
  --config ../../tests/e2e/tauri.acceptance.conf.json
```

Artifact:

```text
apps/desktop/src-tauri/target/debug/bundle/macos/BolgeScope Acceptance.app
```

Executable SHA-256:

```text
768a3cca2ee551df5332a8ef9b0c0fec1832eaa726fc56077c8bd91d0d33e9ef
```

The optional driver is gated by the non-default Cargo feature at
`apps/desktop/src-tauri/Cargo.toml:13` and the conditional plugin registration
at `apps/desktop/src-tauri/src/lib.rs:369`.

## Acceptance result

Overall native-acceptance status: **BLOCKED**.

| Check | Status | Observation |
| --- | --- | --- |
| Actual macOS WKWebView | PASS | `tauri://localhost`, secure context |
| Offline bundled assets | PASS | UI loaded without a development server |
| Monaco editor | PASS | Real editor element initialized |
| Browser-engine identity | PASS | AppleWebKit user agent, no Chrome token |
| Native open-cancel | PASS | Real picker opened and cancel preserved the document |
| Remaining picker and disk flow | BLOCKED | Accessibility path entry could not be driven reliably |

Source of record: `native/results.json`.

No VM or native file-IPC mock was substituted. The acceptance driver verified
the exact running executable through its loaded image path before testing.

The blocker is specific: System Events could reach the visible native picker
and prove cancel behavior, but repeated bounded attempts could not reliably
enter and confirm a fixture path under the current input/accessibility state.
The final run therefore does not claim open/save/disk semantics as PASS.

## V1 diagnostics and dialog scheduling

`select_file` now:

1. validates a bounded request ID;
2. logs `dialog_requested`, `cancelled`, `selected`, and `granted` stages;
3. schedules the dialog callback on the main thread;
4. waits for the callback channel in `spawn_blocking`;
5. acquires the grant-table lock only after selection and file validation.

Equivalent main-thread callback/off-thread wait structure is used by project
selection and Save As. Relevant implementation:
`apps/desktop/src-tauri/src/lib.rs:75-121`,
`apps/desktop/src-tauri/src/lib.rs:124-157`, and
`apps/desktop/src-tauri/src/lib.rs:203-258`.

Rust verification:

- 13 unit tests PASS;
- fmt PASS;
- clippy with `-D warnings` PASS;
- opt-in `e2e-webdriver` feature compile PASS.

## Separation from release smoke

The uninstrumented release was built independently without the WebDriver
feature. Its executable contains no
`wdio-webdriver`, `TAURI_WEBDRIVER_PORT`, or WebDriver-session marker.

That release launched from the isolated `release/` directory and produced a
real on-screen native window captured at `logs/release-window.png`. This proves
launch and bundled UI composition, not the blocked picker/disk flow.

## Not covered

- Developer ID signing and notarization: **NOT_RUN**.
- Other Mac or older macOS: **NOT_RUN**.
- Full Korean IME composition and VoiceOver audit: **NOT_RUN**.
- Native fixture-open/save/disk interaction after cancel: **BLOCKED**.
