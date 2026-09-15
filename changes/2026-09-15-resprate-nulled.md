---
bump: patch
type: fixed
brief: none
---

OxyDex no longer publishes a respiration rate, because the number was not one.

#2526 measured `computeRespRateProxy` against SHHS1's two independent inductance belts over 300
records, 201 of them control-clean: proxy median **9.10** brpm against a belt reference of **14.34**,
**Pearson r = 0.046** (Spearman 0.082), within 1 brpm of truth on **3.5 %** of nights. Removing the
median offset lifts that only to 33.8 % — an estimator that does not track its target has nothing to
calibrate. Owner decision, 2026-09-15: **null it now.**

The published value is `null`. The field stays, so the export schema is unchanged and no consumer
contract moves — and there is no consumer today, which is why this is safe to do at all.

**Read the null as "not published", not as "the device could not measure it."** That distinction cannot
travel in the export, so it is recorded at the call site alongside the measurement that justified it.

**`computeRespRateProxy` is deliberately kept and still exported.** It is the subject of
`tools/nsrr-resprate-validate.mjs`, which needs the real kernel rather than a copy of its arithmetic —
including to demonstrate that the kernel's 0.13–0.33 Hz scan makes its own `Fast (>20)` label
unreachable, since 0.33 Hz is 19.8 brpm. Deleting the function would delete the evidence.

⚠️ **This is OxyDex's proxy only.** PulseDex's `respRate` is a different metric, derived from real RR
intervals via a Lomb–Scargle HF peak and gated by its own assertions at `tests/dex-tests.js:12270+`.
Same name, two nodes; nothing here touches it.

Three fixtures moved, each by exactly one field (`newMetrics.respRate` → null) — no collateral
movement, which is itself evidence the change is scoped. Regenerated through
`tools/regen-oxydex-goldens.mjs` and re-verified, never re-stamped around. One of them, the synthetic
golden, had been reporting **7.8 brpm** — the lowest bin the scan can return, which is what a
peak-power search with no detrend does on data carrying no respiratory modulation.
