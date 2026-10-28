---
bump: minor
type: fixed
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

The ring's signal witness now reads its counter by header name, and after a stall it reads the settled
row. `signal_witness` took the counter from `parts[1]`. The same module states the opposite rule: read
`duration_s` by header name. The frame header has already grown past its first ten columns. A positional
read is right today and wrong at the next insertion. The witness now goes through `oxyframe_samples`,
which reads the named cell.

The second half is the reading itself. The ring answers one poll with at most 250 records, which is 2.0 s
of signal. So the first reply after a stall carries that cap, whatever the ring kept producing. On night
2026-10-12 the 00:48 gap advanced 1 on that reply and 15 one row later. The witness now takes the highest
count within `RING_WITNESS_SETTLE_S` of the first row back. It then subtracts the wall seconds its two
readings sit outside the gap.

An honest reading forces the bucket question. A span the ring produced and we do not hold is still loss.
It carries the name `undelivered` beside demonstrable `silence` in `lost_min`. This reverses the `delay`
bucket of #3168, which read the same advance as a delivery loss and left the judged number. The
attribution that bucket carried survives in `by_cause`.

No reported gap could have been a late delivery anyway. The cadence cut's floor equals the replay
ceiling, and a new tripwire test holds those two numbers against each other.

Measured read-only on vigil 2026-10-28: 14 of 70 stored audits carry 51 such gaps. They total 770 s, so
12.8 min of real holes return to loss.
