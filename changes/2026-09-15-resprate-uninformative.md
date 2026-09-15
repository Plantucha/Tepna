---
bump: patch
type: added
brief: none
---

OxyDex publishes a respiration rate that does not measure respiration rate.

Two residue rows already covered the value's provenance — `2026-09-03-oxydex-proxy-resprate-unattributed`
(it ships with a `basis` and no estimator attribution) and `2026-09-03-oxydex-resprate-has-no-consumer`
(nothing reads it, so the risk is latent). Neither asked whether the number is **right**.

`tools/nsrr-resprate-validate.mjs` answers that. SHHS1 carries the reference at 100 % coverage and
carries it **twice** — THOR RES and ABDO RES, two independent inductance belts measuring breathing
directly rather than inferring it from pulse. Over 300 records, 201 of them control-clean:

| | |
|---|---|
| proxy | median **9.10** brpm (range 7.8–11.6) |
| belt reference | median **14.34** brpm (range 8.5–25.2) |
| bias | **−5.32** brpm |
| **Pearson r** | **0.046** (Spearman 0.082) |
| within 1 brpm of truth | **3.5 %** |

**r = 0.05 is noise.** And this is not a calibration error a constant would fix: removing the median
offset lifts agreement only to 33.8 %, because an estimator that does not track its target has nothing
to calibrate.

**The two belts are the control, and they are why the finding is attributable.** A derived reference
needs its own validation or the comparison is one unvalidated estimator against another. THOR and ABDO
supply it for free — they agree exactly on 46/300 and within 0.63 brpm on 201/300, median absolute
difference 0.360 brpm. The 99 records where they disagree are **excluded**, because there the reference
itself is untrustworthy and including them would blame the proxy for the reference's error.

A second defect in the same kernel is purely static: `_respRateProxyWindow` scans 20 bins over
0.13–0.33 Hz, so the largest value it can emit is 19.8 brpm, while `respRateLabel` emits `Fast (>20)`
only above 20. **That label is unreachable by construction.** Asserted against the real exported kernel
rather than a copy of its arithmetic — driven with a pure 30 brpm tone it returns 19.2 and calls it
`Normal (10-20)`.

Corroborated independently on the home corpus, so it is not an SHHS artifact: 117 trio nights give proxy
median 10.9 brpm, range 8.4–13.8 — the same narrow low band, against a sleeping-adult expectation of
12–16. Two corpora, two devices, one compressed distribution.

**No behaviour is changed here**, and the mechanism is filed as a hypothesis rather than a finding: the
kernel removes the mean but does not detrend, and heart-rate spectral power falls with frequency, so a
raw peak-power search should be pulled toward its lowest bins by 1/f drift. The bottom-heavy output is
consistent with that and does not establish it. Whether an uninformative number should be nulled,
detrended, or given a wider band is an owner decision — each option moves `computeHash` and owes fixture
re-verification. Filed as `2026-09-15-proxy-resprate-uninformative`.
