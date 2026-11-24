---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
---

- Sort an undated recording LAST in five node lists: the PulseDex and PpgDex recording switchers and
  the legacy cross-night fallback arm of PulseDex, PpgDex and ECGDex. Each sort read `t0Ms || 0`, so a
  recording with no parsed stamp took the first place and read as the oldest one. A measured stamp of 0
  is still a stamp.
