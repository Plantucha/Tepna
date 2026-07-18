<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-18

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
