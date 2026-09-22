<!-- Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS (items 1 and 3 DONE — the box census 2026-09-20 (Heron, §7) and the rail leg, which had LANDED in #2658 on 2026-09-19 and sat unstamped; §7.4 classifies the census increment with the shipped detector and 28-of-55 does not extend. The ONLY remainder is `GAP_S`, a two-node threshold and the owner's; item 1 detail: the box census, DONE 2026-09-20 — verified read-only across rig, vigil and both NAS boxes: the box's ECG population is a strict subset of the rig corpus, so nothing lies beyond it; §7) · **Created:** 2026-09-18 · **Residue:** 2026-09-20-positive-saturation-at-negated-low-rail · **Supersedes-row:** 2026-09-18-ecg-saturation-unflagged

# A fix keyed on the CAUSE it was written for does not generalise to a second cause with the same consequence

**Measurement complete; no threshold proposed and no remedy taken.** Promoted from residue row
`2026-09-18-ecg-saturation-unflagged`, which turned out to be ≥ one work-unit and to be **wrong in a
useful direction** — the row said "ECG saturates and nothing flags it", and something flags half of
it by accident.

## 1 · The thesis, which outlives the ECG instance

`buildNN`'s §∅ gap-straddle rule is **correct and works**. It keys on **elapsed time**: an inter-beat
interval longer than `GAP_S = 10 s` is `spansGap` and is excluded as an *absence* rather than repaired
as a corrupted beat. Its own comment records the defect it fixed — *"each a multi-second absence
replaced by a plausible ~1 s heartbeat that then fed rMSSD and SDNN as if it were a measurement."*

**It was calibrated for DROPOUTS.** A saturated stretch is just as much an absence, and produces a
*shorter* span — so it slips under the cut and is median-filled. Same defect, second entry path.

> **A fix keyed on the CAUSE it was written for does not generalise to a second cause with the same
> consequence.** The rule is not wrong; its *domain* was drawn around the cause that motivated it.

## 2 · What the guard is, and the two ways it fails

`ecgdex-dsp.js:948-961`, per-beat SQI, two legs:

| leg | rule | fires on the observed population |
|---|---|---|
| rail | `|int16[j]| > 31000` | **0 of 112** |
| flat | `maxFlat > 0.2·fs` (26 samples at 130 Hz) | 112 of 112 — *where it looks* |

**2a · The rail leg is gated above the phenomenon.** It looks for saturation at 31000; the H10
saturates at **~18,100–19,500**, at a **per-file** rail (29 distinct values across 62 files). It cannot
fire on real H10 clipping and never has. Third instance today of a detector configured past the thing
it exists to find, after the sidecar's `min_run=200` and `class_b_runs` having no mid-range rule.

**2b · The flat leg is PEAK-CONDITIONAL, and that is the sharper failure.** It examines only ±130 ms
around a **detected** peak — and saturation is precisely what suppresses detection. Measured over 112
runs ≥200 samples across 597 deduplicated files:

    a detected peak is near  55     <- the guard looks
    no detected peak near    57     <- the guard never looks

**A guard whose coverage is decided by the very failure it guards against.** The 55 it catches, it
catches through the flat leg by accident of geometry, not by the leg meant for this.

## 3 · The consequence — 28 absences median-filled

For the 57 the guard never examines, the bracketing beats yield ONE RR interval spanning the stretch.
**55 of 57 do** (2 have no bracketing beat). Span: **min 3,570 ms · median 9,818 · max 15,698** — all
55 over 2,000 ms, 50 over 5,000. A 9.8-second "beat" is 6 bpm.

Split at `buildNN`'s own cut:

| | n | fate |
|---|---|---|
| **> 10 s** | 27 | `spansGap` → correctly **excluded** as an absence |
| **2–10 s** | **28** | `rangeBad` → **median-filled**, an absence treated as a corrupted beat |

## 4 · 🔴 WHICH REMEDY IS BLOCKED — checked, not assumed

An earlier report from this session said both remedies "interact with the deferred finger-off
capture". **That was a generalisation and it is wrong.** Checked:

| remedy | blocked by the capture? | actual constraint |
|---|---|---|
| **rail leg (`31000`)** | **NO** | `31000` has exactly ONE live site (`ecgdex-dsp.js:958`), ECG-only, no PPG path. The capture answers what the **O2Ring's PPG** rests at — different device, signal and phenomenon. **Independently fixable now.** |
| **`GAP_S`** | **NO** — but coupled | ECG-local in code, yet `ppgdex-dsp.js:4108` holds `PPG_CVHR_GAP_S = 10; // ECGDex GAP_S — one cut, so the two nodes' indices stay comparable`. **Two constants held equal by a COMMENT, not a shared symbol.** Moving one silently breaks a documented cross-node invariant. |

So neither is gated on the capture; one is a single-site fix and the other is a two-node threshold
decision. That distinction was invisible until the dependency was checked rather than inherited.

⚠️ **The rail leg's replacement is NOT a better constant.** The rail is a **per-file** quantity — 29
distinct values here — so any global number repeats the defect at a different magnitude.
`nightqc.rail_value` already solves exactly this (the histogram spike nearest the edge, not the edge).
Naming the mechanism, not proposing the parameter.

## 5 · ⚠️ Caveat that bounds §2b, stated unsoftened

The 55/57 split uses `detectPeaks` over the full record. **If detection is itself perturbed by the
saturation upstream of where this measured, the split could move.** The direction cannot — a saturated
stretch with no beats still yields a spanning interval — but the magnitude is unproven.

## 6 · Done when

- [x] Existing guard identified before proposing anything (two of three picked-up rows today were stale)
- [x] Detection rate vs CONSEQUENTIAL rate separated — 112 detected, 55 spanning, 28 median-filled
- [x] Each remedy's dependency **checked** rather than inherited (§4)
- [x] Box census — **DONE 2026-09-20 (Heron), read-only, and the premise was wrong in a useful way: there is nothing beyond.** The box's ECG population is a strict subset of the rig corpus (§7). What exists beyond 597 is the rig corpus itself growing to 602; the rail-level census over all 602 reproduces every number above exactly and adds 5 runs in 3 files. The peak-conditional half (the 55 → 28 split) needs the JS DSP and is handed to the rail-leg owner with the 3 file paths (§7.3).
- [x] `GAP_S`: a threshold decision across TWO nodes — **OWNER RULED 2026-09-21: MEASURE BEFORE RULING.** **MEASURED 2026-09-22 (Osprey, `tools/gap-s-sweep.mjs`, record `audits/GAP-S-SWEEP-2026-09-22.json`; report pre-stated before the run, no bands):** over the 23 paired box nights (largest non-stub H10 `_ECG.txt` + Verity `_PPG.txt` per date), sweeping both constants together over 3 · 5 · 7.5 · 10 · 15 · 20 · 30 · 60 s, **the CVHR index does not move on either node** — ECGDex: 0 of 23 nights move ≥ 10 % at any value ≤ 20 s, 1 of 23 at 30–60 s (median index 6.2 ev/h at every value); PpgDex: 0 of 23 at every value (median 5.9); no knee exists in 3–60 s; the ECG active-seconds denominator moves by only tens of seconds per night across the whole range (the box nights carry almost no inter-beat absence between 3 and 60 s). The instrument SEES the cut: the tool's null control plants a 20 s gap on a synthetic night and the denominator differs by ~20 s between 10 and 30 and not between 3 and 10. **PHONE HALF MEASURED 2026-09-22 (record `audits/GAP-S-SWEEP-PHONE-2026-09-22.json`) — and a correction:** this paragraph first said the phone-tree nights were not measured because their local `_ECG.txt` copies were 84-byte stubs. That was the SYMLINK length read off `ls -la`; the targets resolve over NFS (`/mnt/nas/tepna-corpus`, mounted on the rig). The 30 paired phone nights (2026-06-10 → 07-13) were swept with the same instrument and the same eight values: **again nothing moves** — 0 of 30 on either node at every value (ECGDex median 5.1 ev/h, PpgDex 4.65), no knee. A labelled post-hoc extension to 120 · 300 · 900 s found ZERO denominator gain on every night — no inter-beat interval longer than 10 s reaches `buildNN` — and a raw census of the sensor-timestamp deltas explains why: **the H10 ECG stream is contiguous on all 30 phone nights** (0 gaps > 3 s on any of the three clocks). The "dropout-heavy phone nights" premise holds for the Verity/O2Ring BLE links, not for the H10 ECG in this tree. **So GAP_S's population is EMPTY above 10 s on both corpora**, and holds seconds to tens of seconds per night in the 3–10 s band: this corpus cannot discriminate the constant, and a ruling would rest on the planted-gap mechanics (the null control), not on measured nights. **Incidental, logged as `2026-09-22-cvhr-cross-node-comparability-unsupported`:** at every cut the two nodes' indices barely rank-correlate across nights (Spearman 0.03–0.05, median |Δ| 1.0–1.1 ev/h), so the "one cut so the two indices stay comparable" comment has no measured support on this corpus. **Refined by the phone half (`2026-09-22-cvhr-cross-node-correlation-is-corpus-dependent`):** on the 30 phone nights the same two indices rank-correlate at Spearman 0.63 at every cut — the non-comparability is a property of the BOX nights, not of the indices. **Fragmentation candidate TESTED 2026-09-22 (bands pre-stated 10:09Z): INDETERMINATE by the rule (the HIGH stratum has 4 nights) and leaning against** — stratified by H10 session-file count at the median (2), the 19 LOW nights (1–2 sessions, effectively contiguous) sit at Spearman 0.08 and fragment count does not track \|Δ\| (0.08); the least-fragmented box nights do not recover toward the phone's 0.63. Next candidate named from the data, not fitted: the box captures the SAME Verity unit at ≈ 52 Hz against ≈ 176 Hz on the phone (measured on one night each), a 3.4× coarser beat-timing grid on the PPG side; tested the same day. **Decimation test (bands pre-stated 11:05Z):** the box's Verity setting is 55 Hz (Heron: 55.14 by device stamps; my per-night averages 51.6–55.1 include dropouts) against 176 Hz on the phone (SDK-mode menu vs normal mode — a configuration, handed to the capture-host lane); the 30 phone nights' PPG decimated to the 55 Hz grid by ROW-KEEPING (first original row per bin, nothing resampled) and re-scored: cross-node ρ **0.635 → 0.508** (average ranks; 0.4999 with order-broken ties — the instrument now uses average ranks and both are recorded), 7 of 30 PPG indices moved ≥ 10 %. ON THE BOUNDARY of the pre-stated 0.5 band: the grid explains roughly a fifth of the 0.63 → 0.05 gap, not the fall to the box level. **Verity-side fragmentation** (same bands, session-file count): LOW n=18 ρ −0.14, HIGH n=5 ρ 0.70 — indeterminate and opposite in sign; not the term either. **Within-night ACTIVE-WINDOW OVERLAP — run (bands pre-stated 10:27Z):** overlap = hours both scored streams cover ÷ hours either covers; **6 of 23 box nights overlap for less than 2 h** — the largest ECG fragment and the largest PPG fragment sit in different parts of the night, two indices over disjoint hours — and on the other 17, cutting both streams to the hours they both covered and re-scoring lifts the cross-node ρ from 0.05 to **0.26** (ρ(overlap, |Δ|) −0.08). INDETERMINATE by the bands (0.2 < 0.26 < 0.4) but in the candidate's direction: the drop cost comparability through WHERE it cut, not how much — which is the not-worn-drop audit's finding one layer up. Partial support, not a ruling. Documented-only: the Verity wear site. All of it under `fragmentStratification` / `verityFragmentStratification` / `candidatesTested` in the box record and `decimationTest` in the phone record. The owner rules on the numbers; nothing here changes a constant
- [x] rail leg: replace the global constant with a per-file rail — **LANDED 2026-09-19 in #2658** (`ecgRails()` + exact-equality match at the file's own `railHi`/`railLo`, gated with a wiring decoy) and **left unstamped by the session that landed it** — this box read "unassigned" for a day after the code merged, the `2026-09-13-executing-session-stamps-nothing` class, caught when the item was re-assigned as new work. The one surviving `31000` in `ecgdex-dsp.js` is the history comment above `ecgRails`.

**No threshold is proposed here.** 28-of-55 is a rate on 597 files and wants the census before anyone
moves a number.

**Fleet-Session:** Magpie

## 7 · Box census — 2026-09-20 (Heron, read-only)

**7.1 · The population is CLOSED, and the box adds nothing.** The item assumed the box holds ECG captures
only the box lane can read. Measured across every location `docs/CORPUS-LOCATIONS.md` names, deduplicated
by basename with identity confirmed by bytes (sha256 of the first 8 MB, the same method as §"Denominators"):

| location | distinct `_ECG.txt` | not in the rig corpus |
|---|---|---|
| rig `/srv/data/tepna-corpus` | **602** | — |
| vigil `/srv/tepna/captures` (2026-07-25 → 09-19) | 300 | **0** |
| TrueNAS `vigil-archive` | 300 | **0** |
| TrueNAS `tepna-corpus` | 602 | **0** |
| Synology | 0 | 0 |

All 300 box files are in the rig corpus: same basenames, same sizes, and **bytes-identical on all 8 hashed**,
including the three newest (09-18, 09-19 ×2). The rig corpus is the SUPERSET because it also carries the June
phone-PSL captures the box never had. So "beyond these 597 files" is not a box population; it is the rig
corpus growing **597 → 602** in the two days since §2 was measured. ⚠️ 4 of the 602 are **zero-byte**
`smoketest-captures/2026-07-16/17` files — inside the denominator, carrying no samples.

**7.2 · Rail-level census over all 602 — same instrument, and it reproduces §2's numbers exactly.**
Constant runs ≥200 samples classified with production `nightqc.rail_value` (byte-identical to its 09-18
form; the one commit since is mypy-only):

| | §2 (597) | all 602 | excluding the 3 files added since |
|---|---|---|---|
| samples | 315,020,756 | 321,386,283 | — |
| runs ≥200 | 112 | **117** | **112** ✓ |
| files with runs | 62 | 65 | **62** ✓ |
| distinct rail values | 29 | 31 | **29** ✓ |
| longest run | 1,721 | 1,721 | 1,721 ✓ |
| at the file's own rail | 108 | 111 | **108** ✓ |

The four off-rail runs in the old population are §2's four: the two "`railHi` null" (09-12 `18131` and 09-15
`18597`, each within 3 µV of the NEGATED low rail — saturation the high-side detector declined to name) and
two near-rail (08-18 at 1.19 % of rail; 08-07 at **2.38 % of rail = 1.19 % of the rail-to-rail range**).
§2's "2 within 2 percent" holds only if the 2 % is of the RANGE; stated here so the next reader does not
re-derive it. **0 mid-range runs**, as before.

**7.3 · The increment — 5 runs in 3 September box files, all at or within 0.2 % of a per-file rail:**

| file | runs (samples) | rail | note |
|---|---|---|---|
| `Polar_H10_02849638_20260916222657` | 353, 837 | 18064 | at 18031, 33 µV inside the rail |
| `Polar_H10_02849638_20260917221148` | 570 | 18197 | at rail |
| `Polar_H10_02849638_20260919183658` | 226, 1533 | **17164** | at rail, both in the first ~70 s of the file |

`17164` is a new low for the per-file rail — §2a's "rails are per file" now spans 17,164–19,600. The 09-18
file opens AT 18564 µV but carries no run ≥200. ⚠️ Only 4 of the 5 added files are identifiable by mtime —
rsync preserves it, and the 09-18 file list was not retained; the arithmetic above closes exactly if the fifth
is `20260916222657`, and closes under no other assignment I could construct. **A census should commit its
file list with hashes** so the next increment is derivable rather than reconstructed.

**What this does NOT do:** the 55 → 28 split is peak-conditional and needs `ecgdex-dsp.js`'s detector — the
rail leg's owner. The 3 files above are the entire increment; whether their 5 runs are bracketed and where
they fall against `GAP_S` is a ≤3-file JS run, handed over with paths rather than approximated here.

**Fleet-Session:** Heron

**7.4 · The increment, classified with the shipped detector (2026-09-20) — 28-of-55 does NOT extend.**
Same instrument as §2–3, run on `origin/main`'s `ECGDSP` (`parseECG` → `bandpass` → `detectPeaks`, rails
from `ecgRails`, runs ≥200 at the file's own rail by exact equality, then the §2b/§3 split: a detected peak
within ±130 ms ⇒ the flat leg LOOKS; otherwise the bracketing RR against `GAP_S = 10`):

| file | at-rail runs ≥200 | classification |
|---|---|---|
| `…20260917221148` | 1 — n=570 (4.39 s) at 18197 HI | peak within ±130 ms → **flat leg looks, caught** |
| `…20260919183658` | 2 — n=226 (1.74 s), n=1533 (11.80 s) at 17164 HI | both: peak within ±130 ms → **caught** |
| `…20260916222657` | **0** | the two runs (n=353, 837) sit at **18031** — not the file's rail by the detector's exact-equality rule |

So the three at-rail runs all join the **caught** side (55 → 58) and **none** the unexamined/median-filled side
(57 → 57, 28 → 28). The consequential population is unchanged at 28, and §3's numbers stand as written.

⚠️ **The two 09-16 runs are the §7.2 class, not a near-miss of the high rail.** Heron read 18031 as "33 µV
inside 18064". It is also **2 µV from the NEGATED low rail** (`railLo = −18033`) — the same shape as 09-12
`18131` and 09-15 `18597`, "saturation the high-side detector declined to name". That is now **three
instances**: a positive run that saturates at |railLo| rather than at railHi. Filed as residue
`2026-09-20-positive-saturation-at-negated-low-rail`; whether the matcher should accept ±railLo is a detector
change (moves ECGDex's `computeHash`) and is not taken here. Denominator: this is a 3-file classification and
carries no corpus denominator — §7's 602-vs-598 question is Heron's census's, not this table's.

**Fleet-Session:** Magpie

**7.5 · The matcher keyed on magnitude (owner ruling D9.3, built #2785, 2026-09-21).** Measured before writing:
the H10's positive pin sits **2–3 µV under |railLo|** on 5 of 5 files checked (−18033↔18031, −18133↔18131,
−18733↔18731, −18233↔18231, −18600↔18597), and on the three §7.2/§7.4 files a few stray OPENING samples above the
real pin (18 at 18064, 2 at 18597, 8 at 18731 — each at what looks like a previous session's rail) are the
outermost value, so the edge scan stops at the first value gap and returns the spike (09-16) or null (09-12,
09-15). `ecgRails` now mirrors each qualified rail through the same spike qualification and `computeSQI` keys on
the set; `quality.ecgRail.samples` counts rail samples over the WHOLE record, beat or no beat. Census over all
602 files (546 with samples): **exactly the three named files gain a mirror value** (4 runs ≥200, 4052 samples),
66 of 67 edge-found `railHi` agree with the mirror, 0 mirrors elsewhere. The three runs now join the *caught*
population (58 → 61); the median-filled 28 are unchanged, because the interval-level exclusion needs the
run-length cut PINNED-SPAN §7 leaves unchosen and is not built here.

**Fleet-Session:** Magpie
