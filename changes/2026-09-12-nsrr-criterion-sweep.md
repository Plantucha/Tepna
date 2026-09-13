---
bump: minor
type: added
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`tools/nsrr-criterion-sweep.mjs` — derive the desaturation criterion from expert-scored PSG instead of
assuming it, as a FITTED FUNCTION rather than a fixed threshold.

Every wrong answer in this lane came from an assumed criterion: ODI-4 paired against an AHI whose
hypopnea rule needs no desaturation, then the expert desaturation index paired against ODI-3 on the
assumption scorers used ≥3 % when a median 70.9 % of their events are shallower. A sweep replaces the
assumption with a measurement.

The result is a function — `dropPct(night) = clamp(a + b · z(covariate), 2–6 %)` — with `b = 0`
recovering the constant model exactly, so the incumbent is NESTED and the flexibility must earn its
keep on held-out records rather than by having more parameters. Covariates read the SpO₂ signal only;
one that peeked at the expert labels would score well held-out too, because the leak travels with the
data.

Guards, none optional: k-fold cross-validation (a single split's winner is itself a random variable);
the shipped default AND the best constant both scored as nulls; clamps that REFUSE rather than clip,
so a boundary optimum cannot be an artifact of the boundary; and a materiality bound of 0.5 events/h
taken from the published between-method spread (automated-ODI Bland–Altman bias runs −3.76 to +6.17),
below which the tool reports that the sweep found nothing.

Smart, not merely brute: the rolling ceiling baseline is ~100 % of `detectDesatEvents`'s cost and is
independent of the threshold being swept, so it is cached per (record, WIN, pct) — measured 24× faster,
verified to produce identical event counts, and LRU-bounded because unbounded it reached 2.9 GB.

Literature checked before building and it changed the design — see the header for citations.
