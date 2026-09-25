<!--
  VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-09-25 (**TRIAGED 2026-09-25 (Wren, box + tree; rule 0: "vigil coexistence wifi bluetooth interference followups")**: the owner-ruled SEQUENCE below is stuck at its SECOND step, on the box. Step 1 is done (`or_patterns` is on main, #2711, 7db4bf20). Step 2 is NOT: the authorized `--experimental` bluetoothd drop-in is still not applied. No `/etc/systemd/system/bluetooth.service.d/` exists, and `bluetoothd` (BlueZ 5.85) runs with no flags. The daemon says so itself: `passive BLE scan unsupported here [experimental]` was logged 13× on 2026-09-20, 22× on 09-22 and 22× on 09-24 (first seen 2026-08-22), so every presence scan runs ACTIVE and a §1 matrix run now would measure exactly what the ruling said not to. `scan_coexistence_verified` is ABSENT from the box config, so the presence scan is correctly unarmed. **Next action is the owner's: apply the drop-in (root, box), restart bluetooth.** Then §1 runs and writes that key. Nothing else is schedulable. · EARLIER: OWNER RULED 2026-09-20: run the coexistence matrix only AFTER `or_patterns` lands, because as coded the observer would measure ACTIVE scanning and the verdict would not transfer to the passive design. `or_patterns` landed in #2711; the `--experimental` bluetoothd drop-in is authorized and pending on the box. Then §1 runs. Not a decision any more — a sequence) · **Created:** 2026-08-16 (⚠️ **§2 RETRACTED the same day it shipped** — it claimed the adapter-recovery ladder is disarmed; the capability was already granted and the ladder is running. Only §1's field re-measurement is genuinely open here.) · **Supersedes:** `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md` (DONE — 2026-08-16) · **Affects:** `capture-host/`, the box's privilege model — **no code in the repo** ⚠️ **CORRECTED 2026-09-20 (Heron): there IS code, and it is the SLOT THIS BRIEF'S ANSWER GOES INTO.** `oxy_presence.COEXISTENCE_KEY = "scan_coexistence_verified"` is a config key held **separate from `enabled` on purpose** — its own comment: *"an operator enabling the feature must not thereby assert a hardware measurement they did not run … the operator owns intent, the matrix owns permission."* And `capture.py:_presence_scan_loop` refuses to start without it, saying so in the clear: *"the coexistence matrix has NOT been run. So the code ships and the radio stays cold. Do not arm this from a code change; it is armed by a measurement."* ⚠️ **So the state is "UNMEASURED, DELIBERATELY", not "unknown", and those are different.** The distinction matters to a picker-up in two ways: the verdict has a named home, so running the matrix is a config flip and not a build; and the observer is already fail-closed, so nothing is silently scanning while the question is open. What remains genuinely open is unchanged — §1's physical range re-measurement, which no code can answer. The phrase "no code in the repo" is kept above because it is true of the MEASUREMENT and was the right call for §1; it is wrong about where the answer lands

# What outlives VIGIL-COEXISTENCE — two items, neither of them code

The parent brief is closed: §1, §2 and §5 are executed and verified on the box, §6 is a record, and it
had carried **NO CODE WORK REMAINS** in its own banner since 2026-08-04. It stayed open because two
items could not be finished at a keyboard. Those are here, so a finished code brief stops reading as
open work.

## 1 · §3's field re-measurement — a walk-away outside a transfer window

**What it needs:** repeat the out-of-range walk-away, deliberately **not** during a WiFi bulk-transfer
window, and record whether re-acquisition happens without intervention.

**Why it is not code:** the parent measured that out-of-range *recovery* works and that
**re-acquisition** is the weak half. Distinguishing "recovery failed" from "recovery was never needed"
requires a controlled physical walk-away; nothing in the repo can produce one.

**Do not repeat the parent's confound:** the original observation coincided with a transfer window, and
§2 established that WiFi bulk transfer and BLE capture cannot share one. A re-measurement inside a
window would reproduce the confound rather than test the question.

## 2 · ~~§4's privilege decision~~ — 🔴 **RETRACTED 2026-08-16: it was already granted, and the ladder is running**

> **This section was WRONG when it shipped, hours after being written, and the error is the one this
> repo keeps paying for.** It asserted that capture runs without `CAP_NET_ADMIN` and that the
> recovery ladder is disarmed — taken from the parent brief's premise rather than from the box.
> Checked on the box the same afternoon:
>
> ```
> tepna-capture.service:  AmbientCapabilities=CAP_NET_ADMIN
> live process:           CapPrm/CapEff/CapAmb = 0000000000001000   ← bit 12 = CAP_NET_ADMIN
> journal, last 3 days:   "has no CAP_NET_ADMIN" warnings = 0
> watchdog, 13th/15th/16th: "clean poll 1/2 — holding the wedge count at 1 until recovery"
> ```
>
> **The capability is granted, the startup warning no longer fires, and the watchdog is actively
> managing wedges** — including at 14:45 on 2026-08-16. §4's decision was made and shipped before this
> brief claimed it was open.
>
> ⚠️ **And the "measured cost" argument this section made was doubly wrong.** It cited today's Verity
> fragmentation as the cost of a *disarmed* ladder. The ladder is not disarmed; the fragmentation
> happens **with** recovery armed and running. So the fragmentation is evidence about the adapter or
> the link — not evidence for a privilege grant that already exists. Attaching a real measurement to a
> stale premise made it look like corroboration.

**What is genuinely still open is the OTHER half, and it is a different question.**
`VIGIL-AUTO-UPDATE-FOLLOWUPS` §2 asks whether the **update/restart** path may hold `NOPASSWD` — root
*code execution*, not a network capability — and its root hole stands: a capture user who can write
`/opt/tepna` plus one granted privileged command is root in two steps. The owner has directed
(2026-08-16) that a defensible shape be designed and brought back for sign-off, with nothing applied to
the box meanwhile. **That work is unaffected by this retraction**; only the adapter half is closed.

### The two in-repo precedents that design should follow

Found while checking this, and worth naming because they mean the shape is not novel:

- **`capture-host/link_rssi.py`** — a privileged action via `AmbientCapabilities` on the unit, inherited
  through exec, with a sudo fallback only for the dev workstation. On the appliance
  `NoNewPrivileges=true` forbids setuid sudo outright, so ambient caps are the *only* path that works.
- **`capture-host/webmon.py`** — the companion rule, stated in its own comment: the USB port for a
  rebind comes from **server config, never the request body**, because *"an argument the caller chooses
  is still an argument the caller chooses"*. The privileged surface takes no caller-controlled input.

Together those are the shape `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2 sketches — root-owned, fixed-surface,
allowlisted — already working in this codebase rather than proposed.

## 3 · What is NOT here

The parent's §1, §2, §5 and §6 are done and are not restated. `deploy/check-system-files.sh` already
detects the udev drift §5 was about. Nothing in this brief is a code change in this repository.

## Done when

- [ ] §1's walk-away re-measured outside a transfer window, with the result recorded either way.
- [x] **§2 CLOSED 2026-08-16 — the adapter half was already granted.** `AmbientCapabilities=CAP_NET_ADMIN`
      is on `tepna-capture.service`, the live process carries it (`CapEff` bit 12), the startup warning
      has not fired in 3 days, and the watchdog is actively managing wedges. The **update/restart**
      privilege question is separate and remains open in `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2.

## Cross-references

- Parent: `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md` (DONE — 2026-08-16).
- `VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md` §2 — the same privilege question from the restart side.
- `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` — the P1.2 position, which has since been superseded on the box: the capability was granted and the ladder armed.
- `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` §6 — where the 2026-08-16 fragmentation measurement is recorded.
