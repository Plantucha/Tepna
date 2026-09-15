---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---

`pat-window-oracle.mjs`'s halves-invariance diagnostic — `modeB`, the lag mode re-estimated on a
night's second half — had exactly one assertion anywhere in the tree, and it ran on a plant whose lag
is **constant by construction** (`F = R.map(r => r + 700 + rnd()*14)`). A constant plant can show the
diagnostic *agrees* when the lag is fixed; it cannot show the diagnostic can *see the lag move*, which
is the only thing it exists for.

`papers/null-calibration.html`'s addendum names that failure exactly — *"a known-answer planted under
the model's own assumptions is guaranteed to pass, however wrong the model is"* — and prescribes
*"plant your known-answer under a model you are not assuming."*

It stopped being academic on 2026-09-14. Measured across both capture trees, `halves ≡` holds on only
**3/30** and **5/35** nights, median `|modeB − mode|` **130 / 120 ms**, and **every SIGNAL RECOVERED
night disagrees by 80–160 ms.** The corpus says this quantity moves on ~90 % of nights while the one
test of the machinery reporting it could not see movement at all.

The new plant drifts **300 → 620 ms over 900 beats** — both endpoints inside PHYS, so the night is not
refused for an unrelated reason, and the magnitude reproduces what the corpus actually shows rather
than an arbitrary one. Because the half-modes sit near their halves' centroids (~beat 225 and ~675),
the expected separation is about half the total drift; measured **345 → 535, Δ190 ms**, against the
constant plant's **295 → 305, Δ10**.

Four assertions, each covering a distinct way the diagnostic could be useless: it yields a scored
night; the drift **breaks** invariance; it does so **by the planted magnitude** (≥ 80 ms — a check that
fired on an 11 ms wobble would pass here by luck and still be blind to the corpus range); and the
escalation **reaches the verdict label**, which is what a consumer reads. Plus an anti-vacuity partner:
the constant plant must still read `halves ≡`, or a field stuck on `⚠` would satisfy all four and be
just as useless.

Mutation-verified from both directions rather than assumed — reverting the plant to a constant lag reds
it (`Δ0`), and neutering `modeB` to `mode` reds it identically (`Δ0`); restoring greens. Selftest
23 → 27.

Detection only: this changes no verdict, no band, and no published number. What the corpus-wide halves
disagreement *means* is `2026-09-14-oracle-mode-not-stable-across-halves`, still open.
