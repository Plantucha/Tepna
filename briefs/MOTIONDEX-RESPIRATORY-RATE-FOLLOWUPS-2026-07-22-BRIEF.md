<!--
  MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-08-01 (**§2, §3 and §4 are now GATED — see §2a.** All three fixes existed
in `resp-acc-analysis.js`; none had a test, and the module was loaded by NEITHER runner, so each fix
rested on the comment above it. It is wired into both lanes and the three failure modes are pinned by
known answers that reproduce the brief's own published figures (1.19 % rate error · −36.7 dB at 0.8 Hz),
each mutation-verified by reintroducing the original bug. **NOT done:** §2's proposed shared `nativeHz`
spine helper — deliberately deferred, see §2a. §1 and §5–§9 are untouched.) · **Created:** 2026-07-22

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
