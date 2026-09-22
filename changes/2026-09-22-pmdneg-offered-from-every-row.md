---
bump: patch
type: fixed
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---

nightqc.pmd_negotiations reads the device's rate menu from every PMDNEG row rather than from started ones only: a device that refuses every START still reported the menu it named, and reporting null there put an absence where sixty-three measurements existed.
