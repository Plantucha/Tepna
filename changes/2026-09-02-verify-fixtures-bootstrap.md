<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---
A NEW code-gated fixture with `inputs: []` could not be landed at all — `verify-fixtures.mjs` now
recognises a first generation instead of deadlocking on it.

`§3.1` fails closed on a fixture with no `verifiedUnder` (an empty `inputs` list is indistinguishable
from gitignored-corpus inputs). `verify-fixtures.mjs` is the only sanctioned writer of that field and
refuses to stamp while the suite is red. So the stamp needed a green suite and the suite needed the
stamp. Measured 2026-09-02 standing up the apnea-null twins: 8995 assertions, ONE failing, and it
named the very fixture the run existed to stamp. §3.1 landed 2026-07-14 and the only other `inputs:[]`
fixture was stamped a day later carrying a pre-existing value, so the path had never been walked.

The exemption is **DERIVED, not claimed**: a `--bootstrap <fixture>` flag was considered and rejected,
because a flag is an operator claim and an unchecked claim is this tool's whole failure mode. The run
already holds the evidence, so it stamps past a red suite only when every failing line is §3.1 AND the
fixtures §3.1 names are a subset of those owing a FIRST stamp. A second failing assertion, a moved
fixture, or a name that already had a stamp all refuse exactly as before. The decision reads EVERY
failing line, not the 8 it prints. The exemption prints loudly, because one invisible in the log is
indistinguishable from a gate that did not run.

Locked two ways: a gate assertion that the label the tool matches is byte-equal to §3.1's own label in
`dex-tests.js` (a rename would silently re-close the deadlock), and a `--selftest` — run by
`npm run check` — driving the extracted pure predicate over six adversarial failure sets, including
the empty one.
