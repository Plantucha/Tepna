<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (deferred 2026-08-08 — **HARDWARE-BLOCKED, and the hardware does not exist**: the owner confirms there is no ResMed oximeter module, so items 1 + 2 need a PURCHASE, not a cable. Not parked for lack of will or code; see the 2026-08-08 banner) · **Created:** 2026-07-12 · **Executes:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md` §7 **R5** · **Companion to:** `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` · **Feeds:** `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · **DRAIN 2026-09-02 (Osprey) — restamped, hardware blocker re-verified as unchanged.** Items 1+2 need a ResMed oximeter module the owner has confirmed does not exist; that is a PURCHASE, not a cable, and no fleet action substitutes. Same physical blocker as [[CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14]]'s remaining `[BLOCKED]` item — they unblock together or not at all. **Owner: the OWNER. Next step:** a purchase decision; nothing else.

> ## ⚠️ 2026-08-08 — "the fix is one cable" IS WRONG. There is no oximeter to connect.
>
> This brief says it five times — *"The fix is one cable"*, *"Zero code cost"*, *"entirely the owner's
> to do"* — and each reads as a task waiting on ten minutes of someone's attention. **Confirmed with
> the owner 2026-08-08: the ResMed oximeter module is not owned.** So item 1 is a **purchase**, and the
> independence test behind the entire reference-free σ programme is not one cable away; it is one
> piece of hardware plus ≥5 quad-modal nights away.
>
> The original phrasing was not careless — `_SA2.edf` really does write `Pulse.1s`, and the channel
> really is the "no oximeter connected" sentinel, so the *software* is genuinely ready. But "ready
> once the hardware exists" and "one cable" are different claims, and only the first is true. Left in
> §4 below as written, with this banner as the correction, per the house rule against rewriting a
> record in place.
>
> **Consequence, and it is not small:** `TCH-REFERENCE-VALIDATION` measured ρ(err_ECG, err_PPG) = 0.42
> against a ρ_crit ≈ 0.422 identifiability boundary (`PAPERS-ROADMAP` §2.8). The fourth corner is how
> that assumption gets checked. Until the hardware exists, **the assumption stays unchecked** — which
> is a limitation the σ-papers should carry as a standing one, not as a pending experiment. Do not
> re-raise this as actionable work; it is not, and re-deriving that fact costs a session each time.
>
> **No substitute exists in the current kit.** A 4th corner must be mechanistically independent of the
> other three. The O2Ring's own finger pleth through PPGDSP (`PpgDexFinger`, which `trio-batch` already
> emits) is a *second estimator on the same sensor*, not a second sensor — and it is optically twinned
> with OxyDex besides, which is exactly the mechanism-collision §4's own caveat warns against.
>
> ## 2026-08-08 — the estimator confound is now FIXABLE from the export
>
> §5's superseding entry ends: *"no per-device HR bias may be read off cross-node epoch HR until the
> nodes agree on one statistic"*, and `R5-HR-TRIPLET-FOLLOWUPS` §3 records what is owed — **one epoch
> statistic fleet-wide, NAMED in the export so a consumer can refuse a mismatched pair.** Half of that
> is now unblocked, by a change made for a different reason.
>
> **`OxyDex timeseries.hr` now carries the 1 Hz pulse series** (the `ms;hr;c` contract, landed for the
> fused-hat re-fit — see `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`). Until now the node published pulse rate
> ONLY as 5-min `epochs[].hr`, already reduced by `median(1 Hz rate)` — so a consumer wanting ECGDex's
> statistic (`60000/mean(RR)`) could not compute it: the samples were gone at the export boundary. That
> is precisely why the −0.299 bpm confound was un-diagnosable downstream and had to be chased with a
> bespoke tool. **With the per-second series committed, either statistic is derivable from the same
> bytes**, so a cross-node comparison can put both nodes on ONE statistic instead of differencing two.
>
> Two things this does **not** do, stated so the next reader does not over-read it:
> - It does **not** name the statistic in the export. `epochs[].hrStat` already says `median-rate`
>   (OxyDex) vs `rate-of-mean` (ECGDex) — the *labelling* half of FOLLOWUPS §3 is done — but nothing
>   **refuses** a mismatched pair; a consumer must still check. That gate is still owed.
> - It does **not** touch §4. The independence test still needs a fourth, mechanistically-independent
>   corner, and `_SA2.edf`'s `Pulse.1s` is still the "no oximeter connected" sentinel (spot-checked
>   2026-08-08: all −1 across the sampled committed SA2 files). **The fix is still one cable**, and it
>   is still entirely the owner's to do.
>
> ⚠️ §4's citation `cpapdex-dsp.js:332` has drifted — that line is now leak-dynamics code. Locate the
> sentinel by identifier, not line number.

> **2026-08-04 backlog sweep.** This brief's headline finding — that the papers report a reference-free σ
> without ever saying it is variance-only and never validated against truth — was **verifiably still true**
> when picked up: zero matches for `bias-blind` / `variance-only` / `no bias term` / `never been validated`
> in either paper. Both write-ups are now landed (see §5), so the honesty gap is closed even though the
> experiment itself remains blocked. **The remaining blocker is one cable**, named in §4 and unchanged.

# R5 on the HR triplet — the independence test is **not runnable**, and that is the finding

> **One-line:** R5 asked for `TCH-REFERENCE-VALIDATION`'s experiment re-run on the **HR** triplet using the
> chest-ECG as reference. It **cannot be done** — and the reason is structural, not practical. Because the
> chest-ECG **is one of the three corners**, TCH's `σ_ECG²` is *algebraically identical* to the covariance of
> the other two corners' errors, so the measured ρ and the independence-null are **the same number**. The test
> has **exactly zero power**. What R5 *can* measure is **bias**, and it finds one: **OxyDex under-reads by
> −0.36 bpm**, invisible to every σ the fleet reports. **The fix is one cable: connect the ResMed oximeter and
> the CPAP becomes the fourth, independent HR corner the test requires.**

## 1 · Why the HR triplet is not the respiration triplet

`TCH-REFERENCE-VALIDATION` worked because **CPAP is a genuine FOURTH device** — its error is independent of the
two estimates it judges. That is what let it measure `ρ(err_ECG, err_PPG) = 0.42` and expose the violated
independence assumption.

The HR triplet is `{ECGDex, PpgDex, OxyDex}`. The "closest thing to truth" — the chest-ECG Pan–Tompkins leg —
**is one of the three corners.** Two consequences, and the second is fatal.

### (a) σ_ECG is unvalidatable — you cannot measure a corner against itself. (Expected.)

### (b) The independence test collapses to an identity. (Not expected, and fatal.)

Measure the other two corners against the ECG reference:

```
e_P = P − E          e_O = O − E          (both contain −err_ECG)
```

They **share a term**, so even under perfect independence ρ(e_P, e_O) > 0. The obvious correction is to test the
measured ρ against the ρ *expected from the shared reference alone*:

```
ρ₀ = σ_E² / √( (σ_P² + σ_E²)(σ_O² + σ_E²) )
```

**That correction does not work, because the null and the measurement are the same number.** Expand TCH:

```
var(P−O) = var(e_P − e_O) = var(e_P) + var(e_O) − 2·cov(e_P, e_O)

σ_E²(TCH) = [ var(E−P) + var(E−O) − var(P−O) ] / 2
          = [ var(e_P) + var(e_O) − var(e_P) − var(e_O) + 2·cov(e_P,e_O) ] / 2
          = cov(e_P, e_O)                                      ← IDENTITY
```

**TCH's σ_ECG² *is* the covariance of the other two corners' reference-relative errors.** Substituting it into ρ₀
gives back the measured ρ exactly. Verified numerically on the committed corpus:

```
TCH σ_ECG²                      = 6.068154
cov(err_PPG, err_OXY) vs ECG    = 6.068154
difference                      = 6.7e-14        (floating-point zero)
```

⇒ measured ρ − null ρ₀ = **0.000, always, by algebra**. The test cannot detect dependence *even if it is
enormous*. Any "excess correlation" reported this way would be **fabricated**.

**The same collapse hits the σ comparison.** TCH reproduces the pairwise variances by construction, so
`σ_measured(X)² = σ_X² + σ_E²` is also an identity — √(1.22² + 0.80²) = 1.46 = the directly measured SD, exactly.
Comparing σ_TCH to σ_measured on this triplet **validates nothing**.

> **Rule to carry forward:** a three-cornered hat **cannot be validated using one of its own corners as the
> reference.** Validation requires a genuinely external Nth device. This is why
> `TCH-REFERENCE-VALIDATION` is a real result and R5-as-stated is not.

## 2 · What R5 CAN measure — bias — and there is one

TCH estimates **variance**; it has **no bias term at all**. So bias is information the estimator does not encode,
and measuring it against the chest-ECG is *not* circular. Committed 17-night corpus, 5-min epochs:

| corner | bias vs chest-ECG (ungated, n=1232) | bias (artifact-gated, n=1192) |
|---|---|---|
| **PpgDex** | **+0.464 bpm** | **−0.028 bpm** ← the artifact gate removes it |
| **OxyDex** | **−0.436 bpm** | **−0.357 bpm** ← **persists** |

**OxyDex systematically under-reads HR by ≈ 0.36 bpm**, and it survives artifact gating — so it is not
contamination, it is the device (or the pulse-oximetry HR path). **Every σ the fleet publishes is blind to it.**

> ⚠ **AMENDED 2026-08-04 — the attribution above ("it is the device") is RETRACTED.** It is the
> ESTIMATOR. On 726 paired epochs, changing only OxyDex's aggregation (`median(rate)` → `mean(rate)`)
> moves the bias from −0.244 bpm (5.7σ) to +0.013 (0.3σ) — a device cannot move because the analyst
> picked a different average. The ring's firmware HR independently agrees with chest-ECG to 0.6σ over
> 237 windows. PpgDex's row is unaffected (it already uses ECGDex's statistic) and stands. See
> `R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md` §3. The *conclusion below* — that the hat is blind to
> bias — is unchanged and in fact reinforced.

This **confirms `TCH-REFERENCE-VALIDATION` Finding A on a second, independent triplet**: the estimator's
blindness to bias is not a quirk of the respiration corners, it is a property of the hat.

Valid only if the raw-ECG leg is ≈unbiased — which is the fleet's own stated premise (CLAUDE.md: the raw
Pan–Tompkins ECG is the **honest** H10 leg; the device `_HR.txt` is the smoothed one).

## 3 · A caveat AGAINST the companion brief's gate — raised here, not hidden

R5 also shows the artifact gate cutting `SD(PPG − ECG)` from **4.52 → 1.46 bpm** (−68%) and
`SD(OXY − ECG)` from **2.83 → 1.63** (−43%).

**That is NOT independent validation of the gate, and must not be cited as such.** The gate is *defined* by
cross-corner disagreement, so measuring cross-corner agreement afterwards is close to tautological — removing
the epochs where corners disagree necessarily shrinks the spread of their differences.

The gate's real evidence is the **SQI** channel it does *not* use (`TRIO-ARTIFACT-GATE` §1: burst epochs at SQI
0.37–0.45 against a 0.52 baseline, with the beat count doubling). That is an independent signal. The
agreement-after-gating number is not.

## 4 · The fix is one cable

The independence test needs a **fourth, independent HR corner**. One already exists in the hardware and is
switched off:

`CPAPDex`'s `_SA2.edf` writes **`Pulse.1s` + `SpO2.1s`** — a 1 Hz pulse rate from the ResMed oximeter. On the
current corpus **every sample is −1** (`cpapdex-dsp.js:332`: the device's "no oximeter connected" sentinel),
because the oximeter module was never attached.

**Attach it, and the CPAP becomes a fourth HR corner** whose error is independent of the H10's electrical
detection, the Verity's optical detection, and the O2Ring's optical detection. That makes R5's independence test
**runnable for the first time** — and it is the only way to check the assumption the entire reference-free σ
programme rests on.

⚠️ **One caveat when it arrives:** the ResMed oximeter and the O2Ring are **both photoplethysmographic**. Their
errors may well be correlated with each other (shared perfusion/motion failure modes) — which is precisely the
mechanism-collision `TCH-REFERENCE-VALIDATION` **R3** warns about. The right corner set is therefore
**{H10-ECG, ResMed-pulse, O2Ring}** or **{H10-ECG, Verity-PPG, ResMed-pulse}**, chosen so the truth leg is not
mechanistically twinned with a corner. Do not simply add it as a fourth and hope.

## 5 · Done when

- [ ] **Acquire** a ResMed oximeter module, then record ≥ 5 quad-modal nights (CPAP + H10 + Verity +
      O2Ring). ⚠️ **Not "zero code cost" — a PURCHASE.** The owner does not have the module
      (confirmed 2026-08-08); the software side is ready, the hardware is absent. See the banner.
- [ ] Re-run the R5 experiment with **ResMed pulse as the external reference** — then, and only then, the HR
      triplet's **independence** and **σ accuracy** become measurable.
- [x] **RESOLVED 2026-08-04 (second pass) — the −0.36 bpm is NOT the O2Ring. It is a CONFOUND between
      two nodes' epoch-HR estimators, and the earlier bounding below is superseded.**

      **(1) The ring's firmware HR agrees with chest ECG.** `tools/o2ring-finger-validate-batch.mjs`
      already existed — it derives HR from the ring's OWN pleth and compares it against both the ring's
      1 Hz HR field and the paired H10 ECG. Run over **all 20 capture nights → 252 windows, 237 PASS**:

      | comparison | all PASS (n=237) | long ≥30 min (n=39) |
      |---|---|---|
      | derived pleth − firmware | −0.290 (6.9σ) | −0.221 (3.1σ) |
      | **firmware − ECG** | **−0.027 (0.6σ)** | −0.249 (2.6σ) |
      | derived pleth − ECG | −0.317 (7.7σ) | −0.469 (4.7σ) |

      Over all windows the firmware column is **statistically indistinguishable from the ECG**. The
      sensor is not the biased leg. (The long-window subset disagrees at 2.6σ on n=39 — thin, and the
      15 FAILs, several gross at 16–21 bpm, are excluded as lost contact / harmonic counting.)

      **(2) The two nodes summarise an epoch differently.** `ECGDex: hr = 60000/mean(RR)` (the rate of
      the mean interval); `OxyDex: hr = median(1 Hz rate)`. On **1670 real 300-beat blocks**, one series
      through both statistics: **median(rate) − 60000/mean(RR) = −0.299 bpm (SD 0.49)** — against the
      **−0.269** cross-node figure §5 attributed to the device. The confound is the size of the finding.

      ⚠ **What I could NOT establish, having tried:** that this is estimator arithmetic holding on any
      series. On a smooth symmetric RR series the two agree to +0.03; injecting long pauses gives
      **+0.54, the opposite sign**; a within-block trend gives −0.03. None reproduces −0.299, so the
      effect depends on a feature of real overnight RR I have not isolated. The gate is therefore a
      **source scan on the confound** (the two estimators differ, anchored on the epoch-HR assignment
      and mutation-verified), not a numeric claim. Reproduce the numbers with
      `DEX_UPLOADS=<corpus> node tools/oxy-hr-bias.mjs` — LEG 3 is new.

      **Consequence for the brief:** no per-device HR bias may be read off cross-node epoch HR until the
      nodes agree on one statistic. §2's table and the "OxyDex under-reads" headline are confounded, and
      the ResMed fourth corner is not what unblocks this one — agreeing on an estimator is.

      **Spawned:** `R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md` — carries the question this raises
      (is the σ an artifact too? **no**, under 2 % on the affected leg, and that upper bound assumes
      an independence the two statistics do not have) and what is owed: one epoch statistic
      fleet-wide, NAMED in the export so a consumer can refuse a mismatched pair, and the
      still-unisolated mechanism inside real RR.

- [~] *(superseded by the entry above)* **Investigated 2026-08-04 — one candidate ELIMINATED, the other two BOUNDED but not separable
      here.** Reproducible via `tools/oxy-hr-bias.mjs` (no number without a tool that reproduces it).

      **(a) OxyDex's own HR path — EXCLUDED.** Over **42 nights**, the mean of the raw `Pulse Rate` CSV
      column and `computeNight().stats.meanHr` differ by **−0.0138 bpm**, and that residual is entirely
      OxyDex's 1-decimal output rounding (52.628 → 52.6). There is no rolling median, no smoothing, no
      aggregation bias. Whatever the offset is, it is **upstream of OxyDex**.

      **(b) 1 Hz bucketing — real, but it does not account for the size.** The column is confirmed
      integer-quantized: **0 non-integer values in 42 nights**. That gives a sharp prediction, because
      averaging does NOT wash quantization out — every sample is biased the same way, so if the device
      **truncates**, the epoch mean sits exactly **−0.500** below truth; if it **rounds**, **0.000**.

      **Measured against the raw-ECG leg** (folded trio corpus, per-5-min epoch, keyed on the ABSOLUTE
      floating-ms grid because the two nodes' `tMin` are node-local): **n = 3136 epochs over 40 nights,
      mean Δ = −0.269 bpm, SD 1.37, SEM 0.024 — 11.0σ from zero.** The bias is unambiguously real and
      unambiguously **not** pure truncation: it sits roughly halfway between the two predictions.

      **(c) a genuine device offset — survives, now bounded.** If the ring truncates, the residual
      device offset is ≈ **+0.23**; if it rounds, it is the full ≈ **−0.27**. Those cannot be separated
      against a reference that is itself one of the three corners — which is exactly what this brief's
      first two items are for. **The ResMed oximeter is still the experiment**; what changed is that it
      now has one fewer candidate to distinguish and a numeric target to hit.

      Caveat kept in view: the per-epoch SD (1.37) dwarfs the offset, so this is a small systematic bias
      on a noisy difference, visible only in pooling. A single night says nothing — the per-night means
      range from **−0.87 to +0.08**.
- [x] **State the blindness in the papers — DONE 2026-08-04.** Neither paper said it (measured: zero matches
      for `bias-blind`/`variance-only`/`no bias term`/`never been validated` in either file). Added
      `papers/sigma-no-reference.html` **Limitations (ix)**: every σ there is variance-only and the estimator
      has never been validated against an external truth, plus the §1 identity with its zero-power
      consequence. Closes with: these are **precision** estimates, not accuracy statements.

      ⚠️ **REWRITTEN 2026-08-04 (same day) — the first version of (ix) shipped the −0.269 bpm figure as a
      measured *O2Ring* bias, which §5's own bias item then overturned** (see the `[~]` entry above and
      `changes/2026-08-04-hr-estimator-confound.md`). That was a false claim in a published preprint, and
      it survived because this write-up item was executed from §2's headline before §5's investigation had
      landed. (ix) now states the corrected account: the cross-node −0.269 is an **estimator confound**
      (ECGDex `60000/mean(RR)` vs OxyDex `median(1 Hz rate)` gives −0.299 on one real series through both
      statistics, no device involved), the ring's firmware HR is **indistinguishable from chest ECG**
      (−0.027 bpm, 0.6 σ, 237 windows, `tools/o2ring-finger-validate-batch.mjs`), the −0.299 mechanism is
      **not** isolated (synthetic series give +0.03 / +0.54 / −0.03), and therefore **no per-device HR bias
      may be read off cross-node epoch HR until the nodes agree on one statistic**. The limitation is
      stronger for it: there is at present no validated bias figure for any corner to be blind to.
- [x] **Fold the §1 identity into `SENSOR-TRIO-NIGHTS` methods — DONE 2026-08-04.** Added to **§2.2**, directly
      after the TCH kernel and its negative-output note, as the paper's own justification for having a
      Monte-Carlo arm at all: the e_P/e_O shared-term expansion, the collapse σ²_E = cov(e_P, e_O), the
      numerical check (6.068154 vs 6.068154, diff 7×10⁻¹⁴), and the conclusion that validation needs either a
      genuinely external Nth device or planted ground truth. This is the placement the item asked for — it
      forecloses the experiment at the point a reader would propose it.
      ⚠️ `papers/` is a **served tree**: both edits required `node tools/build-docs.mjs` and the
      `docs/papers/*.html` copies. `--check` caught it (`STALE (2)`). As `CLAUDE.md` warns, the tool's printed
      `git add` line named **nine paths, zero of them changed**, and omitted the two it had just rewritten —
      stage from `git status`.

## 6 · Reproducing

Read-only against the committed corpus (`uploads/trio/`, 17 nights × 3 node-exports); no bundle, no ledger, no
`manifestHash` move. The identity in §1 is exact and can be re-derived in three lines from any triplet.
