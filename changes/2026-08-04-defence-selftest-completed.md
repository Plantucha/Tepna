<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [suite]
brief: VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md
---

Complete the startup defence self-test (P1.4, out-of-suite `capture-host/`).

The self-test already existed and covered item (a) — the recovery ladder's `CAP_NET_ADMIN` — plus the
autosuspend prevention. Items (b) and (c) were not checked, which meant the two defences most likely to
be silently off were the two nothing looked at. Both were in fact disarmed on the live box.

**(b) `watchdog.usb_path` unset** disables the last rung of the ladder. A soft power-cycle does not clear
an RTL8761B firmware hang, so a wedge that survives it has no remaining fix. §P1.3 identified the
bus-port on 2026-07-24 and recovery still could not use it, because the key was never written. Warned
rather than defaulted: the id is host-specific and guessing one would rebind the wrong device.

**(c) the archive destination.** Measured 2026-08-04: no archive configured, 0 `.archived` markers across
11 nights — every night in exactly one copy, while capture ran perfectly. Also warns when a dest is set
but is not a mountpoint, using `ismount` and never `isdir`, because an unmounted mountpoint is a writable
empty directory on the boot disk and the mirror "succeeds" onto the wrong filesystem. And `enabled: true`
with no destination counts as unconfigured — the flag alone is the most reassuring possible
misconfiguration.

Absence is distinguished from disarmed throughout: called without a `cfg`, the config-derived defences
are not judged rather than reported armed, which required a distinct sentinel because `None` is a
legitimate "unset, therefore disarmed" value for `usb_path`.

7 mutants applied, 6 killed. Two needed new tests rather than the first pass: the `ismount`→`isdir`
substitution (invisible to the pure-function tests, which take the probe's result as an argument) and
`enabled: true` with no destination. The 7th is a genuine equivalent — the sentinel is truthy, so the
explicit guard and a bare falsiness test behave identically — and is recorded in the brief so nobody
re-derives it.
