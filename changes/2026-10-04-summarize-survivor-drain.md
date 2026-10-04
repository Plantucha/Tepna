<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
**Eleven of `nightqc.summarize`'s forty-one open mutation survivors are killed, and the ratchet moves
41 → 30.** Two families: the session-neighbour boundaries and gap lines (committed earlier), and the
conditional-expression / argument-drop set (`_span_reason`'s two arms, `writer_offset.frame`, the
`(rate assumed)` qualifier, the `isdir` guard, and the two `dict(base, key=…)` calls whose base a
mutant drops).

**Every kill is measured as a DELTA against a clean baseline**, not read off the word "failed": each
mutation is planted verbatim from the ledger's own `-`/`+` pair, the suite re-run, the failure count
compared with the unmutated 0 / 328, and `nightqc.py` restored and checked byte-identical by sha256.

**Two of the thirteen originally claimed do NOT die** and stay open rather than being closed as
equivalent: `after`'s `s[0] >= cur[1] → s[1] >= cur[1]` and `before`'s `s[1] <= cur[0] → s[1] <= cur[1]`
(residue `2026-10-04-two-neighbour-predicates-agree-unless-a-session-is-zero-length`). They look
equivalent under `merge_sessions`' documented disjointness, but a zero-length session would distinguish
them and that has not been ruled out — so the claim is not made.
