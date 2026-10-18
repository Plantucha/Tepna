---
bump: patch
type: fixed
brief: none
---

ECGDex: RRacc is now the 30-s FFT peak refined between bins by a log-power parabola. The bare bin held RRacc to 1.875 br/min steps. That drew diagonal lines of slope −2 on the RRacc − EDR Bland–Altman plot, because x and y share EDR. The SNR gate still reads the bin powers, so the high and low confidence split does not change.

The RRacc vs EDR card also draws both rates across the night, per 5-min epoch. Each series carries a badge. A gap is an epoch with no value.
