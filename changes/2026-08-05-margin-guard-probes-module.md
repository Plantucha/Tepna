<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: JS-SEALED-ASSERTION-DEAD-END-2026-08-05-BRIEF.md
---

`dex-tests.js:14548` asserted `1.5 - CLEAN_HI > 0.4` — arithmetic over two constants declared in the
test — while its own comment claimed it would red "if someone widens the threshold toward 1.0". It
could not: `verityFailureClass`'s threshold was never read, and widening the module to `>= 1.1` left it
green. It now probes `cls()` for the module's own boundary. Records the abandoned JS sealed-assertion
analyser as a dead end (brief + `papers/dead-ends.html` §2.9).
