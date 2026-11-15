---
bump: patch
type: fixed
brief: none
---

Refuse an OxyDex stability score over a night that measured nothing, and null the oscillation counts when the SpO2 channel never reported. Guard every stability subscore on its own field.
