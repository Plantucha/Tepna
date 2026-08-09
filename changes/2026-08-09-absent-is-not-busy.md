<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
An absent sensor held the global connect lock 59% of the time — absent is not busy.

`auto_sync_clock`'s 12-attempt ladder retries on anything `transient_ble_error` accepts, and that list
carries `devicenotfound` and `not advertising` alongside `inprogress`. Every attempt runs through
`polar_offline_op`, which holds the GLOBAL `_CONNECT_LOCK` for up to `_CLOCK_SYNC_TIMEOUT_S`, so a strap
sitting on a desk blocks every OTHER sensor's reconnect for most of every minute.

Measured on the live box with an H10 off-body: 51 completed ops in 59.1 min, mean hold 41.1 s, 2097 s of
3544 s — a **59% duty cycle**.

This is the third time this shape has been fixed here and the first two both attacked the timeout. On
2026-07-19 an out-of-range device wedged capture for 58 minutes, which produced `_OFFLINE_OP_TIMEOUT_S`;
the same day, 12 retries x 300 s produced a 97%-duty-cycle wedge, which produced
`_CLOCK_SYNC_TIMEOUT_S = 45` and the note "bounding the op was necessary but not sufficient; the bound
has to be proportionate". Proportionality lowered the constant — 97% to 59% — and left the loop, because
the loop is not a timeout problem. It is a retry-decision problem.

The two signals need telling apart. CONTENTION (InProgress / not-ready / busy) means the device is there
and something else holds its one link; waiting is exactly right, and that is the case the ladder was
built for. ABSENCE (DeviceNotFound / not advertising) means the scan did not see it; no amount of waiting
helps and the wait is not free. Retrying absence is also redundant, which is what makes dropping it safe:
`clock_sync_due` re-syncs on every reconnect, and a reconnect only happens when the device IS reachable,
so the reconnect loop was already the retry mechanism for absence — the ladder duplicated it and paid a
global lock to do it.

`device_absent_error` is deliberately narrower than `transient_ble_error` and does not replace it: a bare
`TimeoutError` stays "busy", because a connect can time out against a device that is present but
contended. Absence is asserted to be a strict SUBSET of transient, structurally over the token lists
rather than by example — the reconnect loop must keep chasing a sensor that merely walked out of range,
and a token that were absent-but-not-transient would make it surrender. The first draft of this change
widened absence past transient with spaced variants; the subset test caught it.

Four mutants re-applied, each killed by the intended test: the short-circuit removed, absence retrying
instead of returning, absence widened beyond transient, and absence swallowing InProgress.
