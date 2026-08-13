---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

The fold had all the data to catch two shipped PpgDex defects and never looked. A wrong optical
polarity on 10 of 20 real nights, and a `correctRR` reference lock-in emitting a constant HR for 25
minutes, both passed FIVE green PpgDex fixtures — neither is visible inside the node, because a
polarity flip is COMMON-MODE across the three LEDs and a locked reference is SELF-CONSISTENT. Both are
obvious the moment PpgDex is placed beside the simultaneous ECG and ring.

Adds `IntegratorDSP.hrAgreement(sources)`: cross-node epoch HR adjudication, aligned on the ABSOLUTE
instant (the nodes' startEpochMs differ by up to 24 min on this corpus, so comparing epoch indices
compares different moments). It follows the GNSS integrity-monitoring boundary — redundancy DETECTS a
fault, but ISOLATING it needs one more source than detecting it:

  2 sources  -> detected on the SPREAD; `adjudicated:false`, `outlier:null`
  3+ sources -> the outlier is the source furthest from the median, and it is named

A pair is judged on spread rather than distance-from-median because with two sources the median is
their midpoint, so a 26 bpm disagreement reads as 13 and the check silently loses half its sensitivity.

`trio-batch` now runs it over the exports it just wrote and PERSISTS the verdict as
`agreement_<night>.json`. Writing it is half the point: every clock fit this tool computes is printed
and then lost with the scrollback, so nothing downstream can read, diff or gate on any of it.

Validated against the live defect: run on 2026-07-19 from a checkout WITHOUT the lock-in fix, it flags
7 of 88 epochs, names PpgDex in all 7, and its first flagged epoch is 03:33:49 — the exact epoch the
manual investigation reached after five wrong attributions.

Also fixes a coordinator HANG: `runOne` resolved only on `close`, which needs the child to have exited
AND every stdio pipe to have reached EOF. Measured: 17 nights computed, every stamp written, then 32
minutes at 0 % CPU with a DEFUNCT child. `exit` now decides, `close` still wins when it arrives first,
and `error` is handled rather than thrown.

Also wires the packet-arrival sidecar into the fold. `capture.py` writes `*_PMDARRIVAL.csv` (host
arrival beside the device counter, per BLE packet) and until now NOTHING outside `nightqc.py` read it
— trio ingested it zero times, so the one artefact that can place two devices on a single timebase
reached a QC log and stopped. It is now parsed through `DexClock.hostAxis` (Clock Contract §7 forbids
hand-rolling a rate correction) and persisted as `arrival_<night>.json`.

ABSENCE IS THE PRIMARY PATH. Most recordings have no sidecar — it is written only by the capture box,
and only since 2026-08-11, so 2 of the 49 corpus nights carry any rows. No sidecar ⇒ returns null,
prints nothing, writes nothing, fold byte-identical. Header-only files count as ABSENT: several exist
with zero rows, and without that check the feature would run on nothing and report success.

Three defects were found and fixed while building it, all the same shape — a confident number about
something never measured:
  · it collected EVERY sidecar in the capture directory, fitting one "night's clock" across 24.9 h of
    night-plus-next-day. The Verity's rate was wrong by 17x (2.5 ppm vs the scoped 44 ppm). Anchors are
    now scoped to the window the fold's own exports define.
  · header-only files were treated as data.
  · `independent` was read as "usable". It only asks whether the host column differs from the device
    column — it says nothing about whether the DEVICE column is a clock. The O2Ring's axis is DRAWN
    (sample_index x an assumed rate) so it passes at 2730 ppm where a real crystal is +/-100. Now
    flagged `plausibleCrystal:false`, and the summary counts USABLE clocks, not independent ones.
