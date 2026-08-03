<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-03 (**all four sections shipped.** §1/§2 (PR #352/#355), §3 EXECUTED + gated, **§4 EXECUTED 2026-08-03 (§6)** — landed on a STRUCTURAL gate because §5's statistical standard cannot resolve a 0.1 ms effect against a reference that disagrees by 1-90 ms. Measured, not assumed: 18 firing files, 130 dropped beats, HRV moved on 10/18 by ±0.1 ms with mixed sign. §6.3 records that NO committed fixture exercises §4 — the one named "gapped" has `nGapBeats: 0` — so the new CI gate is the only thing that does.) · **Created:** 2026-07-22

# O2Ring finger PPG — honest handling of lost time and held samples (the `O2RING-PPG-GAP` charter)

> **What this brief is.** The missing home for the `O2RING-PPG-GAP §N` references that four source files
> already cite (`capture-host/capture.py` §1, `ppgdex-dsp.js` §2/§3, `tests/dex-tests.js`, the synthetic-
> input generator) — a reference this repo pointed at for weeks without the document existing. It records
> the three shipped guards against **fabricated cardiac timing** on the O2Ring finger pleth, the physics
> that separates them, and the paired-ECG validation that settled the one that was in doubt. It also
> parks the un-validated fourth guard (bridged-interval exclusion) with an honest reason.
>
> **The through-line.** A single-channel finger reflectance stream loses time (link dropouts) and carries
> in-band invalid samples (the `156` sentinel). Each failure, handled naively, does not merely *lose* a
> beat — it *invents* one: a hole gets bridged into a doubled interval that `correctRR` median-fills, and
> a held sample lets a beat's timing rest on a value that was never measured. Every guard below exists to
> make a non-measurement **visible** (dropped / excluded) instead of **plausible** (filled). Claims are
> tagged `[CORPUS]` (measured on the real tri-device corpus), `[CODE]` (read from source), `[LIT]`.

## §1 · Honest gaps in capture — insert time, never compress it  *(SHIPPED — PR #352)*
The capture host (`capture-host/capture.py`) writes one PSL-layout `*_PPG.txt` per session. When BLE
frames are lost, the naive writer packs the surviving frames contiguously, **compressing** the missing
wall-clock into zero elapsed time — so a 40 s dropout reads as an instantaneous jump and every later beat
is time-shifted early. §1 inserts an **honest gap**: when the inter-frame arrival exceeds the honest-gap
threshold, real elapsed time is written into the sensor-timestamp column so the hole is a *hole*, not a
seam. `capture-host/tests/test_o2ring_ppg_gap.py` gates it (Python lane). This is the upstream half —
without it, the downstream guards cannot even see where time was lost.

## §2 · Time-discontinuity intervals — never measure across lost time  *(SHIPPED — PR #355)*
`intervalsSpanningTimeGap` (`ppgdex-dsp.js:1028`) marks any foot-to-foot interval whose endpoints
straddle an honest gap: real time passed with no signal, so the difference may span one or more absent
beats and is **not a measurement**. Those intervals are **excluded** from the HRV series (never
corrected to a plausible value), and their count is surfaced as `nGapSpanIntervals` — a night with many
had a lossy link and the reader should know. Fires on nothing without an honest gap; every legacy /
Verity file's grid is contiguous, so the fast path is a no-op there. `[CODE]`

## §3 · Foot-anchored `gapBeats` — a peak sentinel spoils morphology, not timing  *(EXECUTED — this brief)*
### The defect
`gapBeats` (`ppgdex-dsp.js:1064`) drops a beat whenever a rejected (`156`-sentinel) sample lands inside
its guard window. The window was the **whole systolic upstroke** —
`[min(foot,peak)−2, max(foot,peak)+2]`, ~12–25 samples at 125.7 Hz — so a sentinel **anywhere** from the
foot to the peak condemned the beat. Every condemned beat is then a hole that `buildPPI` bridges into a
doubled interval that `correctRR` median-fills. The guard meant to prevent fabrication was **manufacturing
it wholesale**.

### The physics (why the window was wrong)
What actually rests on a held sample is the **timing point**, and for PPI that is the **foot alone**: the
intersecting-tangent foot is built from the diastolic trough and the steepest rise around it, and reads
**nothing** near the systolic peak `[LIT: Charlton 2022 beat-detection benchmark]`. A sentinel by the
peak corrupts **morphology** (systolic amplitude, augmentation index, reflection index — graded
*separately and per-site*, `CLAUDE.md §🎫`) but **cannot move the foot**. Dropping the PPI interval for a
peak-region corruption discards good timing *and* forces a fabricated median-fill — the worst of both.

### The fix
Gate on a tight window about the foot: `[foot−3, foot+3]` (`GAP_FOOT_SPAN = 3`, ~±24 ms — covers the
tangent's own support without reaching the peak). Do **not** widen past ±5 (retention falls off a cliff,
≈77 % at ±10, for no honesty gain). A sentinel is still **rejected from the raw signal** by the isolation
pass (unchanged) — §3 changes only whether a *peak-region* rejection also drops the *interval*.

### Measured effect  `[CORPUS]`
On a real O2Ring **finger** night (2026-07-20, worn on the finger, with a **simultaneous Polar H10 chest
ECG**), over a 63-min overlap:

| | old (foot→peak span) | new (foot-anchored) |
|---|---|---|
| beats condemned by `gapBeats` | **727 / ~3350 (6.9 %)** | **0** |
| `correctRR` fill rate | **34.2 %** | **12 %** |
| finger↔ECG RMSSD error, clean-sleep epochs | up to 10.6 ms | **< 1 ms** |

On **clean deep sleep** the change is a **genuine no-op** — no sentinels to condemn, so the exported HRV
is byte-identical old-vs-new. It bites only on restless/lossy epochs, where it recovers real beats and
halves the median-fill. Per-epoch HRV moved **toward** chest-ECG truth (RMSSD closer in 9/13 clean-ish
epochs; SDNN ~neutral). The residual finger error on *movement* epochs (RMSSD 90–138 ms vs ECG 30–49) is
**foot jitter**, a different fix (`PPGDEX-ALGORITHM-DEEP-DIVE` #1 filtfilt padding / #10 centred TERMA) —
§3 neither helps nor harms it. **Net: safe + accuracy-positive.**

### Gated
- Full node suite green (3677 assertions). The finger-site group now asserts the corrected physics: a
  systolic-peak sentinel is **rejected from the signal but does NOT drop the PPI beat** (`nGapBeats === 0`
  on the twin), and the foot-vs-peak distinction is pinned **directly on `gapBeats`** (now exported):
  a gap at the foot drops the beat, a gap at the peak drops none. A regression to the old wide window
  would drop both and red the group.
- No committed golden moved (`regen-ppgdex-goldens.mjs --check`: 0 moved) — the Verity goldens carry
  `rec.gap === null`, so `gapBeats` is never called on them; the finger twin has a `null` golden
  (property-asserted). PpgDex + both orchestrators re-bundled; GATE A (9/9) + GATE B (12 reproducible)
  PASS; `build.mjs --check` clean across 11 bundles.
- ⚠️ `verifiedUnder` on the corpus-backed `PpgDex_2026-06-27_equiv` fixture expires (a compute-closure
  edit moves `computeHash`) — a release-time re-stamp is owed and `release.mjs` blocks on it. The output
  is provably inert for that Verity input (gap=null), but the gate is a conservative denylist by design.

## §4 · Bridged-interval exclusion  *(PROPOSED — UNBLOCKED 2026-08-01, still NOT landed)*
The other half of the stranded WIP (`claude/ppgdex-bridged-intervals`, `a9c03cf`): when `gapBeats` *does*
drop a beat, its two surviving neighbours become adjacent in the array but **not in time**, so the
interval between them silently spans the removed beat and reads ~2× true — a bridge that `correctRR`
median-fills. §4 records those bridges and feeds them into the §2 `cleanMask` so the interval is
**excluded** rather than corrected into a plausible lie.

**Why it WAS deferred.** After §3 the foot-anchored window drops **so few** beats that on
every real segment measured here the bridged path fired **zero times** (`nGapSpanIntervals: 0 → 0`) — so
it is **unexercised by real data** and cannot be validated the way §3 was. Landing an HRV-touching path
with no segment that trips it is exactly the "ship a fourth unsupervised change" the WIP author refused.
**Done-when:** a real gappy finger night on which foot-anchored `gapBeats` still drops ≥1 beat, showing
the bridged interval excluded and HRV unmoved-or-improved vs ECG. Until then it stays PROPOSED; the WIP
branch holds the implementation.

### 4a · UNBLOCKED 2026-08-01 — the deferral measured the WRONG COUNTER

The paragraph above rests on `nGapSpanIntervals: 0 → 0`, and **that counter cannot move for this
reason, by construction.**

- **`nGapSpanIntervals` (§2)** counts intervals straddling a **time discontinuity in the source** —
  `intervalsSpanningTimeGap(rec.relSec, …)`. It reads 0 whenever the capture grid is contiguous.
- **`nGapBeats` (§3)** counts beats **dropped** because their foot→peak span touched a gap. *Each such
  drop is what creates a §4 bridge*: the two survivors become adjacent in the array but not in time.

A beat dropped by `gapBeats` leaves **no discontinuity in `relSec`** — every sample is still present,
only the beat is gone — so `spansGap` is blind to it *by design*. Watching `nGapSpanIntervals` to decide
whether §4 fires is watching the one quantity guaranteed not to respond.

**Measured with `tools/ppg-gap-bridge-scan.mjs` (drives the shipped `parsePPG` + `analyze`, no
reimplementation) over the 22 largest O2Ring finger captures:**

| | |
|---|---|
| files scanned | 22 |
| **files where `gapBeats` dropped ≥1 beat** | **14** |
| total beats dropped | **88** (max **25** in one file) |
| files where `nGapSpanIntervals` ≠ 0 | 11 |

So §4's Done-when — *"a real gappy finger night on which foot-anchored `gapBeats` still drops ≥1 beat"* —
is satisfied **fourteen times over**, and was already satisfied when the item was parked. Note the last
row too: even §2's counter is non-zero on 11 of 22 files, so the *"0 → 0"* observation came from a
narrower sample than the corpus offers.

**A committed adversarial twin makes this falsifiable without the corpus.** The tool's `--selftest`
plants two `156` sentinel runs straddling a foot in a synthetic single-channel record and asserts
`nGapBeats > 0` **while** `nGapSpanIntervals === 0` — the two counters separated in one run, on a machine
with no medical data. Placement is load-bearing: a first draft planted the runs mid-rise, clear of the
foot, and `nGapBeats` came back 0 — a twin that would have "confirmed" the very deferral it exists to
disprove. `gapBeats` fires only within `GAP_FOOT_SPAN` (±3 samples, ~24 ms) of the **foot**.

**What is NOT done here, deliberately.** The implementation is still on the WIP branch and is **not**
landed. §4 touches HRV, and this brief's own standard (§5) is per-epoch RMSSD/SDNN agreement against
paired chest ECG — the evidence that settled §3. This unit supplies the *segments* that standard needs
and the tool to find them; it does not ship the change. Landing §4 now needs: the WIP implementation
rebased, run over the 14 firing files, and HRV shown unmoved-or-improved vs ECG on each. Shipping it on
the strength of "the trigger fires" alone would be the fourth unsupervised change the WIP author refused
— the reason to act is that the *blocker* was wrong, not that the validation is optional.

## §5 · Validation method & evidence  `[CORPUS]`
The finger↔ECG comparison that settled §3 is **per-epoch HRV metric agreement**, not cross-modality beat
matching. Beat matching fails by construction — the finger pulse arrives ~250 ms after the ECG R-peak and
that pulse-transit lag varies beat-to-beat, so a fixed tolerance scores ~0.5 sensitivity (the wall the WIP
author hit). Comparing **RMSSD/SDNN per 5-min epoch** instead lets the lag cancel in the differences: on
clean deep sleep the O2Ring finger PPI reproduces chest-ECG HRV within **median 0.3 ms RMSSD / 0.2 ms
SDNN** — `validated`-tier agreement, and the reference the node has lacked through three prior HRV-moving
changes. Real recordings are gitignored (personal biosignal data); the analysis re-runs both code
versions in a co-loaded realm and bins finger `nn`/`tt` + ECG R-peaks onto a shared absolute clock. This
clean-sleep agreement is also the evidence `O2RING-FINGER-HRV-VALIDATION` needs for its emerging→validated
call, pending its ≥10-night replication.

## Done-when
- [x] §1 honest gaps in capture (PR #352, Python gate).
- [x] §2 time-discontinuity interval exclusion (PR #355).
- [x] §3 foot-anchored `gapBeats`, validated vs paired chest ECG; suite green, GATE A/B PASS, re-bundled,
      changeset dropped.
- [x] §4 bridged-interval exclusion — **EXECUTED 2026-08-03 (§6).** Landed on a STRUCTURAL gate, not
      the §5 statistical one: measured over 18 firing files, §4 moves whole-file HRV by **0.1 ms of SDNN**
      with mixed sign, while finger-vs-ECG disagreement on those files runs 1-90 ms — the reference is
      ~1000x coarser than the effect, so §5 cannot adjudicate it in either direction. What IS provable is
      the claim §4 actually makes, and it is now gated in CI.
- [x] release-time `verifiedUnder` re-stamp of the PpgDex corpus fixture — **done 2026-08-01** (PR #670):
      `PpgDex_2026-06-27_equiv.node-export.json` carries `verifiedUnder: 2acf0985e625`, stamped by
      `tools/verify-fixtures.mjs` after a green real-corpus run.


---

## §6 · EXECUTED 2026-08-03 — §4 landed, on the evidence it actually admits

### 6.1 · The blocker was wrong, and so was the validation standard — in opposite directions

§4a established that the *deferral* watched a counter that cannot respond (`nGapSpanIntervals` is blind to
a dropped beat by construction). Executing it established the mirror-image problem: the *validation* §5
prescribes cannot resolve the change either.

Measured with `tools/ppg-bridge-hrv-validate.mjs` (new, committed) over the corpus — 18 files where
`gapBeats` drops at least one beat, 130 beats dropped, max 25 in one file:

| | |
|---|---|
| files where §4 changes `nGapSpanIntervals` | **18 / 18** (the accounting) |
| files where §4 changes any HRV metric | **10 / 18** |
| magnitude, `sdnn` | **±0.1 ms** (0.05-0.39 %), 5 down · 3 up |
| magnitude, `meanRR` / `pnn50` / `ellArea` | +1 ms · −0.1 · +2 (≤ 0.34 %) |
| finger-vs-ECG disagreement on the same files | **1-90 ms** |

`sdnn` is reported to one decimal, so ±0.1 ms **is the last digit**. Asking a reference that disagrees by
1-90 ms to adjudicate a 0.1 ms change is asking a question whose answer is fixed before it is posed —
running it and reporting "no significant difference" would be a measurement that could not have come out
any other way. §5's standard is right for a change that MOVES HRV; §4 does not.

### 6.2 · What was gated instead: correct-by-construction, in CI, with no corpus

§4's claim is not "HRV improves". It is "an interval whose two endpoints have a deleted beat between them
is not a measurement, and must be excluded rather than median-filled". That is checkable directly.

The new gate builds two synthetic records that differ ONLY by planted sentinel runs, and asserts:

- the planted runs really do drop beats (**anti-vacuity** — without this the rest is trivially true);
- the twin without them drops none, so the drop is the sentinels and not the waveform shape;
- the contiguous-grid twin excludes **zero** intervals — so `intervalsSpanningTimeGap` finds nothing and
  **every exclusion in the gapped twin is a bridge**;
- exclusions never exceed drops (one bridge per dropped beat at most — the obvious off-by-one spills past
  this ceiling);
- the record survives: beats and HRV are still reported, so a guard that excluded everything also fails.

Sentinel PLACEMENT is load-bearing and is commented as such: `gapBeats` fires only within `GAP_FOOT_SPAN`
(±3 samples, ~24 ms) of the **foot**, so a run planted mid-rise drops nothing and would make the whole
gate pass while proving nothing — the same trap `ppg-gap-bridge-scan`'s own selftest records.

Mutation-verified in both directions: reverting §4's OR, loosening the bridge test `> 1` → `>= 1`, and
building `bridged` over the wrong index base each red the gate.

### 6.3 · NO COMMITTED FIXTURE EXERCISES §4 — the gate is the only thing that does

`synthetic_ppgdex_verity_gapped.txt` — the fixture whose name says "gapped" — has **`nGapBeats: 0`**. It
exercises §2 (two time discontinuities) and never trips §3's drop, so §4 is inert on it. All four PpgDex
fixtures re-generated to **byte-identical** output, and that is not evidence of safety: it is evidence
that the committed corpus cannot see this change at all.

This is the third instance of the same asymmetry in as many days (the OxyDex PB string's synthetic golden
never reaches `csScore >= 2`; the GlucoDex long-gap case that `FIXTURE-VERIFICATION-GATE` was written
about). **A fixture named for a condition is not a fixture that meets it** — worth checking by running
the counter, not by reading the filename. The §6.2 gate closes the hole for §4 specifically.

### 6.4 · Compute-path

```
manifestHash  9cc4a3c1faff → e3b832216694   (MOVED)
computeHash   d7496fb2b411 → 7b7a072ac320   (MOVED ⇒ re-verification owed)
```

`regen-ppgdex-goldens` moved 0 of 4 fixtures (see §6.3); `verify-fixtures` re-stamped the real corpus
fixture `verifiedUnder → 7b7a072ac320` after a green run. Three build systems re-run — the two
orchestrators inline `ppgdex-dsp`.

### 6.5 · A tool defect found and recorded, because it produced a plausible wrong answer

The first version of `ppg-bridge-hrv-validate.mjs` compared `res.nn`/`res.tt` and reported all 18 files
**identical to 2 dp** — which reads exactly like a clean "unmoved" verdict. It was measuring a series §4
cannot touch: §4 acts through `cleanMask`, which gates which intervals reach the HRV metrics, while `nn`
is the corrected series and is byte-identical either way. A whole-field diff (OLD vs NEW, every key)
settled it in one run.

**An "everything identical" result from a differential tool is a red flag about the tool, not a finding
about the code.** That is now the first thing its header says.
