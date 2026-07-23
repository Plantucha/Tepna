<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-23 · **Created:** 2026-07-22

# Deep audit (2026-07-22) — 16 verified findings, all shipped

Executed `AUDIT-PROMPT.md` against the suite as a **16-hunter workflow** (one hunter per charter bug
class + the two scopes the charter flags as chronically under-audited: `capture-host/` and the
Integrator's fusion arithmetic). Every finding was established by **executing the real module in
`node:vm`** (mirroring `tests/run-tests.mjs`), then faced **two independent adversarial verifiers** —
one refuting-by-execution, one checking the sibling implementations + the out-of-scope/known-non-issue
list. **18 candidates → 16 CONFIRMED, 0 plausible, 2 refuted.** All 16 are now **fixed on `main`** across
five PRs (#377, #378, #380, #381, #383).

**Baseline was green before the audit** (node lane 3712 assertions; GATE A 9 bundles + GATE B 25 fixtures).
Several findings **contradicted a DONE brief header or a post-fix comment** — verified against the tree,
not the header, exactly as the charter warns.

**Scope caveat:** the audit ran **headless (`node:vm`) only** — the **browser lane**
(`Dex-Test-Suite.html?full`, `verify-provenance.html`, the render-coverage rigs) is NOT covered (no
headless path; its Node siblings ran green). `capture-host/` and the Integrator's fusion arithmetic
**WERE** covered by dedicated hunters (they produced findings B, F/G-adjacent and L).

---

## Findings (correctness-first) — all EXECUTED + shipped

### 🔴 mis-states a surfaced number / fabricates absence
- **§A — Integrator `fuseHRVConsensus` reads the wrong SDNN axis** (`integrator-dsp.js`). Consensus
  compared PpgDex on the baseline-wander-inflated whole-record `summary.sdnn` (~+26 % vs ECG) instead of
  the cross-node-comparable `sdnnRobustMs` (~+3.5 %), surfacing a **~23 % "divergence"** (and, past 30 %,
  a false `qc:'divergent'` data-quality flag) when true agreement is ~3 %. The sibling `fuseHrvResource`
  already used the robust axis. **✅ PR #377.**
- **§B — Integrator positional-apnea posture fabricates a whole night from one snapshot**
  (`integrator-dsp.js`). Posture was the only one of the three per-epoch MotionDex series that was **not
  tri-state**: `_motionPostureSeries` hold-last-value-expanded one early `supine` across a multi-hour
  sensor-off gap, so `positionalApnea` counted apneas in the gap as supine (a manufactured clinical
  finding). Fixed with a bounded 60-min hold; a gap now reads `unknown`, out of the denominator.
  **✅ PR #383.**

### 🟠 contract / provenance drift
- **§C — Clock Contract §2.7 range validation missing in three node-local parsers** (`glucodex-dsp.js`
  `_ckParse`, `ppgdex-dsp.js` `parseTimestamp`, `cpapdex-dsp.js`/`cpapdex-edf.js`). Each fed
  regex-captured components straight to `Date.UTC`, which silently ROLLS an out-of-range stamp onto a
  wrong instant (`25:00`→+1 day; Feb 30→Mar 2). `clock.js:_ckMk` was the correct reference the three
  diverged from. Added `_ckMk`-style round-trip guards (ISO `24:00:00` preserved). **✅ PR #383.**
- **§D — PulseDex Coospo/Wahoo MDY dates parsed as DMY** (`pulsedex-dsp.js` `parseRRInput` +
  `adapters/coospo-rr.js`/`wahoo-rr.js`). `parseRRInput(raw)` took no opts and ran no file-level
  `resolveDMY`, so the adapter's documented `preferDMY:false` was **structurally impossible to apply** —
  an ambiguous single-night date (both fields ≤12, e.g. `03/05/2026`) anchored to the wrong month,
  corrupting `t0Ms` / the crossnight axis / the Integrator join date. Fix: `parseRRInput` gains an
  optional-last `opts.preferDMY` + a file-level `DexClock.resolveDMY`; the adapters pass `preferDMY:false`.
  **⚠️ This was the ONE unit omitted from the first fix sweep** — caught while enumerating the findings to
  author this brief, and independently re-found by the pass-2 hunt. **✅ shipped 2026-07-23 (PR #391).**

### 🟡 silent failure / robustness
- **§E — HRVDex Toichi CSI 1000× on a seconds-consistent HRV vendor** (`hrvdex-dsp.js`). `d_csi` /
  `d_mxdmn_meanrr` divided a `guardBaevsky`-normalized MxDMn by a hard-`/1000` MeanRR; a fully-seconds
  vendor breaks it. Routed MeanRR through the same `DexUnits` guard. Latent (real ingest is
  mixed-convention). **✅ PR #383.**
- **§F — ECGDex orchestrate export omits `apnea`/`hrvStability`** (`ecgdex-dsp.js`). The raw-file→OverDex
  path dropped CVHR/estAHI/autonomic-slope the Integrator reads, so the same nocturnal ECG fused
  differently by ingest route; the app's `buildV2` carried them. Added to the rich branch. **✅ PR #383.**
- **§G — ECGDex opening electrode transient collapses R-peak detection for the whole night**
  (`ecgdex-dsp.js` `detectPeaks`). The stall-recovery bleed was gated `rrAvg>0`, which never becomes true
  when a sharp transient is the first threshold crossing → 1 peak → `compute()` throws "not ECG" on a
  clean multi-hour night. Dropped the `rrAvg>0` precondition. **✅ PR #383.**
- **§H — MotionDex `classifyGravity` uses a divergent posture scheme** (`motiondex-dsp.js`). Argmax /
  Y-priority vs the ECGDex/PPGDex fixed-threshold Z-first scheme → over-reports supine across the
  intermediate-tilt band; the Integrator merges the labels as interchangeable. Ported the sibling scheme.
  **✅ PR #381.**
- **§K — PpgDex unanchored `fnameStampMs`** (`ppgdex-app.js`). An all-digit Polar serial before the date
  was consumed AS the date (→ year 0292), silently dropping ACC/GYRO/MAGN/PPI companions. Anchored to the
  sibling form. Latent (corpus uses lettered serials). **✅ PR #383.**

### 🟢 evidence honesty / hygiene
- **§I — HRVDex full-metrics table: 34 columns render real numbers unbadged** (`hrvdex-render.js:1432`
  — the only `evBadge(..., false)` in the fleet — + registry label drift). Added registry aliases + the
  fleet-default fallback. **✅ PR #383.**
- **§J — HRVDex declares six removed cuffless-BP columns** (`hrvdex-render.js` TABLE_COLS), rendering
  permanent `—mmHg` blanks — an incomplete WP-A removal. Deleted the dead columns. **✅ PR #383.**
- **§L — capture-host stale O2Ring pleth comment** (`capture-host/capture.py`) claimed the removed
  ppg0/1/2 replication; corrected to the single-`ppg1` write path. Doc-only. **✅ PR #378.**
- **§M — no regen tool for the HRVDex + ECGDex code-gated synthetic goldens** (`tools/regen-goldens.mjs`
  — a class-13 empty cell). Added `tools/regen-hrvdex-goldens.mjs` + `tools/regen-ecgdex-goldens.mjs`.
  **✅ PR #380.**

---

## What NOT to chase — investigated and REFUTED (mandatory section)
- **PulseDex Welltory-comparison table "unbadged" columns** — an intentional source-attributed
  peer-export echo, explicitly exempt (`BADGE-PLACEMENT-SWEEP-FOLLOWUPS §2`); badging a third party's
  numbers with a Tepna registry would mis-grade them.
- **capture-host GYRO/MAG 8× full-scale mis-scale** — reproduces only on a *fabricated* multi-range
  device; real Polar hardware returns a single-valued range list, so all three code paths coincide.
- **MotionDex posture X-sign / left-right inversion** — immaterial: `supineFrac` is L/R-independent and
  the uncalibrated X axis has no grounded sign. Only the supine-band **scheme** half of §H stands.
- **HRVDex `d_cvi` / PulseDex `siCalc` unit-dependence** — internally consistent (both operands from the
  same vendor), correct — a milder definitional dependence, not a mixed guarded/unguarded pair.

---

## §Residue — pass 2 (2026-07-23)
A **second deep-audit pass** (node-oriented deep hunters over the areas this pass under-covered —
Integrator fusion math, OxyDex/PulseDex/CPAPDex/GlucoDex, cross-node, sibling divergence) was run
2026-07-23. It was **not dry: 11 confirmed-new + 1 plausible**, verified by two adversarial refuters each.
Highlights — **OxyDex ODI-3 metric family bypasses the artifact self-gate** (headline AHI/hypoxic-burden
inflated ~2.4× on artifact nights); **CPAPDex silently drops device-scored generic "Apnea" events from
residual-AHI** (~44 % understated); **GlucoDex reclassifies gradual Level-1 (61-69 mg/dL) nocturnal
hypoglycemia as a compression artifact** (a hypo made invisible); **HRVDex `d_pns_eff`/`d_ari` fabricate 0
when rMSSD is absent** (the latter fires a false red "recovery collapse" alert); **OxyDex Sleep Pressure
Index inverts** on undetectable-onset nights; **PulseDex vs HRVDex "PNS Efficiency" differ 100×**; plus an
OxyDex Azarbarzin-badge mislabel and two PPGDex badge omissions. **Plausible (owner call):** HRVDex
`d_bap` computed from population-default anthropometrics. These are being fixed and merged on 2026-07-23;
the full pass-2 record lands as `DEEP-AUDIT-2026-07-22-FOLLOWUPS-2026-07-23-BRIEF.md`.

## Execution notes (how the fixes landed)
Gate-cost lesson banked for the fleet: **a DSP change to an inlined node re-bundles not just `build.mjs`
but the served docs (`build-docs.mjs`) and any analysis page that inlines it (`build-analysis.mjs`)** —
neither is caught by `build.mjs --check`, only by the CI deploy-drift guards. The five
orchestrator-serialized DSP fixes were combined into one PR (#383) to avoid the `OverDex`/`Data Unifier`
chokepoint (both inline the node DSPs, so parallel DSP PRs collide on those generated bundles). A
corpus `verify-fixtures.mjs` re-verification is **owed at release time** for the `computeHash`-moving
DSP edits (no fixture *output* moved; `tools/release.mjs` blocks a release until it is run).

## Done when
- [x] All 16 findings executed with a failing-assertion / triggering-input / re-run repro, verified RED-first.
- [x] Each shipped through its gate (node suite green, `build --check` clean, `verify-manifest` GATE A/B).
- [x] All five PRs merged green through CI (including browser-gates on #383); no `--admin` bypass.
- [x] REFUTED section recorded so the next auditor does not re-derive dead leads.
