/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · METRIC REGISTRY DATA  (ppgdex-registry.js)
   ────────────────────────────────────────────────────────────────────────
   Per-node DATA map for the System-Cohesion layer (COHESION-ROLLOUT-BRIEF).
   LOCAL to PpgDex — clone of oxydex-registry.js; SHARED logic lives in
   metric-registry.js. Labels mirror the ppgdex-app.js render + ppgdex-cross.js
   defs so the registry and the self-describing envelope never diverge.

   PpgDex = raw wrist-PPG → PPI → HRV + pulse-wave morphology. Optical pulse
   intervals give valid time-domain HRV; morphology/reflection indices are more
   device-dependent → emerging.

   Evidence (brief §3):
     measured     : direct optical/quality stats — Pulse HR, perfusion index, rise time,
                    motion-rejected %, % analyzable, correction %, mean SQI
     validated    : established HRV from PPI — rMSSD, SDNN, ln rMSSD, pNN50
     emerging     : device-dependent — dicrotic notch, augmentation index, CVHR index, DFA α1
     experimental : PpgDex composite — HRV Score
     heuristic    : population projections — VO₂max estimate (ANS age REMOVED
                    2026-06-21, external-review WP-A)
   Load AFTER metric-registry.js, BEFORE ppgdex-render.js.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var PPG_REGISTRY = {
  /* ── MEASURED — direct optical reading / quality statistic ─────────────── */
  hr:         { label:'Pulse HR',       unit:'bpm', goodDirection:'down', depth:'basic',    evidence:'measured', cite:'Mean heart rate — direct from pulse-peak intervals' },
  pi:         { label:'Perfusion Idx',  unit:'%',   goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'AC/DC perfusion index — direct optical contact measure' },
  riseTime:   { label:'Rise time',      unit:'ms',  goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'Foot→systolic-peak rise time — direct pulse-wave timing' },
  motion:     { label:'Motion-rejected',unit:'%',   goodDirection:'down', depth:'advanced', evidence:'measured', cite:'ACC+GYRO motion-gated rejection — direct quality stat' },
  analyzable: { label:'% Analyzable',   unit:'%',   goodDirection:'up',   depth:'basic',    evidence:'measured', cite:'Fraction of recording analyzable — direct coverage' },
  correction: { label:'Correction',     unit:'%',   goodDirection:'down', depth:'advanced', evidence:'measured', cite:'PPIs corrected during cleaning — direct quality stat' },
  meanSqi:    { label:'Mean SQI',       unit:'',    goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'Mean signal-quality index — direct per-pulse quality' },
  cleanPulses:{ label:'Clean pulses',   unit:'%',   goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'% pulses with SQI ≥ 0.5 — direct quality statistic' },
  motionIdx:  { label:'Mean motion idx',unit:'',    goodDirection:'down', depth:'advanced', evidence:'measured', cite:'Mean ACC-variance∪GYRO motion index — direct from inertial sensors' },
  accHz:      { label:'ACC Hz',         unit:'Hz',  goodDirection:'up',   depth:'research', evidence:'measured', cite:'Accelerometer sample rate — direct device statistic' },
  gyroHz:     { label:'GYRO Hz',        unit:'Hz',  goodDirection:'up',   depth:'research', evidence:'measured', cite:'Gyroscope sample rate — direct device statistic' },
  agreement:  { label:'Agreement',      unit:'%',   goodDirection:'up',   depth:'advanced', evidence:'measured', cite:'Self-PPI vs device-PPI mean agreement — direct validation statistic' },
  meanAbsDev: { label:'Mean abs dev',   unit:'ms',  goodDirection:'down', depth:'research', evidence:'measured', cite:'Self-vs-device mean absolute PPI deviation — direct' },
  meanPPI:    { label:'Mean PPI',       unit:'ms',  goodDirection:'up',   depth:'research', evidence:'measured', cite:'Mean pulse-to-pulse interval — direct from the optical waveform' },

  /* ── VALIDATED — established HRV from pulse-peak intervals ──────────────── */
  rmssd:      { label:'rMSSD',          unit:'ms',  goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'RMSSD — short-term parasympathetic HRV (Task Force 1996)' },
  sdnn:       { label:'SDNN',           unit:'ms',  goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'SDNN — overall HRV (Task Force 1996)' },
  lnRMSSD:    { label:'ln rMSSD',       unit:'',    goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'Log-RMSSD — readiness HRV scale' },
  pnn50:      { label:'pNN50',          unit:'%',   goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'pNN50 — % successive PPI > 50 ms (Task Force 1996)' },
  sd1:        { label:'SD1',            unit:'ms',  goodDirection:'up',   depth:'research', evidence:'validated', cite:'Poincaré SD1 — short-term HRV (≈ RMSSD/√2)' },
  sd2:        { label:'SD2',            unit:'ms',  goodDirection:'up',   depth:'research', evidence:'validated', cite:'Poincaré SD2 — long-term HRV dispersion' },
  triIdx:     { label:'Triangular index',unit:'',    goodDirection:'up',   depth:'advanced', evidence:'validated', cite:'HRV triangular index — geometric time-domain HRV (Task Force 1996); PPI-derived but robust, not subject to the PRV frequency-domain caveat' },

  /* ── EMERGING — published, device-dependent ────────────────────────────── */
  dicrotic:   { label:'Dicrotic notch', unit:'',    goodDirection:'up',   depth:'advanced', evidence:'emerging', cite:'Dicrotic-notch detection — pulse-wave reflection, device-dependent' },
  ai:         { label:'Aug. index',     unit:'%',   goodDirection:'down', depth:'research', evidence:'emerging', cite:'Augmentation index — arterial reflection, device-dependent' },
  reflectionIdx:{ label:'Reflection index', unit:'', goodDirection:'down', depth:'research', evidence:'emerging', cite:'PPG reflection index (diastolic÷systolic peak) — wave reflection / stiffness proxy, device-dependent' },
  sdppgBA:    { label:'SDPPG b/a',      unit:'',    goodDirection:'down', depth:'research', evidence:'emerging', cite:'2nd-derivative PPG b/a ratio (Takazawa 1998) — arterial-stiffness/aging proxy, rises toward 0 with stiffness; device-dependent' },
  agingIdx:   { label:'Aging index',    unit:'',    goodDirection:'down', depth:'research', evidence:'emerging', cite:'SDPPG aging index (b−c−d−e)/a (Takazawa 1998) — vascular-aging proxy, device-dependent' },
  notchTime:  { label:'Notch time',     unit:'ms',  goodDirection:'up',   depth:'research', evidence:'measured', cite:'Foot→dicrotic-notch timing — direct pulse-wave fiducial' },
  pulseWidth: { label:'Pulse width',    unit:'ms',  goodDirection:'up',   depth:'research', evidence:'measured', cite:'Pulse width at half systolic amplitude — direct pulse-wave timing' },
  sd1sd2:     { label:'SD1/SD2',        unit:'',    goodDirection:'up',   depth:'research', evidence:'emerging', cite:'Poincaré SD1/SD2 ratio — nonlinear short/long-term HRV balance' },
  ellArea:    { label:'Ellipse area',   unit:'ms²', goodDirection:'up',  depth:'research', evidence:'emerging', cite:'Poincaré ellipse area — overall HRV dispersion (geometric)' },
  cvhrIndex:  { label:'CVHR index',     unit:'/h',  goodDirection:'down', depth:'advanced', evidence:'emerging', cite:'Cyclical-variation-of-HR index — PPI apnea surrogate' },
  dfaAlpha1:  { label:'DFA α1',         unit:'',    goodDirection:'up',   depth:'research', evidence:'emerging', cite:'DFA short-term scaling exponent — device/length-dependent' },
  /* Frequency-domain (Lomb–Scargle on PPI = pulse-rate variability). Established HRV method
     (Task Force 1996) BUT PPG-PRV freq-domain is device/motion-dependent and not interchangeable
     with ECG-HRV — esp. LF & under sympathetic load (Schäfer & Vagedes 2013, Int J Cardiol 166:15)
     → emerging, not validated. Time-domain HRV above stays validated; geometric Tri-index too. */
  vlf:        { label:'VLF',            unit:'ms²', goodDirection:'up',   depth:'research', evidence:'emerging', cite:'VLF power (Lomb–Scargle, PPI) — PRV freq-domain; needs long records, least reliable in short PPG (Schäfer & Vagedes 2013)' },
  lf:         { label:'LF',             unit:'ms²', goodDirection:'up',   depth:'advanced', evidence:'emerging', cite:'LF power (Lomb–Scargle, PPI) — PRV freq-domain, device/motion-dependent vs ECG-HRV (Schäfer & Vagedes 2013)' },
  hf:         { label:'HF',             unit:'ms²', goodDirection:'up',   depth:'advanced', evidence:'emerging', cite:'HF power (Lomb–Scargle, PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)' },
  lfhf:       { label:'LF/HF',          unit:'',    goodDirection:'up',   depth:'advanced', evidence:'emerging', cite:'LF/HF sympatho-vagal balance (PPI) — PRV freq-domain diverges from ECG-HRV under load (Schäfer & Vagedes 2013)' },
  lfnu:       { label:'LF n.u.',        unit:'n.u.',goodDirection:'down', depth:'research', evidence:'emerging', cite:'LF normalized units (PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)' },
  hfnu:       { label:'HF n.u.',        unit:'n.u.',goodDirection:'up',   depth:'research', evidence:'emerging', cite:'HF normalized units (PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)' },
  totalPower: { label:'Total power',    unit:'ms²', goodDirection:'up',   depth:'research', evidence:'emerging', cite:'Total spectral power (Lomb–Scargle, PPI) — PRV freq-domain, device-dependent (Schäfer & Vagedes 2013)' },
  sampEn:     { label:'SampEn',         unit:'',    goodDirection:'up',   depth:'research', evidence:'emerging', cite:'Sample entropy — nonlinear regulatory complexity (Richman & Moorman 2000); length/parameter-dependent' },

  /* ── EXPERIMENTAL — PpgDex composite ───────────────────────────────────── */
  hrvScore:   { label:'HRV Score',      unit:'',    goodDirection:'up',   depth:'basic',    evidence:'experimental', cite:'PpgDex autonomic-readiness composite — internal' },

  /* ── HEURISTIC — population projection / proxy ─────────────────────────── */
  /* ANS Age REMOVED 2026-06-21 (external-review WP-A) — a population age
     regression. VO₂ retained at research depth. The validated rMSSD/SDNN PPG
     HRV bench carries the autonomic story. */
  vo2:        { label:'VO₂max Est',     unit:'ml/kg/min',goodDirection:'up',   depth:'research', evidence:'heuristic', cite:'HR-ratio VO₂max estimate — population proxy, not CPET' },
  posture:    { label:'Posture',        unit:'',    goodDirection:'up',   depth:'research', evidence:'heuristic', cite:'limb-acc orientation proxy for body position; wear-site not auto-detected, low reliability' }
};

var PPG_LABEL_ALIAS = {
  'pulse hr':'hr', 'mean hr':'hr', 'hr':'hr', 'pulse rate':'hr',
  'perfusion idx':'pi', 'perfusion':'pi', 'perfusion index':'pi', 'perfusion %':'pi',
  'rise time':'riseTime',
  'motion-rejected':'motion', 'motion-rej':'motion', 'motion rejected':'motion',
  '% analyzable':'analyzable', 'analyzable':'analyzable',
  'correction':'correction', 'correction rate':'correction', 'mean sqi':'meanSqi',
  'clean pulses':'cleanPulses', 'clean beats':'cleanPulses',
  'mean motion idx':'motionIdx', 'motion idx':'motionIdx',
  'pulses rejected':'motion', 'acc hz':'accHz', 'gyro hz':'gyroHz',
  'agreement':'agreement', 'mean abs dev':'meanAbsDev', 'mean ppi':'meanPPI',
  'rmssd':'rmssd', 'sdnn':'sdnn', 'ln rmssd':'lnRMSSD', 'pnn50':'pnn50',
  'sd1':'sd1', 'sd2':'sd2', 'sd1/sd2':'sd1sd2', 'sd1sd2':'sd1sd2', 'ellipse area':'ellArea',
  'dicrotic notch':'dicrotic', 'aug. index':'ai', 'augmentation index':'ai', 'aug index':'ai',
  'reflection index':'reflectionIdx', 'reflection idx':'reflectionIdx',
  'sdppg b/a':'sdppgBA', 'sdppg ba':'sdppgBA', 'b/a':'sdppgBA', 'b/a ratio':'sdppgBA',
  'aging index':'agingIdx', 'agi':'agingIdx',
  'notch time':'notchTime', 'pulse width':'pulseWidth',
  'cvhr index':'cvhrIndex', 'dfa α1':'dfaAlpha1', 'dfa a1':'dfaAlpha1',
  'triangular index':'triIdx', 'tri index':'triIdx', 'tri idx':'triIdx',
  'vlf':'vlf', 'lf':'lf', 'hf':'hf', 'lf/hf':'lfhf', 'lfhf':'lfhf',
  'lf n.u.':'lfnu', 'lf nu':'lfnu', 'hf n.u.':'hfnu', 'hf nu':'hfnu',
  'total power':'totalPower', 'sampen':'sampEn', 'sample entropy':'sampEn',
  'hrv score':'hrvScore',
  'vo₂max est':'vo2', 'vo2max est':'vo2', 'est. vo₂max':'vo2', 'est. vo2max':'vo2', 'est vo₂max':'vo2',
  'posture':'posture', 'limb orientation':'posture', 'limb position':'posture'
};

function _norm(s){ return String(s==null?'':s).toLowerCase()
  .replace(/<[^>]*>/g,'')
  .replace(/\s+/g,' ').trim(); }

function idForLabel(label){
  var k = _norm(label);
  if(PPG_REGISTRY[k]) return k;
  return PPG_LABEL_ALIAS[k] || null;
}

var _META_DENY = { 'date':1, 'start':1, 'start (wall clock)':1, 'end':1, 'source':1, 'sample rate':1, 'recording':1,
  'active flags':1, 'channel':1, 'channel used':1, 'pulses detected':1, 'duration':1, 'tier':1 };

function badgeForLabel(label, fallback){
  if(!global.MetricRegistry) return '';
  var id = idForLabel(label);
  if(!id){
    if(fallback && !_META_DENY[_norm(label)]) return global.MetricRegistry.badge('experimental','');
    return '';
  }
  var d = global.MetricRegistry.entry(PPG_REGISTRY, id);
  return global.MetricRegistry.badge(d.evidence, d.cite);
}

function depthForLabel(label){
  var id = idForLabel(label); if(!id) return null;
  return global.MetricRegistry ? global.MetricRegistry.entry(PPG_REGISTRY, id).depth : null;
}

global.PPG_REGISTRY = PPG_REGISTRY;
global.PpgRegistry = {
  REGISTRY: PPG_REGISTRY, ALIAS: PPG_LABEL_ALIAS,
  idForLabel: idForLabel, badgeForLabel: badgeForLabel, depthForLabel: depthForLabel
};

})(window);
