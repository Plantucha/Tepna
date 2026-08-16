<!--
  VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-16 · **Supersedes:** `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md` (DONE — 2026-08-16) · **Affects:** `capture-host/`, the box's privilege model — **no code in the repo**

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

## 2 · §4's privilege decision — and it is the SAME question as `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2

The adapter-recovery ladder (`hciconfig reset` / USB rebind) is **disarmed by design**: capture runs
without `CAP_NET_ADMIN`, so the ladder exits 1 and logs a warning at every start. That is the
deliberate P1.2 position — prevention via autosuspend-off is the primary defence and capture stays
unprivileged.

The parent asked to *"grant the capability, or state that an adapter wedge on an unattended night
requires a human"*.

**These are one decision, not two.** `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2 asks the adjacent question —
whether the restart path may hold `NOPASSWD` — and reaches the same wall from the other side: a
capture user who can write `/opt/tepna` plus a granted privileged command is root in two steps. Any
answer to one constrains the other. The owner has directed (2026-08-16) that a defensible shape be
**designed and brought back for sign-off**, with nothing applied to the box in the meantime. This item
routes there rather than being decided separately.

### ⚠️ The decision now has a MEASURED cost, which it did not when the parent was written

Measured 2026-08-16 on `vigil:/srv/tepna/captures`: **the adapter fault is real and intermittent.** On
2026-08-16 the Verity stream fragmented into roughly three-minute segments from 11:06 onward, and 2 of
the last 12 capture days produced no usable long single segment at all (2026-08-08, 2026-08-12).

That is exactly the condition the disarmed ladder cannot self-heal from. The parent recorded §4 as a
policy question with no observed instance; there are now observed instances, and they cost capture
nights. **This is evidence for the decision, not a recommendation to grant the capability** — the root
hole `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2 describes is unchanged by the fault being real, and "an
unattended wedge requires a human" remains a defensible answer provided it is *stated* rather than
left implicit in a warning nobody can filter.

## 3 · What is NOT here

The parent's §1, §2, §5 and §6 are done and are not restated. `deploy/check-system-files.sh` already
detects the udev drift §5 was about. Nothing in this brief is a code change in this repository.

## Done when

- [ ] §1's walk-away re-measured outside a transfer window, with the result recorded either way.
- [ ] §2's privilege decision made — in the box privilege-model design, not here — and the outcome
      written down rather than left as a startup warning.

## Cross-references

- Parent: `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26-BRIEF.md` (DONE — 2026-08-16).
- `VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md` §2 — the same privilege question from the restart side.
- `VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md` — the P1.2 position the disarmed ladder implements.
- `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` §6 — where the 2026-08-16 fragmentation measurement is recorded.
