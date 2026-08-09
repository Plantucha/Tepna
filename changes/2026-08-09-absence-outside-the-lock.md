<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: CONNECT-LOCK-DUTY-CYCLE-2026-08-09-BRIEF.md
---
Stop holding the global connect lock while discovering a device is absent.

#1062 stopped the clock-sync ladder spending 12 attempts on an absent device and it works — the journal
shows `deferred — device not found (attempt 1)`. But the deferral lands after the expensive part:

    07:09:45  live capture paused     <- _CONNECT_LOCK taken
    07:10:27  offline op finished     <- 42 s of doomed connect
    07:10:27  auto-sync deferred      <- absence detected, too late to matter

One such connect per reconnect cycle (~70-110 s) is a 53% duty cycle on its own, which is what the box
still measured after #1062 and #1081. Absence is cheap to detect — it is a scan — and was being paid for
at connect-timeout prices under a lock that excludes every other device from reconnecting.

`polar_offline_op` now takes an opt-in `presence_check_s`. When set, it scans for the address BEFORE the
offline slot, `_POLAR_PAUSED` and `_CONNECT_LOCK`; a definitive "nothing on the air" raises
`DeviceNotAdvertising` and nothing exclusive is ever taken. The 45 s under lock becomes a 6 s scan under
none.

Three safety properties, each tested. It is OPT-IN — only the automatic clock sync passes it, because a
person who clicked a pull has information a 6 s sample does not. `None` is not `False` — `_device_on_air`
returns None when it cannot ask (scan error, busy adapter, bleak absent) and the caller then does exactly
what it did before, since collapsing that to False would let one scan outage silently stop every clock
sync on the box. And a device STATUS already reports as connected is never scanned for, because a
connected device does not advertise and scanning would "prove" absence about the one case that is
certainly present.

The raised message contains "not advertising" deliberately, so it flows through the existing
`device_absent_error` / `transient_ble_error` predicates; a bespoke class no predicate recognised would
have been a third way to be wrong about a string.

Three `polar_offline_op` fakes in the tests gained `**_kw` — a fake that pins the real signature breaks
the moment a keyword is added, which is what happened here.

The brief records the whole arc, including that fixes 1 and 2 bounded ONE OP, fix 3 bounded the LADDER,
and none of them bounded the LOCK — the cost was never duration or retry count but what was HELD while
waiting. It also records six process errors that were not cheap to make.

⚠️ The acceptance measurement is still owed: re-measure the duty cycle with an absent H10 post-deploy.
