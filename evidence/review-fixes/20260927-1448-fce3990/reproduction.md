# Pre-fix reproduction basis

Baseline: `fce3990bc242a343b4c73cab83424637520126c5`.

The working tree contains the fixes, so the baseline was not restored with
checkout/reset. Pre-fix evidence comes from independent supervisor runs,
preserved failure logs, and a read-only diff against `HEAD`.

## F1 — RuntimeClient generation race

Independent pre-fix Worker results in `evidence/supervisor/REVIEW.md`:

- invalid replacement load cleared the usable prior session;
- `stop()` left `getCurrentState()` stale;
- an epoch change stranded an older in-flight promise.

Minimal race:

1. Start load A.
2. Start load B before A settles.
3. Let B commit, then deliver A or A's cancellation continuation.
4. Issue a command against B.

The pre-fix client allowed stale lifecycle completion to affect the current
session or left a promise unsettled. Current locks:
`packages/runtime/test/client-lifecycle.test.mjs:103`,
`packages/runtime/test/client-lifecycle.test.mjs:214`, and
`packages/runtime/test/runtime.test.mjs:98`.

## F2 — note save lost update

The baseline `NotesPanel` used independent `notes`, `revision`, and `dirty`
state. After an awaited write, it unconditionally removed the draft and called
`setDirty(false)`.

Minimal race:

1. Edit note revision V1.
2. Start the V1 native save and hold its completion.
3. Edit the same note to V2.
4. Complete V1.
5. Leave and re-enter the panel.

V2 could appear clean or lose its persisted draft even though only V1 reached
disk. Two saves to one target could also race with the same observed disk
revision. Current locks:
`apps/desktop/src/notePersistence.test.ts:48`,
`apps/desktop/src/notePersistence.test.ts:68`,
`apps/desktop/src/notePersistence.test.ts:92`, and
`apps/desktop/src/notePersistence.test.ts:147`.

## F3 — source/runtime identity drift

The supervisor report `.implementation/SUPERVISOR_REVIEW.md` recorded:

- an invalid printable cell compacted the source map and renumbered following
  logical addresses;
- UTF-8 byte iteration produced wrong UTF-16 spans for Korean and emoji.

Minimal examples:

- Prefix a valid program with `!`; address two must remain address two even
  though the document is invalid.
- Prefix with `😀`; the diagnostic span must end at UTF-16 offset 2.
- Change only SP/HT/LF/CR/VT/FF layout; all 59,049 initial memory cells must
  remain identical.

Current locks:
`packages/core/test/source-relation.test.ts:35`,
`packages/core/test/source-relation.test.ts:72`,
`packages/core/test/source-relation.test.ts:93`, and
`logs/source-results.json`.

## F4 — non-cancellable reverse execution

The baseline reverse path searched/restored synchronously. Long history work
could not yield to Pause/Stop/session replacement, so queued work could outlive
its owner.

Minimal race:

1. Build a 20,000-event Worker history.
2. Start reverse search or rewind to event zero.
3. Pause, stop, or load a replacement session after progress begins.
4. Allow all queued callbacks to run.

The old operation must stop at a complete journal-event boundary and must never
touch a replacement VM. Current locks:
`packages/runtime/test/runtime.test.mjs:286`,
`packages/runtime/test/runtime.test.mjs:311`, and
`packages/core/test/rewind-slices.test.ts:21`.

## V1 — native dialog observability

`evidence/supervisor/REVIEW.md` identified blocking dialog calls and insufficient
stage visibility. Current commands dispatch callbacks on the main thread, await
their channel off-thread, and emit request/stage diagnostics at
`apps/desktop/src-tauri/src/lib.rs:85-120`.

Actual acceptance reached the real WKWebView and Monaco and completed a real
native open-cancel cycle. Subsequent Accessibility path entry was not reliable
enough to prove fixture open/save in the final run, so the remaining disk flow
is recorded `BLOCKED` in `native/results.json`, not promoted to a synthetic
PASS.

## First gate blockers and added regressions

The first final gate independently reproduced two additional failures:

- an older queued note save could delete a newer remounted draft when both
  reused numeric revision `1`;
- a real Worker `WAITING_INPUT` transition shared the prior `stateVersion`, so
  the client cache and subscribers remained at `PAUSED`.

Both were reproduced by new failing tests before repair. Drafts and save
snapshots now carry a unique `revisionToken`, and client publication suppresses
only equal-version states whose phase and reason are also unchanged.
