# Desktop UI hardening evidence

## Changed files and behavior

- `apps/desktop/src/SourceEditor.tsx`: suppresses Monaco callbacks during model/value synchronization and avoids resetting equivalent CRLF/LF text; user edits and per-model undo remain active.
- `apps/desktop/src/App.tsx`: compares logical cells for address bindings, preserves bindings after ASCII whitespace edits, flags changed bindings, explains source edit impact, and limits lesson grading to the loaded lesson document.
- `apps/desktop/src/NotesPanel.tsx`: stores versioned local drafts on each edit, restores them after panel/document switches, disables editing until asynchronous note load finishes, and marks unsaved drafts. Native note save remains explicit and outside `.mb`.
- `apps/desktop/src/WorkspaceParts.tsx`: blocks Back/Reverse/Restart during RUNNING, keeps Pause/Stop available for the live session, and shows raw/ASCII/opcode/formula plus the execution-equivalence warning in the Lens.
- `apps/desktop/src/Panels.tsx`: disables Send after EOF, separates retained visits and writes from theoretical xlat2, and labels loaded history accurately.
- `apps/desktop/src/useRuntime.ts`: adds an on-demand 200-event history page through the existing `queryView` option; no runtime API change.
- `apps/desktop/src/style.css`: keeps compact secondary actions reachable by horizontal scrolling, accommodates Lens copy, and removes nine descending-specificity warnings through selector scoping/order.
- `apps/desktop/package.json`: adds `test: vitest run`, which executes both existing desktop test files.
- `tests/e2e/current-ui.mjs`: real-browser scenarios for source/normalized/snapshot roundtrips, EOF send gating, draft persistence and source separation, latest event history view, breakpoint continue, logical whitespace bindings, and compact toolbar reachability.

## Verification

- `npm run typecheck -w @bolgescope/desktop`: pass.
- `npm exec -w @bolgescope/desktop -- vitest run`: 2 files, 4 tests pass.
- `npm run test -w @bolgescope/desktop`: 2 files, 4 tests pass through the new script.
- `npm run lint`: pass across 52 files, no warnings.
- `node --check tests/e2e/current-ui.mjs`: pass.
- `node tests/e2e/current-ui.mjs`: blocked before the first page. Chrome exits with SIGABRT at Playwright launch. The shell also receives `Operation not permitted` connecting to the existing `127.0.0.1:1421` server. The computer-control Chrome surface denied access. No browser scenario is claimed as passed; none is a native app test.

## Remaining gaps

- Run `node tests/e2e/current-ui.mjs` in a host session permitted to launch Chrome and reach the existing Vite server. No duplicate server or bundle build was started here.
- Case-sensitive lesson answer matching in `@bolgescope/lessons` and native app packaging/QA are outside this UI write scope.
- Drafts are keyed by the current document ID. They survive document and inspector switches; reopening a file after an app restart needs a stable file identity before a draft can be rebound safely.
