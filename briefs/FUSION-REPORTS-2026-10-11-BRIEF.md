<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-10-11 · **Owner ask:** 2026-10-11 ("any ideas what other reports to put in fused and derived? what else can be calculated?", then "Fusion reports: i like it, write it up") · **Surface:** the Nights view's *Fused & derived* tab (proposal relayed 2026-10-11)

# Fusion reports — what the box's recordings can answer together

## 1 · Why this exists

The Nights view's *Fused & derived* tab shows five multi-device tools today: Integrator, 3-corner hat, 3-hat fused, PAT and PAT fused. The box records more pairs than those five use. Four further analyses are already **built and validated somewhere in the repo**, but no night page reaches them. Four more are **computable from streams the box already records**, but nothing joins those streams yet.

This brief lists them all, plus the timing-and-disruptors report the owner added (§2c), with:
- their inputs;
- the question each answers;
- the piece that already exists;
- what is missing before a click on the Nights page can run it.

It builds nothing. Each report becomes its own unit when it is picked up.

Rule 0, run on rig with the bge-m3 index on 2026-10-11:
- `cross-device fused analysis CPAP events SpO2 desaturation alignment` → `tools/cpap-oxy-couple.mjs`, `CPAP-REAL-CORPUS-2026-07-11`, `OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II`;
- `ECG-derived respiration respiratory rate compared with CPAP flow` → `resp-acc-analysis.html`, `METROLOGY-METHOD-ADOPTION-2026-08-14`, `papers/cpap-flow-reference.html`;
- `sleep staging from accelerometer heart rate fused` → `MULTI-SENSOR-DERIVATIONS-2026-07-16`;
- `cardiorespiratory coupling multi-device night report` → `OXYDEX-PB-DETECTOR-2026-08-09`, `ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30`.

## 2 · The reports

### 2a · Built, not reachable from a night

| report | inputs | question | what exists | missing |
|---|---|---|---|---|
| **Apnea typing** | H10 or Verity motion (MotionDex effort) + AirSense events | Is each CPAP-scored event obstructive (effort continues) or central (no effort)? | Integrator fusion, `APNEA-TYPING-FUSION-2026-07-18` (DONE): MotionDex's per-epoch effort series ingested by the Integrator | A column of its own; today it is one card inside the Integrator, which does not open in the browser (its fold runs on rig, `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24`) |
| **CPAP ↔ SpO₂ coupling** | AirSense events + O2Ring desaturations | Do the ring's desaturations coincide with the CPAP's events more often than chance? | `tools/cpap-oxy-couple.mjs`: event↔event match with a circular time-shift null (±5–15 min), reported as lift; primitive `event-coupling.js` (`EVENT-COUPLING-2026-07-13`, REFERENCE) | A browser page or a box-side run per night; it is a Node CLI over a corpus today |
| **Breathing-rate check** | H10 chest ACC + AirSense flow | Does the chest strap's breathing rate agree with the CPAP's flow? | `resp-acc-analysis.html` ("Chest-ACC respiratory rate vs CPAP flow"); ECG-derived respiration in ECGDex (`ECGDEX-EDR-RESP-ACCURACY-2026-07-31`, DONE, with a known 8–12/min band left open) | A per-night route: the page takes a night's files from the Nights click the way the trio and PAT pages do |
| **Clock agreement** | any two or more devices' CLOCK sidecars | Did the devices' clocks agree all night, and where did one step? | `DexClock.hostAxis` (Clock Contract §7), `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01` (DONE: drift is measured and bounded by the host axis); every night folder carries `Tepna_*_CLOCK.csv` | A report page. This report qualifies every other fused report on the same night, so it should be the first one built |

### 2b · Computable, not yet joined

| report | inputs | question | piece that exists | missing |
|---|---|---|---|---|
| **Events by body position** | H10 chest ACC (posture) + AirSense events + O2Ring desaturations | Events per hour supine vs lateral vs prone. Is the apnea positional? | MotionDex body position (gravity-vector decomposition: supine / lateral / prone / upright, `motiondex-dsp.js`) | The join: each event placed on the posture timeline; time-in-position as the denominator |
| **Heart response per event** | H10 (RR) + AirSense events or O2Ring desaturations | For each event: how far heart rate rose, and how deep SpO₂ fell after it, i.e. how hard each event hits rather than how many there were | `event-coupling.js` windows; ECGDex RR; OxyDex desaturation detection | Event-triggered windows around each event, with a shuffled-onset null so a heart-rate rise that happens anyway is not credited to the event |
| **Mask leak vs oxygen** | AirSense leak (EDF) + O2Ring SpO₂ | Does SpO₂ fall during high-leak stretches? | CPAPDex reads leak; OxyDex SpO₂ | The join and its null (leak and desaturation both cluster late in the night, so time-of-night must be controlled) |
| **Across nights** | many nights | Trends: solid-night rate, events per hour, ODI, HRV week over week; change after a CPAP setting change | `treatment-response-analysis.html` (change-point method, validated on planted data); `sensor-trio-power-analysis.html` | A third tab on the Nights view, fed by the per-night exports, not a per-night column |

### 2c · Timing and disruptors (owner ask, 2026-10-11)

The owner pointed at the GPS time server's own 7-day graphs (a CenterClick NTP250, its `/graphs-7` page): temperature, PLL frequency, memory, CPU, NTP packets, NTP jitter, GPS SNR, satellites. They asked for the same view on our side, for one night and for a week. The aim is to see whether time coupling moves with the things that disturb it.

It **grows the clock-agreement report of §2a** into one report with a night view and a week view.

**Already recorded per night** (measured on vigil, 2026-10-10 folder):

| what | file | cadence | carries |
|---|---|---|---|
| host clock quality | `Tepna_*_CLOCK.csv` | ~2 min | chrony reference (PPS / NTP250), `jitter_us`, `root_dispersion_ms`, `chrony_skew_ppm`, `timebase` |
| sensor-vs-host timing | `*_PMDARRIVAL.csv` | every packet (155,479 rows for one H10 file) | BLE arrival jitter, device-clock drift against the host |
| link quality | `Tepna_*_LINK.csv` | ~10 s | RSSI, connected, frames dropped and duplicated, `link_epoch` (reconnects) |
| clock-sync events | `CLOCKSYNC.csv` | per event | sync attempts, deferrals, failures |
| disruptors | daemon journal | per event | restarts, stored-data pulls, Wi-Fi up for the CPAP harvest, adapter recovery, the 09:00 QC digest, the AS11 shadow poll (~34 s) |

**Missing: the time server's own history.** The NTP250 renders its history as images. `/metrics` (Prometheus text) gives only current values:
- `ntp_jitter_seconds{clock,system}`, `ntp_pllfreq_ppm`;
- `gps_sat_count{seen,used}`, `gps_signal_strength_db`;
- `system_temp_celsius`, `system_cpu_ratio`, `ntp_packet_rate_per_seconds`.

A collector must sample it. Vigil's own chrony history needs no collector: `CLOCK.csv` already carries it.

**A first observation, which is the kind of question this answers:** on 2026-10-10, `jitter_us` read 4.9 µs while chrony followed the NTP250. After the switch to vigil's own GPS PPS at 17:47, it read 45–85 µs. Either the PPS setup costs jitter, or chrony's figure means something different per source. Unexplained.

**Views:**
- **Night:** stacked lanes on one time axis:
  - host clock jitter and dispersion;
  - each sensor's arrival jitter (p50 / p95 per minute);
  - device-clock drift residual;
  - RSSI;
  - the NTP250's GPS and temperature.

  Disruptors are drawn as markers across every lane.
- **Week:** the same lanes at 5-minute bins, one band per night.
- **Correlation:**
  - per disruptor type, the change in arrival jitter and host jitter in a −5…+10 min window, against the same window at shuffled times (lift);
  - for continuous pairs (RSSI ↔ arrival jitter, temperature ↔ PLL frequency), a lagged correlation against a circular-shift null;
  - no co-occurrence is reported without its null.

**Requirements set by the owner (2026-10-11): "make sure that history collector is passive and won't jitter more that time and any of this should be automatic without any tokens or human hand needed."**

1. **Passive.**
   - One HTTP GET of `/metrics` per 60 s, with a 2 s timeout, at a fixed random second offset, never aligned to :00.
   - Nothing else is asked of the NTP250. Nothing is written to it.
   - No NTP queries of our own: chrony already polls it, and the collector only reads chrony's state through `chronyc -n tracking` / `sourcestats`, which are read-only.
   - One process, standard library only, at `nice 19` and `ionice -c3`.
   - A failed or slow read writes an empty row with the reason (§∅). It never retries inside the minute.
2. **Proven not to add jitter, measured not assumed.**
   - Before the collector is enabled for good, run it for a pre-stated A/B: ≥ 24 h on and ≥ 24 h off, interleaved in 6 h blocks.
   - Compare chrony's PPS offset RMS and `jitter_us` from `CLOCK.csv` across the blocks.
   - The criterion is written before the run: the collector's blocks show no increase beyond the off blocks' own block-to-block spread.
   - Emit one `tepna.verdict/1` (`gate: timing-collector-is-passive`).
   - If it FAILS, the collector's cadence is lowered and the test re-run. It is never enabled on an assumption.
3. **Automatic, with no tokens and no human hand.**
   - The collector is a systemd unit plus timer, installed by the box's normal deploy. It is the owner's deploy, once.
   - It appends to a box-local daily file beside the nights (`/srv/tepna/timing/NTP250-YYYY-MM-DD.csv`), with retention under the box's existing policy.
   - The night and week analysis is a plain script run by a box timer after each night closes. It writes `TIMING-VERDICT.json` and a per-night summary the page reads.
   - The page renders in the browser from those files.
   - No step calls a model, needs an agent session, or waits for a person. A collector that stops writing is caught by the same timer and shown on the monitor, not discovered by someone looking.

## 3 · Rules every report inherits

- **One `tepna.verdict/1` per report per night** (§🧾).
  - The criterion is stated before the data is read.
  - A report whose inputs are absent is `NOT_RUN` with a named reason, never a zero.
  - A report whose window crosses a clock seam refuses with `clock-seam` (§∅, owner ruling 2026-09-17).
- **Co-occurrence is never reported without a null.** Two busy event streams always overlap. The lift against a time-shifted surrogate (`event-coupling.js`) is the minimum.
- **The clock-agreement result travels with every report on that night.** A report computed across a device whose clock stepped says so.
- **Evidence badges** (§🎫) on every surfaced number. Nothing here is `validated` on first build; each starts `experimental` or `heuristic` until it meets its own reference.
- **Local only**, as everywhere: no network, no literature value fetched at runtime.

## 4 · Not proposed

- **PAT as a vascular or blood-pressure surrogate.** `INTEGRATOR-PAT-VASCULAR-2026-07-18` ran Phase 0 twice and both runs were NO-GO. It is closed as EXECUTED-AND-REFUTED and does not return as a report. The existing PAT and PAT-fused pages stay as they are.
- **Sleep staging from fused motion and HR** is a research question (`MULTI-SENSOR-DERIVATIONS-2026-07-16`), not a report on existing pieces.

## 5 · Order

1. **Timing and disruptors (§2c)**, which includes clock agreement, because every other report's honesty depends on it. Its passive-collector A/B (§2c requirement 2) runs before anything else in this brief.
2. **Apnea typing** and **CPAP ↔ SpO₂ coupling**: built and validated, so only the route to a night is missing.
3. **Events by body position**: the most useful new join, with the posture half already shipped.
4. **Heart response per event**, then **mask leak vs oxygen**.
5. **Across nights**, once at least two of the above emit per-night verdicts it can trend.

## 6 · Done when

This brief is DONE when each report in §2 is one of:
- built and reachable from a Nights click, emitting its verdict;
- moved to `briefs/RESIDUE.md` with the measured reason it cannot be built.

No report counts as done because its column renders. The click must load the night and run the analysis.
