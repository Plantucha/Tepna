---
bump: patch
type: fixed
brief: O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05-BRIEF.md
---

**The 0x05 raw stream was silently losing ~15–20 % of its samples — every buffer pinned at the reply
cap; the runner now drains it twice per cycle.**

Owner hypothesis "0x05 is 100 Hz" tested against the whole corpus: 282,402 of 284,420 buffers across 39
real `_PPG2W.txt` files are EXACTLY 102 records — the reply cap — at the daemon's ~1 Hz drain. So the
delivered ~100 Hz is `cap × poll rate` (a drain artifact); the fill rate is **> 102 Hz** (100 Hz
refuted), consistent with the settled 125.000 ADC prediction though pinned only by the deployed
starvation probe (field-gated on the ring being worn). Recorded as FOLLOWUPS §2.1a.

Fix: `run_oxyii` asks for the raw buffer a second time mid-cycle (~0.5 s drains) when `ppg2w` is
captured — buffers stay under the cap, so capture is COMPLETE and every night's unsaturated counts
measure the true fill rate for free. Vitals cadence unchanged; without the stream the loop sleeps
exactly as before. Gated: two raw asks per cycle with the stream, zero without (plus the existing
ppg2w e2e test unchanged).
