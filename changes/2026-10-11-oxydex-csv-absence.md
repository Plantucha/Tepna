---
bump: patch
type: fixed
brief: none
---

Stop the OxyDex CSV printing the literal text `null` for absent metrics and stop it inventing a 0 bpm spike rise out of `null - null`: absence is an empty field via a new `csvNum`, and the rise is computed only when both operands are present.
