<!--
  CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-II-2026-08-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-05 · **Follows:** `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md`

# What closing the follow-ups surfaced — a live sudo fault, a noisy teardown, and one behaviour change

`CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26` is DONE. Three of its four open items were answered by
measurement rather than reading, and two of those answers were **not** what the brief expected. This
records the residue.

## 1 · The live `cpap.state: "error"` was a HOST fault, not ours — and the guess was wrong

The parent said *"§E5 and §C5 are both plausible causes and both are now fixed"* and told the executor
to pull the detail before assuming either covered it. Correct instinct: it was **neither**.

The journal (2026-07-26, still retained) shows every privileged helper failing at once:

```
WARNING cpap: sudo -n ip link          -> rc=101  thread 'main' panicked at src/system/audit.rs:80:14
WARNING cpap: sudo -n wpa_supplicant -B -> rc=101  ... panicked
WARNING cpap: sudo -n wpa_cli -i        -> rc=255  ... error: Read-only file system
```

`rc=101` with a Rust panic in `src/system/audit.rs` is **sudo-rs crashing**, not a permission refusal —
compounded by a read-only filesystem in the same window. The fault was entirely outside `capture-host`,
which is why two correct fixes could not have touched it.

**Worth keeping as a pattern, not just an incident.** A privileged-helper failure was attributed to the
two most recently changed code paths because those were salient. The journal answered in one query what
two plausible hypotheses could not. `rc=101` is also *distinguishable* from a permissions problem
(`rc=1`) and from a missing binary (`rc=127`) — the daemon logs the code, and nothing reads it.

**Open:** should `cpap` classify helper failures by return code — `101` (helper crashed) is an
operational fault of a different kind from `1` (refused) or `255` (target missing), and only the first
means "the box's sudo is broken, stop trying"?

## 2 · The wpa teardown fails on EVERY cycle, right now, and says so quietly

Measured 2026-08-05 on the live box, repeating (20:07, 20:59, 21:00, …):

```
WARNING cpap: sudo -n wpa_cli -p -> rc=255 Failed to connect to non-global ctrl_ifname: wlp1s0
              error: No such file or directory
WARNING cpap: wpa_cli terminate failed on wlp1s0 (rc=255, …) — a supplicant may be left running
```

Confirmed on the box: `wlp1s0` **does** exist, and the only `wpa_supplicant` running is the system
D-Bus one (`-u -s -O DIR=/run/wpa_supplicant`). So **nothing is leaked** — the control socket
`/run/wpa_supplicant/wlp1s0` simply does not exist because that supplicant is not managing the
interface per-socket. The teardown is a no-op that reports failure twice per cycle, forever.

That also settles a question the parent listed as unexamined scope — *"which interface is actually
`wlp1s0`"*: it is a real, present wireless interface on the box.

**CLOSED 2026-08-05 — by verifying, not by matching the message.** Message-matching was the tempting
option and the unsafe one: the 2026-07-29 leak ALSO returned `rc=255`, and there is no way to know from
the text alone whether a supplicant survived. `_wpa_down` now reads `/proc` and asks whether one is
actually bound to `-i <iface>`:

* one is ⇒ `WARNING … supplicant STILL RUNNING as pid(s) N` (louder than before — it names the pid)
* none is ⇒ `INFO … nothing to terminate`
* either way the rc still reaches the caller, so the failure is never swallowed

Two things the implementation had to get right. The **system** supplicant is always running on this box
(`-u -s -O DIR=…`, D-Bus, no `-i`), so "is any wpa_supplicant alive?" answers yes forever — the `-i`
ARGUMENT is the discriminator, matched as an argument and never as a substring. And the scan reads
`/proc` directly rather than via `pgrep -f`, whose pattern would contain both "wpa_supplicant" and the
interface name and could match its own command line (CLAUDE.md §4).

When `/proc` cannot be read the check claims NOTHING and takes the quiet arm: a false "no leak" costs a
journal line, a false "LEAK, pid N" sends someone hunting a process that never existed and teaches them
to distrust the warning — the exact outcome this item exists to undo.

## 3 · A backward wall-clock step no longer rewinds an open recording (BEHAVIOUR CHANGE)

Decided and implemented while closing §3. Reproduced first: a −30 s NTP step with a capture file open
sent `_now()` from `22:00:10` to `21:59:50` — the Phone column of a file being written rewound 20 s,
breaking the strictly-increasing guarantee every parser depends on.

The rule was already in the file one branch up: the DST arm absorbs a relabelling *"ONLY to protect an
open recording … there is no file to rewind."* A backward step has the identical consequence by a
different mechanism, so it now takes the identical treatment. The asymmetry is deliberate and pinned by
three tests:

| | writer open | no writer |
|---|---|---|
| backward step | **absorbed** (monotonic; absolute time off by the step until the session ends) | followed |
| forward step | followed | followed |

**CLOSED 2026-08-05.** `capture.absorbed_shift_sec()` reports how far the session is deliberately
behind civil time, and `host_clock_poller` publishes it as `host_clock.capture_absorbed_sec` — the
surface `/api/state` already serves verbatim. Zero is the steady state, so absent-as-zero is honest.

Two of its own mutants had to be closed, and both were the silent trade in miniature: **deleting the
line that publishes the value survived** every test of the accessor (the number was right and went
nowhere), and **rounding the report to whole seconds** survived until a fractional step was pinned — a
sub-second absorbed shift would otherwise report as no shift at all.

**Still open:** the EXPORT boundary. `status.json` tells an operator; it does not tell a downstream
consumer aligning this night against another device, which is where the offset actually matters.
`ganglior.node-export` carrying it is a contract question, not a plumbing one.

## 4 · Still carried forward, untouched

From the parent's §3, none of it examined here: the ~15 remaining swallowed `except` sites in
`capture.py`; the frame-decoder differential (`polar_pmd` vs `oxyii` vs `viatom`); `pull_session.py`'s
partial-download path (noticed, not reproduced, and the same defect §C5 fixed one module over);
`monitor.html`'s client-side escaping; `PPG_INVALID` downstream. The browser lane remains unverified,
not passing.

## Done when

* §1's return-code classification decided (or declined with a reason).
* §2's teardown either stays silent when there is no socket, or verifies before claiming a leak.
* §3's absorbed offset is surfaced somewhere an operator or a consumer can see it, or it is stated why
  it need not be.
