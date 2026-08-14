---
bump: patch
type: fixed
---

`clock_uncorrectable` now reaches the monitor. It was set, retracted, and pinned by seven tests, and
read by nothing.

`capture.py:3757` publishes it when the clock watchdog exhausts its give-up budget; `:1360` retracts it
on the next successful sync — `_CLOCK_FRESHLY_SYNCED` exists solely to carry that retraction between
tasks. No consumer read it: not `webmon`, not `alerts`, not `nightqc`, not `monitor.html`. For a suite
whose entire Clock Contract rests on device time being trustworthy, a night captured under a clock the
daemon had written off was, downstream, indistinguishable from a good one.

The comment beside `worn_why` in the same projection already names this failure exactly, one field over:
*a field that exists in STATUS but is not forwarded here is NOT published — the same class as a DSP value
that never reaches its export, and it fails silently in both directions.*

**⚠️ The verdict does NOT override a measurement, and that restraint is the whole design.** A clock the
daemon could not *write* may still be *right*. `clockStatus` already establishes that a measured
agreement outranks "we set it hours ago" — a comment added after reporting "unverified" while holding a
0.03 s measurement told the operator to worry about a clock that was fine. So the new pill fires only
when nothing measured contradicts it:

| device state | pill |
|---|---|
| uncorrectable, no `device_time` (the ring) | `clock uncorrectable` |
| uncorrectable, no skew measurement | `clock uncorrectable` |
| uncorrectable **but measured 0.03 s** | `clock ok` — the measurement wins |
| clean and synced | `clock set` |

The give-up fact still appears in the chip's tooltip in every case, so it is never simply discarded.

Three assertions cover the forwarding, including that a device which never reported gets `None` rather
than a fabricated `False` — absent is not the same as "correctable". Removing the forwarding line reds
five tests. The pill logic was driven directly against all four states above rather than reasoned about.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §1.
