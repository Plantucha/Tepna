---
bump: patch
type: changed
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

Measured where the PPG systolic foot actually lands across 20 box-captured Verity nights. The foot is
BIMODAL — ≈0.9 ms σ on half the nights, ≈13 ms on the rest, with a clean gap and nothing between — and
the good nights are scattered, not recent. Doubling, channel SNR, a single bad LED and detector
bistability are each refuted with the measurement that refuted them; the splitting mechanism is still
unknown. Six nights are recorded as UNMEASURABLE (fewer than 70 beats pair) rather than reported.

Retracts `CROSS-DOMAIN-METHODS` §2's premise (the 12.7 ms foot was one bad-mode night, so the fiducial
is not the dominant error term) and corrects §2.1's attribution of the template win/loss to sampling
rate — the test nights differed in MODE, and rate was confounded with it.

Constant-fraction discrimination and AIC onset picking implemented and scored: AIC is a confirmed
negative, CFD improves inter-LED IQR on 14/14 valid nights (median −13 %) but is NOT adopted, because
the metric is common-mode blind and CFD displaces the foot 107–177 ms on exactly the nights it "wins".
Records the blocker: PAT against the H10 reads 750–900 ms on this corpus (physiology is 150–400 ms), so
no reference currently exists that can tell a better foot from a worse one.
