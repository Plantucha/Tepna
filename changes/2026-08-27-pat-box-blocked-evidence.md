---
bump: patch
type: changed
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

The PAT re-test box is now **evidence-backed BLOCKED** rather than open: the gating set does not exist,
and where it is best measured the closure **fails**.

Which closure matters, and the box's original reading was wrong twice over. §2.3's is ⛔ VOID (two of
three legs run through the O2Ring's **drawn** axis) and the VOID exempts **ECG↔Verity** by name — which
*is* PAT. The only non-void closure is the host-leg one (`beat-leg-closure.mjs`, third corner a real
0.008 ppm clock), whose own §7.3 "impossible" blocker was stale: it bound the *exports*, and that tool
reads raw waveforms.

Method fixed **before any data**: band `|legC − (A−B)| ≤ 2·σ_pred`, `σ_pred = √(σ_H10² + σ_Verity²)`,
coverage factor 2, range→σ by Hartley d₂, fragment rule = largest ECG × largest Verity by size, and a
REFUSE where either device has <2 fragments. Licence for blaming the host legs: `--selftest` recovers
planted rates to ±0.0 ppm over −40…+40 ppm, 7/7.

**49 nights → 33 with both devices → 7 bandable → PASS 3 · FAIL 2 · REFUSE 2.**

🔴 **The passes are not evidence, and the mechanism is a general methods finding:** verdicts separate
**perfectly by band width** — the three PASSes hold the three widest bands (9.64/12.49/20.56), the two
FAILs the two tightest (4.16/0.71). **A dispersion-derived band used as an inclusion gate anti-selects
for measurement quality**: noisy legs earn bands nothing can fail, consistent legs earn sharp bands that
real discrepancies fail, so "passing" enriches for the nights least fit for the downstream use. Never
use a per-night uncertainty band as a selection filter without checking the band↔verdict correlation.
2026-08-24 "passes" on ±20.56 ppm — wider than the entire measured spread of device rates.

⚠️ 2026-08-13 is a **sign flip**: +6.5 ppm predicted vs −14.6 measured on 28 blocks with the corpus's
cleanest legs. Spun out as `CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md` (new, indexed) — the two
methods disagree about direction where both are best measured, and finding which is wrong is the prize.

The re-test will **not** run ungated on the passing set; it waits for nights with ≥2 fragments per device
and consistent legs. The present corpus is mostly single-fragment (H10 on 20 of 33 nights, Verity on 18).
