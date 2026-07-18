<!--
  TEST-AUDIT-FINDINGS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-18 · **Created:** 2026-07-18

# Test-audit findings — 42 hollow gates (mutation testing, corpus-verified)

> **EXECUTED 2026-07-18.** 40 of the 42 findings are now closed by a new/strengthened assertion that
> **passes on clean code AND reds under the exact mutation** (both directions verified: full suite green
> at 2827 assertions / 186 groups, then all 40 mutations re-applied → each reds its own gate). Landed as
> **33 gates** (+120 assertions, +7 groups) in `tests/dex-tests.js` (+ `run-tests.mjs` / `Dex-Test-Suite.html`
> env wiring) — test-only, no bundle/provenance touched. **#59** is a proven semantic no-op (a short-circuit
> makes the mutation inert — correctly NOT tested). **#98** (`overdex-walk` async `readEntries` 100-entry
> paging) is a *real* gap with no synchronous test seam — spun, with the two out-of-scope surfaces (Python
> `capture-host/`, deep-scout wave), to `TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md`.

Executes `audits/TEST-AUDIT-PROMPT.md` (the sibling of `AUDIT-PROMPT.md` — it audits the **tests**, not
the product code: *does each gate actually fail when the thing it protects breaks?*). **99 surgical
defects** were planted in the shipped compute code; each was run against the full suite **with the real
corpus** (`DEX_UPLOADS` set, so the equiv / GATE-C legs boot). A gate that stays green under a real
defect is **hollow** — it manufactures false confidence. **42 survived** and are catalogued below, each a
reproduction by construction. Rendered dashboard (private artifact):
`claude.ai/code/artifact/b96b55bb-a740-4079-894e-9f7546c2a9a1`.

- **99 planted · 42 hollow · 55 caught · 2 inconclusive.** Severity by file-class: **27 high** (a
  surfaced *health number* silently wrong) · **15 medium** (contract / threshold / internal drift).

## Scope — and what was NOT audited (read before acting)

- **Lane:** the JS Dex suite via **`tests/run-tests.mjs`** under the real corpus. "Hollow" = **green even
  with the corpus present**, not merely on a fresh clone.
- **The Python side (`capture-host/`) was NOT mutation-audited.** It has its own `capture-host-ci`
  (`ruff --select E9,F` + **pytest**, 47 tests) but this audit did not plant defects in `polar_pmd`,
  `oxyii`, `writers`, `clockcfg`, `viatom`, `telemetry`, etc. That is a **separate, still-open** audit
  surface (a Python mutation pass would use `mutmut`/`cosmic-ray` over `capture-host/` against the pytest
  suite). Flagged here so it is not assumed covered.
- **Not exercised either:** the browser **render-coverage** rig, the **CSP** / **no-network** static
  lanes, and `verify-provenance.html` (browser). The provenance **node** sibling `verify-manifest.mjs`
  *was* cross-checked (see §Provenance below).
- **Not exhaustive:** a planned **deep-scout second wave** (fresh mutations beyond the 99, in the
  under-covered clusters) was cut off by a session rate-limit — so this is the first-wave 99, not a full
  sweep. The DSP / estimator / clock / cross-SD findings are the highest-confidence class (there
  `run-tests.mjs` is the governing gate); a handful of the 42 may be near-no-ops and warrant a glance
  before writing the fix.

## Method

Break the code a gate protects — flip a sign, drop a `−1`, swap `ms`/`s`, move a `≥`/`>` boundary, seed
an absent input to `0` — then watch whether the gate reds. Each finding below carries the exact
`old → new` and *why no gate sees it*. All 99 were applied in a throwaway git worktree and run under
`DEX_UPLOADS=<corpus> node tests/run-tests.mjs`; file/mutation/verdict are per-candidate exact.

## High severity — a surfaced value goes silently wrong (27)

| # | file · gate | invariant broken | mutation (old → new) | why no gate sees it |
|--|--|--|--|--|
| 3 | `clock.js`<br>parseTimestamp per-node conformance | In the unlocked heuristic, only a first field STRICTLY greater than 12 proves it is the day; treating 12 as a proof forces Decembe | `if (a > 12) return { d: a, mo: b };`<br>→ `if (a >= 12) return { d: a, mo: b };` | Ambiguous rows dated on the 12th of a month get their day/month swapped (e.g. 12/07 read as day 12 rather than honoring preferDMY), mis-dating December/12th-of-month reco |
| 4 | `clock.js`<br>Clock Contract — parseTimestamp | Time-only rows roll forward a day ONLY when strictly earlier than the previous stamp; using <= pushes an equal-wall-clock sample a | `while (t < opts.prevTMs) t += 86400000;`<br>→ `while (t <= opts.prevTMs) t += 86400000;` | Two consecutive HH:MM rows with the same minute (common at 1-min cadence around a repeat) make the second jump +24h, fabricating a spurious overnight gap and mis-placing  |
| 38 | `cpapdex-cross.js`<br>CPAPCross detects a step-change | Mann–Kendall S counts +1 for each later-value-greater pair; the sign encodes trend direction (τ) | `S += d > 0 ? 1 : d < 0 ? -1 : 0;`<br>→ `S += d > 0 ? -1 : d < 0 ? 1 : 0;` | Sign-flipping the concordance sum negates the reported τ (trend direction) while leaving p unchanged (p uses \|z\|); a gate that only asserts significance/p on a step-cha |
| 34 | `cpapdex-dsp.js`<br>CPAPDex DSP/EDF | Sample standard deviation divides by N−1 (Bessel), not N | `return Math.sqrt(s / (f.length - 1));`<br>→ `return Math.sqrt(s / f.length);` | _sd feeds _cov, so minVentStability (CV%) and any SD-derived surfaced number shrink systematically; the ÷N vs ÷N−1 slip is the classic silently-wrong variance defect. |
| 23 | `ecgdex-dsp.js`<br>_malikCorrect matches buildNN | _malikCorrect's RR range gate (>2000 ms) must match buildNN's gate exactly at the 2000 ms boundary. | `if (vals[i] < 300 \|\| vals[i] > 2000 \|\| dev >`<br>→ `if (vals[i] < 300 \|\| vals[i] >= 2000 \|\| dev ` | >2000 → >=2000 makes the device-RR corrector reject an exactly-2000 ms beat while buildNN keeps it, so the self-vs-device RMSSD/SDNN agreement card diverges at the bounda |
| 24 | `ecgdex-dsp.js`<br>Beat artifact | Ectopic beats deviating >20% from the local median must be corrected (Malik/Task-Force rule) so PVC/PAC jumps don't inflate rMSSD/ | `ectopyThr = ectopyThr == null ? 0.2 : ectopyThr;`<br>→ `ectopyThr = ectopyThr == null ? 0.35 : ectopyThr` | 0.20→0.35 relaxes ectopy rejection: PACs/PVCs with clean QRS and in-range RR slip through untouched, injecting large beat-to-beat jumps that silently inflate rMSSD/pNN50  |
| 27 | `ecgdex-dsp.js`<br>ECGDex sleep position | Gravity anterior axis sign maps +z→Supine / −z→Prone (chest-strap convention); supine worsens OSA so the position must be correct. | `if (Math.abs(uz) >= 0.7) label = uz > 0 ? 'Supin`<br>→ `if (Math.abs(uz) >= 0.7) label = uz < 0 ? 'Supin` | Swapping the sign flips Supine and Prone in every epoch.position and event meta.position, so the Integrator weights osaConf/AHI by the wrong posture — supine apnea burden |
| 28 | `ecgdex-dsp.js`<br>ECGDex ACC pipeline | ACC gross-motion index >20 (normalized) votes Wake; the threshold sets the ACC-vs-HRV sleep/wake consensus rate. | `vote = idx > 20 ? 'Wake (motion)' : idx >= 5 ? '`<br>→ `vote = idx > 60 ? 'Wake (motion)' : idx >= 5 ? '` | 20→60 makes genuinely-moving epochs vote Sleep(still)/Ambiguous, silently inflating the consensus agreement rate and suppressing accWakePct — which also feeds classifyMod |
| 29 | `ecgdex-dsp.js`<br>ECGDex event byte-shape | CVHR surge amplitude (6–22 bpm) maps monotonically into conf 0.45–0.95; the /48 scale sets the emitted event likelihood. | `const surgeConf = (ampBpm) => +Math.max(0.45, Ma`<br>→ `const surgeConf = (ampBpm) => +Math.max(0.45, Ma` | /48→/24 doubles the amplitude contribution so most surges saturate at conf 0.95, destroying the graded likelihood the fusion layer consumes for autonomic_surge events (we |
| 30 | `ecgdex-dsp.js`<br>Differential | Beats in confirmed-artifact seconds (beatConfidence c<0.5) must be dropped before the HRV suite so sustained over-detection bursts | `if (c >= 0.5) {         nn.push(nnRes.nn[i]);`<br>→ `if (c >= 0.0) {         nn.push(nnRes.nn[i]);` | c>=0.5 → c>=0.0 disables the sustained-artifact gate entirely: burst-noise beats that pass per-beat SQI individually flow into the NN series, inflating ECGDex RMSSD/SDNN  |
| 52 | `event-coupling.js`<br>event-coupling | A coupling 'hit' counts a B event landing anywhere in the closed window [tA+lo, tA+hi]; the upper edge is inclusive. | `if (j < sortedB.length && sortedB[j] <= t + hi) `<br>→ `if (j < sortedB.length && sortedB[j] < t + hi) h` | Making the window's upper bound strict drops boundary-exact B events from both observed and null hit rates, shifting observedPct/chancePct/lift and the desat<->surge coup |
| 19 | `glucodex-dsp.js`<br>hypo ≠ compression | A sustained deep sub-70 run is a genuine hypo unless BOTH edges are near-vertical (positional artifact signature). | `if (maxDropStep >= VERTICAL && maxRiseStep >= VE`<br>→ `if (maxDropStep >= VERTICAL \|\| maxRiseStep >= ` | AND->OR lets a genuine insulin hypo with one sharp edge be classed as a compression artifact, so it is FLAG.COMPRESSION-excluded and never surfaces as nocturnal_hypo — th |
| 47 | `hrvdex-dsp.js`<br>HRVDex §3/§4 | Poincaré SD1 = rMSSD/√2 (HRVDex node) — geometric ellipse minor axis. | `r.d_sd1 = r._rmssd / Math.sqrt(2);`<br>→ `r.d_sd1 = r._rmssd / 2;` | SD1 comes out ~29% low, which then propagates into SD2 (via 2·SDNN²−SD1²), SD1/SD2 ratio, and the DFA-α1 proxy (1 − 0.5·SD1/SD2). If no HRVDex gate pins SD1's absolute va |
| 55 | `integrator-dsp.js`<br>Positional apnea | Positional apnea is declared only when confirmed events cluster strongly supine (supine fraction >= 0.7 and >= 2x the non-supine c | `var positional = rate != null && supine >= 3 && `<br>→ `var positional = rate != null && supine >= 3 && ` | Lowering the supine-fraction threshold from 0.7 to 0.5 over-declares provisional positional apnea on merely balanced posture distributions, flipping the surfaced position |
| 59 | `integrator-dsp.js`<br>EventCoupling for desat | A desat<->surge coupling is REAL only on a usable window where observed exceeds chance, i.e. lift > 1. | `real: usable && isFinite(ec.lift) && ec.lift > 1`<br>→ `real: usable && isFinite(ec.lift) && ec.lift > 0` | lift > 0 instead of lift > 1 flags any positive-lift window as a real coupling, so sub-chance / no-coupling windows (lift between 0 and 1) are reported as genuine desat-> |
| 58 | `integrator-dsp.js`<br>correlation integrity | Pearson correlation is undefined (null) when EITHER series has zero variance; a constant series yields no correlation, not a fabri | `if (sxx === 0 \|\| syy === 0) return null;`<br>→ `if (sxx === 0 && syy === 0) return null;` | Edit applied cleanly (line 159 of integrator-dsp.js, unique match). Full corpus suite: exit 0, "all 2735 assertions passed · 2 skipped (179 groups)" — no group reddened.  |
| 69 | `oxydex-cross.js`<br>crossNightBlock | The cross-night baseline SD must be the sample standard deviation (÷N−1, Bessel-corrected), not the population ÷N. | `return Math.sqrt(s / (a.length - 1));`<br>→ `return Math.sqrt(s / a.length);` | Exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" with the real corpus. The mutation changes sd() from sample SD (÷N−1, Bessel) to population S |
| 65 | `oxydex-dsp.js`<br>OxyDex Clock | O2Ring stamps default to DMY when genuinely ambiguous; an MDY default runs the clock backward across a month/day boundary and coll | `var _order = DexClock.resolveDMY(_stamps, true);`<br>→ `var _order = DexClock.resolveDMY(_stamps, false)` | Edit applied cleanly (oxydex-dsp.js line 555, unique match). Ran `DEX_UPLOADS=/media/michal/647A504F7A50205A/Tepna/uploads node tests/run-tests.mjs` → exit 0, "all 2735 a |
| 66 | `oxydex-dsp.js`<br>Rolling-window boundary | The worst-10-min rolling scan must include the final full 600-sample window whose right edge lands exactly at n. | `for (var i = 0; i + W10 <= n; i += 60) {`<br>→ `for (var i = 0; i + W10 < n; i += 60) {` | Exit 0 — "all 2735 assertions passed · 2 skipped (179 groups)" under the real corpus (DEX_UPLOADS set). Edit applied cleanly (unique match at line 1214). No group reddene |
| 88 | `ppgdex-cross.js`<br>Cross §1 | Cross-night sample SD uses Bessel's correction (÷N−1); the population form (÷N) understates night-to-night spread and CV%. | `return Math.sqrt(s / (a.length - 1));`<br>→ `return Math.sqrt(s / a.length);` | Edit applied cleanly (line 48, unique). Ran DEX_UPLOADS=/media/.../uploads node tests/run-tests.mjs → exit 0, "all 2735 assertions passed · 2 skipped (179 groups)", zero  |
| 79 | `ppgdex-dsp.js`<br>Optical beat detector | A PPI above 2000 ms (< 30 bpm) is physiologically impossible and must be Malik-rejected as an artifact, not accepted as an NN inte | `if (v < 300 \|\| v > 2000) bad = true;`<br>→ `if (v < 300 \|\| v > 3000) bad = true;` | Exit 0 — "all 2735 assertions passed · 2 skipped (179 groups)", no failing assertion. The mutation widens the Malik upper-bound rejection threshold in ppgdex-dsp.js from  |
| 84 | `ppgdex-dsp.js`<br>PpgDex detector | The absolute detection refractory floor is 0.30 s (200 bpm ceiling); no two systolic peaks may be counted closer than this even wh | `const refrFloor = Math.round(fs * 0.3); // 200 b`<br>→ `const refrFloor = Math.round(fs * 0.15); // 200 ` | Exit 0: "all 2735 assertions passed · 2 skipped (179 groups)" under DEX_UPLOADS corpus. No group reddened. Real behavior change: refrFloor is the absolute detection refra |
| 86 | `ppgdex-dsp.js`<br>worker blob EXECUTES | The worker's onmessage glue must call detectChannel at the TRUE sampling rate the main thread transferred; the worker changes WHEN | `'var r=detectChannel(chan,d.fs);' +`<br>→ `'var r=detectChannel(chan,d.fs*0.5);' +` | Exit 0 — "all 2735 assertions passed · 2 skipped (179 groups)", no failing assertion. Edit applied cleanly (unique match at ppgdex-dsp.js:2068). REAL behavior change, not |
| 87 | `ppgdex-dsp.js`<br>PpgDex per-window PI | Perfusion index is a PERCENTAGE: PI = 100 × AC/DC. Dropping the ×100 changes the metric's unit and magnitude. | `const perfWindow = () => (dc > 0 ? r2((100 * acA`<br>→ `const perfWindow = () => (dc > 0 ? r2(acAmp / dc` | Edit applied cleanly (old_string found & unique). Ran `DEX_UPLOADS=/media/michal/647A504F7A50205A/Tepna/uploads node tests/run-tests.mjs` → exit 0, tail "all 2735 asserti |
| 48 | `pulsedex-cross.js`<br>Cross §1 | Cross-night SD uses sample ÷(N−1); the personal-baseline z-score denominator must match. | `return Math.sqrt(s / (a.length - 1));`<br>→ `return Math.sqrt(s / a.length);` | This SD is the spread published per metric and the denominator of per-night z-scores (\|z\|≥2 flags). Flipping to ÷N shrinks SD, inflates every z-score, and can trip fals |
| 40 | `pulsedex-dsp.js`<br>PulseDex §3 | Total spectral power identity: vlf + lf + hf == totalPower must hold EXACTLY (Task-Force identity). | `tp: _v + _l + _h,`<br>→ `tp: _v + _l,` | Dropping the HF term from the band-sum total makes the surfaced Total Power ~5-20% low on an overnight and breaks the reconciliation between the Total-Power hero and the  |
| 43 | `pulsedex-dsp.js`<br>Baevsky guard | Baevsky SI must convert BOTH Mode and MxDMn from ms to seconds before dividing (unit guard). | `return mo && mx ? amo / (2 * (mo / 1000) * (mx /`<br>→ `return mo && mx ? amo / (2 * mo * (mx / 1000)) :` | Dropping the /1000 on Mode makes Stress Index 1000× too small on a Welltory ms-unit export — the exact mixed-unit trap the guard exists to prevent. If the Baevsky guard g |

## Medium severity — contract / threshold / internal drift (15)

| # | file · gate | invariant broken | mutation (old → new) | why no gate sees it |
|--|--|--|--|--|
| 90 | `analysis-stats.js`<br>Analysis-page statistics kernels | OLS residual degrees of freedom = n − p; SE(β), t, p-values, CI half-widths and adjR² all divide by it. | `var df = n - p,`<br>→ `var df = n - p - 1,` | exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" (baseline 2724 — same all-green/exit-0 verdict, group count differs harmlessly). Edit applied |
| 91 | `analysis-stats.js`<br>Analysis-page statistics kernels | Within-subject CV% = 100·√varW / \|grand mean\| (a percentage). | `withinCVpct: grand ? (100 * Math.sqrt(varW)) / M`<br>→ `withinCVpct: grand ? (10 * Math.sqrt(varW)) / Ma` | Exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" under the real corpus. The edit applied cleanly and is a real behavior change: withinCVpct =  |
| 8 | `crossnight-envelope.js`<br>Cross-night baseline mean/sd published | The 'below-2sigma' outlier flag fires only at z ≤ −2; lowering the cut to −1.5 tags moderate (−1.5σ) nights as 2σ outliers. | `if (z <= -2) return 'below-2sigma';`<br>→ `if (z <= -1.5) return 'below-2sigma';` | Nights between −1.5σ and −2σ get the alarming below-2sigma flag surfaced in the envelope metric, over-stating how anomalous a night was. |
| 9 | `crossnight-envelope.js`<br>Node-export validator — validateNodeExport | A node-export event must carry a NON-EMPTY impulse name; dropping the '' check accepts a blank-impulse event as structurally valid | `E(typeof e.impulse === 'string' && e.impulse !==`<br>→ `E(typeof e.impulse === 'string', 'ganglior_event` | validateNodeExport stops reporting an empty-string impulse as an error, so a malformed export with unnamed events passes conformance and its events reach fusion unnamed. |
| 93 | `ecgdex-profile.js`<br>Per-node profile personalization | Estimated-AHI confidence band lower bound = 0.7·CVHR index (±30% honest band). | `lo: +Math.max(0, idx * 0.7).toFixed(0),`<br>→ `lo: +Math.max(0, idx * 0.5).toFixed(0),` | Exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" (11 more than the corpus-absent baseline of 2724, since uploads/ enables the corpus legs — st |
| 95 | `glucodex-profile.js`<br>Per-node profile personalization | Expected GMI reference for pre-diabetes ≈ 5.9% (distinct from the diabetic 6.8%). | `return diab === 'none' ? 5.4 : diab === 'predm' `<br>→ `return diab === 'none' ? 5.4 : diab === 'predm' ` | Exit 0 — "all 2735 assertions passed · 2 skipped (179 groups)" (corpus run adds assertions above the 2724 baseline, still all green). The mutation is a REAL behavior chan |
| 96 | `hrvdex-profile.js`<br>HRVDex profile | Male 50–54 ACSM VO₂ norm: Very-Poor/Poor cut at 26.1 mL/kg/min. | `'50-54': [26.1, 30.9, 33.8, 37.4],`<br>→ `'50-54': [30.1, 30.9, 33.8, 37.4],` | Edit applied cleanly (old_string unique) to the worktree copy of hrvdex-profile.js. Ran `DEX_UPLOADS=/media/michal/647A504F7A50205A/Tepna/uploads node tests/run-tests.mjs |
| 73 | `manifest-gate.js`<br>Fixture verification | GATE B's overall verdict `ok` must be false whenever any fixture failed (fail>0). | `return { results: results, checked: checked, fai`<br>→ `return { results: results, checked: checked, fai` | Exit 0; "all 2735 assertions passed · 2 skipped (179 groups)". Edit applied cleanly at line 337 (unique match). Real behavior change: gateBEvaluate now returns ok:true ev |
| 74 | `manifest-gate.js`<br>Manifest JSON well-formed | GATE A's `ok` must be false on any bundle manifestHash drift/missing-current (fail>0). | `return { results: results, checked: checked, fai`<br>→ `return { results: results, checked: checked, fai` | exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" (baseline said 2724 but the pattern matches: all passed, 2 skipped, exit 0 — green). Edit app |
| 75 | `manifest-gate.js`<br>Fixture verification | gateBFiles must enumerate every code-gated fixture's INPUT files so the caller fetches+hashes them for GATE B. | `var ih = (fixtures[name] \|\| {}).inputHashes \|`<br>→ `var ih = {};` | Edit applied cleanly at manifest-gate.js line 248 (OLD string was unique). Ran `DEX_UPLOADS=/media/michal/647A504F7A50205A/Tepna/uploads node tests/run-tests.mjs` → exit  |
| 78 | `metric-registry.js`<br>Cohesion single-source | A metric whose registry evidence tier is unknown/missing must fall back to the LOWEST-trust tier ('experimental'), never to a high | `evidence: EVIDENCE[r.evidence] ? r.evidence : 'e`<br>→ `evidence: EVIDENCE[r.evidence] ? r.evidence : 'v` | Exit 0; "all 2735 assertions passed · 2 skipped (179 groups)" — no group reddened. Edit applied verbatim (unique match) in the worktree copy of metric-registry.js. The mu |
| 97 | `nsrr-adapter.js`<br>NSRR PSG ingest | When an entire SpO₂ channel is invalid, the seeded baseline is 97% (a physiologic normoxic default). | `if (firstValid == null) firstValid = validLo ===`<br>→ `if (firstValid == null) firstValid = validLo ===` | Edit applied cleanly. Full corpus suite exit 0: "all 2735 assertions passed · 2 skipped (179 groups)" — zero failing assertions, so no gate caught it. (Assertion count 27 |
| 98 | `overdex-walk.js`<br>OverDex folder walker | readEntries must accumulate every 100-entry batch (directory listings are paged at 100). | `all = all.concat(Array.prototype.slice.call(batc`<br>→ `all = Array.prototype.slice.call(batch);` | Edit applied cleanly. Ran `DEX_UPLOADS=/media/michal/647A504F7A50205A/Tepna/uploads node tests/run-tests.mjs` → exit 0, tail "all 2735 assertions passed · 2 skipped (179  |
| 94 | `oxydex-profile.js`<br>OxyDex profile | Absolute VO₂ (L/min) = relative VO₂ (mL/kg/min) × weight(kg) / 1000. | `return rel > 0 ? +((rel * UP.weight) / 1000).toF`<br>→ `return rel > 0 ? +((rel * UP.weight) / 100).toFi` | Exit 0; suite printed "all 2735 assertions passed · 2 skipped (179 groups)" (corpus run count; baseline-equivalent all-pass). Mutation is a REAL behavior change, not a no |
| 92 | `qrs-equiv-analysis.js`<br>Analysis-kernel coverage | Bland–Altman percent bias = 100·bias / mean(reference) (a percentage). | `biasPct: mb ? (100 * bias) / mb : null`<br>→ `biasPct: mb ? (10 * bias) / mb : null` | Exit 0; suite reported "all 2735 assertions passed · 2 skipped (179 groups)" under the real corpus (no ✗). Edit applied cleanly (unique match at line 223). This is a REAL |

## Provenance cross-check (`manifest-gate.js`)

The mutation agents ran only `run-tests.mjs`; the provenance gate has a separate node sibling
`verify-manifest.mjs`. Re-running the six `manifest-gate.js` mutations against **it**: **#70/#71/#72**
(output-, code-, input-drift *detection*) are **caught** — the drift machinery works, so they were
reclassified out. **#73/#74/#75** (the verdict-`ok` computation and `gateBFiles` input enumeration) slip
**both** node lanes and remain above; they may still be caught by `verify-provenance.html` (browser,
via `window.__gateA_ok`/`__gateB_ok`) — **owed:** a browser check.

## Fix the class, not the instance — proposed meta-gates

1. **Cross-night SD is untested in every `*-cross.js`.** The Bessel `÷N−1` → population `÷N` slip
   survives in oxydex-, ppgdex-, pulsedex-, cpapdex-cross and crossnight-envelope (ids 34, 48, 69, 88 +
   the class). One shared known-answer over `sd()` with a hand-computed sample SD kills all of them.
2. **Plant fixtures AT the boundary, not near it.** Edges go untested because no committed input lands on
   them: a beat at exactly 2000 ms (#23), the worst-10-min window ending on the last sample (#66), a
   coupling B-event at `t+hi` (#52), an all-day-≤12 ambiguous O2Ring night (#65), in-band 20–35% ectopy
   (#24), the roll-forward equal-minute case (#4). Add adversarial-but-real committed twins.
3. **Pin the surfaced-but-unexported metrics.** Baevsky SI (a real **×1000** unit slip, #43), perfusion
   index `×100` (#87), SD1 `/√2`→`/2` (#47), worst-10-min SpO₂ (#66), the profile VO₂/GMI values reach
   the user's eye but never the committed export, so the equiv/GATE-C leg is blind. Assert them with
   direct known-answers — don't lean on `compute()≡export`.
4. **Test the provenance gate's own verdict.** GATE A/B `ok` can be forced `true` and `gateBFiles` can
   drop every input with no node-lane test noticing (#73/#74/#75). Add a self-test that feeds a
   known-failing fixture and asserts `gateBEvaluate().ok === false` — audit the auditor.
5. **Execute the worker glue.** The PPG blob-execute rig reconstructs the deps but omits the
   `onmessage` line, so a wrong `fs` passed to `detectChannel` is invisible (#86). Assert the real fs
   the glue posts.

## Done when

Each hollow gate is closed the charter's way: **add the failing assertion FIRST** (prove the mutation
reds it), then fix the fixture/known-answer so the class can't regress. Land the five meta-gates (§above)
rather than 42 one-offs where a class-gate subsumes them. Re-run this audit's mutations to confirm each
now reds. Spin the **Python (`capture-host/`) mutation pass** and the **deep-scout second wave** as their
own follow-ups (`-FOLLOWUPS`). This brief flips to DONE when every finding above is either gated or
explicitly dispositioned (near-no-op / intentional) in a follow-up.
