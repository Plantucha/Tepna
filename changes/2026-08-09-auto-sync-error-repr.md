<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The auto-sync retry line logged the exception CLASS and threw the message away.

`BleakError` is bleak's catch-all for a dozen unrelated conditions — `device '<path>' not found`,
`failed to connect: <cause>`, `br-connection-canceled`, adapter-missing — which need completely
different responses. The retry line printed only `type(e).__name__`, so the journal said
`busy (BleakError)` and could not say which.

That gap has a cost, and it is already paid. Measured on the box 2026-08-09: the daemon logged
`busy (BleakError) — retry 1/12` while #1062's `device_absent_error` scored ZERO hits over the same
window. #1062 was aimed at bleak's `device '<path>' not found` string — a reading taken from bleak's
source rather than from the box, because the box could not be asked — and it does not fire. The fix is
sound in principle and mutant-tested; it is simply pointed at a string this failure does not produce.

So this is not cosmetic logging. It is the precondition for aiming the previous change: with the repr in
the journal, the next absent-H10 period says exactly which BleakError to match, instead of inviting a
third guess.

`repr()` rather than `str()` — the class name is the part worth keeping and `str()` on a bare BleakError
can be empty. Truncated to 160 chars because a D-Bus error can carry a long payload and this line runs up
to 12 times per ladder.

Both log lines are now pinned by tests, mutant-verified: reverting to class-only, swapping repr for str,
and stripping the reason off the sibling "deferred" line each fail.
