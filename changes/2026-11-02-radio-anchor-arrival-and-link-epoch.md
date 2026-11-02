---
bump: patch
type: fixed
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---

Fill the radio-clock sidecar's `vs_rx_ns` column from the arrival of the anchor each row associated
with, and append a `link_epoch` column naming every link establishment the collector saw, so a
consumer cuts the axis at a re-establishment rather than interpolating a correction across it.
