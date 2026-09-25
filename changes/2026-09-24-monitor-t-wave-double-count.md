<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The monitor's live ECG heart rate no longer counts a tall T wave as a second beat. On 2026-09-24 the owner's H10
T wave sat at 38–46 % of R, cleared the detector's 35 %-of-median cut, and the tile read 167 bpm against 53–55
on the H10's own HR and 56–57 on two other sensors. A candidate inside 450 ms of an R-sized candidate and under
0.6× of it is now that R's T wave. An electrode spike (4–6.5× R after the bandpass) is never taken as the R, so
a spike cannot delete the beat after it. Measured against the H10's own HR over 7 s windows (share within 3 bpm,
before → after): 0 % → 97 % on the live night, 71 % → 84 % and 58 % → 70 % on 2026-09-23 and 09-22, with
windows reading ≥ 1.6× the true rate 58/52/106 → 0/4/2. The recording and every stored file were never
affected; only the page's live number and beat panel were.
