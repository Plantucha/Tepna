<!--
  oxydex-dsp-changelog.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# OxyDex DSP — historical changelog

> Moved out of `oxydex-dsp.js` (DEX-EVENT-UNIFY-AND-CSV-BRIEF Task C1) — that is git's job.
> For changes after this archive, see `git log -- oxydex-dsp.js`.

```
Changelog:
  v22.36 — ODI ceiling-baseline fix: detectODI now measures desaturations against a
           trailing high-percentile (p90) "ceiling" baseline (computeCeilingBaselineArr)
           instead of the trailing MEAN (computeBaselineArr). The mean was dragged down by
           closely-spaced dips in severe OSA, sinking the bl−4% threshold and hiding later
           events → a severity-proportional ODI undercount (synthetic v1.6 cohort: severe
           mean bias ≈ −31 ev·h⁻¹). The ceiling tracks resting SpO₂ and is not suppressed
           by the dips it counts; severe bias roughly halved, gradient flattened, `none`
           stratum not inflated. AHI surrogate ×1.1 retained (re-examined, not over-shooting).
           See OXYDEX-ODI-CEILING-FIX-BRIEF.md.
  v22.35 — All Ranked Metrics: replaced full-width ss-row layout (label 150px |
           bar stretch | value 70px) with compact metric-card grid; each ranked
           metric is now a .metric.metric-secondary card with label, value, and
           a mini progress bar inside — same card style as the rest of nightDetail,
           label and value are always adjacent; the section header changed from
           .ss-rank-label to .sec-label for visual consistency
  v22.34 — research dump string label overflow fix:
           Long string values ("No significant difference", "Abrupt (obstructive)",
           "Early worst (supine/onset)") were 18px bold and overflowing card bounds;
           all string values in renderResearchMetrics now receive the 'lbl' CSS class
           in addition to their colour class (e.g. 'bad lbl', 'warn lbl', 'lbl');
           .m-val.lbl sets font-size:13px, line-height:1.35, font-weight:600 so
           labels wrap cleanly inside the card; .m-val globally gains
           overflow-wrap:break-word as a last-resort safety net for all tiers
  v22.33 — research dump size and color coding fix:
           A second .metric-research CSS block (line 895) survived earlier audits
           and was still setting opacity:.65 + border-style:dashed + font-size:14px
           on all research metric values — causing them to be smaller and colourless
           vs primary (24px) and secondary (18px) metrics; also two [data-tier]
           attribute selectors were shrinking secondary (.m-val 16px) and research
           (.m-val 13px) values independently of the .metric-* class overrides
           Fixes: .metric-research now matches .metric-secondary sizing (18px, no
           opacity, no dashed border, 12px radius, 10/12 padding); stale data-tier
           font-size rules removed; renderResearchMetrics now classifies each value:
           positive numbers → blue (default research colour), zero → muted grey,
           negative numbers → amber, string labels matched against word lists for
           good/warn/bad (e.g. 'Stable'→good, 'Worsening'→bad, 'Moderate'→warn)
  v22.32 — accordion headers fully unified with sec-label:
           The accordion "box" (border, border-radius, padding, background) was
           still visually distinct from the flat Cross-Signal sec-label even after
           v22.31; complete rewrite of accordion CSS:
           • .research-accordion: stripped border, border-radius, overflow:hidden
             — wrapper is now invisible (margin:0 only)
           • .research-accordion-header: matches .sec-label exactly — same
             font-size, letter-spacing, text-transform, color, margin, font-weight;
             padding and background removed; hover lightens text instead
           • Added .research-accordion-header-line span between title and chevron
             to replicate the .sec-label::after horizontal rule; HTML updated for
             all three accordion headers (Composite, Clinical, Research Dump)
           • .research-accordion-body: padding removed from both states so inner
             content aligns flush with the rest of the page
           • Inner .sec-label top margin reduced to 6px (was 22px) to avoid
             double-spacing below the header
           • Multi-night Tier 4 stats (NSI Mean, SpO2 CV, PB Trend, Poor Nights,
             ODI-4 Δ, SOL Trend) merged into one .grid — now flow horizontally
             like the Best/Worst/R²/Trend row above them
           • Research accordion headers: purple→grey (var(--text3)), matching
             letter-spacing (.1em), transparent background — Composite Scores /
             SpO₂ Advanced / Clinical Hypoxic / Extended Signal headers now
             visually match Cross-Signal sec-label
           • Removed opacity:.7 and border-style:dashed from research-tier metrics
             so good/warn/bad color coding is as vivid as primary/secondary metrics
           • Accordion border changed from purple dashed to subtle solid white
  v22.30 — 1 real bug found:
           exportCSV: if(n.desat) guarded the DESATURATION PROFILE block but
           then accessed n.desat.nadir.count/.meanDepth/.meanDuration/.meanRecovery
           without checking n.desat.nadir first; on old-format JSONL re-imports
           where desatProfile was written before the nadir sub-object was added,
           n.desat.nadir is undefined → TypeError crash on CSV export; fixed by
           caching var _nd = n.desat.nadir || {} before the lines.push call
           Other checks (all clear): JS syntax ✓ brace balance ✓ onclick handlers ✓
           CSS custom properties ✓ avg()/stdDev() empty-array guards ✓
           chained property accesses in rendering all guarded ✓
           no eval/with/__proto__/XSS patterns ✓
  v22.29 — guard remaining 4 bare getElementById writes:
           results (parse-failure innerHTML), sidebarStatus (textContent),
           sidebarInfo (innerHTML), topbarSub (textContent) — all target
           permanent structural elements present from page load so risk was
           minimal, but replaced with safeSet() for codebase consistency;
           results in the scrollTo helper (line 8198) already had a null
           guard and needed no change
  v22.28 — 2 fixes (Issues 3 & 4 from external audit):
           Issue 3 — Null dereference on profile field access:
             upFromDOM/upToDOM and profileAutoDetectUpdate called
             document.getElementById('profXxx').value directly; if any
             element is absent the app throws TypeError; added gv(id)/sv(id,val)
             null-safe helpers and replaced all 14 bare .value accesses
           Issue 4 — Silent parse failures with no user feedback:
             parseSummaryCSV errors were logged to console and stored in
             _csvParseErrors but only surfaced when ALL nights failed;
             partial-failure warnings (e.g. one malformed file in a batch)
             were silently discarded; now shown as a dismissable amber banner
             at the top of results after successful render; reader.onerror
             also now records the filename before resolving null
           (Issues 1 & 2 from audit were false positives: parentheses inside
             a comment string and bracket inside a string literal — not real bugs)
  v22.35 — BLUNTED_AROUSAL threshold calibration:
           • old: divergePct >= 50%, no minimum episode count → fired on any
             night with >=1 osc window and 0 HR spikes (15/18 nights in test set)
           • new: divergePct >= 75% AND osc.episodeCount >= 6
           Root cause: CPAP suppresses arousal-driven HR spikes by design, so
           0 spikes is the norm — not pathology; any osc window (even ep=1)
           produced divergePct=100% and triggered the flag
           Validated against 18-night dataset: 15→11 nights flagged; 4 removed
           false positives had ep=1,1,3,4; 11 retained all have ep>=6 with
           genuine PB burden and no arousal coupling
           Diverge% nightDetail chip warn/bad boundary raised from 50→75 to match
  v22.26 — 2 fixes:
           • v22.25 regression: removing the spike timeline from inside the
             if(nights.length>=2) block also stripped its closing brace, leaving
             the block permanently open; the parser reached the catch() clause
             with an unclosed try{}, producing "Unexpected token 'catch'" and
             "renderAll is not defined" — fixed by restoring the missing }
           • Karvonen chart was missing a chart-title element (all other charts
             have one); added "Readiness & Zone 2 Target per Night (% HRmax)"
  v22.25 — Spike Timeline layout fix:
           • viewBox W changed 320→460 to match all other charts; the 320-wide
             viewBox produced a taller aspect ratio than 460-wide line/bar charts
             so width:100% scaling made it appear oversized on desktop
           • moved to after the Karvonen chart — last chart before Night Summary;
             gated on at least one night having spikes (no empty canvas on
             spike-free datasets)
  v22.24 — 1 bug fixed in parseJSONL:
           • period fallback was a dummy object {detected:false, pattern:'', avg:0}
             instead of null when no periodicity was stored in the JSONL export;
             n.period was therefore always truthy for JSONL-imported nights, causing
             exportCSV to write a phantom "HR Periodicity, avg 0min" line into
             every exported CSV for every JSONL-sourced night regardless of whether
             a periodic HR pattern had ever been detected; fixed by using null
             as fallback (with a .pattern guard so real periodicity objects are
             still passed through), matching the detectPeriodicity return convention
  v22.23 — 2 bugs fixed in parseSummaryCSV sleepArch (root cause: kv key trim):
           • parseSummaryCSV builds kv with parts[0].trim(), stripping all leading
             spaces from stored keys. n('  KEY') therefore always returns null because
             kv never contains space-prefixed keys. The pattern n('  KEY') || n('KEY')
             works because the first always returns null and || falls through; but
             fields with ONLY an indented lookup and no unindented fallback are broken.
           • sleepArch.wasoMin: v22.22 corrected the != null guard logic but kept
             both lookups indented — n('  WASO Duration (min)') and n('  WASO %') —
             so wasoMin was still always null on summary CSV re-imports; fixed by
             removing leading spaces from both key strings
           • sleepArch.solMin: n('  Sleep Onset Latency (min)') — indented single
             lookup, no fallback, permanently null; fixed by removing leading spaces
           Impact: WASO and SOL were always '—' in Smart Summary Sleep tab and
           night-row chips for every summary CSV re-import; Sleep Pressure Index
           (SPI) also always null for those nights
  v22.22 — 5 bugs fixed in parseSummaryCSV (all summary CSV re-imports affected):
           • parseSummaryCSV: spikes variable was referenced in night_obj but never
             declared — threw ReferenceError inside blocks.forEach, caught silently by
             readFile's try/catch, causing ALL summary CSV re-imports to return zero
             nights (complete round-trip failure); fixed by declaring
             var spikes = _spikesCount > 0 ? { length: _spikesCount } : []
             from the 'HR Spikes' CSV field, matching the {length:N} convention used
             by parseJSONL for spike-count-only data
           • parseSummaryCSV wasoMin: n('  WASO Duration (min)') || (...) lost
             WASO=0 (perfect sleep with no waking) because 0 is falsy; replaced with
             != null guard — same pattern as v22.21 SBII fix
           • parseSummaryCSV pred3p.pred3p: || chain lost pRED-3p=0%; fixed with
             != null guard
           • parseSummaryCSV desSev.desSev: || chain lost DesSev=0; fixed with
             != null guard
           • parseSummaryCSV cross.autoArousalIdx: || chain lost AAI=0 (calm night
             with no spikes and no ODI-4 events); fixed with != null guard
  v22.21 — 3 logic/data bugs:
           • computePatternScores: cross.crcIdx null coerces to 0 in numeric
             comparison (null < 0.2 = true); for any night where CRC index
             is undefined (no PB windows), CS probability score was silently
             incremented, potentially promoting a normal night to 'Possible'
             Cheyne-Stokes; fixed with != null guard
           • parseSummaryCSV SBII: multi-|| chain (n(k1)||n(k2)||n(k3)||n(k4))
             loses value 0 because 0 is falsy — falls through all alternatives,
             returning null; SBII=0 (pristine night, no desaturations) was
             discarded; fixed with explicit != null ? v : fallback pattern
           • computeSmartSummary: WASO/SleepEff missing from ranked metrics
             for JSONL imports (sleepArch is null in JSONL); added motSleep
             fallback so Sleep tab of Smart Summary populates from sleepQuality
             data that IS available; also added sleepEff/waso keys to sleepKeys
  v22.21 — 3 logic/data bugs (above) +
  v22.20 — 13 bugs fixed:
           • motion heatmap crash: mp.windows.forEach threw TypeError for
             JSONL imports; renderer now guards, exportJSON writes windows:[]
           • stab.gradeClass undefined for JSONL/summary CSV; derived inline
           • T-Index all-zeros for JSONL; tIdx[95]/[90] seeded from stats
           • Smart Summary Sleep tab: falls back to motSleep when sleepArch null
           • VO₂max rmssdAdj formula inconsistency between summary/raw paths
           • VO₂max stale JSONL stored values corrected on re-import
           • recomputeFromProfile VO₂max: rmssdAdj was not applied and
             vo2Low/vo2High/vo2Category were not updated on profile change;
             fixed to apply full formula, update range and ACSM category
           • exportCSV COMPOSITE INDICES section header: only written when
             n.vagal existed; computeVagalIndex requires extras so vagal can
             be null while recIdx/sleepP/etc are non-null — header is now
             written when any of the 7 sub-fields exist
           • exportCSV SIGNAL PROCESSING section header: only written when
             n.dfa existed; DFA requires 256+ samples so header was missing
             for short recordings where fft/hrEnt/ssi are non-null — header
             now written when any of the 5 sub-fields exist
           • parseSummaryCSV sleepArch: wasoMin now reads WASO Duration (min)
             directly instead of computing from WASO%; solMin now parsed from
             Sleep Onset Latency; ultradianCycles/Valleys added
           • parseSummaryCSV ct94: CT<94 THRESHOLD section now parsed
           • flag severity: 23 of 28 flag codes got wrong severity on
             summary CSV re-import due to crude indexOf('HIGH') matching;
             extracted a shared _flagSev() helper used by buildFlags,
             parseSummaryCSV, and parseJSONL — all three paths now agree
           • buildFlags T95_HIGH: was sev:'warn', parseJSONL and
             parseSummaryCSV both derived it as 'bad'; aligned to 'bad'
           • computeKarvonenZones: durationMin defaulted to 360 when
             rows=null (recomputeFromProfile, parseSummaryCSV); added
             durationMinHint param; both call sites now pass actual duration
           • parseSummaryCSV karv: used a manual 3-tier RMSSD-only readiness
             formula (rmssd≥0.5→75) with hrFloor as HRrest, producing
             'Good'/'Moderate' for nights that should be 'Low'/'Rest Day';
             now calls computeKarvonenZones with all 5 scoring components,
             profile HRrest override, and actual durationMin
           • computeSmartSummary: sbii, pred3p, desSev, wtdsi were listed
             in the spo2Keys category map but never pushed to the ranked
             metrics list; all four now included with appropriate scoring
           • parseSummaryCSV ct94: CT<94 THRESHOLD section now parsed and
             wired into night_obj so computeSmartSummary gets the CT<94% metric
           • motion heatmap crash: mp.windows.forEach threw TypeError for
             JSONL imports (motionProfile.windows not exported); renderer
             now guards with if(mp.windows && mp.windows.length), and
             exportJSON writes windows:[] so re-imports are clean
           • stab.gradeClass undefined: Sleep Stability card rendered
             class="stab-metric undefined" for JSONL/summary CSV nights
             (only set by computeSleepStabilityScore, not stored in either
             format); renderer now derives it inline; parseSummaryCSV adds
             it as a getter
           • T-Index all-zeros in JSONL: tIdx was always {} on JSONL import;
             parseJSONL now seeds tIdx[95] and tIdx[90] from stats.t95pct /
             stats.t90pct so the two most clinical rows show correctly
           • Smart Summary Sleep tab empty for JSONL: tab only used sleepArch
             (null in JSONL); now falls back to motSleep (sleepQuality) for
             Sleep Eff, WASO %, and Positional Shifts
           • VO₂max rmssdAdj formula inconsistency: summary-mode path used
             3-tier thresholds (rmssd≥0.5→+1.5) giving the OPPOSITE sign vs
             raw-CSV path; for rmssd≈0.52 this was +1.5 vs -0.9, a 2.4
             ml/kg/min gap between identical nights loaded via different paths.
             Both paths now use the same formula: (rmssd-1.4)×1.05, capped ±3
           • VO₂max stale JSONL stored values: older exports stored vo2est =
             15.3×HRmax/HRrest without applying rmssdAdj (adj was computed and
             stored separately but never added); parseJSONL now recalculates
             vo2est = base + dfaAdj + rmssdAdj from stored fields on import
  v22.19 — 4 parseJSONL bug fixes:
           • flags: all flags re-imported from JSONL received sev='info',
             erasing red/amber color coding; now applies same severity
             derivation as parseSummaryCSV (CRITICAL/T95_HIGH→bad,
             PERIODIC/BLUNTED/ELEVATED→warn, OK→ok, else info)
           • hrv.n: sample count was not mapped from JSONL; CSV re-export
             of a JSONL-loaded session wrote NaN to the Samples field
           • spike count roundtrip: when a summary-mode night was exported
             to JSONL and re-imported, hr_spikes.count was discarded because
             only the (empty) events array was used; now falls back to
             count → {length:N} summary object so "N HR spike(s)" renders
           • mos / ahiEst null on JSONL import: McGill Oximetry Score and
             AHI estimate sections were always blank; both functions only
             need scalars (odi4Rate, ct90s / odi3Rate, desSev, t95pct)
             that are all present in the JSONL — now recomputed inline

           • computePatternScores: BLUNTED_AROUSAL flag check used exact
             string match ('BLUNTED_AROUSAL') but buildFlags emits
             'BLUNTED_AROUSAL(N%)' — fixed to indexOf; CS score was
             systematically undercounted in raw-CSV mode
           • parseSummaryCSV: 9 sub-object field gaps — when loading a
             pre-generated summary CSV the following sections were blank
             despite data being present in the file:
             - Desaturation Profile: nadir sub-object, spo2CoV,
               tAucWeighted, auc90Total/Rate, dip3Rate
             - Cross-Signal: crcIdx, divergeCount, divergePct
             - Sleep Quality: wasoPct, wasoWindows, posShifts
             - SpO2 Advanced: nadirBins, spo2IQR, condMean/Pct <94
             - HR Advanced: hrIQR, hrPbContrast, meanHRpb/NonPb
             - Clinical Indices: sbiiQ, pred3pQ (quintile labels/cards)
             - Oscillation: peakCrossings, totalCrossings, first, last
               (totalCrossings charted as 0 for all summary nights)
             - HRV: rsaProxy (showing —), sample count n (NaN in export)
             - Sleep Stability: components sub-object (sub-scores hidden)
  v22.16 — 3 accuracy fixes (cross-reference audit):
           • VO₂max summary-mode categories now use age/sex ACSM lookup
             table (upVO2category) instead of sex-agnostic hardcoded thresholds
           — Reference Guide updated:
           • MOS: replaced incorrect additive 4-point scoring description
             with actual tiered ODI-4/CT<90 algorithm the parser implements
           • SBII: corrected formula (Σ D²×T_min / TRT_hr) and quintile
             boundaries to SHHS-calibrated values (Q1<2.58, Q5>25.54)
           • pRED-3p: corrected quintile boundaries to SHHS-calibrated
             values (Q1<2.78%, Q5>19.04%)
           • HR Slope: corrected epoch description (raw 1Hz OLS, not 30-min means)
           • BP Projection: corrected DBP formula (independent multi-factor
             model, not 0.65×SBP shorthand)
  v22.15 — 6 bug fixes: _csvParseErrors ReferenceError, var row redeclaration,
           dead allZones assignment, ApEn formula corrected (log-of-mean →
           mean-of-log), WASO gated on detected onset, HR smoothing centered
  v20.7 — 18 new metrics: HD, T88/T85, ODRI, Poincaré SD1/SD2,
           LCSP, sleep stage proxy, nadir timing, RMSSD arc, IEI,
           SpO2 shape (kurtosis/skewness), percentiles, conditional
           SpO2, HR CV, SpO2-HR efficiency, recovery CV
  v20.6 — 8 bug fixes (linReg, ApEn, WASO gate, NOCTURNAL_STRESS,
           intraNightNSI calibration, dead vars, CSV %, version sync)
           + 18 new metrics (A–O): drift, ODI-2, LF/HF, resp rate,
           HR asymmetry, quartile trend, cross-correlation lag,
           spike kinematics, data gaps, flatline/ceiling artifacts
  v20.5 — Smart Summary engine, auto-ranking, pattern scoring
  v20.4 — DFA α1, SpO2 FFT, HR entropy, sympathovagal surge
  v20.3 — Night extras, rolling metrics, pattern scores
  v20.2 — 15 new metrics: CT94, desat slopes, PB metrics, sleep arch
```
