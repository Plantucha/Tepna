<!--
  PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-27 · **Owner-issued charter** (direct, 2026-08-27 evening — condensed capture in the Appendix; original in the coordinator transcript) · **Interlocks:** `PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md` (DONE), `CLOCK-LEG-SIGN-CONTRADICTION-2026-08-27-BRIEF.md` (DONE), `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md`, `PAT-NO-VALID-ANCHOR` lineage, `O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF.md`

# PAT root-cause forensics — why PAT fails, from source and data

> **The charter in one line:** do not make PAT pass — determine, from actual source, real
> recordings, and oracle experiments, which of twelve candidate failure mechanisms actually
> dominate, with each labeled SOFTWARE BUG / ENGINEERING LIMITATION / FUNDAMENTAL LIMIT, ending
> in a quantitative error budget and one evidence-backed recommendation. "PAT cannot reliably
> meet the criterion with these devices" is an explicitly acceptable outcome.

## 0 · 🔴 THE EVIDENCE MAP — what this fleet has ALREADY MEASURED, by charter section

The charter forbids relying on prior conclusions *alone*; it does not require re-deriving proven
ground. Every row below is a measured result with its artifact — the investigation VERIFIES these
against current source where load-bearing, and spends its new effort on the genuinely open cells
(the oracle experiments §11–13, the fiducial-family comparison §7, the error budget §21D).

| charter § | already measured | artifact |
|---|---|---|
| §3/§5 (PPG axis) | **The Wellue finger-PPG axis is DRAWN on every stream measured (20/20)** — inter-sample deltas concentrate ≥99 % on one value: `sample_index × assumed rate`, carrying no independent timing. The O2Ring's *sensor timestamp* is synthesized; `quality.timingSource` computes provenance. | KNOWN-CLOCK-FOLLOWUPS §3; memory `o2ring-timestamp-is-drawn`; CLAUDE.md §🔒.7 |
| §3/§5 | The O2Ring emits **exactly 126 PPG samples/status-frame on average (124–128 steady-state)**; the two streams are ONE clock (ratio is a hardware constant — no ppm recoverable by comparing them); sample loss is countable, not inferred; the Δduration counter is ±1 s quantized and was misread as loss THREE times. | O2RING-FRAME-SAMPLE-LOCK brief (REFERENCE) |
| §3/§5 | The O2Ring **device-crystal PPG axis is ECG-validated ≈host** (opt-in path exists); and the ring holds **sub-ppm flat for hours, then degrades ~12.5 s/h after the first BLE dropout** — divergence is the LINK, not the crystal. | memory `o2ring-crystal-timebase-validated`; CLAUDE.md §🔒.7 |
| §4 (common timebase) | **Every raw night in the corpus is phone-captured with NO second clock** — host-column spread 0.13–1.00 ms = the device stamp rounded; `hostAxis.independent` computes this. Box captures (spread 101 ms–5.1 s) are the only nights with two real clocks. H10↔Verity offset: ~3.3 s phone nights, ~0.2 s box nights. | memories `raw-corpus-is-all-phone-captured`, `wearable-clocks-diverge`; `hostAxis` contract |
| §4 (beat-level uncertainty) | **Per-connection BLE offset drift: median 43.8 ms · p90 142.9 · max 815.6 (26 % beyond ±90 ms)** — but the dip detector's exposure is per-BASELINE-WINDOW: **median 1.18 ms, p90 9.37, max 47.16 over 60 s** against Θ=10 ms. The claim "cancels exactly" is falsified; the *exposure-window* number is the one PAT actually eats. n=31 connections, 14 nights. | #1879/#1880 (2026-08-27); memory `compare-rates-through-uncertainties` (exposure-window corollary) |
| §4/§14 (ramp vs step) | **Ramp-vs-step is IDENTIFIABILITY-limited, not sample-limited**: lag = BLE offset + true PAT with no independent handle within a connection; persistence classification carries ZERO information (count-matched null control, ratios 0.96–1.08 across ten pre-registered cells); more nights cannot fix it — only a second, offset-only observable can. Written beside the bound in `pat-align.js`. | #1884/#1885 (2026-08-27); memory `defined-is-not-informative` |
| §7 (foot uncertainty, partial) | **Every PAT SD previously reported measured the 450 ms PHYS WINDOW, not the physiology** — 450/√12 = 129.9 ms; the statistic was the window's own variance. Any §7 result must clear this artifact first. | memory `pat-sd-is-the-window` |
| §9 (one-RR hypothesis) | **Beat-time matching pins a clock offset only MOD ONE HEARTBEAT** — recorded as the reason beat trains cannot anchor absolute alignment; §9's secondary-modes experiment is the quantitative form of this known ambiguity. | memory `beat-trains-align-only-mod-rr` |
| §10 (independent alignment) | **The buzz fiducial is pairwise-proven: 5/5 in H10 ACC and 5/5 in Verity ACC** on the pairwise night — an independent shared event usable for offset(t) without touching PAT. The O2Ring buzz (0x83) exists as an actuator. | memory `buzz-fiducial-pairwise-proven`; `o2ring-rtc-is-readable` |
| §16 (gate self-selection) | **The PAT gate's passes ANTI-CORRELATE with test power** (dispersion-derived inclusion prefers the worst-measured items); the corpus cannot gate the PAT re-test — a negative at full strength. Third instance of the anti-selection law logged the same week (fused-solve survivorship). | clock-closure gate work (Papers, 2026-08-27); memory `uncertainty-band-as-gate-anti-selects` |
| §15 (PEP) | PAT-RELATIVE-REFRAME's premise: the quantity is R→peripheral-foot **PAT**, PEP-contaminated by construction; the reframe brief (now DONE) carries the relative-not-absolute framing. §15's naming ruling remains open. | PAT-RELATIVE-REFRAME (DONE 2026-08-27) |
| §2 (pipeline hazards) | `pat-align.js:335`'s comment corrected (#1880); `pat-connection-stability.mjs` measures per-connection drift; the 440-sidecar capture-host corpus (40 nights) is the population, not `uploads/captures` (6). | #1879/#1880; memory `corpora-live-on-the-box` |

**What is genuinely NEW in this charter** — where the investigation's effort goes:
- §2's full source-trace diagram (no prior artifact traces raw-BLE→gate end to end in one place).
- §6 ECG R-fiducial jitter measurement (no prior number).
- §7's fiducial-family comparison on real pulses (minimum vs max-derivative vs tangent vs
  fractional-upstroke…) and the clean-pulse beat-to-beat foot variability — THE most likely
  fundamental-limit cell, per the charter.
- §8's independent pairing audit and §9's secondary-mode quantification (the mod-RR memory says
  it exists; nobody has counted its share of variance).
- §11–13's **oracle replays** (perfect clock / perfect beats / perfect feet) — the
  layer-isolation instrument the program has never had.
- §17's per-night machine-readable corpus table and §18's root-cause matrix.
- §21D's combined error budget with correlation structure.

## 1 · Lanes and sequencing

- **Lead: Papers** (owns every interlocked thread, the identifiability result, and the gate
  anti-selection finding). Phase order: (a) §2 source trace + §3 timing-field classification
  table (source-verifying the Evidence Map rows they touch); (b) §7 fiducial family + §6 R-jitter
  on clean segments; (c) §8/§9 pairing audit with the mod-RR mode test; (d) §11–13 oracles;
  (e) §17 corpus table; (f) §14/§15/§16 synthesis; (g) §18/§21 deliverables.
- **Support: Vigil box** (capture-host timing code §3, O2Ring axis internals §5, and the §10
  buzz-fiducial replay if a new capture is needed — Thursday's attended session).
- Oracle experiments are **new tools under `tools/`**, reproducible, never edits to production
  detectors; per the charter, diagnostics may be added, algorithms may not be changed.
- Every gate/threshold decision inside the investigation carries a **closed pre-stated band**
  (no gaps — the band-gap lesson is a day old).

## 2 · Done when

- [ ] §2 trace diagram with actual file:function names, committed.
- [ ] §3 classification table: every timing field MEASURED/DEVICE-DERIVED/HOST-MEASURED/
      INTERPOLATED/RECONSTRUCTED/SYNTHETIC/UNKNOWN, source-cited.
- [ ] §6 + §7 fiducial uncertainties in ms, with the PHYS-window artifact excluded by
      construction.
- [ ] §8/§9 pairing-error frequency + mod-RR variance share.
- [ ] §11–13 oracle results, reproducible.
- [ ] §17 per-night table over the real corpus (box + phone nights labeled).
- [ ] §18 matrix + §21D error budget with correlation notes.
- [ ] §21G single recommendation, each conclusion labeled BUG / ENGINEERING / FUNDAMENTAL.
- [ ] Follow-up brief for whatever the investigation spawns.

---

## Appendix — the owner's charter (2026-08-27), condensed capture

*Faithful condensation; every section and constraint preserved; original in the coordinator
session transcript.*

**Primary question:** when Tepna rejects or produces unstable ECG→PPG PAT, what is the dominant
root cause — separated across: (1) clock/timestamp error · (2) cross-device sync/alignment ·
(3) PPG sample-axis reconstruction · (4) ECG R-peak timing · (5) PPG beat/foot timing ·
(6) ECG↔PPG pairing · (7) missing/extra beats · (8) motion/artifact · (9) placement/physiology ·
(10) PEP contamination (R→PPG is PAT, not pure PTT) · (11) statistical/gating design ·
(12) other implementation bug. Each: demonstrated / strongly supported / plausible-unproven /
ruled out. **§2**: trace the real pipeline (pat-feasibility-worker, pat-align, pat-gate,
ppgdex-dsp, ecgdex-dsp, clock.js, capture-host timing, relSec constructors, beat detectors,
pairer, stats, gates); produce the raw-BLE→gate diagram with actual names. **§3**: classify every
timing field (device vs host clock; sample/packet/record scope; resolution, oscillator,
monotonicity, steps, drift; reconstructed?) — MEASURED/DEVICE-DERIVED/HOST-MEASURED/INTERPOLATED/
RECONSTRUCTED/SYNTHETIC/UNKNOWN; find the actual calculation, never accept "host disciplined"
comments. **§4**: prove or refute a common timebase from real data (residuals, drift, spread,
jitter, quantization, steps, start/end offsets); answer THE ms-level instantaneous ECG↔PPG
uncertainty at the moment of a PAT measurement — not median drift. **§5**: the PPG axis as
first-class suspect (nominal vs inferred interval, packet timing, gap reconstruction, anchor
jumps; error accumulated over 1 s/10 s/1 min/10 min/night; can the axis resolve 10/20/50/100 ms
PAT changes?). **§6**: ECG R-peak timing uncertainty in ms (detector jitter, resolution,
interpolation, filter delay/edges, morphology, ectopy). **§7**: the PPG foot — what mathematical
feature defines it; compare fiducial families (minimum, max-derivative, tangent, %-upstroke,
second-derivative, onset, current); beat-to-beat variability on clean pulses; sensitivity to
amplitude/width/morphology/HR/motion/quality/filtering/channel; «even with a PERFECT clock, how
much uncertainty does the foot introduce?» — if 20–50 ms, achievable precision changes
fundamentally. **§8**: independent pairing audit (true pair vs Tepna's pair per beat; slips,
skips, duplicates, falses; the diagnostic table; error frequency; is PAT drift beat-index
drift?). **§9**: the one-RR hypothesis — secondary modes at PAT±RR/±2RR; variance share of beat
slips. **§10**: alignment WITHOUT PAT (independent shared events — motion, artifacts, markers);
compare independent offset(t) to PAT-derived alignment; disagreement ⇒ PAT cannot be the
alignment reference. **§11**: oracle 1 — replay real signals under a synthetic PERFECT common
clock; stable ⇒ clocks dominated; unstable ⇒ signal/physiology. **§12**: oracle 2 — perfect beat
labels (verified R peaks + corresponding feet), bypassing detectors/pairer. **§13**: oracle 3 —
real clocks/alignment/R-peaks + manually-reviewed feet only. **§14**: separate clock error from
physiological PAT variation (HR, respiration, BP-morphology, vasoconstriction, movement, stage);
decompose observed variance ≈ clock + fiducial + pairing + physiology + noise, strongest
defensible estimate. **§15**: PEP — R→foot is PAT not PTT; can interval changes plausibly be PEP
(HR dependence, autonomic, amplitude, morphology)? Rule on the honest name (PAT / ECG-to-
peripheral-arrival / proxy). Scientific validity, not code. **§16**: audit every gate
(200–650 ms window, coupling, IQR, drift, censoring, min-beats, missing-beat handling, window
selection) for self-selection — does it reject bad measurements or select a subset that LOOKS
good; window truncation of the distribution; always compare all-candidates vs window-accepted.
**§17**: run on the real corpus, per-night machine-readable summary (the 24-field row list),
cluster failures by mechanism, never average everything. **§18**: the root-cause matrix
(mechanism × evidence × magnitude × frequency × software-fixable × fundamental) in measured
numbers. **§19**: label every conclusion SOFTWARE BUG / ENGINEERING LIMITATION / FUNDAMENTAL
MEASUREMENT LIMITATION; never fix a fundamental limit with aggressive gating. **§20**: do not
optimize pass rate; "cannot meet the criterion with these devices" is a valid outcome; no
threshold tuning. **§21**: deliver (A) executive conclusion, (B) ranked root causes, (C) evidence
per conclusion (file/function, data, experiment, result, interpretation), (D) the quantitative
error budget with correlation structure, (E) the four oracle results, (F) the decision tree with
measurable tests per branch, (G) ONE recommendation from the eight listed, evidence-first.
**§22**: do not make PAT look better — make Tepna tell the truth; ugly results reported ugly;
the goal is whether a scientifically defensible ECG→peripheral-pulse timing measurement exists,
under what conditions, with what uncertainty.
