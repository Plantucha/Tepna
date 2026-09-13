---
bump: patch
type: fixed
nodes: [suite]
brief: residue 2026-09-12-partial-fold-reads-as-zero-overlap
---

A night that was never folded counted in the estimation yield.

#2420 taught the per-night line to say `incomplete night` instead of `overlap 0 < 12`. The
DENOMINATOR still counted it: a `trio-batch` child that aborted on a heap limit printed
`1 estimated / 2 nights` where only one night was ever foldable, and inflated the corpus line to
`all 2 cohorted night(s)`. Two runs over the same recordings then disagree on estimation yield
because of a heap limit, with nothing in the output saying so.

Incomplete nights are now excluded from both counts and from the cohort split, and treated exactly
like the degenerate-boundary nights the file already handles this way — reported, excluded, with the
count and the night NAMES printed on the same line as the number they change. Removing them
silently would be the mirror-image defect: a filter the reader cannot see.

⚠️ THE CONTROL IS WHAT MAKES THIS A RULE RATHER THAN A BLANKET, and it is asserted. A night that
failed for a REAL reason — a genuine zero overlap, a degenerate solve — is one this tool TRIED and
could not estimate, and it must keep counting, or the yield flatters itself. Only `incomplete` is
excluded.

`distributionHeading` is pure so `--selftest` pins the accounting without a filesystem. Five new
cases, and all three mutants are caught: counting incomplete nights again reds 1, excluding every
failed night reds 4, and dropping the EXCLUDED clause — a silent filter — reds 2.

Measured before and after on two planted night directories, one complete with a `.trio-stamp` and
one 2-of-3 without: `1 estimated / 2 nights` + `all 2 cohorted night(s)` becomes `1 estimated /
1 foldable night(s) · 1 incomplete night(s) EXCLUDED … night-partial` + `all 1 cohorted night(s)`.
