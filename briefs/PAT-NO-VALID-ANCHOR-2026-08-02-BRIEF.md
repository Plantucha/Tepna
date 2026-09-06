<!--
  PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-06 — the remaining item's BLOCKER IS MISSTATED: a beat-free anchor exists and is proven; what is missing is a verdict computed against it. See §9a) · **Created:** 2026-08-02 · **Follows:** `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` §F3-ter, `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §5 · **Affects:** no code yet — a capture decision and one measurement · **DRAIN 2026-09-02 (Osprey):** verified 2 open Done-when boxes across 11 sections. **Owner: Osprey. Next step:** confirm whether the two remainders survived the host-axis work (#2044/#2052/#2082 changed the anchor and refusal paths under this brief) before executing — they may already be answered. · **TRIAGED 2026-09-03 (Osprey): 5 of 6 Done-when items verify; the sixth is ticked as NOT ACHIEVED in the brief's own text and that is the honest state.** Route 2 executed (Δ_H10 −865 ms, Δ_Verity −4363 ms, both stable to 0 ms across 7 h; ACC anchor corrected to −199 ms), and §10's corpus-wide run CORRECTS §7 rather than extending it — a brief that publishes its own retraction. What remains is a PAT verdict surviving an anchor NOT derived from beats, which §5 shows the current corpus cannot supply: the two requirements are mutually exclusive on the nights we hold. **So this is corpus-bound, not effort-bound** — distinct from its siblings, which need a run rather than a recording. Owner: Osprey. **Next step:** none executable here; it unblocks only on a capture that satisfies both requirements at once.

# PAT has never been alignment-limited by precision. It was limited by there being **no valid non-beat anchor** for the ECG and PPG streams — one was derived, and it still does not recover PAT on most nights.

> ### ⚠️ §7's "RESOLVED" is OVERSTATED — corrected at §10 after a corpus-wide run
> §7 measured **one night**. Run across **38 nights** of both trees, the derived anchor recovers a locked,
> plausible PAT on **6** of them (**0 of 13** box nights), at levels 64 · 81 · 91 · 103 · 209 · 521 ms —
> median 91 ms, below the arm band and inconsistent with the reference night's 209 ms. **PAT is NOT
> established.** The anchor derivation itself survives; the PAT conclusion drawn from it does not.
> Fourth retraction in this brief family from the same habit: concluding from the best available case.

> **RESOLVED 2026-08-02 (§7).** The anchor is derivable from the raw columns without touching a beat:
> per-characteristic BLE buffering, `offset_ACC + Δ_Verity − Δ_H10 = −199 ms`. Under it, **PAT = 218 ms
> median with IQR 16–38 ms over hours 0–4**, clearing `pat-gate.js`'s ≤60 ms bar. One parameter is still
> fitted (the −34.5 ppm rate) and §8 explains why it cannot be derived on this tree: **the phone
> `Phone timestamp` column is not an independent clock** — 76/76 files agree with the device to 1 ms over a
> whole night. Route 1 (a box night) is now needed only to derive that last rate.

Three PAT verdicts have now been published from this repo and two of them were wrong. This brief exists
because the third one — reached on the cleanest night in the corpus, with the anchor held fixed exactly as
prescribed — **failed in a way that indicts the prescription rather than PAT.**

## 1 · What was retracted, and why the tell was visible all along

`WEARABLE-HOST-AXIS-FOLLOWUPS` §F3-ter concluded **"PAT is not alignment-limited"** — 130–215 ms residual
IQR against a 60 ms bar, unchanged by the host-axis fix, therefore no further clock work would help. It
claimed to close `PAT-UNDER-PERBLOCK-ALIGNMENT` §5 as a NO.

**That harness fitted a free offset per block.** A per-block offset absorbs exactly the quantity PAT is, so
the residual it reports is what is left *after* PAT has been removed. The tell was inside its own results
table and went unread: a **median lag of 406–498 ms** is not physiological for an arm site (arm/wrist PAT
is 200–250 ms; even ankle is 300–400).

Retracted. `PAT-UNDER-PERBLOCK-ALIGNMENT` §5 is **re-opened**.

## 2 · The clean single-segment night — selection, not convenience

The prior re-run happened on **2026-07-26**, which on inspection is a **21-hour daytime-inclusive capture:
34 ECG fragments, 18 742 s (5.2 h) of gaps**, including single holes of 2.6 h and 1.7 h. Hour-bucketed PAT
across that is meaningless. Selection criteria were therefore stated first: one continuous ECG fragment,
one continuous PPG fragment, multi-hour overlap, nocturnal, no drawn axis.

**2026-07-09** is the best night the corpus contains, and `WEARABLE-HOST-AXIS-FOLLOWUPS` §F2 had already
independently flagged it as the best of the fold (100 % beat correspondence vs a 24 % chance control):

| | |
|---|---|
| ECG | single fragment, **6.86 h, ZERO gaps**, `hostAxis.applied`, ppm 0.0 |
| PPG | single fragment, 6.86 h, 3-LED, `timingSource: device+host`, **not drawn** |
| overlap | **6.86 h**, starting 21:16 |

The ACC anchor on this night is genuinely stable — unlike 2026-07-26, where the lag walked 0.2 → 1.4 s.
Hourly ACC lag medians: **3.30 · 3.30 · 3.30 · 3.20 · 3.30 · 3.40 · 3.40 s**, 30 of 35 usable windows inside
3.2–3.4 s. The published `driftPpm` is still not identifiable (Theil–Sen 0.0 / OLS 22.8 / endpoint 4.2), but
the *bound* is what a fixed anchor needs: hourly medians move ≤0.2 s across 6.7 h ⇒ **drift < 8 ppm**, i.e.
under 0.2 s accumulated over the night, far below one RR, so no wrap ambiguity.

## 3 · Both anchors run, nothing fitted per block

| hour | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| IQR, **ACC anchor +3.30 s** | 177 | 222 | 284 | 283 | 491 | 592 |
| IQR, **single global beat offset −0.10 s** | **69** | **89** | **69** | **100** | **67** | **138** |

- **The single global offset nearly reaches the bar.** 67–138 ms against `pat-gate.js`'s ≤60 ms — still
  failing, but a real improvement on the retracted 130–215 ms, and it is ONE scalar for the whole night,
  not a per-block fit, so within-hour tightness is not guaranteed by construction. A residual **−28 ppm**
  ramp remains that one offset cannot absorb; `trio-batch`'s own estimator independently reports −24 ppm.
- **The ACC anchor does not lock at all** — 177–925 ms. If +3.30 s were the true clock offset, PAT would
  lock under it. It does not.

## 4 · The finding: the ACC anchor does not transfer to the ECG/PPG streams

The two anchors disagree by **3.40 s**, which PAT (~0.2–0.3 s) cannot explain. It is **not a comb alias**
either: 3.40 s ÷ 994 ms median RR = **3.42**, not an integer, so it is not the beat matcher locking onto a
neighbouring beat.

The mechanism that fits: **ACC and PPG are different BLE characteristics with different batch sizes**, so
the phone timestamps their notifications with different buffering latency. An offset measured ACC↔ACC is
then a valid clock comparison *for the ACC streams only*, and carrying it to PPG imports the difference in
buffering. This is consistent with the standing corpus fact that H10↔Verity sit ~3.3 s apart on **every**
phone-captured night and ~0.2 s on box nights — a capture-path property, not a crystal.

**This invalidates the remedy this brief family prescribed.** "Carry the ACC anchor end-to-end and let no
beat-derived offset touch it" was the stated fix for PAT after the §F3-ter retraction. Executed literally on
the cleanest available night, it produces a *worse* result than the thing it was replacing.

## 5 · Why the existing corpus cannot settle it — the two requirements are mutually exclusive

|  | single-segment? | anchor valid for ECG/PPG? |
|---|---|---|
| phone tree (`Ecg nightly/`, 2026-06→07) | **yes** — median fragment 19 976 s (5.5 h) | **no** — 3.3 s ACC↔PPG characteristic offset |
| box tree (`tepna-smoketest/captures/`) | **no** — 34 ECG fragments on 07-26 | tighter (0.2 s), host-disciplined |

The one box night with a single ECG fragment, **2026-07-30**, has **13 PPG fragments** and its ECG starts
05:29. There is no night in this corpus that is clean on both axes at once. Every previous PAT attempt has
been paying one of these two costs without naming which.

## 6 · The two routes — one is a capture decision, so it is not taken here

1. **Capture a new box night with a stable BLE link.** Single-segment *and* host-disciplined at 0.2 s gives
   a valid non-beat anchor and closes the question directly. ~~Blocked on the adapter fault that fragments
   the Verity — the capture-side issue, not an analysis one.~~

   > ✅ **NOT BLOCKED — the nights already exist. Measured 2026-08-16 on `vigil:/srv/tepna/captures`.**
   > No new capture is required, and none has been required for some time.
   >
   > Over the last **12** capture days, **10** carry a **≥ 4 h single-segment Verity PPG *and* a
   > ≥ 4 h single-segment H10 ECG** covering the same session. Only 2026-08-08 and 2026-08-12 do not.
   > The three best:
   >
   > | night | Verity PPG (1 segment) | H10 ECG (1 segment) | overlap |
   > |---|---|---|---|
   > | **2026-08-07** | 21:50:54 → 06:51:42 | 21:50:56 → 06:55:06 | **9.0 h** |
   > | 2026-08-11 | 21:40:29 → 04:17:18 | 21:40:21 → 05:30:03 | 6.6 h |
   > | 2026-08-16 | 00:15:16 → 06:21:37 | 22:15:56 → 06:25:03 | 6.1 h |
   >
   > **2026-08-07 meets every stated criterion**: both streams single-segment and starting within two
   > seconds of each other, clock `disciplined` at stratum 1 for the whole night, ACC present on both
   > devices, and the Verity ACC covering the full span at 51.7 Hz against a 52 Hz nominal — it starts
   > two seconds *before* the PPG.
   >
   > The adapter fault is **real but intermittent**, not a persistent blocker: it fragments some
   > sessions (2026-08-16 broke into ~3-minute pieces from 11:06 onward) while leaving most overnight
   > runs whole. The premise "blocked on the adapter fault" was true when written and had quietly
   > stopped being true; nothing re-checked it.
   >
   > ⚠️ **TWO MEASUREMENT TRAPS, both of which produced confident wrong answers on the way to this
   > table — keep them if you re-run it.**
   > 1. **A capture directory is keyed by SESSION START, so one night spans two directories.** Last
   >    night's H10 began 22:15 on the 15th and files under `2026-08-15`, while its Verity began 00:15
   >    and files under `2026-08-16`. Listing one directory gave *"zero H10 files"* — true of the
   >    directory, false of the night.
   > 2. **`ls …_PPG.txt | head -1` takes one segment of many.** On a fragmented day that silently reads
   >    the first 3-minute piece as though it were the night, and on a clean day it accidentally reads
   >    the right file — so it is wrong in a way that usually looks right.
   >
   > **What this establishes and what it does not:** the DATA satisfies route 1. The analysis — deriving
   > the non-beat anchor on 2026-08-07 and testing whether PAT resolves — has **not** been run. Route 1
   > is unblocked, not executed.
2. **Characterise the per-characteristic latency** on phone nights: measure ACC vs PPG vs ECG arrival
   timestamps from the SAME device, and correct the ACC anchor by that difference before transferring it.
   This is a measurement the existing corpus CAN support, and it would also retro-validate every ACC-anchored
   number already published.

Route 2 is the cheaper test and does not depend on hardware. It should be done first, and if it explains the
3.40 s it also tells route 1 what to expect.

## 7 · Route 2 EXECUTED — the anchor is derivable, and PAT is DEMONSTRATED

**The derivation.** Within one device, both characteristics carry a `sensor timestamp` from the **same**
device clock, so for characteristic *c*:

```
d_c = host_c − dev_c = L_c − E_device          (L = latency, E = device epoch)
Δ_dev = d_physio − d_ACC = L_physio − L_ACC    (E cancels — pure per-characteristic buffering)
offset_streams = offset_ACC + Δ_Verity − Δ_H10
```

Measured on 2026-07-09, bucketed per host-hour so any device-crystal drift (shared by both characteristics)
cancels bucket-by-bucket:

| | value | stability |
|---|---|---|
| Δ_H10 (ECG − ACC) | **−865 ms** | spread **0 ms** across 7 hours |
| Δ_Verity (PPG − ACC) | **−4363 ms** | spread **0 ms** across 7 hours |
| offset_ACC (`wearable-sync`) | +3300 ms | |
| **derived anchor** | **3300 − 4363 + 865 = −199 ms** | |

Against the beat-derived −100 ms. **Per-characteristic buffering accounts for essentially the whole 3.40 s
discrepancy of §4**, leaving 99 ms — the size of a physiological PAT. The hypothesis is confirmed
quantitatively, from the raw columns, with no reference to beats.

**PAT under the derived anchor.** Only the *rate* is fitted (one DOF for the whole night, −34.5 ppm); the
**level — which IS PAT — comes from the beat-free anchor and is not tuned**:

| hour | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| median (ms) | 193 | 217 | 263 | 216 | 186 | 203 | 433 |
| IQR (ms) | **32** | **16** | **20** | **23** | **38** | 78 | 244 |

**Hours 0–4 clear `pat-gate.js`'s ≤60 ms bar with margin, and the overall median is 218 ms** — squarely in
the published arm/wrist band (200–250 ms). That the level lands there is an independent check, not a fit:
it falls out of `3300 − 4363 + 865`. Hours 5–6 degrade (78, 244 ms), consistent with waking movement.

**PAT is real, locked, and physiological on this night.** The three previous verdicts failed on the anchor,
never on PAT.

## 8 · Why the rate still has to be fitted: the phone tree has NO independent host clock

The one parameter still fitted is the −34.5 ppm rate, and on this tree it **cannot** be derived, because the
`Phone timestamp` column is not an independent clock. Measured as the range of `(host − device)` across each
file, every file ≥30 min in both trees:

| tree | files | median range | files < 5 ms | files > 100 ms |
|---|---|---|---|---|
| **phone** (`Ecg nightly/`) | 76 | **1 ms** (min 1, max 1) | **76 / 76** | 0 / 76 |
| **box** (`tepna-smoketest/captures/`) | 148 | **937 ms** | 0 / 148 | **148 / 148** |

Zero overlap. Two independent clocks cannot agree to **1 ms over 6.9 h** — that is 0.04 ppm, an order better
than the chrony-disciplined box itself measures (22 ppm). So on phone-captured nights the phone column is
**anchored once at stream start and thereafter extrapolated from the device clock**. It is the same class of
fault as the O2Ring's drawn axis (`O2RING-SYNTHESISED-AXIS`), in a column everything has been trusting.

Consequences, none of which require a code change:

- **`DexClock.hostAxis` is INERT on the phone tree, not wrong.** With host ≡ device it correctly measures
  ~0 ppm and corrects nothing — exactly what 2026-07-09's ECG reports (`applied: true`, **ppm 0.0**). The
  host-axis work is real, and its benefit is confined to box-captured nights.
- **The 3.30 s ACC↔ACC "offset" on phone nights is not a clock offset** — it is the difference in when each
  stream's anchor was established at connection. That is why it does not transfer, and why §4's mechanism
  is right for the wrong-sounding reason: the buffering shows up once, at anchoring, not continuously.
- **Only a box night can yield a DERIVED drift**, because only there does an independent host clock exist.
  This is what route 1 is actually for — not a cleaner PAT, but the last fitted parameter.

## 10 · The corpus-wide run — PAT is NOT established, and §7 is corrected

All nights of both trees re-folded (`trio-batch --force`: 25 old + 16 box, incl. 2026-07-31/08-01), Δ
derived per night, ACC offsets measured on all of them (26 of 31 old nights confident, median offset
**3.31 s**, range 1.75–5.45 s). 38 nights had everything needed.

| | nights | majority of hours ≤60 ms | hours ≤60 ms |
|---|---|---|---|
| phone (old) | 25 | **6** | **45 / 269 (17 %)** |
| box | 13 | **0** | |

Passing nights: 2026-06-15 (81 ms, 8/8) · 06-30 (521 ms, 4/6) · 07-04 (91 ms, 4/4) · 07-06 (103 ms, 7/7) ·
07-07 (64 ms, 5/7) · 07-09 (209 ms, 5/7). The reference night reproduces (209 vs 218 ms — a rate-grid
difference), but the rest cluster near 90 ms, **below** the arm band, and 64–209 ms is wider between-night
scatter than one subject at one site should show. ±50 ms of that is the ACC offset's 100 ms grid; the rest
is unexplained. **PAT is not established.**

### Two things this run settled, both negative and both worth keeping

1. **Box nights fail uniformly (0/13) because of fragmentation.** One carries 24 ECG and 68 PPG fragments;
   a single Δ per stream cannot describe a timeline reassembled from dozens of separately-anchored ones.
   But fragmentation does **not** explain the phone failures — single-fragment nights pass 3/12, multi
   3/26, far too weak at this n. Route 1 (a single-segment box night) therefore no longer looks like the
   fix it was billed as at §6; per-fragment Δ is the more likely requirement.
2. **A tight residual cannot validate an anchor — tested and confirmed.** We searched k ∈ [−4,4] over the
   measured 384 ms quantum to see whether each failure was a one-quantum error. It "improved" nights that
   were already right: 07-04 moved 91 → 859 ms and 07-06 103 → 395 ms **with the same passing-hour count**,
   because shifting by whole beats re-pairs each R with a neighbouring foot and barely moves the IQR.
   Selecting on dispersion cannot separate aliases; selecting on plausibility is circular. **The quantum
   search is recorded as FAILED**, and the comb degeneracy is now demonstrated rather than argued.

### 🔴 What "6 of 38" counts — stated because a SECOND "of 38" now exists and they are not the same 38

`EXTERNAL-METHODS-SURVEY-FOLLOWUPS` §4 asked this brief to say which denominator its headline uses.
It matters more than it looked, because a different measurement has since produced a superficially
matching figure:

| figure | denominator | acceptance rule | corpus |
|---|---|---|---|
| **6 of 38** (this brief, §10) | nights that "had everything needed" — 25 phone + 13 box, out of 25 + 16 attempted | **majority of the night's hours at ≤ 60 ms**, at a locked and plausible level | **both trees** |
| **15 of 30** (`pat-fiducial-compare.mjs`, 2026-08-23) | nights reaching the estimator — 30 of 38, after 5 alignment failures, 2 unparseable pairs and 1 zero-overlap | strict matchRate exceeds that night's **own circular-shift null at the 95th percentile** | the **box-mirror tree only**, 2026-07-16 → 08-22 |

⚠️ **THE TWO "38"s ARE A COINCIDENCE AND THE NIGHT SETS BARELY INTERSECT.** This brief's 38 is 25
phone nights plus 13 box; the fiducial run's 38 is one capture-host tree beginning **2026-07-16**.
Every night passing here — 06-15, 06-30, 07-04, 07-06, 07-07, 07-09 — predates that start, and all
six are **phone** nights. The two headlines are computed on essentially disjoint data.

⚠️ **AND 15/30 MUST NOT BE READ AS "PAT RECOVERS ON HALF THE BOX NIGHTS."** It says the R→foot
coupling is **above chance**, which is a far weaker claim than this brief's: beating a circular-shift
null establishes that a relationship exists, not that the level is locked, plausible, or stable
across the night. Under *this* brief's criterion the box tree still scores **0 of 13**, and nothing
in the fiducial work disturbs that — it tested which fiducial, not whether PAT is established.

So the two figures answer different questions on different nights, and neither supersedes the other.
When quoting either, carry its denominator and its acceptance rule; a bare "of 38" is now ambiguous
in this repo.

### On publishing this

A standalone paper was drafted and **discarded**. Stripped of a working PAT, the timing result is one
subject, one device pair, one phone, one logging app, with the batching mechanism inferred from the 768 ms
spacing rather than confirmed against the BLE stack — a bug report at n=1, not a contribution. It belongs
**folded into existing papers**: `timestamp-pathology.html` gains a new specimen class (a column that
parses perfectly and carries no clock), and `wearable-clock-drift.html` needs its mechanism section
corrected. What would make it publishable is a **second logging app or phone** showing the same quantized
Δ — that is a short capture, not an analysis.

## 9a · PARKED 2026-09-06 — the blocker is not the one this brief states

The header said *"no code yet — a capture decision and one measurement"*, and the open item reads
*"a PAT verdict that survives an anchor NOT derived from beats — **NOT ACHIEVED**"*.

**A beat-free anchor does exist, is pairwise-proven, and has tooling. This brief does not know.** It
contains the string "buzz" **zero times**, while `PAT-ROOT-CAUSE-FORENSICS-2026-08-27` §10 records:

> The buzz fiducial is pairwise-proven: **5/5 in H10 ACC and 5/5 in Verity ACC** on the pairwise nights.

and `tools/pat-buzz-stability.mjs` is committed (`--cmds HH:MM:SS.mmm,... --a <ACC|PPG2W>`). A buzz
fiducial is a mechanical event recorded by the accelerometers of both devices — **not derived from
beats**, which is exactly the property the item requires.

**So the item is still NOT met, but for a different reason than stated.** What is missing is not an
anchor and not a capture decision — it is a **PAT verdict computed against the anchor that already
exists**, on the 5 pairwise nights where it is proven.

**The capture dependency is real but narrower than the header implies.** It applies to *future corpus
coverage*, not to the existing evidence: `pat-buzz-stability.mjs` needs the buzz command times, so only
nights where buzzes were issued during capture carry the anchor. Five such nights exist now; extending
beyond them is the capture decision.

**Two units, and they should not be confused:**
1. **Executable today** — compute a PAT verdict against the buzz anchor on the 5 pairwise nights and
   compare it to the beat-derived verdict. Tooling and data both exist.
2. **Owner/capture** — issue buzzes routinely so the anchor covers the corpus rather than 5 nights.

⚠️ **Parked, not blocked-on-data** for (1). This is the second time in this drain that a PAT brief's open
item was already partly answered in a sibling it does not reference — see RESIDUE
`2026-09-06-done-when-met-in-a-sibling-brief`.

## 9 · Done when

- [x] §F3-ter's "PAT is not alignment-limited" retracted, with the per-block-fitting mechanism named and the
      406–498 ms median-lag tell recorded so the same harness is not rebuilt.
- [x] PAT re-run on a **clean single-segment sleep night** (2026-07-09: 6.86 h, zero gaps, not drawn),
      selection criteria stated before the night was picked.
- [x] Established that the **ACC anchor does not transfer** to the ECG/PPG streams — 3.40 s apart, not a comb
      alias (3.42 RR), and it fails to lock PAT where a single global offset nearly does.
- [x] Recorded that the corpus **cannot** currently satisfy both requirements at once, with the night that
      fails each.
- [x] **Route 2 EXECUTED** — per-characteristic latency measured (Δ_H10 −865 ms, Δ_Verity −4363 ms, both
      stable to **0 ms** across 7 hours), ACC anchor corrected by it to **−199 ms**, PAT re-run under it.
- [ ] **A PAT verdict that survives an anchor NOT derived from beats — NOT ACHIEVED (§10).** The beat-free
      anchor works, but corpus-wide it recovers PAT on only **6 of 38** nights (0 of 13 box), at 64–209 ms
      with median 91 ms — below the arm band and inconsistent with the reference night's 209 ms. The single
      night reported at §7 was the best case, not the typical one.
      **Denominator and acceptance rule now stated at §10** — 38 = nights with everything needed across
      **both** trees, acceptance = majority of hours at ≤ 60 ms. Do not conflate it with the fiducial
      work's "15 of 30", which is a different corpus, a different denominator and a much weaker
      acceptance rule (above its own chance null).
- [x] Established that the **phone tree carries no independent host clock** (76/76 files at 1 ms range vs
      148/148 box files > 100 ms), so `hostAxis` is inert there — and that this is why the rate must be
      fitted on this tree.
- [x] 🟢 **ROUTE 1 IS UNBLOCKED — the single-segment box night EXISTS: `2026-08-11` (found 2026-08-18).**
      This brief records that no box night had both legs unfragmented — *"the one box night with a single
      ECG fragment, 2026-07-30, has 13 PPG fragments"*. That was true of the box tree as it stood; the
      corpus has since grown to **2026-08-16**, and `Tepna/uploads/captures/2026-08-11` meets every
      criterion §7 states, measured rather than assumed:

      | leg | file | duration | gaps > 5 s | `hostAxis` |
      |---|---|---|---|---|
      | ECG (H10) | ONE `_ECG.txt`, 3 664 016 rows | **7.83 h** | **0** | `ok`, **`independent: true`**, spread 491.9 ms, ppm −26.7 |
      | PPG (Verity) | ONE `_PPG.txt`, 1 312 910 rows | **6.61 h** | **0** | `ok`, **`independent: true`**, spread 1064.7 ms, ppm −31.9 |

      One continuous fragment each · ~6.6 h overlap · nocturnal (both start 21:40, 8 s apart) · a **real
      second clock on BOTH legs** (spread 492/1065 ms against the ≤ ~1 ms that marks a derived host
      column). So the rate can be **DERIVED** here rather than fit — which is exactly what this item says
      Route 1 was still needed for.

      **And the night makes the case for the correction quantitative:** the two crystals differ by
      **5.2 ppm** (−26.7 vs −31.9), which over the 6.61 h overlap is **124 ms of uncorrected relative
      drift — 1.37× the ±90 ms PAT tolerance**. So host-disciplining is load-bearing on this night, not
      cosmetic: without it the two devices walk out of tolerance on their own, before any physiology.
      🔬 **DERIVED 2026-08-18 — and it is the FIRST box night to beat its own null.** Ran
      `tools/pat-host-offset.mjs --night 2026-08-11` (120 min windows, 50 surrogates, ECG reference,
      foot timing point):

      | window | beats | legacy | chance | p | strict | chance | p |
      |---|---|---|---|---|---|---|---|
      | 0 | 6212 | 57 % | 21 % | 0.020 | 8 % | 7 % | 0.059 |
      | 120 | 6297 | 78 % | 20 % | 0.020 | **25 %** | 7 % | **0.020** |
      | 240 | 6381 | 22 % | 21 % | 0.059 | 14 % | 7 % | **0.020** |

      **strict beats its own surrogate null at p < 0.05 on 2 of 3 windows.** Against this brief's
      *"0 of 13 box"*, that is the first box night to show any significance at all — and the thing that
      changed is the one §7 named: a single unfragmented segment on **both** legs.

      ⚠️ **But this is NOT "PAT recovered", and the numbers say so plainly.** A strict match of 8–25 %
      against a 7 % chance line is *detectable*, not *usable*: the same estimator's reference night ran
      far higher, and a 25 % match cannot carry a per-beat PAT. The honest claim is **above chance on a
      box night for the first time**, which is a statement about identifiability, not about accuracy.

      ⚠️ **The p-values are FLOORED by the surrogate count and must not be read as strengths.** With 50
      surrogates, p = (k+1)/51, so **0.020 means zero surrogates exceeded** — the smallest value the
      test can express, not a measured 1-in-50. 0.059 is two exceeded. Three windows at the floor is
      three independent "no surrogate beat it", which is the useful reading; quoting 0.020 as *the*
      p-value would over-state a resolution the run does not have. Re-run with more surrogates before
      any number here is published.

      **Scope: n = 1 night, 3 windows.** Legacy 22 % on the third window (chance 21 %) is at chance,
      so even within this night the effect is not uniform across the recording.

      ⚠️ **Not yet done, and the DATA finding above is only half of it:** the per-fragment Δ
      implementation remains open below. What changed is that it is no longer waiting on a capture, and
      that there is now one night on which a derived — not fitted — rate produces a signal to test it
      against.
- [x] ✅ **ALREADY IMPLEMENTED — verified in the shipped tool 2026-08-18, and by a stronger mechanism
      than this item proposes.** `tools/pat-host-offset.mjs` does not compute one Δ per night, and never
      fits one:

      | layer | code | unit |
      |---|---|---|
      | fragment pairing | `for (const ef of E) for (const pf of P)` | every ECG-file × PPG-file pair, scored separately |
      | Δ per fragment | `ea = hostAnchors(ef.f); pa = hostAnchors(pf.f)` → `DexClock.hostAxis(...)` | **per FILE**, so Δ is per-fragment by construction |
      | within a pair | `for (let w = lo; w + WINDOW <= hi; w += WINDOW)` | per 120-min window |

      So the granularity is **finer** than "per fragment" — per window *within* per fragment pair — and
      the offset is **READ from each fragment's own host-disciplined axis rather than fitted**, which is
      the tool's stated design (*"THE OFFSET IS READ, NOT ESTIMATED FROM MOTION"*, header §1). A fitted
      per-fragment Δ, which is what this item asks for, would be a step backwards from what ships.

      **This item describes the scout, not the shipped form.** It was written against the state before
      `PAT-UNDER-PERBLOCK-ALIGNMENT` §3e.4 replaced the estimator; nothing marked it stale when that
      landed.

      ⚠️ **And the diagnosis it rests on was wrong, which matters more than the item being done.** The
      reasoning was *"box nights fail uniformly (0/13) … while a single Δ describes the whole timeline"*
      — but there was never a single Δ. The 2026-08-11 run (§ above) shows what actually separates a
      working box night from a failing one: **fragment LENGTH, not fragment Δ.** One unfragmented
      segment on both legs cleared the null on 2/3 windows; the 0/13 nights carry 24 ECG / 68 PPG
      fragments whose individual overlaps are too short to reach the tool's own `WINDOW_MIN` and beat
      counts, so they are **refused before any Δ is applied**. Fixing Δ granularity could not have
      helped them, because the granularity was already right and the windows never ran.

- [ ] ~~**Per-fragment Δ**~~ (original text retained below for provenance), not one per night — the likeliest fix, since box nights fail uniformly (0/13)
      with 24 ECG / 68 PPG fragments while a single Δ describes the whole timeline. Supersedes Route 1 as
      the next step; a single-segment box night would still be needed to DERIVE the rate rather than fit it.
- [x] Decide whether `hostAxis` should DECLARE an inert axis — **DONE 2026-08-03 (§11). Yes, and the
      framing was too kind: an inert axis does NOT report ~0 ppm.** Measured over the phone tree it
      reports a median of 0.0 but a **maximum of 120.7 ppm**, from 1 ms rounding noise — four times the
      largest genuine Polar crystal error in this corpus (H10, −27 ppm). The old API could hand a
      consumer a plausible, physically-sized rate derived from a column carrying no information.


---

## §11 · EXECUTED 2026-08-03 — `hostAxis` declares an inert axis

### 11.1 · The item under-stated the defect

It reads *"rather than silently reporting ~0 ppm"*. Measured, that is the benign case. The phone tree's
inert axis reports:

| tree | files | residual spread | declared independent | **|ppm| reported** |
|---|---|---|---|---|
| box / capture-host | 82 | min **101.89 ms** · median 425 · max 5124 | **82 / 82** | median 167.5 |
| phone | 104 | min 0.13 ms · **max 1.00 ms** | **0 / 104** | median 0.0 · **max 120.7** |

A ~0 ppm would at least be self-evidently uninformative. **120.7 ppm is not** — the largest genuine
crystal error in this corpus is the H10 at −27 ppm, so an inert column can produce a rate four times the
real one and entirely plausible in size. A consumer reading `ok: true, ppm: 120.7` had nothing to tell it
apart from a measurement.

### 11.2 · The discriminator is the SPREAD, and it is a property of the data

The phone tree's **maximum** residual spread is exactly **1.00 ms** — the resolution of the phone's own
timestamp. Its host column is the device time rounded, so the residual cannot exceed one quantum however
long the recording runs. Nothing in either tree lands between 1.00 ms and 101.89 ms.

`CK_AXIS_INERT_MS = 2` is **twice the stamp quantum**: 2× the largest inert spread observed, 50× below the
smallest real one. It is stated as a multiple of the quantum rather than a bare number because that is what
it is — a host that adds nothing beyond rounding — not a tuned threshold.

### 11.3 · Additive, and gated both ways

`ok` and `ppm` are untouched; `independent`, `spreadMs` and `inertReason` are new. Every existing consumer
behaves exactly as before — which is why this could land as a spine change without moving a single export.

The gate asserts the distinction rather than describing it: both cases are `ok: true` (the defect), a
divergent host is independent, a rounded host is not, **and the inert case reports a nonzero plausible ppm**
— that last one matters, because if it ever read ~0 the other assertions would pass for the wrong reason
and a reader could conclude "0 ppm already told you" and delete the flag. The 2 ms bound is asserted on both
sides (2 ms inert, 3 ms independent), since a one-sided test leaves `<=` → `<` alive.

**Mutation found a real subtlety.** Computing the spread from the SMOOTHED series instead of the raw
residuals left every verdict above unchanged. The running median exists to keep BLE jitter out of the
*correction*, and it does its job — so a host with sparse jitter spikes smooths to ~0 while its raw spread
is 6 ms. Those two series answer different questions: the smoothed one asks *"what rate should I apply"*,
the raw one asks *"did this column carry any information at all"*. Sparse jitter is evidence of a real
second clock (a derived column has none), so it must read INDEPENDENT — and the gate now contains the case
that separates them.

### 11.4 · Spine change, and what it cost

`clock.js` is inlined into every bundle, so all **11** owned bundles were rebuilt and all three build
systems re-run. **Zero fixtures moved** across all nine regenerators — the field is genuinely additive —
but `computeHash` moves for every app, so `verify-fixtures` re-stamped the **8** corpus-backed fixtures
(ECGDex · OxyDex ×2 · PulseDex ×2 · HRVDex ×2 · Integrator) after a green run.
