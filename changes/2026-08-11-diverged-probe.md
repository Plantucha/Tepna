<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Resolve `check-stranded`'s DIVERGED verdict with evidence, and state the LANE on not-reached.

DIVERGED WAS THE VERDICT THAT GETS SKIMMED. A sibling session ran the algorithm over six merged PRs:
diverged was the majority of non-trivial rows — 5 of 6 branches had one — and every instance was
benign, a later PR having touched the same file. A verdict that is usually benign and occasionally
not is the shape nobody reads.

It now probes the branch's OWN added lines against main's current blob. All present ⇒
`landed-with-evidence`; none present ⇒ `stranded`; mixed ⇒ still diverged, naming what is missing.
Presence in the CURRENT blob, not `git log -S`: a history search answers "main saw this line once",
which stays true after a later commit removed it.

Distinctive lines only, ≥24 chars with a letter. A bare `+}` matches everywhere and would resolve
every row to LANDED — and since this refinement can only ever turn a loud verdict quiet, its bar has
to be high. Fewer than two usable lines ⇒ it declines, and DIVERGED stands.

It immediately found real content of mine still absent from main: `package.json`'s `test:tools` /
`test:guards` / the updated `check` script, `.gitignore`'s sweep-journal line, and the whole
pseudo-tested ratchet job in `coverage.yml`. All present on this branch, so the recovery is complete —
but the probe, not the eye, is what confirmed it.

AND THE LANE IS HALF THE SCOPE ON NOT-REACHED. c8 instruments the node lane; the browser render rigs
boot bundles in iframes it cannot see. Measured by the tests/ session: hrvdex `getFilteredRows` 25
calls, `_hrvUpdateExportHint` 5, `restoreHRVRows` 1 — all three read 0 under c8. NOT-REACHED means
"no node-lane test in this group calls it" and NEVER "dead code"; for those three the action is a
browser-lane assertion, not deletion.
