<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: none
---
Gate the ODI-3 threshold family (odi3, hypoxicLoad, pRED3p, dip3Rate, ahiKulkas) on the artifact self-gate so it excludes the same probe-squeeze/finger-off artifacts ODI-4 already drops; withhold the Sleep Pressure Index (null) when WASO/SOL are tri-state-null instead of fabricating 0 (which inverted the score on undetected-onset nights); and retier hypoxicBurden from a false validated/Azarbarzin badge to experimental (it is the internal fixed-94% AUC, sibling of hd94 — Azarbarzin's method is Hypoxic Load).
