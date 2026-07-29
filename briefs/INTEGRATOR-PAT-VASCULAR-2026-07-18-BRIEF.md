<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (Phase 0 run 2026-07-29 — **NO-GO on COUPLING**, and the drift criterion is **unmeasurable with this instrument**; §1's premise that "the blocker moved" is refuted — single-host and phone-stamped capture are indistinguishable. Parked per §2's kill criterion; the coupler defect found on the way is fixed and gated. See §2-RESULT) · **Created:** 2026-07-18

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
- Replace `driftRange` with an estimator that actually measures drift (anchor-based; `pat-align.js`).
- Only then re-evaluate the bar. **No Vascular panel is built on the current numbers** — §4's
  discipline holds.

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
park PROPOSED with the number inline, routed to `POLAR-SDK-CAPTURE`.

---

## Cross-references
- [`PAT-FEASIBILITY-2026-07-08-BRIEF.md`](PAT-FEASIBILITY-2026-07-08-BRIEF.md) — the DONE feasibility this promotes; its go/no-go bar + instrument are reused verbatim.
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — **prerequisite**: produces the finger foot-stream the dual-site leg consumes.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — captures the finger pleth (host-arrival back-timing — the jitter caveat's source).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — the SDK-synchronised-timestamp fallback if Phase 0 fails the drift bar.
- [`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md) — routes PAT here; [`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`](LITERATURE-USE-POLICY-2026-07-11-BRIEF.md) — the attribution/tier rules.
- `ECGDex-BUILD-BRIEF.md` §6 (vascular-metric verdicts) · `INTEGRATOR-BUILD-BRIEF.md` · `CLAUDE.md` §🔒 Clock Contract · §🎫 badges · §🧪/§🔏 gates.
- Code: `pat-feasibility.js` / `pat-feasibility-worker.js` / `PAT Feasibility.html`; `integrator-dsp.js`; `ecgdex-dsp.js` (`detectPeaks`, `deviceRR`); `dex-contracts.js`.
