<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: R5-HR-TRIPLET-REFERENCE-2026-07-12-BRIEF.md
---
Record that a three-cornered hat cannot be validated using one of its own corners as the reference — the test is algebraically vacuous — and that the one thing it CAN measure, bias, shows OxyDex under-reading by 0.36 bpm.

Executes `TCH-REFERENCE-VALIDATION` §7 **R5** (re-run the reference validation on the HR triplet). The answer
is that **it cannot be run**, and the reason is structural.

`TCH-REFERENCE-VALIDATION` worked because CPAP is a genuine FOURTH device. The HR triplet's "closest thing to
truth" — the chest-ECG — **is one of the three corners**. Expanding the hat:

    sigma_E^2(TCH) = [var(E-P) + var(E-O) - var(P-O)] / 2  ==  cov(P-E, O-E)

TCH's sigma_ECG^2 IS the covariance of the other two corners' reference-relative errors — an identity, verified
on the committed corpus to 6.7e-14. So the measured rho and the independence-null are the same number, the
excess is exactly zero **by algebra rather than by data**, and the test has **zero power**: it cannot detect
dependence even if it is enormous. The same collapse makes the sigma comparison vacuous (TCH reproduces the
pairwise variances by construction).

What R5 CAN measure is **bias**, because the hat has no bias term at all:

  PpgDex   +0.464 -> -0.028 bpm   (the artifact gate removes it)
  OxyDex   -0.436 -> -0.357 bpm   PERSISTS — OxyDex systematically UNDER-READS

That confirms `TCH-REFERENCE-VALIDATION` Finding A on a second, independent triplet: blindness to bias is a
property of the hat, not a quirk of the respiration corners.

Also raised AGAINST the companion brief: the artifact gate's effect on cross-corner agreement (SD(PPG-ECG)
4.52 -> 1.46) is **partly circular** and must not be cited as validation — the gate is DEFINED by cross-corner
disagreement. Its real evidence is the SQI channel it does not use.

The fix is one cable: CPAPDex's `_SA2.edf` already carries a `Pulse.1s` lane, currently all -1 (the "no
oximeter connected" sentinel). Connect the ResMed oximeter and the CPAP becomes the fourth, independent HR
corner the test requires.

Docs + read-only tool. No bundle, no ledger, no manifestHash move.
