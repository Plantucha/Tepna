---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The mutation gate's scratch answered a read differently from the checkout it is a copy of. `root_reads`
finds the repo-root files the suite names by scanning test sources for path-like literals — docstrings
included — and keys on the file's NAME, over-flagging deliberately because a stray mention costs "one
spurious copy of a small file". That price is right only while the staged name exists ONLY in the root.
For a name the tree also carries, `stage_root_reads` writes the ROOT file over the tree's own copy that
`copytree` had just placed there, and the cost is a SUBSTITUTION.

Two names collide today, measured: `tools/mutate-equivalence.json` — the JS ledger in the repo root has
9 modules and 463 entries, capture-host's own has 33 and 642 — and `README.md`. Both have been
substituted in every scratch since the 2026-09-22 widening (#2864), invisible for as long as nothing
inside the scratch read their CONTENTS. #3246's per-module count ratchet reads the ledger, saw one with
no `solid_night_inputs.py` key at all, and failed in the CLEAN-TEST pass — so `mutate_diff` refused the
whole run as NOT_RUN, correctly and about the staging rather than the diff. It surfaces when a PR ADDS a
module to that ratchet, because the module's name then appears in `test_equivalence_ledger.py` and pulls
that file into the module's own selected test set; every other branch passes, so it reads as one PR
being broken.

`tree_shadowed` names the collisions and `stage_root_reads` now stages those to `work/..` only, so the
tree's own file survives inside the tree while a genuine `tests/../..` read of a same-named root file
still resolves — refusing both destinations would trade this defect for the one #2864 fixed. The real
tree's collision set is pinned as an equality beside the root-reads population pin, so a new one is
visible where an author will read it.
