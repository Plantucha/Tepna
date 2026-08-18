---
bump: patch
type: changed
brief: O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05-BRIEF.md
---

**`0x05` characterised on full nights instead of a short probe — the description generalises, the rate
does not.**

§7.1 asks what `0x05` is, from a probe. The stream is captured continuously as `*_PPG2W.txt`
(`capture-host/nightqc.py:1208` names the mapping), so the corpus already held **13 files, 2.4 M rows
on the largest night**.

| property | brief (probe) | measured, 11 files |
|---|---|---|
| rate | ~153 Hz | **101.53 Hz** — median, range 101.47–101.65 |
| r(ch0, ch1) | 0.9991 | **0.9899** (10 s windows) |
| AC/DC | 0.83 % | **1.22 % / 1.00 %** (10 s windows) |
| signed | inferred | **confirmed** — ch1 reaches −35 |

**The rate discrepancy is not link loss.** 101.5 Hz holds to ±0.1 % across sessions from 146 s to
24 393 s; a lossy BLE stream would vary with link quality and session length. `~153 Hz` should be
treated as unconfirmed rather than as a property of the stream.

The confirmed signedness is directly usable for §7.5's upstream contribution — a negative sample on
real overnight data beats a probe inference.

⚠️ **Method note, recorded because the first pass got it wrong.** Over a whole night the same data
gives r = 0.79 and AC/DC = 21.6 %, which reads as a different stream entirely. Those are DC wander —
posture, perfusion, doffing — not the AC/DC ratio the term denotes. Right arithmetic, wrong statistic.
A comparison against a short probe must be windowed to the probe's timescale, or it sets a night's
drift against a probe's pulse.
