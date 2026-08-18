---
bump: patch
type: changed
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---

**§3.2's open question answered: `0x05` runs at ~101.6 Hz, not the SDK's 200 Hz — and the
discrimination the brief calls impossible IS possible from continuous capture.**

The probe saw only replies, so a constant 102-record count could not separate *"200 Hz, buffer full"*
from *"102 Hz, buffer sized to the poll"*. The stream is written continuously as `*_PPG2W.txt`, so the
timestamps **between** buffers are observable.

- **Rate:** median **101.53 Hz** over 11 files, range 101.47–101.65, across sessions of 146 s →
  24 393 s — stable to ±0.1 % over two orders of magnitude of session length.
- **The 102 buffer is confirmed, not assumed.** Over 60 000 samples the boundary delta differs from the
  interior at **period 102 and nowhere else** in 98–107 (5 ms vs 10 ms).
- **The arithmetic settles it:** 102 × 9.844 ms = **1004.1 ms**, one second per buffer. A 200 Hz stream
  truncated to 102 samples would span 510 ms and leave a **~490 ms** boundary gap. Measured gap: **5 ms**.
  No hole, so nothing is dropped, so the reply is a full second at ~101.6 Hz.

⚠️ **Reported as a HOST-derived rate.** `sensor timestamp [ns]` is still 0 — the device exposes no clock
on this opcode — so this is the rate at which samples arrive and are stamped. That equals the device
rate only if nothing is dropped, and the 5 ms boundary is the evidence that nothing is. Stated that way
it is a measurement, which is what `DEVICE-RATE-TRUTH` asks for; stated as "the device runs at
101.6 Hz" it would be a hardware claim this data cannot support.

**No code change.** `BUS.register("o2ppg2w", …, fs = 0)` was correct while the rate was unmeasured; it
is now measured, so the choice is a declared measured rate *with* its provenance or keeping 0 and citing
this note. That is a capture-host decision and is flagged, not made — a rate declared without the
host-derived caveat would reintroduce the fabrication `fs = 0` existed to prevent.
