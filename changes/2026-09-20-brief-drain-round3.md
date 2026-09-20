---
bump: patch
type: changed
brief: none
---

Round-3 drain. **Three of the four assigned briefs were already DONE** — the assignment selected by
stamp date, not by open status — so this PR touches one brief.

## The premise check answered three of four in one command

| brief | status on `main` |
|---|---|
| `AGENT-NEUTRAL-GUARDS-2026-08-15` | **DONE — 2026-08-16** |
| `VIGIL-COEXISTENCE-AND-RANGE-2026-07-26` | **DONE — 2026-08-16** |
| `CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04` | **DONE — 2026-08-26** |
| `VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16` | PROPOSED |

The dates that made them look stale are their **stamp** dates. ⚠️ And `AGENT-NEUTRAL-GUARDS`'s own
header records this exact trap for itself: *"This brief read PROPOSED with four open boxes while fully
executed, and its §4 invited a rebuild of a workflow that had shipped two months earlier — the
stale-PROPOSED trap this repo keeps paying for."* It is no longer stale-PROPOSED; selecting on date
re-surfaced it anyway.

**No edits to the three.** A DONE brief does not need draining, and re-stamping one to record that I
looked would add noise to a file that is already correct.

## The fourth: "no code in the repo" is wrong about where the answer lands

`VIGIL-COEXISTENCE-FOLLOWUPS` is correctly parked — §1's open item is a physical range re-measurement
and no code can answer it. But its `Affects:` line reads **"no code in the repo"**, and the brief names
`scan_coexistence_verified` **zero times** while that key exists and is load-bearing:

- **`oxy_presence.COEXISTENCE_KEY`** is held *separate from* `enabled` deliberately — *"an operator
  enabling the feature must not thereby assert a hardware measurement they did not run … the operator
  owns intent, the matrix owns permission."*
- **`capture.py:_presence_scan_loop` refuses to start without it** — *"the coexistence matrix has NOT
  been run. So the code ships and the radio stays cold. Do not arm this from a code change; it is armed
  by a measurement."*

**So the state is "unmeasured, deliberately", not "unknown"** — and the difference is operational, not
semantic: the verdict has a **named home**, so running the matrix is a config flip rather than a build;
and the observer is already **fail-closed**, so nothing is silently scanning while the question is open.

The original phrase is kept rather than replaced: it is true of the *measurement* and was the right call
for §1. It is wrong only about where the answer lands, and the correction says which.

## Not claimed

I did not re-open the three DONE briefs to hunt for residue, and I did not verify their done-when items
— a DONE stamp is another session's verified state and re-deriving it is the cycle the stamp exists to
prevent. **The limit: I checked their status line, nothing beneath it.**
