---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

A PpgDex posture window with too little gravity coverage was never scored. It returned a confidence of zero and a magnetometer flag of false, and the epoch export carried both. The confidence clamp reaches a real zero whenever no axis dominates, so no value test could separate the two states. The false flag is this node's own word for a clean field, asserted about a window nothing examined.

The refusal now names itself. A refused window publishes no confidence, states a reason token, and leaves its magnetometer channel null. The epoch and the export seam both carry the token, present only on a refusal, so a measured epoch keeps a byte-stable shape. A vector this node scored against every posture class and matched to none stays silent, because that is a measurement.

Two further refusals in the same path stopped claiming a clean field. A session with no magnetometer and a window holding under three samples each read null. Both now leave the interference percentage's denominator, which that figure already keys on.
