---
bump: patch
type: fixed
brief: none
---

**The published site carried claims and withheld their corrections for over a month.**
`docs/papers/RERUN-RESULTS.md` was 162 lines shorter than its root original — missing two
CORRECTION sections, a CONVERGED result settling a paper column on the GPU, and a full 52-night
corpus re-run — while the served copy still carried the very sections those corrections correct.
`docs/papers/PAPERS-AUDIT.md` was one line behind. `verify:docs` reported "docs/ current"
throughout.

The cause is a real asymmetry, not an oversight: `build-docs.mjs` writes a `docs/` file only where
a root twin exists AND the extension survives its asset filter, and that filter drops Markdown. So
`docs/papers/*.md` is a served copy no builder maintains, sitting beside `docs/papers/*.html` that
one does. The two look identical to a contributor and behave oppositely.

Both twins synced root → served (`papers/` is the source of truth; `docs/papers/` is the copy),
verbatim — the file is a DATED log, so publishing it whole publishes each section under its own
date rather than as a live claim, and it restores the corrections alongside what they correct.

Gate-backed by `docs · build-docs · served-copy`: the twin set is pinned as an **equality** at its
two known members, not a floor — a floor passes when the set GROWS, and a third unmaintained twin
appearing is precisely the case nobody would notice. Three planted decoys red it: a drifted twin,
an added twin, a removed twin.

⚠️ Builder ownership over `docs/` is deliberately NOT widened. `rebase-safe` once treated the whole
prefix as generated and silently reverted an authored spec, which is why the split exists.

Fleet-Session: Magpie
