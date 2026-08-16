---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Level B's first COMPLETE run on `clock.js` — 179 subjects, 159 killed, 14 pseudo-tested — recorded **6
INCONCLUSIVE**, every one `SETUP ERROR: Unexpected token '}'`.

All six were the sole statement of a **brace-less body**: `for (…) if (st > maxStep) maxStep = st;`.
Blanking the statement removed its semicolon too, leaving a dangling `if (st > maxStep)` that does not
parse — a class introduced by the brace-less recursion itself.

Deletion now leaves an **empty statement**: a trailing `;` is a no-op wherever a statement was already
legal, and exactly what a brace-less head requires. All 8 matching sites in `clock.js` now parse.

⚠️ **They were recorded INCONCLUSIVE rather than KILLED only because `ran` demands the TAP plan.** Under
the previous exit-code-only rule all six would have been banked as kills in a single run — so the
load-failure guard earned itself on the first full run it was exposed to, and its output named the six.

One existing assertion was edited deliberately: `deleting an expression statement blanks it` pinned the
old behaviour. It was not wrong about blanking; it pinned something the brace-less recursion later made
unsafe, which is why the reason is recorded in place rather than the line deleted. 75 selftests.
