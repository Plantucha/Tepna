<!--
  QC-SCOPE-RESOLUTION-2026-07-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-28 · **Created:** 2026-07-28 · **Sibling:** `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS-2026-07-26-BRIEF.md`

# QC judged the wrong folder — every night that crossed midnight

> **The incident.** On the morning of 2026-07-28 the capture box's QC reported **nine missing streams**
> across all three devices, repeating every ten minutes from 00:10 to 04:20. Nothing was wrong. The
> session had recorded **942 MB of continuous tri-device sleep data** — 6 h 13 m of ECG, arm PPG, finger
> pleth and SpO₂ — the entire time. The verdict was about the wrong folder.
>
> This had been happening on **every session that crosses midnight**, which is every normal night.

---

## 1 · Root cause — two compounding defects, both in scope resolution

Capture files are named into a folder by their **session start date**. A night beginning at 22:16 writes
every byte into `captures/2026-07-27/`, all night. Meanwhile the `LINK`/`CLOCK` **sidecars roll on the
wall clock**, so at 00:00:21 the box creates `captures/2026-07-28/` and writes sidecars — and nothing
else — into it.

**1.1 · `capture._current_night` ranked folders by NAME.** `diskguard.active_nights()` returns a *set*,
and its own docstring explains why: *"a cross-midnight reconnect that opened a fresh date dir can leave
TWO active at once (the pre- and post-midnight folders), and both must be protected."* That is correct
for protection — archive and retention must treat both as untouchable. But `_current_night` then took
`max(active)`, which on `YYYY-MM-DD` is lexical, and so **always** picks the post-midnight folder. On
2026-07-28 that folder held two sidecars and no capture file at all.

**1.2 · The cross-midnight pooling could not repair it.** `nightqc.summarize` pools the previous day's
files precisely so a cross-midnight session is measured whole — but the pooling was gated on `if data:`,
and `data` excludes sidecars. The chosen folder had no data, so `earliest` was never computed and the one
mechanism built for this case never ran. **An empty folder is the strongest reason to look next door, and
it was the single condition under which the code refused to.**

The two defects are individually survivable and jointly silent: a wrong resolver hands the repair
mechanism the one input it declines to act on.

## 2 · What was NOT wrong — recorded because the wrong answers cost hours

Every one of these was believed during the incident and is false. They are kept here because a future
reader will form the same hypotheses from the same evidence:

| Hypothesis | Why it looked right | Why it is false |
|---|---|---|
| The device runners died at 22:16:22 | The journal goes silent for 1 h 44 m right after `START ecg → ok` | **A healthy long-lived session logs nothing.** One connection streamed for 6 h and had nothing to say. Log silence was evidence of health. |
| ~6 h of the night was lost | The night folder held only sidecars | 942 MB was being written to the *previous* folder throughout |
| The in-session stall watchdog is structurally blind | It is evaluated inside `run_polar`'s hold loop, so a dead runner takes it with it | True as a statement about placement, **irrelevant here** — nothing stalled. It correctly said nothing. |
| `WatchdogSec` should have caught it | The process was healthy while "capture was dead" | Capture was not dead |
| The H10 held a stale PMD slot | `START ecg → ok` then 4,186 bytes and freeze | That stall was **caused by the recovery restart**, at 04:31 — it did not precede it |

**A diagnostic method failed too, and it is the reason this took hours.** The 179 MB ECG file was missed
because the folder was listed with `ls -la | sort -k6 | tail`: those files were *closed at 04:30*, so they
sorted above the 22:16 entries and fell outside the tail. **A claim of absence must be checked against a
total — `du`, a full count, a byte sum — never against a sorted excerpt.**

## 3 · The fix — four layers, weakest assumption first

**L1 · The resolver follows the DATA, not the name** (`capture._current_night`). Rank active folders by
their newest **capture-file** mtime; sidecars never break the tie. New helper
`nightqc.newest_data_mtime()`. Falls back to the old lexical rule only when no active folder holds any
capture file — there is then nothing to prefer.

**L2 · Pooling runs from the empty side** (`nightqc.summarize`). The `if data:` gate becomes: pool when
the folder's earliest session is near midnight **or when the folder holds no capture file at all**.
A single resolver being right is a hope; two independent ones agreeing is a property.

**L3 · "Everything missing" is a scope verdict, not a device verdict** (`scope_suspect`). Nine
independent streams across three vendors do not fail in the same second. When the searched scope holds
no capture file, that is a statement about where we looked. `missing` stays populated — it is honest
about that scope — but `scope_suspect` says do not read it as hardware, and it is what any consumer must
branch on first. `qc_poller` logs it as a **WARNING naming the scope**, and suppresses the "night has a
gap" alert, because no gap has been established.

**L4 · The verdict carries its own ground** — `judged_dir`, `searched_dirs`, `data_files`. On 2026-07-28
the summary already contained the tell (`"files": 2`, both sidecars) and nothing surfaced it as one.

## 4 · Verification

- **12 regression tests** (`tests/test_qc_scope_resolution.py`) built from the real layout: the
  cross-midnight night verbatim; sidecars never breaking the tie; a session crossing **two** midnights
  (the resolver's job — pooling only reaches back one day); no-data-anywhere preserving the old rule; an
  idle box still reporting last night; pooling from the empty side; `scope_suspect` firing only on a
  genuinely unlocatable session and **never** masking a real single-stream fault.
- **Mutation-checked.** Reverting each layer independently fails the right tests: L1 → 2 failures,
  L2 → 3, L3 → 1, L4 → 1.
- **Replayed against the real bytes.** The actual `2026-07-27` + `2026-07-28` folders on the box,
  reconstructed to their 00:20 state via symlinks, run through both versions:

  | | `missing` | `scope_suspect` | H10 ECG rows |
  |---|---|---|---|
  | before | **9** | n/a | 0 |
  | after | **0** | False | **3,114,545** |

  Also recovered: O2Ring PPG 2,879,539 · Verity PPG 1,363,949 · H10 ACC 1,215,576 · SpO₂ 22,820.
- Full capture-host suite **1587 passed** (1575 baseline + 12).

## 5 · Deliberately out of scope

- **The actuator rule.** An automated remediation was built during the incident, on the false premise of
  §2, and consumed exactly the signal that was lying — armed, it would have dropped all three links every
  15 minutes across a healthy night. It was reverted (`f0f4b83`). The rule it leaves behind: **no
  automated remediation may consume a QC aggregate.** A signal that must resolve a path before it can
  count is not fit to drive a radio; if one is ever armed it consumes the in-process writer row counters,
  which cannot be wrong about which folder a file landed in.
- **Rows ≠ signal** — the false-*green* twin. On 2026-07-20 the Verity streamed **4 h 10 m off-arm**
  (ch0 σ = 1,071 counts vs 8,600–22,500 worn; 0/249 windows with a detectable pulse; accelerometer pinned
  at 1007 mg, σ 3.3) and QC scored it as excellent coverage. Same family, opposite polarity, own brief.
- **`_midnight_of` uses naive local arithmetic**, so the near-midnight window is an hour off on the two
  DST changeover days. Bounded and benign now that L1 resolves by data and L2 pools from the empty side.

## 6 · Done when

- [x] L1 `_current_night` ranks by newest capture-file mtime; `nightqc.newest_data_mtime()` added
- [x] L2 pooling runs when the folder holds no capture file
- [x] L3 `scope_suspect` + a scope-shaped `qc_poller` warning that suppresses the gap alert
- [x] L4 `judged_dir` / `searched_dirs` / `data_files` on every summary
- [x] Regression tests, mutation-checked, replayed against the real corpus
- [ ] **Deploy to the box** — `/opt/tepna/capture-host` still runs the pre-fix code
