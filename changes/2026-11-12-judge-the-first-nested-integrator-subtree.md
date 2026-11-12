---
bump: minor
type: added
brief: INTEGRATOR-SURFACE-2026-10-11-BRIEF.md
---

Judge the first nested subtree of the Integrator export, `fusion.apnea`, at depth 2.

The surface gate judged the top level only, and it said so. This unit declares a surface for each of
the 14 keys under `fusion.apnea`, so `population.checked` moves from 36 to 50. The verdict also
names the subtrees it judged, in `result.nestedSubtrees`. A subtree absent from that list is not
examined, which the verdict now states rather than imply.

A nested read needs an ANCHOR. Four of these key names are also top-level fusion keys, so a bare
token cannot tell `fusion.findings` from `a.findings`. The gate resolves the alias, scopes the search
to the enclosing function, and asks for a property access there. The anchored test and the bare one
agree on all 14 keys today, so the anchoring repairs no live miss and tightens the gate for the next
edit. A planted control carries the difference.

Two states red that nothing could see before. A key that only some of the builder return shapes
carry must declare that, and `consequence` is one. A scope that rebinds its alias credits nothing,
because a comparator parameter would make `a.total` a read of another object. `--selftest` grew from
29 legs to 51.
