<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: DOCS-LEDGER-CHECK3B-BLIND-ROW-2026-08-01-BRIEF.md
---
`docs-ledger` **check3c** — within one brief, a section must not be claimed both closed and still open.

§4a named this hole and deliberately declined to build it, for a good reason: *"a gate that cries wolf on the legitimate partial case would be turned off, which is worse than the hole."* It is not a hypothetical hole — §4a records **three instances in `ENGINE-VERIFICATION-FINDINGS` alone, in one day**, one of which "nearly redid" a session's work and another of which sent a second session on the same errand.

So the cry-wolf rate was **measured across every brief before the gate was written**: 12 briefs carry a `Still open:` line, **0** claim a section both closed and open. It ships as a regression guard with no live subject, and says so.

Two refinements were forced by real false positives during that measurement — both load-bearing:

- **Section ids keep letter suffixes.** `PROFILED-HOTSPOTS-CI-AND-DSP` closes §1a while §1b is open; collapsing to "§1" fired on a consistent brief.
- **The partial-vocabulary veto is per section id, in its own ±30-char window.** `OXYDEX-PB-OVERCALL`'s *"Still open: §4 item 3 only"* vs *"§4 items 1, 2 and 4 ANSWERED"* is §4a's legitimate case and fired before this existed. The window must be local — a line-wide veto excuses an entire single-line header on one stray "half", and single-line headers are where all three historical instances lived.

**Both wrong capture bounds looked like success.** To the first `.` truncates inside "§1.4" and empties the open-set (zero false positives *and* zero true positives). To end-of-line over-captures on a single-line header, sweeping in five unrelated sections. Shipped form: 80 chars of the first line, cut at the first enumeration-ending delimiter (`**`, ` — `, `;`, `)`).

**The gate itself shipped as a no-op once, green.** An early revision scanned `briefSet`, a name→`1` existence map rather than the brief text, so every "text" was the string `"1"` — it matched nothing and passed. The same hollow shape the brief is about, inside the fix for it. Caught by planting the real §1.7 contradiction back into `ENGINE-VERIFICATION-FINDINGS` and watching the gate stay green, not by review.

Mutation-verified both directions (plant → ✕ `self-contradicting (1): …§1.7`; restore → ✓), plus four permanent self-tests so the matcher cannot rot into a no-op while it has no live subject: catches the §1.7 shape; silent on `§4 item 3 only`, on §1a-closed/§1b-open, and on half/partial vocabulary.

Node-lane only, like the rest of `docs-ledger` (it reads `briefs/` from the filesystem). Tests only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
