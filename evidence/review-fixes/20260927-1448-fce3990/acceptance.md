# Acceptance matrix

Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`.

## Repair acceptance

| ID | Required behavior | Status | Evidence |
| --- | --- | --- | --- |
| F1.1 | Latest RuntimeClient lifecycle generation owns session state | PASS | `packages/runtime/src/client.ts:110-163`; lifecycle tests |
| F1.2 | Failed replacement preserves prior committed session | PASS | `logs/worker-results.json` |
| F1.3 | Stop clears displayed state and old promises settle | PASS | `logs/worker-results.json`; browser regression |
| F1.4 | UI async completion cannot mutate a newer operation | PASS | `apps/desktop/src/operationOwner.ts`; desktop tests |
| F1.5 | Equal-version phase/reason transitions update current state | PASS | real Worker regression in `packages/runtime/test/runtime.test.mjs` |
| F2.1 | Save completion merges by unique revision token | PASS | `apps/desktop/src/notePersistence.ts`; remount regression |
| F2.2 | Newer draft survives an older in-flight save | PASS | note persistence tests; browser regression |
| F2.3 | Same-target saves serialize and advance disk revision | PASS | `apps/desktop/src/notePersistence.ts:195-224` |
| F2.4 | Digest/document identity cannot be rebound by stale save | PASS | note persistence tests |
| F3.1 | Invalid cells do not renumber later logical addresses | PASS | `logs/source-results.json` |
| F3.2 | Korean/emoji diagnostics use correct UTF-16 spans | PASS | `logs/source-results.json` |
| F3.3 | ASCII whitespace-only edits retain execution identity | PASS | source relation tests; browser regression |
| F3.4 | Changed/invalid source detaches runtime projections | PASS | desktop projection test; browser regression |
| F4.1 | Reverse search and restore run in bounded slices | PASS | `packages/core/src/history.ts:57-90`; `machine.ts:85-113` |
| F4.2 | Pause cancels without partial journal-event state | PASS | runtime Worker tests |
| F4.3 | Stop/load replacement invalidates queued history work | PASS | runtime Worker tests |
| F4.4 | Undo/redo preserves input, Halt, output, roles, write order | PASS | rewind slice tests; machine oracle |
| V1.1 | Native dialog requests expose request/stage diagnostics | PASS | `apps/desktop/src-tauri/src/lib.rs:85-120` |
| V1.2 | Dialog callback runs on main thread without holding grant lock | PASS | `apps/desktop/src-tauri/src/lib.rs:88-117` |
| V1.3 | WebDriver feature is opt-in and absent from release artifact | PASS | Cargo feature check; binary marker check |

## Verification surfaces

| Surface | Status | Scope and evidence |
| --- | --- | --- |
| TypeScript diagnostics/typecheck | PASS | All workspaces; changed source directories have zero LSP errors |
| Full workspace tests | PASS | 16 files, 93 tests |
| Focused review regressions | PASS | 7 files, 47 tests |
| Lint | PASS | 61 files, no findings |
| Frontend production build | PASS | Vite build completed |
| Independent codec oracle | PASS | `logs/codec-results.json` |
| Independent source/loader oracle | PASS | `logs/source-results.json`, 16/16 |
| Independent machine oracle | PASS | `logs/machine-results.json`, 18/18 |
| Independent debugger contracts | PASS | `logs/debugger-results.json`, 11/11 |
| Actual Worker task-queue integration | PASS | `logs/worker-results.json`, 9/9 |
| Real Chrome UI integration | PASS | `logs/ui-browser.json`, 9/9 |
| Desktop visual QA | PASS | six viewport captures; two independent final reviewers |
| Rust tests | PASS | 13/13 |
| Rust fmt and clippy | PASS | no diff; no warnings |
| Optional acceptance feature compile | PASS | `cargo check --features e2e-webdriver` |
| Actual macOS WKWebView, offline assets, Monaco | PASS | `native/results.json` |
| Native picker and disk automation | BLOCKED | Real open-cancel passed; Accessibility path entry remained unreliable |
| Uninstrumented local release launch | PASS | `logs/release-window.png` |
| `.app` local code-sign integrity | PASS | strict `codesign --verify` |
| ZIP integrity | PASS | `unzip -t` |
| DMG integrity | PASS | `hdiutil verify` |
| Developer ID signing and notarization | NOT_RUN | No signing identity/account; artifact is intentionally ad-hoc |
| Gatekeeper public-distribution approval | NOT_RUN | `spctl` rejects expected ad-hoc build; no public-release claim |
| Other Mac / older macOS | NOT_RUN | No second machine |
| Full Korean IME and VoiceOver audit | NOT_RUN | No reliable automation/manual session recorded |

## Preservation constraints

| Constraint | Status | Evidence |
| --- | --- | --- |
| Preserve existing worktree | PASS | Fixes remain uncommitted over unchanged baseline `HEAD` |
| No force checkout/reset | PASS | No destructive Git operation performed |
| No commit or push during repair run | PASS | Validation preceded user-authorized delivery commit `c485560` |
| No global install | PASS | Existing local toolchain/dependencies only |
| No installed-user-app replacement | PASS | Release app ran from isolated `release/` directory |

Overall requested repair result: **PASS**. Native picker/disk automation remains
explicitly **BLOCKED**; public distribution and hardware/accessibility coverage
remain **NOT_RUN**.
