---
bump: patch
type: fixed
brief: none
---

A body weight or height of 0 is no longer a measurement. The profile layer in OxyDex, ECGDex, PpgDex and the shared `dex-profile.js` gave BMI, BSA, the ideal body weight and the BMR from a 0 input. BMI read `Infinity`, and the other terms published a number.

Each of these values is now `null` when its weight or height is absent, 0 or not finite. The BMR formula label reads `needs weight & height`, and the panels show `— needs weight & height`. Shrike found the sites in task 31, and Kestrel verified them on `origin/main`. The treatment-response yield pin was re-cut at paper scale and came back on the same counts.
