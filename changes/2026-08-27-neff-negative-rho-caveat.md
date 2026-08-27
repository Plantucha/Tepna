---
bump: patch
type: fixed
brief: CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md
---

§3's autocorrelation correction carries a hazard for anyone re-deriving it: `n_eff = n(1−ρ₁)/(1+ρ₁)`
exceeds `n` whenever the sample ρ₁ is **negative**, so the inflation factor `√(n/n_eff)` drops below 1
and the "corrected" SE comes out **narrower** than the OLS one it exists to widen — a correction pointed
backwards, and invisible in a run that passes.

| ρ₁ | n_eff (n=28) | inflation |
|---|---|---|
| +0.318 | 14.5 | 1.390 |
| 0 | 28.0 | 1.000 |
| −0.100 | 34.2 | **0.905** ← shrinks |
| −0.300 | 52.0 | **0.734** ← shrinks |

The formula is not wrong — negative autocorrelation genuinely carries more information per sample — but
it is used here as a **one-sided conservative correction**, and one that can narrow an interval is not
conservative. Fix recorded: **clamp `ρ₁ ← max(0, ρ₁)`**.

⚠️ A *lower* clamp on `n_eff` (`max(2, n_eff)`) looks like the guard and is not — it protects the ρ₁→+1
end, which was never the hazard, and leaves the backwards direction open.

**No published number changes.** §3's measured ρ₁ are 0.318, 0.704 and 0.706, all positive, and **no
shipped tool computes `n_eff`** (verified by search — the `ecgdex-dsp.js` autocorrelation hits are
unrelated pitch-detection), so the brief was the only surface needing the caveat. Found by the Vigil box
session while reproducing the table exactly (1.390 against the published 1.391) — the reproduction that
confirms a result is also what surfaces its edge cases.
