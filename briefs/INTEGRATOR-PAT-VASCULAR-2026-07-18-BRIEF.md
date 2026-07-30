<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (Phase 0 run 2026-07-29 — **NO-GO on COUPLING**, and the drift criterion is **unmeasurable with this instrument**; §1's premise that "the blocker moved" is refuted — single-host and phone-stamped capture are indistinguishable. Parked per §2's kill criterion; the coupler defect found on the way is fixed and gated. **Re-measured OFFSET-FREE 2026-07-29 — NO-GO stands and hardens: 0 of 54 pairings clear the gate, coupling unchanged at ~19 %, and the real limit is ~96 ms of beat-to-beat scatter while `halfDrift` passes 47/54, so drift was never the blocker.** See §2-RESULT then §2-RESULT-II) · **Created:** 2026-07-18

# Integrator: promote PAT/PTT into a beat-level Vascular (trend-only) fusion layer — dual-site, drift-gated

> **What this is.** An executable plan to lift the **already-built, already-validated** PAT engine
> (`PAT Feasibility.html` + `pat-feasibility.js`, the `ECGDSP`×`PPGDSP` beat-coupler shipped by the DONE
> [`PAT-FEASIBILITY-2026-07-08-BRIEF.md`](PAT-FEASIBILITY-2026-07-08-BRIEF.md)) **into the Integrator** as a
> real cross-node **pulse-arrival-time** stage — and to add the differentiator the single-tool spike could
> not: **dual-site PAT** (one R-peak → two peripheral feet), whose difference cancels the pre-ejection-period
> confound. **This does not invent PTT.** The timing math exists and works; the question this brief answers is
> whether the **new capture path** clears the bar the feasibility spike set, and if so, wires it in.

---

## 1 · Why now — the blocker moved, and the new capture path is its named unblock

`PAT-FEASIBILITY` (DONE) proved, on real data, that the obstacle to PAT is **not** the sensor — it is
**inter-device clock drift**. On **Polar Sensor Logger** phone-timestamped dumps the two device crystals
drift **~48 ppm** apart (~**1147 ms** across a night ≈ one whole cardiac cycle at ~50 bpm) — **~24× the
physiological PAT signal** — so absolute PAT is impossible and even a relative trend is swamped. Its ACC-tap
resync fallback **failed**. Its recorded verdict: **needs single-host synchronised capture** (unblock-path #1,
under [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md)) — *"when either lands,
re-run `PAT Feasibility.html`."*

**That path has now landed.** The Tepna daemon (`CAPTURE-HOST-FOLLOWUPS-II`) captures **H10 ECG · Verity PPG ·
O2Ring finger PPG** through **one host** on a **`CLOCK_MONOTONIC`-anchored** timeline — the single-host common
reference the feasibility brief named. So the correct next action is **exactly the step that brief scheduled**:
re-run the go/no-go gate on a Tepna-captured night. This brief is that re-run, plus the promotion it unlocks.

⚠️ **Not automatically solved — one honest caveat.** The three streams are **stamped differently**: PMD
(H10/Verity) carries a device-monotonic sensor timestamp; the O2Ring pleth is **host-arrival back-timed**
(`O2RING-LIVE-PPG-WAVEFORM` Phase 2 — the ring's own RTC free-runs +151 s and must not stamp the waveform). So
BLE-arrival **jitter** replaces crystal **drift** as the residual noise floor. Whether that floor is under the
bar is an **empirical question Phase 0 must answer**, not an assumption.

## 2 · Phase 0 — RE-RUN the go/no-go gate on a single-host night (do first; measurement, no new code)

Re-run the existing instrument (`PAT Feasibility.html`) on a **Tepna single-host** night, per pairing:
- **H10 R→O2Ring finger foot** and **H10 R→Verity wrist foot**, characterising each pairing's **baseline
  drift**, **coupling %**, and **beat-to-beat IQR** separately (the two feet are stamped differently, so their
  jitter floors differ).
- **The bar (verbatim from `PAT-FEASIBILITY`):** promote only if **drift ≤ 60 ms**, **coupling ≥ 55 %**,
  **beat-to-beat IQR ≤ 60 ms**. Below that → **FEASIBLE — provisional trend**.
- **Kill criterion:** if drift stays > 60 ms even single-host (i.e. the host-arrival jitter, not crystal
  drift, dominates), **park this brief PROPOSED with the number inline** and route the fix to the
  SDK-synchronised-timestamp path (`POLAR-SDK-CAPTURE`). Do **not** ship a Vascular panel on a failed gate —
  that is the exact discipline the feasibility brief enforced.

## 2-RESULT · Phase 0 EXECUTED 2026-07-29 — NO-GO, and not for the reason the gate reported

Run with the shipped coupler over **both** corpora, pairing on true temporal overlap, per site,
never pooled.

### The gate, as measured

| corpus | pairing | n | drift | coupling | beat IQR | clears the bar |
|---|---|---|---|---|---|---|
| single-host (capture-host daemon) | H10→Verity wrist | 13 | 420.8 ms | **21.5 %** | 42.7 ms | 0/13 |
| single-host | H10→O2Ring finger | 11 | 379.2 ms | **15.4 %** | 42.2 ms | 0/11 |
| phone-stamped (Polar Sensor Logger) | H10→Verity wrist | 28 | 429.9 ms | **26.7 %** | 42.8 ms | 0/28 |

**Beat-to-beat IQR PASSES everywhere** (~43 ms against a 60 ms bar). **Coupling fails everywhere**
(15–27 % against 55 %). That is the honest verdict: PAT does not couple reliably on this data.

### Three findings that change what this brief says

**1 · The gate's drift criterion is not measurable with this instrument.** `driftRange` never measured
inter-device clock drift. Before the fix below it measured **beat-slip**: drift/RR clustered at
0.85–0.98 across 24 pairings and the per-bin medians were bimodal exactly one RR apart, while
`residIQR` stayed at 8–45 ms. A night cannot carry 8 ms of beat-to-beat scatter and 1058 ms of genuine
clock wander (2026-07-19 wrist: 87 % coupling, 8.0 ms IQR, 1058 ms "drift"). After the fix it measures
~420 ms ≈ the width of the 450 ms physiological window, because under low coupling the accepted lags
scatter across it. **In neither configuration is it drift.** Any future gate must estimate drift from
something else — the anchor aligner in `pat-align.js` is the candidate.

**2 · §1's premise is refuted: the blocker did NOT move.** After the fix, single-host and
phone-stamped capture are **statistically indistinguishable** (drift 420.8 vs 429.9 ms; coupling 21.5
vs 26.7 %; IQR 42.7 vs 42.8 ms). The capture path was never the limiting factor, so §2's kill-criterion
routing to `POLAR-SDK-CAPTURE` — premised on host-arrival jitter dominating — **would not help**.
Better timestamps cannot fix a coupling rate this low. The limiting factor is upstream: peripheral foot
detection, and/or whether this subject's PAT sits inside 200–650 ms at these two sites at all
(`inPhysPct` is 100 % *by construction* once the window is enforced, so it is no longer evidence).

**3 · `PAT-FEASIBILITY`'s recorded no-go was mis-attributed.** That brief (DONE) reported "~48 ppm →
**~1147 ms** across a night" as *crystal drift*, and everything since — including this brief's
existence — rests on it. 1147 ms is **one RR interval** at ~50 bpm, and the phone-stamped corpus
reproduces the same ~430 ms window-width signature as the single-host one once slip is removed. The
number was real; calling it crystal drift was not. That does not un-DONE the feasibility work, but its
*cause* attribution should be corrected rather than inherited.

### The coupler defect, fixed and gated

`coupledPAT` accepted the first foot with `lag >= 0` inside a **2000 ms** search span while declaring a
200–650 ms physiological window that only ever fed a display diagnostic (`inPhysPct`). 2000 ms exceeds
one RR, so a missed foot let the **next** beat's foot be accepted as this beat's PAT. Now extracted to
`pat-align.js` as `coupleRtoFoot` with the window **enforced**, which makes slip structurally
impossible (`PHYS_HI` < 1 RR) and makes `matchRate` report real coupling instead of a trivially high
number. 16 gated assertions, including a mutation control that re-opens the window past 1 RR and
demonstrates the slip returning — and pinning the detail that let this survive in production: the
**IQR does not move at all** under slip (10 outliers in 60 beats cannot shift a quartile), which is
why the metric beside `driftRange` looked healthy the whole time.

### What must happen before this brief can be reconsidered

- Establish why coupling is 15–27 %: is the foot detector missing beats, or is the true PAT outside
  200–650 ms for these sites on this subject? That is a **measurement**, not a build.
  **→ MEASURED, §2-RESULT-II.1: neither, in the simple form. Feet are plentiful (median feet/R = 0.99)
  and the window IS mis-centred, but re-centring it does not rescue coupling.**
- Replace `driftRange` with an estimator that actually measures drift (anchor-based; `pat-align.js`).
  **→ MEASURED, §2-RESULT-II.2: replaced by `halfDrift`, which PASSES 47/54. Drift was never the
  blocker — a third independent confirmation.**
- Only then re-evaluate the bar. **No Vascular panel is built on the current numbers** — §4's
  discipline holds. **→ Re-evaluated in §2-RESULT-II. The NO-GO stands and hardens.**

---

## 2-RESULT-II · Phase 0 re-measured OFFSET-FREE, 2026-07-29 — still NO-GO, cause now located

§2-RESULT closed with two open **measurements**, not builds. Both are now done, and together they move
the NO-GO from "coupling is low, we don't know why" to a located cause.

**Why re-measure at all.** The absolute 200–650 ms window assumes the two clocks agree to within the
physiological range. Several nights show a *tight* lag distribution sitting at a *different centre*
each night, so beats were being rejected for the offset rather than for implausible physiology. And
this brief only ever wanted a **trend** (§4: "a Vascular trend only — NEVER an absolute BP number") —
a trend does not need the absolute offset. It needs the lag to be **stable** and its **changes** real.
So the honest gate is offset-free.

### II.1 · Dropout is refuted; the window is mis-centred; neither explains the failure

Two candidate causes with opposite fixes, so guessing was not an option. Unconstrained nearest-foot
lags, restricted to the overlap, 54 pairings:

| diagnostic | measured | reading |
|---|---|---|
| `feet/R` (PPG feet per ECG R-peak) | median **0.99**, **52/54 ≥ 0.95** (min 0.73, 2026-06-13) | **net dropout REFUTED** — the PPG yields ~one foot per beat |
| `inWin%` (lags inside 200–650 ms) | median **36.6 %**, range 0.0–64.4 | the window admits only ~a third |
| lag distribution within a night | p10 ~100–150 · median ~550–800 · p90 ~1000–1200 | ~**1000 ms** of spread ≈ **one RR** |
| per-night lag centre | **171.9 ms** (2026-06-14) → **1171.1 ms** (2026-06-18) | the centre moves 7× between nights |

Some nights are narrow *but* offset — 2026-07-28 wrist spans p10 555 → p90 874 (319 ms) centred at
**715**; 2026-07-03 spans 763 → 1092 centred at **956**; 2026-07-08 sits at **942**; 2026-06-14 at
**172**, below the window. So the window genuinely is mis-centred. That was worth removing.

### II.2 · The offset-free gate — same bars, honest metrics

`modalLag` = the night's median nearest-foot lag (offset and true PAT conflated, deliberately) ·
`couplingStable` = fraction of beats within **±100 ms** of `modalLag` · `residIQR` = IQR of
(lag − modalLag) over those beats · **`halfDrift`** = |median(2nd half) − median(1st half)|, a real
wander measurement that replaces the discredited `driftRange` and is immune to both beat-slip and
window placement.

| corpus | pairing | n | coupling (≥55 %) | residIQR (≤60 ms) | halfDrift (≤60 ms) | clears the bar |
|---|---|---|---|---|---|---|
| single-host | H10→Verity wrist | 13 | **18.8 %** | **96.9 ms** | 26.9 ms | 0/13 |
| single-host | H10→O2Ring finger | 11 | **19.2 %** | **98.7 ms** | 12.6 ms | 0/11 |
| phone-stamped | H10→Verity wrist | 30 | **19.0 %** | **95.6 ms** | 21.1 ms | 0/30 |

**0 of 54 pairings clear the gate.** And the near-misses are the informative part, because they fail on
**disjoint** criteria — no night is close on both at once:

- clears **coupling ≥ 55 %**: exactly **2** — 2026-06-14 (56.0 %) and 2026-07-08 (55.9 %) — and both
  fail `residIQR` badly (90.8, 87.8 ms).
- clears **residIQR ≤ 60 ms**: exactly **2** — 2026-07-19 (44.6 ms) and 2026-07-10 (54.7 ms) — and both
  fail coupling (51.0 %, 40.9 %). 2026-07-19 is the single closest night in the corpus and misses by
  **4 percentage points of coupling** while passing both other bars.
- clears **halfDrift ≤ 60 ms**: **47/54 (87 %)**, median **19.7 ms**, and **20/54 under 10 ms**.

### II.3 · What this settles

1. **Drift was never the blocker — confirmed a third independent way, and now quantified.** `halfDrift`
   passes 47/54 with a 19.7 ms median. Converting each night's wander into an implied inter-device rate
   (halfDrift ÷ half the overlap) puts it at a **1.46 ppm** median on the 27 nights ≥ 240 min (max 8.6),
   and **excludes `PAT-FEASIBILITY`'s 47.7 ppm on 51 of 54 pairings**. The implied rate moreover *falls*
   as nights lengthen (`r(overlap, ppm) = −0.54`) — the signature of a metric hitting its own noise floor
   on short recordings, not of a fixed rate. A real 48 ppm offset cannot hide on a 7 h night.
2. **Removing the offset does NOT rescue coupling.** It stays at ~19 % (18.8 / 19.2 / 19.0) — statistically
   identical to the windowed run's 21.5 / 15.4 / 26.7 %. The mis-centred window was real and was *not*
   the cause.
3. **The limit is beat-to-beat scatter.** `residIQR` ≈ **96 ms** against a 60 ms bar, measured against
   each night's *own* modal lag, so it is offset-free by construction. The R→foot interval is stable in
   its centre and loose in its detail — the opposite of what PAT needs.
4. **§1's premise is refuted a second way, and the single-host leg is a GENUINE test of the remedy.**
   Single-host 18.8 % vs phone-stamped 19.0 % — indistinguishable offset-free, exactly as windowed. The
   single-host path is not merely "a different app"; it removes the clock term three ways at once:
   - `capture-host` **sets both device clocks from the host on every connect** (`time.auto_sync_devices`,
     default **True** — `settings_schema.py:24`, applied at `capture.py:960`, skew logged per sync).
   - The host clock itself is **chrony-disciplined against a LOCAL stratum-1** — 5.9 µs offset, **0.008 ppm**
     residual, 0.027 ppm skew (measured on the box 2026-07-29).
   - Captures are written as **fragments re-anchored to the host clock at each first row**; across 858
     measured fragments the median is **3.0 min**. So either crystal free-runs for minutes, never a night.

   Consequence: accumulated inter-device drift is **structurally capped at 8.6 ms even granting
   `PAT-FEASIBILITY`'s 47.7 ppm** (0.3 ms at the measured 1.46 ppm) — negligible against a 200–650 ms window.
   **Even if the 48 ppm claim were entirely true, this corpus could not express it**, and coupling is still
   18.8 %. `POLAR-SDK-CAPTURE` is therefore **applied-and-unhelpful**, not merely unnecessary.

   One nuance to carry forward: the host writes the **device** counter (`sensor timestamp [ns]`) as the
   sample clock and its own stamp only as an **arrival** time — deliberately, since arrival stamping inherits
   BLE burst jitter and steps backwards on 0.5–0.8 % of rows (`capture-host/writers.py`). The correct
   architecture is a precise *device* counter repeatedly re-referenced to a disciplined host, **not** stamping
   every sample at the host. Also note device clock discipline is imperfect in practice — the host logs the
   Verity at −5.0 s and once uncorrectable after 3 re-syncs, and the H10 (which implements no read-back) once
   at −239,071,318 s. That does not touch this analysis, which uses per-fragment **differences**, so an epoch
   error cancels — but it means **absolute** device time on these sensors is unusable and only **relative**
   sample timing is sound.

### II.4 · The one ambiguity this run does NOT resolve — and it matters

A lag component of **one whole RR** is **indistinguishable from a one-beat slip** by any of these
statistics. So the per-night `modalLag` (172–1171 ms) must **not** be read as a measured inter-device
offset: a night centred at 942 ms may be a genuine 942 ms offset or a correctly-centred PAT plus one
skipped beat, and nothing here separates them.

Relatedly, **`feet/R` ≈ 1.0 refutes NET dropout but not local insertion/deletion pairs** — a missed foot
here and a spurious foot there preserve the ratio while destroying beat correspondence, and would produce
exactly the observed signature: plentiful feet, ~1 RR of lag spread, ~96 ms residual scatter. **That is
the next measurement** if this brief is ever revived: audit beat *correspondence* directly (monotone
one-to-one R↔foot assignment, counting insertions and deletions), not foot *counts*. Until then,
"the PPG foot detector is adequate" is not established — only "it produces about the right number of feet".

### Verdict

**The NO-GO stands and hardens.** Both remediation paths §2-RESULT named have now been measured and
neither rescues the gate: drift was never the problem, and the mis-centred window was real but not
causal. No Vascular panel is built. `pat-align.js` and its 16 gated assertions stay — they are correct,
reusable, and they earned their keep by falsifying two prior attributions — but the Phase 1–3 build
below remains **unstarted by design**.

*(Reproduce: the offset-free gate and the cause diagnostic are the two throwaway harnesses described
above; they load the real `ECGDSP`/`PPGDSP`/`PATAlign` in a co-loaded realm and read the corpus
read-only. Cf. `tools/acc-acc-control.mjs`, which is the same pattern committed, for
`CROSS-DEVICE-CLOCK-SKEW` §2c.)*

---

## 3 · Phase 1 — promote the coupler into the Integrator (consume EXPORTS, add the missing one)

- **Move the timing engine** `coupledPAT`/`ecgRpeakTimes`/`ppgFootTimes`/`sharedClock` from
  `pat-feasibility.js` into an `integrator-dsp.js` PAT stage. The Integrator fuses on the shared wall-clock;
  this adds a **beat-level** stage beside its event/scalar fusion.
- **Feed it from node exports, not private calls.** Today ECGDex's `ganglior_events` carry only
  `autonomic_surge` — the **per-beat R-peak series is computed (`ECGDSP.detectPeaks`) but not exported**. Add an
  **R-peak time series to the ECGDex node-export** (additive field; the `{tsMs, rr}` `deviceRR` stream already
  exists internally at `ecgdex-dsp.js:373` — surface it). PpgDex feet come from the wrist site today and the
  **finger site** via [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md)
  (its prerequisite). All three nodes already emit absolute floating `tMs` (contract in `dex-contracts.js`).

## 4 · Phase 2 — dual-site PAT (the differentiator) + what may and may NOT be surfaced

- **Single-site PAT** = foot − R-peak, per site. **PAT = PEP + PTT** — it carries the pre-ejection-period, a
  BP-independent confound.
- **Dual-site PAT** = (H10→finger) − (H10→wrist): the **shared PEP cancels**, leaving a cleaner **peripheral
  pulse-transit** term. This is the two-site advantage the O2Ring finger site newly makes possible.
- **Surface a Vascular *trend* only — NEVER an absolute BP number.** Evidence tier **experimental**
  (trend), and BP explicitly **out of scope** at any tier without a per-subject cuff calibration: the largest
  validation (n=3077) shows cuffless SBP **degrades badly in older/hypertensive users** and calibration-free is
  not ready (Liu 2023). A relative overnight PAT/stiffness trend is defensible; a mmHg readout is fabricated
  authority (`LITERATURE-USE-POLICY` — no badge upgrade on "the literature says").

## 5 · Phase 3 — validate on the tri-device corpus + surface

- **Corpus:** the real **20-night O2Ring + H10 + Verity** set (`CLAUDE.md` §🎙️) is the ground truth — check the
  promoted engine's per-night drift/coupling against Phase-0 numbers before any surfaced metric.
- **Surface:** an Integrator **Vascular (trend)** panel — nightly PAT/dual-PAT trend + a stiffness-trend proxy,
  every number badged **experimental**, with the drift/coupling QC shown (a night that fails the gate shows
  **no** vascular metric, not a fabricated one).
- **Gates:** Integrator is an **owned** bundle (`tools/build.mjs --check` covers it); if the ECGDex export
  changes, **re-bundle ECGDex** → **GATE A/B**, its equiv leg regenerated by re-running the app (never
  hand-edited), **`Dex-Test-Suite.html?full`** green, **changeset** (`bump: minor` — additive export field +
  new fusion stage; no contract break).

## 6 · Method sources (literature — attribution mandatory, `LITERATURE-USE-POLICY`)

Used as **method/priors**, cited; none is networked into a bundle; none upgrades a badge to `validated`.
- PAT/PTT→BP needs per-subject calibration; PPG-intensity-ratio adds value — *Ding et al. 2017, Scientific Reports*; *Ganti et al. 2020, IEEE JBHI (SeismoWatch)*.
- Dual-PPG / 2PPG cuffless design (two peripheral sites) — *Wong et al. 2024, Comput. Methods Programs Biomed.*
- Calibration-free cuffless BP degrades in older/hypertensive at scale (n=3077) — *Liu et al. 2023, IEEE JBHI*.
- PPG morphology → vascular age / arterial stiffness (single-signal indices) — *Charlton et al. 2021, Am. J. Physiol. Heart Circ. (VascAgeNet review)*; *Pilt et al. 2014, Physiol. Meas.*
- (DOIs to be filled at author time from the citation — do not fabricate; attribution + journal + year stand.)

## 7 · Done when

Phase 0 re-run on a single-host Tepna night is recorded (pass **or** documented no-go with the drift number);
**if pass** — the coupler runs inside the Integrator off node exports (ECGDex R-peak series added), dual-site
PAT computes and its PEP-cancellation is demonstrated, a Vascular **trend** panel surfaces **experimental**-
badged with QC gating (no metric on a failed night, no BP number ever), corpus-checked, bundles re-built with
GATE A/B + full suite green + changeset. Then flip this header `DONE` and spawn `-FOLLOWUPS`. **If no-go** —
park PROPOSED with the number inline.

**OUTCOME: no-go, parked.** The `POLAR-SDK-CAPTURE` routing this line originally prescribed is **withdrawn,
not pending** — it has effectively already been run. The single-host path sets both device clocks from a host
held to **0.008 ppm** against a local stratum-1 and re-anchors every ~3.0 min fragment, capping accumulated
inter-device drift at **8.6 ms even granting the 47.7 ppm premise** — and coupling is still 18.8 % vs 19.0 %
(§2-RESULT-II.3 item 4). The clock term is both measured small (~1.5 ppm, item 1) *and* structurally bounded,
and PAT does not couple either way. Reviving the brief requires the beat-correspondence audit of
§2-RESULT-II.4, not a capture change.

---

## Cross-references
- [`PAT-FEASIBILITY-2026-07-08-BRIEF.md`](PAT-FEASIBILITY-2026-07-08-BRIEF.md) — the DONE feasibility this promotes; its go/no-go bar + instrument are reused verbatim.
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — **prerequisite**: produces the finger foot-stream the dual-site leg consumes.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — captures the finger pleth (host-arrival back-timing — the jitter caveat's source).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — the SDK-synchronised-timestamp fallback if Phase 0 fails the drift bar.
- [`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md) — routes PAT here; [`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`](LITERATURE-USE-POLICY-2026-07-11-BRIEF.md) — the attribution/tier rules.
- `ECGDex-BUILD-BRIEF.md` §6 (vascular-metric verdicts) · `INTEGRATOR-BUILD-BRIEF.md` · `CLAUDE.md` §🔒 Clock Contract · §🎫 badges · §🧪/§🔏 gates.
- Code: `pat-feasibility.js` / `pat-feasibility-worker.js` / `PAT Feasibility.html`; `integrator-dsp.js`; `ecgdex-dsp.js` (`detectPeaks`, `deviceRR`); `dex-contracts.js`.
