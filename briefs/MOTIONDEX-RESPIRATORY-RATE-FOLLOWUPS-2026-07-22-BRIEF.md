<!--
  MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-08-01 (**§2, §3 and §4 are now GATED — see §2a.** All three fixes existed

> **TRIAGE 2026-09-01 — every section resolved; nothing is open to code.** §2·§3·§4 gated and
> mutation-verified (§2a). §5 is a recorded CAVEAT, not a build item (the confidence gate is not an
> apnea filter — a pause shorter than the 60 s window does not trigger abstention). §6 is closed as
> *probably never* — gravity-roll IQR 13.1–17.9° across 26 nights is one posture, so the corpus
> cannot supply the contrast. §7 needs a SECOND SUBJECT, i.e. data. §8 is **REFUTED** by measurement
> (2026-08-04) — 'there is nothing left to notch'. §1 is the parent's data-blocked corpus run.
> ⚠️ The shared `nativeHz(rows)` SPINE helper remains deliberately unbuilt (§2a): it would re-stamp
> all 8 `manifestHash` values for one caller, and its proposed lint was measured to have **no
> subjects** — the only count-over-duration hits are genuine EVENT rates. The local `nativeHz` in
> `ppgdex-dsp.js` / `resp-acc-analysis*.js` is not that helper and does not discharge it.
in `resp-acc-analysis.js`; none had a test, and the module was loaded by NEITHER runner, so each fix
rested on the comment above it. It is wired into both lanes and the three failure modes are pinned by
known answers that reproduce the brief's own published figures (1.19 % rate error · −36.7 dB at 0.8 Hz),
each mutation-verified by reintroducing the original bug. **§5's window sweep is UNBLOCKED
2026-08-20** — the "served constant never reaches the estimator" defect is resolved: the tool is a
*built* artifact that inlines the DSP, so the sweep must rebuild rather than re-serve. **§5's sweep
is then RUN the same day: MAE has a plateau minimum at 45–60 s and the shipped 60 s sits in it, so
the window is already right — measured over 3 box nights, and REPLICATED on the 2 disjoint pre-step
nights, whose clock drifts the opposite way. The remaining ceiling — the 5 s drift-consistency gate —
was then MEASURED and is LOAD-BEARING: loosening it buys 5.7x the epochs but costs MAE 0.84 -> ~1.0,
so n here is a precision trade, not a cap that can be lifted.** **NOT done:** §2's proposed shared `nativeHz`
spine helper — deliberately deferred, see §2a. §1 and §6–§9 are untouched.) · **Created:** 2026-07-22

# Respiratory-rate follow-ups — what executing the estimator brief surfaced

> Follow-up to `MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` per the house pattern. That brief's
> Part (A) landed (estimator, tier, tests, adversarial twin, analysis tool); Part (B) — the papers —
> is blocked on one item, §1 below. Everything here was **discovered while executing**, not planned.

---

## 1 · ⛔ Re-run the 26-night corpus end-to-end through `resp-acc-analysis.html`

The single item blocking all three preprints. The tool exists and reproduces the original harness on
four spot-checked nights (clock offsets within **8 s**, per-night MAE within **0.06 br/min**), but the
papers' headline figures still trace to a Python harness that lives **outside the repo**, in a session
scratchpad. That is precisely the "prose is not evidence" failure `FIXTURE-VERIFICATION-GATE` exists
to abolish.

**Done when:** the tool is run over the full corpus in a browser; the numbers in all three papers are
replaced by its output (or confirmed identical); figures land in `papers/figures/`; the DRAFT banners
are cleared **only then**.

> ### ▶ RUN 2026-08-06 — the first leg is done; the paper-editorial leg is not
>
> **Recorded in full as `MOTIONDEX-RESPIRATORY-RATE-2026-07-21-BRIEF.md` §11.** Headline, stated the
> only honest way: **MAE 0.95 br/min (95 % CI 0.79–1.18) against a 0.72 reference self-noise floor and
> a 1.42 null baseline — 7 of 16 nights, 3,665 epochs.**
>
> **This item's own framing was wrong, and that is the useful part.** It reads as though the tool were
> ready and only a run were missing. Four things had to be fixed first, three of which were invisible
> until real bytes went through:
>
> 1. **The tool could not see the corpus at all.** All **419** paired `Polar_H10_*_ACC.txt` on the
>    capture machine are capture-host layout; the grouper matched only the phone layout, so 2.4 GB of
>    paired data reported "no night pairs found" with no reason given.
> 2. **The page had no figure layer** — no `<canvas>`, no export path — so "figures land in
>    `papers/figures/`" asked for a capability that had never been built.
> 3. **Nine of sixteen nights were being SCORED against noise.** `recoverOffset` returned offsets from
>    −5163 s to +4804 s at peak |r| 0.16–0.20, and `offsetUsed` used the argmax anyway. Excluding them
>    moved the result **1.05 → 0.95**: the contamination was hiding the answer.
> 4. **The Bland–Altman clamped out-of-range points onto the axis**, drawing a cluster the data does
>    not contain.
>
> **Still open here, and it is genuinely this item's remainder:** the numbers in the three papers are
> NOT yet replaced, no PNG is committed to `papers/figures/`, and the DRAFT banners stay up. That is
> paper-editorial work — choosing which figure each preprint carries and rewriting its results
> section — not tool work, and it should not be done by the session that built the tool.
>
> ### ▶ CHECKED 2026-08-17 — the two surfaces already DISAGREE, before any re-run
>
> The editorial leg above is described as "replace the numbers". It is not: **the paper and its own
> index abstract already carry different numbers for the same study**, so there is no single set to
> replace and no way to tell which surface a reader has seen. Measured by parsing both files:
>
> | | `papers/acc-respiratory-rate.html` | `papers/papers.html` |
> |---|---|---|
> | epochs | **18,856** | **19,193** |
> | 95 % CI on MAE 1.01 | **0.92–1.10** | **0.91–1.12** |
> | within 2 br/min | **91.7 %** | **91.6 %** |
> | confidence-gated at 70 % coverage | **MAE 0.61** | **MAE 0.56**, 97.8 % within 2 |
>
> Both say 26 nights and both say MAE 1.01, which is why this survived review — **the headline agrees
> and every denominator around it does not.** A 337-epoch difference means the two were computed over
> different scored sets, so at most one of them describes the analysis actually run.
>
> **Not fixed here, deliberately.** Choosing which is right requires re-running the corpus, which is
> exactly the leg this item reserves for a session that did not build the tool. Guessing — or copying
> the paper's figures over the index's because the paper "looks more authoritative" — would convert an
> open question into a false claim, and both surfaces still carry DRAFT banners, so nothing is being
> presented as final meanwhile.
>
> **Whoever takes the editorial leg should treat this table as the first item**, not the last: a re-run
> that replaces one surface and not the other leaves the corpus in exactly this state. Note also that
> `papers/` has a **served twin** under `docs/papers/`, so any edit here stales `build-docs.mjs` the way
> a bundle does.
>
> **Also worth knowing before that is attempted:** this run used 21 ACC files >30 MB across 14 nights
> because one browser pass will not hold more. **419 pair in total.** The corpus is far larger than the
> "26 nights" this item names.

## 2 · Sample-rate precision is this codebase's recurring failure mode — consider a shared helper

It bit **three times in one work-unit**, in three different places, each time silently:

1. `motiondex-dsp.js sampleHz` divided sample count by duration (fixed earlier, DEEP-AUDIT-II §7.3).
2. The corpus turned out to be ~25.3–25.4 Hz on 49/50 nights and **202.9 Hz** on one, with Verity at
   ~25.8–25.9 Hz — so any assumed rate is wrong for some file.
3. `resp-acc-analysis.js nativeHz` derived the rate from the **millisecond-quantised phone stamp**:
   on a 25.34 Hz stream the median interval reads 39 ms → **25.64 Hz, a 1.2% error**, which
   accumulated ~18 s of skew over a 25-minute correlation chunk and moved recovered clock offsets by
   *tens of minutes* (−1592/−3379/+4852 s where truth is ≈−2360 s).

Each failure was silent — plausible-looking output, no error. **Proposal:** a single spine helper
(`nativeHz(rows)`) that prefers the vendor's monotonic device counter (`relNs`) over wall-clock
stamps and never derives a rate from count ÷ duration, reused by every `*-dsp.js` that resamples.
Consider a gate assertion that no DSP computes a rate as `n / durSec`.

## 2a · EXECUTED 2026-08-01 — §2·§3·§4 are gated; the spine helper deliberately is not

**The premise was worse than the brief stated.** §2 says the rate bug "bit three times in one work-unit,
each time silently". All three were fixed — and `resp-acc-analysis.js` was in **neither test lane**, so
`nativeHz`, `toGrid` and the channel constructors had **zero** coverage. Every one of those fixes was
being held up by the comment written above it. That is the same shape as the defect itself: plausible,
unexercised, silent.

The module is now loaded by `tests/run-tests.mjs` and `Dex-Test-Suite.html`, and the three modes are
pinned as known answers in the `resp-acc-analysis · rate · known-answer` group.

| § | the failure | what the gate pins | measured |
|---|---|---|---|
| §2.3 | rate from the ms-quantised phone stamp | `nativeHz` reads `relNs`; the tMs fallback is pinned as *measurably wrong* so deleting the sensor-counter branch cannot pass quietly | 25.3400 Hz vs **25.6410 Hz (+1.19 %)** |
| §2 | rate as count ÷ duration | a 20 % dropout does not move the rate | 25.3400 Hz unchanged |
| §3 | integer decimation, not resampling | the last peak keeps its **absolute time** through the resample | 297.00 s → 297.00 s |
| §4 | double band-pass (effective 16th order) | one `flowChannel` pass at 0.8 Hz, with the doubled order as a 28 dB tell | **−36.69 dB** (one) vs −64.66 dB (two); passband −0.07 dB |

Two of those numbers were published independently in this brief before the gate existed — §2's *"39 ms →
25.64 Hz, a 1.2 % error"* and §8's *"already attenuates −36.6 dB at 0.8 Hz"*. The gate reproduces both
against the shipped module, which is why they are pinned as known answers rather than tolerances.

### Mutation-verified by reintroducing each original bug

```
delete nativeHz's relNs branch    → ✕ relNs exactness · ✕ dropout invariance
toGrid decimates by round(fs/FSC) → ✕ absolute-time preservation (and §4, which calls toGrid)
flowChannel filters twice         → ✕ single-pass −36.7 dB (reads −64.66)
restore                           → green, resp-acc-analysis.js byte-clean
```

**One of these assertions was itself broken, and only mutation found it.** The §3 check first snapped the
output peak to the nearest crest of the known 4 s-period sine and tested the residual — it **passed under
the decimation mutation**, because decimation slides the peak onto a *different* crest and the snap hid
the whole error. It now compares the output peak's absolute time against the input's, measured
independently. Recorded because §2's thesis is precisely that this class of error is silent, and a test
that survives the bug it was written for is the silent version of a test.

### What is NOT built: the shared `nativeHz(rows)` spine helper

§2 proposes one, reused by every `*-dsp.js` that resamples. Deliberately not done here, for two reasons
worth stating rather than leaving as an omission:

- **A spine helper is inlined into every bundle**, so it re-stamps all 8 `manifestHash` values and
  serialises against every other in-flight work-unit (CLAUDE.md §👥.3). That cost needs a beneficiary,
  and today there is exactly one caller.
- **The proposed lint — "no DSP computes a rate as `n / durSec`" — was measured and has no subjects.**
  Scanning every `*-dsp.js` for count-over-duration rate expressions returns only genuine *event* rates
  (`oxydex-dsp.js:3079` `totalMin / durationHr`; `oxydex-fusion.js:326` `surges.length / _unionSec`).
  A source scan cannot separate an event rate from a sample rate without an exclusion list — which is
  the grandfather-list antipattern `CPAP-REAL-CORPUS-FOLLOWUPS-II` §4 spent effort removing. Left open
  as a proposal, with the scan result recorded so the next reader does not re-derive it.

## 3 · Integer decimation is not resampling

`toGrid` decimated by a whole factor, leaving a 25.35 Hz stream at 5.07 Hz rather than 5 Hz — the same
class of bug as §2 and equally silent. Any future resampling helper should interpolate onto the exact
target grid. Worth a lint or a test if resampling spreads beyond this tool.

## 4 · A double-filtering footgun in the analysis layer

`recoverOffset` band-passed input that callers had already band-passed, producing an effective 16th
order. Fixed by making `respChannel` / `flowChannel` the only sanctioned constructors for either side
of the correlation. **The general lesson:** when a function both accepts a signal and conditions it,
the contract must say which. Worth checking whether other `*-analysis.js` helpers have the same shape.

## 5 · The confidence gate is not an apnea filter — and downstream consumers may assume it is

Pinned as a test assertion. A pause **shorter than the 60 s analysis window** does not trigger
abstention, because the remaining clean breathing still supports a strong spectral peak — measured,
30 s-pause epochs carried *higher* mean confidence (0.488) than clean ones (0.390). This is why the
corpus shows apnea-overlapping epochs at MAE 4.98 while the gate does not remove them. Any consumer
that needs apnea-free epochs must exclude them explicitly, from an event source, not from `conf`.

## 6 · The corpus cannot test posture, and probably never will

Gravity-roll IQR is **13.1–17.9°** across 26 nights — one posture. Doheny 2020's supine-vs-lateral
effect (1.54×, p<0.01) could not be replicated (measured **1.02×**) *by absence of exposure*. The
adversarial twin now gates posture robustness synthetically, which is the right substitute, but a
**second subject or a deliberately mobile night** is the only real fix. Until then no
posture-robustness claim may be made anywhere — code comment, paper, or registry `cite`.

## 7 · The bias constant needs re-derivation before a second subject

`RR_BIAS_BRPM_CORPUS = 0.58` is documented and **not applied by default** (a synthetic known-answer
test showed applying it makes a clean 15 br/min signal read 15.7). It is one person's offset against
`60/median(period)`. Re-derive per subject; never promote it to a default.

## 8 · Where the estimator still loses — the cheapest lever is REFUTED (measured 2026-08-04)

**There is nothing left to notch.** §8 proposed cardiac suppression as "the highest-value untried
improvement" and supplied its own caveat — *"measure before building"*. Measured, on 12 nights of H10
accelerometer against the f_HR of the ECG co-recorded on the same strap
(`tools/resp-cardiac-suppression-e8.mjs`):

| cardiac : respiratory-peak power | before the band-pass | after it |
|---|---|---|
| at f_HR | median **−14.6 dB** (IQR −15.7 to −12.7) | median **−52.7 dB** (IQR −56.8 to −50.0) |
| at 2f_HR | median −18.3 dB | median **−129.1 dB** |

The cardiac component is genuinely there in the raw accelerometer — −14.6 dB below the respiratory
peak, which is seismocardiography working as advertised. The shipped 0.13–0.5 Hz zero-phase band-pass
then removes a further **~38 dB** of it, because f_HR for this corpus sits at 0.8–0.9 Hz, comfortably
*above* the 0.5 Hz corner rather than inside the passband. The worst post-filter ratio on any of the 12
nights is **−41.3 dB** — cardiac power at 0.007 % of the peak it would have to compete with.

The estimator picks the **largest** peak in 0.13–0.5 Hz. A component 41 dB down cannot move that pick,
so an adaptive notch has nothing to recover and the MAE 4.98 on event-overlapping epochs is not caused
by cardiac contamination. **Do not build it.** The caveat was right and the lever is closed; whatever
drives the event-epoch error is elsewhere, and §8's remaining value is that it now says so with a
number instead of a plausible mechanism.

*(Method note: f_HR is taken from the ECG's own detector, never from a spectral peak in the
accelerometer — reading the heart rate off the signal being tested for cardiac contamination would be
circular. The ratio, not the absolute power, is the endpoint, because what corrupts a peak-pick is
another comparable peak.)*

## 8-original · Where the estimator still loses, and the cheapest lever

Epochs overlapping a scored event are ~6% of the night but carry MAE 4.98 vs 0.77 on clean epochs.
The research synthesis proposed **cardiac suppression using the H10's own ECG** — an adaptive notch
at the measured f_HR and 2f_HR, which is free given the ECG is co-recorded on the same strap. This is
the highest-value untried improvement, and unlike the CNN route it needs no training data. (Note the
shipped 4th-order zero-phase band-pass already attenuates −36.6 dB at 0.8 Hz, better than the
literature synthesis's own recommendation, so the gain may be small — measure before building.)

## 9 · Cross-device clock alignment should be a spine capability, not a tool-local trick

The offset-plus-drift recovery (cross-correlation lock → linear drift fit → validity by
**drift-consistency, not correlation magnitude**) is general: any two devices recording the same body
with independent clocks need it. It currently lives in `resp-acc-analysis.js`. The Integrator and
OverDex both align multi-device recordings and would benefit. Worth promoting once a second consumer
appears — not before.

> ### ▶ CHECKED 2026-08-17 — the trigger is NOT met, and `grep` says the opposite
>
> Asked because it looked met: `tools/beat-correspondence.mjs` (added 2026-08) recovers an alignment by
> cross-correlation, which reads like the second consumer this item waits for. It is not, and neither
> are the other two hits. **Four functions whose names all say "cross-correlation" do four different
> jobs:**
>
> | function | what it aligns | validity criterion |
> |---|---|---|
> | `resp-acc-analysis.recoverOffset` | two devices' **clocks** | drift-consistency ← *this item's subject* |
> | `integrator-longitudinal.crossCorrelations` | **metric vs metric across nights** | n/a — not an alignment |
> | `oxydex-dsp.computeSpO2HRLag` | SpO₂ vs HR **within one device** | physiological coupling, not clock |
> | `tools/beat-correspondence.nccAnchor` | **beat INDEX** lag between two beat trains | margin over second-best (a ratio test) |
>
> So `grep -l crossCorr` returns **four files and zero second consumers**. Promoting on that grep would
> have moved a spine capability for a user that does not exist, and `nccAnchor` is the near-miss: it
> genuinely is a cross-correlation lock, but it works in **beat-index space** (its ambiguity is *which
> beat*, resolvable only mod one RR interval) and validates by **margin**, not by drift-consistency.
> Merging the two would force one abstraction over two different failure modes.
>
> **§9 therefore stays parked, on its own terms — and the "not before" clause earns its keep.** The next
> session to have this idea should read this table rather than re-run the grep; the identifiers invite
> the wrong conclusion, which is `AUDIT-PROMPT.md` class 15 (a label unkeyed to its content) expressed
> in **function names** rather than in output.
>
> **What would actually meet the trigger:** a second consumer needing *clock* offset between two devices
> validated by *drift-consistency* — e.g. if the Integrator's CPAP↔wearable skew check (which today
> vetoes on a threshold) were rebuilt to recover the offset rather than reject it.
>
> **⚠️ The rule this generalises to is NOT "grep over-reports" — that is only half the failure space.**
> The table above is a grep finding **four hits and no real consumer**. The mirror-image defect landed
> the same day in `pat-gate.js`: `verdict()` carries a correct NO-SHARED-CLOCK refusal on
> `ax.independent === false`, and its only shipped caller passed **three** arguments — so the guard had
> **never fired in the runtime**. There a grep finds **one hit that is genuinely the right function**,
> and reports a healthy, well-exercised guard that does nothing.
>
> Over-reporting a capability that is not there, and under-reporting an absence, are the same defect
> pointed in opposite directions, and **only one check covers both: ask WHO CALLS IT AND WITH WHAT
> ARGUMENTS, never whether the name appears.** For a promotion decision that means counting *call
> sites whose arguments actually reach the branch you intend to promote* — which for §9 is still zero.
> Note the `pat-gate` case needed a **source scan** to verify, because its caller is a Web Worker no
> behavioural test can drive; a name-level grep would have passed it in either direction.

## 10 · The browser render-coverage gate — RUN, 5 failures found, and FIXED

`Dex-Test-Suite.html?full` has been run under Playwright (headless Chromium, repo served over HTTP so
the iframe rigs are same-origin). It found **5 failures the Node lane never surfaces**. Both causes
are now fixed and the gate reads **all green for the first time**.

| | before | after |
|---|---|---|
| pill | ✕ 5 failing | **✓ all green** |
| passed | 3,551 | **3,666** |
| groups | 252 | **255** |

`__rcState=done`, `sameOriginStatus().ok=true`, `bootSkips=[]` — all 11 rigs genuinely booted, so
this is a real green, not an inconclusive one.

**Cause 1 — a live `ReferenceError` in the shipped PulseDex app.** `pulsedex-app.js` destructures 47
names from `window.PulseDex._bare` but omitted **`triIdxNormApplies`**, which it calls at line 796.
The name is exported correctly (`pulsedex-dsp.js:1539`); only the binding was missing. This is not a
test artifact — it throws in the shipped app. Cost: a page error plus 2 failures in the PulseDex
render rig.

**Cause 2 — the browser runner was missing three `env` entries.** `fusePulseCrossCheck`,
`fuseHrvResource` and `fuseCvhrCorroboration` were wired into `tests/run-tests.mjs` and exported by
`integrator-dsp.js`, but never added to `Dex-Test-Suite.html`. Three OXYDEX-PULSE-RESOURCING groups
failed browser-only with *"export it from integrator-dsp.js + wire into both runners"* — the
assertion naming its own cause.

### ⚠ A correction to what this brief previously claimed

An earlier revision of this section reported `GATE A FAIL — BUILD-MANIFEST.json` and
`GATE B FAIL — FIXTURE-PROVENANCE.json` as real pre-existing failures caused by the P3 refactor
retiring those monoliths. **That was wrong.** Those strings are the expected *output* of a
**passing** self-test: `tests/dex-tests.js:6799` deliberately calls the banner with `MANIFEST: null`
and asserts it renders "GATE A FAIL". A DOM scrape picked up the fixture text and it was reported as
a defect. Nothing fetches the retired monoliths; `provenance-ledger.js` assembles the per-app
fragments correctly and all of them parse.

The lesson worth keeping: **scraping a test page for failure-shaped strings will find the strings
that tests deliberately produce.** Read the group pass/fail counts (`.gstat`), not the prose.

### The standing point still holds

Until this fix the canonical gate could never read all-green, so permanent reds trained reviewers to
ignore them and attributing new breakage required a baseline diff every time. Keep it green.

**Repro:** serve the repo over HTTP, open `Dex-Test-Suite.html?full`, wait for `__rcState==='done'`
(~53 s), then read `#summary` and `sameOriginStatus()`. A `file://` open will not do — the rigs need
same-origin.

---

## 5 · The window sweep — the one change that could actually move MAE (added 2026-08-09)

Routed from `MOTIONDEX-RESPIRATORY-RATE` §11.7, which solved the figure's banding and, in doing so,
turned up a sharper question than the banding itself.

**The observation.** `RR_WIN_SEC = 60` gives a Rayleigh resolution of `1/T` = **1.00 br/min**. The
measured MAE over the 7-night corpus is **0.95**. The estimator is performing essentially *at* the
spectral resolution of its own analysis window.

**Why that is suggestive rather than established.** Peak *location* is not bounded by the Rayleigh
limit — the Cramér–Rao bound at N = 300 is 0.022 br/min at 0 dB — so an MAE just under 1/T is not
required by anything, and could be coincidence. But if it is not, the window is the binding constraint
and every other avenue is wasted effort:

| candidate lever | measured worth |
|---|---|
| refine `RR_F_STEP` (0.24 br/min lattice) | 0.075 br/min RMS = **0.10 % of the error variance** |
| drop the 0.1 output rounding | included in the above |
| **lengthen `RR_WIN_SEC`** | **unknown — this is the experiment** |

**The experiment.** Sweep `RR_WIN_SEC` (e.g. 45 / 60 / 90 / 120 s) over the same 7 nights and plot MAE
against `1/T`. Two outcomes, both informative:

- **MAE tracks 1/T** ⇒ the estimator is window-limited, and resolution is bought by lengthening the
  window (at the cost below). This would also mean the current 0.95 is not an algorithm quality at all.
- **MAE flattens** ⇒ the error is dominated by physiology, motion or the reference, the window is
  already right, and **no amount of spectral work will improve it** — which is worth knowing before
  anyone tries.

**⚠ DO NOT SIMPLY DOUBLE THE CONSTANT.** A longer window trades directly against non-stationarity:
breathing rate genuinely changes within two minutes, so a 120 s window averages across real variation,
and the CPAP reference is epoched at **30 s** — a window several times the reference epoch is measuring
something the reference is not. Expect MAE to turn back up past some length; finding that turning point
IS the result, and it is more useful than any single window choice.

> ### ⛔ ATTEMPTED 2026-08-20 — and the run is VOID. Read this before running it again.
>
> → **RESOLVED 2026-08-20 — skip to “MECHANISM RESOLVED” below for the cause and the working
> recipe.** The two blocks that follow are kept verbatim because the reasoning in them is sound and the
> conclusion is still wrong; that gap is the point.
>
> The sweep was run end to end through `resp-acc-analysis.html` (the shipped orchestration, only
> `RR_WIN_SEC` patched in the served `motiondex-dsp.js`, verified byte-for-byte over HTTP each time)
> across **45 / 60 / 90 / 120 / 180 s**, then once more at **20 s**. Every configuration returned:
>
> ```
> MAE 0.94 · 95% CI 0.63–1.19 · bias −0.42 · RMSE 2.75 · LoA ±5.32 · ≤2 brpm 93.3% · r 0.359
> ```
>
> **Byte-identical, to every digit, across a 9× range of window length — including Pearson r.** That is
> not the "MAE flattens" outcome. A flattened curve still jitters; an estimator whose analysis window
> changes 20 s → 180 s cannot reproduce `r` to three decimals. **The manipulation did not reach the
> measured quantity**, and the result therefore supports neither branch.
>
> ⚠️ **This is the failure worth recording, because the near-miss was expensive.** Had the numbers moved
> even slightly, the honest-looking conclusion — *"MAE flattens ⇒ the window is already right and no
> spectral work will improve it"* — would have been written up, and it would have closed off the one
> avenue this section identifies. **An invariant result is only evidence when you have shown the input
> actually varied.**
>
> **What was excluded**, so the next attempt does not re-tread it:
> · the served file really changed (`curl` on the running server showed `RR_WIN_SEC = 20`);
> · a fresh Chromium profile per run, so no browser cache carried across;
> · **the app caches nothing** — no `localStorage`, no `indexedDB`, no cache key anywhere in
>   `resp-acc-analysis-app.js`;
> · the estimator is called with **no `opts`** (`M.respiratoryRate(rows, t0, 'mg')`, line 253), so the
>   module constant is the only window control there is.
>
> **So the open question is now sharper than the sweep itself:** with no caching and no override, why do
> the agreement statistics not move under `RR_WIN_SEC ∈ [20, 180]`? Until that is answered, the tool's
> MAE **cannot be used to score any estimator change** — which is a larger claim than this section set
> out to test, and it is the thing to settle first.
>
> ### 🔴 THE CONTROL WAS BUILT, AND IT FAILS — the served constant never reaches the running estimator
>
> Re-run 2026-08-20 with the control the paragraph below asks for. **The sweep is not merely
> unvalidated; the manipulation provably does not arrive.**
>
> **Positive control first — the harness IS alive.** Re-staging the corpus with the recipe §1 records
> (`ACC > 30 MB`, the set one browser pass can hold) changed every statistic: **MAE 0.94 → 0.97,
> r 0.359 → 0.326, bias −0.42 → −0.45**, 3 nights → 2. So the apparatus responds to its input. It just
> does not respond to `RR_WIN_SEC`.
>
> **Then a BINARY control, which removes all judgement.** `respiratoryRate` opens with
> `if (N < nWin) return { hasData: false }`. At `RR_FS = 5 Hz`, a 12-minute synthetic gives `N = 3600`;
> a **900 s** window is `nWin = 4500 > N`, so the function MUST refuse. Driven in-page, on the same
> load, reading the constant back through the page's own origin:
>
> | served `RR_WIN_SEC` | expected | observed |
> |---|---|---|
> | 60 | 23 windows | 23 windows, first 14.9 brpm |
> | 120 | **21** windows | **23** windows, first 14.9 brpm |
> | **900** | **`hasData: false`** | **23 windows, first 14.9 brpm** |
>
> `fetch('/motiondex-dsp.js')` **inside that same page** returned text containing `RR_WIN_SEC = 900`.
> The refusal did not fire. **The executing `MOTIONDSP.respiratoryRate` is not parameterised by the
> source the page is serving.**
>
> **Excluded, each by test rather than by argument:**
> · corpus staging — two independent sets, and the numbers moved between them (positive control above);
> · browser profile cache — a fresh Chromium profile per launch;
> · HTTP / script-tag cache — `src="motiondex-dsp.js?bust=900"`, and the 900 s test repeated under it,
>   unchanged;
> · a second definition — `global.MOTIONDSP` is assigned **once**, unconditionally
>   (`motiondex-dsp.js:1393`), and `respiratoryRate` has **one** definition (`:877`), exported directly
>   (`:1401`); `integrator-dsp.js` does not define it;
> · the wrong field being read — `pair()` scores `n.est.series[i].brpm`, and `est` is exactly
>   `M.respiratoryRate(rows, t0, 'mg')` (`resp-acc-analysis-app.js:253`), called with **no `opts`**.
>
> **Mechanism: UNRESOLVED, and deliberately not guessed at.** The constant demonstrably feeds
> `nWin` → the Hann window → the STFT frame loop → `series` → `pred` → the agreement table. Every step
> is readable and every alternative above is closed. Something between "the file the origin serves" and
> "the function that runs" is not what it appears to be, and naming it needs someone who knows this page
> better than a source read can convey.
>
> **The operative consequence stands either way:** §5's sweep **cannot be run through this tool as it
> is**, and — the larger claim — **the tool's MAE cannot be used to score any change to the estimator's
> spectral parameters**, because a 15× change in the analysis window moves it by nothing. Anything
> already scored that way should be re-checked against a control of this kind.
>
> **The control the experiment needs, and lacked:** a leg that proves the window reached the output at
> all — e.g. assert `est.rateSeries` differs between two windows on ONE night before any MAE is read.
> Without it the "flattens" branch is unfalsifiable, because "no change" is also what a broken harness
> prints. (A Node-side probe was attempted as that control and did not produce one: the synthetic rows
> it fed `respiratoryRate` yielded 0 epochs, so it measured nothing either — recorded so the next
> attempt starts from a REAL night, not a hand-built array.)

> ### ✅ MECHANISM RESOLVED 2026-08-20 — `resp-acc-analysis.html` is a BUILT tool and INLINES the DSP
>
> The section above says the mechanism "needs someone who knows this page better than a source read can
> convey." It does not. **The page never loads `motiondex-dsp.js` at all.**
>
> `resp-acc-analysis.html` is one of the ten **generated** analysis tools (`tools/build-analysis.mjs`
> `TOOLS`, line 62). All six of its scripts are `data-inline-src` blocks with the source text **embedded
> at build time** — there is **no** `<script src="motiondex-dsp.js">` tag anywhere in the file:
>
> ```
> clock.js                  41015 chars   RR_WIN_SEC refs 0
> kernel-constants.js        2237          0
> integrator-dsp.js        352630          0
> motiondex-dsp.js          68103          2   ← defines RR_WIN_SEC = 60, frozen at build time
> resp-acc-analysis.js      38626          0
> resp-acc-analysis-app.js  49248          0
> ```
>
> **Every observation follows, and each of the five exclusions is answered rather than contradicted:**
>
> | observation | why |
> |---|---|
> | `fetch('/motiondex-dsp.js')` returned `RR_WIN_SEC = 900` | true, and irrelevant — the static server serves a real file the page does not read |
> | identical stats over 20–180 s | the executing constant was `60` on every run |
> | 900 s did not trip `if (N < nWin) return {hasData:false}` | `nWin` was built from `60`, never from `900` |
> | `src="motiondex-dsp.js?bust=900"` changed nothing | there is no script tag to bust |
> | one unconditional `global.MOTIONDSP`, one `respiratoryRate` (`:1393`, `:877`) | correct **about the file on disk**, which is not the executing code |
> | corpus re-staging DID move MAE 0.94 → 0.97 | the corpus is genuine runtime input; `RR_WIN_SEC` never was |
>
> **It could not have worked even in principle.** `motiondex-dsp.js` on disk is an **ES module** — it
> ends `export const MOTIONDSP = window.MOTIONDSP;`. The builder strips those two `export` keywords when
> inlining (the only diff between the file and the inlined block, 1434 → 1436 lines). A classic
> `<script src>` tag cannot load the disk file as-is, so hand-adding the tag the harness assumed was
> there would have failed too.
>
> **The repo's own gate says this, in one line, for free.** With the source patched and the tool not
> rebuilt, `node tools/build-analysis.mjs --check` — which `npm run check` runs as `verify:analysis` —
> exits 1 with `STALE (1): resp-acc-analysis.html` and prints `run: node tools/build-analysis.mjs`.
> **The drift guard was available throughout and was not run.** CLAUDE.md §🔏 already names the three
> generated trees and warns that `--check` alone is not the drift guard; the sweep hit the mirror-image
> error — it patched a **source** and served a **built artifact**, and never asked the builder.
>
> **The correct sweep recipe (verified, not proposed):**
>
> ```sh
> sed -i 's/RR_WIN_SEC = 60/RR_WIN_SEC = <W>/' motiondex-dsp.js
> node tools/build-analysis.mjs        # → "bundled 1 of 10 tool(s): resp-acc-analysis.html"
> # serve and run the REBUILT resp-acc-analysis.html
> ```
>
> Demonstrated in a throwaway worktree at `W = 900`: the inlined constant moved `60 → 900` and exactly
> one line of the built file changed. Revert the DSP before anything ships — the tunable must not
> survive the sweep, as this section already requires.
>
> **The general shape, since this is the third instance.** The exclusion list is careful, complete, and
> reasons entirely about *the file where the property is stored* rather than *the artifact that runs* —
> the locality artefact. §5's sweep is re-runnable as soon as the recipe above is used; the broader claim
> ("the tool's MAE cannot score any estimator change") is **WITHDRAWN** — it was an artifact of the
> harness, not a property of the tool, and anything scored through this tool by varying a **corpus** or a
> **runtime argument** was never affected. Only manipulations of module constants were inert.

> ### ✅ THE SWEEP IS RUN — 2026-08-20. There IS a turning point, and the shipped 60 s sits in it.
>
> Run with the rebuild recipe above (patch `motiondex-dsp.js` → `node tools/build-analysis.mjs` →
> serve the REBUILT page), one rebuild per window, in a throwaway worktree. **The control ran first
> every time:** the inlined constant in the built HTML was read back and asserted equal to the source
> value before any statistic was read. All six passed.
>
> | `RR_WIN_SEC` | epochs | MAE | 95 % CI | bias | RMSE | LoA | ≤2 brpm | r |
> |---|---|---|---|---|---|---|---|---|
> | 20 | 2094 | 0.95 | 0.91–1.01 | −0.05 | 1.49 | ±2.92 | 91.1 % | 0.649 |
> | 45 | 2238 | **0.84** | 0.79–0.90 | −0.19 | **1.37** | **±2.65** | **93.7 %** | **0.712** |
> | **60 — shipped** | 2260 | **0.84** | 0.80–0.87 | −0.19 | 1.45 | ±2.82 | 93.6 % | 0.692 |
> | 90 | 2279 | 0.91 | 0.85–0.97 | −0.18 | 1.54 | ±3.00 | 92.1 % | 0.648 |
> | 120 | 2288 | 0.98 | 0.91–1.03 | −0.19 | 1.61 | ±3.14 | 90.7 % | 0.613 |
> | 180 | 2293 | 1.05 | 0.97–1.13 | −0.18 | 1.66 | ±3.23 | 88.6 % | 0.587 |
>
> **The manipulation demonstrably arrives this time, and there are TWO controls saying so.** Every
> estimator statistic moves monotonically away from the minimum — MAE, RMSE, LoA, ≤2 brpm and r all
> agree on the same ordering. And the **null baseline is invariant at exactly `1.36 / n = 2297` in all
> six runs**, as it must be: it is the corpus median, not an estimator output. A pipeline that moves
> the estimator while holding the corpus-derived null fixed is sensitive in precisely the right place.
> Contrast the VOID run, where *everything* was identical to three decimals.
>
> **The answer: the window is already right, and this time that is a measurement rather than an
> artifact.** The minimum is a plateau at **45–60 s**; leaving it costs +0.11 br/min at 20 s and
> +0.21 at 180 s. §5 proposed the window as "the one change that could actually move MAE" — it moves
> MAE, but only *upward* from where the estimator already sits.
>
> **45 s is NOT a recommendation.** Its MAE is identical to 0.84 and the confidence intervals overlap
> almost entirely (0.79–0.90 vs 0.80–0.87); RMSE, LoA and r favour it by margins well inside that
> overlap. Judged through the error bars, 45 and 60 are indistinguishable — and a change to a shipped
> DSP constant needs a difference, not a tie.
>
> **Limits, stated because they bound what this can be used for:**
> · **3 nights / 2,260 epochs**, not §1's 7 / 3,665 — this is a different corpus (see below), so the
>   MAE **0.84** here is NOT comparable to the published **0.95**. Only the *shape* across windows is.
> · **The rows are not a paired comparison.** `n` climbs 2094 → 2293 with the window, so each row
>   scores a slightly different epoch set — a longer window yields more confident epochs at the edges.
>   The trend is large relative to that drift, but it is a confound and not a controlled one.
> · Epochs within a night are autocorrelated, so the 95 % CI is optimistic.
> · Staging `*_EVE.edf` (22 files) changed only the pooled-leg diagnostics, not the scored set — 3
>   nights and MAE 0.84 either way. A robustness check, not an improvement.
>
> #### ⚠ Where the corpus came from — and why it could not have come from this checkout
>
> **`uploads/` in the repo cannot run this tool at all.** It holds 113 `*_ACC.txt` across 14 dates and
> EDFs on **three** dates (2026-06-12/13/16), and **the two sets do not intersect** — so zero nights
> pair and zero groups form. Anyone re-running §5 from a clean checkout gets "no ACC+BRP night pairs
> found", which is *also* what the §11.1 `sessionStamp` bug used to print. **The corpus lives on the
> capture box** (`vigil:/srv/tepna/captures`), where 23 dates carry both. Staged: 23 H10 ACC
> (`Polar_H10` only — `resp-acc-analysis-app.js:56` filters Verity out) + 30 `_BRP.edf`, 1.4 GB.
>
> #### 🔴 A ONE-HOUR CPAP CLOCK STEP splits this corpus, and it vetoes scoring outright
>
> On all 23 nights the tool refused: **"no night aligned well enough to score", 0 of 23
> drift-consistent**, drift fit **168.4 s/day with residual SD 544 s**. The recovered offsets are
> bimodal — **≈ −2330 s** for 07-26→07-29 and **≈ +1270 s** for 08-01→08-19. The gap is ~3600 s.
>
> A linear drift fit cannot represent a step; it renders one as enormous scatter and then correctly
> refuses everything. Restricting to the post-step cluster (19 nights) collapses the fit to
> **4.681 s/day, residual SD 30.47 s** and 3 nights become scoreable. **The refusal was right and
> specific, not a failure** — and it is the same class as the ResMed skew the Integrator vetoed on
> 2026-07-26. Anything pooling CPAP nights across 2026-07-30 must handle this step explicitly rather
> than fitting through it.
>
> **Reproducing this.** `tools/resp-acc-headless.mjs` now prints every rendered table, so the
> agreement row is readable from the run rather than only on screen — without it the numbers above
> could not be re-derived, which is the PAPERS-ROADMAP §5.2 requirement. The DSP was reverted to
> `RR_WIN_SEC = 60` and rebuilt; the rebuilt tool is **byte-identical to the committed one**, which
> also re-confirms the build is deterministic.
>
> **§5 Done-when: MET for the turning point, PARTIAL on the corpus** — measured and stated over 3
> nights rather than 7, on box data rather than `uploads/`. The remaining work is n, not method.

> ### 🔁 REPLICATED 2026-08-20 on the PRE-STEP cluster — the turning point is the estimator's, not the corpus's
>
> The sweep above ran on the post-step (August) nights. The clock step that forced that split also
> hands the experiment a **second, disjoint corpus for free**: the 4 pre-step nights (07-26 → 07-29),
> whose own lock spread is 11 s (−2335 / −2325 / −2336 / −2333) and which fit
> **−5.794 s/day, residual SD 5.00 s** — tighter than August's 30.47 s, and of the **opposite sign**
> to August's +4.681 s/day. 2 of 4 score, 1,309 epochs. Same rebuild recipe, same control before each
> read; all six passed.
>
> | `RR_WIN_SEC` | Aug MAE (3 nights) | **Jul MAE (2 nights)** | Jul 95 % CI | Jul RMSE | Jul ≤2 brpm | Jul r |
> |---|---|---|---|---|---|---|
> | 20 | 0.95 | 0.89 | 0.88–0.89 | 1.54 | 91.5 % | 0.607 |
> | 45 | **0.84** | **0.82** | 0.74–0.88 | 1.65 | 92.1 % | 0.611 |
> | **60 — shipped** | **0.84** | 0.85 | 0.79–0.89 | 1.47 | 91.5 % | **0.666** |
> | 90 | 0.91 | 0.96 | 0.90–1.01 | 1.75 | 90.3 % | 0.565 |
> | 120 | 0.98 | 1.00 | 0.93–1.05 | 1.78 | 89.4 % | 0.545 |
> | 180 | 1.05 | 1.06 | 0.98–1.12 | 1.83 | 87.3 % | 0.506 |
>
> **The same shape, on nights that share nothing.** Minimum in 45–60 s, monotonic rise beyond it, a
> penalty at 20 s. The two curves converge at the long end (180 s: 1.05 vs 1.06) and differ most at
> 20 s (0.95 vs 0.89). The null baseline is again invariant within each sweep (1.34–1.35, vs August's
> 1.36) and again does not track the estimator.
>
> **This is what makes "the window is already right" a property of the estimator rather than of three
> August nights.** Two disjoint night sets, two different CPAP clock regimes — opposite drift signs —
> and one turning point.
>
> **45 s remains a tie, and now twice over.** Aug: 0.84 (0.79–0.90) vs 0.84 (0.80–0.87). Jul: 0.82
> (0.74–0.88) vs 0.85 (0.79–0.89). Both overlap heavily, and 60 s wins Jul's `r` (0.666 vs 0.611) and
> RMSE (1.47 vs 1.65) while 45 s wins Aug's. **Keep 60.** A shipped DSP constant needs a difference
> that survives its error bars, and this one does not — in either direction.
>
> ⚠️ **Still small: 2 and 3 nights.** Replication across disjoint corpora is stronger evidence than the
> same n in one pool, but it is not a substitute for n. The remaining §5 work is unchanged — more
> scoreable nights — and the binding constraint is the **drift-consistency gate** (3 of 19, 2 of 4),
> not the number of nights staged.

> ### 🧪 THE BINDING CONSTRAINT MEASURED 2026-08-20 — the drift gate is load-bearing, and n is a PRECISION TRADE
>
> The two sweeps above left one open item: only **3 of 19** (and 2 of 4) nights score, so the ceiling
> on §5/§1 is the **drift-consistency gate**, not the nights staged. That gate is
> `resp-acc-analysis-app.js:858` — `var good = isFinite(delta) ? Math.abs(delta) < 5 : d.lock.r >= 0.4;`
> — a hardcoded **5 s** bound on |recovered − predicted| against the fleet drift model.
>
> **The prior was that it is over-tight**, and it was a reasonable prior: the median respiratory period
> here is **3.60 s**, so 5 s already exceeds one whole breath, and the gate is therefore not enforcing
> physical alignment but *model fit* — which the clock step above shows can fail a perfectly good lock.
> **Decision bands were written down before the run** (in-CI ⇒ free win · out-of-CI but ≪ null ⇒
> judgement call · near null ⇒ load-bearing). Swept by patching that line and rebuilding, control
> asserted each time.
>
> | drift tol | nights | epochs | MAE | 95 % CI | RMSE | LoA | ≤2 brpm | r |
> |---|---|---|---|---|---|---|---|---|
> | **5 s — shipped** | 3 | 2,260 | **0.84** | 0.80–0.87 | 1.45 | ±2.82 | 93.6 % | 0.692 |
> | 10 s | 6 | 4,634 | 0.97 | 0.87–1.08 | 2.01 | ±3.90 | 92.0 % | 0.498 |
> | 15 s | 8 | 5,517 | 0.99 | 0.89–1.09 | 2.14 | ±4.15 | 91.7 % | 0.459 |
> | 25 s | 12 | 8,427 | 1.03 | 0.92–1.15 | 2.53 | ±4.89 | 91.6 % | 0.395 |
> | 40 s | 13 | 9,526 | 1.03 | 0.93–1.13 | 2.43 | ±4.70 | 91.7 % | 0.421 |
> | 75 s | 17 | 12,967 | 1.01 | 0.91–1.11 | 2.33 | ±4.51 | 91.5 % | 0.446 |
>
> **Verdict: band 2 — the prior was WRONG and the gate is load-bearing.** MAE at 15 s is 0.99, outside
> the shipped tolerance's 0.80–0.87. Loosening is not free. **Do not widen it to buy n**, and above all
> do not re-derive a published MAE at a loose tolerance — that would inflate the error estimate by
> folding in misaligned nights and call it a bigger sample.
>
> **But the cost is bounded and the shape is informative.** The whole penalty lands on the FIRST step
> (5 → 10 s, +0.13); from 10 s to 75 s MAE is flat at 0.97–1.03 while nights go 6 → 17. And the metrics
> do not degrade together: **RMSE +75 % and LoA +73 % against MAE +20 % and ≤2 brpm −2.1 pp**. A night
> that were merely *harder* would move all of them proportionally; a *misaligned* night produces a
> minority of grossly wrong epochs, which is exactly a tail that inflates RMSE/LoA while leaving the
> median epoch alone. So the added nights are mis-registered, not intrinsically noisier — the gate is
> catching what it claims to catch.
>
> **The real finding is that ONE constant is serving TWO purposes.** A headline accuracy claim wants
> the tight bound (report 0.84 on 3 nights). Statistical power for a *relative* comparison — which is
> all the window sweep needed — tolerates the loose one and gets **5.7× the epochs** (2,260 → 12,967)
> at MAE still far below the 1.36 null. Conflating them is what makes the ceiling look immovable.
> ⚠️ Note also that the drift MODEL is unchanged across every row (4.681 s/day, SD 30.47 s, 8
> confidently-locked nights) — tolerance selects which nights *score*, it does not refit anything. That
> is what makes this a clean selection experiment rather than a confounded one.
>
> **Not proposed here:** splitting the constant into a scoring bound and a power bound. It is a change
> to a shipped analysis tool that would move published numbers, and it needs the owner, not a sweep.
> The measurement is recorded so the decision has one.

**Cheap to run, because the apparatus now exists.** `resp-acc-analysis.html` drives the shipped DSP over
the corpus headlessly in ~54 s per pass (§11 of the parent), so the whole sweep is minutes of compute.
The only code change is making `RR_WIN_SEC` injectable for the sweep rather than a module constant —
and it must go back to a constant before anything ships, so the sweep does not leave a tunable in the
DSP.

**Done when:** MAE-vs-window is measured over the 7 nights and plotted, the turning point (if any) is
stated, and the outcome is recorded either way — including "the window is already right", which is a
result and not a non-result.
