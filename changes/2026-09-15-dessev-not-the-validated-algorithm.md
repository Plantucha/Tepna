---
bump: patch
type: fixed
brief: none
---

The `DesSev` card claimed a validation that belongs to the published metric, not to OxyDex's
implementation of it.

It read: *"AHI surrogate validated in SHHS sub-cohort. Combines ODI-3 rate, mean depth, and mean
duration. Correlates with PSG-AHI."* Every clause is true **of Kulkas (2013)**. None of it was
established for this card, which integrates desaturation area over OxyDex's own canonical ODI event
set — a different computation whose agreement with the published one has never been checked.

The sibling **SBII** card three cards down already handles the identical situation correctly: *"This
card is an internal depth²×duration estimate, **not** the validated algorithm — directional, not
diagnostic."* `DesSev` now says the same thing in the same words. This is a consistency fix against an
existing in-guide precedent, not a new rule.

It also carries what **is** measured, with its scope stated: DesSev is one of three terms in OxyDex's
internal AHI model (`0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2`), and that model correlates with
expert-scored AHI at **r = 0.50** over 300 SHHS1 records — **no better than the plain ODI-4×1.1
surrogate (r = 0.51)** on the same nights (#2532). The card says explicitly that this measures the
**composite, not DesSev alone**, because DesSev's own correlation with PSG-AHI has not been measured
and writing the composite's number as if it were DesSev's would repeat the exact error being fixed.

The evidence tier is unchanged at `emerging`. Nothing here re-grades the metric — it removes an
inherited authority the card was never entitled to.
