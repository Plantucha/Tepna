/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   GlucoDex · PERSONALIZATION  (glucodex-profile.js)
   ────────────────────────────────────────────────────────────────────────
   The family profile + hero system, tuned for CGM (mirrors ECGDex personalize):
     · Glycemic Stability hero (0–100 from TIR + CV + hypo burden) + subscores
       + a status/therapy-relative note
     · Projected Metabolic Age card (mean-glucose + CV + TIR composite vs age)
     · Profile panel: age · sex · diabetes status · therapy · target override ·
       lab-A1c ground truth (validates GMI — the family's device-vs-self check)
   Why a profile? Diabetes status & therapy change which thresholds matter and
   how hypo risk reads — the same TBR means different things on insulin vs none.
   Exposes window.GLUProfile. Recalibrates literature optima to wearable ranges
   so a normal trace doesn't flag red (brief §6).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEYS = ['gluAge', 'gluSex', 'gluDiab', 'gluTherapy', 'gluTgtLo', 'gluTgtHi', 'gluA1c', 'gluCalib'];
  let reRenderFn = null;
  let _dexPanel = null; // shared DexProfile.renderPanel() handle
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // ─── profile read / persistence — thin wrapper over the shared DexProfile engine ──
  // Identity + metabolic fields (age/sex/diabetes/therapy/target/A1c) live in the ONE
  // shared record (`tepna_profile`, brief §1). `gluCalib` is a node-specific sensor-
  // calibration toggle (NOT shared identity) — kept node-local in `glucodex_calib`.
  const DP = () => global.DexProfile;
  function getCalib() {
    try {
      return localStorage.getItem('glucodex_calib') === 'true';
    } catch (e) {
      return false;
    }
  }
  function getProfile() {
    const cb = $('gluCalib') ? !!$('gluCalib').checked : getCalib();
    if (DP()) {
      const p = DP().get(),
        man = DP().getRecord().manual || {};
      const num = (v, d) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : d;
      };
      // DEEP-AUDIT §19 — carry the cascade ORIGIN (see ecgdex-profile.js). diab/therapy read `manual`
      // directly, so their 'none' is a CODE default, not a user statement — mark them by presence.
      const org = (f) => {
        try {
          return DP().resolve(f).origin;
        } catch (e) {
          return 'pop';
        }
      };
      return {
        age: clamp(num(p.age, 45), 6, 95),
        sex: p.sex === 'F' ? 'F' : 'M',
        diab: man.diabetes || 'none',
        therapy: man.dxTherapy || 'none',
        tgtLo: num(man.glucoseTargetLo, 70),
        tgtHi: num(man.glucoseTargetHi, 180),
        a1c: num(man.a1c, 0),
        calib: cb,
        _origins: {
          age: org('age'),
          sex: org('sex'),
          diabetes: man.diabetes ? 'you' : 'pop',
          dxTherapy: man.dxTherapy ? 'you' : 'pop',
          glucoseTargetLo: man.glucoseTargetLo != null ? 'you' : 'pop',
          glucoseTargetHi: man.glucoseTargetHi != null ? 'you' : 'pop'
        }
      };
    }
    const v = (id, d) => {
      const e = $(id);
      const n = e ? parseFloat(e.value) : NaN;
      return isFinite(n) ? n : d;
    };
    const sel = (id) => {
      const e = $(id);
      return e ? e.value : null;
    };
    // No shared record (legacy DOM / headless): nothing here was "entered" — claim no provenance.
    return {
      age: clamp(v('gluAge', 45), 6, 95),
      sex: sel('gluSex') || 'M',
      diab: sel('gluDiab') || 'none',
      therapy: sel('gluTherapy') || 'none',
      tgtLo: v('gluTgtLo', 70),
      tgtHi: v('gluTgtHi', 180),
      a1c: v('gluA1c', 0),
      calib: !!($('gluCalib') && $('gluCalib').checked),
      _origins: null
    };
  }
  function loadProfile() {
    if (DP()) {
      try {
        DP().migrate();
      } catch (e) {}
      const p = DP().get(),
        man = DP().getRecord().manual || {};
      const set = (id, val) => {
        const el = $(id);
        if (el != null && val != null && val !== '') el.value = val;
      };
      set('gluAge', p.age);
      const sx = $('gluSex');
      if (sx) sx.value = p.sex === 'F' ? 'F' : 'M';
      const dd = $('gluDiab');
      if (dd && man.diabetes) dd.value = man.diabetes;
      const th = $('gluTherapy');
      if (th && man.dxTherapy) th.value = man.dxTherapy;
      set('gluTgtLo', man.glucoseTargetLo);
      set('gluTgtHi', man.glucoseTargetHi);
      set('gluA1c', man.a1c);
      const cb = $('gluCalib');
      if (cb) cb.checked = getCalib();
      return;
    }
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem('glucodex_profile') || 'null');
    } catch (e) {}
    if (s)
      KEYS.forEach((k) => {
        const el = $(k);
        if (!el || s[k] == null || s[k] === '') return;
        if (el.type === 'checkbox') el.checked = s[k] === true || s[k] === 'true';
        else el.value = s[k];
      });
  }
  function saveProfile() {
    if (DP()) {
      const g = (id) => {
        const e = $(id);
        return e ? e.value : '';
      };
      const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : null;
      };
      // Identity/metabolic fields are owned by the unified panel (renderPanel→setManual);
      // only persist a legacy field here if its DOM input still exists, so the gluCalib
      // toggle's save can't clobber the shared record via removed inputs.
      if ($('gluAge')) DP().setManual('age', num(g('gluAge')));
      if ($('gluSex')) DP().setManual('sex', g('gluSex'));
      if ($('gluDiab')) DP().setManual('diabetes', g('gluDiab') === 'none' ? null : g('gluDiab'));
      if ($('gluTherapy')) DP().setManual('dxTherapy', g('gluTherapy') === 'none' ? null : g('gluTherapy'));
      if ($('gluTgtLo')) DP().setManual('glucoseTargetLo', num(g('gluTgtLo')));
      if ($('gluTgtHi')) DP().setManual('glucoseTargetHi', num(g('gluTgtHi')));
      if ($('gluA1c')) DP().setManual('a1c', num(g('gluA1c')) > 0 ? num(g('gluA1c')) : null);
      const cb = $('gluCalib');
      try {
        localStorage.setItem('glucodex_calib', cb && cb.checked ? 'true' : 'false');
      } catch (e) {}
      return;
    }
    const o = {};
    KEYS.forEach((k) => {
      const el = $(k);
      if (el) o[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try {
      localStorage.setItem('glucodex_profile', JSON.stringify(o));
    } catch (e) {}
  }

  // ─── Glycemic Stability score (TIR + CV + hypo) ────────────────────────────────
  function stabilityScore(r) {
    const tir = r.tir.tir;
    const cvScore = clamp(100 - (r.cv - 25) * 3, 0, 100); // CV 25→100 · 36→67 · 45→40
    const hypo = r.tir.tbr1 + r.tir.tbr2;
    const hypoPenalty = Math.min(28, hypo * 5);
    const base = 0.55 * tir + 0.45 * cvScore;
    return Math.round(clamp(base - hypoPenalty, 0, 100));
  }
  // Metabolic Age composite REMOVED 2026-06-21 (external-review WP-A) — a mean+CV+TIR
  // heuristic dressed as a personal age. Validated TIR/GMI/CV KPIs carry the glycemic story.
  function expectedGMI(diab) {
    return diab === 'none' ? 5.4 : diab === 'predm' ? 5.9 : 6.8;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PERSONALIZE
  // ════════════════════════════════════════════════════════════════════════
  function personalize(r) {
    const p = getProfile();
    // target override — clamp sane, default consensus 70–180
    const tgtLo = clamp(p.tgtLo || 70, 50, 110),
      tgtHi = clamp(p.tgtHi || 180, 130, 260);
    // therapy reframes hypo risk (insulin therapies carry real hypo danger)
    const onInsulin = ['basal', 'mdi', 'pump'].includes(p.therapy);
    const hypo = r.tir.tbr1 + r.tir.tbr2;
    const hypoGoal = onInsulin ? 4 : 1; // consensus TBR<4% on insulin
    // GMI vs lab A1c validation (the family self-vs-device check)
    let gmiCheck = null;
    if (p.a1c > 0) {
      const d = +(r.gmi - p.a1c).toFixed(1);
      gmiCheck = { lab: p.a1c, gmi: r.gmi, delta: d, agree: Math.abs(d) <= 0.5 };
    }
    // sensor-bias calibration vs lab A1c: compare sensor mean against the average glucose
    // the lab A1c implies (ADAG eAG = 28.7·A1c − 46.7). Robust to whether an offset is
    // already applied (r.mean is post-shift; back it out with r.biasOffset).
    let calib = null;
    if (p.a1c > 0) {
      const labEAG = 28.7 * p.a1c - 46.7;
      const sensorMean = r.mean - (r.biasOffset || 0);
      const bias = +(labEAG - sensorMean).toFixed(0); // +ve ⇒ sensor reads LOW vs lab
      calib = {
        labEAG: Math.round(labEAG),
        sensorMean: Math.round(sensorMean),
        bias,
        applied: !!r.biasOffset,
        appliedOffset: Math.round(r.biasOffset || 0),
        magnitude: Math.abs(bias) >= 15 ? 'large' : Math.abs(bias) >= 8 ? 'moderate' : 'small',
        requested: p.calib
      };
    }
    // data-quality confidence multiplier on the score (critique #3): a 14-day-old sensor
    // with low coverage / heavy compression flagging shouldn't read as confidently as a
    // clean one. Artifact TBR is already excluded from the math; this surfaces the caveat.
    const compFrac = r.activeMin > 0 ? r.compMin / (r.activeMin + r.compMin) : 0;
    const dataQualityConf = +Math.max(0.4, Math.min(1, r.pctActive / 100 - compFrac * 1.5 + 0.08)).toFixed(2);
    const dqLabel = dataQualityConf >= 0.85 ? 'high' : dataQualityConf >= 0.65 ? 'moderate' : 'low';
    Object.assign(r, {
      profile: p,
      tgtLo,
      tgtHi,
      onInsulin,
      hypoGoal,
      stabilityScore: stabilityScore(r),
      gmiCheck,
      expGMI: expectedGMI(p.diab),
      dataQualityConf,
      dqLabel,
      calib
    });
    return r;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HERO — Glycemic Stability
  // ════════════════════════════════════════════════════════════════════════
  function renderHero(r) {
    const wrap = $('heroWrap');
    if (!wrap) return;
    const score = r.stabilityScore,
      p = r.profile;
    let color, tier;
    if (score >= 80) {
      color = 'good';
      tier = 'Stable · tight, in-range control';
    } else if (score >= 65) {
      color = 'good';
      tier = 'Steady · largely in-range';
    } else if (score >= 50) {
      color = 'warn';
      tier = 'Variable · room to smooth excursions';
    } else {
      color = 'bad';
      tier = 'Unstable · high variability / hypo burden';
    }
    const css = color === 'good' ? 'var(--status-ok)' : color === 'warn' ? 'var(--status-caution)' : 'var(--status-concern)';

    // status/therapy-relative note — the personalization payoff
    const hypo = +(r.tir.tbr1 + r.tir.tbr2).toFixed(1);
    let note;
    const tirGoal = p.diab === 'none' ? 70 : 70;
    if (r.tir.tir >= tirGoal) note = `Time-in-range <b>${r.tir.tir}%</b> meets the consensus &gt;70% target`;
    else note = `Time-in-range <b>${r.tir.tir}%</b> is below the &gt;70% consensus target`;
    note += `; CV <b>${r.cv}%</b> is ${r.cv < 36 ? 'within' : 'above'} the &lt;36% stability threshold`;
    if (r.onInsulin)
      note += `. On ${{ basal: 'basal insulin', mdi: 'MDI', pump: 'a pump' }[p.therapy]} — time-below-range <b>${hypo}%</b> ${hypo <= r.hypoGoal ? `is within the &lt;${r.hypoGoal}% goal` : `<b style="color:var(--status-concern)">exceeds the &lt;${r.hypoGoal}% goal — review hypo timing with your clinician</b>`}`;
    else if (hypo > 1) note += `. Time-below-range <b>${hypo}%</b> ${hypo > 4 ? '<b style="color:var(--status-concern)">is elevated</b>' : 'is present'} — note any symptoms`;
    else note += '.';
    if (r.compMin > 0) note += ` ${r.compMin} min of nocturnal compression-low artifact was flagged &amp; held out of these figures, so they aren't inflated by positional dips.`;
    if (r.dqLabel !== 'high')
      note += ` <b>Score confidence ${r.dqLabel}</b> (×${r.dataQualityConf}) given ${r.pctActive}% coverage${r.compMin > 0 ? ' + compression flagging' : ''} — read it as indicative.`;
    if (p.diab === 'predm') note += ` Targets shown are general-population; pre-diabetes interpretation applies.`;
    if (p.diab === 'none' && p.therapy === 'none') note += ` <span style="opacity:.7">No diabetes status set — general-population ranges.</span>`;

    const subs = [
      { v: r.gmi, fmt: (v) => v.toFixed(1) + '%', label: 'GMI', cls: () => (r.gmi < 6 ? 'ok' : r.gmi < 6.5 ? 'warn' : 'bad') },
      { v: r.tir.tir, fmt: (v) => v + '%', label: 'In Range', cls: (v) => (v >= 70 ? 'ok' : v >= 50 ? 'warn' : 'bad') },
      { v: r.cv, fmt: (v) => v + '%', label: 'CV', cls: (v) => (v < 36 ? 'ok' : v < 42 ? 'warn' : 'bad') },
      { v: hypo, fmt: (v) => v + '%', label: 'Below Range', cls: (v) => (v <= r.hypoGoal ? 'ok' : v <= r.hypoGoal * 2 ? 'warn' : 'bad') }
    ];
    let subsHtml = subs
      .map(
        (s) =>
          `<div class="readiness-subscore">${typeof evBadge === 'function' ? evBadge(s.label) : ''}<div class="rs-val ${s.cls(s.v)}">${s.fmt(s.v)}</div><div class="rs-label">${s.label}</div></div>`
      )
      .join('');

    // chips
    let chips = '';
    if (r.dawn.present) chips += `<div class="readiness-zone-chip warn">↗ Dawn phenomenon · +${window.GluDisp.val(r.dawn.medianDelta)} ${window.GluDisp.label()}</div>`;
    if (r.nocturnalHypo.length) chips += `<div class="readiness-zone-chip bad">🌙 ${r.nocturnalHypo.length} nocturnal hypo${r.nocturnalHypo.length > 1 ? 's' : ''}</div>`;
    chips += `<div class="readiness-zone-chip ${r.pctActive >= 70 ? 'ok' : r.pctActive >= 50 ? 'warn' : 'bad'}">${r.pctActive}% sensor active</div>`;
    chips += `<div class="readiness-zone-chip ${r.dqLabel === 'high' ? 'ok' : r.dqLabel === 'moderate' ? 'warn' : 'bad'}" title="score confidence from coverage & compression flagging">data confidence ${r.dqLabel} · ×${r.dataQualityConf}</div>`;
    if (r.gmiCheck) chips += `<div class="readiness-zone-chip ${r.gmiCheck.agree ? 'ok' : 'warn'}">GMI vs lab A1c ${r.gmiCheck.delta > 0 ? '+' : ''}${r.gmiCheck.delta}%</div>`;
    if (r.calib && r.calib.applied)
      chips += `<div class="readiness-zone-chip ok" title="trace shifted to match lab-A1c-implied average glucose">🧪 calibrated ${r.calib.appliedOffset > 0 ? '+' : ''}${window.GluDisp.delta(r.calib.appliedOffset)} ${window.GluDisp.label()}</div>`;
    else if (r.calib && r.calib.magnitude !== 'small')
      chips += `<div class="readiness-zone-chip warn" title="enable calibration in your profile to apply">sensor bias ${r.calib.bias > 0 ? '+' : ''}${window.GluDisp.delta(r.calib.bias)} ${window.GluDisp.label()} vs lab</div>`;

    wrap.classList.add('show');
    wrap.innerHTML =
      `<div class="readiness-hero" style="--readiness-color:${css}">` +
      `<div class="readiness-hero-label">Glycemic Stability</div>` +
      `<div class="readiness-date-badge">${r.source === 'synthetic' ? 'synthetic' : 'recorded'} · ${r.durDays >= 1 ? r.durDays.toFixed(1) + ' days' : Math.round(r.activeMin / 60) + ' h'} · ${r.tierLabel}</div>` +
      `<div class="readiness-score" style="color:${css}">${score}</div>` +
      `<div class="readiness-tier">${tier}</div>` +
      `<div class="readiness-scores-grid">${subsHtml}</div>` +
      `<div class="readiness-note">${note}</div>` +
      (chips ? `<div class="readiness-zones">${chips}</div>` : '') +
      `</div>`;

    const srbScore = $('srbScore'),
      srbNote = $('srbNote'),
      srb = $('sidebarReadinessBadge');
    if (srbScore) {
      srbScore.textContent = score;
      srbScore.style.setProperty('--srb-color', css);
    }
    if (srbNote) srbNote.textContent = tier.split(' · ')[0];
    if (srb) srb.style.display = 'flex';
  }

  // ── predictive sublabels ───────────────────────────────────────────────────────
  function computeHints(r) {
    const set = (id, txt, est) => {
      const l = $(id);
      if (!l) return;
      l.textContent = txt;
      l.classList.toggle('est', !!est);
    };
    const p = getProfile();
    // calibration row: only meaningful with a lab A1c
    const calibRow = $('calibRow');
    if (calibRow) {
      calibRow.style.display = p.a1c > 0 ? 'block' : 'none';
      const cs = $('calibState');
      if (cs) {
        if (r && r.calib) {
          cs.textContent = r.calib.applied
            ? `· applied ${r.calib.appliedOffset > 0 ? '+' : ''}${window.GluDisp.delta(r.calib.appliedOffset)} ${window.GluDisp.label()} (sensor read ${r.calib.bias > 0 ? 'low' : 'high'})`
            : `· detected ${r.calib.bias > 0 ? '+' : ''}${window.GluDisp.delta(r.calib.bias)} ${window.GluDisp.label()} (mean ${window.GluDisp.val(r.calib.sensorMean)} vs lab-implied ${window.GluDisp.val(r.calib.labEAG)})`;
        } else cs.textContent = '';
      }
    }
    set('lbl_gluAge', '— tunes communication &amp; norms');
    set('lbl_gluDiab', 'shifts which thresholds matter & how hypo reads');
    set('lbl_gluTherapy', ['basal', 'mdi', 'pump'].includes(p.therapy) ? '⚠ on insulin — hypo (TBR) goal tightens to <4%' : 'reframes hypo risk vs insulin therapy');
    if (r) {
      set('lbl_gluTgt', 'target ' + window.GluDisp.range(r.tgtLo, r.tgtHi) + ' ' + window.GluDisp.label() + (r.tgtLo !== 70 || r.tgtHi !== 180 ? ' (override)' : ' · consensus default'));
      if (r.gmiCheck)
        set(
          'lbl_gluA1c',
          r.gmiCheck.agree
            ? '✓ GMI ' + r.gmi + '% ≈ lab ' + p.a1c + '% (Δ' + r.gmiCheck.delta + ')'
            : '⚠ GMI ' + r.gmi + '% vs lab ' + p.a1c + '% — Δ' + r.gmiCheck.delta + '% (they measure differently)',
          !r.gmiCheck.agree
        );
      else set('lbl_gluA1c', 'optional · validates the GMI proxy against your lab value');
    }
  }

  // ── orchestration ──────────────────────────────────────────────────────────────
  function render(r) {
    $('heroTop').style.display = 'grid';
    $('sec-profile').style.display = 'block';
    $('profilePanel').style.display = 'block';
    personalize(r);
    computeHints(r);
    if (_dexPanel) _dexPanel.refresh();
    renderHero(r);
  }
  function hide() {
    $('heroTop').style.display = 'none';
    $('sec-profile').style.display = 'none';
    $('profilePanel').style.display = 'none';
    const srb = $('sidebarReadinessBadge');
    if (srb) srb.style.display = 'none';
  }

  function onInput(lblId) {
    saveProfile();
    if (reRenderFn) reRenderFn();
  }
  function toggle() {
    const b = $('profileBody'),
      btn = $('profileToggleBtn');
    const open = b.style.display !== 'none';
    b.style.display = open ? 'none' : 'block';
    if (btn) btn.textContent = open ? '▼ expand' : '▲ collapse';
  }

  function init(reRender) {
    reRenderFn = reRender;
    loadProfile();
    if (DP() && DP().renderPanel) {
      _dexPanel = DP().renderPanel({
        node: 'glucodex',
        mount: 'dexProfilePanel',
        onChange: function () {
          if (reRenderFn) reRenderFn();
        }
      });
    }
  }

  global.GLUProfile = { init, render, hide, getProfile, personalize, renderHero };
  Object.assign(global, { gluProfileInput: onInput, gluProfileToggle: toggle });
})(window);
