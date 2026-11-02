---
bump: patch
type: fixed
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---

Append an `anchor_epoch` column to the radio-clock sidecar, counting every LE link establishment the
collector saw, so a consumer cuts the anchor axis at a re-establishment rather than interpolating a
correction across the gap one leaves behind.
