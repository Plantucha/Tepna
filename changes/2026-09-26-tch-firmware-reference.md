---
bump: minor
type: added
brief: none
---

`tools/tch-firmware-reference.mjs` checks the HR three-cornered hat against a reference it does not contain: the beat intervals on which ECGDex's Pan–Tompkins and the H10 firmware's own detector agree within 8 ms. For each night it reports every device's true σ, its bias and its error correlations, and it emits a `tepna.verdict/1`. `--ledger` scores only nights not seen yet, which fits a nightly timer. Over 37 box nights the verdict is FAIL: the classic hat under-reads the Verity (0.41 vs a true 0.73 bpm) and over-reads the H10 (0.97 vs 0.81), because the two optical devices share error (ρ ≈ 0.32). The correlated-error hat with ρ from the reference, leave-one-out, fails too, because near ρ ≈ σ_V/σ_O the optical corners are not identifiable. Bias is ≤ 0.03 bpm on every device. sensor-trio-night now labels its H10 and Verity σ̂ as unvalidated and its O2Ring σ̂ as reference-checked, and cites the pooled record. Two residue rows are added: the hat's misattribution, and the PAT extractors detecting finger feet on unmasked `156` rows (timing harmless, beat set 2–3 % on six older nights, an owner yes/no).
