<!--
  DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-27 (all Done-when items closed; the last, the better LABEL, closed by §11a's desat-independent ResMed join — the hatch narrows to ≤26.1 % against the ~50 % §9.6 requires, so label noise is *unlikely, not excluded*, and excluding it needs PSG) · *(was IN-PROGRESS — 2026-08-01, itself* **corrected from PROPOSED, which had been wrong since §3b executed on 2026-07-29.** Five of six Done-when boxes are checked — §3b's settling test, `tools/deep-desat-falsifier.mjs`, the real-AHI re-run (§8), the CVHR/vagal separability re-examination (§9), and its re-measurement on properly merged nights (§11). The sixth, *a better LABEL*, is explicitly **not a code change** and needs a reference this corpus does not contain, so the brief cannot be DONE — but a brief with five executed sections is not PROPOSED either. Status verified against the boxes, not inherited.) · **Created:** 2026-07-29 · **Found-by:** running `REM-STAGING-REDESIGN` §5's cross-signal falsifier for the first time · **Relates:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` §7

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
- [x] **§3 re-run on a corpus with real AHI spread — RUN 2026-07-30 (§8). The x-axis finally HAS range
      (device-scored AHI 1.1→8.0, 7 nights in the abnormal band) and the between-night dose-response is
      still null — but the test is UNDERPOWERED for the effect size §2/§3b already bounded, so the null
      is uninformative rather than negative.** All 38 trio nights paired.
- [x] **Deep's rule re-examined for CVHR/vagal separability — DONE 2026-07-30 (§9).** Evidence tier
      already sits at the floor (`deepMin: evidence:'heuristic'`, `ecgdex-registry.js:194`), so there
      was nothing lower to cap it to. Separability was measured three ways and the rule is **NOT**
      changed: VLF discriminates but weakly (AUC 0.610, and 0.594–0.620 under every night-relative
      form), the targeted CVHR band does *worse* (0.567, CI spans 0.5), and no threshold yields a
      net-positive veto at 14 % contamination prevalence. §8.3's "blocked on an export gap" was wrong
      on both halves — `ECGDex.analyze()` was already public with `vlf` intact and `stageSleep()`
      receives the same rich epochs, so nothing was ever blocked (§9.1). The per-epoch band export
      shipped anyway (#569) as an additive convenience, not a prerequisite.
- [x] **§9 re-measured on properly merged nights — DONE 2026-07-30 (§11).** §9's probe re-parsed ONE
      ECG fragment per night (74.8 % of available ECG overall, 25.6 % on the worst night) — the same
      bug `#573` fixed in trio-batch's PpgDex path. Rewritten to read committed merged exports; both
      corpora re-folded so all 39 nights carry band fields. AUC barely moves (0.610 → 0.599) so the
      verdict is unchanged, but prevalence (14.3 → 11.8 %) and the break-even (a coarse-grid "~0.70",
      really 0.664 → 0.684) were both wrong and are corrected there.
- [x] **A better LABEL** — PSG, or flow-based apnea scoring not gated on a 3 % desaturation. §9.6 bounds
      why: ~50 % of "clean" Deep epochs would have to hide unscored apnea before VLF's true power
      clears the actionable threshold. This is the only remaining lever, and it is not a code change.

      **CLOSED 2026-08-27 — the lever was pulled, and it answered.** The item offers a choice ("PSG,
      **or** flow-based apnea scoring"), and the flow-based half was obtained and applied: the ResMed's
      own `_EVE.edf` scoring, which is **desat-independent by construction**, joined to `sleepStages`
      across **29 nights** and swept over ±45 min of clock offset so the ResMed skew is *bounded rather
      than assumed away* (§11a).

      | | required by §9.6 | measured (§11a) |
      |---|---|---|
      | share of clean Deep epochs hiding unscored apnea | **~50 %** | **16.8 %** nominal · **26.1 %** worst-case over any tested misalignment |

      **The verdict is a result, not an incompleteness of this box:** the label-noise explanation is
      **unlikely, not excluded** — a factor of ~2 short, where §11's original claim of an order of
      magnitude was itself corrected (it had bounded on 30 s epochs while this brief works in 5-minute
      ones). Deep is **not** enriched for flow events (16.8 % vs 13.8 % non-Deep, with non-Deep flat at
      12.9–15.1 % across every shift), which retires the concentration scenario §11 raised as the reason
      the hatch might still close.

      ⚠️ **What would EXCLUDE it is PSG, and that is a data-acquisition question, not this brief's
      work.** Two limits carry forward unchanged and are why "excluded" is not claimed: the subject is
      **treated**, so residual events measure the therapy working rather than apnea prevalence; and the
      bound is conditional on **the ResMed's own sensitivity**. Both are stated in §11/§11a and neither
      is repairable by more analysis of this corpus.
      > **PARTLY ANSWERED 2026-08-20 — the label EXISTS, on 29 of these nights, and it already narrows
      > the hatch by an order of magnitude. See §11.**

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

---

## 8 · The CPAPDex re-run, done (2026-07-30) — and the redesign is BLOCKED, not merely unstarted

§7's closing line said the two open items were "new engineering, not further measurement on data
already in hand." The first half of that was wrong: the AHI x-axis **was** already in hand — 199
nights of it, on the capture host's own SD card. Run:

```sh
node tools/cpap-corpus.mjs --root <captures>/cpap/DATALOG --out /tmp/cpap-exports.json   # 199 nights, 1359 therapy h, 0 problems
node tools/deep-desat-falsifier.mjs --dir uploads/trio --cpap /tmp/cpap-exports.json
```

### 8.1 The x-axis finally has range — and the dose-response is still null

| x-axis | min | median | max | nights ≥5 (abnormal) | verdict |
|---|---|---|---|---|---|
| ODI-4 (§3, why it failed) | 0.4 | 1.9 | 5.2 | ~0 | no range ⇒ **untestable** |
| **device-scored residual AHI** | **1.1** | **2.9** | **8.0** | **7 of 38** | **7.2× range ⇒ testable** |

All **38** trio nights paired with a CPAP night (the SD card spans 2026-01-11 → 07-29, covering the
whole trio corpus). Against Deep % of staged sleep:

| test | r | p |
|---|---|---|
| Pearson r(AHI, Deep %) | **−0.174** | 0.298 |
| Spearman ρ(AHI, Deep %) | −0.080 | 0.633 |
| Pearson r(**cvhrIndex**, Deep %) — the DIRECT measure | **+0.169** | 0.311 |

The third row matters more than the first two. `apnea.cvhrIndex` is already in every ECGDex export, so
the mechanism can be tested against *itself* rather than against a treated-apnea proxy — and there the
sign is **positive**, as the hypothesis requires. It is just small.

### 8.2 The null is UNINFORMATIVE, and saying so is the point

At n = 38 the 80 %-power detection floor is **|r| ≥ 0.441**. The observed 0.169 sits far below it. So
this test can only exclude a *large* between-night effect — and §2/§3b independently bounded the
effect at **~10 % of Deep minutes**, which is precisely the size that produces a between-night r too
small to resolve here.

**So the null and the epoch-level finding are consistent, not contradictory.** Reporting "no
dose-response" without the power figure would have been the same error §3 made with ODI-4, one level
up: mistaking an untestable null for a negative result. The tool now prints the x-axis spread and an
explicit `x-axis has usable range: YES/NO` line next to every correlation for exactly this reason.

### 8.3 Why the §5 redesign cannot proceed yet — `lfhf` is structurally blind to CVHR

§5 proposed keying Deep on "the VLF/LF signature of CVHR rather than raw RMSSD," noting *"the spectral
separation already exists in `epochs[].lfhf` / `vlf`."* Half of that is wrong, and it is the load-bearing
half. Measured on the 38 nights:

| epochs | median `lfhf` | n |
|---|---|---|
| Deep **+ desat** (CVHR-suspect) | **1.77** | 52 |
| Deep, clean | **1.78** | 399 |
| Light + desat | 1.94 | 120 |
| Light, clean | 1.75 | 1924 |

**Separation between CVHR-suspect and clean Deep epochs: 0.00.** That is not sampling noise, it is
mechanical. CVHR is a 20–45 s oscillation ⇒ **0.022–0.05 Hz**, and `ecgdex-dsp.js:1120` bands VLF as
`f < 0.04`. So CVHR power lands in **VLF** — and `lfhf` is LF/HF, which **excludes VLF entirely by
construction**. A ratio that does not contain the band the signal lives in cannot see it.

`vlf` *is* computed per epoch (`ecgdex-dsp.js:1145`, `:1367`) but the export's `timeseries.epochs`
carries only `{tMin, hr, rmssd, sdnn, lfhf, resp, motionIndex, position}` — **no `vlf`, no `lf`**. So
the discriminator the redesign depends on is unmeasurable from committed exports today.

### 8.4 The actual next step, in order

1. **Add per-epoch `vlf` + `lf` to the ECGDex export.** Additive and behaviour-neutral for every
   existing metric, but it changes export CONTENT — so it moves ECGDex's `manifestHash` *and*
   `computeHash`, and its fixtures' `outputHash` genuinely move. Regenerate via
   `tools/regen-ecgdex-goldens.mjs`, then re-verify (`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`).
   Per `DEEP-AUDIT-III-FOLLOWUPS-II` §6.11 this class of change is **auto-gated by the equiv legs**, so
   it is the cheap kind of risky.
2. **Then measure whether VLF actually separates** CVHR-suspect from clean Deep epochs, the same way
   §8.3 just measured that `lfhf` does not. If it does not separate either, the redesign is dead and the
   honest outcome is that `Deep` stays `heuristic` with the ~10 % bias documented.
3. **Only then redesign the rule.** Shipping a VLF-keyed Deep rule before step 2 would be exactly the
   mistake this whole line of work exists to avoid: a detector whose discriminator was never shown to
   discriminate.

**Nothing about `Deep` should move until step 2 returns a number.** The bias is real, bounded at ~10 %,
and already at the lowest evidence tier — which is a tolerable place to sit while the discriminator is
established, and a much better one than a redesign justified by a spectral separation that has not been
demonstrated to exist.

---

## 9 · The §5 redesign, MEASURED — NOT ACTIONABLE AT CURRENT LABEL QUALITY (2026-07-30)

> **Superseded in part by §11 (same day).** Every number in this section came from a probe that
> re-parsed ONE fragment of each night's ECG. Re-measured on properly merged nights the AUC barely
> moves (0.610 → 0.599) and the VERDICT is unchanged, but two figures here are wrong and are corrected
> in §11: contamination prevalence (14.3 % → **11.8 %**) and the "~0.70 break-even", which was a
> coarse-grid artifact (**0.664** at 14.3 % prevalence, **0.684** at 11.8 %). Read §11 for the
> corrected values; the reasoning below stands.

§8.4 sequenced the redesign as "export `vlf` → measure → redesign". **The first step was unnecessary
and the third turns out to be unwarranted.** Both corrections come from measurement, on the largest
raw-ECG set available: **38 nights, 2652 staged epochs**, drawn from BOTH raw corpora (the capture
host's `_YYYYMMDDHHMMSS_ECG.txt` and the older tri-device corpus's `_YYYYMMDD_HHMMSS_ECG.txt` —
scanning only the first caps the run at 13 nights).

### 9.1 No export change was ever needed

`ECGDex.analyze()` is **already public** (`ecgdex-dsp.js:4171`) and its epochs carry `vlf`/`lf`/`hf`/`tp`
intact; only `ecgBuildNodeExport` strips them. Better still, **`stageSleep(epochs, …)` receives those
same rich epochs** and already reads `e.lfhf` one line above the Deep branch — so `e.vlf` is in scope
*exactly where a fix would go*. §8.4's premise that the rule was blocked on an export field was simply
wrong: neither the measurement nor the rule needs one.

### 9.2 VLF really does carry the signal RMSSD cannot see

Median `vlf/lf`, Deep epochs overlapping a desat vs clean (38 nights):

| feature | Deep+desat | Deep clean | separation |
|---|---|---|---|
| `rmssd` — **what the rule keys on** | 42.4 | 42.2 | **+0 %** |
| `lfhf` — what §5 named | 1.7 | 1.7 | **−0 %** |
| `lf` alone | 877.5 | 895.5 | −2 % |
| **`vlf/lf`** | **2.17** | **1.222** | **+78 %** |

Two things worth pinning. **RMSSD is completely blind (+0 %)** — the feature the Deep rule decides on
carries no information about whether the epoch is CVHR-contaminated, which is precisely why the rule
is foolable and why no amount of threshold-tuning on RMSSD could fix it. And **`lf` alone is blind
(−2 %)**, so the effect is specifically the VLF band, not general power inflation — the "it's just more
variance" confound is ruled out.

By ROC over every epoch (not medians), within Deep:

| feature | AUC | 95 % CI | verdict |
|---|---|---|---|
| **`vlf/lf`** | **0.610** | **[0.528, 0.692]** | discriminates — CI excludes 0.5 |
| `VLF/tp` | 0.593 | [0.511, 0.676] | discriminates |
| `vlf` | 0.592 | [0.510, 0.674] | discriminates |
| `rmssd` | 0.516 | [0.435, 0.597] | **not established** |
| `lfhf` | 0.477 | [0.398, 0.556] | **not established** |

So §5's hypothesis was right in substance — there IS a spectral signature RMSSD misses — and wrong in
its specific nomination of `lfhf`, which is structurally incapable (§8.3).

### 9.3 …and it is still not enough to act on. The base rate defeats it.

AUC 0.610 is established but **weak** (0.5 = chance, 0.7 = conventionally "acceptable"). What matters
is what a threshold would DO. Sweeping θ on `vlf/lf` over 58 contaminated and 348 clean Deep epochs:

| θ | contaminated caught | genuine Deep destroyed | net |
|---|---|---|---|
| 1.5 | 34/58 (59 %) | 150/348 (43 %) | **−116** |
| 2.0 | 30/58 (52 %) | 142/348 (41 %) | **−112** |
| 2.5 | 27/58 (47 %) | 126/348 (36 %) | **−99** |
| 3.0 | 23/58 (40 %) | 113/348 (32 %) | **−90** |
| 4.0 | 20/58 (34 %) | 90/348 (26 %) | **−70** |

**Every operating point is a net loss.** At no threshold does a VLF veto remove more contamination than
genuine deep sleep. The reason is base rate, not the discriminator: contamination is only ~14 % of Deep
epochs here (consistent with §2/§3b's ~10 % of Deep *minutes*), and a 0.61-AUC feature cannot clean a
14 %-prevalence minority without shredding the 86 % majority.

**One caveat that does not rescue it.** The 348 "clean" epochs are only *presumed* genuine — some carry
apnea OxyDex never scored (a hypopnea with arousal but no 3 % desaturation leaves no `desat_event`). So
"genuine Deep destroyed" is an over-estimate of true loss. But the margin is 43 % vs 59 % at the most
aggressive θ; no plausible correction flips a −116 net to positive.

### 9.4 Conclusion: NOT ACTIONABLE at current label quality — and that is weaker than "refuted"

> **Revised 2026-07-30 (same day).** This section first read *"the redesign is REFUTED as specified."*
> That overstated the evidence and is withdrawn. The per-night pooled CI reaches **0.725**, i.e. it does
> NOT exclude the ~0.70 break-even, so "refuted" was a stronger claim than the interval supports. What
> the data supports is *not actionable at current label quality* — a different statement, with a
> different remedy (§9.6).

- **Do NOT ship a VLF-keyed Deep veto** — on the evidence in hand it makes the metric worse, not better.
  That conclusion is about the OPERATING POINT, which is solid (§9.3); it is not a claim that VLF is
  uninformative, which §9.5 shows is false.
- The confound remains **real, bounded, and documented**: ~10 % of Deep minutes, by three independent
  routes now (§2 epoch-level, §3b settling test, §9.3's contamination share).
- `deepMin` is already `heuristic`, the lowest tier — the correct place for a metric with a known,
  bounded, unfixable-at-present bias. Nothing to downgrade.
- What would actually move this is **not a better HRV feature but a better label**: PSG, or at minimum
  an apnea label that does not depend on a 3 % desaturation threshold. §3b already said the RMSSD
  evidence cannot separate misclassification from genuine N3-predominant OSA; §9 adds that no spectral
  feature available to ECGDex can either.

**The negative result is the deliverable.** A VLF-keyed rule would have looked principled, cited a real
spectral separation, and shipped a metric that was measurably worse — the precise failure mode this
brief's whole line of work exists to catch, avoided by measuring the operating points instead of
stopping at a significant AUC.

### 9.5 Two further attempts to rescue VLF, both measured, both failed

Recorded because each was a plausible reason the AUC might be artificially low, and finding out cost
one run apiece. Neither is a reason to revisit §9.4; together they make it considerably more robust.

**(a) Wrong band?** VLF spans 0.003–0.04 Hz, but a 300 s epoch resolves that range very unevenly:
0.003 Hz is a 333 s period — under ONE cycle in the window — while CVHR at 0.022–0.04 Hz gets 7–12.
So `vlf` averages the CVHR-relevant slice together with a mostly unresolvable trend region, which can
only attenuate it. `detectCVHR` already band-passes 0.022–0.05 Hz exactly and emits per-event
`{sec, ampBpm, periodSec}`, so the targeted feature was already available and simply untested.

| feature (within Deep) | AUC | 95 % CI |
|---|---|---|
| `vlf/lf` (the diluted band) | **0.610** | [0.528, 0.692] |
| `cvhrDensity` (targeted 0.022–0.05 Hz) | **0.567** | [0.485, 0.649] — **not established** |
| `cvhrAmp` (targeted, amplitude-weighted) | 0.561 | [0.479, 0.643] — not established |

**The targeted band did WORSE**, and its CI includes 0.5. Likely cause: `detectCVHR` is an EVENT
detector with hard gates (≥5 bpm amplitude, 14–46 s period, 14 s refractory), so it discards subtle
CVHR, and a handful of events per 5-min epoch is a far coarser signal than continuous band power. The
dilution is real; this cure is worse than the disease.

**(b) Wrong units?** Every stage rule in this DSP is night-relative (`rmssd > 1.12 × median`,
`_relGate` on lfhf) because absolute HRV amplitude varies severalfold between nights. §9 evaluated
VLF in ABSOLUTE ms², which is not how a rule would ever consume it, and pools between-night baseline
shift into the comparison where it can only depress AUC.

| `vlf/lf` scoring | AUC | 95 % CI |
|---|---|---|
| absolute (what §9.2 tested) | 0.610 | [0.528, 0.692] |
| ratio to night median (the shipped rule's own shape) | 0.594 | [0.512, 0.676] |
| within-night rank (distribution-free) | 0.602 | [0.520, 0.684] |
| per-night AUC, inverse-variance pooled | **0.620** | **[0.515, 0.725]** |

All four land at ~0.60. **Removing between-night variation changes nothing**, which localises the
problem: the class overlap is WITHIN nights, not between them. It also answers a reasonable worry —
that pooling 90 nights of a drifting baseline would degrade the estimate. Under night-relative scoring
it would not, because each epoch is scored against its own night; but there is no gain to collect.

**What the per-night view DOES add, and it is the reason §9.4 was softened:** across the 11 nights
carrying both classes, **10 of 11 favour the effect** (median per-night AUC 0.65, range 0.25–0.80).
The effect is *consistent*, not carried by a few nights — and the pooled interval reaches 0.725, above
break-even. VLF is not noise. It is a real, reproducible, weak signal.

### 9.6 The ceiling is the LABEL, not the sensor — with a bound

Worth stating because "the sensors aren't sensitive enough" is the intuitive explanation and it is
wrong. The H10 resolves RR to ~1 ms; VLF power on a real night runs to thousands of ms². Beat-timing
noise sits orders of magnitude below the signal, and the O2Ring detects the desaturations it is asked
to detect. Neither instrument is near its floor.

The noise is in the LABEL. "Contaminated" here means *an OxyDex `desat_event` overlapped this epoch* —
a downstream, delayed, threshold-gated CONSEQUENCE of apnea. On CPAP especially, many events never
produce a 3 % dip, so an unknown share of the "clean" epochs are contaminated-but-unlabelled, and
mislabelled negatives attenuate AUC toward 0.5. Modelling that share as ε with
`A_true = (A_obs − 0.5ε)/(1 − ε)`:

| ε (clean epochs secretly containing apnea) | implied true AUC | clears 0.70? |
|---|---|---|
| 20 % | 0.637 | no |
| 40 % | 0.683 | no |
| **50 %** | **0.720** | **yes** |

So **half** the clean Deep epochs would have to be hiding unscored apnea before VLF's true power clears
break-even. That is the quantitative form of §9.4's last bullet: the remedy is a better label — PSG, or
flow-based apnea scoring not gated on a 3 % desaturation — and NOT a better HRV feature. Two independent
attempts at a better feature (§9.5a, §9.5b) both failed, which is what that bound predicts.

---

## 10 · PARKED (2026-07-30): §9 is not stratified by clock quality — wait for 14 vigil nights

> **UNPARKED and CLOSED by §12 (2026-07-30).** The 14th vigil night landed and the split was run. The
> hypothesis below — that drift dilutes the effect, so clean-clock nights would read sharper — is
> **not supported**: the vigil arm measures *lower* (0.536 vs 0.625), Δ = −0.088, p = 0.35, and a
> placebo cut inside the legacy era produces the same ±0.09 gap for free. Read §12. One claim below
> was also wrong: the probe was **not** written — it had to be rebuilt (§12.5).

§9's numbers pool **two corpora with different timing discipline**, and that is an uncontrolled
confound in the conclusion, not a detail:

| corpus | nights folded | clocks |
|---|---|---|
| **vigil capture host** (`2026-07-16 →`) | **13** | ONE daemon, all three devices actively `clock_synced` (per-device stamp in `status.json`) |
| older tri-device corpus (`2026-06-10 → 07-12`) | 25 | three free-running device clocks, no sync |

**Why it could matter.** Every figure in §9 comes from mapping an OxyDex `desat_event` onto the ECGDex
epoch containing it. That mapping assumes the O2Ring and H10 clocks agree. Inter-device drift
misassigns desats to neighbouring epochs, which **smears the contrast and biases AUC toward 0.5** — so
§9's "discriminates but too weakly to act on" (AUC 0.610) could be a *diluted* reading of a sharper
underlying effect, produced by averaging clean nights with skewed ones.

**Why it is parked rather than answered.** The vigil subset is currently the *smaller* half — 13 of 38
nights, and only ~1/3 of the Deep+desat epochs that carry the signal. Splitting 58 contaminated Deep
epochs across two arms leaves each arm too small to compare AUCs meaningfully; the comparison would
inherit exactly the instability §9 already saw between n=8 and n=13 (separations swinging +159 % → +59 %).
**Owner decision 2026-07-30: wait until the vigil box has ~14 days of clean capture, then stratify.**
The probe is written and tags every epoch with its source corpus, so this is a re-run, not a rebuild.

**Status of the raw data at parking time.** The capture host holds **15** day-folders (`2026-07-16 →
2026-07-30`); **13** are folded into `uploads/trio`. `2026-07-29` and `2026-07-30` are captured but not
yet folded — `node tools/trio-batch.mjs --src <captures> --skip-existing` picks them up.

**What this does and does not change about §9.** It does **not** rescue the redesign on its own: §9.3's
refutation is a **base-rate** argument (contamination is ~14 % of Deep epochs, so even a *perfect*
discriminator has little to gain and a mediocre one loses), and better timing raises AUC without
changing prevalence. For the veto to become viable, the vigil-only AUC would have to rise far enough
that a threshold finally clears net-zero — which is a real possibility worth testing, but not the way
to bet. **Until that re-run happens, §9.4 stands as revised (not actionable, not refuted) and nothing about `Deep` should move.**

---

## 11 · RE-MEASURED on properly merged nights (2026-07-30) — §9's sampling was biased, its verdict survives

Every figure in §9 came from a probe that re-parsed **ONE fragment** of each night's ECG
(`sort(bySize)[0]`). `#573` found the identical bug in `trio-batch`'s PpgDex path — `l[0]`, 99 % of the
IMU discarded — and finding it there is what prompted auditing my own harness. Mine was less severe
(largest fragment, not first) but the same shape:

| | |
|---|---|
| ECG available across the corpus | 8371 MB |
| used by the §9 probe | **6264 MB — 74.8 %** |
| worst night (2026-07-18, 83 fragments) | **25.6 %** |
| 2026-07-16 / 07-17 | 32.8 % / 33.6 % |

**The fix was not a better fragment picker.** `trio-batch.mjs` OWNS session merging and the night
definition, and since `#569` the ECGDex export carries per-epoch `vlf/lf/hf/totalPower`. So the probe
was rewritten to read the **committed, merged exports** — exactly as `tools/deep-desat-falsifier.mjs`
already did — instead of re-deriving nights itself. Re-deriving the night is what confounded the
original REM measurement; doing it again in a second harness was the same mistake wearing a different
hat. Both corpora were re-folded so all 39 nights carry the band fields (nights folded before `#569`
are **skipped and counted**, never silently read as having no VLF).

### 11.1 What moved, and what did not

| | §9 (fragment sample) | §11 (merged, corrected) |
|---|---|---|
| nights | 38 | **39** |
| contaminated / clean Deep epochs | 58 / 348 | **54 / 403** |
| **contamination prevalence** | 14.3 % | **11.8 %** |
| `vlf/lf` AUC | 0.610 [0.528, 0.692] | **0.599 [0.515, 0.683]** |
| `VLF/tp` AUC | 0.593 | 0.588 |
| `rmssd` AUC | 0.516 (not established) | 0.546 (not established) |
| per-night pooled | 0.620 [0.515, 0.725] · 10/11 | 0.595 [0.470, 0.720] · 6/7 |

**The AUC barely moved: 0.610 → 0.599.** So the fragment bias did *not* materially distort the
discrimination estimate — worth stating plainly, because the honest prior when a sampling flaw is found
is that everything downstream is suspect, and here it was not.

**Prevalence did move, 14.3 % → 11.8 %**, and in the direction I did *not* predict. I expected the
largest-fragment pick to bias toward the calmest stretch and so UNDERSTATE contamination. The opposite
happens, for a duller reason: a full night contributes many more clean Deep epochs while the desat set
is unchanged, so the denominator grows and prevalence falls. The prediction was wrong; the measurement
is what settles it.

### 11.2 A correction to §9's own break-even figure

§9 repeatedly cited a "~0.70 break-even". **That number was an artifact of a coarse grid** — the sweep
stepped 0.61 → 0.65 → 0.70, so 0.70 was simply the first grid point that showed a net gain, not the
break-even. Computed properly (0.001 steps, same normal model):

| prevalence | true break-even AUC |
|---|---|
| 14.3 % (fragment sample) | **0.664** |
| **11.8 % (merged corpus)** | **0.684** |

Two consequences, pulling in opposite directions and both worth stating. The bar was **lower** than §9
claimed (0.664, not 0.70), so 0.610 was closer to actionable than the text implied. But the corrected
prevalence **raises** the bar to 0.684 — a rarer contaminant is harder to pay for — while the corrected
AUC falls to 0.599. Net: the gap between measured and required is essentially unchanged.

### 11.3 The verdict, on better data

Measured `vlf/lf` = **0.599, CI [0.515, 0.683]**, against a break-even of **0.684**:

- The CI **excludes 0.5** — VLF is a genuine discriminator, confirmed on merged data.
- The CI's upper bound (0.683) sits **just below** the break-even (0.684). By a hair — far too fine a
  margin to lean on, and not a basis for hardening the language.
- The per-night view weakened (7 nights with both classes, down from 11, because merged nights carry
  more clean epochs), so it no longer adds independent support: 0.595 [0.470, 0.720], 6/7 favouring.

**§9.4's verdict stands unchanged: NOT ACTIONABLE at current label quality, and still not "refuted".**
The evidence for it is now better — same conclusion from a corpus with no fragment sampling and no
skipped nights — and the §9.6 label-noise bound is untouched, since it depends on the mislabelled-
negative share rather than on either AUC.

**What this episode is really about.** Three separate re-measurements have now improved this
investigation, and none of them changed the answer: the targeted-band attempt (§9.5a), the
night-relative attempt (§9.5b), and this one. A conclusion that survives its own author trying three
times to overturn it is worth more than the first version of it was — and the two figures that WERE
wrong (prevalence, break-even) were both found by re-running rather than by re-reading.

---

## 12 · §10 UNPARKED and CLOSED (2026-07-30) — clean clocks do not sharpen the effect

§10 parked the clock-quality stratification until the vigil box had ~14 clean nights. **It now has
exactly 14** (`2026-07-16 → 07-29`, all folded), against 25 free-running-clock nights, so the split
§10 specified has been run. Its hypothesis is **not supported**, and the point estimate moves the
*opposite* way from the prediction.

| arm | nights | Deep epochs | contaminated / clean | prevalence | `vlf/lf` AUC | 95 % CI |
|---|---|---|---|---|---|---|
| **vigil** — one daemon, all three devices `clock_synced` | 14 | 179 | 15 / 164 | **8.4 %** | **0.536** | [0.381, 0.692] — **not established** |
| **legacy** — three free-running device clocks | 25 | 278 | 39 / 239 | **14.0 %** | **0.625** | [0.525, 0.724] — discriminates |
| pooled (control, reproduces §11 exactly) | 39 | 457 | 54 / 403 | 11.8 % | 0.599 | [0.515, 0.683] |

**Δ = −0.088, 95 % CI [−0.273, +0.096], z = −0.94, p = 0.35.** §10 predicted Δ > 0 — that better
timing would recover a sharper effect diluted by drift. The measured sign is negative and the
interval spans zero.

### 12.1 The placebo split — a ±0.09 arm gap is what this corpus produces for FREE

A non-significant Δ of the *wrong* sign is weak evidence on its own; it could just be two small arms.
So the split was re-run with a **fake boundary inside the legacy era** (`--until 2026-07-13
--vigil-from 2026-06-27`), where clock discipline is *identical* on both sides and any gap is
therefore noise by construction:

| split | arms | Δ `vlf/lf` AUC | p | prevalence gap |
|---|---|---|---|---|
| **real** (vigil vs legacy) | 14 / 25 | **−0.088** | 0.35 | 8.4 % vs 14.0 % |
| **placebo** (fake cut at 2026-06-27, legacy era only) | 15 / 10 | **+0.088** | 0.39 | 11.7 % vs 17.2 % |

**Identical magnitude, opposite sign, same non-significance** — and the placebo's late arm reaches
AUC 0.669 [0.529, 0.809], *higher than either real arm*, purely from choosing a date. An arm gap of
±0.09 in AUC and ~5 pp in prevalence is this corpus's noise floor at n ≈ 15 contaminated epochs. The
real vigil/legacy difference is **indistinguishable from a cut made at random**, which is a much
stronger statement than "p = 0.35" alone, and it is only available because the placebo was run.

A second stability check says the same thing. The vigil boundary is a capture-side fact (`2026-07-16`
is simply the host's first night, not a tunable), but moving it by three nights either way swings the
arm's AUC across almost the whole gap being argued about:

| `--vigil-from` | vigil nights | vigil `vlf/lf` AUC |
|---|---|---|
| 2026-07-13 | 15 | 0.560 [0.416, 0.703] |
| **2026-07-16 (the real boundary)** | **14** | **0.536 [0.381, 0.692]** |
| 2026-07-19 | 11 | 0.621 [0.429, 0.813] |

None of the three establishes an effect, and the spread across them (0.085) is the same size as Δ
itself. **No conclusion here survives being read off a single arm's point estimate**, which is why
§12.2 decides on the operating-point net instead.

### 12.2 The decision does not change in EITHER arm

The operating-point sweep — the thing that actually decides the veto (§9.3) — is negative at every θ
on both sides of the split:

| θ on `vlf/lf` | vigil net | legacy net |
|---|---|---|
| 1.5 | **−69** | **−80** |
| 2.5 | −58 | −67 |
| 4.0 | −39 | −49 |

So the clean-clock corpus does not rescue the veto; it loses there too. And it is worse off than the
pooled figure suggests **for two compounding reasons**: the vigil arm's AUC is *lower* (0.536), and
its contamination prevalence is *lower* (8.4 % vs 14.0 %) — which by §11.2's own logic **raises** the
break-even bar, because a rarer contaminant is harder to pay for. The arm with the honest clocks needs
a better discriminator and supplies a worse one.

### 12.3 The shift profile is not usable as a clock diagnostic at this n

The probe can re-map desats under an artificial time offset and re-measure — a corpus with skewed
clocks should peak off zero. Run over ±45 min it does **not** produce a usable read: AUC spikes to
0.670 at −15 min and 0.668 at −45 min while both *neighbouring* shifts sit near 0.43, and a real
clock offset cannot produce a one-point spike flanked by troughs (adjacent shifts share most of their
desats). The one legible signal is the **count**: contaminated Deep epochs peak sharply at zero shift
(54 pooled; legacy 39 against a next-best 35), which is mild evidence against a gross offset in
either arm — but it is a by-product, not the test. **Recorded so the next reader does not re-run it
expecting an answer.**

### 12.4 What §10's wait actually bought, and the honest limit

§10 predicted the split would be underpowered and deferred it for more nights. **It is still
underpowered** — the vigil arm carries 15 contaminated epochs and a CI 0.31 wide — so this does not
*prove* clock quality is irrelevant; it shows the hypothesis has no support and that the decision is
unchanged either way. Two limits are worth stating plainly:

- **Era is perfectly confounded with clock discipline.** Every vigil night is later than every legacy
  night, so therapy drift, mask changes, or seasonal effects are inseparable from timing by this
  design. §12.1's placebo is what makes the result interpretable in spite of that — it prices the
  confound rather than assuming it away.
- **Waiting longer is not obviously worth it.** Doubling the vigil arm would narrow its CI by ~√2,
  to roughly ±0.11 — still far too wide to resolve a 0.09 difference, and the operating-point net
  would have to change sign, not merely the AUC. §10's "real possibility worth testing" has been
  tested; it is not where the remaining uncertainty lives.

**§10 is unparked and CLOSED. §9.4's verdict stands, now on both sides of the clock split: NOT
ACTIONABLE at current label quality, and still not "refuted".** §9.6's bound is untouched — the
ceiling is the LABEL, and a fourth attempt to find a better feature has now failed alongside the
targeted-band (§9.5a) and night-relative (§9.5b) ones.

### 12.5 The probe is now a committed tool — §10's "this is a re-run" was not true

§10 stated *"the probe is written and tags every epoch with its source corpus, so this is a re-run,
not a rebuild."* **It was a rebuild.** The script behind §9 and §11 was a throwaway that no longer
existed, and every number above had to be re-derived from the brief's prose. That is the same failure
§11 documents one level up (an uncommitted harness silently sampling ONE ECG fragment per night),
and the fix is the same one #565 applied to the falsifier: **`tools/deep-vlf-probe.mjs`** is now a
standing tool, with `--selftest` pinning the AUC/CI math against §9's and §11's *published* intervals
so a future edit cannot quietly re-write the brief's own numbers. The next re-run really is a re-run.

One casualty is permanent: the normal-model script behind §11.2's break-even figures (0.664 / 0.684)
was not recoverable, so §12 decides on the **empirical** operating-point net instead, which needs no
model. §11.2's numbers stand as published; they are not re-derived here.

## 11 · The "better LABEL" is not PSG-only — the ResMed already scores flow, desat-independently (2026-08-20)

§6's last box reads as blocked on data nobody has: *"PSG, or flow-based apnea scoring not gated on a 3 %
desaturation … not a code change."* The second half of that disjunction is **available**, on the same
nights, through a parser this repo already ships.

**The ResMed writes its own event scoring to `*_EVE.edf`, and it has no oximeter** — so its
apnea/hypopnea labels cannot be gated on a 3 % desaturation, which is exactly the independence §9.6
needs. `CpapEdf.readEDF` + `CpapDsp.eveEvents` already parse them into typed events; no new code.

**Overlap with this brief's corpus: 31 nights carry both, 29 of them with usable event files.**
(`uploads/trio` ∩ `Ecg-nightly-archive/CPAP`, 192 CPAP nights available in total.)

| | |
|---|---|
| nights with flow labels **and** trio signals | **29** |
| recorded hours (denominator from `_BRP.edf`, `numRecords × recDurSec`) | **186.1** |
| flow-scored events | **647** — Central Apnea 492 · Hypopnea 118 · Obstructive Apnea 37 |
| device residual AHI | median **2.9/h** (1.11 – 7.08) |
| event-time as a share of recorded time | median **0.96 %**, pooled **1.27 %**, worst night 3.08 % |
| **30 s epochs touched by ANY flow event — upper bound** | **1197 of 22336 = 5.36 %** |

The epoch figure is a deliberate **upper** bound: an event of duration D is charged `ceil(D/30) + 1`
epochs, so a 13 s event (the median) costs 2 epochs even when it falls inside one.

### What it does and does not settle

🔴 **CORRECTED 2026-08-20, same day — the 5.36 % below was computed at the WRONG GRANULARITY and the
"order of magnitude" claim it supported is WITHDRAWN. The corrected figures and the Deep-epoch join are
in §11a; read that instead of this paragraph.**

> ~~**§9.6's escape hatch needs ~50 % of clean Deep epochs to hide unscored apnea. A desat-INDEPENDENT
> instrument, on these same nights, finds flow events touching at most 5.36 % of ALL epochs.** That is an
> order of magnitude short, and it is measured rather than assumed.~~

⚠️ **It does not close the hatch outright, and the reason is worth stating precisely.** The bound is over
*all* epochs; §9.6 is about *Deep* epochs specifically. If every residual event concentrated into Deep
sleep — say 15–20 % of the night — Deep-epoch contamination could reach **~27–36 %**, which is below 50 %
but no longer by an order of magnitude. Ruling that out needs the events matched to staged epochs, which
needs per-night clock alignment (see `cpap-clock-42min-offset`: the ResMed ran 42 min behind on
2026-07-26, and the Integrator caught it). **The prevalence bound above is alignment-INDEPENDENT** — it
counts event-seconds against recorded seconds within one device's own file — which is why it is reported
first and separately.

⚠️ **Second limit: this is a TREATED patient.** CPAP is suppressing the events, so a low residual is the
therapy working, not evidence about untreated physiology. That does not weaken the argument for *this*
brief — its epochs come from these same treated nights, so the label noise on those epochs is what the
verdict rests on — but it does mean the number must never be quoted as an apnea prevalence.

⚠️ **Third: the bound is conditional on the ResMed's own sensitivity.** A flow-limitation event the
device does not score is invisible here too. This narrows the hatch; it does not seal it.

**Owed next, and now cheap:** match the 647 events to staged epochs on the 29 nights (clock-aligned per
night, refusing any night whose skew cannot be established) and read the Deep-epoch share directly. That
turns the 5.36 % all-epoch bound into the Deep-epoch number §9.6 actually asks for.

### Method note — three well-formed zeros on the way here

Getting these numbers produced **three** clean, plausible zeros in a row, each from a guessed API name
inside a `try/catch`: `parseEDF` (the function is `readEDF`), then `nRecords`/`recordDurSec` (they are
`numRecords`/`recDurSec`), then a duration of 0 from the `_EVE` files themselves — which is **correct**,
because an annotation-only EDF has `recDurSec = 0` and the denominator has to come from `_BRP`.

The first two printed *"29 nights, 0 events"* and *"0 nights with a readable duration"* — both
well-formed, both wrong, and the first would have been written up as *"the CPAP corpus has no event
data"*. `CLAUDE.md` §👥.4b's family exactly. **Read the API, do not guess it; and never let a `catch`
swallow the error that would have told you.**

## 11a · CORRECTION and the Deep-epoch join — the hatch narrows to a factor of ~2, not 10 (2026-08-20)

### The error

§11 bounded contamination on **30-second** epochs. **This brief works in 5-minute epochs** — §2 says so
explicitly (*"Tested link by link, per 5-min epoch"*, 156 + 1720 = 1876 epochs across 24 nights), and the
ECGDex node exports it reads carry `timeseries.epochs[]` and `sleepStages[]` on a **5-min** grid.

A 5-min window is ten times likelier to contain a 13 s event than a 30 s one, so the granularity was not a
detail — it was most of the answer. Recomputed, counting **distinct epochs containing ≥1 flow event**:

| granularity | epochs | touched | share |
|---|---|---|---|
| 30 s | 22336 | 853 | **3.82 %** |
| **5 min — the brief's own unit** | **2221** | **402** | **18.1 %** |

(Per night, the 5-min share runs 5.8 % – **40.8 %**, median 16.9 %.)

**18.1 % against §9.6's ~50 % is a factor of 2.8, not an order of magnitude.** The withdrawn sentence
overstated the result, and it did so because I picked an epoch length without checking the one the brief
uses — an assumption that happened to flatter the conclusion.

### The Deep-epoch join, which is the number §9.6 actually asks for

§11 flagged the open risk: the bound was over *all* epochs, and if events concentrated into Deep sleep the
Deep share could approach 50 %. **Measured — they do not concentrate.** 29 nights joined
(`ECGDex_<date>.node-export.json` `sleepStages` × `_EVE.edf` absolute event times), swept over ±45 min of
clock offset so the ResMed skew risk is bounded rather than assumed away:

| clock shift (min) | Deep epochs | Deep with an event | **Deep %** | non-Deep % |
|---|---|---|---|---|
| −45 | 345 | 38 | 11.0 | 13.3 |
| −30 | 345 | 46 | 13.3 | 13.5 |
| −15 | 345 | 64 | 18.6 | 12.9 |
| **0** | 345 | 58 | **16.8** | 13.8 |
| +15 | 345 | 61 | 17.7 | 14.1 |
| +30 | 345 | 65 | 18.8 | 15.1 |
| +45 | 345 | 90 | **26.1** | 14.7 |

**Three readings:**

1. **Deep is NOT enriched for flow events** — 16.8 % against 13.8 % non-Deep at nominal alignment, and
   non-Deep stays flat at 12.9–15.1 % across every shift. The concentration scenario §11 raised as the
   reason it could not close the hatch is **empirically absent**.
2. **The worst case over ANY tested misalignment is 26.1 %.** Quoting that rather than the nominal 16.8 %
   makes the conclusion robust to the 42-minute ResMed skew that motivated the sweep — no per-night
   alignment proof is needed for the bound to hold.
3. **So §9.6's hatch requires roughly twice the contamination that a desat-independent instrument can
   find, under the least favourable alignment.** Narrowed substantially; **not closed**. A factor of 2 is
   not a factor of 10, and the honest verdict is that the label-noise explanation is *unlikely* rather
   than *excluded*.

⚠️ Every limit from §11 still applies unchanged: a **treated** patient (residual events are the therapy
working, never an apnea prevalence), and a bound conditional on the **ResMed's own sensitivity**.

⚠️ The shift sweep is a sensitivity analysis, **not** a clock calibration — it does not identify the true
offset. Deep % varies 11.0 → 26.1 across it, which is larger than binomial noise on 345 epochs (SE ≈ 2 pp),
so alignment does carry real signal. Establishing the true per-night offset would tighten the number; it
cannot loosen it past 26.1 %.

### 11b · ⚠️ The GLOBAL sweep cannot represent this corpus — the CPAP clock STEPS by an hour mid-corpus (2026-08-20)

The sweep applies **one shift to all 29 nights**, and §11a's reading 2 rests on that family being wide
enough (*"the worst case over ANY tested misalignment"*). **It is not, and the true configuration is not
in it.** The ResMed offset on these nights is **bimodal**, from two independent sources:

| cohort | offset | source | trio nights |
|---|---|---|---|
| before ~2026-07-30 | **≈ −39.5 min** | `integrator-dsp.js:3743` — *"the independently-established 39.5 min offset"*, holding **37.5–40.0 min across every partner** | **39** |
| 2026-08-01 onward | **≈ +21.2 min** (+1270 s) | measured 2026-08-20 over 23 box nights, `MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS` §"one-hour CPAP clock step" (#1581) | **16** |

The gap is **≈ 60.7 min — one hour**, and it lands *inside* this brief's corpus (`uploads/trio` spans
2026-06-10 → 08-14). Consequences for the table above:

- **No row is the aligned case.** At shift 0 the 39 pre-step nights are ~39.5 min out and the 16
  post-step nights ~21.2 min out — simultaneously, in opposite directions.
- **Aligning either cohort throws the other outside the swept range.** At −39.5 min the post-step nights
  sit **~61 min** from truth, beyond ±45; at +21.2 the pre-step nights sit ~61 min the other way.
- So *"it cannot loosen it past 26.1 %"* is **not established**. A per-night mixture is not a global
  shift and lies outside the tested family entirely, so the sweep's maximum does not bound it.

🔴 **This does NOT overturn §11a's conclusion, and the reason matters.** Reading 1 — Deep is not enriched
— rests on the **non-Deep** line staying flat at 12.9–15.1 % across every shift, i.e. on the comparison
being insensitive to alignment, which the step does not disturb. The verdict *"label-noise is unlikely
rather than excluded"* stands. What falls is the specific claim that 26.1 % is an upper bound.

**Cheap to settle, and the inputs now exist.** Per-night offsets are measurable from the same files by
the method #1581 used (cross-correlate band-passed H10 ACC against `_BRP.edf` flow), and the 42-minute
skew `cpap-clock-42min-offset` records for 2026-07-26 is the pre-step cohort's value, not an anomaly.
Redo the join with a **per-night** offset rather than a swept global one and the number stops being a
range. ⚠️ Split the corpus at the step; a single linear drift fit through it renders the jump as
scatter and refuses every night (measured — 168 s/day, residual SD 544 s, 0 of 23 drift-consistent).

### 11c · The per-cohort join, RUN — Deep contamination is **8.6 – 14.5 %**, and the 26.1 % bound is superseded (2026-08-20)

`tools/deep-flow-join.mjs` (new) does §11b's owed join: `ECGDex sleepStages` (5-min) × `*_EVE.edf`,
with a **per-cohort** offset instead of one global shift. 53 nights carry both (38 pre / 15 post).

**Sign convention is measured, not assumed** — applying an offset backwards is the easiest way to get a
confident wrong number here, so the tool runs BOTH directions and reports both. The correct direction is
the one under which the cohorts **converge**; a misapplied sign adds ~2x the offset to one cohort:

| applied sign | pre Deep % | post Deep % | cohort gap |
|---|---|---|---|
| **+** (pre −39.5, post +21.2) | **11.0** | **8.6** | **2.4 pp** |
| − (pre +39.5, post −21.2) | 33.6 | 25.5 | 8.1 pp |

Sign **+** wins by 2.4 pp against 8.1, and is corroborated independently: under it Deep (11.0 / 8.6 %)
sits near non-Deep (12.8 / 13.6 %), whereas sign − manufactures a Deep *enrichment* to 33.6 % against
12.2 % non-Deep — the signature of misalignment smearing events into the wrong epochs.

**`--sweep` bounds it over the plausible offset space** (pre −45…−34 × post +16…+26, both estimates):

```
    Deep % BOUND across the whole space: 8.6 – 14.5 %
    cells where Deep EXCEEDS non-Deep:  11 of 30
```

🔴 **Quote the BOUND, not the ordering.** *"Deep contamination ≤ 14.5 % across every plausible
per-cohort offset"* is robust. *"Deep sits below non-Deep"* is **not** — it holds at the central
estimates and flips in 11 of 30 cells, at both edges. This section first claimed depletion; the sweep
withdrew it, which is the whole reason the sweep exists.

**What this changes.** §11a's 26.1 % was the max over a family of *global* shifts that §11b showed
cannot contain the truth. Under per-cohort alignment the entire plausible space stays **under 15 %** —
so §9.6's ~50 % hatch is a factor of **3.5 – 6** away, not 2. **The label-noise explanation is
correspondingly less likely; it is still not excluded**, and every §11 limit stands unchanged: a
**treated** patient (never quote as an apnea prevalence) and a bound conditional on the ResMed's own
sensitivity.

⚠️ **Not a like-for-like replacement for §11a's numbers.** 53 nights here against its 29 (it also
required BRP; this needs only `_EVE.edf` + the ECGDex export), so the denominators differ. The
Deep-vs-non-Deep comparison is internally consistent within each run; the absolute shares are not
directly comparable across them.

### 11d · The offsets are now MEASURED, not assumed — bound tightens to 8.2–13.5 %, and a canonical model exists (2026-08-22)

§11c swept an **assumed** ±5 min around each cohort's offset. Two things landed since that replace the
assumption with measurement.

**An independent method agrees with #1581's post-step figure.** `CPAP-CLOCK-LONGITUDINAL-SEGMENT`
(#1621) reports the per-fusion pooled offset as **−21.9 ± 0.6 min over 19/24 nights**, measured by
`fitClockOffsetPooled` against a co-recorded reference. #1581 measured **+21.2 min** by
cross-correlating band-passed H10 ACC against `_BRP.edf` flow. Opposite sign conventions, **0.7 min
apart — inside about one of its error bars**, from two methods sharing no machinery. That is the
cross-validation §11b asked for and could not supply.

**Re-swept over measured/documented ranges only** (post: −21.9 ± 0.6 plus #1581's 21.2; pre: the
37.5–40.0 min band `integrator-dsp.js:3743` documents):

| cohort | offset range | Deep % | non-Deep % |
|---|---|---|---|
| pre-step (38 nights) | 37.5 – 40.0 min | **11.0 – 13.5** | 12.7 – 13.3 |
| post-step (15 nights) | 20.6 – 22.5 min | **8.2 – 9.1** | 13.1 – 13.6 |

**Bound: 8.2 – 13.5 %**, against §11c's 8.6 – 14.5 %. The upper end fell because §11c's worst cell was
`post = 16 min`, which the measurement now excludes at roughly **ten error bars** — it was never a
plausible offset, only an untested one.

🔴 **The ordering still cannot be claimed, and this reaffirms §11c's withdrawal rather than reversing
it.** Post-step Deep (8.2–9.1) sits clearly below non-Deep (13.1–13.6); pre-step Deep (11.0–13.5)
**overlaps** non-Deep (12.7–13.3) across its whole range. One cohort showing depletion is not the
corpus showing it. Quote the bound.

⚠️ **`tools/deep-flow-join.mjs` now holds the repo's SECOND clock-offset model, and it is the ad-hoc
one.** #1621 shipped `fitClockOffsetSegments` (`integrator-dsp.js:4834`, exported, pure, gated) — it
fits drift *within* step-bounded segments and returns per-night `source: measured | interpolated |
refused`, refusing across steps rather than smearing. That is strictly better than this tool's two
hardcoded cohort constants, which cannot express drift within a cohort and cannot refuse. **Wiring the
tool to consume it is the next step here**, and it needs per-night measured anchors as input rather
than the cohort approximation — after which the range above collapses to a single number per night.
Until then, two models coexist and this one is the approximation.

### 11e · The per-night collapse is NOT reachable on this corpus — and the canonical model is why (2026-08-22)

§11d called wiring `deep-flow-join.mjs` to `fitClockOffsetSegments` "the next step here". It was
attempted. **It does not collapse the range, and the reason is the canonical model behaving correctly.**

**The anchors exist and were measured.** `resp-acc-headless` over the 23 staged H10 ACC nights reports
a per-night ACC↔`_BRP.edf` lock — the same quantity #1581 used — giving **20 distinct anchor nights
spanning 2026-07-26 → 08-19**. Fed to `fitClockOffsetSegments` (all marked confident) it returns
**10 segments, 23/23 `measured`**: with a direct measurement per night there is nothing to fill, which
is the honest answer and also why the segment model adds nothing *here*. Gated at `r ≥ 0.30` instead
(15 anchors) it returns 5 segments and **refuses 5, interpolates 2** — the refusals all
*"outside all fitted segments (extrapolation refused)"*.

**But the join corpus barely overlaps the anchors:**

| | nights |
|---|---|
| `uploads/trio` join set (2026-06-10 → 08-14) | **55** |
| …inside the anchor span at all | 20 |
| …**with their own measured anchor** | **15** |
| …**predating every anchor** (June → mid-July) | **35** |

So a per-night wiring covers **15 of 53** scored nights and the canonical model **refuses the other
35** rather than extrapolating backwards — which is exactly what `CLK_SEG` was built to do and what
`#1606` said a single smeared offset must never do.

🔴 **This inverts §11d's framing, and the inversion is the finding.** §11d called the tool's two
cohort constants "the approximation" and the segment model "strictly better". On this corpus that is
wrong: **the constants are not a coarser version of the canonical model — they do something it
declines to do.** The pre-step cohort's 37.5–40.0 min comes from `integrator-dsp.js:3743` as a
*corpus-level* fact established across partners, not a per-night measurement, and it is the only thing
that covers the unanchored 35. Swapping wholesale would not tighten the bound; it would **drop two
thirds of the corpus**.

**What is actually owed, restated:** not "wire the tool to the model", but *label which nights are
anchored*. A per-night offset where one was measured, the cohort constant elsewhere **marked as
extrapolation the canonical model would refuse**, and the Deep % reported separately for the two
populations. That is a smaller change than §11d implied and it is the honest one — the 15 anchored
nights can carry a measured number, and the 35 cannot, and a single figure over both hides which is
which.

⚠️ **Two of the 20 anchors are visibly wrong and survive `all-confident`:** `2026-08-03` at **+2490 s**
and `2026-08-04` at **−430 s**, against neighbours clustered at ~+1270 s. Both carry the lowest
correlations in the set (`r` 0.19 / 0.15). Marking every night confident makes the segmenter treat
them as genuine **steps** — that is where 10 segments comes from, against 5 under `r ≥ 0.30`. A
per-night wiring must gate its anchors on `r`, and that threshold is a judgement this brief has not
made.

### 11f · The extrapolation is now BOUNDED, not assumed — 1.0 pp against per-night measurement (2026-08-22)

§11e restated the owed work as *"label which nights are anchored … and report Deep % separately for
the two populations"*. Done: `deep-flow-join.mjs --anchors <file>` takes the per-night measured locks
and splits the report by **offset provenance** — `anchored` (a measurement) vs `extrapolated` (the
cohort constant `fitClockOffsetSegments` would refuse).

**The question §11e could not answer: what does the extrapolation COST?** Answered by running both
offset sources over the **same 15 anchored nights**:

| offset source (identical nights) | Deep % | non-Deep % |
|---|---|---|
| cohort constants (3 pre + 12 post, pooled 21/198) | **10.6** | 13.7 |
| per-night measured anchors | **9.6** | 13.9 |

**1.0 pp apart.** So the cohort constant is not merely defensible — its disagreement with per-night
measurement is *measured*, on the nights where both exist, and it is small. That bounds the error the
38 unanchored nights inherit, which §11e had to leave open. It does **not** license extrapolating
further: the bound is observed on post-step-dominated nights and says nothing about a cohort with a
different clock regime.

⚠️ **The set overlap is NOT what it looks like, and assuming it would have produced a wrong number.**
`anchored` (15) and `post-step` (16) are *different sets*: three anchored nights (07-26/27/29) are
**pre-step**, and four post-step nights (07-30, 07-31, 08-02, 08-08) have **no anchor**. Comparing the
whole-corpus `post` figure against the whole-corpus `anchored` figure therefore compares different
nights — it gave a plausible-looking 1.4 pp that meant nothing. The 1.0 pp above is from a corpus
restricted to the 15 anchored nights so both arms score identically the same data.

⚠️ **A sign error was caught by the provenance split itself, which is the second argument for
reporting the populations apart.** The first draft negated the anchor when converting seconds to
minutes. Post-step anchors read ~+1270 s and `POST` is +21.2 min (= +1272 s) — the same sense — so the
negation put the anchored population at Deep **23.2 %** against the cohort constant's 8.2 % on nearly
the same nights. A pooled figure would have absorbed that; two populations side by side made it
immediate.