---
bump: minor
type: added
brief: PAT-HAT-DRIFT-DIFFERENCED-2026-09-27-BRIEF.md
---

The PAT hat rows now render **what the solver actually decided per corner**, and the drift-removed hat gets
its own labelled row. The page half of `PAT-HAT-DRIFT-DIFFERENCED`; #3179 landed the worker half.

**A negative solved variance has two different meanings and the page printed one word for both.**
`patHatCornerStatus` separates them, so the page can too:

| status | rendered |
|---|---|
| `solved` | σ with its block-bootstrap CI (when the CI resolved) |
| `underpowered` | `underpowered, σ < 14.4` — an **upper bound**: the variance came out negative but its CI spans 0, so the data are *consistent with independence* and merely too few to resolve a small corner |
| `independence-failed` | names the **pair** and the explaining ρ, flagged `beyond ±1` and **never clamped** — ρ is coarse (−1.30 … −0.45 over 40 planted seeds), and clamping would make a wide point estimate look like a tight one |

⚠️ **What this removes is a scientific misstatement, not a missing feature.** Measured on `origin/main`
against the merged worker's own 2026-09-26 output (`sigma.chest` null, `corners.chest` underpowered with a
14.4 ms bound), the page ignored `corners` and rendered *"REFUSED — a negative solved variance — the hat's
independence assumption failed"*. That asserts an independence failure on a night whose data are consistent
with independence. The owner's ruling item 1 exists for exactly this distinction.

**The drift-removed hat is its own row and never carries a delta.** Differencing removes a drift shared by
all three sites, which *changes the estimand* — it is not a better measurement of the same quantity, so a Δ
against the classic σ would invite the reading that the smaller number is the improved instrument. Its own
row, its own `hatD` badge (§🎫), and the producer's own `label` forwarded rather than paraphrased.

**The closure is stated, not published:** `chest→finger − chest→ankle + finger→ankle` is identically 0 by
construction — every beat triangle shares its ankle beat — so publishing it as a consistency residual would
be a gate over an algebraic tautology, a number that cannot fail read as evidence something was checked.

`corners` and `diff` are **additive**, so a result from before they existed still takes the sigma path; the
#3180 group is the unchanged back-compat control. Every arm's number is nullable in the producer
(`boundMs`, `sigmaCI`, `explainRho`), and each says what is missing rather than printing `null` or borrowing
a neighbour's wording.

Plants: 21 assertions executing the shipped function, pinned to the brief's own before/after table for the
owner's night — `underpowered, σ < 14.4 · 12.2 [0.0, 20.0] · 25.5 [18.3, 29.8]` classic and
`10.6 [0.0, 15.4] · underpowered, σ < 8.3 · 24.2` drift-removed — including that an underpowered corner
never claims an independence failure, that ρ is not clamped, that no arm prints the literal `null`, and an
anti-vacuity leg that the arms render differently.
