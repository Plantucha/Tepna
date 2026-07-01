/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   GlucoDex · METRIC REGISTRY DATA  (glucodex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to GlucoDex — clone of oxydex-registry.js; SHARED logic lives in
   metric-registry.js. GlucoDex has no *-cross.js; labels mirror the
   glucodex-app.js KPI grid + full metrics table.

   Evidence (brief §3):
     measured     : raw glucose statistics + coverage/quality — Mean glucose, SD, MAG,
                    % sensor active, active duration, compression, data confidence,
                    nocturnal-hypo & excursion counts
     validated    : CGM consensus metrics + risk indices — GMI, eA1c, CV, TIR/TITR/TBR/TAR,
                    MAGE, MODD, CONGA, J-index, GRADE, ADRR, LBGI, HBGI, QTc (ECGDex)
     emerging     : less standardized — GVP, dawn phenomenon, σ(lnRMSSD) slope
     experimental : GlucoDex/fusion composites — stability score, IR-risk band, autonomic
                    risk, glycemic variability, hypo⟷QTc risk, lab-A1c comparisons
     heuristic    : (none — Metabolic Age REMOVED 2026-06-21, external-review WP-A)
   Load AFTER metric-registry.js, BEFORE glucodex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var GLU_REGISTRY = {
  /* ── MEASURED — raw glucose statistic / coverage / quality ─────────────── */
  mean:        { label:'Mean glucose', unit:'mg/dL', goodDirection:'down', depth:'basic',    evidence:'measured', cite:'Average sensor glucose — direct reading' },
  sd:          { label:'SD',           unit:'mg/dL', goodDirection:'down', depth:'advanced', evidence:'measured', cite:'Standard deviation of glucose — direct statistic' },
  mag:         { label:'MAG',          unit:'mg/dL/h',goodDirection:'down',depth:'research', evidence:'measured', cite:'Mean absolute glucose rate of change — direct' },
  pctActive:   { label:'% Sensor active',unit:'%',   goodDirection:'up',   depth:'basic',    evidence:'measured', cite:'Fraction of period with sensor data — direct coverage' },
  duration:    { label:'Active duration',unit:'days',goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'Total active recording span — direct' },
  compression: { label:'Compression flagged',unit:'min',goodDirection:'down',depth:'research',evidence:'measured', cite:'Positional nocturnal artifact minutes — direct, held out of TBR' },
  dataConf:    { label:'Data confidence',unit:'×',   goodDirection:'up',   depth:'research', evidence:'measured', cite:'Recording data-quality confidence — direct' },
  nocHypo:     { label:'Nocturnal hypo',unit:'',     goodDirection:'down', depth:'advanced', evidence:'measured', cite:'Count of nocturnal <70 mg/dL episodes — direct detection' },
  excursions:  { label:'Excursions',   unit:'',      goodDirection:'down', depth:'research', evidence:'measured', cite:'Slope-detected excursion count — direct' },
  warmup:      { label:'Warm-up suppressed',unit:'min',goodDirection:'down',depth:'research', evidence:'measured', cite:'Fresh-sensor warm-up minutes suppressed from analysis — direct coverage' },
  sessionSpread:{label:'Between-session spread',unit:'mg/dL',goodDirection:'down',depth:'advanced',evidence:'measured', cite:'Range of per-session medians — direct between-sensor step statistic' },
  sessionDrift:{ label:'Largest drift',unit:'mg/dL/day',goodDirection:'down',depth:'advanced',evidence:'measured', cite:'Max within-wear linear drift — direct quality statistic' },

  /* ── VALIDATED — CGM consensus metrics + established risk indices ───────── */
  gmi:         { label:'GMI',          unit:'%',     goodDirection:'down', depth:'basic',    evidence:'validated', cite:'Glucose Management Indicator — 3.31 + 0.02392·mean (Bergenstal 2018)' },
  ea1c:        { label:'Est. HbA1c',   unit:'%',     goodDirection:'down', depth:'advanced', evidence:'validated', cite:'ADAG estimated HbA1c — (mean+46.7)/28.7' },
  cv:          { label:'CV',           unit:'%',     goodDirection:'down', depth:'basic',    evidence:'validated', cite:'Coefficient of variation — stability threshold <36% (consensus 2019)' },
  tir:         { label:'Time in Range',unit:'%',     goodDirection:'up',   depth:'basic',    evidence:'validated', cite:'TIR 70–180 mg/dL — primary CGM consensus metric (2019)' },
  titr:        { label:'Tight Range',  unit:'%',     goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'TITR 70–140 mg/dL — tight-range target (2023 consensus)' },
  tbr1:        { label:'TBR 54–69',    unit:'%',     goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Time below range (low) — consensus metric' },
  tbr2:        { label:'TBR <54',      unit:'%',     goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Time below range (very low) — consensus metric' },
  tar1:        { label:'TAR 181–250',  unit:'%',     goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Time above range (high) — consensus metric' },
  tar2:        { label:'TAR >250',     unit:'%',     goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Time above range (very high) — consensus metric' },
  timeBelow:   { label:'Time Below',   unit:'%',     goodDirection:'down', depth:'basic',    evidence:'validated', cite:'Time <70 mg/dL — hypoglycemia exposure (consensus)' },
  timeAbove:   { label:'Time Above',   unit:'%',     goodDirection:'down', depth:'basic',    evidence:'validated', cite:'Time >180 mg/dL — hyperglycemia exposure (consensus)' },
  mage:        { label:'MAGE',         unit:'mg/dL', goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Mean amplitude of glycemic excursions (Service 1970)' },
  modd:        { label:'MODD',         unit:'mg/dL', goodDirection:'down', depth:'research', evidence:'validated', cite:'Mean of daily differences — inter-day variability' },
  conga:       { label:'CONGA',        unit:'mg/dL', goodDirection:'down', depth:'research', evidence:'validated', cite:'Continuous overlapping net glycemic action (McDonnell 2005)' },
  jIndex:      { label:'J-index',      unit:'',      goodDirection:'down', depth:'research', evidence:'validated', cite:'0.001·(mean+SD)² — combined level + variability (Wójcicki 1995)' },
  grade:       { label:'GRADE',        unit:'',      goodDirection:'down', depth:'research', evidence:'validated', cite:'Glycaemic Risk Assessment Diabetes Equation (Hill 2007)' },
  adrr:        { label:'ADRR',         unit:'',      goodDirection:'down', depth:'research', evidence:'validated', cite:'Average daily risk range (Kovatchev 2006) — needs ≥2 d' },
  lbgi:        { label:'LBGI',         unit:'',      goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Kovatchev low-blood-glucose index' },
  hbgi:        { label:'HBGI',         unit:'',      goodDirection:'down', depth:'advanced', evidence:'validated', cite:'Kovatchev high-blood-glucose index' },
  qtc:         { label:'QTc (ECGDex)', unit:'ms',    goodDirection:'down', depth:'research', evidence:'validated', cite:'Rate-corrected QT from ECGDex — cross-node fusion value' },

  /* ── EMERGING — less standardized / device-dependent ───────────────────── */
  gvp:         { label:'GVP',          unit:'%',     goodDirection:'down', depth:'research', evidence:'emerging', cite:'Glucose variability percentage — trace path-length' },
  dawn:        { label:'Dawn rise',    unit:'mg/dL', goodDirection:'down', depth:'advanced', evidence:'emerging', cite:'Dawn phenomenon — nadir(03–06h)→pre-breakfast rise' },
  lnrmssdSlope:{ label:'bσ(lnRMSSD) slope',unit:'/h',goodDirection:'down', depth:'research', evidence:'emerging', cite:'Overnight σ(lnRMSSD) slope (Li/Kiyono) — ECGDex headline signal' },

  /* ── EXPERIMENTAL — GlucoDex / fusion composites ───────────────────────── */
  stability:   { label:'Stability Score',unit:'',   goodDirection:'up',   depth:'basic',    evidence:'experimental', cite:'TIR + CV + hypo composite — GlucoDex internal' },
  irBand:      { label:'IR-risk band', unit:'',      goodDirection:'down', depth:'advanced', evidence:'experimental', cite:'Directional insulin-resistance risk — autonomic+glycemic fusion' },
  autoRisk:    { label:'Autonomic risk',unit:'',     goodDirection:'down', depth:'research', evidence:'experimental', cite:'Slope + surge + coupling composite (ECGDex fusion)' },
  glyVar:      { label:'Glycemic variability',unit:'',goodDirection:'down',depth:'research', evidence:'experimental', cite:'CV + MAGE + dawn composite — fusion input' },
  hypoQtc:     { label:'Hypo⟷QTc risk',unit:'',      goodDirection:'down', depth:'research', evidence:'experimental', cite:'Nocturnal hypo + prolonged QTc — dead-in-bed pattern composite' },
  gmiVsLab:    { label:'GMI vs Lab',   unit:'%',     goodDirection:'down', depth:'advanced', evidence:'experimental', cite:'GMI − lab A1c delta — they measure differently' },
  sensorBias:  { label:'Sensor bias vs lab A1c',unit:'mg/dL',goodDirection:'down',depth:'research',evidence:'experimental', cite:'Sensor mean vs lab-implied eAG — calibration check' }

  /* ── HEURISTIC — population projection ─────────────────────────────────── */
  /* Metabolic Age REMOVED 2026-06-21 (external-review WP-A): a mean+CV+TIR
     composite dressed as a personal age — the metabolic clone of ANS Age. The
     validated CGM consensus metrics (TIR, GMI, CV%) carry the glycemic story. */
};

var GLU_LABEL_ALIAS = {
  'mean glucose':'mean', 'mean':'mean', 'sd':'sd', 'mag':'mag',
  '% sensor active':'pctActive', 'sensor active':'pctActive',
  'active duration':'duration', 'duration':'duration',
  'compression flagged':'compression', 'compression lows':'compression',
  'active time':'duration', 'warm-up suppressed':'warmup',
  'between-session spread':'sessionSpread', 'largest drift':'sessionDrift',
  'data confidence':'dataConf',
  'nocturnal hypo':'nocHypo', 'nocturnal hypos':'nocHypo', 'excursions':'excursions',
  'gmi':'gmi', 'est. hba1c':'ea1c', 'est hba1c':'ea1c',
  'cv':'cv', 'cv · overnight':'cv', 'cv · morning':'cv', 'cv · afternoon':'cv', 'cv · evening':'cv',
  'total cv':'cv', 'overnight cv':'cv', 'morning cv':'cv', 'afternoon cv':'cv', 'evening cv':'cv',
  'time in range':'tir', 'tir 70–180':'tir', 'tir 70-180':'tir', 'tir':'tir',
  'tight range':'titr', 'titr 70–140':'titr', 'titr 70-140':'titr', 'titr':'titr',
  'tbr 54–69':'tbr1', 'tbr 54-69':'tbr1', 'tbr <54':'tbr2',
  'tar 181–250':'tar1', 'tar 181-250':'tar1', 'tar >250':'tar2',
  'time below':'timeBelow', 'time above':'timeAbove',
  'mage':'mage', 'modd':'modd',
  'conga':'conga', 'conga-1h':'conga', 'conga-2h':'conga', 'conga-4h':'conga',
  'j-index':'jIndex', 'grade':'grade', 'adrr':'adrr', 'lbgi':'lbgi', 'hbgi':'hbgi',
  'qtc (ecgdex)':'qtc',
  'gvp':'gvp', 'dawn rise':'dawn', 'dawn phenomenon':'dawn', 'bσ(lnrmssd) slope':'lnrmssdSlope',
  'stability score':'stability', 'ir-risk band':'irBand', 'autonomic risk':'autoRisk',
  'glycemic variability':'glyVar', 'hypo⟷qtc risk':'hypoQtc',
  'gmi vs lab':'gmiVsLab', 'gmi vs lab a1c':'gmiVsLab', 'sensor bias vs lab a1c':'sensorBias'
};

function _norm(s){ return String(s==null?'':s).toLowerCase()
  .replace(/<[^>]*>/g,'')
  .replace(/\s+/g,' ').trim(); }

function idForLabel(label){
  var k = _norm(label);
  if(GLU_REGISTRY[k]) return k;
  return GLU_LABEL_ALIAS[k] || null;
}

/* Pure metadata / section-separator / handshake rows — never badge. */
var _META_DENY = { 'date':1, 'start':1, 'end':1, 'source':1, 'sample rate':1, 'recording':1,
  'active flags':1, 'tier':1, 'readings':1, 'calibrated':1,
  /* structural recording-count, not a glucose measurement — stays bare like ECG/Pulse counts */
  'sessions':1, 'nights':1 };

/* badgeForLabel(label, fallback) → '<span class="ev …">' | '' — resolves a label
   to its registry id → evidence → MetricRegistry.badge, to place an evidence dot
   IMMEDIATELY BEFORE the label (CLAUDE.md coverage mandate). */
function badgeForLabel(label, fallback){
  if(!global.MetricRegistry) return '';
  var n = _norm(label);
  // section separators ("— Core glycemic —") and producer handshake rows ("→ …") never badge
  if(n.charAt(0) === '\u2014' || n.charAt(0) === '\u2192') return '';
  var id = idForLabel(label);
  if(!id){
    if(fallback && !_META_DENY[n]) return global.MetricRegistry.badge('experimental','');
    return '';
  }
  var d = global.MetricRegistry.entry(GLU_REGISTRY, id);
  return global.MetricRegistry.badge(d.evidence, d.cite);
}

function depthForLabel(label){
  var id = idForLabel(label); if(!id) return null;
  return global.MetricRegistry ? global.MetricRegistry.entry(GLU_REGISTRY, id).depth : null;
}

global.GLU_REGISTRY = GLU_REGISTRY;
global.GlucoRegistry = {
  REGISTRY: GLU_REGISTRY, ALIAS: GLU_LABEL_ALIAS,
  idForLabel: idForLabel, badgeForLabel: badgeForLabel, depthForLabel: depthForLabel
};

})(window);
