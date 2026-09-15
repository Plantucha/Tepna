---
bump: patch
type: changed
brief: EEGDEX-BUILD-BRIEF.md
---

`eegdex-dsp.js`: records that EOG conjugacy was tried as a REM feature and is deliberately not used.

The signal is real — REM epochs are anti-correlated between the left and right EOG 30–100× more often
than NREM (share below −0.2: REM 23.7 %, Wake 7.1 %, N1 6.3 %, N2 0.4 %, N3 0.2 %) — but it is
specific, not sensitive, seeing under a quarter of REM.

Both wirings measured on identical records: as a requirement it took REM recall 20.2 % → 6.7 %
(κ −0.010); as an additional sufficient path it changed nothing (REM 20.2 % → 20.2 %, κ −0.0005),
because the existing amplitude arm already fires on everything it catches.

Code-inert: the finding is a comment, so nobody re-derives it.
