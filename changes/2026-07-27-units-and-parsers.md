<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex, HRVDex, MotionDex]
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
Four mechanical units/parser defects. PpgDex ROUNDED a fractional second, so any fraction >= .9995 became 1000 ms and the range guard turned a valid ISO stamp into an honest-null; it now truncates like its four sibling parsers. Three of six HRVDex `_meanRR` consumers bypassed the asSecondsRR guard their neighbours use in the same loop on the same row — on a MeanRR-in-seconds vendor row the Toichi CVI KPI read 1.58 instead of 4.58 and painted a red "bad" verdict, and the NN50 estimate read 59999 instead of 60; d_cvi now computes in one declared unit and restates into its published ms×ms band so the render colour rule still holds, and d_cv_calc is deliberately untouched because the verifier proved it invariant. MotionDex defaulted an unrecognised ACC unit to milli-g; a default is not a measurement, so the parse boundary now recognises m/s², says `null` when it does not know, and cross-examines the declared unit against gravity — reporting a disagreement in `_unitSuspect` rather than silently rescaling, because replacing a declared unit with a guessed one is the fabrication this suite exists to prevent. SignalSpec declared cgm frames as mmol/L while every producer emits mg/dL, an 18.018x mis-declaration on the Data Unifier routing card.
