/* ════ HRVDex · PROFILE & PERSONALIZATION (hrvdex-profile.js) ───────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   User profile (localStorage), data-driven inference, population norms,
   age-norm application, the ANS-age card, and the profile-panel toggle.
   Plain global script — shares page scope with the other hrvdex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: hrvdex-dsp → hrvdex-render → hrvdex-profile → hrvdex-app.
   ════════════════════════════════════════════════════════════════════════ */

/* ===== DERIVED METRICS ===== */

// ══════════════════════════════════════════════════════════════════
// USER PROFILE — persisted in localStorage
// ══════════════════════════════════════════════════════════════════
const PROFILE_KEYS = ['prof_age', 'prof_sex', 'prof_weight', 'prof_height', 'prof_sbp', 'prof_dbp', 'prof_vo2gt', 'prof_hrmax', 'prof_hrrest', 'prof_elev'];
// Storage is unified onto the shared DexProfile engine (key `tepna_profile`,
// PROFILE-UNIFY-BRIEF). The DOM stays the runtime source of truth; only the
// persistence backend changes. `_hrvLoading` suppresses persistence during load
// so merely opening HRVDex never writes its HTML defaults into the shared record.
let _hrvLoading = false;
const DXP = () => window.DexProfile;

// ══════════════════════════════════════════════════════════════════
// INFER PROFILE FROM LOADED DATA
// ══════════════════════════════════════════════════════════════════
function clearEstimate(inputId, labelId) {
  // User typed a value: drop the "estimated" border tint but KEEP the projection
  // sublabel visible as a reference (matches OxyDex behavior).
  const el = document.getElementById(inputId);
  if (el) el.style.borderColor = '';
}

function inferFromData() {
  if (!allRows || allRows.length < 3) return;

  const morningRows = allRows.filter((r) => r._date.getUTCHours() < 10);
  const useRows = morningRows.length >= 3 ? morningRows : allRows;

  // Resting HR: median of morning readings
  const hrs = useRows
    .map((r) => r._hr)
    .filter((v) => v > 30 && v < 120)
    .sort((a, b) => a - b);
  const restingHR = hrs.length ? hrs[Math.floor(hrs.length / 2)] : 60;

  // Max HR observed in ALL rows (lower bound for HRmax)
  const _hrAll = allRows.map((r) => r._hr).filter((v) => v > 0);
  const hrMax = _hrAll.length ? Math.max(..._hrAll) : 0; // v2.9: guard empty array

  // ANS AGE composite REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴): a population
  // age-regression presented as a personal “autonomic age” — indefensible framing, no
  // validation. Age is no longer inferred from HRV. VO₂ (a kept research metric) uses the
  // user's chronological age, falling back to a neutral population default ONLY if unset
  // (clearly not derived from your data — never written to identity).
  const _DEFAULT_AGE = 40;

  // C2: SDNN (ms) → age. ~80ms≈44yr · ~50ms≈58yr (HRVDex legacy formula)
  function _ageSDNN(ms) {
    return null;
  } // ANS-age helper retired 2026-06-23 (unused; kept as null stub)

  // ANS-age per-row aggregation REMOVED 2026-06-23 (DEX-METRIC-REMOVAL-AUDIT 🔴).
  renderANSAgeCard();

  // VO2max estimate using current age from profile (or ANS age if profile age unset).
  // Route through the cascade (getProfile→DexProfile) — never read the removed #prof_age
  // DOM input directly (PROFILE-DOM-READ-AUDIT §1/§2: it resolves to null under the panel).
  const _pp = getProfile();
  const currentAge = _pp.age || _DEFAULT_AGE;
  const _tanaka = 208 - 0.7 * currentAge;
  // resting HR: manual override else median morning HR; HRmax guard against implausible entry
  const _hrRestV = _pp.hrrest_manual > 0 ? _pp.hrrest_manual : restingHR;
  const _hrmaxV = _pp.hrmax_manual > 0 && _pp.hrmax_manual >= 140 && _pp.hrmax_manual > _hrRestV + 45 ? _pp.hrmax_manual : _tanaka;
  const _altF = _pp.elev <= 1500 ? 1 : Math.max(0.55, 1 - ((_pp.elev - 1500) / 300) * 0.01);
  const vo2Est = Math.round(15.3 * (_hrmaxV / _hrRestV) * _altF * 10) / 10; // Uth-Sørensen + altitude

  // HRV→BP derivation REMOVED 2026-06-22 (DEX-SUITE-EXTERNAL-REVIEW-v2 §🔴 — same
  // class as the PulseDex SBP/DBP leak just removed): cuffless BP from HRV has no
  // validity. prof_sbp / prof_dbp remain USER-ENTERED cuff values (legitimate inputs
  // to MAP/BAP); they are no longer auto-filled from HRV nor labelled as a projection.
  // Detected physiology → shared DETECTED tier (cross-node handoff). ANS-age is a retired
  // heuristic and is DELIBERATELY never written to identity (chronological age stays user/pop).
  if (DXP()) {
    try {
      DXP().prefillFrom({ hrRest: restingHR, vo2: vo2Est });
    } catch (e) {}
  }
  window._projVO2 = vo2Est;

  // Date range info
  const dates = allRows
    .map((r) => r._date)
    .filter((d) => !isNaN(d))
    .sort((a, b) => a - b);
  const daySpan = dates.length > 1 ? Math.round((dates[dates.length - 1] - dates[0]) / 86400000) : 0;
  const morningPct = allRows.length ? Math.round((morningRows.length / allRows.length) * 100) : 0;

  // ── Populate fields (only if not already user-modified) ────────────
  function setIfEmpty(id, val, isEstimate) {
    const el = document.getElementById(id);
    if (!el) return;
    // Auto-fill only if the field still holds its default / empty value. Checks the
    // DOM (loaded from the shared DexProfile record) rather than the retired per-key
    // localStorage, preserving the original "don't clobber a user entry" semantics.
    const defaultVals = { prof_age: '35', prof_weight: '75.0', prof_height: '175.0', prof_sbp: '120', prof_dbp: '78', prof_vo2gt: '0', prof_hrmax: '0' };
    const cur = (el.value == null ? '' : String(el.value)).trim();
    if (cur === '' || cur === defaultVals[id]) el.value = val;
  }

  // Fields we CAN infer (BP intentionally NOT inferred — see HRV→BP removal above)
  setIfEmpty('prof_vo2gt', vo2Est, true);
  setIfEmpty('prof_hrmax', 0, false); // keep 0 = auto (use Tanaka)

  // Show the calculated projection value in each sublabel (visible above the input),
  // so the projection stays visible even after a manual override (matches OxyDex).
  function _setSub(id, txt) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = txt;
      el.style.display = '';
    }
  }
  _setSub('lbl_vo2gt', '∼ Uth-Sørensen → ' + vo2Est + ' (HRmax ' + Math.round(_hrmaxV) + '/HRrest ' + Math.round(_hrRestV) + (_altF < 1 ? ' · alt ×' + _altF.toFixed(2) : '') + ')');

  // Age is NOT auto-filled from HRV anymore (ANS-age removed 2026-06-23,
  // DEX-METRIC-REMOVAL-AUDIT 🔴). The field keeps its neutral default; the user enters
  // their real chronological age. No HRV→age sublabel.
  var _lblAge = document.getElementById('lbl_age');
  if (_lblAge) {
    _lblAge.style.display = 'none';
  }
  // Auto-fill weight + height from population norms for this age/sex
  applyAgeNorms(false);

  // Show inference summary banner
  const banner = document.getElementById('inferBanner');
  if (banner) {
    banner.innerHTML = [
      '🔍 <strong>Auto-detected from your data</strong> &nbsp;·&nbsp;',
      allRows.length + ' measurements over ' + daySpan + ' days',
      ' &nbsp;·&nbsp; ' + morningPct + '% morning',
      ' &nbsp;·&nbsp; Resting HR: <strong>' + restingHR + ' bpm</strong>',
      ' &nbsp;·&nbsp; HR range: <strong>' + (hrs.length ? Math.min(...hrs) + '–' + Math.max(...hrs) : '?–?') + ' bpm</strong>',
      ' &nbsp;·&nbsp; Max HR observed: <strong>' + hrMax + ' bpm</strong>',
      ' &nbsp;·&nbsp; <span style="color:var(--yellow)">🟡 Yellow = auto-estimated from HRV · Override with your real values</span>'
    ].join('');
    banner.style.display = 'block';
  }

  updateProfile();
}

function renderANSAgeCard() {
  // ANS Age + Projected-BP card REMOVED 2026-06-21 (external-review WP-A): a population
  // age regression + cuffless BP from HRV. VO₂ remains in the metrics table. The card DOM
  // (#ansAgeProjGrid/#ansAgeCard) was deleted; this no-op tolerates the missing nodes so
  // legacy callers (computeDerived / profile updates) stay wired without error.
  var grid = document.getElementById('ansAgeProjGrid');
  if (grid) grid.style.display = 'none';
}

function loadProfile() {
  if (DXP()) {
    _hrvLoading = true;
    try {
      DXP().migrate();
      if (DXP().renderPanel && !window._hrvPanel) {
        window._hrvPanel = DXP().renderPanel({
          node: 'hrvdex',
          mount: 'dexProfilePanel',
          onChange: function () {
            updateProfile();
          }
        });
      }
      // While the shared record is pristine (no real identity yet) keep HRVDex's own
      // HTML defaults so a fresh-user render is unchanged; adopt once it holds data.
      if (!DXP().isPristine()) {
        const p = DXP().get(),
          man = DXP().getRecord().manual || {};
        const set = (id, v) => {
          const el = document.getElementById(id);
          if (el != null && v != null && v !== '') el.value = v;
        };
        set('prof_age', p.age);
        const sx = document.getElementById('prof_sex');
        if (sx) sx.value = p.sex === 'F' ? 'F' : 'M';
        set('prof_weight', p.weight);
        set('prof_height', p.height);
        set('prof_sbp', p.sbp);
        set('prof_dbp', p.dbp);
        set('prof_vo2gt', man.vo2 != null ? man.vo2 : '');
        set('prof_hrmax', man.hrMax != null ? man.hrMax : '');
        set('prof_hrrest', man.hrRest != null ? man.hrRest : '');
        set('prof_elev', p.elevation != null ? p.elevation : '');
      }
    } catch (e) {}
    updateProfile();
    _hrvLoading = false;
    return;
  }
  PROFILE_KEYS.forEach((k) => {
    const el = document.getElementById(k);
    const saved = localStorage.getItem(k);
    if (el && saved !== null) el.value = saved;
  });
  updateProfile();
}

function getProfile() {
  if (DXP()) {
    const p = DXP().get(),
      man = DXP().getRecord().manual || {};
    const n = (v, d) => {
      const x = parseFloat(v);
      return isFinite(x) ? x : d;
    };
    // Detected handoff into COMPUTE (PROFILE-HANDOFF-BRIEF §1): manual wins; else a value
    // DETECTED from a loaded recording (origin==='detected'); else 0 ⇒ node auto.
    const detOr0 = (field) => {
      const mv = n(man[field], 0);
      if (mv > 0) return mv;
      const r = DXP().resolve(field);
      return r.origin === 'detected' && r.v > 0 ? r.v : 0;
    };
    return {
      age: n(p.age, 35),
      sex: p.sex === 'F' ? 'F' : 'M',
      weight: n(p.weight, 75),
      height: n(p.height, 175),
      sbp: n(p.sbp, 120),
      dbp: n(p.dbp, 78),
      vo2gt: detOr0('vo2'),
      hrmax_manual: n(man.hrMax, 0) > 0 ? n(man.hrMax, 0) : 0,
      hrrest_manual: detOr0('hrRest'),
      elev: n(p.elevation, 0)
    };
  }
  return {
    age: parseFloat(document.getElementById('prof_age')?.value) || 35,
    sex: document.getElementById('prof_sex')?.value || 'M',
    weight: parseFloat(document.getElementById('prof_weight')?.value) || 75,
    height: parseFloat(document.getElementById('prof_height')?.value) || 175,
    sbp: parseFloat(document.getElementById('prof_sbp')?.value) || 120,
    dbp: parseFloat(document.getElementById('prof_dbp')?.value) || 78,
    vo2gt: parseFloat(document.getElementById('prof_vo2gt')?.value) || 0,
    hrmax_manual: parseFloat(document.getElementById('prof_hrmax')?.value) || 0,
    hrrest_manual: parseFloat(document.getElementById('prof_hrrest')?.value) || 0,
    elev: parseFloat(document.getElementById('prof_elev')?.value) || 0
  };
}

// ══════════════════════════════════════════════════════════════════
// POPULATION NORMS — auto-fill weight/height from age+sex
// Source: US NHANES 2017-2020, WHO reference data
// ══════════════════════════════════════════════════════════════════
const POP_NORMS = {
  M: {
    18: { w: 79.8, h: 177.4 },
    30: { w: 85.6, h: 177.2 },
    40: { w: 89.4, h: 176.7 },
    50: { w: 91.4, h: 175.8 },
    60: { w: 87.9, h: 174.6 },
    70: { w: 82.1, h: 172.3 }
  },
  F: {
    18: { w: 68.2, h: 163.5 },
    30: { w: 73.4, h: 163.2 },
    40: { w: 76.8, h: 162.7 },
    50: { w: 78.3, h: 161.9 },
    60: { w: 76.1, h: 160.5 },
    70: { w: 71.4, h: 158.2 }
  }
};

function getAgeBand(age) {
  if (age < 30) return '18';
  if (age < 40) return '30';
  if (age < 50) return '40';
  if (age < 60) return '50';
  if (age < 70) return '60';
  return '70';
}

function applyAgeNorms(useIdeal) {
  window._useIdeal = useIdeal; // remember last choice
  const p = getProfile();
  const band = getAgeBand(p.age);
  const norm = POP_NORMS[p.sex]?.[band];
  if (!norm) return;

  const weightEl = document.getElementById('prof_weight');
  const heightEl = document.getElementById('prof_height');
  if (!weightEl || !heightEl) return;

  // Height: always use population average (can't be "ideal")
  const h = norm.h;
  // Weight: population average OR ideal weight (BMI 22.5)
  const w = useIdeal ? Math.round(22.5 * (h / 100) ** 2 * 10) / 10 : norm.w;

  weightEl.value = w;
  heightEl.value = h;
  weightEl.style.borderColor = '';
  heightEl.style.borderColor = '';

  // Update labels — show the computed values (matches OxyDex richness)
  const wLabel = document.getElementById('lbl_weight');
  const hLabel = document.getElementById('lbl_height');
  const idealW = Math.round(22.5 * (h / 100) ** 2 * 10) / 10;
  if (wLabel) {
    wLabel.textContent = useIdeal ? '∼ ideal (BMI 22.5) ' + w + ' kg' : '∼ CDC pop avg ' + norm.w + ' kg · ideal (BMI 22.5) ' + idealW + ' kg';
    wLabel.style.display = '';
  }
  if (hLabel) {
    hLabel.textContent = '∼ CDC pop avg ' + h + ' cm';
    hLabel.style.display = '';
  }

  updateProfile();
}

function updateProfile() {
  // Persist to the shared DexProfile record (key `tepna_profile`) — identity unified
  // across the suite. Override fields keep `0 = auto` (stored only when set).
  // Skipped during load (`_hrvLoading`) so HTML defaults never contaminate the record.
  if (DXP()) {
    if (!_hrvLoading && document.getElementById('prof_age'))
      try {
        const g = (id) => {
          const e = document.getElementById(id);
          return e ? e.value : '';
        };
        const num = (v) => {
          const n = parseFloat(v);
          return isFinite(n) ? n : null;
        };
        DXP().setManual('age', num(g('prof_age')));
        DXP().setManual('sex', g('prof_sex'));
        DXP().setManual('weight', num(g('prof_weight')));
        DXP().setManual('height', num(g('prof_height')));
        DXP().setManual('sbp', num(g('prof_sbp')));
        DXP().setManual('dbp', num(g('prof_dbp')));
        DXP().setManual('vo2', num(g('prof_vo2gt')) > 0 ? num(g('prof_vo2gt')) : null);
        DXP().setManual('hrMax', num(g('prof_hrmax')) > 0 ? num(g('prof_hrmax')) : null);
        DXP().setManual('hrRest', num(g('prof_hrrest')) > 0 ? num(g('prof_hrrest')) : null);
        DXP().setManual('elevation', num(g('prof_elev')));
      } catch (e) {}
  } else {
    PROFILE_KEYS.forEach((k) => {
      const el = document.getElementById(k);
      if (el) localStorage.setItem(k, el.value);
    });
  }

  const p = getProfile();

  // Derived values
  const bmi = p.weight / (p.height / 100) ** 2;
  const bsa = Math.sqrt((p.height * p.weight) / 3600); // DuBois formula
  const ibw = p.sex === 'M' ? 50 + 2.3 * (p.height / 2.54 - 60) : 45.5 + 2.3 * (p.height / 2.54 - 60);
  const tanaka = Math.round(208 - 0.7 * p.age); // Tanaka 2001 HRmax
  // Guard implausible manual HRmax (must clear resting by a wide margin & sit in range)
  const _hrRest0 = typeof allRows !== 'undefined' && allRows.length > 0 ? Math.round(allRows.reduce((s, r) => s + r._hr, 0) / allRows.length) : 60;
  const hrmaxValid = p.hrmax_manual > 0 && p.hrmax_manual >= 140 && p.hrmax_manual > _hrRest0 + 45;
  const hrmaxRejected = p.hrmax_manual > 0 && !hrmaxValid;
  const hrmax = hrmaxValid ? p.hrmax_manual : tanaka;
  const map_ = Math.round(p.dbp + (p.sbp - p.dbp) / 3);
  const pp = p.sbp - p.dbp;
  const bmr =
    p.sex === 'M'
      ? Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + 5) // Mifflin-St Jeor male
      : Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age - 161); // female

  // HR Training Zones (Karvonen: needs HRrest — use median from data if available)
  const hrRest = typeof allRows !== 'undefined' && allRows.length > 0 ? Math.round(allRows.reduce((s, r) => s + r._hr, 0) / allRows.length) : 60;
  const hrr = hrmax - hrRest; // HR Reserve
  const z1_lo = Math.round(hrRest + 0.5 * hrr),
    z1_hi = Math.round(hrRest + 0.6 * hrr);
  const z2_lo = Math.round(hrRest + 0.6 * hrr),
    z2_hi = Math.round(hrRest + 0.7 * hrr);
  const z3_lo = Math.round(hrRest + 0.7 * hrr),
    z3_hi = Math.round(hrRest + 0.8 * hrr);
  const z4_lo = Math.round(hrRest + 0.8 * hrr),
    z4_hi = Math.round(hrRest + 0.9 * hrr);
  const z5_lo = Math.round(hrRest + 0.9 * hrr);

  // VO2max absolute (L/min)
  const vo2_abs = ((p.vo2gt * p.weight) / 1000).toFixed(2);

  // Use shared calcVo2Cat() — no duplicate table needed
  const vo2CatStr = p.vo2gt > 0 ? calcVo2Cat(p.vo2gt, p.age, p.sex) : '(enter VO₂ GT)';

  // Full Baevsky AP (requires SBP+DBP)
  // BAP = 0.011×HR + 0.014×age + 0.008×SBP + 0.014×DBP - 0.009×weight - 0.009×height - 0.27
  // (Baevsky 1984, Berntsen 2008 variant)
  const bap_full = (0.011 * hrRest + 0.014 * p.age + 0.008 * p.sbp + 0.014 * p.dbp - 0.009 * p.weight - 0.009 * p.height - 0.27).toFixed(3);

  // Percentile rank VO2max vs population (approximate from meta-analysis lookup)
  function vo2Percentile(vo2, age, sex) {
    // Cooper Institute data by age band (male)
    const mPerc = {
      '20-29': [
        [31, 5],
        [37, 20],
        [42, 40],
        [49, 60],
        [55, 80],
        [62, 95]
      ],
      '30-39': [
        [29, 5],
        [35, 20],
        [40, 40],
        [46, 60],
        [52, 80],
        [59, 95]
      ],
      '40-49': [
        [25, 5],
        [31, 20],
        [36, 40],
        [42, 60],
        [49, 80],
        [56, 95]
      ],
      '50-59': [
        [22, 5],
        [27, 20],
        [31, 40],
        [37, 60],
        [44, 80],
        [51, 95]
      ],
      '60-69': [
        [18, 5],
        [23, 20],
        [27, 40],
        [32, 60],
        [38, 80],
        [45, 95]
      ]
    };
    const fPerc = {
      '20-29': [
        [26, 5],
        [31, 20],
        [36, 40],
        [41, 60],
        [48, 80],
        [55, 95]
      ],
      '30-39': [
        [24, 5],
        [29, 20],
        [33, 40],
        [39, 60],
        [45, 80],
        [52, 95]
      ],
      '40-49': [
        [21, 5],
        [25, 20],
        [29, 40],
        [34, 60],
        [40, 80],
        [47, 95]
      ],
      '50-59': [
        [18, 5],
        [22, 20],
        [26, 40],
        [30, 60],
        [37, 80],
        [44, 95]
      ],
      '60-69': [
        [15, 5],
        [19, 20],
        [22, 40],
        [27, 60],
        [34, 80],
        [40, 95]
      ]
    };
    const bin = age < 30 ? '20-29' : age < 40 ? '30-39' : age < 50 ? '40-49' : age < 60 ? '50-59' : '60-69';
    const table = sex === 'M' ? mPerc : fPerc;
    const pts = table[bin] || table['40-49'];
    for (let j = 0; j < pts.length - 1; j++) {
      if (vo2 >= pts[j][0] && vo2 < pts[j + 1][0]) {
        const frac = (vo2 - pts[j][0]) / (pts[j + 1][0] - pts[j][0]);
        return Math.round(pts[j][1] + frac * (pts[j + 1][1] - pts[j][1]));
      }
    }
    return vo2 >= pts[pts.length - 1][0] ? 99 : 1;
  }
  const vo2Perc = vo2Percentile(p.vo2gt, p.age, p.sex);

  // Render derived — O2Ring grouped structure
  const d = document.getElementById('profileDerived');
  if (!d) return;
  const bmiCat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  const _inch = (p.height / 2.54).toFixed(0);
  const di = (label, val, f) => `<div class="prof-derived-item"><b>${label}</b> ${val}${f ? `<span class="pdi-formula">${f}</span>` : ''}</div>`;
  const grp = (label, items) => `<div class="pd-group"><span class="pd-group-label">${label}</span><div class="pd-group-grid">${items}</div></div>`;
  d.innerHTML =
    grp(
      'Body composition',
      di('BMI', bmi.toFixed(1) + ' (' + bmiCat + ')', 'kg ÷ m² = ' + p.weight + ' ÷ ' + (p.height / 100).toFixed(2) + '²') +
        di('IBW', ibw.toFixed(1) + ' kg', 'Devine: ' + (p.sex === 'M' ? '50' : '45.5') + ' + 2.3·(' + _inch + 'in−60)') +
        di('BSA', bsa.toFixed(2) + ' m²', 'DuBois: √(' + p.height + '·' + p.weight + '/3600)') +
        di('BMR', bmr + ' kcal', 'Mifflin: 10·w+6.25·h−5·a' + (p.sex === 'M' ? '+5' : '−161'))
    ) +
    grp(
      'Cardiovascular',
      di('HRmax', hrmax + ' bpm', hrmaxRejected ? '⚠ entry low → Tanaka 208−0.7·' + p.age : p.hrmax_manual > 0 ? 'your entry' : 'Tanaka: 208−0.7·' + p.age) +
        di('MAP', map_ + ' mmHg', 'DBP + ⅓(SBP−DBP)') +
        di('Pulse pressure', pp + ' mmHg', 'SBP − DBP = ' + p.sbp + '−' + p.dbp) +
        di('BAP (full)', bap_full, 'Baevsky 1984 regression')
    ) +
    grp(
      'Respiratory / fitness',
      di('VO₂ absolute', vo2_abs + ' L/min', p.vo2gt > 0 ? 'VO₂·weight/1000 = ' + p.vo2gt + '·' + p.weight + '/1000' : 'enter VO₂max ground truth') +
        di('VO₂ category', vo2CatStr, 'ACSM age·sex norms') +
        di(
          'VO₂ percentile',
          '~' + vo2Perc + 'th',
          'Cooper bands (' + (p.age < 30 ? '20s' : p.age < 40 ? '30s' : p.age < 50 ? '40s' : p.age < 60 ? '50s' : '60+') + ' ' + (p.sex === 'M' ? 'M' : 'F') + ')'
        )
    );

  // Field hints: HRmax guard, resting HR, elevation
  const altFactor = p.elev <= 1500 ? 1 : Math.max(0.55, 1 - ((p.elev - 1500) / 300) * 0.01);
  const _set = (id, txt, est) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    el.classList.toggle('est', !!est);
  };
  if (hrmaxRejected) _set('lbl_hrmax', '⚠ entry too low — using Tanaka ' + tanaka + ' bpm', true);
  else _set('lbl_hrmax', p.hrmax_manual > 0 ? '✓ your value ' + hrmax + ' bpm' : '~ Tanaka: 208 − 0.7 × age = ' + tanaka);
  _set('lbl_hrrest', p.hrrest_manual > 0 ? '✓ your value' : '~ from morning readings: ' + _hrRest0 + ' bpm (median)', p.hrrest_manual <= 0);
  if (p.elev >= 2500) _set('lbl_elev', '🏔 ' + p.elev.toLocaleString() + ' m · VO₂ ×' + altFactor.toFixed(2) + ' · HRV norms = sea-level (caution)', true);
  else if (p.elev > 1500) _set('lbl_elev', '⛰ ' + p.elev.toLocaleString() + ' m · VO₂ ×' + altFactor.toFixed(2), true);
  else _set('lbl_elev', '~ sea level · adjusts VO₂max above 1500 m');
  window._hrvProfileAlt = altFactor; // consumed by VO₂ projection

  // Recompute the VO₂ projection live (inferFromData only runs at load, so
  // changing HRmax / Resting HR / Elevation must refresh _projVO2 + the hint here)
  const _rhrProj = p.hrrest_manual > 0 ? p.hrrest_manual : _hrRest0;
  if (_rhrProj > 0) {
    const vo2Proj = Math.round(15.3 * (hrmax / _rhrProj) * altFactor * 10) / 10;
    window._projVO2 = vo2Proj;
    const lv = document.getElementById('lbl_vo2gt');
    if (lv) lv.textContent = '∼ Uth-Sørensen → ' + vo2Proj + ' (HRmax ' + hrmax + '/HRrest ' + Math.round(_rhrProj) + (altFactor < 1 ? ' · alt ×' + altFactor.toFixed(2) : '') + ')';
    if (typeof renderANSAgeCard === 'function' && typeof allRows !== 'undefined' && allRows.length) renderANSAgeCard();
  }

  // Populate HR zones separately
  const pz = document.getElementById('profileZones');
  if (pz) {
    const zr = (label, lo, hi, cls) => `<div class="prof-zone-row ${cls}"><span class="prof-zone-label">${label}</span><span class="prof-zone-val">${lo}–${hi} bpm</span></div>`;
    document.getElementById('profileZones').innerHTML =
      '<div class="prof-zone-label-sm">Karvonen HR Zones</div>' +
      zr('Z1 Recovery', z1_lo, z1_hi, 'zone-1') +
      zr('Z2 Aerobic', z2_lo, z2_hi, 'zone-2') +
      zr('Z3 Threshold', z3_lo, z3_hi, 'zone-3') +
      zr('Z4 Lactate', z4_lo, z4_hi, 'zone-4') +
      `<div class="prof-zone-row zone-5"><span class="prof-zone-label">Z5 Max</span><span class="prof-zone-val">${z5_lo}+ bpm</span></div>`;
  }

  // Re-render if data is loaded (profile changed)
  // Note: computeDerived() is NOT called here — call it explicitly when profile actually changes HRV
  if (typeof allRows !== 'undefined' && allRows.length > 0) {
    if (typeof renderANSAgeCard === 'function') renderANSAgeCard();
    rerender();
  }
}

function calcVo2Cat(vo2, age, sex) {
  // age and sex passed from caller to avoid getProfile() DOM read per row
  const maleNorms = {
    '20-24': [37.1, 42.2, 46.2, 52.1],
    '25-29': [36.2, 40.0, 44.2, 49.4],
    '30-34': [34.6, 38.5, 42.4, 47.4],
    '35-39': [32.5, 36.7, 40.8, 45.4],
    '40-44': [31.1, 35.4, 38.9, 43.7],
    '45-49': [28.7, 32.3, 35.9, 40.5, 49.5],
    '50-54': [26.1, 30.9, 33.8, 37.4],
    '55-59': [24.5, 28.0, 31.4, 34.3],
    '60-64': [23.3, 25.6, 27.8, 31.2],
    '65-69': [19.8, 22.7, 25.6, 27.9]
  };
  const femaleNorms = {
    '20-24': [31.0, 35.2, 38.6, 43.9],
    '25-29': [29.4, 33.4, 36.7, 41.0],
    '30-34': [27.7, 31.4, 34.4, 38.6],
    '35-39': [25.8, 29.5, 32.5, 37.7],
    '40-44': [24.5, 27.8, 30.9, 35.0],
    '45-49': [22.8, 26.2, 29.0, 32.3],
    '50-54': [20.8, 24.0, 26.7, 29.4],
    '55-59': [20.0, 22.0, 24.3, 26.6]
  };
  const ab =
    age < 25
      ? '20-24'
      : age < 30
        ? '25-29'
        : age < 35
          ? '30-34'
          : age < 40
            ? '35-39'
            : age < 45
              ? '40-44'
              : age < 50
                ? '45-49'
                : age < 55
                  ? '50-54'
                  : age < 60
                    ? '55-59'
                    : age < 65
                      ? '60-64'
                      : '65-69';
  const t = (sex === 'M' ? maleNorms : femaleNorms)[ab] || [25, 30, 35, 40, 45];
  if (vo2 < t[0]) return 'Very Poor';
  if (vo2 < t[1]) return 'Poor';
  if (vo2 < t[2]) return 'Fair';
  if (vo2 < t[3]) return 'Good';
  if (t[4] && vo2 < t[4]) return 'Excellent';
  return 'Superior';
}

// ── Profile panel collapse toggle ─────────────────────────────
function toggleProfilePanel() {
  var body = document.getElementById('profileBody');
  var btn = document.getElementById('profileToggleBtn');
  var ad = document.getElementById('profileAutoDetect');
  if (!body) return;
  var collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (ad) ad.style.display = collapsed ? '' : 'none';
  if (btn) btn.textContent = collapsed ? '▲ collapse' : '▼ expand';
}

// ESM-MIGRATION deep-3: profile is now an ES module — publish the cross-file surface
// (hrvdex-dsp's inferFromData/getProfile/calcVo2Cat reach-ins, hrvdex-app's loadProfile/
// toggleProfilePanel calls, and the updateProfile data-act wrapper).
Object.assign(window, {
  inferFromData,
  loadProfile,
  getProfile,
  updateProfile,
  calcVo2Cat,
  toggleProfilePanel
});
// FOLLOWUPS-II item 3: inject profile's compute-input hooks into the DSP (no longer reached bare).
if (window.HRVDex && window.HRVDex.setHooks) window.HRVDex.setHooks({ inferFromData, getProfile, calcVo2Cat });
