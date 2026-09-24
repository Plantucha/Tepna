---
bump: patch
type: fixed
brief: none
---
An unanalysed night scored the **maximum** on the readiness score's hypoxic-load component, and that score carries a training recommendation.

`var odi4Rate = odi4 ? odi4.rate : 0` and `var hd94Rate = hypDose ? hypDose.hd94PerHr : 0` turned an unmeasured night into two zeros, which satisfy the first rung — `if (odi4Rate < 2 && hd94Rate < 30) spo2Score = 25` — awarding the full 25 of 25. The rung is a conjunction of two defaults, so **either input alone being absent was enough**: the plant shows `[25, 25]` for ODI-present-dose-absent and the reverse. `computeHypoxicDose` returns null below 60 rows, so this is a live path.

The inflated total feeds `readinessTier`, whose top band prints *"Full training. Threshold, intervals, or VO₂max work appropriate."* The fabrication did not stop at a number.

**An unmeasurable component is now null, dropped from the total, and the remaining weights renormalised** — the shape `mageR` (#2993) and `autoRisk` already use. `readinessBasis` publishes which components scored and how many of the 100 points they covered, because **renormalising is itself an assumption** — it treats the missing component as resembling the rest — so a 78 over three components must be distinguishable from a 78 over five.

⚠️ **An existing assertion pinned the fabrication as the spec** and is reconciled deliberately, not quietly renumbered: `'no odi4 and no hypDose ⇒ both read 0 ⇒ the TOP rung, 25'` now asserts the refusal, with a comment recording what it used to claim. Every other rung in that ladder is untouched and remains the control.

⚠️ **#2996's ratchet did its job.** That PR pinned this site as an equality — "exactly one known sibling remains" — so fixing it today forced the list to shrink to `[]` and made me update the gate consciously rather than pass silently.

⚠️ **Two guards here are DEFENSIVE, not live fixes, and I would rather say so.** Making `readiness` nullable exposed that the tier ladder and the MAF adjustment have no null branch: every comparison is false against null, so the tier would fall through to *"Rest Day"* and `null < 55` is **true**, applying a 10 bpm recovery-deficit penalty. Typecheck caught both. But with only the SpO2 component nullable today, `readiness` cannot actually be null — `rmssdScore` falls back to 0 and sleep/hrFloor/hrSlope always produce numbers. These branches close a hazard this change created; no user was hitting them.

**Checked and deliberately not touched**: the HR-floor component's `hrRest <= 48` would award the full 15 for a null `hrRest`, but `computeKarvonenZones` returns early unless `hrRest` was derived, so that path is unreachable — fixing it would have convicted working code.

Inert on every fully-measured night by construction: with all five components present the renormalisation divides by 100, which is the identity, and the twin asserts exactly that against the plain sum. All four fixtures moved by `manifestHash`/`computeHash` only, enumerated from the regen's own field list.
