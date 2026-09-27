# Review-fix evidence: 20260927-1448-fce3990

- Recorded: 2026-09-27
- Review baseline: `fce3990bc242a343b4c73cab83424637520126c5`
- Validated pre-delivery `HEAD`: `fce3990bc242a343b4c73cab83424637520126c5`
- Implementation commit: `c485560086fa9efc26a6c9576f5a41b0c7da2c7c`

The evidence was captured from intentionally uncommitted work on top of the
review baseline. No checkout/reset, commit, push, global install, or
installed-user-app replacement occurred during that repair run. A later,
explicit user request authorized the implementation commit above.

## Outcome

| Scope | Status | Evidence |
| --- | --- | --- |
| F1 RuntimeClient generation ownership | PASS | `verification.md`, `logs/worker-results.json` |
| F2 note revision persistence | PASS | `verification.md` |
| F3 source/runtime identity | PASS | `verification.md`, `logs/source-results.json` |
| F4 cancellable reverse execution | PASS | `verification.md`, `logs/machine-results.json` |
| V1 staged native diagnostics | PASS | `native.md` |
| Actual WKWebView, offline assets, Monaco | PASS | `native/results.json` |
| Native picker and real disk flow | BLOCKED | `native/results.json`, `native.md` |
| Uninstrumented release launch | PASS | `logs/release-window.png`, `artifacts.md` |
| Developer ID, notarization, other Mac | NOT_RUN | `artifacts.md` |

`BLOCKED` is limited to picker/disk automation: the final run loaded the real
WKWebView and completed native open-cancel, but Accessibility path entry could
not be driven reliably enough to claim the remaining disk flow. It does not
downgrade the F1-F4 source repair or browser/Worker regression result.

## Evidence map

- `reproduction.md` — pre-fix supervisor failures and reproduction basis.
- `acceptance.md` — requirement-by-requirement PASS/BLOCKED/NOT_RUN matrix.
- `verification.md` — commands, exit results, test counts, diagnostics.
- `native.md` — instrumented WKWebView result and native automation boundary.
- `artifacts.md` — local `.app`, ZIP, DMG, signatures, hashes, release smoke.
- `final-report.md` — F1-F4/V1 outcomes and remaining risks.
- `final-gate.md` — fresh APPROVE re-review of the two first-gate blockers.
- `results.json` — machine-readable verdicts and provenance.
- `logs/` — independent oracle JSON, browser JSON, screenshots.
- `native/` — actual acceptance-app result and test fixture.

## Change-set identity

- Tracked code/test diff SHA-256:
  `32bc003b8a4db2d7628ee2d7b9296329c12a8cc8777af270b8bf69eb05f6c66e`
- Untracked product/test file-manifest SHA-256:
  `f21005785d6b11ec8918e3b74bfcb89411f9ed9cccd9ff23796ca3868bfb21ec`

Evidence and release outputs are excluded from those two change-set hashes.
