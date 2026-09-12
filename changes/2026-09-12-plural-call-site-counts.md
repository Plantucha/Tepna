---
bump: patch
type: fixed
nodes: [suite]
brief: residue 2026-09-06-plural-call-site-counts-unswept
---

Three gates counted call sites in source text as a proxy for a structural property. A count is wrong
in both directions, and the first is not a future concern — it is a live hole.

`dex-ingest` asserted `(src.match(/_isDeviceEligible\s*\(/g)).length >= 3` for "both planners route
through the shared primitive". Three calls from ONE planner satisfy it while the other re-implements
the predicate inline — the exact defect, passing — and consolidating the two planners drops it to 2
and reds the gate on the improvement.

The PAT worker asserted `(wsrc.match(/hostAxis:\s*rec\.hostAxis/g)).length >= 2` for "both parsers
forward their axis". A parser that forwards twice satisfies it while its sibling drops the field.

A third, in the respiration-method scan, was an anti-vacuity leg with its bar one too high: `>= 2`
asserts that TWO assignment branches exist, where the leg only needs one subject to examine.

All three now derive their population from the source instead of counting it, and name the offender:
the planners are enumerated by `^  function planIngest\w*\(` and each body checked for each
primitive; every `return {` carrying a `times:` key in the worker is checked for the forwarded axis,
so a third parser is covered with no edit. Each anti-vacuity leg is pinned as an equality where the
population is knowable, because a floor never counts what it excluded.

Both rewrites are demonstrated against a planted defect that the old count PASSES: an inline
re-implementation in `planIngestPpg` plus a redundant second call in `planIngest` keeps the file-wide
count at 5 and reds only the new form, which reports `["planIngestPpg"]`; a `ppgFootTimes` that drops
the axis while `ecgRpeakTimes` carries it twice keeps the count at 2 and reds only the new form.

SCOPE, measured rather than left open. The row recorded ~175 raw hits whose discriminator was
"INTENT, not shape". It is not intent — it is WHAT IS COUNTED. Source text standing in for structure
is the defect; data and loaded populations are ordinary assertions. On that split: 189 `.match(` sites
in `tests/` and `tools/`, 25 compared against an integer literal, 4 of them this shape (all fixed);
and 31 assertions counting a source-derived ARRAY against a literal >= 2, every one an anti-vacuity
floor on a loaded population, none this shape.

⚠️ The bound: that is a scan of two expression forms in `tests/dex-tests.js`, classified by reading
all 56 hits. A count expressed a third way is not covered, and the classification is one reader's.
