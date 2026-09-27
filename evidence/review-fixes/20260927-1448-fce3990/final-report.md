# F1-F4 / V1 final report

## Verdict

Requested repair: **PASS**.

The four behavioral findings and both first-gate regressions are fixed with
deterministic tests. Native acceptance reached the actual WKWebView and passed
real open-cancel, but remaining picker/disk automation is **BLOCKED** by
unreliable Accessibility path entry. Public signing, notarization, other-Mac
coverage, full Korean IME, and VoiceOver are **NOT_RUN**.

## Findings and fixes

### F1 — RuntimeClient generation race: PASS

- Client lifecycle requests carry monotonic epochs and settle superseded work.
- Worker replacement validates before committing machine/session/epoch.
- Failed loads preserve the prior session.
- Stop clears the client view and stale replies cannot resurrect it.
- Equal-version phase/reason transitions still update subscribers and cache.
- UI operation ownership prevents older completions/finally blocks from
  changing newer state.

Primary code:
`packages/runtime/src/client.ts`,
`packages/runtime/src/worker.ts`,
`apps/desktop/src/useRuntime.ts`,
`apps/desktop/src/operationOwner.ts`.

Risk remaining: Worker crash remains terminal for that `RuntimeClient`; the UI
must create a new client through its existing mount lifecycle.

### F2 — note revision persistence: PASS

- Save snapshots include target, document, note revision, source revision, and
  a unique revision token, and digest identity.
- Older save completion updates only the observed disk revision; a newer draft
  stays dirty.
- Same-target writes serialize and feed the returned revision into the next
  conflict check.
- Drafts survive panel/document switches and stale identity cannot rebind
  notes.

Primary code:
`apps/desktop/src/notePersistence.ts`,
`apps/desktop/src/NotesPanel.tsx`,
`apps/desktop/src/documentSave.ts`.

Risk remaining: browser-only drafts still depend on local storage and a stable
document identity; cross-device synchronization is outside scope.

### F3 — source/runtime identity: PASS

- Every non-whitespace logical position advances its address, including invalid
  cells.
- UTF-8 decoding records correct UTF-16 spans for Korean and surrogate pairs.
- A pure relation classifier distinguishes exact text, execution-equivalent
  whitespace, changed images, and invalid source.
- Runtime decorations, notes, lessons, and bindings use one projection policy.

Primary code:
`packages/core/src/source.ts`,
`apps/desktop/src/sourceUiState.ts`,
`apps/desktop/src/App.tsx`,
`apps/desktop/src/SourceEditor.tsx`.

Risk remaining: invalid documents intentionally have no executable image; UI
projections remain detached until the invalid text is removed.

### F4 — cancellable reverse execution: PASS

- Reverse target search and restore are bounded by event count and eight
  milliseconds per slice.
- Worker scheduling yields between slices and emits progress at at most 20 Hz.
- Pause, Stop, restart, and load cancel work by owner/generation.
- Restore commits only complete journal events; ordered writes, input events,
  output, Halt, and observation counters undo/redo exactly.

Primary code:
`packages/core/src/history.ts`,
`packages/core/src/machine.ts`,
`packages/runtime/src/worker.ts`.

Risk remaining: retained-history boundaries still limit how far reverse
execution can travel; the UI reports the existing history boundary.

### V1 — native staged diagnostics: PASS

- Native open requests carry bounded IDs and stage diagnostics.
- Dialog callbacks are scheduled on the main thread; waiting occurs in
  `spawn_blocking`.
- Grant locks are acquired only after dialog completion and path validation.
- The WebDriver dependency remains optional and absent from the release binary.

Primary code:
`apps/desktop/src-tauri/src/lib.rs`,
`apps/desktop/src/native.ts`,
`tests/e2e/native-acceptance.py`.

Risk remaining: actual fixture-open/save/disk automation is **BLOCKED** because
Accessibility path entry could not be driven reliably after a real cancel
cycle. This is recorded rather than claimed as PASS.

## Verification summary

- TypeScript: typecheck PASS.
- Full workspace: 16 files, 93 tests PASS.
- Focused F1-F4 regressions: 7 files, 47 tests PASS.
- Independent oracles: codec PASS; source 16/16; machine 18/18; debugger
  11/11; Worker 9/9.
- Browser: 9/9 real Chrome flows PASS.
- Visual QA: two final independent PASS verdicts.
- Rust: 13/13 tests, fmt, clippy, optional feature compile PASS.
- Actual WKWebView/assets/Monaco: PASS.
- Uninstrumented release launch: PASS.
- Local `.app`, ZIP, DMG integrity: PASS.

Detailed command and artifact evidence is in `verification.md`,
`acceptance.md`, `native.md`, `artifacts.md`, and `results.json`.

## Preservation and publishing

- Existing dirty work preserved.
- No checkout/reset, commit, push, global install, or user-app overwrite
  occurred during the repair/validation run.
- A later explicit delivery request created implementation commit `c485560`;
  remote publication is handled outside this evidence snapshot.
