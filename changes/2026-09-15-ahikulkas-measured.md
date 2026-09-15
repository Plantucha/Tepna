---
bump: patch
type: added
brief: none
---

The second AHI estimate had never been measured, because the adapter didn't surface it.

`computeAHIestimates` (`oxydex-dsp.js:1390`) produces two estimates of the same quantity:

```
ahiODI4   = ODI-4 × 1.1                                 1 measured term,  1 constant
ahiKulkas = 0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2      3 measured terms, 4 constants
```

The first is measured against real PSG in `papers/odi4-ahi-bias.html` §3.2. The second had been
evaluated by **nothing** — `nsrr-adapter.js` exposed only `ahiOxyEst` (= `ahiODI4`), and every NSRR
measurement in this repo reads the adapter, so what the adapter dropped was invisible to all of them.
Exposing `ahiKulkas` is additive and null-safe; `ahiOxyEst` is unchanged for every existing caller.

`tools/nsrr-ahiest-validate.mjs` then answers the question that matters — not *does it correlate*, but
**does the elaborate estimate beat the trivial one on the same records?** Both come from one
`analyzeRecord` call, so they see identical rows, identical detector state and identical reference.
300 SHHS1 records, all 300 with both estimates present:

| | ahiODI4 | ahiKulkas |
|---|---|---|
| **r vs scored AHI** | **0.5141** (R² 0.264) | **0.4993** (R² 0.249) |
| median \|error\| | 30.44 /h | 18.31 /h |
| median value | 3.45 | 16.50 |

*(scored AHI median 36.45)*

**The fit-free comparison is decisive and it goes the other way from the error column: the elaborate
model ranks nights marginally *worse*.** Its error advantage is *scale* — its output is simply bigger,
and the reference is big. A one-constant rescale `ODI-4 × 6.77` reaches median error **18.26**,
matching the four-constant model.

**Split-half refuses the stronger claim**, and that is the honest part: fitted on one half and tested
on the other, the rescale is better by 0.64 events/h on one fold and worse by 1.55 on the other — the
folds **disagree in sign**. So a rescale is not demonstrably *better*; the two are indistinguishable
within fold noise. The finding is that the extra complexity is **unearned**, not that it is wrong.

The `ahiODI4` R² of 0.264 measured here matches the **0.27** published at n = 5136 — that agreement is
the control that this instrument reads the same quantity, and it is why the `ahiKulkas` figure beside
it can be trusted at n = 300.

No behaviour changed. Filed as `2026-09-15-ahikulkas-buys-scale-not-skill`, which also notes that the
`DesSev` card claims *"validated in SHHS sub-cohort … Correlates with PSG-AHI"* without the
internal-implementation disclaimer its sibling SBII card carries.

⚠️ The first run of this scorer returned **n = 0** while reporting a clean exit: `analyzeRecord` takes
`edfBuffer`, not `edfBuf`, and a wrong key is not a type error — it reads `.byteLength` off `undefined`
and returns `{err}` per record, so all 300 "completed". The call shape is now copied from
`ODI.scoreRecord` rather than guessed, and the header records the trap.
