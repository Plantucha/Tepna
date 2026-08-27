<!--
  WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-27 (**ten of eleven items executed; the eleventh was HANDED OFF, not left.** Verified 2026-08-27 in the file it names rather than from its own prose: the PAT item states *"nothing further is owed here"* and `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` exists, is IN-PROGRESS, and its header records `Follows: WEARABLE-HOST-AXIS-FOLLOWUPS §F3-ter` — so the transfer is acknowledged on both sides, which is what makes this DONE rather than a brief quietly dropping an item. Not a supersession: one item moved, the rest shipped here.)

# The O2Ring's axis was drawn on every night before 2026-07-28. Everything that used it as a clock has to be re-asked.

`WEARABLE-HOST-AXIS` fixed the axis. It did not re-derive the conclusions that were computed on the old
one. Those conclusions are not merely imprecise — one of the three sources in every three-body clock
measurement this repo has published was **`sample_index × 125.738 Hz`**, a drawn axis whose apparent ppm
is the error in an assumption.

## F1 · Detect drawn provenance, and declare it — **DONE 2026-08-02**

> ## ⚠ RETRACTED IN PART — 2026-08-05 (`DEEP-AUDIT-V` §2.7 F17)
>
> **The `quantizedShare ≥ 99 %` discriminator was correct when measured and is no longer sufficient.**
> On 2026-07-27 `capture-host/capture.py` gained a rate-SLEW estimator (`_O2PPG_EST_SLEW`): `step_s`
> now moves as the measured rate drifts, so the accumulated `sensor_ns` column stopped being a
> singleton delta set. Measured on a real 2026-08-03 night: **`quantizedShare` 0.00083**, i.e. the
> fingerprint is gone — while the axis became *more* synthetic, not less. `capture.py` accumulates
> `self.ns += step_ns` from a step estimated against HOST arrival times; the ring contributes sample
> ORDER and nothing else.
>
> Consequence: from 2026-07-27 until the fix, **every O2Ring night certified itself
> `timingSource:'device+host'` — the top provenance tier, the one that asserts a real second clock
> disciplined the recording.** The reasoning in this section is sound; what it did not anticipate is
> that the WRITER can erase the evidence the reader depends on.
>
> The verdict is now keyed on the **layout** (`site === 'finger'` — one channel, or several carrying
> byte-identical samples), which is the provenance fact itself rather than a statistical proxy for it.
> `quantizedShare` is still published raw, so a reader can see the fingerprint is absent while the
> verdict is drawn. **A detector that infers provenance from a signature is only as durable as the
> writer's habits** — prefer a fact the file states over one it happens to imply.


> **Converged independently with `O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF` (a parallel session).**
> That brief reaches the same mechanism from the raw bytes and states the same guardrail; this F1 is its
> execution. Of its §5 acceptance items, **three are now met**: `hostAxis` flags a capture-constructed
> axis by *provenance, not span* and says so in its return value; `dual-clock-rate.mjs` names the drawn
> cause instead of only reporting a wide spread (its "not a disciplined clock" note was true but blamed
> a crystal that is innocent — there is none in the file); and a gate detects a synthesised axis from the
> bytes so this cannot be rediscovered a third time. Its remaining items — voiding the O2Ring legs in
> `CLOCK-CLOSURE-THREE-SOURCE` / `CROSS-DEVICE-DRIFT-AND-CLOSURE`, and the `O2PPG_FS_DEFAULT`
> capture-side question — stay open here as F3 and in `capture-host/` respectively.

> ### ⛔ The proposed test does not work. Measured, not assumed.
> `first sensor timestamp == 0` was the candidate, and it is **true for every O2Ring fragment** —
> including the post-2026-07-28 *measured* ones carrying 1574–1861 distinct deltas. It separates
> **relative-epoch from absolute-epoch** (O2Ring vs Polar), not drawn from measured, so shipping it
> would have condemned exactly the good sessions. Checking it before building on it cost one query.

What does separate them is how much of the inter-sample delta distribution sits on **one value**:

| | modal delta share | verdict |
|---|---|---|
| O2Ring ≤ 2026-07-27 (16 files) | **100.0 %** | drawn |
| O2Ring 2026-07-28 → | **0.1 % / 0.0 %** | measured (−163 / −160 ppm, a real stable crystal) |
| Verity | 0.1 % | measured |

**Shipped.** `parsePPG` computes `quantizedShare` from the delta array it already builds (free — one
pass over an existing array), asserts `drawn` only at **≥99 %**, and always reports the share as a
NUMBER so a reader can judge the borderline instead of inheriting a verdict. The middle of the range is
genuinely ambiguous on short fragments, and a binary that pretends otherwise would be the same
over-claim this brief family exists to remove.

The field consumers must branch on is **`quality.timingSource`** (additive, contract-safe):

- `'device+host'` — device reported real timestamps, host-disciplined. **Usable as a clock.**
- `'host'` — the device column was drawn; all real timing came from the capture host, and the device
  contributed sample **order** only.
- `'none'` — drawn **and** no host anchors: the recording carries **no timing information at all** and
  must never be spent as a clock leg.

Gated, including a lock-out assertion so `first ns == 0` cannot be re-proposed without the test failing.
Building the gate exposed a second trap worth keeping: a **sawtooth** jitter has a near-constant first
difference, so the original "measured" synthetic scored **0.979** — itself a drawn-looking axis, nearly
passing for the opposite of the real reason. The jitter must be independent per sample (now 0.0015).

## F2 · Re-run the whole corpus under the disciplined axis — **DONE 2026-08-02**

Re-folded both source trees through `tools/trio-batch.mjs --force` (25 + 14 nights → **34 complete
trios**, 268 s).

> ### ⚠ The re-folded corpus is deliberately NOT committed, and that is a finding in itself
> A `--force` re-fold does not produce "the same exports with better timestamps". Measured on
> `ECGDex_2026-06-10`: the committed export is **32 KB / 1,694 lines**, the fresh one **1,007 KB /
> 68,158 lines** — 30× larger, and carrying two top-level keys the committed one does not have
> (`apnea`, `hrvStability`). Across the corpus that is **3.46 M inserted lines and 44 MB of new night
> directories**. The committed corpus was produced by an older, slimmer export profile, so re-committing
> now would fuse a timing correction with a wholesale shape-and-volume change in one commit, and nobody
> reading the history afterwards could separate them.
>
> The tracked files were therefore restored and only the *findings* land here. **Re-committing the
> corpus is its own work-unit**: decide the export profile first, land that alone, and only then re-fold
> for timing. The closure numbers below were measured from the fresh run before it was reverted.

### The asymmetry check held — and it is the result, not a formality

The brief predicted the O2Ring legs would move and the Polar pair barely would. **Closure moved by an
order of magnitude on both nights that have a directly comparable before/after** (same nights, same
tool, baseline = `CLOCK-CLOSURE-THREE-SOURCE` §1):

| night | closure BEFORE | closure AFTER | H10↔Verity BEFORE | AFTER |
|---|---|---|---|---|
| 2026-07-25 | **101.2 ppm** | **−15.5 ppm** — now `consistent` | 93.9 | 73 |
| 2026-07-28 | **58.4 ppm** | **−11.4 ppm** | 39.2 | 22 |

2026-07-25 now *passes* its own consistency test. 2026-07-28 is still flagged INCONSISTENT, but against
a tolerance that scales with leg drift and has tightened to 5 ppm — a stricter bar than it previously
failed at 58 ppm.

Best night of the fold: **2026-07-09 — 100 % beat correspondence vs a 24 % chance control, IQR 10 ms.**

## F3 · Three-cornered hat — the exposure was NARROWER than this brief claimed

**Correction to §F3 below.** `tools/tch-multinight.mjs`'s three corners are **ECGDex / PpgDex /
OxyDex**, and OxyDex ingests the O2Ring **CSV** — a 1 Hz series with real wall-clock `Time` stamps —
**not** the drawn `sensor timestamp [ns]` PPG axis. TCH also consumes **5-minute epoch medians**, which
an axis error of ≤18 s cannot materially move. So the HR-σ three-cornered hat was never exposed to the
drawn axis the way the *clock* work was, and the claim that "TCH is the most exposed" was wrong.

Measured, 28 estimated of 39 nights: median σ **ECGDex 0.91 / OxyDex 1.19 / PpgDex 3.44 bpm** against
the `MULTINIGHT-CORPUS-FINDINGS-2026-07-29` baseline of **0.91 / 1.09 / 2.71**. ECGDex is *identical*,
which is the signature of a corner the fix could not reach.

⚠ **PpgDex's 2.71 → 3.44 is NOT attributable to this change** and must not be reported as its effect:
the two runs cover different night sets (37 vs 28 estimated), so the medians are not matched. Resolving
it needs a per-night matched comparison, and the old per-night σ values were never recorded. Open.

## F3-quater · The corpus is CODE-MIXED — measured 2026-08-04

§F3 refused to attribute PpgDex's 2.71 → 3.44 because the two runs covered different night sets, and
asked for a per-night matched comparison. That comparison cannot be run, and the obstacle is not the
night set.

**Of the 40 trio nights, 25 carry `quality.timingSource` — the field the host-axis work added — and 15
do not.** The 15 were exported before that change and never regenerated (mtimes 2026-07-31 vs 08-03).
The split is **perfectly confounded with date**: every night 2026-06-10…07-13 is post, every night
07-16…07-30 is pre. So a comparison between date ranges is also a comparison between code versions, and
no subsetting of this corpus separates them.

**The size of the confound, one run, one estimator:**

| cohort | n | σ ECGDex | σ PpgDex | σ OxyDex |
|---|---|---|---|---|
| ALL (mixed) | 35 | 0.65 | **2.71** | 1.12 |
| post-host-axis | 23 | 0.49 | **2.54** | 1.11 |
| pre-host-axis | 12 | 1.03 | **4.02** | 1.35 |

The cohorts differ by **1.5 bpm of PpgDex σ — larger than the 0.73 bpm shift §F3 was trying to
attribute** — so any median over this corpus tracks the mix, and both 2.71 and 3.44 sit inside that
range. §F3's "not attributable" was right; this is the mechanism, and it is now computed rather than
suspected.

⚠ **Do not read the cohort medians as the change's effect either.** Code version and date are the same
variable here. The 1.5 bpm is an upper bound on what the mix can explain, not an estimate of what the
host-axis change did. **The remedy is to regenerate the 15 stale nights**, after which the comparison
becomes matched by construction.

### Gated, and it fails CLOSED

`tools/tch-corpus.js` (pure, both lanes) computes the cohort split from a marker the export itself
carries, and `tch-multinight.mjs` now prints the verdict **before** the medians it qualifies — printing
first and qualifying afterwards is the ordering bug `drift-report.js` was extracted to fix. Four states,
one of which licenses the number: `homogeneous` (quotable) · `mixed` (pair the nights) · `confounded`
(regenerate, do not subset) · `unreadable`.

**`unreadable` is the load-bearing state.** An unmarked night's cohort is `pre-host-axis`, so a reader
that silently stops populating markers makes *every* night pre and the corpus reads HOMOGENEOUS — a green
verdict produced by reading nothing. That is not hypothetical: it happened on the first wiring of this
module, when `runNight` rebuilt its row object and dropped the field, and a corpus measured at 25/15
printed *"all 40 night(s) from one producing code version"*. "No night carries the marker" cannot be told
apart from "the marker was never read", so it is refused. Gated by 16 assertions, three mutants each
confirmed to red (removing the fail-closed branch: 6 legs; disabling date-confounding: 6; treating an
unmarked night as post: 18).

### Per-night σ — recorded, so the next comparison is matched

`est ✓` = contributed to the medians; `—` = excluded for negative classic variance (the boundary case,
where a member's σ is ~0 by construction rather than by measurement).

| night | cohort | n | σ ECGDex | σ PpgDex | σ OxyDex | est |
|---|---|---|---|---|---|---|
| 2026-06-10 | post | 85 | 0.17 | 0.48 | 1.03 | ✓ |
| 2026-06-11 | post | 92 | 0.80 | 2.71 | 0.01 | ✓ |
| 2026-06-12 | post | 85 | 1.27 | 7.16 | 2.16 | ✓ |
| 2026-06-14 | post | 88 | 0.69 | 3.17 | 0.01 | ✓ |
| 2026-06-15 | post | 83 | 0.04 | 7.02 | 1.49 | ✓ |
| 2026-06-16 | post | 71 | 0.24 | 5.33 | 1.11 | ✓ |
| 2026-06-19 | post | 77 | 0.56 | 0.37 | 0.81 | ✓ |
| 2026-06-20 | post | 88 | 0.60 | 3.21 | 2.05 | ✓ |
| 2026-06-24 | post | 73 | 1.23 | 1.85 | 0.07 | — |
| 2026-06-25 | post | 83 | 0.65 | 4.35 | 1.12 | ✓ |
| 2026-06-27 | post | 82 | 0.27 | 2.54 | 1.47 | ✓ |
| 2026-06-28 | post | 84 | 0.33 | 0.91 | 3.25 | ✓ |
| 2026-06-29 | post | 67 | 1.29 | 4.47 | 0.04 | ✓ |
| 2026-06-30 | post | 67 | 0.91 | 1.45 | 1.64 | ✓ |
| 2026-07-01 | post | 86 | 0.49 | 0.32 | 0.52 | ✓ |
| 2026-07-02 | post | 67 | 0.06 | 0.44 | 1.16 | ✓ |
| 2026-07-04 | post | 44 | 0.02 | 10.45 | 1.28 | ✓ |
| 2026-07-05 | post | 57 | 0.27 | 0.44 | 0.83 | ✓ |
| 2026-07-06 | post | 80 | 0.95 | 6.22 | 0.04 | ✓ |
| 2026-07-07 | post | 74 | 3.36 | 5.19 | 0.01 | — |
| 2026-07-08 | post | 71 | 0.46 | 2.42 | 1.67 | ✓ |
| 2026-07-09 | post | 82 | 0.29 | 0.00 | 0.85 | ✓ |
| 2026-07-11 | post | 20 | 0.30 | 1.03 | 0.44 | ✓ |
| 2026-07-12 | post | 81 | 0.78 | 6.67 | 0.03 | ✓ |
| 2026-07-13 | post | 73 | 0.87 | 1.54 | 3.00 | ✓ |
| 2026-07-16 | **pre** | 71 | 1.18 | 7.56 | 0.02 | — |
| 2026-07-17 | **pre** | 85 | 1.11 | 0.01 | 1.64 | — |
| 2026-07-18 | **pre** | 112 | 3.08 | 2.24 | 2.02 | ✓ |
| 2026-07-19 | **pre** | 84 | 1.51 | 6.15 | 2.01 | ✓ |
| 2026-07-20 | **pre** | 83 | 0.52 | 0.72 | 0.89 | ✓ |
| 2026-07-21 | **pre** | 78 | 1.16 | 3.07 | 0.02 | ✓ |
| 2026-07-22 | **pre** | 81 | 3.64 | 5.52 | 1.84 | ✓ |
| 2026-07-23 | **pre** | 31 | 1.86 | 7.29 | 0.02 | ✓ |
| 2026-07-24 | **pre** | 70 | 0.84 | 0.01 | 2.35 | ✓ |
| 2026-07-25 | **pre** | 97 | 0.02 | 1.51 | 3.30 | ✓ |
| 2026-07-26 | **pre** | 89 | 0.85 | 1.51 | 0.01 | — |
| 2026-07-27 | **pre** | 87 | 0.76 | 1.34 | 0.87 | ✓ |
| 2026-07-28 | **pre** | 89 | 1.29 | 4.97 | 1.29 | ✓ |
| 2026-07-29 | **pre** | 34 | 0.90 | 5.77 | 0.01 | ✓ |
| 2026-07-30 | **pre** | 84 | 0.01 | 5.73 | 1.41 | ✓ |

## F3-ter · PAT re-run, and the refusal wired — **DONE 2026-08-02**

> ### ⚠️ RETRACTED 2026-08-02 (same day) — see F7. The conclusion below does not hold.
>
> "PAT is not alignment-limited" was drawn from a harness that **fitted a free offset per block**, which
> absorbs exactly the quantity PAT is. Its own tell was in the table: a median lag of 406–498 ms is not
> physiological for an arm site. Re-run with the offset held fixed at the ACC anchor, PAT is **locked** —
> within-hour IQR 102–197 ms and a starting lag of 236 ms, squarely in the arm band — under a ramp of
> ~188 ms/h that the fitted harness had been silently eating.
>
> The ramp is **not** explained, and the two instruments that should adjudicate it are both unfit:
> `alignEnvelopes.driftPpm` is not identifiable on this corpus (F7), and the night the ramp was measured
> on is a 21-hour daytime capture with 5.2 h of gaps, not a sleep night. **The honest state is: PAT is
> reachable and unresolved.** The `Done when` box is un-ticked.
>
> ⚠️ **The remedy first written here — "re-measure on a clean single-segment sleep night with the ACC
> anchor carried end-to-end" — was itself wrong, and was executed and disproved the same day.** Run on
> 2026-07-09 (6.86 h, ZERO gaps, not drawn — the cleanest night the corpus has), the ACC anchor does not
> lock PAT at all (hourly IQR 177–925 ms), while a single global beat offset nearly reaches the bar
> (67–138 ms vs ≤60). The ACC and beat anchors are **3.40 s** apart — far more than PAT can explain, and
> not a comb alias (3.42 RR). The ACC↔ACC offset is not valid for the ECG/PPG streams, most likely because
> they are different BLE characteristics with different phone-side buffering.
> **Continued in `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`, which owns PAT from here.**

### PAT is not alignment-limited. That is the answer, and it is a negative one.

Per-block PAT re-run on the disciplined axis, scored by the repo's own `pat-gate.js`, 9 measurable
nights of the fresh fold:

| | measured | gate bar |
|---|---|---|
| beat-to-beat residual IQR | **130–215 ms** | ≤ 60 ms |
| drift range across blocks | **355–462 ms** | ≤ 60 ms |
| median lag | 406–498 ms | ✓ inside [60, 700] |

**WEAK COUPLING on every night.** `PAT-UNDER-PERBLOCK-ALIGNMENT` measured 139–197 ms before the fix;
this is 130–215 after. **Essentially unchanged** — so host-disciplining the axis, which removed up to
18.5 s of error, moved the PAT residual by nothing. The obstacle was never alignment precision, and no
further clock work will unlock PAT. That closes the open question in that brief's §5 as a NO on
single-site optical, on evidence rather than fatigue.

(The coupling leg remains weak in the way that brief already flagged: matchRate 86–96 % against a
**52–69 %** chance control, so the margin is small and the `matchRate` floor is still the wrong statistic.)

### A leg with no timing is now refused, by a computed flag

`fitClockClosure` accepts `timingSource` per source and **excludes** a `'none'` leg — drawn axis *and*
no host anchors, i.e. no timing information exists — refusing with the leg named rather than returning a
confident number about nothing. An omitted `timingSource` stays usable, so every existing caller is
byte-unchanged. Two `'host'` legs raise `sharedHostTimebase`: they still close, but they are less
independent than the identity's derivation assumes, and a reader should be told.

`trio-batch` passes it through from each export's `quality.timingSource`, and prints the refusal —
because printing nothing is how a drawn leg stayed invisible for six nights.

### Two defects found by wiring it to real data, not by inspection

1. **The field was null on every folded night.** `mergePpg` rebuilt the rec and dropped `hostAxis`, so
   `quality.timingSource` existed and was never populated — the hollow-gate failure class again. Only
   running it against the corpus showed it; the unit test was green throughout.
2. **A worst-case merge rule refused a good night.** Taking the weakest fragment's verdict voided
   2026-07-28 — a night whose O2Ring genuinely reports real timestamps and which closes at −11.4 ppm —
   because one short fragment had too few host anchors to judge. Now **sample-weighted**, which makes the
   merged verdict equal to what the single-file detector would say on the concatenated fragments.

Verified end-to-end against the raw-file finding, which it reproduces independently:

| night | `timingSource` | drawn | quantized share |
|---|---|---|---|
| 2026-07-26 O2Ring | `host` | **true** | **1.00** |
| 2026-07-28 O2Ring | `device+host` | false | 0.0074 |
| 2026-07-26 Verity | `device+host` | false | 0.0188 |

## F3-bis · Still open after the re-run

- **`CLOCK-CLOSURE-THREE-SOURCE-2026-08-01` §1 is now superseded by measurement** — its six-night table
  is the pre-fix regime. Two of its nights have been re-measured above; the other four need re-folding
  with a third source present, and the table should be annotated rather than silently left standing.
- **`CROSS-DEVICE-CLOCK-SKEW-2026-07-29`**, **`MULTINIGHT-CORPUS-FINDINGS-2026-07-29`** — still to be
  audited for O2Ring-timing dependence; the latter is also the source of the TCH baseline used above.
- **`integrator-tch.js` / `TCH-REFERENCE-VALIDATION`** — the *kernel's* independence assumption is
  unaffected by the drawn axis (see F3). The closure refusal is wired; the TCH kernel itself still does
  not consult `timingSource`, which matters only if a future caller feeds it beat-derived legs.

## F4 · `papers/` audit — **DONE 2026-08-02**

- **`papers/wearable-clock-drift.html`** — already carries two correction banners. It needs a third pass
  folding in the direct measurement (H10 ≈ −20, Verity ≈ −27, inter-device ≈ 7 ppm) and the drawn-axis
  finding, and it should stop presenting any O2Ring-derived ppm as a crystal property.
- **`papers/timestamp-pathology.html`** — its subject *is* consumer-export timestamp pathology. A drawn
  axis with a calibrated-but-wrong constant is the strongest specimen this corpus has produced, and the
  paper predates knowing it. Strong candidate for a new §Results case rather than a correction.
- **`briefs/O2RING-PROTOCOL-2026-07-17-BRIEF.md`** §109–111 — the source of the 125.738 Hz calibration.
  Do **not** retract the measurement (it is a real fit over 2.6 M samples); add a header note that the
  constant cannot hold because the delivered rate varies per session, pointing at the host-axis fix.

### F4-RESULT — executed 2026-08-02

**Bullet 1 was already applied** by the parallel session that wrote `WEARABLE-DRIFT-DIRECT`: the paper
carries the direct measurement (H10 ≈ −20, Verity ≈ −27, inter-device ≈ 7 ppm), the span-vs-leverage
correction, and an explicit statement that the ring's apparent ppm is the error in an assumed constant
rather than a crystal property. Checked in the file before writing anything — the box was owed less than
it looked. (`WEARABLE-DRIFT-DIRECT`'s own Done-when marks the scope-note correction *(owner)* because it
was "another session's paper"; that session's work has since merged, and the correction is factual and
docs-only, so it was completed here rather than left pending on a merged coordination concern.)

**Bullet 2 — `papers/timestamp-pathology.html` gains §3.1, and it is a RESULT, not a correction.** The
paper's Table 1 failures are all visible in the bytes; a synthesised axis is not. The parser resolves it
flawlessly and violates none of B1–B6, because there is nothing malformed to object to. So the honest
framing is that a correct parser is **necessary and not sufficient** — provenance is a separate
obligation from syntax, and no result in Tables 1–2 speaks to it. The subsection carries the modal-delta
table (100.0 % on the 16 pre-2026-07-28 O2Ring files vs 0.1 %/0.0 % after; Verity 0.1 %), the
+783 ppm / +92 ppm same-night fragment pair, and the **rejected** `first ns == 0` detector plus the
sawtooth trap — kept because the rejections are the transferable part.

⚠️ It is marked explicitly as a **corpus observation, not a regenerated benchmark row**. Tables 1–2 are
produced live by `timestamp-pathology-analysis.html`, which exercises the parser; this class is by
definition invisible to that tool, and letting the new material inherit the "regenerated live" claim
would be exactly the over-reach the subsection is about.

**Bullet 3 — `O2RING-PROTOCOL` header note, not a retraction.** The 125.738 Hz fit stands as a
measurement over 2 616 483 samples; what it cannot be is a *timebase*, since the section's own recorded
per-session spread (125.59–125.88 Hz) is a delivered rate no single constant represents. The note states
the guardrail explicitly so the obvious wrong move is closed off: **do not re-calibrate the constant** —
a better constant makes the drawn axis more plausible without making it a measurement.

## F5 · `trio-batch` prints an unclosed ppm, and none of it is gated — **DONE 2026-08-02**

Deliberately left alone by owner decision during `WEARABLE-HOST-AXIS`, recorded here so it is not lost:
`printDriftFit` prints `${r.driftPpm} ppm` and converts it to a seconds-per-night claim with **no
knowledge of the closure verdict computed 20 lines below**, contradicting both drift briefs' §6
guardrail. `printDriftFit`/`printClockFit` have **zero test coverage** — every clock assertion in
`tests/dex-tests.js` targets `fitClockClosure`'s own unit group, none the trio wiring.

### F5.1 · The ordering was the defect, and the seconds claim was the damage

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §6 is unambiguous — *"Do not quote a ppm figure that has not
closed … they are indistinguishable from real measurements without the closure column beside them."*
The printer computed that column **twenty lines after** it had already printed the number, and worse,
after it had converted the number into **"2.13 s over the night"**, which reads as a physical fact
rather than a fit. Closure is now computed **first** and the verdict closes the line.

A ppm is quoted as a measurement in exactly one state. The four are kept distinct because *"no third
sensor was worn"* and *"a third sensor was worn and its axis was drawn"* are different facts about a
night, and collapsing them is how six nights of `CLOCK-CLOSURE-THREE-SOURCE` read as clean absences:

| state | line | seconds claim |
|---|---|---|
| `closed` — closure consistent | `88 ppm (2.99 s over 563 min) … — closure 2.3 ppm consistent` | **yes** |
| `inconsistent` — closure fails the identity | `… — VOID (closure 100.9 ppm INCONSISTENT …): not a measurement` | no |
| `refused` — a leg has a drawn axis | `… — UNCLOSED (closure refused — …): not a measurement` | no |
| `unclosed` — no third source at all | `… — UNCLOSED (no third source): not a measurement` | no |

The number is still **shown** in every state, marked. Hiding it would cost the diagnostic, and the
guardrail asks for the closure column beside the figure, not for the figure's removal.

### F5.2 · The case it catches, on real data

Re-running the corpus, **2026-07-16** prints:

```
⏱ H10↔Verity drift: -10 ppm over 485 min, offset 0.40 s   corr 99% vs chance 19%   IQR 42 ms
                                                          — UNCLOSED (no third source): not a measurement
```

**99 % correspondence against a 19 % chance floor** — the most confident-looking per-leg fit in the
set — with no third source to check it. Under the old printer this was `-10 ppm (-0.29 s over
485 min)`: a clean, quotable-looking measurement that nothing had tested. That is precisely the
"unwrap failure wearing the same units" §6 warns about, and it is now labelled at the point of
printing rather than in a brief someone has to remember to read.

Nights that DO close are unaffected — 07-25, 07-26 and 08-01 all print the licensed form — so the
change speaks up only where the evidence is missing.

### F5.3 · An observation the new line makes visible: these fits are pressed against their own bound

Now that the bound warning and the closure verdict sit on the same line, a pattern is legible:
**2026-08-01 reads 88 ppm against an 89 ppm search bound; 07-25 reads 85 against 96.** A fit at its
ceiling is reporting the *instrument*, not the pair (a planted 250 ppm reads 49 when the window cannot
hold it). Two of the three nights that "close consistently" are in that regime — and
`WEARABLE-DRIFT-DIRECT` measured the true inter-device rate at **≈ 7 ppm** straight from the host
column, 12× below these. So closure being consistent is **necessary and not sufficient**: three legs
can agree while all three are pinned by the same window. Recorded, not acted on — widening the search
is a change to `fitClockDrift` and belongs with the beat-derived estimator, not with its printer.

### F5.4 · How it is gated

`printDriftFit`/`printClockFit` had zero coverage for a structural reason: nothing in
`trio-batch.mjs` is callable from a test, because its night loop runs at import. The formatters are
now a pure module — **`tools/drift-report.js`** (`driftVerdict` · `driftFitLine` · `closureLine` ·
`clockFitLine`; no fs, no console, no Date) — loaded in **both** lanes, so the WORDING of a claim is
gated the same way its arithmetic is. 37 assertions in `trio-batch · drift-report`.

Eight mutants applied and each confirmed to red the gate — the seconds claim ungated, the verdict
clause dropped, the consistency test inverted, a refusal treated as an absence, a missing closure not
caught, nothing ever quotable, the span dropped, and the caller's ordering reverted:

```
M1 seconds claim ungated        → 3 failed     M5 missing closure not caught → 1 failed
M2 verdict clause dropped       → 1 failed     M6 nothing is ever quotable   → 1 failed
M3 consistency inverted         → 8 failed     M7 span dropped from unclosed → 1 failed
M4 refusal treated as absence   → 2 failed     M8 caller ordering reverted   → 1 failed
```

M8 is the source-order assert, and it is worth keeping even though the regression it guards is
fail-safe: a closure not yet computed is `null`, which prints UNCLOSED rather than a false number.
"The wrong answer is merely useless rather than false" is not a reason to allow it back.

## F6 · Carry a slim beat array onto the fusion rec — **DONE 2026-08-02**

Inherited from `WEARABLE-DRIFT-FIT` §5 and still open: `runFusion` drops `timeseries`, so beat times are
unreachable there and the drift/closure work cannot run inside the Integrator. Unchanged by this work.

### F6-RESULT — the carrier, and a second observer that is not allowed to decide

**The carrier.** `_beatTimes` reconstructs absolute beat instants from `timeseries.rr.tSec` (ECGDex) or
`timeseries.ppi.tSec` (PpgDex/PulseDex) — already in the export contract, so **no emitter change and no
contract change** — and hangs them on the rec as a packed `Float64Array`. P9's reason for dropping the
whole `json` stands and is respected: a 7 h night is ~30 k beats ≈ **240 kB**, against the several MB the
full `timeseries` block cost per recording. Nothing else from `timeseries` is retained.

**Corrected intervals are excluded.** Both emitters mark interpolated / Malik-corrected intervals in a
parallel `corrected[]`, and a corrected interval's endpoint is a beat *nobody observed*. Feeding those to
a timing estimator is the same class of error as reading a drawn axis as a clock — fabricated instants
that a correspondence check will happily agree on, because both legs were smoothed toward the same place.

**The consumer, and its limits.** `detectClockSkew` now publishes `beatCheck` beside its findings. The
two observers answer *different* questions and neither replaces the other:

| | range | resolution | sees |
|---|---|---|---|
| event coincidence (existing) | ±120 s, 30 s grid | tens of seconds | a 42-minute device skew |
| `fitClockDrift` on beats (new) | **±3 s** | 20 ms | a **0.2–3.3 s** offset the event path calls "aligned" |

That band is not hypothetical — it is the H10↔Verity offset this corpus actually shows, invisible to a
±120 s tolerance and fatal to anything beat-level. **It corroborates and does not decide:** `skewApplied`
shifts real event times, and the gate asserts the event-derived `findings` and `pairs` are byte-identical
with and without beats. An offset beyond the search range comes back **not confident** (a 12 s plant
returns a plausible-looking 1.35 s, and is refused), and `disagrees` is only ever issued off a confident
fit.

**Gated** (`integrator-dsp · fusion-beats`, 22 assertions, both lanes) with 10 mutants confirmed to red:
corrected beats included, `t0` dropped, seconds not scaled to ms, source hard-coded, boxed-Array carrier,
carrier never populated, always-confident, no lone-node refusal, and the min-beats guard.

Two things worth keeping from building it: a throw inside `adaptEnvelopeNode` is swallowed by
`normalizeFile`'s `catch` into `recs: []` + a warning, so a typo'd variable (`t0` for `t0Ms`) surfaced 48
tests later as `r.node of undefined` rather than at its source; and `instanceof Float64Array` is
**realm-bound** — the DSP runs in its own `node:vm` context, so the brand check has to be
`Object.prototype.toString`, which is why the first version of that assertion failed against a genuine
Float64Array.

## F7 · A host-axis RATE needs a BASELINE — **DONE 2026-08-02**

Chasing the retracted PAT ramp found a defect this brief's own parent shipped. `DexClock.hostAxis`
deliberately carries no span gate, and the justification is sound — it interpolates measured divergence
rather than quoting a rate, so its residual is self-limiting. **That reasoning covers PpgDex, which
consumes `correctionAt()`. It does not cover ECGDex, which is the one consumer that reads `.ppm`.** A
rate divides by the span; on a short fragment the denominator collapses and ordinary host-stamp wander
(287 ms measured) is amplified into a fabricated crystal. It is the same size-not-span defect fixed in
`tools/dual-clock-rate.mjs`, reintroduced two weeks later in the one place that tool's fix did not reach.

|ppm| by fragment span, 260 ECG fragments of the 2026-07-16..29 corpus:

| span | median | max | | span | median | max |
|---|---|---|---|---|---|---|
| <60 s | 1208 | 16512 | | 600–1200 s | 43 | 196 |
| 60–120 s | 714 | 24036 | | 1200–2400 s | 42 | 151 |
| 120–300 s | 177 | 23235 | | 2400–4800 s | 20 | **52** |
| 300–600 s | 74 | 464 | | >4800 s | 22 | **31** |

The real H10 crystal is ~−25 ppm. Gate at **2400 s**, where max |ppm| reaches 52 and nothing exceeds 100.
Fleet `fs` spread falls **129.9072–133.2017 Hz (25341 ppm) → 52 ppm**.

Refused ⇒ `fs` keeps the device crystal (~25 ppm wrong) instead of the ungated correction (up to 24036 ppm
wrong). **`hostAxis.ok` no longer implies the correction reached the axis; consumers must read `applied`.**

### How much this actually changes — MEASURED, after the claim was made without measuring

The commit and the `ecgdex-dsp.js` comment justify this fix by saying `fs` also builds the bandpass
coefficients and drives `detectPeaks`/`refinePeaks`, so a wrong rate mis-designs the filter. **That leg is
wrong.** Run gated vs ungated through `analyze` on 238 analyzable real fragments (197 with `fs` changed):

| | fragments differing | max delta |
|---|---|---|
| HR | 45 / 197 (23 %) | **2.10 bpm** |
| SDNN | 39 / 197 (20 %) | 1.00 ms |
| rMSSD | 29 / 197 (15 %) | 0.90 ms |
| **beat count** | **0 / 197** | — |
| durSec | — | median 38 ms, **max 3.21 s** |

**Peak detection is robust to a 2.5 % rate error — not one fragment gained or lost a beat.** The real
consequence is the **time axis and the HRV values riding on it**, not the detector. The mechanism was
asserted rather than measured, which is the habit `ui-export-paths-broken` names; the numbers above are
the correction. `ecgdex-dsp.js`'s comment still carries the overstated version — fix it on the next edit
to that file rather than spending a bundle + regen + re-verify cycle on a comment.

What survives, and is the case for the fix: **21.95 % of all ECG samples in the corpus** sit in fragments
whose `fs` the gate changed (4.28 % – 44.14 % per night — every night affected, not a rare tail), and the
worst single fragment's timeline was off by **3.21 s across 138 s**. Against H10↔Verity offsets of 0.20 s,
a 3.2 s error is not a rounding difference — it is larger than the quantity this whole brief is measuring.

### …but the COMMITTED corpus does not need re-folding for it, and that had to be checked separately

The obvious inference from 21.95 % is that `uploads/trio/` is stale and F2's deferred re-fold is now owed.
**Measured, it is not.** That 21.95 % is the **box tree** (`tepna-smoketest/captures`, 2026-07-16..30);
`uploads/trio/` was folded from the **older tree** (`Ecg nightly/`, 2026-06-10..07-12), and the two
fragment completely differently:

| | box tree | old tree (`uploads/trio` source) |
|---|---|---|
| fragments the gate changes | — | 22.0 % (50 parsed) |
| **share of SAMPLES affected** | **21.95 %** | **1.16 %** |
| worst per-fragment timeline drift | 3210 ms | **1 ms** |
| median fragment span | 31–233 s | **19 976 s (5.5 h)** |

The same *fraction of fragments* moves in both, but on the phone-captured tree those fragments are slivers
beside 5½-hour continuous recordings, whereas the box tree reconnects constantly — consistent with the
known capture-host BLE adapter fault — so its stubs carry real sample weight. **A re-fold on account
of the span gate would move the committed exports by ~1 ms.** F2's re-commit work-unit stands on its own
export-profile grounds; it is NOT owed to this fix. Percentages measured on one tree do not transfer to
another whose capture topology differs — the same trap as the unmatched 2.71 → 3.44 σ comparison in F3.

`mergeEcg` also tightened: the fs bound 0.5 Hz → 0.05 Hz (the old one was loose enough to admit the bad
fragment yet tight enough to throw on it, so good nights failed to fold for the wrong reason); the imposed
`fs` now comes from the **longest** fragment, not `recs[0]` — routinely a seconds-long reconnect stub
carrying the raw crystal; and a negative session boundary is counted and warned rather than dropped
(0 occurrences on the corpus — a tripwire, not a live correction).

### The instrument that was supposed to check this is itself unfit

`alignEnvelopes.driftPpm` **is not identifiable on this corpus** and should not be used or quoted:

- Three fits of the *same* usable windows span 0 → 720 ppm on several nights (2026-07-29: Theil–Sen 0.0,
  OLS −485.5, endpoint −720.4).
- **7 of 14 nights return exactly `0.0` ppm** — an atom at zero, produced when the pairwise-slope median
  lands inside a tie block of within-plateau pairs. Not a measurement.
- `madSec` is degenerate alongside it: on 2026-07-26, 15 of 28 windows sit exactly on the median, so MAD
  reports `0.00` while two windows sit 1.2 s away. It is presented as precision and is not.
- `−181.8 ppm` shipped as `MEASURED` on 2026-07-17.

The *offsets* are unaffected and remain trustworthy (median 0.20 s; |offset| > 1 s on 0 of 13 nights). A
tested-and-rejected explanation, recorded so it is not re-proposed: the lag changes are **not** caused by
BLE reconnections — median |Δlag| 0.20 s with a reconnection between windows vs 0.10 s without, n=41 vs
172, Mann–Whitney z=0.22, **p=0.83**. Fixing `driftPpm` is NOT in this brief; it is written up here
because two conclusions in this file were built on it.

### F8 · The drift term now REFUSES — **DONE 2026-08-02**

The line above ("fixing `driftPpm` is NOT in this brief") is superseded: it is fixed, because the box
below asked for exactly one of *"refuses or is fixed"* and refusing is the honest half.

**The rule.** `alignEnvelopes` computes the distribution-free interval for its Theil–Sen slope (Sen
1968, order-statistic interval; `C = z·sqrt(n(n−1)(2n+5)/18)`) and publishes `driftPpm` **only when
that interval excludes zero**. `driftCiPpm` is published either way — the interval is the honest
result even when the point estimate is not — together with `driftIdentifiable`, `driftTieFrac` and a
`driftReason` naming which way it failed. This says *not identifiable*, **not** *no drift*: an
unidentifiable slope and a true zero are indistinguishable here, and conflating them was the error.

**Measured on the corpus, and it is worse than this brief said.** `wearable-sync --fs 4` over the
17 available nights:

```
15 of 17 night(s) measured.
offset: median 0.25 s   range 0.00 … 0.50 s   |offset| > 1 s on 0 of 15
drift : NOT IDENTIFIABLE on 15 of 15 measured night(s)
```

Not "7 of 14 are an atom at zero" — **every night is unidentifiable**, and the tool printed a ppm for
all of them. Re-run at the tool's real **10 Hz** default (2.5x the lag resolution, so the strongest case
the instrument can make for itself) the verdict is identical — **15 of 15 not identifiable**, offsets
median **0.20 s**, range 0.10–0.40 s. That median is the same 0.20 s this brief already recorded for the
offsets, so the two runs agree on the quantity that survives and agree on the one that does not. The `MAD spread` column shows why the old `madSec` could not reveal it: MAD reads `0.00`
on eight of these nights while the lag spread on the same nights runs to 20–29 s.

### F8.1 · Corpus-wide verification — 48 nights, and the refusal tracks RESOLUTION exactly

The original result was measured on the 17-night box corpus. Re-run across **every night available**,
both capture trees:

| corpus | nights | measured | drift identifiable | offset median |
|---|---|---|---|---|
| `Ecg nightly` (phone-captured) | 31 | 27 | **0 of 27** | **3.25 s** — all 27 exceed 1 s |
| `captures` (box-captured) | 17 | 15 | **0 of 15** | **0.25 s** — 0 of 15 exceed 1 s |
| **total, at `--fs 4`** | **48** | **42** | **0 of 42** | |

⚠️ **That 42/42 is an `--fs 4` figure, and the full-resolution answer is different — better, and worth
stating rather than rounding away.** Re-run at the tool's real **10 Hz** default (2.5× the lag
resolution), the phone tree yields **3 of 26 nights identifiable**, at **5.0 / 15.2 / 15.9 ppm**. The box
tree stays 0 of 15.

**This is the strongest evidence in the whole brief family, and it is a positive result, not a negative
one.** Three independent facts line up:

- The refusal is **not a mute**. Raise the resolution 2.5× and real nights cross the bar — the gate has a
  boundary that moves with the instrument, exactly as the planted-drift sweep predicted.
- The three values that clear it sit at **5–16 ppm**, i.e. at and just above the measured floor of
  7–10 ppm. Nothing implausible got through.
- They agree with **`WEARABLE-DRIFT-DIRECT`'s ≈ 7 ppm**, obtained a completely different way — regressing
  the host column against the device column, no beat matching, no blocks, no unwrapping. A beat-derived
  estimator and a raw-column estimator converging on the same few-ppm figure is a real cross-validation,
  and it is only visible because the unidentifiable nights stopped drowning it in noise.

The **offsets** are the control that proves the function still measures what it can: 3.25 s on
phone-captured nights against 0.20–0.25 s on box nights, reproducing the split established separately in
[[wearable-clocks-diverge]] without being told about it. The same code that refuses every drift on 42
nights recovers that difference cleanly.

**Why it was never resolvable, quantitatively.** The lag axis is quantised at `1/fsHz`, so the
smallest slope distinguishable from zero is about one quantum over the fitted span. Planted-drift
recovery at the tool's own defaults (10 Hz, 7 h) puts the floor between 7 and 10 ppm:

| planted | 50 | 27 | 20 | 10 | 7 | 0 |
|---|---|---|---|---|---|---|
| reported | 50.0 | 27.03 | 19.9 | 8.77 | **refused** | **refused** |

`WEARABLE-DRIFT-DIRECT` measured the true H10↔Verity rate at **≈ 7 ppm** — sitting exactly on this
instrument's floor. The estimator was never able to see the quantity it was being asked for, which is
the real content of "0 → 720 ppm across three fits of the same windows". **Honest caveat:** at the
10 ppm row the interval `[7.25, 9.8]` does **not** cover the planted 10, so near the floor the nominal
95 % is optimistic — the quantised lags violate the continuity Sen's interval assumes. It is quoted as
a floor, not as calibrated coverage.

#### Two things this got wrong on the way, both caught by surviving mutants

1. **A tie-fraction refusal is WRONG and must not be re-added.** The first implementation also refused
   when ≥50 % of pairwise slopes sat exactly on the median, reasoning that the median was then a
   plateau's tie value. It refuses the zero atom correctly — and it *also refuses a correctly-measured
   ramp*: at a planted **900 ppm** the interval is `[833, 926]` (bracketing the truth) while `tieFrac`
   is 0.59, because evenly-spaced windows climbing one quantum at a time produce many pairs with
   identical Δt **and** identical Δlag. A high tie fraction is the signature of a clean quantised ramp
   at least as often as a flat one. Disabling that branch changed no test — the interval had already
   refused everything that mattered — and the mutant that survived is what exposed it. `tieFrac` is now
   a published diagnostic and the reason wording, never a refusal, and the 900 ppm case is gated.
2. **The offset fallback IS load-bearing, and a first measurement said otherwise.** On refusal the
   offset falls back to the plain median lag rather than `intercept + slope·mid`, which would import
   the refused slope's error into the one quantity this corpus finds trustworthy. A survey across
   plateau, V-shaped and ramp-then-flat lag profiles appeared to show the two values always identical —
   but that survey was run against the build that still contained the fallback, so it measured the
   fallback's own output and concluded the fallback did nothing. It is worth **0.107 s** on the
   sub-resolution case (2.143 fitted vs 2.250 median). The gate now asserts it on a case with a
   non-zero refused slope; asserting it on a zero-slope plateau alone passes either way, which is
   precisely how the mutant survived.

**Gated** in `integrator-dsp · acc-align` (13 → 34 assertions), both lanes, 10 mutants each confirmed
to red — including the two above. One pre-existing assertion in that group had gone hollow and is
repaired: `Math.abs(pos.driftPpm) < 25` on a drift-free pair, which under the refusal reads
`Math.abs(null) === 0` and passes while checking nothing.

Integrator re-bundled `045a349a3f2f → 4894e7df5a32`; `computeHash` moved, so the corpus-backed
Integrator golden was **re-verified by re-running it** (`verify-fixtures.mjs`, `verifiedUnder →
afc169a65a1e`) rather than asserted export-inert.

## Done when

- [x] **F1 — Drawn-axis provenance computed and declared, not inferred** (2026-08-02). The proposed
      `first ns == 0` test was measured to NOT discriminate and was replaced by the modal-delta share;
      `quality.timingSource` now tells a clock consumer whether this recording may be used as a leg.
- [x] **Corpus re-run** under the disciplined axis (34 trios); the asymmetry check held — closure moved
      101.2→−15.5 and 58.4→−11.4 ppm while ECGDex's TCH σ stayed identical at 0.91 bpm.
- [x] **DONE 2026-08-04 — the matched comparison CANNOT be run on this corpus, and the reason is worse
      than an unmatched night set. Per-night σ recorded below, as asked.** See §F3-quater.
- [x] **Closure and TCH re-asked.** Closure improved ~7x; TCH shown structurally unexposed.
- [ ] **PAT — RE-OPENED and HANDED OFF.** The NO was produced by a harness that fitted a free offset per
      block, absorbing the very quantity being measured. The clean-night re-run then disproved this brief's
      own replacement remedy: the ACC anchor does not transfer to the ECG/PPG streams (3.40 s apart, not a
      comb alias). PAT now belongs to `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`; nothing further is owed
      here.
- [x] **F7 — the host-axis rate is span-gated** (2026-08-02). Fleet `fs` spread 25341 → 52 ppm; gated
      both directions and verified to fail against the pre-fix parser.
- [x] **`alignEnvelopes.driftPpm` REFUSES** (2026-08-02, F8). Published only when its 95 % interval
      excludes zero; the interval, the tie fraction and a reason ship either way. Measured: **NOT
      identifiable on 15 of 15** nights — the tool had printed a ppm for every one. **Verified
      corpus-wide (F8.1): 0 of 42 at `--fs 4` across both capture trees, and 3 of 26 identifiable at the
      full 10 Hz — at 5–16 ppm, agreeing with `WEARABLE-DRIFT-DIRECT`'s independent ≈ 7 ppm.** `madSec` never
      travels alone now (`lagSpreadSec` + `madDegenerate`); MAD reads 0.00 on 8 nights whose lag
      spread runs 20–29 s. 34 assertions, 10 mutants confirmed to red.
- [x] **A leg with no time axis is refused** by a computed `timingSource`, wired through `trio-batch`.
- [x] **`papers/` audited; `O2RING-PROTOCOL` annotated rather than retracted** (2026-08-02, F4-RESULT).
      Bullet 1 was already applied by the parallel session — verified in the file, not assumed.
      `timestamp-pathology` gains §3.1 as a *result* (a pathology no parser can detect), flagged as a
      corpus observation rather than a regenerated benchmark row.
- [x] **F6 — beat times reach the fusion** (2026-08-02). `_beatTimes` carries absolute beat instants
      from the existing `timeseries.rr`/`ppi` contract as a packed Float64Array (~240 kB/night, vs the
      multi-MB block P9 dropped), corrected intervals excluded. `detectClockSkew` publishes a
      `beatCheck` that resolves the 0.2–3.3 s band the ±120 s event tolerance calls "aligned" — and
      corroborates WITHOUT deciding: the event-derived findings/pairs are byte-identical with and
      without beats. 22 assertions, 10 mutants confirmed to red.
- [x] **F5 — no ppm is quoted by `trio-batch` without a span and a closure beside it** (2026-08-02).
      Closure is computed BEFORE the line; the seconds-per-night claim exists only in the `closed`
      state; the span rides along in all four. Pure formatters in `tools/drift-report.js`, 37
      assertions in both lanes, 8 mutants each confirmed to red. Demonstrated on the corpus: 2026-07-16
      (99 % corr, no third source) now reads UNCLOSED where it used to read as a measurement. **Scope
      is `trio-batch`** — `papers/` (F4) and `alignEnvelopes.driftPpm` are separate boxes, still open.
