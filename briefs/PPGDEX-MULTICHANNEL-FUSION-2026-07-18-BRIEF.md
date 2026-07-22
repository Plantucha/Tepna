<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-18 (**§4 Phase 3 — the degenerate-channel guard — EXECUTED** ahead of
Phases 1–2, because it is the honesty half and was fixing a live defect: the capture host replicates the
O2Ring's single finger pleth across `ppg0/1/2`, so `ledAgreementPct` reported a structurally-guaranteed
`100` at `measured` tier. `analyze` now dedupes bit-identical channels before the consensus vote and takes
the honest `nCh < 2` path at one distinct channel. Both directions mutation-verified; the real-corpus
PpgDex equiv fixture reproduced byte-identical, so genuine Verity captures are provably untouched.
**Phases 1, 2 and 4 — ambient subtraction, linear combining, per-channel reporting — remain unexecuted**,
and §0's line refs still need re-locating against PR #218's `parsePPG` rewrite. One residue surfaced while
executing: see §4's *middle-case residue* note.) · **Created:** 2026-07-18

> **⚠️ 2026-07-21 — Phases 1–2 are REFUTED by measurement.** `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` scored ambient subtraction and linear channel combining against 20 nights of paired chest-ECG ground truth. Waveform fusion **loses** out-of-sample (mean-of-3 0.95×, PCA-1 0.95×, max-SNR GEV 0.97× vs best-single-channel; foot-to-foot PPI sd 158.9 ms for ch0 alone vs 163.7 fused), and overnight ambient subtraction costs ~0.5 % SNR because ambient's within-minute std is a hardware constant (34.66–35.16 counts across all 53 non-daylight sessions). This brief's premise that the channels correlate at r 0.62–0.68 does not reproduce — the pulse-band correlation is **0.95–1.00 at zero lag**, which is exactly why averaging cannot help. **§4 (the degenerate-channel guard, EXECUTED) stands and is unaffected.** Do not execute Phases 1–2 as written.

# PpgDex: stop *selecting* a channel and start *combining* them (Verity 3-LED + ambient)

> **What this is.** An executable plan to replace PpgDex's **best-single-channel selection** with
> **ambient subtraction + optimal linear combining** of the Verity's three optical channels. The
> published comparison is unambiguous — Lee et al. 2018 benchmarked exactly our approach
> (*"multichannel best signal selection"*) against SVD-based fusion and fusion won at every exercise
> intensity. Fusion is also **measured 4.6× cheaper** than doing selection properly, and it dissolves
> the switching-artifact problem by construction.
>
> **Scope split.** This brief is the **Verity / multi-channel** half. The **O2Ring single-channel
> finger-site** half is [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md).
> They are separate work-units on purpose: this one **moves every existing PpgDex export** (fixture
> regen owed); that one is **additive** (new input, nothing existing moves). Do not merge them.

---

## 0 · Measured facts (established by execution 2026-07-18 — do NOT re-derive)

All measured on a real corpus night, `Ecg nightly/Polar_Sense_0C301E3F_20260610_211539_PPG.txt`.

**The three channels are the SAME wavelength at different positions — not different wavelengths.**

| | ch0 | ch1 | ch2 | ambient |
|---|---|---|---|---|
| DC level | −478,181 | −479,896 | −463,877 | −650,707 |
| Perfusion (AC/DC) | 0.513 % | 0.489 % | 0.581 % | — |

DC spread across the three is **3.38 %**. Red (~660 nm) vs IR (~940 nm) through tissue differ by a
*large factor* — that difference is the entire physical basis of pulse oximetry — and their perfusion
indices diverge sharply. Three channels within a few percent, with near-identical PI, is **spatial**
diversity, not spectral. (The Verity is an HR armband, **not** a pulse oximeter; it has no reason to
carry red/IR.)

**Cross-correlation lag between every channel pair is 0 samples (±0.0 ms), with peak r = 0.62–0.68.**
Identical timing, decorrelated noise — textbook diversity combining. Two consequences:

1. **The "switching injects a timing step" objection is dead.** There is no systematic inter-channel
   offset to step across. An earlier draft of this analysis asserted a wavelength/penetration-depth
   delay; that was **wrong and is disproven above**. Do not reintroduce it.
2. **Combining is well-posed.** Same signal + independent noise is exactly the case where a weighted
   sum beats picking one.

**`ambient` is parsed and never used.** `ppgdex-dsp.js:242` stores `amb`; `:2345` passes it through; *(line refs are pre-#218; that PR rewrites `parsePPG` to resolve columns by header name with a numeric-tail fallback — re-locate before editing, and re-confirm the never-used finding against the new parser)*
**no computation reads it** (verified by grep — the only hits are parse, store, carry). The Polar SDK
community is explicit that *"the ambient channel should be subtracted from each of the other channels."*

**The current selector is weaker than it looks.** `pickChannel` (`ppgdex-dsp.js:276`) is called
**once** (`:1536`), and `channelSNR` (`:263-266`) scores a **single ~90 s window taken from the middle
of the record**. On a 10 h night that is **~0.25 % of the data choosing the reference for 100 % of it**.
The comment justifies it as *"SNR is scale- & length-invariant"* — scale-invariant yes, **time**-invariant
no. An armband shift at 02:00 leaves the pick stale for the rest of the night and nothing notices.

**Cost, benchmarked** (real file, 121 min, 24 × 5-min windows):

| Approach | Total | Per window |
|---|---|---|
| Per-window SNR, 3 ch × 2 bands (*selection, done properly*) | 614.9 ms | 25.62 ms |
| **Per-window 3×3 covariance + top eigenvector (*fusion*)** | **134.4 ms** | **5.60 ms** |

**Fusion is 4.6× cheaper than selection** — and that *understates* it, because fusion collapses three
`detectChannel` runs into one on the fused signal. For 3 channels you need only a 3×3 covariance: one
O(N) pass with 6 accumulators, then an eigensolve whose cost is independent of window length. No
filtering is required merely to *choose*.

Recovered weights are stable and all three channels contribute — the vector **rotates smoothly**, it
never hard-switches:

```
[0.580, 0.568, 0.585]    [0.584, 0.496, 0.642]    [0.507, 0.497, 0.705]
[0.549, 0.513, 0.660]    [0.622, 0.507, 0.597]    [0.603, 0.439, 0.667]
```

That is why fusion needs **no hysteresis and no gap-across-switch rule** — there is no discrete choice
to oscillate.

---

## 1 · Method sources (published; cite in code, do not upgrade a badge on them)

- **[L18]** Lee et al., 2018, *IEEE Sensors Journal* — *Wearable Multichannel PPG Framework for HR
  Monitoring During Intensive Exercise*. Benchmarks single-channel · multichannel weighting ·
  **multichannel best signal selection** · truncated SVD. **Truncated-SVD fusion wins at every
  intensity**; *"the pure pulse is concentrated mostly within the first largest singular value."*
  This is the direct refutation of our current design.
- **[L20]** Lee et al., 2020, *Sensors* — multi-channel PPG artifact reduction via ICA + truncated SVD,
  validated against ECG R-peaks.
- **[M24]** Meier et al., 2024, *IEEE BSN* — *Tri-Spectral PPG*: fuses multi-channel PPG into one
  recovered signal; **4.5 bpm vs 5.9 bpm** green-only (23 % better).
- **[W16]** Warren et al., 2016, *Sensors* — multichannel switching; establishes that *"channels respond
  differently to motion artifacts"* (the diversity premise) and gains **2.7 bpm** over single channels.

⚠️ **Every one of these evaluates during motion/exercise, where multi-channel gain is largest.** This
corpus is overnight rest. **Expect a smaller effect and do not promise the papers' numbers.** DOIs must
be filled before any runtime constant, per `LITERATURE-USE-POLICY`.

---

## 2 · Phase 1 — ambient subtraction (small, independent, ship first)

Subtract `amb` from each optical channel at parse time, before any filtering. One subtraction per
sample; it is what the sensor vendor's own community says the channel is for.

**Ship this alone first.** It is the smallest change that moves an export, so it isolates the fixture
regen and lets you see its effect before fusion lands on top. Record the before/after HRV delta in the
brief when executed.

## 3 · Phase 2 — optimal linear combining (replaces `pickChannel` as the waveform source)

Per analysis window (reuse the existing 300 s epoch grid):

1. Ambient-subtract, accumulate a **3×3 covariance** in one pass (6 accumulators).
2. Top eigenvector by power iteration (~20 iterations on a 3×3 — constant cost) → weights `w`.
3. **Normalize sign** so the fused signal keeps systolic-up orientation (`orient()` already exists —
   apply it to the fused signal, not per channel).
4. Project → **one fused waveform**; run `detectChannel`/`detectBeats` on it **once**.
5. Interpolate `w` across window boundaries (or hold + crossfade over a few beats) so the fused signal
   is continuous. **Do not** hard-switch weights at a boundary.

**Keep `consensusBeats`.** Fusion and consensus are complementary and both earn their place — measured
on synthetic input: three **independent** noise channels drive agreement to **68 %**, all-3 agreement to
**4 %**, and **drop 416 spurious beats**. Fusion improves the *waveform*; consensus validates *beat
presence*. Run detection per channel for the vote, and use the fused signal as the **reference waveform
for foot placement** (replacing `pickChannel`'s role).

**Retain `pickChannel` + `channelSNR`** — they stay useful as per-channel quality reporting and as the
degenerate-case fallback (§4). This brief does not delete them.

## 4 · Phase 3 — degenerate-channel guard (the honesty half)

**Deduplicate bit-identical channels; the count of DISTINCT channels is the sensor count.** Two analog
photodiodes cannot produce bit-identical streams over a night — even the same LED sampled twice differs
by ADC noise — so an identical pair is one sensor reported twice. Set the effective channel count to the
distinct count; at 1, set `singleChannel: true`, take the `nCh < 2` path, and report
`ledAgreement: null`.

> **⚠️ Spec corrected 2026-07-18 — the original wording was "if two channels are bit-identical to a
> **third**", i.e. it only fired at 3-of-3. PR #218 shows why that is too narrow.** Our capture host
> emitted an extra `timestamp [ms]` column on ACC/GYRO/MAG/PPG before 2026-07-18 11:43, shifting every
> index by one. A pre-cutoff O2Ring capture therefore reads as **`(ms-ramp, v, v)`** — only **two**
> identical channels, so a 3-of-3 test would **not** fire and the file would pass as a legitimate 2-of-3
> sensor. Counting *distinct* channels fires correctly at 3-identical, 2-identical, and any future
> variant. (PR #218's header-driven column resolution should make those files parse correctly anyway,
> which is the real fix — but this guard exists precisely to catch layouts nobody anticipated, so it must
> not itself assume one.)

This closes `ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md` §1.3 **at the DSP tier**, which is the
robust place for it: it defends against *any* device or capture bug that replicates channels, not just
today's O2Ring instance, and needs no lockstep change in `capture-host/`.

**Gate it against the shifted shape too**, not only the clean one: `(v,v,v)` ⇒ 1 distinct ⇒
`singleChannel`; `(ramp,v,v)` ⇒ 2 distinct ⇒ **not** 3-LED consensus; three genuinely different channels
⇒ 3 distinct ⇒ full consensus. The middle case is the one the original spec missed.

Covariance is also degenerate for identical channels (rank 1) — the guard must run **before** the
eigensolve, and the fused signal for a single channel is just that channel.

> **Middle-case residue (found executing this section, 2026-07-18 — NOT closed).** The guard as specified
> makes `(ramp, v, v)` report **2 distinct**, which satisfies the stated goal (it is no longer claimed as a
> 3-LED sensor). But the resulting 2-channel vote is between a monotonic ramp and a real pleth, and measured
> end-to-end it yields **`ledAgreementPct: 100` over 25 beats** (vs 188 beats at 67 % before the guard) —
> the ramp's detector fires spuriously near a handful of real beats and those coincidences read as unanimity.
> So the *agreement number* for this shape got worse even as the *sensor count* got honest; what makes it
> visible is the beat-count collapse and the cratered coverage, not the agreement field.
> This is bounded in practice — PR #218's header-driven column resolution means this shape should only arise
> from pre-2026-07-18 captures or an unanticipated layout — and fixing it properly needs a *plausibility*
> test ("is this channel even a photodiode trace?", e.g. reject a monotonic/near-zero-variance-in-band
> channel), which is a different heuristic from bit-identity and was deliberately **not** invented here.
> Either add that test as its own gated item, or accept it and document the shape as coverage-detectable.

## 5 · Phase 4 — per-channel reporting (additive, no behavior change)

Publish per-channel SNR, perfusion (AC/DC) and the fusion weights as export fields, plus the
**spread** of the three channels' independent HR/rMSSD.

⚠️ **Label the spread precision-only, never accuracy.** `integrator-tch.js:21-23` is explicit:
*"the three LEDs are co-located, so motion is COMMON-MODE and TCH cancels common-mode by construction
→ false confidence."* Our measurement makes this **stronger** than that comment assumed — the channels
are the same wavelength, millimetres apart, at zero lag. The spread is a **lower bound on error**.
**Never feed it to a hat**, and never let it become a σ estimate.

## 6 · What NOT to do

- **Do NOT select the channel by agreement with ECG or the O2Ring.** That is selection on the dependent
  variable: it makes the PPG leg's error a function of the ECG leg's, and any later PPG-vs-ECG agreement
  is then manufactured by the selection. It would poison the very comparisons ECG participates in —
  `TCH-REFERENCE-VALIDATION` already measured **ρ = 0.42** between ECG and PPG error terms, and this
  would drive it toward 1. Same reason the H10's onboard RR is barred as a fourth corner
  (*"error correlation ≈ 1"*). Selectors must be **intrinsic** (SNR, autocorrelation periodicity,
  perfusion, beat self-consistency). ECG is for **validation**, reported separately — characterising the
  sensor is science; picking the reading that matches is circular.
- **Do NOT reintroduce the wavelength/penetration-delay argument** — measured at 0 ms, §0.
- **Do NOT chase reflectance SpO₂ from these LEDs** — `MULTI-SENSOR-DERIVATIONS §4` already ruled it out,
  and §0 confirms there is no second wavelength to work with.
- **Do NOT upgrade any badge because "the literature says."** The cited gains are motion-regime results
  on other hardware.

## 7 · Gates & release

Work in a **worktree** — this touches `ppgdex-dsp.js`, a DSP.

- `node tests/run-tests.mjs` + **`Dex-Test-Suite.html?full`** all-green (check `sameOriginStatus().bootSkips`).
- `node tools/build.mjs --app PpgDex` then `--check`; `verify-provenance.html` GATE A/B clean.
- **This is NOT export-inert.** Ambient subtraction and fusion both move the waveform → move feet → move
  PPI → move HRV → **move every PpgDex export**. `computeHash` **will** move. Per `CLAUDE.md` §🔒 that
  must be **computed and reported, never asserted**: regenerate the PpgDex fixtures by re-running the app
  and re-exporting (a PpgDex regen tool may need writing — copy `tools/regen-pulsedex-goldens.mjs`), then
  re-verify with `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`.
- Changeset: `bump: patch` (fixes/improves without changing a contract shape) — the export **shape** is
  unchanged; §5's per-channel fields are additive, so if they ship in the same unit use `minor`.

**New gates owed** (both-direction verified — a gate that does not fail without its fix is hollow, per
`TEST-AUDIT-FINDINGS`):
1. Identical channels ⇒ `singleChannel === true` and `ledAgreementPct === null` (never 100).
2. Three **independent** noise channels ⇒ agreement collapses and spurious beats are dropped (pins that
   consensus still works after fusion lands).
3. Fusion weights on a known 3-channel synthetic ⇒ all three non-zero, and the fused SNR ≥ the best
   single channel's.
4. Ambient subtraction is actually applied (a synthetic with a large ambient step must not move HR).

## 8 · Done when

Ambient is subtracted; the fused waveform replaces the mid-90 s channel pick as the foot-timing
reference; consensus still gates beat presence; identical channels report `null` not 100 %; per-channel
diagnostics + spread ship with a precision-only label; all four new gates pass **and fail without their
fix**; PpgDex re-bundled with `computeHash` movement computed and fixtures re-verified against the real
corpus; both lanes green; changeset dropped. Then flip this header to `DONE — <date>` and spawn
`-FOLLOWUPS` (or record that nothing surfaced).

**Measure and record on execution:** the HRV delta from ambient subtraction alone, and from fusion, on
the trio corpus. If fusion moves overnight-rest HRV by less than the night-to-night spread, **say so** —
a negative result here is a legitimate finding, not a failure (`papers/dead-ends.html` is the precedent).

---

## Cross-references
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — the single-channel finger half; §4's guard is what lets it report honestly.
- [`ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md`](ENGINE-VERIFICATION-FINDINGS-2026-07-18-BRIEF.md) — §1.3 (fabricated `ledAgreementPct: 100`), closed at the DSP tier by §4 here.
- [`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md`](PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md) — the detector this builds on (its cadence-sized refractory stays).
- [`INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md`](INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md) — why the 3-channel spread must never become a σ.
- [`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`](LITERATURE-USE-POLICY-2026-07-11-BRIEF.md) — how [L18]/[L20]/[M24]/[W16] may enter the code.
- PR #218 (`fix(motiondex,ppgdex): resolve PSL columns by header, not by position`) — header-driven column resolution; the precedent this brief's guard must not contradict, and the source of the shifted-shape case in §4.
- `CLAUDE.md` §🎫 badges · §🔒 export-inertness is computed · §🧪/§🔏 gates · §👥 worktree.
- Code: `ppgdex-dsp.js` (`parsePPG:155`, `channelSNR:263`, `pickChannel:276`, `orient:292`, `consensusBeats:540`, `analyze:1533`), `ppgdex-registry.js`, `ppgdex-morph.js`.
