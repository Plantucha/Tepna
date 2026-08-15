---
bump: patch
type: fixed
---

**The adequacy rule in `beat-capture-recapture.mjs` is necessary and not sufficient**, and what defeats it
is CONTAMINATION rather than sparsity.

#1292's sparse-cell refusal (expected cell ≥ 5) was written against a measured case: an 18.85-min window
whose cells were 24/2/3 and 9/1/12. **A full night clears that rule in every cell and is still absurd.**
On 2026-08-12, 166.3 min of three-way overlap, cells `93/159/207 · 262/152/74 · 9146` — every informative
cell ≥ 74, the rule passes, and the estimator returns **m₀₀₀ = 9 500 against 10 093 observed**: 48.5 % of
beats "missed by everything", previously reported as a bare number.

The closed form multiplies the three **single-source** cells, and a single-source cell is a mixture — a
real beat the other two missed, or a spike this one detector invented. False positives enter the numerator
directly, and no count of cell sizes can see it: the cells are large, they are just not all beats.

`tools/capture-recapture.mjs` adds the discriminator. Chao's bound reads the same singletons and inflates
with them; the **modified Chao** (Böhning et al. 2018, *Metrika*) estimates f₁ from f₂ and f₃ and cannot.
Planted truth: false singletons push the log-linear up **89 %** and move the modified Chao by **0**. On the
real night the ratio is **699×**. `estimate()` now publishes `chaoFloor`, `modifiedChaoFloor`,
`oneInflation` and a `warnings` array — **warning, not refusing**, because the sparse rule already owns
refusal and a second one would silently change the contract for the existing caller.

**⚠️ The floor is not an estimate, and this work's own gate falsified an earlier claim that it was.** Under
the positive dependence this corpus has, the whole Chao family under-reads planted truth by **~70 %** and
collapses toward zero at high capture. Its `0` on the real night is not evidence nothing was missed. The
gate pins the under-reading direction so the floor cannot be misread.

`estimate()` was **entirely ungated** before this; the group now pins its sparse refusal too.

⚠️ **This duplicated #1292** — both sessions implemented §7 the same day from the same brief. The duplicate
driver was dropped on rebase and #1292's kept; only the non-overlapping part survives. One `gh pr list`
against the brief a work-unit is about would have prevented it.

Review by #1292's author found the one path the diagnostic could not be seen on: `--scan`, the survey
mode, printed `missed=9500 (48.5 %)` with no flag — the REFUSED branch is loud, the estimated branch said
only the number. The formatter is extracted as `estSummary` so it is gateable rather than checkable only
by a source scan.

The two warning bounds are argued separately because they **age differently**: `0.25` is physiological
(a worn recording cannot plausibly miss a quarter of its beats) and could be wrong for another montage;
`5` is structural and cannot be wrong unless the capture model is — under a homogeneous Poisson model both
Chao variants reduce to the same f₀, so the null ratio is **1 by construction**, verified over
λ = 0.3 … 5.0 and now pinned by assertion.

Gate: `capture-recapture` — 38 assertions against exact analytic known-answers plus a deterministic
planted-truth simulation; **fourteen mutants verified dead**.
