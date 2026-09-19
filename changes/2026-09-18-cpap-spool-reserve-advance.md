---
bump: patch
type: fixed
brief: CPAP-ACQ-P4-SPOOL-TRANSACTION-2026-08-23-BRIEF.md
---

The CPAP spool loop treated an already-committed round as "no new data" and dropped the device's
MORE pointer, parking a live box for 17 days while every pull logged success.

## The mechanism

A `NO_MORE_DATA` row commits its **own input** as `committed_cursor` — brief §3 is explicit that the
field is "the fromDateTime to pull NEXT", and for a terminal round there is nothing to advance to.
So every later pass necessarily re-asks the committed address. That is the intended steady state, and
the dedupe on `(cursor_in, sha256)` exists to keep it from leaking duplicate lines.

What nobody had considered is what the device does at that address **once the spool has grown**: it
re-serves the committed round byte-identically *and* raises `SPOOL_COMPLETE_MORE_DATA_PENDING` with a
new `nextSpoolAddress`. The dedupe test was evaluated **before** the `more` flag was consulted, so the
pointer was discarded and the pass stopped `no-new-data`.

Measured on the box: the ledger's two lines both carry `committed_cursor: 2026-08-16T16:00:00.000Z`
with **mtime 2026-09-01 10:00:44**, untouched through **22 subsequent pulls that committed zero
rounds** — each logging `cursor now 2026-09-01T16:00:00.000Z`, a value only reachable when `more` was
true. The device was naming the way forward on every single pull and the loop threw it away.

**An absence wearing the shape of a completed pull** — §∅ at the pull layer, and the reason it went
17 days unnoticed rather than 17 minutes.

## The fix, and why advancing is safe

The loop now **skips** an already-committed round and follows the device's pointer instead of
stopping. It still never re-promotes those bytes and never writes a second line for them.

The safety property is the two-cursor distinction the residue row collapsed, and it is what makes
this sound rather than the "cursor advances across an unretrieved span" hazard it superficially
resembles:

- the **committed** cursor — the restart authority — advances **only** via `append_ledger`, which
  runs only after a round was actually retrieved and promoted;
- a skip moves the **in-loop** cursor only.

So the committed cursor still cannot cross a span that was not retrieved. A pass that dies
mid-skip resumes from the unchanged ledger cursor and simply re-skips — today's behaviour, which
retrieves nothing but loses nothing.

`next_from != cursor` is load-bearing and is **not** incidental to the condition: the change removes a
termination condition, leaving `max_rounds` as the only bound, so a device that re-serves a round
while pointing at the *same* address must still stop rather than spin 64 laps writing parts.

## Tests

Two added, and both were **verified to fail on the unfixed module before the fix was restored**
(`no-new-data` where `no-more-data`/`transport` was wanted):

- the field defect — a re-served round carrying MORE advances, pulls `[T0, T2]`, commits the grown
  round, moves the ledger to `T2`, and adds **no** duplicate line or second copy of the bytes;
- the safety property — a pass that skips and then loses the link leaves `last_committed_cursor` at
  `T0`, with the ledger and the committed store unchanged.

The two "must still stop" guards were **already in the suite** and still pass unchanged:
`test_repolling_a_no_more_cursor_is_a_noop_not_a_leak` (re-serve + `NO_MORE`) and
`test_in_pass_dedupe_stops_a_device_looping_on_one_cursor` (re-serve + `MORE` at the same address).
37 assertions green in the file.

## The log line that hid it

`capture.py` reported `summary["cursor"]` as **"cursor now"**, and that phrasing is why the stall was
filed as a *cursor over-advance* rather than a stall: the field is the address the loop last **asked
for**, not persisted state. It now reads **"in-pass cursor"**, with the ledger named as the restart
authority. No consumer branches on `stopped`, so the string change is inert to behaviour.
