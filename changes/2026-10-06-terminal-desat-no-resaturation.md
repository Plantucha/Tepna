---
bump: patch
type: fixed
brief: none
---

A desaturation still open when the recording ends observed no resaturation, so its recSlope is null with the reason record-ended instead of 0, and meanRecSlope averages the measured recoveries with meanRecSlopeN beside it. A flat terminal desat used to publish recSlope 0 — a recovery nobody watched — and one such event dragged a true 0.35 mean to 0.175.
