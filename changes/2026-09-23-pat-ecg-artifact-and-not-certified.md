---
bump: patch
type: fixed
brief: none
---

PAT Feasibility no longer refuses a real night because the strap's signal went bad for part of it. Its ECG leg now drops artifact seconds by ECGDex's own rule (`beatConfidence` < 0.5) before counting R-peaks, and the simultaneity check takes each leg's beat rate over the time that leg actually measured. On 2026-09-22 an artifact burst from ~03:40 made the leg count 34 871 "R-peaks" against 18 646 PPG feet, and the night was refused as NOT SIMULTANEOUS; it now counts 18 663 (ECGDex's own figure) and reads PROMISING. Over 48 box nights, 45 verdicts are unchanged and three (2026-08-10, 08-11, 09-22) move from NOT SIMULTANEOUS to PROMISING; none got worse. A night the gate still refuses after its lag was computed is now shown with a visible NOT CERTIFIED signature and the gate's reason — in the night banner and the aggregate — instead of a bare label and "No night produced a coupled result".
