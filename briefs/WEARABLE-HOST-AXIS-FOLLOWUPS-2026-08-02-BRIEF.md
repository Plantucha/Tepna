<!--
  WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-02 · **F1 DONE 2026-08-02** · **Follows:** `WEARABLE-HOST-AXIS-2026-08-02-BRIEF.md` · **Affects:** `ppgdex-dsp.js`, `integrator-dsp.js`, `tools/trio-batch.mjs`, `papers/`, several briefs

# The O2Ring's axis was drawn on every night before 2026-07-28. Everything that used it as a clock has to be re-asked.

`WEARABLE-HOST-AXIS` fixed the axis. It did not re-derive the conclusions that were computed on the old
one. Those conclusions are not merely imprecise — one of the three sources in every three-body clock
measurement this repo has published was **`sample_index × 125.738 Hz`**, a drawn axis whose apparent ppm
is the error in an assumption.

## F1 · Detect drawn provenance, and declare it — **DONE 2026-08-02**

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

## F4 · `papers/` audit

- **`papers/wearable-clock-drift.html`** — already carries two correction banners. It needs a third pass
  folding in the direct measurement (H10 ≈ −20, Verity ≈ −27, inter-device ≈ 7 ppm) and the drawn-axis
  finding, and it should stop presenting any O2Ring-derived ppm as a crystal property.
- **`papers/timestamp-pathology.html`** — its subject *is* consumer-export timestamp pathology. A drawn
  axis with a calibrated-but-wrong constant is the strongest specimen this corpus has produced, and the
  paper predates knowing it. Strong candidate for a new §Results case rather than a correction.
- **`briefs/O2RING-PROTOCOL-2026-07-17-BRIEF.md`** §109–111 — the source of the 125.738 Hz calibration.
  Do **not** retract the measurement (it is a real fit over 2.6 M samples); add a header note that the
  constant cannot hold because the delivered rate varies per session, pointing at the host-axis fix.

## F5 · `trio-batch` prints an unclosed ppm, and none of it is gated

Deliberately left alone by owner decision during `WEARABLE-HOST-AXIS`, recorded here so it is not lost:
`printDriftFit` prints `${r.driftPpm} ppm` and converts it to a seconds-per-night claim with **no
knowledge of the closure verdict computed 20 lines below**, contradicting both drift briefs' §6
guardrail. `printDriftFit`/`printClockFit` have **zero test coverage** — every clock assertion in
`tests/dex-tests.js` targets `fitClockClosure`'s own unit group, none the trio wiring.

## F6 · Carry a slim beat array onto the fusion rec

Inherited from `WEARABLE-DRIFT-FIT` §5 and still open: `runFusion` drops `timeseries`, so beat times are
unreachable there and the drift/closure work cannot run inside the Integrator. Unchanged by this work.

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

## Done when

- [x] **F1 — Drawn-axis provenance computed and declared, not inferred** (2026-08-02). The proposed
      `first ns == 0` test was measured to NOT discriminate and was replaced by the modal-delta share;
      `quality.timingSource` now tells a clock consumer whether this recording may be used as a leg.
- [x] **Corpus re-run** under the disciplined axis (34 trios); the asymmetry check held — closure moved
      101.2→−15.5 and 58.4→−11.4 ppm while ECGDex's TCH σ stayed identical at 0.91 bpm.
- [ ] A per-night MATCHED TCH comparison — the 2.71→3.44 PpgDex σ shift spans different night sets and
      is therefore unattributed. The old per-night σ values were never recorded; record them this time.
- [x] **Closure and TCH re-asked.** Closure improved ~7x; TCH shown structurally unexposed.
- [ ] **PAT — RE-OPENED and HANDED OFF.** The NO was produced by a harness that fitted a free offset per
      block, absorbing the very quantity being measured. The clean-night re-run then disproved this brief's
      own replacement remedy: the ACC anchor does not transfer to the ECG/PPG streams (3.40 s apart, not a
      comb alias). PAT now belongs to `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`; nothing further is owed
      here.
- [x] **F7 — the host-axis rate is span-gated** (2026-08-02). Fleet `fs` spread 25341 → 52 ppm; gated
      both directions and verified to fail against the pre-fix parser.
- [ ] `alignEnvelopes.driftPpm` is not identifiable and is quoted nowhere until it refuses or is fixed
      (F7). Its offsets are fine; only the drift term and `madSec` are affected.
- [x] **A leg with no time axis is refused** by a computed `timingSource`, wired through `trio-batch`.
- [ ] `papers/` audited; `O2RING-PROTOCOL` annotated rather than retracted.
- [ ] No ppm quoted anywhere without a span and a closure beside it.
