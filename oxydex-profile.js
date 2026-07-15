/* ════ OxyDex · PROFILE — OXYProfile (oxydex-profile.js) ──────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   localStorage-backed user profile (UP) and every personalization formula:
   upLoad/upSave/upFromDOM/upToDOM, HRmax/BMI/BSA/IBW/MAP/BMR/BAP/pop-avg/
   ideal-weight/Karvonen, profileDerivedUpdate/profileAutoDetectUpdate/
   recomputeFromProfile, the ANS-age hero, plus the inline-handler entrypoints
   profileChanged/toggleProfile/openProfile. Runs initProfile() at load.
   Plain global script — shares page scope with the other oxydex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: oxydex-util → oxydex-profile → oxydex-dsp → oxydex-render → oxydex-app.
   ════════════════════════════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════════════
//  USER PROFILE — localStorage-backed, personalizes all formulas
// ══════════════════════════════════════════════════════════════════
var UP = {
  age: 49,
  sex: 'male',
  weight: 90,
  height: 175,
  sbp: 120,
  dbp: 80,
  vo2GT: 0,
  hrmaxOverride: 0,
  hrRestOverride: 0,
  elevation: 0, // metres above sea level; adjusts SpO₂ normal thresholds
  cpap: 'no' // CPAP/BiPAP therapy — reframes apnea read as residual on therapy
};

function upLoad() {
  // Persistence delegated to the shared DexProfile engine (key `tepna_profile`,
  // PROFILE-UNIFY-BRIEF). UP stays the runtime source of truth so EVERY OxyDex
  // formula / auto-detect / export is byte-identical — only the storage backend
  // changes. Override fields keep their `0 = not set` semantics via the manual layer.
  if (window.DexProfile) {
    try {
      DexProfile.migrate();
      // Pristine = no real identity data in the shared record yet. Keep OxyDex's own
      // historical defaults (age 49 …) so a no-profile export is byte-identical to the
      // committed fixture; adopt the shared record only once it holds real data.
      if (DexProfile.isPristine()) return;
      var p = DexProfile.get(),
        man = DexProfile.getRecord().manual || {};
      if (p.age != null) UP.age = p.age;
      UP.sex = p.sex === 'F' ? 'female' : 'male';
      if (p.weight != null) UP.weight = p.weight;
      if (p.height != null) UP.height = p.height;
      if (p.sbp != null) UP.sbp = p.sbp;
      if (p.dbp != null) UP.dbp = p.dbp;
      UP.vo2GT = man.vo2 > 0 ? man.vo2 : 0;
      UP.hrmaxOverride = man.hrMax > 0 ? man.hrMax : 0;
      UP.hrRestOverride = man.hrRest > 0 ? man.hrRest : 0;
      UP.elevation = p.elevation || 0;
      UP.cpap = p.cpap || 'no';
    } catch (e) {}
    return;
  }
  try {
    var raw = localStorage.getItem('oxydex_profile') || localStorage.getItem('o2ring_profile');
    if (raw) {
      var p2 = JSON.parse(raw);
      for (var k in p2) if (p2.hasOwnProperty(k)) UP[k] = p2[k];
    }
  } catch (e) {}
}

function upSave() {
  if (window.DexProfile) {
    try {
      DexProfile.setManual('age', UP.age);
      DexProfile.setManual('sex', UP.sex);
      DexProfile.setManual('weight', UP.weight);
      DexProfile.setManual('height', UP.height);
      DexProfile.setManual('sbp', UP.sbp);
      DexProfile.setManual('dbp', UP.dbp);
      DexProfile.setManual('vo2', UP.vo2GT > 0 ? UP.vo2GT : null);
      DexProfile.setManual('hrMax', UP.hrmaxOverride > 0 ? UP.hrmaxOverride : null);
      DexProfile.setManual('hrRest', UP.hrRestOverride > 0 ? UP.hrRestOverride : null);
      DexProfile.setManual('elevation', UP.elevation);
      DexProfile.setManual('cpap', UP.cpap);
    } catch (e) {}
    return;
  }
  try {
    localStorage.setItem('oxydex_profile', JSON.stringify(UP));
  } catch (e) {}
}

function upFromDOM() {
  var age = parseInt(gv('profAge'), 10) || 49;
  var sex = gv('profSex') || 'male';
  var wt = parseFloat(gv('profWeight')) || 90;
  var ht = parseFloat(gv('profHeight')) || 175;
  var sbp = parseInt(gv('profSBP'), 10) || 120;
  var dbp = parseInt(gv('profDBP'), 10) || 80;
  var vo2 = parseFloat(gv('profVO2')) || 0;
  var hrm = parseInt(gv('profHRmax'), 10) || 0;
  var hrr = parseInt(gv('profHRrest'), 10) || 0;
  var elv = parseInt(gv('profElevation'), 10) || 0;
  var cpap = gv('profCPAP') || 'no';
  UP = { age: age, sex: sex, weight: wt, height: ht, sbp: sbp, dbp: dbp, vo2GT: vo2, hrmaxOverride: hrm, hrRestOverride: hrr, elevation: elv, cpap: cpap };
}

function upToDOM() {
  sv('profAge', UP.age);
  sv('profSex', UP.sex);
  sv('profWeight', UP.weight);
  sv('profHeight', UP.height);
  sv('profSBP', UP.sbp);
  sv('profDBP', UP.dbp);
  sv('profVO2', UP.vo2GT || '');
  sv('profHRmax', UP.hrmaxOverride || 0);
  sv('profHRrest', UP.hrRestOverride || 0);
  sv('profElevation', UP.elevation || 0);
  sv('profCPAP', UP.cpap || 'no');
}

// SpO₂ altitude correction — returns adjustment to subtract from normal thresholds
// Formula: ~1.8% per 1000m (Roach 1998 / AMS guidelines), capped at 7%
// e.g. Asheville 650m → adj≈1; Denver 1600m → adj≈3; La Paz 3600m → adj≈6 (cap 7)
function upSpo2Adj() {
  var elv = UP.elevation || 0;
  return Math.min(7, Math.round((elv / 1000) * 1.8));
}

function upHRmax() {
  return UP.hrmaxOverride > 0 ? UP.hrmaxOverride : Math.round(208 - 0.7 * UP.age);
}

function upHRmaxSource() {
  return UP.hrmaxOverride > 0 ? 'Manual override' : 'Tanaka 2001 formula';
}

function upBMI() {
  var h = UP.height / 100;
  return h > 0 ? +(UP.weight / (h * h)).toFixed(1) : 0;
}

function upBMILabel(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

function upBSA() {
  // DuBois: 0.007184 × W^0.425 × H^0.725
  return +(0.007184 * Math.pow(UP.weight, 0.425) * Math.pow(UP.height, 0.725)).toFixed(2);
}

function upIBW() {
  // Devine: male = 50 + 2.3*(inches over 5ft), female = 45.5 + 2.3
  var base = UP.sex === 'male' ? 50 : 45.5;
  var inchesOver = UP.height / 2.54 - 60;
  return +(base + 2.3 * Math.max(0, inchesOver)).toFixed(1);
}

function upMAP() {
  return Math.round(UP.dbp + (UP.sbp - UP.dbp) / 3);
}

function upBMR() {
  // Mifflin-St Jeor
  var base = 10 * UP.weight + 6.25 * UP.height - 5 * UP.age;
  return Math.round(UP.sex === 'male' ? base + 5 : base - 161);
}

function upBAP() {
  // Blood Age Product = (age/HRmax) × (SBP/80) — simplified vascular age index
  var hrm = upHRmax();
  return hrm > 0 ? +((UP.age / hrm) * (UP.sbp / 80)).toFixed(3) : 0;
}

function upVO2abs() {
  // Absolute VO2 = relative × weight / 1000
  var rel = UP.vo2GT > 0 ? UP.vo2GT : 0;
  return rel > 0 ? +((rel * UP.weight) / 1000).toFixed(2) : null;
}

function upVO2category(vo2rel) {
  // ACSM norms by age group and sex (ACSM's Guidelines for Exercise Testing, 11th ed)
  if (!vo2rel) return null;
  var age = UP.age || 45,
    sex = UP.sex || 'male';
  // Thresholds: [Poor, Fair, Good, Excellent, Superior] upper bounds
  var t;
  if (sex === 'female') {
    if (age < 30) t = [28, 34, 40, 46, 52];
    else if (age < 40) t = [27, 32, 38, 44, 50];
    else if (age < 50) t = [25, 30, 35, 41, 47];
    else if (age < 60) t = [23, 28, 32, 37, 42];
    else t = [20, 24, 28, 33, 37];
  } else {
    if (age < 30) t = [33, 39, 45, 52, 58];
    else if (age < 40) t = [31, 37, 43, 49, 55];
    else if (age < 50) t = [28, 34, 39, 45, 52];
    else if (age < 60) t = [25, 31, 36, 41, 48];
    else t = [21, 27, 32, 37, 44];
  }
  if (vo2rel < t[0]) return { cat: 'Poor', pct: '<10th' };
  if (vo2rel < t[1]) return { cat: 'Fair', pct: '10–25th' };
  if (vo2rel < t[2]) return { cat: 'Good', pct: '25–50th' };
  if (vo2rel < t[3]) return { cat: 'Excellent', pct: '50–75th' };
  if (vo2rel < t[4]) return { cat: 'Superior', pct: '75–90th' };
  return { cat: 'Elite', pct: '>90th' };
}

function upPopAvg() {
  // CDC/WHO approximate weight & height by age/sex
  if (UP.sex === 'male') {
    return { wt: +(86 + (UP.age - 40) * 0.1).toFixed(1), ht: 175.7 };
  } else {
    return { wt: +(74 + (UP.age - 40) * 0.1).toFixed(1), ht: 161.8 };
  }
}

function upIdealWt() {
  // BMI 22.5
  var h = UP.height / 100;
  return +(22.5 * h * h).toFixed(1);
}

function upKarvonenZone(lo, hi, hrRest, hrMax) {
  var hrr = hrMax - hrRest;
  return { low: Math.round(hrr * lo + hrRest), high: Math.round(hrr * hi + hrRest) };
}

function profileDerivedUpdate() {
  var hrm = upHRmax();
  var bmi = upBMI();
  var bsa = upBSA();
  var ibw = upIBW();
  var map = upMAP();
  var pp = UP.sbp - UP.dbp;
  var bmr = upBMR();
  var bap = upBAP();
  var vo2abs = upVO2abs();
  var vo2cat = UP.vo2GT > 0 ? upVO2category(UP.vo2GT) : null;

  function pd(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  pd('pd_hrmax', '<b>HRmax: ' + hrm + ' bpm</b> (' + upHRmaxSource() + ')');
  pd('pd_bmi', '<b>BMI: ' + bmi + '</b> (' + upBMILabel(bmi) + ')');
  pd('pd_bsa', '<b>BSA: ' + bsa + ' m²</b> (DuBois)');
  pd('pd_ibw', '<b>IBW: ' + ibw + ' kg</b> (Devine)');
  pd('pd_map', '<b>MAP: ' + map + ' mmHg</b> (DBP+(SBP−DBP)/3)');
  pd('pd_pp', '<b>Pulse Pressure: ' + pp + ' mmHg</b> (' + (pp < 50 ? '✅ <50=optimal' : '⚠️ elevated') + ')');
  pd('pd_bmr', '<b>BMR: ' + bmr + ' kcal</b> (Mifflin-St Jeor)');
  pd('pd_bap', '<b>BAP: ' + bap + '</b> (' + (bap < 2.1 ? '✅ <2.1=good' : '⚠️ elevated') + ') <span class="bap-note">(non-standard · trend only)</span>');
  pd('pd_vo2abs', vo2abs !== null ? '<b>VO₂ absolute: ' + vo2abs + ' L/min</b>' : '<b>VO₂ absolute:</b> enter VO₂max above');
  pd('pd_vo2cat', vo2cat ? '<b>VO₂ category: ' + vo2cat.cat + '</b> (~' + vo2cat.pct + ' pct)' : '<b>VO₂ category:</b> enter VO₂max above');
  var _elv = UP.elevation || 0;
  var _adj = upSpo2Adj();
  pd(
    'pd_elev',
    _elv > 0 ? '<b>Elevation: ' + _elv + ' m</b> · SpO₂ norms adjusted −' + _adj + '% (normal range now ≥' + (95 - _adj) + '%)' : '<b>Elevation:</b> 0 m (sea level) · standard SpO₂ norms'
  );

  // Karvonen zones — use UP.hrRest if auto-detected, else estimate
  // HRrest priority: 1) manual entry, 2) derived from user's nocturnal data, 3) age-adjusted population estimate
  var hrRestFallback = Math.round(Math.max(45, Math.min(80, 71 - 0.25 * (UP.age || 49)))); // literature: ~71-0.25×age
  var hrRest =
    UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100 ? UP.hrRestOverride : window._upHRrest && window._upHRrest > 30 && window._upHRrest < 80 ? window._upHRrest : hrRestFallback;
  var zones = [
    { id: 'pz1', lo: 0.5, hi: 0.6, label: 'Z1' },
    { id: 'pz2', lo: 0.6, hi: 0.7, label: 'Z2' },
    { id: 'pz3', lo: 0.7, hi: 0.8, label: 'Z3' },
    { id: 'pz4', lo: 0.8, hi: 0.9, label: 'Z4' },
    { id: 'pz5', lo: 0.9, hi: 1.0, label: 'Z5' }
  ];
  zones.forEach(function (z) {
    var zn = upKarvonenZone(z.lo, z.hi, hrRest, hrm);
    var el = document.getElementById(z.id);
    if (el) el.textContent = zn.low + '–' + (z.lo === 0.9 ? hrm + '+' : zn.high) + ' bpm';
  });

  // Weight/height hint
  var pop = upPopAvg();
  var ideal = upIdealWt();
  var wh = document.getElementById('profileWtHtHint');
  if (wh)
    wh.innerHTML =
      '📊 Pop avg (' +
      UP.sex +
      ', entered age ' +
      UP.age +
      '): ' +
      pop.wt +
      ' kg / ' +
      pop.ht +
      ' cm' +
      ' &nbsp;·&nbsp; 🎯 Ideal wt (BMI 22.5): ' +
      ideal +
      ' kg' +
      ' &nbsp;·&nbsp; Updates when age or sex changes';

  // ── Per-field projected value + formula sublabels ───────────────
  // Mirrors the Age field's pattern: every input shows what the
  // tool would predict for that field if left auto, plus the
  // formula. UNIVERSAL: projections use the system-DETECTED ANS age
  // (when available) rather than the manually-entered age, so the
  // yellow line shows what the system thinks regardless of input.
  // User-entered values stay in the white input box.
  function _sub(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  // ANS-age projection REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴): weight/HRmax/HRrest
  // projections use the user's CHRONOLOGICAL age (population default 49 if unset), never an
  // HRV-derived "autonomic age".
  var _projAge = UP.age || 49;
  var _ageNote = '';
  // CDC pop avg using projection age (not UP.age) — sex-aware
  var _popProj = UP.sex === 'male' ? { wt: +(86 + (_projAge - 40) * 0.1).toFixed(1), ht: 175.7 } : { wt: +(74 + (_projAge - 40) * 0.1).toFixed(1), ht: 161.8 };
  // Ideal weight using current height + BMI 22.5
  var _idealProj = upIdealWt();
  // HRmax using projection age (Tanaka)
  var _hrmaxProj = Math.round(208 - 0.7 * _projAge);

  // Sex — no projection; describe what the field drives
  _sub('profileSexSub', '— manual · drives BMR (Mifflin), IBW (Devine), VO₂ norms (ACSM)');

  // Weight — CDC pop avg using detected/manual age + ideal weight
  _sub('profileWtSub', '∼ CDC pop avg ' + _popProj.wt + ' kg (' + UP.sex + ', age ' + _projAge + _ageNote + ')' + ' · ideal (BMI 22.5) ' + _idealProj + ' kg');

  // Height — CDC pop avg by sex + BSA from current values
  _sub('profileHtSub', '∼ CDC pop avg ' + _popProj.ht + ' cm (' + UP.sex + ') · BSA ' + bsa + ' m² (DuBois)');

  // HRmax — Tanaka using projection age
  if (UP.hrmaxOverride > 0) {
    _sub('profileHRmaxSub', '∼ Tanaka: 208 − 0.7 × ' + _projAge + _ageNote + ' = ' + _hrmaxProj + ' bpm · override active: ' + UP.hrmaxOverride);
  } else {
    _sub('profileHRmaxSub', '∼ Tanaka: 208 − 0.7 × ' + _projAge + _ageNote + ' = ' + _hrmaxProj + ' bpm (auto)');
  }

  // HRrest — sublabel only seeded here if no nights loaded;
  // profileAutoDetectUpdate writes the data-driven avg+last version when nights exist.
  if (!window._upHRrest) {
    var _hrRestProj = Math.round(Math.max(45, Math.min(80, 71 - 0.25 * _projAge)));
    _sub('profileHRrestSub', '∼ age-est: 71 − 0.25 × ' + _projAge + _ageNote + ' ≈ ' + _hrRestProj + ' bpm · upload data for nocturnal p5');
  }

  // VO₂max — Uth-Sørensen formula using projected HRmax + current HRrest;
  // overridden by profileAutoDetectUpdate when night data exists.
  if (!window._upHRrest) {
    // only show formula version when no night data
    var _vo2Auto = +(15.3 * (_hrmaxProj / hrRest)).toFixed(1);
    var _vo2Cat = upVO2category(UP.vo2GT > 0 ? UP.vo2GT : _vo2Auto);
    var _vo2Txt = '∼ Uth-Sørensen: 15.3 × ' + _hrmaxProj + '/' + hrRest + ' = ' + _vo2Auto + ' mL/kg/min';
    if (_vo2Cat) _vo2Txt += ' · ' + _vo2Cat.cat + ' (' + _vo2Cat.pct + ')';
    _sub('profileVo2Sub', _vo2Txt);
  }

  // SBP / DBP — user-entered cuff values only (HRV/oximetry BP projection removed
  // 2026-06-23, DEX-METRIC-REMOVAL-AUDIT 🔴). No data-driven overwrite.
  if (!window._upHRrest) {
    _sub('profileSbpSub', '∼ enter cuff SBP (HRV/oximetry BP projection removed 2026-06-23)');
    _sub('profileDbpSub', '∼ enter cuff DBP (HRV/oximetry BP projection removed 2026-06-23)');
  }

  // Elevation — show current SpO₂ adjustment alongside formula
  _sub('profileElevSub', _elv > 0 ? '∼ Roach 1998: −1.8%/1000m · adj −' + _adj + '% (norm ≥' + (95 - _adj) + '%)' : '0 = sea level · −1.8% SpO₂ per 1000m (Roach 1998), cap 7%');
}

function profileAutoDetectUpdate(allNights) {
  // Called after renderAll with the nights array — auto-fills from data
  if (!allNights || !allNights.length) return;

  var hrFloors = [],
    dates = [];
  var hrMins = [],
    hrMaxes = [],
    rmssdVals = [];
  // ANS-age component arrays (ansAges/c1s/c2s/c3s) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴)

  allNights.forEach(function (n) {
    if (!n) return;
    dates.push(n.date);
    // Nocturnal p5 HR floor — more robust than absolute minHr
    // p5 is pre-computed in n.hrv.hrFloor during CSV parsing
    if (n.hrv && n.hrv.hrFloor > 30 && n.hrv.hrFloor < 80) hrFloors.push(n.hrv.hrFloor);
    if (n.stats) {
      hrMins.push(n.stats.minHr);
      hrMaxes.push(n.stats.maxHr);
    }
    // morning-% counter REMOVED (DSP-NITS-2026-07-03 §2): n.date is date-only ('YYYY-MM-DD', no 'T'),
    // so the old split('T')[1] guard was always false and morningPct was permanently 0 — and OxyDex
    // never surfaced it. hrvdex-profile.js is the working twin if a morning-% pill is ever wanted
    // (derive the hour from t0Ms via getUTCHours(), Clock Contract §5 — never string-split a date).
    if (n.hrv) {
      var rmssd = n.hrv.rmssd;
      if (rmssd != null && isFinite(rmssd)) rmssdVals.push(rmssd);
      // ANS-age 3-metric composite (C1 RMSSD·25% · C2 SDNN·40% · C3 HR-floor·35%) REMOVED
      // 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴): a population age-regression dressed as a
      // personal "autonomic age" — indefensible single-number framing, no validation.
    }
  });

  var n = allNights.length;
  var span = 0;
  if (dates.length > 1) {
    var d1 = new Date(dates[0]),
      d2 = new Date(dates[dates.length - 1]);
    span = Math.abs(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
  }

  // Median nocturnal p5 across all nights
  var hrFloorMed = hrFloors.length
    ? Math.round(
        hrFloors.sort(function (a, b) {
          return a - b;
        })[Math.floor(hrFloors.length / 2)]
      )
    : null;

  // Awake resting HR estimate:
  //   = nocturnal_p5 + 8
  // The +8 offset is a population mean (sleep HR is ~8 bpm below awake resting HR).
  // Athletes with strong autonomic tone typically show a larger dip (+12–15 bpm),
  // so the +8 estimate will underestimate awake resting HR for trained individuals.
  // Rule of thumb: if user's actual awake resting HR is known, always prefer manual entry.
  var hrRestEst = hrFloorMed ? hrFloorMed + 8 : null;

  var hrMin = hrMins.length ? Math.min.apply(null, hrMins) : null;
  var hrMax = hrMaxes.length ? Math.max.apply(null, hrMaxes) : null;
  // ANS age (ansAge / _ansBreakdown median) REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).

  // Store detected floor for Karvonen fallback
  if (hrFloorMed) window._upHRrest = hrRestEst;

  // ── Capture LAST-NIGHT values for sublabel display ──────────────────
  // allNights is sorted ascending by date upstream; last element = most recent.
  var lastN = allNights[allNights.length - 1];
  var lastNightVals = {};
  if (lastN) {
    if (lastN.hrv && lastN.hrv.hrFloor > 30 && lastN.hrv.hrFloor < 80) {
      lastNightVals.hrFloor = lastN.hrv.hrFloor;
      lastNightVals.hrRest = lastN.hrv.hrFloor + 8;
    }
    if (lastN.vo2est && lastN.vo2est.vo2est) lastNightVals.vo2 = lastN.vo2est.vo2est;
    // lastNightVals.ansAge + bpProj SBP/DBP REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
  }

  // ANS-age exposure (window._ansAgeAvg / _ansAgeLast) REMOVED 2026-06-23
  // (DEX-METRIC-REMOVAL-AUDIT 🔴): projections now use chronological age only. Kept as
  // explicit null so any stray reader sees "no ANS age".
  window._ansAgeAvg = null;
  window._ansAgeLast = null;

  // Build auto-detect text
  var parts = [];
  parts.push(n + ' measurements over ' + (span || '?') + ' days');
  if (hrFloorMed) parts.push('Resting HR: ' + hrFloorMed + ' bpm (nocturnal p5)');
  // ANS-age auto-detect pill REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
  if (hrMin && hrMax) parts.push('HR range: ' + hrMin + '–' + hrMax + ' bpm');

  var el = document.getElementById('profileAutoText');
  if (el)
    el.innerHTML = parts
      .map(function (p) {
        return '<span class="auto-pill">' + p + '</span>';
      })
      .join('');

  // ANS-age sublabel + "Projected ANS Age" hero footer REMOVED 2026-06-23
  // (DEX-METRIC-REMOVAL-AUDIT 🔴): a population age-regression shown as a personal age.

  // Auto-fill HR rest (p5 + 8) if user hasn't manually set it
  // Detected resting HR → shared DETECTED tier (NOT manual identity). window._upHRrest
  // (set above) still feeds the Karvonen zones; the unified panel shows it as "detected".
  if (hrRestEst && window.DexProfile) {
    try {
      window.DexProfile.prefillFrom({ hrRest: hrRestEst });
    } catch (e) {}
  }
  // Always update HRrest sublabel with avg + last-night value
  if (hrFloorMed) {
    var hrSub = document.getElementById('profileHRrestSub');
    if (hrSub) {
      var txt = '∼ avg ' + (hrFloorMed + 8) + ' bpm (p5 ' + hrFloorMed + ' + 8)';
      if (lastNightVals.hrRest != null) {
        txt += ' · last ' + lastNightVals.hrRest + ' (p5 ' + lastNightVals.hrFloor + ' + 8)';
      }
      txt += ' · trained athletes typically 12–15 bpm lower';
      hrSub.textContent = txt;
    }
  }

  // HRV/oximetry→SBP/DBP autofill REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴):
  // cuffless BP from signals is indefensible (bpProj is already hard-null in dsp).
  // prof_sbp/prof_dbp stay USER-ENTERED cuff inputs only.

  // Auto-fill VO2 from best night estimate — sublabel shows avg + last + ACSM tier
  var vo2Nights = allNights.filter(function (n) {
    return n && n.vo2est && n.vo2est.vo2est;
  });
  if (vo2Nights.length) {
    var vo2s = vo2Nights
      .map(function (n) {
        return n.vo2est.vo2est;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var vo2Med = +vo2s[Math.floor(vo2s.length / 2)].toFixed(1);
    if (window.DexProfile) {
      try {
        window.DexProfile.prefillFrom({ vo2: vo2Med });
      } catch (e) {}
    }
    // Update sublabel with avg + last + ACSM category
    var _vc = upVO2category(vo2Med);
    var vs = document.getElementById('profileVo2Sub');
    if (vs) {
      var vTxt = '∼ avg ' + vo2Med + ' mL/kg/min';
      if (lastNightVals.vo2 != null) {
        vTxt += ' · last ' + (+lastNightVals.vo2).toFixed(1);
      }
      vTxt += ' · Uth-Sørensen across ' + vo2Nights.length + ' nights';
      if (_vc) vTxt += ' · ' + _vc.cat + ' (' + _vc.pct + ')';
      vs.textContent = vTxt;
    }
  }

  profileDerivedUpdate();
  // No upSave: auto-detected values live in the DETECTED tier (prefillFrom above), never
  // persisted as manual. Only explicit panel edits write manual identity (no leak).
}

function recomputeFromProfile() {
  // Re-run VO2max and Karvonen zones for every loaded night using current UP profile.
  // Called when profile changes (age, HRmax override, HRrest override).
  // Does NOT re-parse raw CSV — uses stored night stats + current UP values.
  Object.values(allNights).forEach(function (n) {
    try {
      // ── VO2max (Uth-Sørensen: HRmax/HRrest * 15) ───────────────
      var hrMax = UP.hrmaxOverride && UP.hrmaxOverride > 100 ? UP.hrmaxOverride : Math.round(208 - 0.7 * (UP.age || 49));
      var hrRest = UP.hrRestOverride && UP.hrRestOverride > 30 && UP.hrRestOverride < 100 ? UP.hrRestOverride : n.vo2est ? n.vo2est.hrRest : n.hrv ? n.hrv.hrFloor : null;
      if (hrRest && hrRest > 30 && hrRest < 80 && hrMax > 100) {
        var _rmssdAdj = n.hrv && n.hrv.rmssd != null ? +Math.max(-3, Math.min(3, (n.hrv.rmssd - 1.4) * 1.05)).toFixed(1) : 0;
        var _newBase = +(15.3 * (hrMax / hrRest)).toFixed(1);
        var _newVo2 = +(_newBase + _rmssdAdj).toFixed(1);
        if (!n.vo2est) n.vo2est = {};
        n.vo2est.hrRest = hrRest;
        n.vo2est.hrMax = hrMax;
        n.vo2est.rmssdAdj = _rmssdAdj;
        n.vo2est.vo2est = _newVo2;
        n.vo2est.vo2Low = +(_newVo2 - 10.8).toFixed(1);
        n.vo2est.vo2High = +(_newVo2 + 10.8).toFixed(1);
        var _vc = upVO2category(_newVo2);
        if (_vc) {
          n.vo2est.vo2Category = _vc.cat + ' (' + _vc.pct + ')';
          n.vo2est.vo2Pct = _vc.pct;
        }
      }
      // ── Karvonen zones + readiness (pass null rows — guard allows it now) ──
      var newKarv = computeKarvonenZones(null, n.hrv, n.vo2est, n.odi4, n.hypDose, n.sleepArch, n.stageProxy, UP.age || 49, n.stats ? n.stats.durationMin : null);
      if (newKarv) n.karv = newKarv;
    } catch (e) {}
  });
}

function profileChanged() {
  upFromDOM();
  upSave();
  profileDerivedUpdate();
  if (window.allNights && Object.keys(window.allNights).length > 0) {
    // Debounce the heavy dashboard re-render so typing in a profile field
    // doesn't rebuild #results on every keystroke (which moved the focused
    // input mid-edit and felt like the value was being lost).
    clearTimeout(window._profRenderTimer);
    window._profRenderTimer = setTimeout(function () {
      try {
        recomputeFromProfile(); // re-run VO2max + Karvonen before re-render
        renderAll();
      } catch (e) {}
    }, 450);
  }
}

function toggleProfile() {
  var body = document.getElementById('profileBody');
  var btn = document.getElementById('profileToggleBtn');
  if (!body || !btn) return;
  var isOpen = body.dataset.open !== 'false';
  body.dataset.open = isOpen ? 'false' : 'true';
  body.style.display = isOpen ? 'none' : 'block'; // explicit 'block', not '' (avoids CSS override)
  btn.textContent = isOpen ? '▼ expand' : '▲ collapse';
  btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}

function openProfile() {
  var body = document.getElementById('profileBody');
  var btn = document.getElementById('profileToggleBtn');
  if (!body || !btn) return;
  body.dataset.open = 'true';
  body.style.display = 'block'; // explicit 'block' overrides any CSS display:none
  btn.textContent = '▲ collapse';
  btn.setAttribute('aria-expanded', 'true');
  var panel = document.getElementById('userProfilePanel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Init on page load ──
(function initProfile() {
  upLoad();
  upToDOM();
  profileDerivedUpdate();
  if (window.DexProfile && window.DexProfile.renderPanel) {
    window._oxyPanel = window.DexProfile.renderPanel({
      node: 'oxydex',
      mount: 'dexProfilePanel',
      onChange: function () {
        upLoad(); // adopt the now-non-pristine shared record into UP
        profileDerivedUpdate(); // refresh Karvonen zones (legacy pd_*/subs are no-ops)
        if (window.allNights && Object.keys(window.allNights).length > 0) {
          clearTimeout(window._profRenderTimer);
          window._profRenderTimer = setTimeout(function () {
            try {
              recomputeFromProfile();
              renderAll();
            } catch (e) {}
          }, 350);
        }
      }
    });
  }
})();
