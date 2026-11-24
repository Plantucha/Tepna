---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
---

Four start stamps in the sensor-trio lane anchored a per-second grid on an or-zero `t0Ms`, so a
record whose stamp never parsed keyed its whole night on the 1970 grid. It never said that it could
not place the night.

- `sensor-trio-worker.js` `ecgHrMap`, `ppgHrMapReal` and `o2MarkerHrMap` read one pure local
  `_trioT0(rec)`, which answers the start only when it is finite. A measured start of 0 is still a
  start, so the test is finiteness and never truthiness.
- The gold H10 corner refuses only when the host axis is absent as well, because `rec.tMsAt` places
  a beat without the start stamp. It names `no t0Ms and no host axis` on its own error channel.
- The Verity corner and the ring's own-beat corner key on seconds from the recording start, so they
  have no second clock to fall back on. Each refuses the night, the first with a named reason.
- `trio-reference.js` `referenceBeatTimes` reads `_refT0(r, rec)`, which keeps the result-over-record
  precedence and answers null when neither carries a finite start. The device axis then refuses the
  night with a named reason, the way the corrected branch beside it already refuses one it cannot
  place. The old chain also read a start of 0 as no start.
- `tests/dex-tests.js` gains one group of 32 assertions. It slices both helpers out of the source and
  RUNS them (19 behaviour assertions over finite, zero, null, NaN, Infinity, a numeric string and a
  Date), and pins the four call sites.

Per the §∅ ruling an axis with no anchor is a DISCONTINUITY, which refuses, and not reduced coverage,
which annotates.
