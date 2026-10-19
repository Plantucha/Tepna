---
bump: patch
type: added
brief: RESIDUE.md
---

Commit the ECG half of a paired night, plus a fixture computed from both halves. A reproducible artifact now pins the SpO₂-plus-ECG fusion block, where before only hand-built nights did. The block mapping moves out of `oxydex-app.js` into `oxydex-fusion.js`, which is what brings it within a headless regeneration's reach.
