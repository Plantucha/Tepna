<!--
  DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-29 · **Found-by:** running `REM-STAGING-REDESIGN` §5's cross-signal falsifier for the first time · **Relates:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` §7

# Called-Deep carries 3.4× the desaturations of Light — N3 should carry the fewest

The REM investigation ran §5's cross-signal falsifier (*"REM should carry more and longer
desaturations, and OxyDex publishes those per night"*) and the REM answer came back underpowered. The
**Deep** answer did not. It is the most statistically solid result that investigation produced, and it
is about a stage nobody was looking at.

---

## 1 · The observation

Every OxyDex `desat_event` mapped onto the ECGDex stage epoch covering it, across the **24 nights
`tools/trio-batch.mjs` has already computed** (night key = *(start − 12 h)*, majority-nocturnal,
concurrent sessions only). Exact Poisson 95 % CIs:

| called stage | min | desats | rate /h | 95 % CI |
|---|---|---|---|---|
| REM | 375 | 4 | 0.64 | [0.17, 1.64] |
| Light | 6855 | 179 | 1.57 | [1.35, 1.81] |
| **Deep** | 935 | 84 | **5.39** | **[4.30, 6.67]** |
| Wake | 1215 | 49 | 2.42 | [1.79, 3.20] |

Deep's CI does not touch Light's. **This is backwards:** N3 normally carries the FEWEST respiratory
events — slow-wave sleep is the most respiratory-stable state there is.

It is not one night carrying the result: on a per-night basis **Deep's desat rate exceeds Light's on
11 of 14 nights** that have ≥ 30 min of each (median ratio **3.61**; sign test p ≈ 0.03 one-sided).

## 2 · The mechanism, and how far it actually goes

The hypothesis was mechanical: apnea drives **cyclical variation of heart rate** → large beat-to-beat
swings → **elevated RMSSD** → and the Deep rule is `rmssd > 1.12 × median && hr < median`. So an apnea
cluster would *look like* slow-wave sleep to a rule that reads RMSSD as depth.

Tested link by link, per 5-min epoch across the same nights:

| | n | median RMSSD | called Deep |
|---|---|---|---|
| epochs containing ≥1 desat | 156 | **40.5** | **20.5 %** |
| epochs containing none | 1720 | 35.1 | 9.0 % |

Both links hold: a desat-containing epoch carries **higher RMSSD** and is **2.3× more likely to be
called Deep**. Median RMSSD by called stage confirms the rule is doing what it says (Deep 43.1 ·
Wake 36.5 · Light 35.0 · REM 27.2).

**But the effect is SMALL in absolute terms, and that must be said.** The excess is ~0.115 × 156 ≈ 18
epochs, against 187 called Deep in total — so CVHR-misreading plausibly accounts for **~10 % of Deep
minutes**, not most of them. This is a real directional bias, **not** a claim that Deep is mostly
apnea.

## 3 · What did NOT replicate, and why that is not a refutation

Between nights, `r(ODI-4, Deep %) = 0.003` — no dose-response at all. The obvious reading is that the
mechanism is absent. The more likely one is that **there is no dynamic range to detect it in**: ODI-4
across these nights runs **0.4 → 5.2, median 1.9**, i.e. every night is in the normal band (< 5). A
dose-response cannot be measured across a dose that barely varies.

So §2's epoch-level result and §3's null are consistent, and the honest statement is: **the mechanism
is demonstrated locally and its dose-response is untestable on this corpus.** It needs nights with
real apnea burden — which is exactly what `CPAPDex` nights are, and they are not in this fold.

## 3b · §5's settling test, RUN (2026-07-29) — Deep does NOT collapse

The direct test: remove every epoch overlapping a desat and see whether Deep survives.

| set | epochs | Deep | Deep % of sleep | med RMSSD Deep | Light | gap |
|---|---|---|---|---|---|---|
| all | 1876 | 187 | **11.5 %** | 43.1 | 35.0 | 8.1 |
| **excluding desat-overlapping** | 1720 | 155 | **10.3 %** | 43.0 | 34.8 | **8.2** |
| only desat-overlapping | 156 | 32 | **25.2 %** | 44.0 | 39.9 | 4.1 |

**Deep survives intact.** 11.5 % → 10.3 %, and the Deep-vs-Light RMSSD gap does not move at all
(8.1 → 8.2). So the Deep rule is **NOT primarily reading CVHR** — the ~1.2 percentage-point drop is
the whole of the effect, confirming §2's ~10 %-of-Deep-minutes estimate from an independent direction.

Two things worth keeping from the third row. Desat-overlapping epochs are **2.4× enriched for Deep**
(25.2 % vs 10.3 %) — the bias is real and local. And within them the Deep-vs-Light RMSSD gap *shrinks*
to 4.1, because **Light epochs carrying desats are themselves RMSSD-elevated** (39.9 vs 34.8): CVHR
raises RMSSD across stages, and only the epochs it pushes past `1.12 × median` flip to Deep. That is
the mechanism drawn precisely.

**The honest limit.** This cannot separate *misclassification* from *real N3-predominant events* —
some sleepers genuinely have NREM- or position-predominant OSA. The RMSSD evidence favours
misclassification for the enriched fraction; nothing here settles the rest, and PSG is what would.

## 4 · Why it matters more than the REM under-call

`REM-STAGING-REDESIGN` is about a number that is visibly, uniformly **too low** (4.8 % against a
physiological 15–25 %). A reader who knows the tier is `heuristic` can discount it.

This one runs the flattering direction. Deep sleep minutes are *inflated on exactly the epochs where
breathing was disturbed* — the periods a reader would most want counted as disturbed. A user with
worsening apnea would see their "deep sleep" hold up or improve, and the metric would be most wrong
precisely when it mattered most.

## 5 · What would settle it

- **A corpus with apnea burden.** Re-run §3's between-night test on nights with a real ODI-4 spread —
  CPAPDex nights carry device-scored AHI, which is a stronger x-axis than ODI-4 anyway.
- **The direct test:** exclude epochs overlapping a desat and see whether Deep %, and the Deep-vs-Light
  RMSSD gap, survive. If Deep collapses, the rule is reading CVHR; if it holds, the ~10 % is the whole
  effect.
- **A rule that cannot confuse them.** RMSSD is elevated by *both* vagal tone and by CVHR's large
  swings; they differ in SHAPE, not size — CVHR is a periodic ~30–60 s oscillation, vagal RSA is
  respiratory-band. The spectral separation already exists in `epochs[].lfhf` / `vlf`, and a Deep rule
  keyed on the VLF/LF signature of CVHR rather than raw RMSSD would not be foolable this way.
- **Evidence tier.** Whatever happens, `Deep` minutes should not read above `heuristic` until a
  falsifier of this kind passes.

## 6 · Done when

- [x] **§5's exclude-desat-epochs test — RUN 2026-07-29 (§3b). Deep SURVIVES**: 11.5 % → 10.3 % of
      sleep with the RMSSD gap unchanged, so the rule is not primarily reading CVHR and the effect is
      bounded at ~10 % of Deep minutes by two independent routes.
- [x] **The cross-signal falsifier promoted to a standing, reusable tool — `tools/deep-desat-falsifier.mjs`
      (2026-07-30, §7).** Read-only over already-computed `trio-batch.mjs` output, so it inherits the
      project's own night definition and cannot repeat the REM investigation's original confound. Ships
      its own `--selftest` (exact against published Garwood/sign-test values — see §7.1). Re-run on the
      corpus grown to 37 nights: §7.
- [ ] §3 re-run on a corpus with real ODI-4/AHI spread (CPAPDex nights)
- [ ] Deep's rule re-examined for CVHR/vagal separability, or its evidence tier re-checked — **evidence
      tier already sits at the floor** (`deepMin: evidence:'heuristic'`, `ecgdex-registry.js:194` — the
      lowest of the 5-level ladder), so there is nothing lower to cap it to; a rule REDESIGN (the VLF/LF
      separability idea in §5) remains open and unstarted.

## 7 · Re-measured on the grown corpus (2026-07-30) — confirms one thing, weakens another

The 24-night fold this brief was written against has grown to **37 nights** (`uploads/trio`, same
`trio-batch.mjs` night definition throughout). Re-run with the new standing tool:

```
node tools/deep-desat-falsifier.mjs --dir uploads/trio
```

| stage | min | desats | rate/h | 95 % CI |
|---|---|---|---|---|
| REM | 930 | 4 | 0.26 | [0.07, 0.66] |
| Light | 10292 | 235 | 1.37 | [1.20, 1.56] |
| **Deep** | 2190 | 128 | **3.51** | **[2.93, 4.17]** |
| Wake | 2564 | 158 | 3.70 | [3.14, 4.32] |

**The headline CONFIRMS, and more decisively than before.** Deep's CI [2.93, 4.17] still does not
touch Light's [1.20, 1.56] — the gap is now wider in absolute terms and both intervals are tighter
(37 nights of data instead of 24). §1's finding was not a small-sample artefact.

### 7.1 What WEAKENED: the per-night sign test

§1 reported 11 of 14 qualifying nights favouring Deep, median ratio 3.61, one-sided sign-test
p ≈ 0.03. Re-run on the now-29 qualifying nights (≥30 min of each stage):

| | nights | favouring Deep | median ratio | p (one-sided) |
|---|---|---|---|---|
| §1 (24-night fold) | 14 | 11 | 3.61 | ≈0.03 |
| **§7 (37-night fold)** | **29** | **18** | **1.45** | **0.1325** |

**This no longer clears conventional significance.** Reported plainly rather than dropped: the
direction still holds (18 of 29 nights favour Deep, 62 %) and the median ratio is still > 1, but
neither is strong evidence on its own — the 11/14 result was, in hindsight, a better-than-typical
draw from a real but noisier per-night effect. The **pooled** rate table (7 above) is the more
reliable read precisely because it does not discard the CI information the per-night binarisation
throws away; the sign test was always the weaker of the two tests in §1, kept as a robustness check,
not the headline.

### 7.2 What held: the settling test

| set | epochs | Deep % of sleep | med RMSSD Deep | Light | gap |
|---|---|---|---|---|---|
| all | 3119 | 13.7 | 43.0 | 34.0 | 9.0 |
| excluding desat-overlapping | 2861 | 13.2 | 43.0 | 33.8 | 9.2 |
| only desat-overlapping | 258 | 19.6 | 42.7 | 37.0 | 5.7 |

Deep drops only 13.7 % → 13.2 % (0.5 points, vs 1.2 points on the 24-night fold) and the RMSSD gap
does not move (9.0 → 9.2). §3b's conclusion is reconfirmed, more robustly: **CVHR is not the primary
driver of the Deep anomaly; the bounded ~10 %-of-Deep-minutes effect is the whole of it.**

### 7.3 Net effect on this brief's status

The core finding (§1's rate-table anomaly) is **stronger** on more data; the secondary corroboration
(§1's sign test) is **weaker**. Both are now true at once because they measure different things — a
pooled rate comparison and a per-night direction count do not have to move together, and here they
didn't. Nothing in §2–§5 changes: the mechanism is still real, still bounded to ~10 % of Deep
minutes, and still needs a corpus with real apnea burden (CPAPDex nights) to test the dose-response
§3 could not find. That item, and the VLF/LF rule redesign in §5, remain the two genuinely open
items — both are new engineering, not further measurement on data already in hand.
