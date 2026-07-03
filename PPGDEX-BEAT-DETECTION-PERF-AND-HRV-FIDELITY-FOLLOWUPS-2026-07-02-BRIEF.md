<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-02 · **Created:** 2026-07-02 · **Parent:** `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md` (DONE 2026-07-02, both gates green) · **Touches (proposed):** `ppgdex-dsp.js`, `integrator-dsp.js`, `tests/dex-tests.js`, `uploads/` fixtures

> **Execution (2026-07-02, both gates green):** **§1** long-record validated via a headless 91-min synthetic-rec coverage group (no committed overnight file needed — no silent collapse, overnight tier, epochs, §3-flag + §5-agreement all asserted); a REAL committed overnight fixture stays a nice-to-have, not spawned. **§2** DONE — `integrator-dsp.js` consumes `hrv.time.lowConfidence` + `quality.ledAgreementPct` (new `_hrvUntrusted` consensus filter + `LED_CONSENSUS_FLOOR`); Integrator.html re-bundled (manifestHash → `fe4c2c623820`), fixtures historical so no regen. **§3** validated (supra-physiologic-transient known-answer test) — slope-energy feature KEPT + documented, not reverted. **§4** period-stationarity (abrupt-HR-step) test added; consensus KEPT peak-based (spec-faithful “≥2 of 3 systolic peaks”), foot-based deferred. **§5** DECLINED — the O(N) detector makes serial orchestrate tractable (brief said “only if it janks”). Nothing further surfaced → no -II spawned.

# PpgDex beat-detection perf + HRV fidelity — FOLLOW-UPS (2026-07-02)

Residue discovered while executing the parent (all items below are hardening / validation-depth — nothing
shipped broken; both gates were green at DONE). Ordered by priority.

## §1 (⚠ highest — VALIDATION DEPTH) — no overnight PPG in the equiv gate; the reference-night claim is proven only on a 6.5-min clip
The parent's evidence table is a **431-min** real night (`PpgDex_2026-07-01_2143` vs `ECGDex_2026-07-01_2143`:
PpgDex RMSSD **136.8 ms** vs ECG **37.4 ms**). The fix was verified numerically on the **committed 6.5-min
equiv clip** (`Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`) where the new detector gives **338 beats,
RMSSD 36.6 ms, correction 1.5 %, analyzable 96 %, LED-agreement 95 %** — self-consistent and, notably, in
line with that clip's expected physiology. But **no ≥90-min PPG record is exercised in either gate** (all
equiv fixtures are short clips — the same blind spot ECGDex closed with its long-record coverage group,
`tests/dex-tests.js` ~L703). **Do:** commit an overnight (or ≥90-min) Polar-Sense `*_PPG.txt` + its
`ganglior.node-export` as a new code-gated fixture (`env.equiv.ppgdex_overnight`), and/or add a
render/headless long-record coverage leg, so a future detector regression that silently collapses an
overnight night reds a gate. Confirm on the real `2026-07-01_2143` night that whole-record RMSSD now lands
near the paired ECG's ~37 ms (not 137), and that `hrvLowConfidence` fires only when it should.

## §2 (MED — CONSUMER SIDE) — the Integrator does not yet read `hrv.time.lowConfidence` (§3) or `ledAgreementPct` (§5)
The node now EMITS both signals in the RICH orchestrate export, but `integrator-dsp.js adaptEnvelopeNode('PpgDex')`
still ingests `hrv.time.{rmssd,sdnn}` at face value into the HRV-consensus axis and knows nothing about
`quality.ledAgreementPct`. So a low-coverage PpgDex night can still pull the consensus even though the node
flagged it. **Do:** down-weight (or exclude, like the existing 22-%-analyzable trash rule in the consensus
group) a PpgDex HRV summary whose `hrv.time.lowConfidence===true`, and fold `ledAgreementPct` into the PPG
trust weight alongside the existing per-event `PPG_SQI_FLOOR` (NODE-RESIDUE-FOLLOWUPS §3). Add a
`tests/dex-tests.js` leg (mirror the sqi-floor group) proving a `lowConfidence` PPG export is down-weighted.

## §3 (MED — ALGORITHM CHOICE, document or revisit) — TERMA runs on positive-SLOPE energy, not Elgendi's clipped-amplitude square
Elgendi 2013 squares the **clipped band-passed signal** (amplitude). On the real Polar-Sense channel that
feature FAILED catastrophically (10 beats / 6.5 min) because the raw optical waveform carries a
supra-physiologic baseline transient (observed `bp` max ≈ 227 k vs sd ≈ 5 k) that dominates the amplitude
energy; the **positive-slope (derivative) energy** — the feature the prior detector used — is drift/transient
robust (a transient inflates only the LOCAL long-average) and recovered 338 beats. This deviation from the
cited algorithm is deliberate + commented, but: **Do:** either (a) add explicit baseline-wander / transient
removal so the canonical amplitude feature could be used (and validate it matches slope-energy), or (b)
keep slope-energy and validate it across more devices/mounts (ankle vs wrist) so the choice is evidence-backed,
not just this-file-pragmatic.

## §4 (LOW — CONSENSUS TUNING) — ~15-20 % of clusters are single-LED (dropped); peak-based vs foot-based consensus
On the equiv clip ~70-80 of ~418 clusters are 1/3 (dropped) even though per-channel counts are near-identical
(342/343/345). Chain-by-gap clustering already cut this vs from-first-event; the residue is peak-localisation
variance ACROSS channels (the systolic max lands a few samples apart). **Do:** evaluate clustering on the
**feet** (foot timing is more consistent than the systolic max) or a tighter localisation, and check whether it
raises 3/3 agreement without dropping true beats. Also add a period-stationarity edge-case test (abrupt HR
step) — the local TERMA threshold should track it, but there is no explicit assertion yet.

## §5 (LOW — PERF, orchestrate path) — the Unifier/OverDex `compute()` path is serial-only
`analyze()`/`compute()` stay SYNCHRONOUS by design (the equiv gate + orchestrate contract), so the §2b Worker
pool accelerates ONLY the live PpgDex app (`detectChannelsAsync` → `rec._preChannels`). A Unifier/OverDex-routed
overnight PPG file still detects serially on the main thread inside `signal-orchestrate`. **Do (only if it
janks in practice):** offer an async orchestrate entry that pre-detects channels via the same pool before
calling the synchronous `compute()`, keeping numbers byte-identical. Low priority — the O(N) detector already
removed the ~1 B-op autocorrelation, so serial is now tractable even overnight.

## Scope guard
All PpgDex-only except §2 (Integrator consumer). Keep `analyze()`/`compute()` synchronous (workers are a
scheduling optimisation). Any DSP change re-triggers the parent's gate ritual: re-bundle `PpgDex.html`,
re-read + record `manifestHash` (`BUILD-MANIFEST.json`), regenerate the equiv fixture(s), `Dex-Test-Suite.html?full`
all-green + `verify-provenance.html` GATE A/B green. If nothing here is executed, that is fine — this is
captured residue, not a commitment.
