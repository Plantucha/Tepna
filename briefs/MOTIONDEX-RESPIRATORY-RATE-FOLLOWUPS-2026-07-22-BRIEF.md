<!--
  MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-07-22

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

## 8 · Where the estimator still loses, and the cheapest lever

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
