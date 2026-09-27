# Verification log

Final source gates were run against the dirty worktree over
`fce3990bc242a343b4c73cab83424637520126c5`.

## TypeScript, core, and frontend

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS; desktop, contracts, core, lessons, runtime |
| `npm test` | PASS; 16 files, 93 tests |
| `npm run test:review-regressions` | PASS; 7 files, 47 tests |
| `npm run lint` | PASS; 61 files, no findings |
| `npm run build` | PASS; Vite production build |

Full test distribution:

- desktop: 5 files, 16 tests;
- contracts: 2 files, 14 tests;
- core: 5 files, 29 tests;
- lessons: 1 file, 2 tests;
- runtime: 3 files, 32 tests.

Focused review distribution:

- core F3/F4: 2 files, 11 tests;
- runtime F1/F4: 2 files, 24 tests;
- desktop F1/F2/F3: 3 files, 12 tests.

Gate-review regressions added after the first review:

- a remounted note draft with a repeated numeric counter cannot be removed by
  an older queued save because revision tokens are unique;
- a real Worker `WAITING_INPUT` transition with an unchanged machine version
  updates subscribers and `RuntimeClient.getCurrentState()`.

Build note: Vite reported only its advisory that the main minified chunk exceeds
500 kB. Build exit was zero.

## Independent oracles

The preload redirects supervisor result files into this run directory instead
of overwriting parent-owned evidence.

| Command / result file | Result |
| --- | --- |
| `check_codec.mjs` / `logs/codec-results.json` | PASS; 8,836 decode, 472,392 encode, 102 encryption, 4,258 crazy, 59,049 rotation cases |
| `check_source.mjs` / `logs/source-results.json` | PASS; 16/16 |
| `check_machine.mjs` / `logs/machine-results.json` | PASS; 18/18, 14 C-reference cases, 218 instructions |
| `check_debugger.mjs` / `logs/debugger-results.json` | PASS; 11/11 |
| `check_worker.mjs` / `logs/worker-results.json` | PASS; 9/9 actual Worker task-queue integration |

`check_source.mjs` stores fixture paths relative to
`evidence/supervisor`. A first run from repository root produced eight
`ENOENT` harness errors. It was rerun with that working directory explicitly;
all 16 checks passed and the PASS JSON replaced the failed harness output.

## Diagnostics

`lsp_diagnostics` reported zero errors for:

- `apps/desktop/src`;
- `packages/core/src`;
- `packages/runtime/src`;
- `tests/e2e/redirect-supervisor-results.mjs`.

## Rust and Tauri

| Command | Result |
| --- | --- |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS; 13/13 |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | PASS |
| `cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --features e2e-webdriver` | PASS |

A manifest-less harness invocation first ran from the repository root and
failed to locate `Cargo.toml`; the listed manifest-qualified commands are the
decisive runs.

## Worker and browser QA

| Surface | Result |
| --- | --- |
| Real Node Worker bridge | PASS; 9/9 in `logs/worker-results.json` |
| Production-preview Chrome integration | PASS; 9/9 in `logs/ui-browser.json` |
| 1280×800 desktop | PASS; `logs/browser-1280.png` |
| 900×700 inspector closed | PASS; `logs/browser-900.png` |
| 900×700 Write overlay | PASS; `logs/browser-900-overlay.png` |
| 900×700 Learn overlay | PASS; `logs/browser-900-learn-overlay.png` |
| 768×700 stress width | PASS; `logs/browser-768.png` |
| 375×667 stress width | PASS; `logs/browser-mobile.png` |

Browser scenarios cover source/normalized/snapshot/CRLF isolation, EOF gating,
note draft persistence, historical view purity, breakpoint continue, whitespace
identity, invalid Unicode detachment, compact toolbar scrolling, and the
minimum-width internal inspector close path.

Two fresh read-only visual reviews returned PASS with high confidence and no
blockers after the shared Write/Learn close header was added.

## Native and release

| Command / action | Result |
| --- | --- |
| Acceptance `.app` build with opt-in WebDriver feature | PASS |
| `python3 tests/e2e/native-acceptance.py` | BLOCKED overall; actual WKWebView/assets/Monaco and native open-cancel PASS, remaining picker/disk automation BLOCKED |
| `bash scripts/package-macos.sh` | PASS; `.app`, ZIP, DMG generated |
| Isolated uninstrumented `.app` launch | PASS; on-screen window captured in `logs/release-window.png` |
| `codesign --verify --deep --strict` | PASS |
| `unzip -t` | PASS |
| `hdiutil verify` | PASS |
| Release binary test-feature marker scan | PASS; `NO_TEST_FEATURE_MARKERS` |
| `spctl --assess` | Expected rejection of ad-hoc, unnotarized local preview; public distribution remains NOT_RUN |

No validation command changed Git history, installed a global package, or
overwrote a user-installed application.
