---
bump: minor
type: changed
brief: none
---

**The writing rules bite: a finding is a red, and the compliance gate reads every PR body.**

`tools/ste-lint.mjs` now exits 1 on any finding, and its verdict is `FAIL` with the rules named. No finding over prose is `PASS`. A target with no prose line is `NOT_RUN`. The old report-only form stays behind `--advisory`, for a sweep over a backlog nobody has asked anyone to clear.

`tools/pr-compliance.mjs` runs the strict form over the PR body as its fifth check. A body with a passive sentence or a 26-word sentence now reds the required `test` context. The failure names the first five findings by line and rule.

Owner ruling 2026-10-12: "make it bite". Measured before this change: six of the eight open PR bodies carried findings, from 5 to 21 each.
