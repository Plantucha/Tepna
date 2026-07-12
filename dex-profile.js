/*
 * dex-profile.js — Tepna · shared unified user-profile engine (window.DexProfile)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE shared identity + ONE formula engine + ONE panel for the whole suite.
 * Replaces six drifted per-node profiles (OxyDex `UP`, HRVDex bare globals,
 * PulseDex overview globals, ECG/PPG/Gluco IIFEs). Each node only declares
 * which FIELD GROUPS it uses (a manifest); the cascade, norms, formulas, units
 * and panel live here.  Spec = `Unified Profile - Detailed Mockup.html` +
 * `PROFILE-UNIFY-BRIEF.md`. Canonical formula choices = OxyDex (fixture-neutral).
 *
 * Load order: after metric-registry.js, before each node's *-app.js.
 *
 * Units (CLAUDE.md §📏): STORE + COMPUTE IN METRIC ALWAYS. Imperial is a thin
 * display-layer switch (kg↔lb, cm↔in, m↔ft) — metric is the default on first
 * load; conversion happens only at the input/render boundary.
 *
 * API (window.DexProfile):
 *   get()                  → flat resolved profile (metric) — what node code consumes
 *   getRecord()/load()     → raw persisted record (manual + detected + identity)
 *   save(rec?)             → persist record to localStorage `tepna_profile`
 *   migrate()              → idempotent one-time import of 6 legacy keys (never fabricates)
 *   resolve(field)         → {v, origin}  origin ∈ you|detected|pop   (the 3-tier cascade)
 *   derive(profile, ctx)   → { ...derivedValues, groundTruthChecks[], flags{} }
 *   setDetected(map)       → runtime detected context (from a loaded recording)
 *   prefillFrom(detected)  → persist best detected values (resting-HR handoff)
 *   renderPanel(opts)      → build the panel from a node's group manifest
 *   NORMS                  → the one cited population-norm table
 *   MANIFESTS              → per-node default group manifests
 * ──────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'tepna_profile';
  // SECURITY-REMEDIATION-2026-07-11 F6: the legacy per-node profile keys migrate()
  // folds into `tepna_profile`. Deleted after a confirmed unified save (below) so
  // stale identity duplicates don't linger; also mirrored into dex-forget.js's
  // erase key-set (a gate asserts LEGACY_KEYS ⊆ DexForget.LOCAL_KEYS so they can't
  // drift). removeItem is idempotent, so listing a key absent on this device is safe.
  var LEGACY_KEYS = [
    'oxydex_profile',
    'o2ring_profile',
    'ecgdex_profile',
    'ppgdex_profile',
    'pulsedex_profile',
    'glucodex_profile',
    'prof_age',
    'prof_sex',
    'prof_weight',
    'prof_height',
    'prof_sbp',
    'prof_dbp',
    'prof_vo2gt',
    'prof_hrmax',
    'prof_hrrest',
    'prof_elev'
  ];
  var SCHEMA = 1;
  var DEFAULT_AGE = 42; // neutral middle-adult anchor — a PLACEHOLDER (like BP's 120/80), shown as a
  // 'pop' default until you enter your own age; never a per-person claim.
  function _clampAge(v) {
    var n = parseInt(v, 10);
    return isFinite(n) && n >= 6 && n <= 100 ? n : null;
  }

  // Storage seam — defaults to localStorage in the browser; falls back to an
  // in-memory shim under Node CI (no localStorage) and is swappable for tests via
  // DexProfile._setStore(obj). All persistence goes through _store().
  var _memStore = (function () {
    var m = {};
    return {
      getItem: function (k) {
        return k in m ? m[k] : null;
      },
      setItem: function (k, v) {
        m[k] = String(v);
      },
      removeItem: function (k) {
        delete m[k];
      }
    };
  })();
  var _storeRef = null;
  function _store() {
    if (_storeRef) return _storeRef;
    try {
      if (global.localStorage) {
        global.localStorage.getItem(STORAGE_KEY);
        return (_storeRef = global.localStorage);
      }
    } catch (e) {}
    return (_storeRef = _memStore);
  }
  function _setStore(obj) {
    _storeRef = obj || _memStore;
    _rec = null;
    _runtimeDetected = {};
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  UNITS — metric canonical & default; imperial is a thin display layer only
  // ════════════════════════════════════════════════════════════════════════════
  var UNITS = {
    weight: { m: 'kg', i: 'lb', f: 2.20462, dp: 1 },
    height: { m: 'cm', i: 'in', f: 0.393701, dp: 1 },
    waist: { m: 'cm', i: 'in', f: 0.393701, dp: 1 },
    elevation: { m: 'm', i: 'ft', f: 3.28084, dp: 0 }
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  CITED NORMS — one citable table for the whole suite (brief §2)
  //  Wt/Ht: CDC NHANES 2017–20 (age×sex, interpolated; clamps at the 70 band).
  //  HRmax: Tanaka, Monahan & Seals 2001 (208 − 0.7×age).
  //  Resting HR: NHANES resting-pulse (Ostchega 2011) — flat ~70, no age/sex model.
  //  VO₂max: ACSM 11th ed. / FRIEND (Kaminsky 2015) — 50th pct by age×sex.
  //  BP: 2017 ACC/AHA (Whelton) — flat 120/80, age/sex-INDEPENDENT (not a mean).
  // ════════════════════════════════════════════════════════════════════════════
  var NHANES = {
    M: [
      [18, 79.8, 177.4],
      [30, 85.6, 177.2],
      [40, 89.4, 176.7],
      [50, 91.4, 175.8],
      [60, 87.9, 174.6],
      [70, 82.1, 172.3]
    ],
    F: [
      [18, 68.2, 163.5],
      [30, 73.4, 163.2],
      [40, 76.8, 162.7],
      [50, 78.3, 161.9],
      [60, 76.1, 160.5],
      [70, 71.4, 158.2]
    ]
  };
  var VO2_NORM = {
    M: [
      [25, 45],
      [35, 43],
      [45, 39],
      [55, 35],
      [65, 31]
    ],
    F: [
      [25, 36],
      [35, 33],
      [45, 29],
      [55, 26],
      [65, 22]
    ]
  };
  var NORMS = {
    weight: { source: 'CDC NHANES 2017–20', note: 'age×sex, interpolated; clamps at 70 band above 70' },
    height: { source: 'CDC NHANES 2017–20', note: 'age×sex, interpolated; clamps at 70 band above 70' },
    hrMax: { source: 'Tanaka, Monahan & Seals 2001', note: '208 − 0.7×age' },
    hrRest: { source: 'NHANES resting-pulse (Ostchega 2011)', note: 'flat ~70 bpm, no age/sex model — weakest prior' },
    vo2: { source: 'ACSM 11th ed. / FRIEND (Kaminsky 2015)', note: '50th-pct by age×sex' },
    sbp: { source: '2017 ACC/AHA (Whelton et al.)', note: 'flat 120, age/sex-independent' },
    dbp: { source: '2017 ACC/AHA (Whelton et al.)', note: 'flat 80, age/sex-independent' }
  };

  function _interp2(tbl, age) {
    if (age <= tbl[0][0]) return [tbl[0][1], tbl[0][2]];
    if (age >= tbl[tbl.length - 1][0]) return [tbl[tbl.length - 1][1], tbl[tbl.length - 1][2]]; // NHANES ceiling clamp
    for (var i = 0; i < tbl.length - 1; i++) {
      if (age >= tbl[i][0] && age < tbl[i + 1][0]) {
        var f = (age - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
        return [+(tbl[i][1] + f * (tbl[i + 1][1] - tbl[i][1])).toFixed(1), +(tbl[i][2] + f * (tbl[i + 1][2] - tbl[i][2])).toFixed(1)];
      }
    }
    return [tbl[0][1], tbl[0][2]];
  }
  function _interp1(tbl, age) {
    if (age <= tbl[0][0]) return tbl[0][1];
    if (age >= tbl[tbl.length - 1][0]) return tbl[tbl.length - 1][1];
    for (var i = 0; i < tbl.length - 1; i++) {
      if (age >= tbl[i][0] && age < tbl[i + 1][0]) {
        var f = (age - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
        return Math.round(tbl[i][1] + f * (tbl[i + 1][1] - tbl[i][1]));
      }
    }
    return tbl[0][1];
  }
  function vo2Norm(age, sex) {
    return _interp1(VO2_NORM[sex === 'F' ? 'F' : 'M'], age);
  }

  // Population defaults keyed on the record's age + sex (cascade tier 1 — the floor)
  function popDefaults(rec) {
    var age = rec.age || 42,
      sex = rec.sex === 'F' ? 'F' : 'M';
    var wh = _interp2(NHANES[sex], age);
    return {
      weight: wh[0],
      height: wh[1],
      hrRest: 70, // flat NHANES adult mean (weak prior)
      hrMax: Math.round(208 - 0.7 * age), // Tanaka
      sbp: 120,
      dbp: 80, // ACC/AHA guideline-normal (type-only override)
      vo2: vo2Norm(age, sex),
      elevation: 0,
      activity: 'light',
      betablk: 'no',
      afib: 'no',
      cpap: 'no'
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RECORD — one identity record in localStorage `tepna_profile`
  //  Shape: { schema, units, age, sex, manual:{metric fields}, detected:{} }
  //  manual = explicit user entries (cascade tier 3). detected = persisted handoff.
  // ════════════════════════════════════════════════════════════════════════════
  function _blank() {
    return { schema: SCHEMA, units: 'metric', age: DEFAULT_AGE, ageSet: false, sex: 'M', sexSet: false, manual: {}, detected: {}, _pristine: true };
  }
  var _rec = null; // live record (lazy)
  var _runtimeDetected = {}; // per-render detected context (NOT persisted; from a loaded recording)

  function load() {
    if (_rec) return _rec;
    var r = null;
    try {
      r = JSON.parse(_store().getItem(STORAGE_KEY) || 'null');
    } catch (e) {}
    if (!r) {
      migrate();
      try {
        r = JSON.parse(_store().getItem(STORAGE_KEY) || 'null');
      } catch (e) {}
    }
    _rec = r || _blank();
    if (!_rec.manual) _rec.manual = {};
    // Age hygiene (BP-parity): age is ALWAYS a valid number for the norms, but `ageSet` distinguishes a
    // user-entered age ('you') from the DEFAULT_AGE placeholder ('pop'). A stale/implausible stored value
    // (e.g. a legacy 103) reverts to the placeholder. Backfill ageSet for pre-existing records: a valid,
    // non-default age was clearly entered by the user; exactly-default or invalid ⇒ treated as unset.
    {
      var _a = _clampAge(_rec.age),
        _chg = false;
      if (_rec.ageSet === undefined) {
        _rec.ageSet = _a != null && _a !== DEFAULT_AGE;
        _chg = true;
      }
      if (_a == null) {
        if (_rec.age !== DEFAULT_AGE) {
          _rec.age = DEFAULT_AGE;
          _chg = true;
        }
        if (_rec.ageSet) {
          _rec.ageSet = false;
          _chg = true;
        }
      } else if (_a !== _rec.age) {
        _rec.age = _a;
        _chg = true;
      }
      // Sex hygiene — the exact `ageSet` rule, applied to the field that never got it (DEEP-AUDIT §19).
      // sex is ALWAYS a valid 'M'/'F' for the norms, but `sexSet` distinguishes an ENTERED sex from the
      // 'M' placeholder — without it, resolve('sex') reported origin 'you' for a user who chose nothing,
      // and every sex-dependent norm (BSA·IBW·RMR·VO₂ category) silently asserted "male" as your value.
      // Backfill exactly as age does: a non-default value was clearly entered; exactly-default ⇒ unset.
      if (_rec.sexSet === undefined) {
        _rec.sexSet = _rec.sex === 'F';
        _chg = true;
      }
      if (_chg) {
        try {
          _store().setItem(STORAGE_KEY, JSON.stringify(_rec));
        } catch (e) {}
      }
    }
    if (!_rec.detected) _rec.detected = {};
    if (_rec.sex !== 'M' && _rec.sex !== 'F') _rec.sex = String(_rec.sex).toLowerCase().charAt(0) === 'f' ? 'F' : 'M';
    return _rec;
  }
  function getRecord() {
    return load();
  }
  function isPristine() {
    return !!load()._pristine;
  }
  function save(rec) {
    if (rec) _rec = rec;
    load();
    try {
      _store().setItem(STORAGE_KEY, JSON.stringify(_rec));
    } catch (e) {}
    return _rec;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  MIGRATE — idempotent import of the 6 legacy schemas. Never fabricates: a
  //  missing legacy field stays empty (Clock-Contract spirit). Runs once; if
  //  `tepna_profile` already exists it is a no-op.
  // ════════════════════════════════════════════════════════════════════════════
  function _num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function _sex(v) {
    if (v == null) return null;
    var c = String(v).toLowerCase().charAt(0);
    return c === 'f' ? 'F' : c === 'm' ? 'M' : null;
  }
  function _yn(v) {
    if (v == null) return null;
    return v === true || v === 'yes' || v === 'true' ? 'yes' : 'no';
  }
  function _readJSON(k) {
    try {
      return JSON.parse(_store().getItem(k) || 'null');
    } catch (e) {
      return null;
    }
  }

  function migrate() {
    if (_store().getItem(STORAGE_KEY)) return false; // already unified
    var rec = _blank(),
      m = rec.manual,
      touched = false;
    function setId(v) {
      var a = _clampAge(v);
      if (a != null) {
        rec.age = a;
        rec.ageSet = true;
        touched = true;
      }
    }
    function setSx(v) {
      if (v != null) {
        rec.sex = v;
        rec.sexSet = true;
        touched = true;
      }
    }
    function put(k, v) {
      if (v != null && v !== '' && !(k in m)) {
        m[k] = v;
        touched = true;
      }
    }

    // OxyDex — oxydex_profile (JSON, canonical superset shape)
    var ox = _readJSON('oxydex_profile') || _readJSON('o2ring_profile');
    if (ox) {
      setId(_num(ox.age));
      setSx(_sex(ox.sex));
      put('weight', _num(ox.weight));
      put('height', _num(ox.height));
      put('sbp', _num(ox.sbp));
      put('dbp', _num(ox.dbp));
      if (_num(ox.vo2GT) > 0) put('vo2', _num(ox.vo2GT));
      if (_num(ox.hrmaxOverride) > 0) put('hrMax', _num(ox.hrmaxOverride));
      if (_num(ox.hrRestOverride) > 0) put('hrRest', _num(ox.hrRestOverride));
      put('elevation', _num(ox.elevation));
      put('cpap', _yn(ox.cpap));
    }
    // ECGDex / PpgDex — keyed by DOM id (ecg*/ppg*)
    [
      ['ecgdex_profile', 'ecg'],
      ['ppgdex_profile', 'ppg']
    ].forEach(function (pair) {
      var o = _readJSON(pair[0]),
        p = pair[1];
      if (!o) return;
      setId(_num(o[p + 'Age']));
      setSx(_sex(o[p + 'Sex']));
      put('weight', _num(o[p + 'Weight']));
      put('height', _num(o[p + 'Height']));
      if (_num(o[p + 'HRmax']) > 0) put('hrMax', _num(o[p + 'HRmax']));
      if (_num(o[p + 'RHR']) > 0) put('hrRest', _num(o[p + 'RHR']));
      if (_num(o[p + 'VO2']) > 0) put('vo2', _num(o[p + 'VO2']));
      put('elevation', _num(o[p + 'Elev']));
      put('cpap', _yn(o[p + 'CPAP']));
    });
    // PulseDex — pulsedex_profile (keyed by DOM id, mixed)
    var px = _readJSON('pulsedex_profile');
    if (px) {
      setId(_num(px.pxAge || px.age));
      setSx(_sex(px.pxSex || px.sex));
      put('weight', _num(px.pxWeight || px.weight));
      put('height', _num(px.pxHeight || px.height));
      if (_num(px.pxHRmax) > 0) put('hrMax', _num(px.pxHRmax));
      if (_num(px.pxRHR) > 0) put('hrRest', _num(px.pxRHR));
      if (_num(px.pxVO2) > 0) put('vo2', _num(px.pxVO2));
      put('elevation', _num(px.pxElev));
      put('cpap', _yn(px.pxCPAP));
    }
    // HRVDex — 10× per-key prof_*
    var st = _store();
    if (st.getItem('prof_age') != null || st.getItem('prof_sex') != null) {
      setId(_num(st.getItem('prof_age')));
      setSx(_sex(st.getItem('prof_sex')));
      put('weight', _num(st.getItem('prof_weight')));
      put('height', _num(st.getItem('prof_height')));
      put('sbp', _num(st.getItem('prof_sbp')));
      put('dbp', _num(st.getItem('prof_dbp')));
      if (_num(st.getItem('prof_vo2gt')) > 0) put('vo2', _num(st.getItem('prof_vo2gt')));
      if (_num(st.getItem('prof_hrmax')) > 0) put('hrMax', _num(st.getItem('prof_hrmax')));
      if (_num(st.getItem('prof_hrrest')) > 0) put('hrRest', _num(st.getItem('prof_hrrest')));
      put('elevation', _num(st.getItem('prof_elev')));
    }
    // GlucoDex — glucodex_profile (metabolic + identity)
    var gl = _readJSON('glucodex_profile');
    if (gl) {
      setId(_num(gl.gluAge));
      setSx(_sex(gl.gluSex));
      put('diabetes', gl.gluDiab && gl.gluDiab !== 'none' ? gl.gluDiab : null);
      put('dxTherapy', gl.gluTherapy && gl.gluTherapy !== 'none' ? gl.gluTherapy : null);
      put('glucoseTargetLo', _num(gl.gluTgtLo));
      put('glucoseTargetHi', _num(gl.gluTgtHi));
      if (_num(gl.gluA1c) > 0) put('a1c', _num(gl.gluA1c));
    }

    if (touched) {
      delete rec._pristine;
      // F6: persist the unified record, then delete the legacy keys we folded — but ONLY after a
      // CONFIRMED save (verify the write landed), so a failed/blocked setItem never loses data.
      var saved = false;
      try {
        _store().setItem(STORAGE_KEY, JSON.stringify(rec));
        saved = _store().getItem(STORAGE_KEY) != null;
      } catch (e) {}
      _rec = rec;
      if (saved) {
        var st2 = _store();
        LEGACY_KEYS.forEach(function (k) {
          try {
            st2.removeItem(k);
          } catch (e) {}
        });
      }
      return true;
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DETECTED — runtime context from a loaded recording (cascade tier 2)
  //  setDetected({ hrRest, vo2, _floor, _note, ... }) ; prefillFrom persists picks.
  // ════════════════════════════════════════════════════════════════════════════
  function setDetected(map) {
    _runtimeDetected = map || {};
  }
  function getDetected() {
    return _runtimeDetected;
  }
  function prefillFrom(detected) {
    load();
    detected = detected || _runtimeDetected || {};
    ['hrRest', 'vo2', 'weight', 'height'].forEach(function (k) {
      // Newest recording wins (was: write-only-if-empty → the persisted detected tier
      // stuck to the first-ever recording forever, so the cross-session "no recording
      // loaded" panel could show a stale number — PROFILE-HANDOFF-BRIEF §2).
      if (detected[k] != null) _rec.detected[k] = detected[k];
    });
    // NOTE: prefillFrom does NOT clear _pristine — a node's signal-DETECTED handoff is
    // not user-entered identity. Pristine flips only on setManual / migrate (real user data),
    // so a node keeping its own export-stable default (e.g. OxyDex age 49) is preserved.
    save();
    return _rec.detected;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RESOLVE — the 3-tier cascade: manual ?? detected ?? population-norm
  //  origin ∈ you | detected | pop
  // ════════════════════════════════════════════════════════════════════════════
  function resolve(field) {
    var rec = load();
    if (field === 'age') {
      var _ca = _clampAge(rec.age);
      return { v: _ca != null ? _ca : DEFAULT_AGE, origin: rec.ageSet ? 'you' : 'pop' };
    }
    // DEEP-AUDIT §19: was hardcoded origin 'you' — it claimed every user had told us their sex.
    if (field === 'sex') return { v: rec.sex, origin: rec.sexSet ? 'you' : 'pop' };
    if (field === 'units') return { v: rec.units || 'metric', origin: 'you' };
    if (rec.manual[field] != null && rec.manual[field] !== '') return { v: rec.manual[field], origin: 'you' };
    if (_runtimeDetected[field] != null) return { v: _runtimeDetected[field], origin: 'detected' };
    if (rec.detected[field] != null) return { v: rec.detected[field], origin: 'detected' };
    var pd = popDefaults(rec);
    if (pd[field] != null) return { v: pd[field], origin: 'pop' };
    return { v: null, origin: 'none' };
  }

  // Flat resolved profile (metric) — what node compute code consumes (≈ legacy getProfile()).
  function get() {
    var rec = load(),
      pd = popDefaults(rec);
    var p = { age: resolve('age').v, sex: rec.sex, units: rec.units || 'metric' };
    [
      'weight',
      'height',
      'bodyfat',
      'waist',
      'hrRest',
      'hrMax',
      'betablk',
      'afib',
      'sbp',
      'dbp',
      'vo2',
      'activity',
      'elevation',
      'cpap',
      'diabetes',
      'dxTherapy',
      'glucoseTargetLo',
      'glucoseTargetHi',
      'a1c'
    ].forEach(function (k) {
      p[k] = resolve(k).v;
    });
    p._origins = {};
    Object.keys(p).forEach(function (k) {
      if (k.charAt(0) !== '_') p._origins[k] = resolve(k).origin;
    });
    return p;
  }

  // Set a manual field (metric). value null/'' clears it (revert to detected/pop).
  function setManual(field, vMetric) {
    load();
    delete _rec._pristine; // any explicit set means the record now holds real identity data
    if (field === 'age') {
      var _sa = _clampAge(vMetric);
      if (_sa != null) {
        _rec.age = _sa;
        _rec.ageSet = true;
      } else {
        _rec.age = DEFAULT_AGE;
        _rec.ageSet = false;
      }
    } else if (field === 'sex') {
      var _sv = _sex(vMetric);
      if (_sv) {
        _rec.sex = _sv;
        _rec.sexSet = true;
      }
    } else if (field === 'units') {
      _rec.units = vMetric === 'imperial' ? 'imperial' : 'metric';
    } else if (vMetric == null || vMetric === '' || (typeof vMetric === 'number' && isNaN(vMetric))) delete _rec.manual[field];
    else _rec.manual[field] = vMetric;
    save();
    return _rec;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DERIVE — all derived values + groundTruthChecks[] + validity flags.
  //  Canonical formula choices = OxyDex (DuBois BSA, ACSM VO₂ cat, Mifflin/
  //  Katch RMR, Tanaka HRmax, MAP, PP, WHtR). Gates per brief §3.
  //  signalCtx (optional): { rmssd, sdnn, ... } passed by a node from its DSP.
  // ════════════════════════════════════════════════════════════════════════════
  function bmiLabel(b) {
    return b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : 'Obese';
  }
  function vo2Category(v, age, sex) {
    var n = vo2Norm(age, sex),
      r = v / n;
    return r >= 1.25 ? 'Superior' : r >= 1.1 ? 'Excellent' : r >= 0.95 ? 'Good' : r >= 0.8 ? 'Fair' : 'Poor';
  }
  function vo2Percentile(v, age, sex) {
    var n = vo2Norm(age, sex);
    return Math.max(1, Math.min(99, Math.round(50 + (v / n - 1) * 120)));
  }

  function derive(profile, signalCtx) {
    var p = profile || get();
    var age = p.age,
      sex = p.sex === 'F' ? 'F' : 'M';
    var W = +p.weight,
      H = +p.height,
      sbp = +p.sbp,
      dbp = +p.dbp;
    var bb = p.betablk === 'yes',
      af = p.afib === 'yes';
    var hM = H / 100;
    var bmi = hM > 0 ? +(W / (hM * hM)).toFixed(1) : 0;
    var bsa = +(0.007184 * Math.pow(W, 0.425) * Math.pow(H, 0.725)).toFixed(2); // DuBois (OxyDex canonical)
    var ibw = +((sex === 'M' ? 50 : 45.5) + 2.3 * Math.max(0, H / 2.54 - 60)).toFixed(1);
    var map = Math.round(dbp + (sbp - dbp) / 3);
    var pp = sbp - dbp;
    // RMR — Katch-McArdle when body-fat known, else Mifflin-St Jeor
    var rmr, rmrFormula;
    var bf = +p.bodyfat;
    if (bf > 3 && bf < 60) {
      var lean = W * (1 - bf / 100);
      rmr = Math.round(370 + 21.6 * lean);
      rmrFormula = 'Katch-McArdle 370 + 21.6·LBM (' + lean.toFixed(1) + ' kg)';
    } else {
      rmr = Math.round(10 * W + 6.25 * H - 5 * age + (sex === 'M' ? 5 : -161));
      rmrFormula = 'Mifflin-St Jeor';
    }
    // HRmax — Tanaka, gated by β-blocker
    var hrMax = +p.hrMax || Math.round(208 - 0.7 * age);
    // VO₂ — resolved value or age/sex norm
    var vo2 = +p.vo2 || vo2Norm(age, sex);
    var vo2Cat = vo2Category(vo2, age, sex);
    var vo2Pct = vo2Percentile(vo2, age, sex);
    // WHtR — when waist known (Ashwell 2005)
    var whtr = null,
      whtrRisk = null;
    var waist = +p.waist;
    if (waist > 40 && waist < 200) {
      whtr = +(waist / H).toFixed(2);
      whtrRisk = whtr >= 0.5 ? 'elevated' : 'ok';
    }

    // ── validity flags (gates) ──────────────────────────────────────────────
    var flags = {
      betaBlocker: bb,
      afib: af,
      hrMaxValid: !bb, // β-blocker blunts Tanaka
      karvonenValid: !bb,
      hrBasedVo2Valid: !bb, // HR-ratio VO₂ unreliable on β-blocker
      hrvValid: !af, // rMSSD/SDNN invalid in AF (Task Force 1996)
      cpapResidual: p.cpap === 'yes' // apnea read = residual on therapy
    };

    // ── ground-truth checks — compare a manually-entered value to the model/norm
    //    so a user-supplied "ground truth" is auditable, never silently discarded.
    var gtc = [];
    function gt(field, label, refV, refSrc) {
      var r = resolve(field);
      if (r.origin !== 'you' || refV == null) return;
      var entered = +r.v,
        delta = entered - refV,
        pct = refV ? Math.round((delta / refV) * 100) : 0;
      gtc.push({ field: field, label: label, entered: entered, reference: +(+refV).toFixed(1), refSource: refSrc, deltaPct: pct, status: Math.abs(pct) <= 15 ? 'match' : 'diverge' });
    }
    var pd = popDefaults({ age: age, sex: sex });
    gt('hrRest', 'Resting HR', _runtimeDetected.hrRest != null ? _runtimeDetected.hrRest : pd.hrRest, _runtimeDetected.hrRest != null ? 'detected' : NORMS.hrRest.source);
    gt('vo2', 'VO₂max', _runtimeDetected.vo2 != null ? _runtimeDetected.vo2 : pd.vo2, _runtimeDetected.vo2 != null ? 'detected' : NORMS.vo2.source);
    gt('hrMax', 'HRmax', Math.round(208 - 0.7 * age), NORMS.hrMax.source);
    gt('weight', 'Weight', pd.weight, NORMS.weight.source);

    // ── PROVENANCE OF THE INPUTS (DEEP-AUDIT §19) ─────────────────────────────
    // A derived value is PERSONAL only if every input it rests on was entered ('you') or detected
    // from a recording ('detected'). If ANY input is a population default, the output is a
    // population estimate wearing a personal number's clothes — a user who entered NOTHING was
    // shown BMI 28.8 "Overweight" and VO₂max 40 "Good · 50th percentile" as findings about them.
    // The origins were always in the record (resolve() has returned them since day one); derive()
    // simply dropped them on the floor. hrRest/vo2 already honored this discipline at the node
    // boundary (`origin === 'detected'`); age/sex/weight/height never did. Additive + optional, so
    // every existing caller keeps working.
    var _org = (p && p._origins) || null;
    function originOf(f) {
      if (_org && _org[f]) return _org[f];
      try {
        return resolve(f).origin;
      } catch (e) {
        return 'pop';
      }
    }
    function basisOf(fields) {
      var det = false;
      for (var i = 0; i < fields.length; i++) {
        var o = originOf(fields[i]);
        if (o === 'pop' || o === 'none') return 'pop'; // ONE guessed input taints the whole result
        if (o === 'detected') det = true;
      }
      return det ? 'detected' : 'you';
    }
    var usedBodyFat = bf > 3 && bf < 60;
    var basis = {
      bmi: basisOf(['weight', 'height']),
      bsa: basisOf(['weight', 'height']),
      ibw: basisOf(['height', 'sex']),
      map: basisOf(['sbp', 'dbp']),
      pp: basisOf(['sbp', 'dbp']),
      rmr: usedBodyFat ? basisOf(['weight', 'bodyfat']) : basisOf(['weight', 'height', 'age', 'sex']),
      hrMax: +p.hrMax ? basisOf(['hrMax']) : basisOf(['age']),
      vo2: +p.vo2 ? basisOf(['vo2']) : basisOf(['age', 'sex']),
      vo2Cat: basisOf(+p.vo2 ? ['vo2', 'age', 'sex'] : ['age', 'sex']),
      vo2Pct: basisOf(+p.vo2 ? ['vo2', 'age', 'sex'] : ['age', 'sex']),
      whtr: whtr != null ? basisOf(['waist', 'height']) : null
    };
    var origins = {},
      popFields = [];
    ['age', 'sex', 'weight', 'height', 'sbp', 'dbp', 'bodyfat', 'waist', 'hrRest', 'hrMax', 'vo2'].forEach(function (f) {
      origins[f] = originOf(f);
      if (origins[f] === 'pop') popFields.push(f);
    });
    // `personalized` asks the question the AUDIT asked: is this profile about a real person at all, or
    // is it the placeholder? It is the IDENTITY CORE that decides — age·sex·weight·height, the inputs
    // nearly every derived value rests on. Optional extras (BP, body-fat, waist) legitimately stay on
    // their norms for most users, so demanding them would make `personalized` false for everyone and
    // the flag would mean nothing. Per-value truth lives in `basis`; `popFields` lists every default.
    var IDENTITY_CORE = ['age', 'sex', 'weight', 'height'];
    var personalized = IDENTITY_CORE.every(function (f) {
      return origins[f] === 'you' || origins[f] === 'detected';
    });

    return {
      bmi: bmi,
      bmiCat: bmiLabel(bmi),
      bsa: bsa,
      ibw: ibw,
      map: map,
      pp: pp,
      rmr: rmr,
      rmrFormula: rmrFormula,
      hrMax: hrMax,
      vo2: vo2,
      vo2Cat: vo2Cat,
      vo2Pct: vo2Pct,
      whtr: whtr,
      whtrRisk: whtrRisk,
      flags: flags,
      groundTruthChecks: gtc,
      // provenance — see above. `basis[k] === 'pop'` ⇒ k is a POPULATION estimate, not your value.
      origins: origins,
      basis: basis,
      popFields: popFields,
      personalized: personalized
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PANEL — built from a node's group manifest. Reuses ans-design.css `.prof-*`
  //  / `.pd-group*`; injects only the supplement not in that sheet (origin chips,
  //  units toggle, revert button). Evidence discs via MetricRegistry.badge.
  // ════════════════════════════════════════════════════════════════════════════
  var GROUP_DEFS = {
    identity: {
      label: 'Identity',
      fields: [
        { k: 'age', label: 'Age', unit: 'years', identity: true, popLabel: 'default' },
        {
          k: 'sex',
          label: 'Sex',
          identity: true,
          select: [
            ['M', 'Male'],
            ['F', 'Female']
          ]
        }
      ]
    },
    body: {
      label: 'Body',
      fields: [
        { k: 'weight', label: 'Weight' },
        { k: 'height', label: 'Height' },
        { k: 'bodyfat', label: 'Body fat %', opt: true },
        { k: 'waist', label: 'Waist', opt: true }
      ]
    },
    cardio: {
      label: 'Cardio / autonomic',
      fields: [
        { k: 'hrRest', label: 'Resting HR (awake)', unit: 'bpm', popLabel: 'typical' },
        { k: 'hrMax', label: 'HRmax', unit: 'bpm' },
        {
          k: 'betablk',
          label: 'Beta-blocker / HR meds',
          select: [
            ['no', 'No'],
            ['yes', 'Yes']
          ],
          popLabel: 'default'
        },
        {
          k: 'afib',
          label: 'Irregular rhythm / AF',
          select: [
            ['no', 'No'],
            ['yes', 'Yes']
          ],
          popLabel: 'default'
        }
      ]
    },
    hemo: {
      label: 'Hemodynamic',
      fields: [
        { k: 'sbp', label: 'Systolic BP', unit: 'mmHg', popLabel: 'default' },
        { k: 'dbp', label: 'Diastolic BP', unit: 'mmHg', popLabel: 'default' }
      ]
    },
    fitness: {
      label: 'Fitness',
      fields: [
        { k: 'vo2', label: 'VO₂max', unit: 'mL/kg/min' },
        {
          k: 'activity',
          label: 'Activity level',
          popLabel: 'default',
          select: [
            ['sed', 'Sedentary'],
            ['light', 'Light'],
            ['mod', 'Moderate'],
            ['active', 'Active'],
            ['vig', 'Very active']
          ]
        }
      ]
    },
    env: { label: 'Environment', fields: [{ k: 'elevation', label: 'Elevation' }] },
    therapy: {
      label: 'Therapy',
      fields: [
        {
          k: 'cpap',
          label: 'CPAP / BiPAP therapy',
          select: [
            ['no', 'No'],
            ['yes', 'Yes']
          ]
        }
      ]
    },
    // Combined display group (mockup parity) — 4 fields = a filled 2×2, no empty cells.
    fitnessEnvTherapy: {
      label: 'Fitness, environment & therapy',
      fields: [
        { k: 'vo2', label: 'VO₂max', unit: 'mL/kg/min' },
        {
          k: 'activity',
          label: 'Activity level',
          popLabel: 'default',
          select: [
            ['sed', 'Sedentary'],
            ['light', 'Light'],
            ['mod', 'Moderate'],
            ['active', 'Active'],
            ['vig', 'Very active']
          ]
        },
        { k: 'elevation', label: 'Elevation' },
        {
          k: 'cpap',
          label: 'CPAP / BiPAP therapy',
          select: [
            ['no', 'No'],
            ['yes', 'Yes']
          ]
        }
      ]
    },
    metabolic: {
      label: 'Metabolic',
      fields: [
        {
          k: 'diabetes',
          label: 'Diabetes status',
          popLabel: 'default',
          select: [
            ['none', 'None'],
            ['predm', 'Pre-diabetes'],
            ['t1', 'Type 1'],
            ['t2', 'Type 2']
          ]
        },
        {
          k: 'dxTherapy',
          label: 'Therapy',
          popLabel: 'default',
          select: [
            ['none', 'None / lifestyle'],
            ['orals', 'Oral agents'],
            ['basal', 'Basal insulin'],
            ['mdi', 'MDI'],
            ['pump', 'Pump']
          ]
        },
        { k: 'glucoseTargetLo', label: 'Target low (mg/dL)' },
        { k: 'glucoseTargetHi', label: 'Target high (mg/dL)' },
        { k: 'a1c', label: 'Lab A1c (%)', opt: true, wide: true }
      ]
    }
  };

  // Per-node default manifests (brief §1)
  var MANIFESTS = {
    oxydex: ['identity', 'body', 'cardio', 'hemo', 'fitnessEnvTherapy'],
    hrvdex: ['identity', 'body', 'cardio', 'hemo', 'fitnessEnvTherapy'],
    pulsedex: ['identity', 'body', 'cardio', 'fitnessEnvTherapy'],
    ecgdex: ['identity', 'body', 'cardio', 'fitnessEnvTherapy'],
    ppgdex: ['identity', 'body', 'cardio', 'fitnessEnvTherapy'],
    glucodex: ['identity', 'body', 'metabolic'],
    integrator: ['identity']
  };

  function unitLabel(k) {
    var u = UNITS[k];
    if (!u) return '';
    return resolve('units').v === 'imperial' ? u.i : u.m;
  }
  function toDisp(k, vMetric) {
    var u = UNITS[k];
    if (!u || resolve('units').v !== 'imperial' || vMetric == null) return vMetric;
    return +(vMetric * u.f).toFixed(u.dp);
  }
  function toMetric(k, vDisp) {
    var u = UNITS[k];
    if (!u || resolve('units').v !== 'imperial' || isNaN(vDisp)) return vDisp;
    return +(vDisp / u.f).toFixed(2);
  }
  function _badge(t) {
    return global.MetricRegistry && global.MetricRegistry.badge ? global.MetricRegistry.badge(t) : '<span class="ev ev-' + t + '"></span>';
  }

  function _injectCSS() {
    if (!global.document || global.document.getElementById('dex-profile-css')) return;
    var css =
      '.dxp-grp{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text4);margin:16px 0 10px;display:flex;align-items:center;gap:8px}' +
      '.dxp-grp .src{margin-left:auto;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--text4)}' +
      '.dxp-grp .src.shared{color:var(--teal)}' +
      '.org{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:8.5px;letter-spacing:.02em;padding:1px 6px;border-radius:4px;border:1px solid var(--border);white-space:nowrap;margin-left:6px}' +
      '.org-pop{color:var(--text4);background:var(--surface3)}' +
      '.pd-group-note{font-size:9px;color:var(--text4);margin-left:8px;letter-spacing:.01em}' +
      '.org-detected{color:var(--teal);border-color:rgba(61,224,208,.32);background:rgba(61,224,208,.08)}' +
      '.org-you{color:var(--green);border-color:rgba(57,217,138,.32);background:rgba(57,217,138,.08)}' +
      '.dxp-iw{position:relative;display:flex;align-items:center}' +
      '.prof-input.auto{color:var(--text3);font-style:italic}' +
      '.dxp-revert{position:absolute;right:8px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--text4);cursor:pointer;background:none;border:0;display:none}' +
      '.dxp-revert.show{display:block}.dxp-revert:hover{color:var(--teal)}' +
      '.prof-sublabel.est{color:var(--amber)}.prof-sublabel.ok{color:var(--green)}' +
      '.units-toggle{margin-left:auto;display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}' +
      '.units-toggle .ut{background:none;border:0;color:var(--text4);font-family:inherit;font-size:10px;padding:3px 9px;cursor:pointer;font-weight:500}' +
      '.units-toggle .ut.on{background:var(--surface3);color:var(--text2)}.units-toggle .ut+.ut{border-left:1px solid var(--border)}' +
      '.dxp-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:10px;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:7px 12px;margin:4px 0 2px}' +
      '.dxp-legend .lg-t{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--text4)}' +
      '.dxp-legend .lg-i{display:inline-flex;align-items:center;gap:5px}.dxp-legend .lg-i b{color:var(--text2);font-weight:600}' +
      '.dxp-legend .lg-n{margin-left:auto;color:var(--text4);font-size:9.5px}' +
      '.dxp-wrap{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:22px;align-items:start}' +
      '@media(max-width:860px){.dxp-wrap{grid-template-columns:1fr}}' +
      '.dxp-side{display:flex;flex-direction:column;gap:14px}' +
      '.dxp-card{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:13px 15px}' +
      '.dxp-card h4{margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text4);display:flex;align-items:center;gap:8px}' +
      '.dxp-card h4 .h4n{margin-left:auto;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--text4)}' +
      '.dxp-lead{font-size:11px;color:var(--text3);line-height:1.5;margin:0 0 10px}' +
      '.dxp-casc{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px dashed var(--border)}' +
      '.dxp-casc:first-of-type{border-top:0}' +
      '.dxp-casc .n{flex:none;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:700}' +
      '.dxp-casc .n1{background:var(--surface3);color:var(--text4)}.dxp-casc .n2{background:rgba(61,224,208,.12);color:var(--teal)}.dxp-casc .n3{background:rgba(57,217,138,.12);color:var(--green)}' +
      '.dxp-casc>div{font-size:11px;color:var(--text2);line-height:1.4}.dxp-casc b{color:var(--text)}.dxp-casc span{display:block;font-size:10px;color:var(--text4);margin-top:2px}' +
      '.dxp-matrix{border-collapse:collapse;font-size:10.5px;width:100%}' +
      '.dxp-matrix th,.dxp-matrix td{border:1px solid var(--border);padding:3px 6px;text-align:right}' +
      '.dxp-matrix th:first-child,.dxp-matrix td:first-child{text-align:left;color:var(--text)}' +
      '.dxp-matrix th{background:var(--surface3);color:var(--text3);font-weight:600;font-size:9px;text-transform:uppercase}' +
      '.dxp-matrix td{color:var(--text2)}.dxp-matrix tr.hl td{background:rgba(61,224,208,.08);color:var(--text)}.dxp-matrix tr.hl td:first-child{color:var(--teal)}' +
      '.dxp-srcs{margin-top:9px;display:flex;flex-direction:column;gap:5px}' +
      '.dxp-srcs .s{font-size:10px;color:var(--text3);line-height:1.4}.dxp-srcs .s b{color:var(--text2)}.dxp-srcs .s span{display:block;font-size:9.5px;color:var(--text4)}' +
      '.prof-field.wide{grid-column:1/-1}';
    var s = global.document.createElement('style');
    s.id = 'dex-profile-css';
    s.textContent = css;
    global.document.head.appendChild(s);
  }

  function _sub(f, r) {
    var pd = popDefaults(load());
    switch (f.k) {
      case 'age':
        return r.origin === 'you' ? ['ok', '✓ your value — drives every age norm below'] : ['est', 'default ' + DEFAULT_AGE + ' · set your age — drives every age norm below'];
      case 'sex':
        return ['', '— drives BMR · IBW · VO₂ & body norms'];
      case 'weight':
        return [r.origin === 'you' ? 'ok' : 'est', r.origin === 'you' ? '✓ your value' : '~ pop avg ' + toDisp('weight', pd.weight) + ' ' + unitLabel('weight')];
      case 'height':
        return [r.origin === 'you' ? 'ok' : 'est', r.origin === 'you' ? '✓ your value' : '~ pop avg ' + toDisp('height', pd.height) + ' ' + unitLabel('height') + ' (age ' + load().age + ')'];
      case 'hrRest':
        if (r.origin === 'you') return ['ok', '✓ your value (awake)'];
        if (r.origin === 'detected') {
          var d = getDetected();
          return d._floor ? ['est', '~ sleeping floor ' + d._floor + ' + 8 = ' + r.v + ' bpm awake'] : ['est', '~ detected ' + r.v + ' bpm'];
        }
        return ['est', '~ typical ' + pd.hrRest + ' bpm · wide spread — load a recording or type yours'];
      case 'hrMax':
        return r.origin === 'you' ? ['ok', '✓ your value'] : ['est', '~ Tanaka 208 − 0.7×' + load().age + ' = ' + pd.hrMax];
      case 'sbp':
        return [r.origin === 'you' ? 'ok' : '', r.origin === 'you' ? '✓ your value' : 'default 120 · type a cuff reading'];
      case 'dbp':
        return [r.origin === 'you' ? 'ok' : '', r.origin === 'you' ? '✓ your value' : 'default 80 · age/sex-independent'];
      case 'vo2':
        if (r.origin === 'you') return ['ok', '✓ your value · ' + vo2Category(r.v, load().age, load().sex)];
        if (r.origin === 'detected') return ['est', '~ detected ' + r.v + ' (Uth–Sørensen) · ' + vo2Category(r.v, load().age, load().sex)];
        return ['est', '~ age/sex norm ' + pd.vo2 + ' · ' + vo2Category(pd.vo2, load().age, load().sex)];
      case 'elevation':
        return [
          '',
          r.v > 1500
            ? '⛰ ' + toDisp('elevation', r.v) + ' ' + unitLabel('elevation') + ' · adjusts VO₂ & SpO₂ norms'
            : '~ sea level · adjusts above ' + toDisp('elevation', 1500) + ' ' + unitLabel('elevation')
        ];
      case 'bodyfat':
        return r.origin === 'you' ? ['ok', '✓ ' + r.v + '% → Katch-McArdle (lean-mass) RMR'] : ['', 'optional · enables Katch-McArdle RMR'];
      case 'waist': {
        var h = resolve('height').v;
        return r.origin === 'you' ? ['ok', '✓ WHtR ' + (r.v / h).toFixed(2) + ' · visceral / OSA risk'] : ['', 'optional · waist÷height (visceral / OSA risk)'];
      }
      case 'betablk':
        return r.v === 'yes' ? ['est', '⚠ blunts HRmax & resting HR — HR-based VO₂ / zones flagged'] : ['', '— none · HR-based calcs valid'];
      case 'afib':
        return r.v === 'yes' ? ['est', '⚠ irregular rhythm — HRV (rMSSD / SDNN) unreliable'] : ['', '— regular rhythm · HRV metrics valid'];
      case 'activity':
        return ['', '— activity level · energy-budget input'];
      case 'cpap':
        return ['', 'reframes apnea read as residual on therapy'];
      case 'diabetes':
        return ['', r.v && r.v !== 'none' ? '— shifts which thresholds matter & how hypo reads' : '— general-population ranges'];
      case 'glucoseTargetLo':
        return ['', r.origin === 'you' ? '✓ custom lower bound' : 'consensus default 70 mg/dL'];
      case 'glucoseTargetHi':
        return ['', r.origin === 'you' ? '✓ custom upper bound' : 'consensus default 180 mg/dL'];
      case 'dxTherapy':
        return ['basal', 'mdi', 'pump'].indexOf(r.v) >= 0 ? ['est', '⚠ on insulin — hypo (TBR) goal tightens to <4%'] : ['', 'reframes hypo risk vs therapy'];
      case 'a1c':
        return r.origin === 'you' ? ['ok', '✓ lab HbA1c — anchors eAG comparison'] : ['', 'optional · last lab HbA1c'];
    }
    return ['', ''];
  }

  function renderPanel(opts) {
    opts = opts || {};
    _injectCSS();
    var node = opts.node || 'oxydex';
    var groups = opts.groups || MANIFESTS[node] || MANIFESTS.oxydex;
    var mount = typeof opts.mount === 'string' ? global.document.getElementById(opts.mount) : opts.mount;
    if (!mount) {
      mount = global.document.getElementById('pbody') || global.document.getElementById('profileBody');
    }
    if (!mount) return;
    var onChange = opts.onChange || function () {};
    var rec = load();

    var _ocTimer = null;
    function _legendHTML() {
      var tiers = [
        ['measured', 'Measured'],
        ['validated', 'Validated'],
        ['emerging', 'Emerging'],
        ['experimental', 'Experimental'],
        ['heuristic', 'Heuristic']
      ];
      return (
        '<div class="dxp-legend"><span class="lg-t">Evidence</span>' +
        tiers
          .map(function (t) {
            return '<span class="lg-i">' + _badge(t[0]) + '<b>' + t[1] + '</b></span>';
          })
          .join('') +
        '<span class="lg-n">disc fill = trust</span></div>'
      );
    }
    function _cascadeHTML() {
      return (
        '<div class="dxp-card"><h4>How each value is chosen</h4>' +
        '<div class="dxp-casc"><span class="n n1">1</span><div><b>Population norm</b> — keyed on age + sex (unified NHANES / ACSM table). <span>The floor — no field is ever blank.</span></div></div>' +
        '<div class="dxp-casc"><span class="n n2">2</span><div><b>Detected from your metrics</b> — pulled from a loaded recording. <span>Resting HR from the nocturnal floor (sleeping HR + 8), VO₂ from HRmax/HRrest. Overrides the norm when present.</span></div></div>' +
        '<div class="dxp-casc"><span class="n n3">3</span><div><b>Your manual value</b> — anything you type. <span>Always wins. Click ↺ on a field to drop back to detected / population.</span></div></div>' +
        '</div>'
      );
    }
    function _normsHTML() {
      var curAge = load().age;
      var ages = [18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
      var body = '';
      ages.forEach(function (a) {
        var m = _interp2(NHANES.M, a),
          f = _interp2(NHANES.F, a);
        var hr = Math.round(208 - 0.7 * a);
        var hl = Math.abs(a - curAge) <= 5 ? ' class="hl"' : '';
        body += '<tr' + hl + '><td>' + a + '</td><td>' + m[0] + '</td><td>' + m[1] + '</td><td>' + f[0] + '</td><td>' + f[1] + '</td><td>70</td><td>' + hr + '</td><td>120/80</td></tr>';
      });
      var src = [
        ['Weight · Height', NORMS.weight.source, NORMS.weight.note],
        ['HRmax', NORMS.hrMax.source, NORMS.hrMax.note],
        ['Resting HR', NORMS.hrRest.source, NORMS.hrRest.note],
        ['VO₂max', NORMS.vo2.source, NORMS.vo2.note],
        ['Blood pressure', NORMS.sbp.source, 'flat 120/80 — age/sex-INDEPENDENT, not a population mean']
      ];
      return (
        '<div class="dxp-card"><h4>Unified norms &amp; sources <span class="h4n">every default is cited</span></h4>' +
        '<p class="dxp-lead">One cited table replaces three drifted versions (HRVDex NHANES bands, OxyDex linear formula, ECG/PPG sex-only constants). Highlighted row ≈ your age.</p>' +
        '<table class="dxp-matrix"><thead><tr><th>Age</th><th>Wt M</th><th>Ht M</th><th>Wt F</th><th>Ht F</th><th>RHR</th><th>HRmax</th><th>BP</th></tr></thead><tbody>' +
        body +
        '</tbody></table>' +
        '<div class="dxp-srcs">' +
        src
          .map(function (s) {
            return '<div class="s"><b>' + s[0] + '</b> — ' + s[1] + '<span>' + s[2] + '</span></div>';
          })
          .join('') +
        '</div></div>'
      );
    }
    function build() {
      // Preserve the field being edited so a full rebuild doesn't drop focus / caret /
      // the in-progress value (fixes "can only type one digit then focus is lost").
      var _ae = global.document.activeElement;
      var _fk = _ae && _ae.getAttribute && mount.contains && mount.contains(_ae) ? _ae.getAttribute('data-k') : null;
      var _caret = _fk && _ae.selectionStart != null ? _ae.selectionStart : null;
      var _live = _fk ? _ae.value : null;
      var html = '<div class="dxp-wrap"><div class="dxp-main">';
      groups.forEach(function (gk) {
        var g = GROUP_DEFS[gk];
        if (!g) return;
        var right;
        if (gk === 'identity') {
          right =
            '<span class="units-toggle">' +
            [
              ['metric', 'Metric'],
              ['imperial', 'Imperial']
            ]
              .map(function (u) {
                return (
                  '<button class="ut' +
                  ((rec.units !== 'imperial' && u[0] === 'metric') || (rec.units === 'imperial' && u[0] === 'imperial') ? ' on' : '') +
                  '" data-u="' +
                  u[0] +
                  '">' +
                  u[1] +
                  '</button>'
                );
              })
              .join('') +
            '</span>';
        } else {
          right = '<span class="src shared">↔ shared identity</span>';
        }
        html += '<div class="dxp-grp">' + g.label + right + '</div><div class="prof-grid">';
        g.fields.forEach(function (f) {
          var r = resolve(f.k);
          var sub = _sub(f, r);
          var orgTxt = r.origin === 'you' ? 'your value' : r.origin === 'detected' ? 'detected' : r.origin === 'pop' ? f.popLabel || 'pop avg' : '';
          var orgCls = r.origin === 'you' ? 'org-you' : r.origin === 'detected' ? 'org-detected' : 'org-pop';
          var u = unitLabel(f.k);
          var labelTxt = f.label + (u ? ' (' + u + ')' : '') + (f.opt ? ' · optional' : '');
          html += '<div class="prof-field' + (f.wide ? ' wide' : '') + '">';
          html += '<div class="prof-label">' + labelTxt + (orgTxt && (!f.identity || f.k === 'age') ? '<span class="org ' + orgCls + '">' + orgTxt + '</span>' : '') + '</div>';
          html += '<div class="prof-sublabel ' + (sub[0] || '') + '">' + (sub[1] || '') + '</div>';
          if (f.select) {
            html += '<div class="dxp-iw"><select class="prof-input" data-k="' + f.k + '">';
            f.select.forEach(function (o) {
              html += '<option value="' + o[0] + '"' + (String(r.v) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            });
            html += '</select></div>';
          } else {
            var auto = r.origin !== 'you' && (!f.identity || f.k === 'age');
            var dispV = f.k === _fk ? _live : UNITS[f.k] ? toDisp(f.k, r.v) : r.v;
            html += '<div class="dxp-iw"><input inputmode="decimal" class="prof-input' + (auto ? ' auto' : '') + '" data-k="' + f.k + '" value="' + (dispV != null ? dispV : '') + '">';
            if (!f.identity) html += '<button class="dxp-revert' + (r.origin === 'you' ? ' show' : '') + '" data-rev="' + f.k + '" title="revert to auto">↺</button>';
            html += '</div>';
          }
          html += '</div>';
        });
        html += '</div>';
      });
      html += _derivedHTML();
      html += '</div><div class="dxp-side">' + _legendHTML() + _cascadeHTML() + _normsHTML() + '</div></div>';
      mount.innerHTML = html;
      wire();
      if (_fk) {
        var _el = mount.querySelector('[data-k="' + _fk + '"]');
        if (_el) {
          try {
            _el.focus();
            if (_caret != null && _el.setSelectionRange) _el.setSelectionRange(_caret, _caret);
          } catch (e) {}
        }
      }
      // SECURITY-REMEDIATION-2026-07-11 F5: append the shared "erase all data on this device"
      // control (dex-forget.js) below the profile fields. Idempotent + re-added after this
      // innerHTML wipe, so it rides every panel re-render across the 6 profile apps.
      try {
        if (global.DexForget) global.DexForget.ensureControl(mount);
      } catch (e) {}
    }

    function wire() {
      mount.querySelectorAll('.prof-input').forEach(function (el) {
        var k = el.getAttribute('data-k');
        var evt = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(evt, function () {
          if (k === 'age') setManual('age', el.value);
          else if (k === 'sex') setManual('sex', el.value);
          else setManual(k, UNITS[k] ? toMetric(k, parseFloat(el.value)) : el.value);
          rec = load();
          build();
          // Selects commit instantly; text inputs DEBOUNCE the heavy node re-render so
          // typing stays smooth (the panel itself already updated above).
          if (evt === 'change') {
            onChange(get());
          } else {
            clearTimeout(_ocTimer);
            _ocTimer = setTimeout(function () {
              onChange(get());
            }, 400);
          }
        });
      });
      mount.querySelectorAll('.dxp-revert').forEach(function (b) {
        b.addEventListener('click', function () {
          setManual(b.getAttribute('data-rev'), null);
          rec = load();
          build();
          onChange(get());
        });
      });
      mount.querySelectorAll('.units-toggle .ut').forEach(function (b) {
        b.addEventListener('click', function () {
          setManual('units', b.getAttribute('data-u'));
          rec = load();
          build();
          onChange(get());
        });
      });
    }

    function _derivedHTML() {
      var p = get(),
        d = derive(p);
      // Manifest-aware: only surface derived metrics the node's groups actually support,
      // so a glycemic tool doesn't show VO₂/HRmax and a no-BP node doesn't show MAP/PP.
      var hasBody = groups.indexOf('body') >= 0;
      var hasFit = groups.indexOf('fitnessEnvTherapy') >= 0 || groups.indexOf('fitness') >= 0;
      var hasCardio = groups.indexOf('cardio') >= 0;
      var hasHemo = groups.indexOf('hemo') >= 0;
      // DEEP-AUDIT §19 — a derived value whose inputs are population defaults is NOT a finding about
      // this user, and must not read like one. `k` names the derive() basis key; basis 'pop' earns the
      // same `org-pop` chip the INPUT fields have always carried, so "BMI 28.8 (Overweight)" from an
      // empty profile is legible as the population estimate it is. The evidence tier still describes
      // the FORMULA's evidence base (the ladder's meaning) — provenance is a separate channel.
      function di(l, v, f, t, k) {
        var b = k && d.basis ? d.basis[k] : null;
        var chip = b === 'pop' ? '<span class="org org-pop" title="Computed from a population default — you have not entered these values.">pop default</span>' : '';
        return '<div class="prof-derived-item">' + _badge(t) + ' <b>' + l + '</b> ' + v + chip + (f ? '<span class="pdi-formula">' + f + '</span>' : '') + '</div>';
      }
      var items = '';
      if (hasBody) {
        items += di('BMI', d.bmi + ' (' + d.bmiCat + ')', 'kg ÷ m²', 'validated', 'bmi');
        items += di('BSA', d.bsa + ' m²', 'DuBois', 'validated', 'bsa');
      }
      if (hasFit) items += di('VO₂ category', d.vo2Cat, 'ACSM age×sex', 'validated', 'vo2Cat');
      if (hasBody && d.whtr != null) items += di('WHtR', d.whtr + (d.whtrRisk === 'elevated' ? ' (↑ risk)' : ' (ok)'), 'waist ÷ height', 'validated', 'whtr');
      if (hasBody) items += di('RMR', d.rmr + ' kcal', d.rmrFormula, 'validated', 'rmr');
      if (hasFit) items += di('VO₂ percentile', '~' + d.vo2Pct + 'th', 'ACSM / FRIEND', 'validated', 'vo2Pct');
      if (hasCardio)
        items += di(
          'HRmax',
          d.hrMax + ' bpm' + (d.flags.betaBlocker ? ' ⚠' : ''),
          d.flags.betaBlocker ? 'β-blocker: Tanaka unreliable' : 'Tanaka 208−0.7·age',
          d.flags.betaBlocker ? 'experimental' : 'validated',
          'hrMax'
        );
      if (hasHemo) {
        items += di('MAP', d.map + ' mmHg', 'DBP + ⅓(SBP−DBP)', 'measured', 'map');
        items += di('Pulse pressure', d.pp + ' mmHg', d.pp < 50 ? 'optimal' : 'elevated', 'measured', 'pp');
      }
      if (!items) return '';
      var note = d.personalized ? '' : '<span class="pd-group-note">· values marked <b>pop default</b> rest on population norms, not on data you entered</span>';
      return '<div class="pd-group"><span class="pd-group-label">Derived — one engine, identical in every node</span>' + note + '<div class="pd-group-grid">' + items + '</div></div>';
    }

    build();
    return { refresh: build };
  }

  // ════════════════════════════════════════════════════════════════════════════
  global.DexProfile = {
    VERSION: '1.0.0',
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    LEGACY_KEYS: LEGACY_KEYS,
    NORMS: NORMS,
    MANIFESTS: MANIFESTS,
    GROUP_DEFS: GROUP_DEFS,
    UNITS: UNITS,
    get: get,
    getRecord: getRecord,
    load: load,
    save: save,
    migrate: migrate,
    resolve: resolve,
    setManual: setManual,
    derive: derive,
    _setStore: _setStore,
    isPristine: isPristine,
    setDetected: setDetected,
    getDetected: getDetected,
    prefillFrom: prefillFrom,
    popDefaults: popDefaults,
    vo2Norm: vo2Norm,
    vo2Category: vo2Category,
    vo2Percentile: vo2Percentile,
    renderPanel: renderPanel,
    toDisp: toDisp,
    toMetric: toMetric,
    unitLabel: unitLabel
  };

  // Run migration on load (idempotent; no-op if tepna_profile already exists).
  try {
    migrate();
  } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
