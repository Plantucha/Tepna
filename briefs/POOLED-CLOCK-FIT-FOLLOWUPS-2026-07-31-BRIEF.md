<!--
  POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-07-31 · **§1 + §6.2 RESOLVED 2026-08-01** · **Found while executing:** `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md` · **Affects:** `ecgdex-dsp.js` / `ppgdex-dsp.js` event fiducials, `CROSS-DEVICE-CLOCK-SKEW` §2d's latency ladder, `PAPERS-ROADMAP`

# Once the clock is pinned, every channel is on one timeline — and the pairs do not say what the ladder says

Executing the pooled clock fit produced a tool nobody asked it for: with each night's CPAP↔wearable
offset measured, **all channels from all four devices sit on a single timeline**, and any pair of them
can be swept at 1 s resolution with its own shuffled null. That is a physiology instrument, not a clock
instrument, and pointing it at the corpus surfaced one reproducible structure the suite cannot currently
explain and one it should stop asserting.

**Nothing here is a claim of new physiology.** It is a measurement with three candidate explanations,
all three tested and all three rejected. That is precisely the state that belongs in a brief rather than
in a paper or a metric.

---

## 1 · `autonomic_surge` ↔ `movement_onset` is strongly coupled and its latency changes sign

**Method.** For every night with a fitted offset, every channel pair with ≥8 events on each side was fit
with `fitClockOffsetPooled` at `{maxLagSec: 600, stepSec: 1, matchSec: 10, nullIters: 30}` — the same
gated estimator, at physiological rather than clock resolution. 44 pairs tested across 30–31 nights.
Nine pairs are significant on ≥5 nights:

| pair (anchor → partner) | nights | significant | median lag | MAD | median Z |
|---|---|---|---|---|---|
| PpgDex `motion_artifact_segment` → PpgDex `movement_onset` | 30 | **30** | −1 s | 1.5 | 20.4 |
| ECGDex `autonomic_surge` → PpgDex `motion_artifact_segment` | 29 | **29** | +13 s | 2 | 10.8 |
| ECGDex `autonomic_surge` → PpgDex `movement_onset` | 30 | **29** | +14 s | 3 | 11.3 |
| ECGDex `autonomic_surge` → CPAP `apnea` | 30 | 18 | −11 s | 10.5 | 7.0 |
| ECGDex `autonomic_surge` → ECGDex `movement_onset` | 30 | 9 | +14 s | 9 | 9.0 |
| PpgDex `motion_artifact_segment` → CPAP `apnea` | 30 | 9 | +3 s | 14 | 9.9 |
| PpgDex `movement_onset` → CPAP `apnea` | 31 | 9 | −12 s | 17 | 7.8 |
| ECGDex `movement_onset` → PpgDex `movement_onset` | 31 | 8 | +1 s | 2.5 | 10.5 |
| ECGDex `movement_onset` → PpgDex `motion_artifact_segment` | 30 | 8 | −2 s | 3.5 | 9.4 |

Row 1 and the last two are **controls, and they pass**: two detectors on the same device agree to 1 s,
and the chest IMU agrees with the arm IMU to 1 s. A method that could not recover those would not be
worth reading further.

### The MAD is lying, and the histogram says why

`autonomic_surge → movement_onset` reads as a tight +14 s ± 3 s. It is not. The per-night lags are
**bimodal** — 22 nights at +10…+21 s, 7 nights at −20…−25 s — and the MAD is small only because the
median sits inside the larger mode. Pooling the raw deltas instead of the per-night argmaxes (992 paired
events, nearest partner within ±60 s, 30 nights) shows the real shape:

```
 -35s   28 ██████
 -30s   64 ███████████████
 -25s  122 ████████████████████████████
 -20s  140 ████████████████████████████████
 -15s   74 █████████████████
 -10s   11 ███
  -5s    3 █
   0s    7 ██          ← 10 of 992 deltas fall within ±5 s
   5s   70 ████████████████
  10s  216 ██████████████████████████████████████████████████
  15s  140 ████████████████████████████████
  20s   61 ██████████████
  25s   17 ████
```

Two clean modes at **+12 s** and **−22 s**, and a **depletion at simultaneity**. The two events almost
never co-occur. A bimodal split alone could be a detector quirk; a *hole at zero* is a structural
signature and is the part worth explaining.

### RESOLVED 2026-08-01 — a fourth explanation, and it is the fiducial

**All three hypotheses below were rejected correctly. The mechanism was a fourth nobody had, because
the stamp's meaning was undocumented — which is precisely what §6's second item asked for.**

`autonomic_surge` stamps the **bradycardia TROUGH** that opens a CVHR cycle. `detectCVHR` finds the
trough at `s` and the tachycardic rebound at `pkAt`, sets `periodSec = pkAt − s`, and stamps `s`. The
rebound — the instant the event is *named* for — is `periodSec` later, median **20 s**, IQR 17–28.

Re-measuring the identical pair on the identical 30 nights, changing nothing but which instant the
anchor uses:

```
AS SHIPPED — trough                      RE-STAMPED — trough + periodSec
 -30s   64 ███████████████                -30s    7 ██
 -25s  122 ████████████████████████████   -25s   10 ██
 -20s  140 ████████████████████████████   -20s    4 █
 -15s   74 █████████████████              -15s   51 ███████████
 -10s   11 ███                            -10s  139 ███████████████████████████████
  -5s    3 █                               -5s  226 ██████████████████████████████████████████████████
   0s    7 ██                               0s  104 ███████████████████████
   5s   70 ████████████████                 5s   31 ███████
  10s  216 ██████████████████████████████  10s    9 ██
  15s  140 ████████████████████████████    15s    4 █
  20s   61 ██████████████                  20s    2
within ±5 s: 10 of 992 = 1.0 %           within ±5 s: 330 of 915 = 36.1 %
```

**Bimodal with a hole at zero → one mode. A 36× improvement in coincidence.** The depletion at
simultaneity existed *because* of the wrong fiducial: under the trough stamp the true partner is never
near zero, so nearest-neighbour matching within ±60 s kept selecting the neighbouring movement instead,
which places a second mode one inter-movement interval away. That is the "structural signature" §1
called out — and it was a signature of the measurement, not of the body.

**The fix is documentation plus a new field, not a re-stamp.** `tMs` keeps the trough: it is a
published contract, and the bradycardia is the correct CVHR fiducial. `meta.peakTMs` now publishes the
rebound. Gated by *autonomic_surge publishes BOTH its instants*. `movement_onset` is likewise now
documented as stamping a jerk local **maximum** — the peak of a movement burst, not its start.

**Consequences recorded:** `CROSS-DEVICE-CLOCK-SKEW` §2d amended with this result. The ladder is
**still not rewritten** — §2's reasoning stands, it was inferred under a deprecated estimator — but the
obstacle to measuring it is gone, and the "latency that changes sign" language is withdrawn: the two
channels are coupled at one latency, near-simultaneous when measured rebound-to-movement.

**Not claimed:** that the −5 s mode is a physiological latency. It is measured against a movement
fiducial that is itself a burst *peak*, so it still mixes convention with physiology — less than
before, but not zero. Conditioning on arousal intensity (§1's "next test") is now worth running,
because it is no longer confounded by a 20 s fiducial offset.

### Three explanations, all tested, all rejected

1. **Epoch quantisation.** Rejected — 0 % of event timestamps in either channel land on a 5/10/15/30/60 s
   grid. Both fiducials are at native resolution.
2. **CVHR cycle aliasing.** `autonomic_surge` is emitted from `cvhr.events`, which are *cyclic* by
   construction, so two modes 34 s apart would be explained by a ~34 s cycle. Rejected — the corpus
   `meta.periodSec` distribution is median **20 s** (p25 17, p75 28), and a 20 s period predicts modes at
   +12 / −8, where the histogram has a hole.
3. **Detector mutual exclusion** (a surge suppressed during motion would manufacture the notch).
   Not supported by the emitter: `autonomic_surge` is stamped straight from `cvhr.events` with no motion
   gate in its path.

### What to do

- **Do not build a metric on this yet, and do not put it in a paper.** 44 pairs were swept with no
  multiple-comparison control; the strong rows survive that easily, but the *latency* is the claim at
  issue and it is unresolved.
- **Next test, cheapest first:** condition the delta on arousal intensity (`meta.ampBpm` for the surge,
  the onset's magnitude) and on whether a CPAP apnea is within the window. If the two modes separate on
  arousal type, this is physiology — two arousal sequences, autonomic-led and movement-led — and it is
  worth a `papers/` entry. If they separate on nothing, it is a fiducial-definition artifact and the fix
  belongs in the detectors.
- **Re-derive both fiducials to a stated instant.** Neither `autonomic_surge` nor `movement_onset`
  documents *which* instant of the event it stamps (onset, threshold crossing, peak). Until they do, any
  cross-channel latency mixes physiology with detector convention, and that is enough on its own to
  block a physiological reading.

## 2 · The latency ladder in `CROSS-DEVICE-CLOCK-SKEW` §2d is contradicted by direct measurement

The ladder orders movement **30 s ahead of** the autonomic surge. Measured directly as a pair, the surge
leads movement by 12 s on most nights. Both cannot be right.

The ladder is the weaker evidence: it was *inferred* from separate per-channel CPAP fits under the
estimator that the parent brief has now deprecated, whereas the pair fit measures the two channels
against each other with no clock in between. §2d has been amended to say so. **It has not been rewritten
to the new ordering** — §1 shows the pair latency is itself bimodal, so replacing one asserted ordering
with another would repeat the mistake.

Note the CPAP rows in §1's table cannot settle it either: they were aligned using that night's fitted
offset, which is itself dominated by these same channels. **Circular — do not quote them as independent
evidence of latency.** They are in the table because leaving them out would hide that they were tested.

## 3 · The one confident error, and the guard it argues for (2026-07-23)

On the maximum 45-night corpus (parent §8.4) the pooled fit has exactly one `confident` night outside
the band: **2026-07-23 at 35.18 min**, p=0.032, Z 9.24, not ambiguous. Parent §8.5 rules out the two
obvious explanations — it is not a stale-export artifact (the other eight legacy nights sit at
37.5–38.2) and it is not a device-clock shift (`ECGDex/autonomic_surge` at 37.75 disagrees with
`ECGDex/movement_onset` at 34.17 **from the same file and the same timeline**).

What remains is **half-period aliasing**: the discrepancy is 3.58 min and half the night's mean apnea
interval is 3.47 min. The movement channels have locked onto the apnea train offset by half a period.

**Why the current `ambiguous` test cannot see it.** That test looks for a rival peak within one noise
unit *in the pooled curve*. Here there is no second pooled peak — the disagreement is **between
channels**, one family preferring 34.1 and another 37.75, which pooling then averages into a single
confident-looking answer. This is exactly the risk the parent's §6 named (*"pooling can mask a genuinely
disagreeing sensor"*), and §5.3's per-channel table only half-mitigates it: the table *does* show
`ownOffsetSec` 34.17 against 37.75, but every channel still reports `agreed: true`, because each has
z ≥ 1 at the chosen offset.

**Candidate guard, deliberately not implemented yet:** flag a night when the usable channels' own
argmaxes split into clusters separated by more than the peak's support width — i.e. reuse the *old*
estimator's clustering as a **disagreement detector** rather than as a selector. That keeps the pooled
fit's decision while restoring the one thing the vote genuinely did better. It must be validated against
the whole corpus first: a guard invented from a single night is the estimator being fitted to its own
corpus, which is the error this brief chain keeps finding.

**Do not special-case "movement vs autonomic".** §1 argues against that class of channel-name rule, and
the same half-period mechanism would arise on any anchor train with a stable period.

## 4 · The fusion gate is stricter than the clock fit needs

`trio-batch` rejects a night with less than `--min-overlap 1` hour of three-way concurrency, because
`tch-multinight` needs ≥12 five-minute epochs of it. **The clock fit needs no three-way overlap at all**
— it consumes CPAP anchors plus whatever wearable channels exist, and each node's export is full-length
regardless of how little the three coincide. Re-folding with `--min-overlap 0 --min-hours 2` admitted
**5 more nights** (06-17, 06-18, 06-26, 07-03, 07-10) carrying 5–8 channels instead of the usual 10–12;
the fit produced a number on all five where the vote managed three, and correctly withheld confidence on
the one that landed out of band (parent §8.4).

Beyond that, **2026-06-06, 06-07, 06-09 and 06-13 carry only two devices**, and `trio-batch` will not
emit them at all (`have.length < 3`, hard-coded, no flag). A 2-device night is fittable in principle —
the estimator degrades by design — so this is a tool limit, not a data limit. Worth an
`--allow-partial` flag so the clock-fit corpus is not bounded by a fusion precondition; but it changes a
tool every other analysis also uses, so it needs its own gate work rather than a quick edit here.

## 5 · Smaller items

- **`spreadSec` changed meaning at the cutover.** Under the vote it was "how far apart the agreeing
  channels' estimates sat"; under pooling it is the width of the peak's support. Both are published as
  `spreadSec`. The Integrator UI and `trio-batch` were updated to render it as `± resolution`, but any
  *stored* historical value carries the old meaning. No fixture stores one today; if one ever does, it
  needs a distinct field name rather than a comment.
- **The ±45 s window and 5 s grid are still unswept** (parent §6). The planted-offset control shows the
  centroid removes the window's bias, so the cost of the coarse window is resolution, not accuracy — but
  a sweep would let the window be chosen rather than inherited.
- **9 nights (2026-07-16 … 07-24) remain unfoldable**, raw data gone from every tree. The corpus is 31
  nights and will not grow backwards.
- **`npx biome …` and `npx tsc …` silently do the wrong thing in this repo.** Biome and TypeScript are
  devDependencies, so a bare `npx biome ci <file>` resolves to nothing, prints nothing and **exits 0** —
  it looks like a pass. `npx tsc` hits the unrelated `tsc` shim package. Both gates therefore appeared
  green locally and failed in CI, on real defects (a `null`-narrowing error and an over-long line). The
  invocations that actually reproduce CI are the pinned ones the workflows use:
  `npx -y @biomejs/biome@2.5.3 ci <files>` and `npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json`
  (note `-p` before the package for tsc). Worth a line in `CONTRIBUTING.md`, since an exit-0 no-op is the
  most expensive kind of false green.

## 6 · Done when

- [x] The bimodal latency of §1 is **attributed to fiducial definition** (2026-08-01) — the anchor was
      stamped one CVHR half-cycle early — and written back into `CROSS-DEVICE-CLOCK-SKEW` §2d.
- [x] `autonomic_surge` and `movement_onset` each document the instant they stamp, in their emitter,
      and `meta.peakTMs` publishes the rebound so a latency can name its fiducial.
- [ ] If §1 resolves to physiology: a `papers/` entry with the null calibration alongside, per
      `LITERATURE-USE-POLICY`. If it resolves to an artifact: a detector fix and a gate.
- [ ] The window/grid sweep of §5 is run, and the chosen values carry a reason.
- [ ] The §3 disagreement guard is designed, validated against all 45 nights (it must not cost any of
      the 26 correct confident nights to catch 2026-07-23), and gated — or rejected in writing with the
      measurement that rejected it.
- [ ] `trio-batch` grows an `--allow-partial` path (§4) so a 2-device night can be fitted, or the four
      unreachable nights are recorded as permanently out of corpus.
