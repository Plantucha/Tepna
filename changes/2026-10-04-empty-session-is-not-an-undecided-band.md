---
bump: patch
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

A waveform file with zero data rows is an ABSENT session, not an undecided one. `validity` iterated
every waveform file in the night folder and returned UNKNOWN on the first whose RUNS sidecar carried no
`min_run=` — and a session that recorded nothing leaves a 0-line sidecar, because that header is written
at the first run. One empty file therefore dragged the whole device to UNKNOWN.

Measured live on the box 2026-10-04: the Verity connected at 15:06 on its charger, battery 100 %, never
worn, and opened a session whose `_PPG.txt` has 0 rows; `/api/state.solid` read UNKNOWN for the night on
`…_PPGRUNS.txt publishes no min_run`. With the night's real session landing in the same date folder, an
empty file costs the first PASS-capable night.

Such a file is now excluded, and the exclusion is NAMED and COUNTED rather than silently skipped
(§🧾 `checked + excluded = eligible`). A night of nothing but empty sessions stays UNKNOWN: a band that
examined nothing has not passed.

⚠️ A non-empty file whose sidecar lacks `min_run` still reads UNKNOWN — that is a real blind floor, and
the measurement is why the test matters: of 2787 mirrored waveform files only 30 are zero-row, while
2642 of the 2757 with rows also lack `min_run` from writers predating #2950. Excluding on the sidecar
instead of on the ROWS would turn that historical majority green.

Over the mirror: 11 of 70 Verity nights go UNKNOWN → PASS, 2026-10-04 among them; the other 59 are
unchanged.
