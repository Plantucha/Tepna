---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
PAT forensics §11/§13: an OUT-OF-SAMPLE window oracle. The mode is estimated on each night's first
half and scored on the second, so a narrow SD is earned rather than fitted — the obvious version of
this experiment would recover a lag from pure noise. Every night must also beat its own
circular-shift null. Result over 42 nights (20 scored): the out-of-sample window beats the shipped
[200,650] by a median 30.5 ms of SD, 8 of 20 nights show a null-beating improvement, 2 land under
20 ms, and 4 nights place their lag mode OUTSIDE [200,650] entirely — so the window is
mis-specified, not merely wide. The 7 marginal nights sit at 200/sqrt12 = 57.7 ms, the uniform-fill
bound of the new window: window-fill reproducing one level down. New tool
`tools/pat-window-oracle.mjs` (--selftest 8/8 including a pure-noise control). No recommendation
drawn: §20 forbids optimising pass rate.
