---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The SOLID-NIGHT timebase band and §A5 judged each device's completeness PRIMARY. For the O2Ring that is
a polled vitals CSV, so the band opened `…_SPO2.csv`, found no `sensor timestamp [ns]` column, and
reported a property of that file as a finding about the night. 2026-10-04 is the first night with LOSS,
H10 and Verity all PASS and the ring alone UNKNOWN on exactly that; 10-02 read the same and 10-01 hid it
behind the completeness FAIL. One misdirected file read was holding the first fully-solid night out of
the run: four PASSing bands plus an UNKNOWN timebase give `device_outcome` UNKNOWN, where
NOT_APPLICABLE gives PASS.

`clock` is now a spec field separate from `primary`. The timebase band and §A5 read the clock-bearing
stream, completeness keeps the primary, and a model that names no clock-bearing stream is
NOT_APPLICABLE with a reason about its exported axis — examined, and the rule does not bind, which is a
different statement from "we could not tell".

⚠️ The ring is NOT pointed at `_PPG.txt`, and that was this unit's first premise. That file's
`sensor timestamp [ns]` is the HOST's grid — `O2PpgGrid`, whose own docstring reads "the ring publishes
NO PER-SAMPLE clock, so the host lays its samples on a grid and writes that grid" — and `accraw`,
`ppg2w` and `pletha` each write the column as a literal 0 ("this opcode exposes no device clock").
Judging the host's reconstruction as a device axis could PASS it, which is worse than refusing. The
wording is about the axis and never the hardware: the ring has a crystal we discipline
(`oxyii.SET_UTC_TIME`), and `O2RING-PROTOCOL-2026-07-17` §153 says that RTC "must never stamp the
waveform".

The control is the whole point and is pinned as literal text measured against `origin/main` before the
change: both Polars' `clock` equals their `primary`, so all five of the H10's bands are byte-identical,
timebase reason string included.
