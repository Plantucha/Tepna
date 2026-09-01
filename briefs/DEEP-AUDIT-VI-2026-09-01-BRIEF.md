<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-09-01 (the audit ran and this IS its report; execution of the punch-list is the open work. F1 assigned on creation day) · **Created:** 2026-09-01 · **Method:** ultracode workflow wf_4e31c7e3-ac7 — 56 agents (10 charter-guided finders per AUDIT-PROMPT.md · 2 adversarial executed-verification lenses per finding · synthesis), 41 raw → 20 confirmed (2/2 lenses) + 1 contested, ~31 min, 7.1M tokens

# Tepna Deep Audit — Synthesis Report — 2026-09-01

**Method:** every finding below was executed, not read — each carries a repro command that was run against
the real co-loaded modules (node:vm realms of the shipped `*.js`) and, where named, real corpus files. Every
confirmed finding passed **two independent verification lenses** (reproduce-by-execution + live/reachable/not-
documented-intentional). One finding drew a dissent and is reported separately as **contested**, unpromoted.
Near-duplicates are merged: the two ECGDex clock-step entries (parse-side and coverage/export-side of one
defect) are one finding, as are the two HRVDex `DexUnits` threshold entries (d_cvi and its d_csi/d_si sibling).

**Scope declared (AUDIT-PROMPT mandate):**
- **(a) Browser lane — NOT covered.** No `Dex-Test-Suite.html?full`, `verify-provenance.html`, or
  render-coverage rig was booted. The ECGDex app-path finding (F2) exercised `WORKER_SRC` by source extraction
  in a vm, not in a browser. Green here means unexamined, not verified.
- **(b) capture-host — covered** (config-path resolution, night-QC state machine, status/heartbeat frames):
  2 confirmed findings + 1 contested.
- **(c) Integrator fusion arithmetic — partially covered.** The temporal-overlap grouping shared by
  fuseHRVConsensus / fuseStagingConsensus / fusePeriodicBreathing was executed (F9). The noisy-OR posterior,
  `effConf`, and the Poisson null / event-coupling surrogate machinery were **not** independently audited this
  pass — that cell stays empty for a third consecutive audit.
- Dimensions exercised: units · clock · fusion · capture-seam · ECG/PPG DSP · Gluco/CPAP DSP · spine
  (ingest/export/provenance gates) · stats kernels · render/registry surface · capture-host Python.

---

## Findings — confirmed by both lenses, ranked by severity then reach

### ECGDex

#### F1 · CRITICAL — mis-states surfaced numbers AND fabricates absence · `ecgdex-dsp.js:4352` (parseECG gap walk) + `ecgdex-dsp.js:4615` (coverage/export)

**Symptom.** A mid-recording H10 clock resync (the strap's 2019-01-01 default epoch adopting real time when a
sync lands seconds into the night: device-ns column steps **+241,586,765 s** between consecutive rows while
the phone column advances 86 s) is read as a BLE dropout of 241 billion ms. Three committed corpus exports
(`uploads/trio/` 2026-08-23 / -26 / -27 ECGDex node-exports, refolded 2026-09-01 under #2036) publish
sleep-stage events **~7.66 years in the future (2034)**, `recording.coverage.spanSec` of ~2.41e8 s for single
nights, and `quality.coveragePct 0` for real 7-h recordings — with `recording.hostAxis null`, so nothing on
the export says so. Downstream, the Integrator's gap-aware `segmentsOverlap` sees zero recorded overlap with
any 2026 recording, so the night silently vanishes from every coverage-gated consumer.

**Reproduction (executed).**
- Raw seam: `awk -F';' 'NR>1 { ns=$2+0; if (prev!="" && (ns-prev > 1e9)) print NR, prev, ns, (ns-prev)/1e9, $1; prev=ns }' /srv/data/tepna-corpus/smoketest-captures/2026-08-27/Polar_H10_02849638_20260827232414_ECG.txt`
  → sensor-ns 599616014224155008 → 841202778560761088 (+241,586,765 s) at phone time 23:24:52 → 23:26:18.
- DSP: `node …/scratchpad/audit/integrator/probe6_coverage.mjs` and `node …/scratchpad/audit/captureseam/seam3.mjs`
  (real co-loaded ECGDex) → `gaps=[{ms:241586764336, atRelMs:9545}]`; coverage spanSec 241,589,698 with
  segment 2 starting **2034-04-24T02:50:55Z** for a 50-minute file whose own `tMsAt()` correctly spans
  2026-08-27 23:24 → 00:13 — two axes in one node disagree. On 2026-08-23: `endEpochMs` (2026-08-24) sits
  7.6 years BEFORE its own second coverage segment. Step census: 3 of the smoketest nights carry the step;
  the sibling `_ACC.txt` carries the identical ns step (verified), so MotionDex epoching and PMDARRIVAL/
  hostAxis on those nights inherit the same broken device axis (consequence not separately executed).
- Committed exports: 2026-08-27 → 24/45 events at 2034 (all `stage_*`), coverage.spanSec 241612603 vs
  durSec 25196, coveragePct 0; 2026-08-23 → 22/22 events at +67,016 h; 2026-08-26 → 19/58 at +67,091 h.

**Root cause.** The gap walk trusts the device-derived relative-ms axis unconditionally; `hostAxis` honestly
refuses ('implausible host/device rate −999988 ppm') but the refusal keeps the stepped device axis with **no
annotation reaching the export**. The same-day H10-2019-ORIGIN annotation (#2039) covers the between-fragment
sync case; its premise ("relative quantities are sound because anchoring is relative to the first anchor") is
false for the **mid-file** sync subclass: the relative axis itself steps. The invariant violated: every
exported event tMs lies inside the recording's own declared window; a gap's duration is measured against a
clock the data supports — the phone column proves the real gap was 86 s.

**Fix sketch + gate cost (one gated change).** In the parseECG gap walk, bound `g.ms` by the phone-column
delta across the same rows (or a hard ~24 h ceiling); treat an over-bound device step as a **re-anchor
point** (session-boundary semantics), never a dropout duration — and surface it (`timingSource`/`deviceEpoch`
annotation on the export). Gate cost: `ecgdex-dsp.js` edit → ECGDex re-bundle + orchestrators +
analysis/docs builders; `computeHash` moves → ECGDex equiv fixtures regen (`tools/regen-ecgdex-goldens.mjs`)
+ `verify-fixtures.mjs`; then **refold the three poisoned trio exports** as a follow-up unit. Capture-side
hardening (rotate the file-set when `clock_watchdog` steps a device clock — today the CLOCKSYNC.csv sidecar
records the event but the vendor file still fuses two epochs) is complementary and a **separate** work-unit.

#### F2 · MAJOR — mis-states a surfaced number (app lane) + contract drift · `ecgdex-app.js:107`

**Symptom.** The ECGDex **app** ingest (streaming `WORKER_SRC` and the small-file inline path) derives
`fs = Math.round(mean ms-delta)` and ignores the sensor-ns column, hostAxis, deviceEpoch and gap rel-ms edges
— so the browser app analyzes the same bytes on a time axis 96–320 ppm different from the gated headless
`ECGDSP.parseECG`, and the file's own host stamps prove the app wrong. Browser-produced exports also carry
no `tMsAt`/`hostAxis`/`deviceEpoch` (rec built at `ecgdex-app.js:159/216`). The `ecgdex-dsp.js:4219` comment
claiming parseECGText "mirrors WORKER_SRC byte-for-byte" is stale — the DSP gained the ns-counter fs
(`:4402`) and host discipline the app never received. This is the exact rounding error the DSP's own comment
(`:4388-4397`) measures at −1.25 to −4.16 s/night and blames for making PAT unmeasurable — fixed headless,
still live in the app.

**Reproduction (executed).** `node …/scratchpad/audit/ecg-ppg/reproA_worker_vs_headless.mjs` on two real
corpus nights: 06-17 part01 — headless fs 129.958457 vs app 130 (−319.6 ppm); |app − host-stamp span| =
0.842 s vs 0.008 s headless over 44.3 min (extrapolates −8.3 s across the 434-min night). 06-25 — 130.012505
vs 130 (+96.2 ppm); 0.265 s vs 0.008 s. App rec lacks all provenance fields the headless rec carries.

**Fix sketch + gate cost.** Port the DSP's ns-counter fs + host discipline into `WORKER_SRC` and the inline
path, and build the app rec with the same `tMsAt`/`hostAxis`/`deviceEpoch` fields. Gate cost:
`ecgdex-app.js` edit → ECGDex re-bundle + orchestrators; render/app-lane change but it alters
browser-produced exports, so treat as compute-adjacent: confirm `computeHash` behavior, re-run the suite;
no headless fixture should move (headless path untouched) — verify, don't assert.

#### F3 · MAJOR — mis-states a surfaced number (bug class 3a) · `ecgdex-dsp.js:2006` + sibling `ppgdex-dsp.js:2024`

**Symptom.** `cvhrIndex` divides events by the gap-folded **wall** span (`hours = tt[N-1]/3600`) instead of
observed time, so sensor dead-time inflates the denominator: a 1.5 h dropout in a 3 h night halves the
shipped apnea-surrogate index (29.7 → 14) on unchanged physiology. PpgDex `cvhrFromNN` ports the identical
two lines. `cvhrIndex` is registered (`ecgdex-registry.js:45`, '/h', emerging) and consumed by the
Integrator (`integrator-dsp.js:334` + the PB-consensus observer) — a gappy night under-reads an apnea
screening surrogate proportionally to its downtime.

**Reproduction (executed).** `node …/scratchpad/audit/ecg-ppg/reproC3_cvhr_counts.mjs` — BASE: 89 events,
cvhrIndex 29.7, observed 2.98 h (29.8/observed-h). GAP: 42 events, cvhrIndex 14, observed 1.48 h
(28.3/observed-h). Control: meanRR/rMSSD/SDNN correctly ignore dead time — only this denominator does not.

**Fix sketch + gate cost.** Use observed/analyzable time as the denominator — `analyze()` already has
`nnRes.activeSec` in scope at the `detectCVHR` call site; the in-repo statement of the honest convention is
OxyDex's ODI ("per hour of analyzable recording", `oxydex-dsp.js:~2740`). Two gated changes: (1)
`ecgdex-dsp.js` → ECGDex re-bundle + fixture regen/verify; (2) the same port in `ppgdex-dsp.js` → PpgDex
re-bundle + its 6 fixtures. Do not fold both into one PR with unrelated work.

#### F4 · MAJOR — evidence-badge mandate (class 7/13, the MISSING class) · `ecgdex-app.js:1073`

**Symptom.** The ACC Cross-Check card surfaces physiological measurements — 'ACC breathing N br/min',
'ECG/EDR breathing N br/min', the Δ br/min agreement chip, the posture %-pills — with **no evidence badge**,
while `ECG_REGISTRY` already grades exactly these metrics (`rraccRate`/`edrResp` = emerging). Invisible to
every existing badge gate: `no-fabricated-tier` collects `evBadge` literals (no call site exists here), the
badge DOM-walk selector list lacks `.gang-pill`/`.acc-posture`, and `renderCoverageECGDex` asserts no badge
coverage. Sibling sub-cards in the SAME card (`_accCardRR`, `_accCardAgreement`) do badge.

**Reproduction (executed).** `node …/scratchpad/audit/render-registry/ecg-acc-badges.mjs` — renderACCComparison
body: 0 badge calls against 7 unit-bearing tokens; the `_chartCardBadge` post-pass targets 7 bodies, never
`accBody`; registry resolves 'ACC Resp Rate'→rraccRate and 'EDR resp rate'→edrResp. A 19-file fleet scan
converges on exactly this function plus `renderHRValidation`.

**Fix sketch + gate cost.** Wire inline `.ev` badges through `EcgRegistry` for the breathing-rate and
agreement chips (posture needs a registry entry or a deliberate deny), matching the sibling sub-cards.
`ecgdex-app.js` → ECGDex re-bundle + orchestrators; render-only, `computeHash` stable, no fixture movement
expected (verify).

### HRVDex / shared `quantity.js` units guard

#### F5 · MAJOR — mis-states a surfaced number (verdict inversion; class 1, the #1 fear) · `hrvdex-dsp.js:679` (d_cvi) + sibling `:685` (d_csi/d_si)

**Symptom.** `d_cvi` (Toichi CVI, color-graded KPI) routes rMSSD through `DexUnits.asSecondsRR`, whose
ms-vs-seconds threshold (10) is calibrated for RR intervals (300–2000 ms) — a clinically real rMSSD < 10 ms
(severe autonomic dysfunction) is classified as SECONDS, multiplied 1000×, and inflates CVI by +3 log units,
**inverting the rendered clinical verdict** (severe-low-HRV renders green). The guard's `.flagged` return is
discarded at the call site — and carries no signal anyway (even a correct 38 ms → 0.038 s trips the RR
plausibility band, so flagged≈always). The sibling one guard later: `guardBaevsky` misclassifies MxDMn <
10 ms the same way, making `d_csi` 1000× high (verdict inverted, NO flag) and `d_si` 1000× low (extreme
stress reads 'ok'; only `d_si_flagged=true` survives).

**Reproduction (executed).** `node …/scratchpad/audit/units/cvi-ingest-path.mjs` (end-to-end via the real
`_hrvParseSummaryRows` Welltory parse): rMSSD 8 ms, meanRR 880 ms → d_cvi 6.85 rendered 'good(green)'
(truth 3.85 = 'bad'). Threshold sweep (`cvi-threshold.mjs`): 10.0 ms → 3.954 but 9.9 ms → 6.950 — a +2.996
discontinuity for 0.1 ms. Sibling (`csi-mxdmn.mjs`): MxDMn 9 ms → d_csi 10.227 (red; truth 0.0102 green),
d_si 5.568 (truth 5568).

**Root cause.** A unit-inference threshold calibrated for RR magnitudes applied to *derived statistics*
(rMSSD, MxDMn) whose physiologic range crosses it; plus the guard's implausibility flag silently dropped —
violating quantity.js's own contract ('surface, never silently use').

**Fix sketch + gate cost.** These operands arrive from a vendor column whose convention is declared — pass
the declared unit through instead of magnitude-sniffing derived statistics (or use a statistic-appropriate
threshold), make CVI monotonic across the boundary, and surface the flag (`d_cvi_flagged` mirroring
`d_si_flagged`) or refuse with NaN. One gated change in `hrvdex-dsp.js` (+ `quantity.js` if the threshold
moves — that is spine-adjacent; check its other consumers first) → HRVDex re-bundle, fixtures re-verify;
`registry-defs-parity` and cohesion gates re-run.

### GlucoDex

#### F6 · MAJOR — mis-states every headline number (classes 1/15) · `glucodex-dsp.js:291`

**Symptom.** `locateColumns` picks the Dexcom-Clarity **Index** column as the glucose column as soon as ONE
non-numeric glucose cell (the string "Low" Dexcom writes for out-of-range readings) appears in the first 60
lines — every headline metric is then computed on row numbers, silently.

**Reproduction (executed).** `node …/scratchpad/audit/gluco-cpap/p10_low_threshold.mjs` — 0 Low rows →
glucose column; 1 Low row → Index column. 1000-row file with 3 Low rows: mean 501 mg/dL, GMI 15.3, TIR 11.1,
LBGI 6.6, all from the 1..1000 Index column. Even clean, glucose wins by exactly 1 hit: the score
`inBand/total − dateHits/total` has no penalty for a serial-integer column.

**Fix sketch + gate cost.** Detect and exclude monotonic consecutive-integer columns (and/or add
header-name hints `/glucose/i`, or require physiologic variance); refuse with a named reason on a
within-one-hit tie. One gated change in `glucodex-dsp.js` → GlucoDex re-bundle + orchestrators/analysis/docs;
compute-path → regen/verify the 3 GlucoDex fixtures; add a "Low"-bearing committed synthetic twin so CI
holds the line (the adversarial-committed-twin pattern §🔏 prescribes).

### CPAPDex

#### F7 · MAJOR — fabricates absence (class 3) · `cpapdex-dsp.js:677`

**Symptom.** `oximetryLane` fabricates an all-zero pulse series when the SA2 file carries SpO₂ but no Pulse
channel (`pulse = pulseCh ? pulseCh.data : new Float32Array(spo2.length)`), so `selfGateDesat` reads
pulseValid=0 on every event, marks EVERY genuine desat 'perfusion-collapse', and publishes **ODI 0.00 /
desatCount 0 — a fabricated clean oximetry night**. Sibling divergence (class 14): `oxydex-dsp.js
detectODI:3337` treats pulseSeries as OPTIONAL and degrades to ungated detection. Pulse-less SA2 is a real
corpus shape (CPAP-SA2-OXIMETRY-SOURCE brief: Pulse.1s in 249 of 250 files).

**Reproduction (executed).** `node …/scratchpad/audit/gluco-cpap/p2_oxi_pulseless.mjs` — identical SpO₂ with
five clean 5% desats: WITH pulse → odi 7.5, desats 5, artifacts 0; WITHOUT → odi 0, desats 0, artifacts 5,
all 'perfusion-collapse'.

**Fix sketch + gate cost.** Port the OxyDex optional-gating: pass null and skip the perfusion/edge legs when
no pulse channel exists, keep kinetics-only gating, surface a lane-level 'pulse-lane-absent' quality note.
One gated change in `cpapdex-dsp.js` → CPAPDex re-bundle; regen/verify the 5 CPAP fixtures
(`tools/regen-cpap-goldens.mjs`).

#### F8 · MAJOR — fabricates absence in a surfaced adherence number · `cpapdex-dsp.js:918`

**Symptom.** `buildSessionFromEdf` derives pressure/usage ONLY from the PLD file: a session set with PLD
missing publishes **usageHours 0.000** (feeds compliancePct '≥4 h nights'), maskOnLatency NaN,
medianPressure NaN, residualAHI null — while the same set's BRP `Press.40ms` carries the full mask-on trace.
Internal sibling divergence: the therapy CLOCK already falls back PLD||BRP||SA2 (`:911`); the pressure
channel never does. PLD-less clusters are reachable (analyzeSet builds from whatever the cluster has; the
grouping note documents real nights that lost files).

**Reproduction (executed).** `node …/scratchpad/audit/gluco-cpap/p7_brp_only.mjs` on real night
20260613_045505: full set → usageHours 0.683, medianPressure 6.71; PLD removed (BRP+EVE kept) → usageHours
0.000, NaN, null — while BRP Press.40ms shows mask-on fraction 1.000 ≈ 0.683 h true usage.

**Fix sketch + gate cost.** Fall back to BRP Press.40ms for maskOn/usage when PLD is absent (mirroring the
therapy-clock fallback), or publish usageHours **null with a named reason** — never 0.000. One gated change
in `cpapdex-dsp.js` → CPAPDex re-bundle + fixture regen/verify. Separate unit from F7.

### Clock Contract §6 consumers (OxyDex fusion + CPAPDex co-import)

#### F9 · MAJOR — mis-states a surfaced number via +24 h event shift · `oxydex-fusion.js:42` + `cpapdex-coimport.js:49`

**Symptom.** Legacy t-only ganglior-event reconstruction chains prevMs with a **1-second** midnight-roll
tolerance, so ONE ≥2 s backwards step (jittered/duplicated row, or any lexically-sorted legacy export) rolls
+24 h onto that event AND every subsequent event — while `integrator-dsp.js reconstructEventTMs` places the
identical stream correctly. `clock.js` already carries the executed disproof of the 1 s tolerance
(DEEP-AUDIT-III §1.2, `CK_ROLL_SLACK_MS` = 12 h) and names these two siblings as still divergent. Downstream,
surges shifted +24 h overlap zero desats/apneas, so `corroboratedPct`/ECG cross-confirmation silently reads 0
— the §6.4 failure shape through a different door. Aggravator: `oxydex-fusion.js:250` ignores the modern
`ev.tMs` field entirely (cpapdex-coimport has the fast-path).

**Reproduction (executed).** `node …/scratchpad/audit/clock/roll-differential.mjs` — t0 22:00, events
[22:30, 23:10:05, 23:10:03, 23:45, 01:20, 05:50]: integrator places all inside the night (last +7.83 h);
both siblings place 23:10:03 next-day and every later event a day late (last +31.83 h).

**Fix sketch + gate cost.** Use the `tMs` fast-path first; replace the 1 s tolerance with the 12 h slack (or
delegate to the integrator's order-independent reconstruction). Both files are inlined → re-bundle OxyDex
AND CPAPDex + orchestrators, manifestHash moves, fixtures re-stamp; add a jittered t-only stream to the
§6.3/§6.4 test groups.

### PpgDex

#### F10 · MAJOR — silent failure (whole-night export killed by allocation) · `ppgdex-dsp.js:1754` (beatConfidence) + `:1943` (cvhrFromNN)

**Symptom.** Two unguarded siblings of the span refusals ECGDex received in #1800/#2030: (1) beatConfidence
is fed time-derived pseudo-sample indices `round(footSec*fs)` (`:3682-3687`), so it allocates four
`Float64Array(S)` where S = the gap-accumulated time span in seconds, unbounded; (2) cvhrFromNN — 'faithful
port of the audited ECGDex detectCVHR', ported **without** the #1800 guard — sizes six arrays from
`floor(tt[N-1])`. A mid-file Polar sensor-clock rebase (+2792 days, the shape ECGDex measured on a real H10
night) survives parsePPG into relSec (hostAxis correctly refuses at ±50000 ppm, so the raw jump stays), and
`analyze()` dies allocating span-sized arrays — killing the whole night's PPG export (~7.7+ GB attempted
uncapped; the #1800 incident measured >50 GB before cgroup OOM). The `ecgdex-dsp.js:1758-1759` comment
'beatConfidence is safe by construction' is true for ECG, false for the PpgDex call site.

**Reproduction (executed).** `(ulimit -v 4000000; node …/scratchpad/audit/ecg-ppg/reproB2_endtoend.mjs)` —
parsePPG relSec[last] = 241,229,160 s; analyze() → `RangeError: Array buffer allocation failed` at
`ppgdex-dsp.js:1754` via `:3682`. Same nn/tt into `ECGDSP.detectCVHR` → clean refusal `{reason:
"implausible-span"}`.

**Fix sketch + gate cost.** Port the `CVHR_MAX_SPAN_S`-style implausible-span refusal to both PpgDex call
sites (null + reason; export survives with the affected metrics refused) — the class fix #2030 itself
declared 'the instance was fixed, not the class'. One gated change in `ppgdex-dsp.js` → PpgDex re-bundle +
its 6 fixtures re-verify.

### Integrator

#### F11 · MAJOR — mis-states surfaced consensus values (order-dependence) · `integrator-dsp.js:3229` (+ :3473, :3634)

**Symptom.** The temporal-overlap grouping shared by fuseHRVConsensus, fuseStagingConsensus and
fusePeriodicBreathing is a greedy first-group-with-any-overlap pass that never merges groups — block
membership is not the connected component and depends on file-drop order. A source that overlaps a block via
a bridge record (HRVDex envelopes span days) is silently excluded, changing surfaced consensus values,
observer counts and the periodic_breathing corroboration conf.

**Reproduction (executed).** `probe1_grouping.mjs` + `probe2_pb.mjs` — the same three records in three drop
orders yield three different consensus blocks (['HRVDex+PulseDex'] / ['ECGDex+HRVDex+PulseDex'] /
['ECGDex+HRVDex']); fusePeriodicBreathing yields conf 0.885 (3 observers) vs 0.697 (CPAPDex silently
excluded) vs 0.752 (ECGDex excluded) for identical data.

**Fix sketch + gate cost.** Union-find / merge-on-bridge grouping so blocks are the transitive closure and
outputs are functions of the data, not directory iteration order. One gated change in `integrator-dsp.js` →
Integrator re-bundle (GATE A covers it), its 3 fixtures regen/verify; add an order-permutation assertion to
the suite.

### Shared spine

#### F12 · MAJOR — silent failure at the capture seam (class 12/14) · `dex-ingest.js:99`

**Symptom.** Fixed-name capture-host sidecars escape `nonSignalName()` and **fail OPEN into primary waveform
lanes**: on the real 2026-08-30 vigil folder, planIngest queues `CPAP-INVENTORY.jsonl` and `OXYLIFE.csv` as
ECG RECORDINGS, and the `CLOCKSYNC.csv` sidecar added 2026-09-01 routes ecgKind='ecg'/ppgKind='ppg' the day
it lands on disk — the same defect the function's own PMDARRIVAL comment documents 'one generation later'.
Cause: the token alternation `_(CLOCK|LINK|OXYFRAME|PMDARRIVAL|QC|SUMMARY|TELEMETRY)` requires a leading
underscore these fixed names lack, and the extension list has JSON but not JSONL/CSV. Same fail-open default:
`Polar_H10_*_RR.txt` → ppgKind='ppg' (no `_RR` branch), so an H10 RR companion queues as a PPG primary and
dies in parsePPG. Precedent severity: the identical fail-open admitted 813 `_MAG.txt` files as ECG (§6.4 F10).

**Reproduction (executed).** `node …/scratchpad/audit/captureseam/seam2.mjs` (real DexIngest over the real
2026-08-30 folder) — ecgGroups includes [CPAP-INVENTORY.jsonl] and [OXYLIFE.csv]; OXYLIFE/CLOCKSYNC/
CPAP-INVENTORY all classify ecg+ppg; `_RR.txt` → 'ppg'. QC-SUMMARY.json correctly skips.

**Fix sketch + gate cost.** Add the fixed names (or their tokens) + JSONL/CSV to `nonSignalName`; add an
`_RR` companion/skip branch to ppgKind. `dex-ingest.js` is inlined into multiple bundles → re-bundle
ECGDex + PpgDex + orchestrators; gate-backed surface (§6.4) — extend its test rows with these names.

#### F13 · MAJOR — contract violation with privacy consequence · `dex-export.js:180`

**Symptom.** `dexScrubExport` (`schema.scrubbed:true`) leaves the raw upload filename in OxyDex
`nights[].file` and PpgDex `recording.source`, and the full unscrubbed provenance block
(`inputs[].name`, `sha256`, `lastModifiedMs`) in `nights[].provenance` — violating SELF-INGEST §5's
acceptance ('with scrub ON, the exported JSON contains no device serial / filename / input sha256'; O2Ring
filenames embed the device serial and can embed a personal name).

**Reproduction (executed).** `node …/scratchpad/audit/spine/scrub-repro.mjs` — scrubbed output:
`nights[0].file = "Jane_Smith_O2Ring S 2100_20260612230016.csv"`; full provenance inputs survive; leak
check: name, sha256, mtime, source filename ALL survive. Envelope shape verified real
(`oxydex-app.js:185`, `oxydex-dsp.js:6951/697`, `ppgdex-app.js:971`).

**Fix sketch + gate cost.** Extend scrubExport to strip `file`/`fname`, per-element provenance
inputs name/sha256/mtime, and `recording.source` across nights[]/recordings[]/sessions[]. `dex-export.js`
is a universal spine module (8 of 8 bundles) → **serialized fleet re-bundle** (§👥.3: announce spine work
first), all 8 provenance fragments move, fixtures re-stamp; add the §5 acceptance as a test.

#### F14 · MAJOR — provenance-gate integrity (class 9) · `manifest-gate.js:152`

**Symptom.** The `computeHash` DISPLAY_ONLY denylist excludes `oxydex-profile.js`, but that module reaches
`compute()`: editing its UP defaults moves OxyDex's exported `newMetrics.vo2est/karv` while `computeHash`
stays byte-stable — so the 'export-inert, PROVEN' verdict is false for this edit class, overturning
DEEP-AUDIT-II §12.1's FALSE-POSITIVE ruling (which verified only the PpgDex side and generalized). Damage
today is bounded by hand-maintained volatile-strip lists — a prose-list mitigation of exactly the shape
computeHash exists to abolish.

**Reproduction (executed).** `node …/scratchpad/audit/spine/computehash-counterexample.mjs` — default age
49→35: compute() export moved {vo2est 50.9→53.9, hrMax 174→184} on the committed synthetic; same edit in
OxyDex.html's inlined block: manifestHash moved (2978d954d196→0f4a6d66bdde), computeHash did NOT
(f61b09629fa7 = f61b09629fa7).

**Fix sketch + gate cost.** Remove `oxydex-profile.js` from the denylist (the denylist's own doctrine:
unknown/reachable ⇒ inside the closure; over-flagging is the accepted cost). `manifest-gate.js` edit — a
gate, not a bundle: no re-bundle, but every OxyDex computeHash-keyed record re-derives; re-run
`verify:manifest` + `verify-fixtures.mjs`, and update the §12.1 audit row so the false refutation stops
re-seeding.

### Analysis/stats kernels

#### F15 · MAJOR — mis-states a surfaced statistic (silent multi-root) · `analysis-stats.js:284`

**Symptom.** `tchSigmasPairwiseFromVars` silently returns one of multiple admissible sigma triples: the
pairwise-rho system frequently has ≥2 positive roots reproducing the observed variances exactly, and the
kernel reports whichever root Newton reaches from its seed as THE sigma, ok:true, no multiplicity flag. Its
only uniqueness handling is the LOCAL 'Jacobian singular' refusal (`:318`); which root returns depends on
the seed branch (`:298`), so a tiny perturbation can jump the reported sigma discontinuously. The dex-tests
known-answer plants all happen to sit on the Newton-reachable root, so the suite stays green.

**Reproduction (executed).** `probe2.mjs` (production single-rho shape, the exact shape
`tools/tch-per-epoch-rho.mjs` solves): 12 of 53 planted physical systems admit ≥2 positive roots (each
satisfying all three variance equations to ≤2e-15); in 4 of 12 the kernel returned a NON-planted root —
e.g. planted σ 3.017/0.442/2.549 at ρ_bc=0.447 (the real ~0.42 regime) returned 2.947/0.780/2.629 (corner b
off 76 %); another off 4×. `probe1.mjs` general shape: corner off 9×. `probe3.mjs`: the real Section-8a CPAP
triplet is single-root — the shipped 0.19 figure itself is safe.

**Fix sketch + gate cost.** Multi-start the solve (or bisect for sibling roots the way `tchRhoCrit` bisects
for the boundary) and either refuse with 'multiple admissible sigma triples' or return all roots — the
kernel's own doctrine is REFUSAL, not a fabricated number. `analysis-stats.js` → `build-analysis.mjs`
tools re-bundle + `verify:analysis`; extend the known-answer plants with a multi-root case.

#### F16 · MAJOR — mis-states a surfaced CI (estimator mixing) · `sigma-no-reference-analysis.js:396`

**Symptom.** On the sole LIVE data path (folder drop → processFolder → windowFromWorker, engaged whenever
<3 nights are selected), aggregate() pairs a FUSED-hat point estimate (tchSigmasFused with per-corner DSP
confidences) with a within-window CI bootstrapped from the CLASSIC unweighted tchSigmas (the confidences are
not even stored on the window) — on an artifact-flagged night the rendered sigma sits entirely outside its
own rendered 95 % CI. The consistent committed-TRIOS buildWindow path is documented dead code.

**Reproduction (executed).** `probe4.mjs` (the real page code in a vm, source unmodified except an appended
export hook) on a 3600-s window with a 300-s DSP-flagged (c=0) H10 burst — the exact scenario the fused hat
is gate-tested for: rendered 'σ_H10 = 1.009 [7.296–12.801] (within-window)', point-inside-CI = false;
Verity/O2 corners agree between estimators and stay inside, isolating the mechanism.

**Fix sketch + gate cost.** Pass cH/cV/cO through the window object and bootstrap `tchSigmasFused` (same
estimator as the point) — or label the CI classic-estimator and detach it from the fused point.
`sigma-no-reference-analysis.js` → `build-analysis.mjs` + `verify:analysis`.

### capture-host (Python lane — gate is `./check.sh`, not npm)

#### F17 · MAJOR — silent failure via CWD-relative config paths · `capture-host/capture.py:6574` (+6594, 6614)

**Symptom.** Three cfg paths are consumed VERBATIM — exact siblings of the `spool_pull.root` CWD bug fixed
hours earlier in #2046: `cpap.ble_stream.creds_path`, `edf_dir`, `raw_record_dir`. A relative creds_path —
including uncommenting `config.example.yaml:283`'s own suggested value, whose comment claims config-dir
resolution — resolves against the daemon's CWD, open() fails, `_load_as11_creds` swallows OSError → None,
and every AS11 feature (live stream, shadow detector, spool pull) silently degrades to 'not paired'. A
relative edf_dir/raw_record_dir writes the only copy of the night's EDF/raw record into the daemon's CWD —
the /opt checkout on vigil, the exact two-failure consequence #2046 measured.

**Reproduction (executed).** `.venv/bin/python …/scratchpad/audit/capturehost/repro_relpaths.py` — creds
beside config, daemon CWD elsewhere: creds_path absent → creds load; the example's own relative value →
None. `EdfSink('captures/cpap-edf')` keeps the path verbatim under CWD. The fixed sibling
`resolve_spool_root` correctly returns the box-rooted path.

**Fix sketch + gate cost.** Resolve relative creds_path against the config file's directory (matching the
documented default); relative edf_dir/raw_record_dir against the box root via resolve_spool_root-style
helpers; log the resolved absolute paths at ARMED/startup as #2046 added for the spool root. Python-lane:
`capture-host/check.sh` (ruff · shellcheck · pytest --cov 100 %), tests for each path; deploy to vigil is a
separate step.

#### F18 · MAJOR — mis-states the night verdict via stale state · `capture-host/capture.py:5391`

**Symptom.** The night-QC auto-start guard admits a stale record from any previous night:
`_cpap_stream_watch_row` matches `rec.session_ms` against the WHOLE journal's observed span (rows[0]..[-1]
of the never-rotated 6.45-day SESSIONDETECT.csv) — ~always true — so a persisted
cpap-autostart-session.json from a failed night days earlier relabels tonight's honest NEVER_STARTED as
AUTOSTART_FAILED, quoting the old night's error. The loop-side matcher `_cpap_autostart_load` documents the
exact-session-keying safety property; the watchdog path re-implements the match with a predicate that cannot
discriminate. Sibling of #2027 in the same function (that fix scoped therapy_minutes to d-1..d+1 but left
this input unscoped). The assess comment itself says the two verdicts 'demand OPPOSITE responses'.

**Reproduction (executed).** `.venv/bin/python …/scratchpad/audit/capturehost/repro_span_guard.py` — journal
08-25..09-01 + marker keyed to 08-29 with attempts=5: tonight (09-01, 40 min therapy, automation never
tried) verdicts 'auto-start-failed … 5 time(s) … (last error: BleakDeviceNotFoundError (2026-08-29))'. The
night window itself correctly excludes the record.

**Fix sketch + gate cost.** Gate the record with the same `_night_window_ms(since, until)` bounds the rest
of the row uses, or reuse `_cpap_autostart_load`'s exact-session keying against tonight's observed session
start. `capture-host/check.sh`; deploy separately.

---

## Contested — one lens dissented; reported, NOT promoted

**`capture-host/status_union.py:77` — heartbeat frame mismatch across DST.** Claim: status_loop stamps
`heartbeat_ms` from `_now()` — the civil-anchored frame that deliberately absorbs a DST relabelling while a
recording is open (`_civil_shift` ±3600 s, capture.py §A1) — but `instance_health` ages it against real
`time.time()` with STALE_AFTER_MS=60 s. Spring-forward night: every live instance reads stale
(age 3,600,000 ms) for the rest of the recording, merge() reports degraded. Fall-back night: heartbeat sits
1 h in the future, age clamps to 0, and a genuinely wedged daemon reads live for up to an hour — the exact
'up-but-wedged LOOKS most like health' failure the layer exists to catch.
- **Vote REAL:** repro executed and reproduces both legs through capture's real state and `_now()`'s real
  fast path (spring-forward: live instance → {'state':'stale','age_ms':3600000}; fall-back: 30-min-dead
  daemon → {'state':'live','age_ms':0}); the capture.py:4267 comment states the opposite intent.
- **Vote NOT-REAL (dissent):** the arithmetic defect is genuine and reproduced, but the repro is a
  steady-state **emulation** — module anchors were set to the state §A1's absorb branch produces, not
  driven through a live transition — so the dissenting lens declined to confirm end-to-end reachability.
- **Disposition:** do not fix on this evidence alone; a targeted follow-up should drive `_now()` through a
  real (faked-tz) transition with a writer open, then this becomes a confirmed major with the fix being
  either stamping `heartbeat_ms` from `time.time()` directly, correcting by `absorbed_shift_sec()`, or
  publishing the absorbed shift for the union reader.

---

## Prioritized punch-list (correctness first; one gated change per line)

1. **F1** ECGDex mid-file clock-step → bound the gap walk by the phone-column delta / re-anchor; then refold
   the three poisoned 2026-08 trio exports. (Critical; three committed corpus exports are wrong today.)
2. **F6** GlucoDex column pick — one "Low" cell flips every headline metric to row numbers.
3. **F5** HRVDex d_cvi/d_csi/d_si unit misclassification — rendered clinical verdicts invert.
4. **F7** CPAPDex fabricated zero-pulse → fabricated clean oximetry night (port OxyDex optional gating).
5. **F13** dex-export scrub leak — privacy acceptance violated on every scrubbed export (spine; serialize).
6. **F9** t-only +24 h roll in oxydex-fusion + cpapdex-coimport (port the 12 h slack + tMs fast-path).
7. **F3** cvhrIndex wall-span denominator (ECGDex, then the PpgDex port as its own change).
8. **F10** PpgDex span-refusal ports (beatConfidence + cvhrFromNN) — whole-night export crash.
9. **F11** Integrator union-find grouping — order-independent fusion.
10. **F12** dex-ingest sidecar routing (CLOCKSYNC/OXYLIFE/CPAP-INVENTORY/_RR) — fails open today on every
    vigil folder import.
11. **F8** CPAPDex usageHours 0.000 on PLD-less sets (BRP fallback or honest null).
12. **F2** ECGDex app-lane fs/provenance parity with the headless DSP.
13. **F18** capture-host stale autostart relabel; **F17** CWD-relative cfg paths (both Python lane, both
    small, deploy to vigil after).
14. **F14** computeHash closure: remove oxydex-profile.js from the denylist.
15. **F15** tch multi-root disclosure/refusal; **F16** fused-point/classic-CI mixing.
16. **F4** ACC card badges (+ extend the badge DOM-walk selectors so the gate can see this class).

---

## What NOT to chase — investigated and REFUTED

- **`nightRowInner` as an unbadged surface** — refuted by execution: its `nrKpi`/`nrChip` helpers badge
  internally and all 25 labels resolve through the registry. The fleet scan's only true positives are
  `renderACCComparison` (F4) and `renderHRValidation`.
- **The shipped Section-8a CPAP TCH sigma (0.19)** — safe: `probe3.mjs` shows the real triplet is
  single-root, so F15's multi-root hazard does not retroactively taint that published figure.
- **DEEP-AUDIT-II §12.1's FALSE-POSITIVE ruling** ("oxydex-profile.js is display-only") — a *prior
  refutation that fell*: it verified only the PpgDex side and generalized. F14 is the executed
  counterexample. Update the audit row so the stale refutation stops re-seeding.
- **The H10-2019-ORIGIN annotation premise (#2039)** — "every relative quantity is sound under relative
  anchoring" is falsified for the mid-file-sync subclass (F1): the relative axis itself steps. The
  between-fragment handling in trio-batch remains correct as far as examined.
- **`ecgdex-dsp.js:1758-1759` 'beatConfidence is safe by construction'** — true for ECG (sample-index
  seconds, bounded by count), false for the PpgDex call site that feeds it time-derived pseudo-indices
  (F10). Refuting the comment's generality, not its ECG-local claim.
- Caution inherited from the charter: none of these refutations clears the surrounding code — each states
  exactly what was disproved and nothing more.

---

## Bug classes that yielded nothing — and what the absence means

Three of the charter's classes produced **zero confirmed findings this pass**, and for two of them that
absence is genuinely informative. **Class 5 (differential drift across the redundant RR→HRV estimator
paths)** turned up no rMSSD/SDNN estimator divergence — the two-lens probes that fed shared beat truth
through sibling paths found their defects elsewhere (unit thresholds, denominators, allocation guards), not
in the estimators; combined with the existing differential oracle in the suite, this reads as a genuinely
hardened area. **Class 6 (spectral honesty)** likewise surfaced nothing: no surfaced frequency-domain number
was found riding a crude proxy. **Class 11 (fabricated redundancy)** yielded no *new* instance beyond the
already-documented single-photodiode consensus case — but this class was probed only incidentally (via the
Integrator observer counts in F11, which is an order bug, not an independence bug), so its zero is weaker
evidence than the other two. By contrast, the classes that dominated the haul are the repo's known
recidivists, and the distribution itself is the finding: **class 14 (sibling divergence)** is the mechanism
behind six of the eighteen entries (F3, F7, F8, F9, F10, F17 — in every case one sibling already holds the
correct implementation, so every fix is a port, not a design), and **class 3/3a (fabricated absence)**
behind four. Finally, the standing empty cells must not read as green: the browser lane was not booted at
all this pass, and the Integrator's noisy-OR/effConf/Poisson-null arithmetic has now gone **three**
consecutive audits unexamined — that cell, not any class above, is the largest unverified surface in the
suite.
