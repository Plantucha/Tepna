<!--
  INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md`, `EXPORT-PATH-UNREACHABLE-2026-08-01-BRIEF.md` §7 · **Affects:** `integrator-dsp.js`

# The Integrator already contained the better clock instrument, wired downstream of a veto.

`tools/trio-batch.mjs` corrects the CPAP's clock on every night it can measure. The Integrator, given
the same evidence, corrected **one night in twenty-four** — not because it lacked the instrument, but
because it ran it second and let a weaker one decide.

```js
skew.findings.forEach(function (f) { …
  if (anchor && anchor.length && chans.length) skewFits[f.node] = fitClockOffsetPooled(anchor, chans, opts);
});
```

The pooled fit only ran **for a node the coarse detector had already declared skewed**, and even then
purely to *report* a refinement — `skewApplied` shifted by the coarse `offsetSec`. `trio-batch` calls
`fitClockOffsetPooled(cpapApneaTimes, allWearableChannels, {})` unconditionally, once per night. That
is the whole difference.

## 1 · Measured, on the 24 trio nights that also carry CPAP EDFs

| | before |
|---|---|
| coarse `detectClockSkew` produced a CPAPDex finding | **1 / 24** |
| pooled fit confident | **19 / 24** |
| pooled offset inside the documented 30–50 min band | **24 / 24** (37.6–41.7 min) |

**And the veto was not the threshold.** `minPeakOverFloor` is 4; on the corpus these nights score
**5–12**. What discards them is the ALL-PARTNERS-MUST-AGREE clause — `rel.every(r => r.skewed)` plus
`spread > 2 × matchSec`. ECGDex emits sleep stages and autonomic surges; it cannot witness a
respiratory event, so its lag is noise, and one blind witness vetoes the night. *(This corrects
`EXPORT-PATH-UNREACHABLE` §7, which blamed the 0.11 shortfall in `peakOverFloor` on the single night it
had seen. On the corpus that is not the binding constraint.)*

## 2 · What changed

The pooled fit now runs for **every dated node with events**, anchor-vs-rest, and supplies the number
that is actually applied — sub-second since **#624**, where the coarse grid cannot resolve below 30 s.
`detectClockSkew` is kept for its per-partner `pairs` diagnostics and its findings still ride in the
output; it simply no longer holds a veto over the better instrument.

**After: 19 / 24 corrected, every one of them CPAPDex, every one in band, zero mis-attributions.** The
five abstentions are nights the fit is not confident — abstaining, not guessing.

### The attribution honesty

Two ranking rules were tried and **measured to fail** before the third was adopted:

- **by |offset|** → blamed OxyDex for the CPAP's 39 min on 2026-06-15 and ECGDex on 07-11 (right
  magnitude, wrong side): a healthy node fitted against a skewed partner sees that offset too.
- **by corroboration breadth (`nNodes`)** → fixed 06-15, but `nNodes` is **3 for every node on almost
  every night**, so it does not separate them; 06-25, 06-28 and 07-11 were still mis-attributed.

The fits are symmetric — A-vs-rest and B-vs-rest recover the same relative shift with opposite signs —
so **the statistic cannot decide the side, and pretending otherwise invents a fact.** What decides it
is the physical asymmetry this repo already documents in two places: the wearables share one capture
host's disciplined clock (0.10–0.39 s apart on box nights), while *"the ResMed sits on its own cell
network, so it cannot be NTP-disciplined and the offset is permanent."* So the correction applies only
to a node named as **un-disciplined** (`UNDISCIPLINED_NODES`, carrying its reason). Any node not listed
keeps the previous behaviour exactly.

`clockSkewApplied` now carries `source: 'pooled' | 'pairwise'`, plus `z`, `pValue` and `spreadSec` — a
corrected number that does not say *how* it was corrected is the failure this line of work exists to
stop, and the two estimators are now a real distinction.

## 3 · What this does NOT fix — stated, because the headline metric is unmoved

On 2026-07-26 the applied correction is **+2311.5 s (38.5 min)**, and the desat↔apnea pairing improves
but does not close:

| | desats paired (±120 s) |
|---|---|
| uncorrected | 3 / 33 |
| after the pooled correction | **12 / 33** |
| desat↔apnea optimum (+2510 s) | 23 / 33 |

**Residual 199 s** — larger than the confirmed-apnea coupling window (−15 … +60 s), so
`DESAT MATCH RATE` stays 0 % and `CONFIRMED APNEA INDEX` stays "below chance" on that night.

The cause is the pooled fit's own breadth: it scores **every** channel at one candidate offset, and
several of those channels carry real physiological latency (a desaturation trails its apnea; an
autonomic surge trails both). Averaging across them lands ~200 s from the offset the desat↔apnea
pairing actually needs. **The next step is therefore not a better global fit but a narrower one: when a
coupling will be scored on ONE channel pair, re-fit the offset on that pair.** Not attempted here — it
changes what `confirmedApneaIndex` means and deserves its own corpus pass.

## 4 · PAT is not reachable from this instrument, and now there is a number for that

The pooled fit's plateau width across the corpus is **median 20 s, max 85 s, min 0 s**. The PAT
promotion gate (`pat-gate.js`) requires **drift ≤ 60 ms**. That is roughly **330× finer than this
estimator's median precision**, so event-coincidence alignment cannot feed PAT and no amount of
widening its channel set will change that — event coincidences are separated by seconds of physiology,
not milliseconds of pulse transit.

PAT already has the right instrument: `pat-align.js`, anchor-based ACC↔ACC cross-correlation, which is
what `WEARABLE-SYNC` measured at 0.10–0.39 s on box-captured nights. Even that is ~3–6× coarser than
the 60 ms bar, which is consistent with `IBI-ALIGNMENT-LIMIT`'s finding that only 5–26 % of beats have
a resolvable counterpart. **This work moves the fusion timeline from "minutes wrong" to "tens of
seconds wrong"; PAT needs milliseconds, and that is a different measurement on a different signal.**

## 5 · Done when

- [x] The pooled fit runs unconditionally, not gated behind the coarse detector.
- [x] Its offset is what gets applied, and `source`/`z`/`pValue`/`spreadSec` say so.
- [x] Corpus: 1/24 → **19/24** corrected, 19/19 in band, zero mis-attributions.
- [x] Attribution decided by the documented physical asymmetry, after two statistical rules were
      measured to fail — not by assertion.
- [x] The unmoved desat KPI reported with its residual rather than omitted.
- [x] PAT feasibility answered with a measured number instead of a hope.
- [ ] *(next)* Re-fit the offset on the specific channel pair a coupling scores, not the pooled set.

## 6 · Why sub-second is not available to the CPAP, and where it IS available

The 20–85 s plateau is **not estimator sloppiness — it is the jitter of the only shared signal.** The
CPAP carries **no accelerometer** (`cpapdex-edf.js` contains no ACC channel), so it shares no
*mechanical* observable with the wearables. Its only common ground is respiratory events, and those
couple to what a wearable can see through physiology with real, variable latency — a desaturation
trails its apnea by circulation time, an arousal surge trails both. **No estimator can be finer than
the coupling it measures.** Tens of seconds is the floor for CPAP↔wearable, by construction.

Sub-second **is** available wearable-to-wearable, and the instrument is already in this very file:
`activityEnvelope` + `alignEnvelopes` (shipped by `WEARABLE-SYNC`), which measured **0.10–0.39 s** on
box-captured nights by cross-correlating accelerometer envelopes. The Integrator cannot reach it for
one reason: **no node-export carries an ACC envelope.** Checked across all eight exports of the
2026-07-26 night — not one has an envelope or motion trace in `timeseries`. The instrument is in the
building; the fuel is not in the pipe. This is `export-boundary-is-the-bottleneck` again.

**So the concrete route to a sub-second wearable timeline** is an export change, not an algorithm: have
the ACC-bearing nodes (MotionDex, PpgDex, ECGDex all ingest ACC) emit a downsampled activity envelope
in `timeseries`, and the Integrator can then run `alignEnvelopes` on every wearable pair. Recorded here
rather than attempted — it is an additive `ganglior.node-export` field across three nodes, which is its
own work-unit and its own MINOR bump.
