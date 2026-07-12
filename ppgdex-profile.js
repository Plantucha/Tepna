/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   PpgDex · PERSONALIZATION  (ppgdex-profile.js)
   ────────────────────────────────────────────────────────────────────────
   Same ANS-readiness + ANS-age system as ECGDex, fed by PPI-derived HRV.
   PPG-specific touch: perfusion index surfaces as a readiness subscore.
   No BP/PTT fields — single-site wrist PPG cannot estimate them; that fusion
   lives in the Integrator (wrist⟷fingertip PTT). Exposes window.PPGProfile.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEYS = ['ppgAge', 'ppgSex', 'ppgWeight', 'ppgHeight', 'ppgHRmax', 'ppgRHR', 'ppgVO2', 'ppgElev', 'ppgCPAP'];
  let reRenderFn = null;
  let _dexPanel = null; // handle to the shared DexProfile.renderPanel() instance
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const bdg = (label, fb) => (global.PpgRegistry && global.PpgRegistry.badgeForLabel(label, fb !== false)) || '';

  // Thin wrapper over the shared DexProfile engine (key `tepna_profile`); see
  // ecgdex-profile.js / PROFILE-UNIFY-BRIEF §3. PpgDex keeps its own DOM panel +
  // node rendering, but storage/identity/shared formulas live in dex-profile.js.
  const DP = () => global.DexProfile;
  function getProfile() {
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    if (DP()) {
      const p = DP().get(),
        man = DP().getRecord().manual || {};
      const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
      };
      // Detected handoff into COMPUTE (PROFILE-HANDOFF-BRIEF §1): manual override wins;
      // else a value DETECTED from a loaded recording (cascade origin==='detected'); else
      // 0 ⇒ node auto. Adopt ONLY origin==='detected' — never the flat pop default.
      const detOr0 = (field) => {
        const mv = num(man[field]);
        if (mv > 0) return mv;
        const r = DP().resolve(field);
        return r.origin === 'detected' && r.v > 0 ? r.v : 0;
      };
      // DEEP-AUDIT §19 — carry the cascade ORIGIN of every field (see ecgdex-profile.js). Additive.
      const org = (f) => {
        try {
          return DP().resolve(f).origin;
        } catch (e) {
          return 'pop';
        }
      };
      return {
        age: clamp(num(p.age) || 42, 12, 95),
        sex: p.sex === 'F' ? 'F' : 'M',
        weight: clamp(num(p.weight) || 80, 30, 250),
        height: clamp(num(p.height) || 178, 120, 230),
        hrmax: num(man.hrMax) > 0 ? num(man.hrMax) : 0,
        rhr: detOr0('hrRest'),
        vo2gt: detOr0('vo2'),
        elev: clamp(num(p.elevation) || 0, 0, 6000),
        cpap: man.cpap === 'yes' ? true : man.cpap === 'no' ? false : null,
        _origins: { age: org('age'), sex: org('sex'), weight: org('weight'), height: org('height'), elevation: org('elevation'), cpap: org('cpap') }
      };
    }
    const v = (id, d) => {
      const e = $(id);
      const n = e ? parseFloat(e.value) : NaN;
      return isFinite(n) ? n : d;
    };
    const sx = $('ppgSex');
    const cpapEl = $('ppgCPAP');
    const cpapVal = cpapEl ? cpapEl.value : '';
    // No shared record (legacy DOM / headless): nothing here was "entered" — claim no provenance.
    return {
      age: clamp(v('ppgAge', 42), 12, 95),
      sex: sx ? sx.value : 'M',
      weight: clamp(v('ppgWeight', 80), 30, 250),
      height: clamp(v('ppgHeight', 178), 120, 230),
      hrmax: v('ppgHRmax', 0),
      rhr: v('ppgRHR', 0),
      vo2gt: v('ppgVO2', 0),
      elev: clamp(v('ppgElev', 0), 0, 6000),
      cpap: cpapVal === 'yes' ? true : cpapVal === 'no' ? false : null,
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
      set('ppgAge', p.age);
      const sx = $('ppgSex');
      if (sx) sx.value = p.sex === 'F' ? 'F' : 'M';
      set('ppgWeight', p.weight);
      set('ppgHeight', p.height);
      set('ppgHRmax', man.hrMax != null ? man.hrMax : '');
      set('ppgRHR', man.hrRest != null ? man.hrRest : '');
      set('ppgVO2', man.vo2 != null ? man.vo2 : '');
      set('ppgElev', p.elevation != null ? p.elevation : 0);
      const cp = $('ppgCPAP');
      if (cp && man.cpap != null) cp.value = man.cpap;
      return;
    }
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('ppgdex_profile') || 'null');
    } catch (e) {}
    if (saved)
      KEYS.forEach((k) => {
        const el = $(k);
        if (!el) return;
        if (saved[k] != null && saved[k] !== '') el.value = saved[k];
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
      DP().setManual('age', num(g('ppgAge')));
      DP().setManual('sex', g('ppgSex'));
      DP().setManual('weight', num(g('ppgWeight')));
      DP().setManual('height', num(g('ppgHeight')));
      DP().setManual('hrMax', num(g('ppgHRmax')) > 0 ? num(g('ppgHRmax')) : null);
      DP().setManual('hrRest', num(g('ppgRHR')) > 0 ? num(g('ppgRHR')) : null);
      DP().setManual('vo2', num(g('ppgVO2')) > 0 ? num(g('ppgVO2')) : null);
      DP().setManual('elevation', num(g('ppgElev')));
      DP().setManual('cpap', g('ppgCPAP'));
      return;
    }
    const o = {};
    KEYS.forEach((k) => {
      const el = $(k);
      if (el) o[k] = el.value;
    });
    try {
      localStorage.setItem('ppgdex_profile', JSON.stringify(o));
    } catch (e) {}
  }

  function popNorms(sex) {
    return sex === 'F' ? { h: 163, w: 71 } : { h: 177, w: 86 };
  }
  function altVO2Factor(elev) {
    return elev <= 1500 ? 1 : +(1 - (0.0033 * (elev - 1500)) / 100).toFixed(3);
  }
  function vo2Base(rhr, hrmax) {
    return (15.3 * hrmax) / rhr;
  }
  function vo2Adj(base, lnrm) {
    const d = lnrm - 3.4;
    return base * (1 + Math.max(-0.08, Math.min(0.08, d * 0.1)));
  }
  function ansAge(rmssd, sdnn, hr) {
    const clamp = (v) => Math.min(85, Math.max(22, Math.round(v)));
    const c1 = rmssd > 0 ? clamp(120 - 18 * Math.log(rmssd)) : null;
    const c2 = sdnn > 0 ? clamp(100 - (Math.log(sdnn) - 2.5) * 30) : null;
    const c3 = hr > 30 && hr < 120 ? clamp(20 + (hr - 45) * 1.3) : null;
    let cs = 0,
      ws = 0;
    if (c1 != null) {
      cs += 0.25 * c1;
      ws += 0.25;
    }
    if (c2 != null) {
      cs += 0.4 * c2;
      ws += 0.4;
    }
    if (c3 != null) {
      cs += 0.35 * c3;
      ws += 0.35;
    }
    return { age: ws ? clamp(cs / ws) : null, c1, c2, c3 };
  }
  function hrvScore(rm) {
    return Math.round(Math.max(0, Math.min(100, 1.494 * rm - 13.37)));
  }
  function expectedRmssd(age) {
    return Math.max(12, Math.round(58 * Math.exp(-0.018 * (age - 20))));
  }
  function expectedRHR(age) {
    return Math.round(60 + Math.max(0, age - 30) * 0.12);
  }
  function perfusionBand(pi) {
    if (pi == null) return { sev: 'neutral', txt: '—' };
    if (pi >= 4) return { sev: 'ok', txt: 'strong' };
    if (pi >= 1) return { sev: 'ok', txt: 'adequate' };
    if (pi >= 0.4) return { sev: 'warn', txt: 'low' };
    return { sev: 'bad', txt: 'poor contact' };
  }

  function personalize(r) {
    const p = getProfile();
    const tanaka = Math.round(208 - 0.7 * p.age);
    let autoRHR = Math.round(r.dispHr);
    const rhrEff = p.rhr > 0 ? p.rhr : autoRHR;
    const hrmaxValid = p.hrmax > 0 && p.hrmax >= 140 && p.hrmax > rhrEff + 45;
    const hrmaxEff = hrmaxValid ? Math.round(p.hrmax) : tanaka;
    const altF = altVO2Factor(p.elev);
    const lnrm = Math.log(Math.max(1, r.dispRm));
    const vo2b = +(vo2Base(rhrEff, hrmaxEff) * altF).toFixed(1);
    const vo2a = +vo2Adj(vo2b, lnrm).toFixed(1);
    const aa = ansAge(r.dispRm, r.dispSd, r.dispHr);
    Object.assign(r, {
      profile: p,
      tanaka,
      autoRHR,
      rhrEff,
      hrmaxEff,
      hrmaxRejected: p.hrmax > 0 && !hrmaxValid,
      altFactor: altF,
      vo2base: vo2b,
      vo2adj: vo2a,
      vo2gt: p.vo2gt > 0 ? p.vo2gt : null,
      cpapInUse: p.cpap,
      ansAge: aa,
      hrvScore: hrvScore(r.dispRm),
      expRmssd: expectedRmssd(p.age),
      expRHR: expectedRHR(p.age)
    });
    // Publish DETECTED physiology to the shared detected tier (NOT manual identity) —
    // cross-node handoff + lights up the cascade's middle tier in the unified panel.
    if (DP()) {
      try {
        var _det = { vo2: vo2a, hrRest: autoRHR, _note: 'PpgDex wrist · pulse HR (optical PPI)' };
        DP().setDetected(_det);
        DP().prefillFrom(_det);
        if (_dexPanel) _dexPanel.refresh();
      } catch (e) {}
    }
    return r;
  }

  function renderHero(r) {
    const wrap = $('heroWrap');
    if (!wrap) return;
    const score = r.hrvScore,
      p = r.profile;
    let color, tier;
    if (score >= 55) {
      color = 'good';
      tier = 'Primed · strong autonomic reserve';
    } else if (score >= 45) {
      color = 'good';
      tier = 'Ready · balanced autonomic state';
    } else if (score >= 33) {
      color = 'warn';
      tier = 'Moderate · recovery favoured';
    } else {
      color = 'bad';
      tier = 'Strained · prioritise rest';
    }
    const css = color === 'good' ? 'var(--status-ok)' : color === 'warn' ? 'var(--status-caution)' : 'var(--status-concern)';
    const ratio = r.dispRm / r.expRmssd;
    let ageNote;
    if (ratio >= 1.15) ageNote = `rMSSD ${r.dispRm} ms is <b>above</b> the ~${r.expRmssd} ms typical for age ${p.age} — favourable parasympathetic tone.`;
    else if (ratio >= 0.85) ageNote = `rMSSD ${r.dispRm} ms is <b>about typical</b> for age ${p.age} (~${r.expRmssd} ms expected).`;
    else ageNote = `rMSSD ${r.dispRm} ms is <b>below</b> the ~${r.expRmssd} ms typical for age ${p.age} — watch recovery &amp; load.`;
    ageNote += ` <span style="opacity:.75">Derived from wrist <b>PPI</b> (optical pulse intervals), not ECG RR — validated against the device's own PP-intervals.</span>`;
    const pb = perfusionBand(r.perfusionIndex);
    const subs = [
      { v: r.dispRm, fmt: (v) => v.toFixed(0), label: 'rMSSD', cls: (v) => (v >= r.expRmssd ? 'ok' : v > r.expRmssd * 0.7 ? 'warn' : 'bad') },
      { v: r.dispSd, fmt: (v) => v.toFixed(0), label: 'SDNN', cls: (v) => (v > 50 ? 'ok' : v > 35 ? 'warn' : 'bad') },
      { v: r.rhrEff, fmt: (v) => v.toFixed(0), label: 'Pulse HR', cls: (v) => (v <= r.expRHR ? 'ok' : v <= r.expRHR + 8 ? 'warn' : 'bad') },
      { v: r.perfusionIndex, fmt: (v) => (v == null ? '—' : v.toFixed(1)), label: 'Perfusion %', cls: () => pb.sev }
    ];
    let subsHtml = '';
    subs.forEach((s) => {
      if (s.v == null || (typeof s.v === 'number' && isNaN(s.v))) return;
      subsHtml += `<div class="readiness-subscore">${typeof evBadge === 'function' ? evBadge(s.label) : ''}<div class="rs-val ${s.cls(s.v)}">${s.fmt(s.v)}</div><div class="rs-label">${s.label}</div></div>`;
    });
    let chips = '';
    if (r.epochs && r.epochs.length >= 4) {
      const w = r.epochs,
        t = Math.floor(w.length / 3);
      const early = median(w.slice(0, t).map((x) => x.rmssd)),
        late = median(w.slice(-t).map((x) => x.rmssd));
      if (early > 0) {
        const mom = late / early;
        const c = mom > 1.05 ? 'ok' : mom > 0.9 ? 'warn' : 'bad';
        const a = mom > 1.05 ? '↗' : mom > 0.9 ? '→' : '↘';
        chips += `<div class="readiness-zone-chip ${c}">${a} HRV ${mom > 1.05 ? 'recovering' : mom > 0.9 ? 'steady' : 'declining'}</div>`;
      }
    }
    chips += `<div class="readiness-zone-chip ${pb.sev === 'neutral' ? 'warn' : pb.sev}">Perfusion · ${pb.txt}</div>`;
    chips += `<div class="readiness-zone-chip ${r.motionRejectedPct < 10 ? 'ok' : r.motionRejectedPct < 30 ? 'warn' : 'bad'}">${r.motionRejectedPct}% motion-rejected</div>`;
    chips += `<div class="readiness-zone-chip ${r.analyzablePct >= 90 ? 'ok' : r.analyzablePct >= 75 ? 'warn' : 'bad'}">${r.analyzablePct}% analyzable</div>`;
    if (r.cpapInUse === true) chips += `<div class="readiness-zone-chip neutral">⊕ on CPAP therapy</div>`;
    else if (r.cpapInUse === false) chips += `<div class="readiness-zone-chip neutral">no CPAP</div>`;
    wrap.classList.add('show');
    wrap.innerHTML =
      `<div class="readiness-hero" style="--readiness-color:${css}">` +
      `<div class="readiness-hero-label">ANS Readiness</div>` +
      `<div class="readiness-date-badge">wrist PPG · ${r.durMin >= 90 ? (r.durSec / 3600).toFixed(1) + ' h' : r.durMin + ' min'}</div>` +
      `<div class="readiness-score" style="color:${css}">${score}</div>` +
      `<div class="readiness-tier">${tier}</div>` +
      (subsHtml ? `<div class="readiness-scores-grid">${subsHtml}</div>` : '') +
      `<div class="readiness-note">${ageNote}</div>` +
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

  // ── SECONDARY HERO: VALIDATED HRV BENCH (PPI time-domain + Poincaré) ─────────────
  //    Fills the #heroTop secondary slot (vacated by the removed ANS-age card) with
  //    the node's validated bench — RMSSD/SDNN/SD1/SD2/pNN50 derived from optical
  //    pulse-pulse intervals. Reuses the .proj-card heroTop styling.
  function renderHrvBench(r) {
    const top = $('heroTop');
    if (!top || !r) return;
    let host = $('heroBenchPpg');
    if (!host) {
      host = document.createElement('div');
      host.id = 'heroBenchPpg';
      host.className = 'proj-grid';
      top.appendChild(host);
    }
    const rm = r.dispRm,
      sd = r.dispSd,
      sd1 = r.sd1,
      sd2 = r.sd2,
      pn = r.dispPn,
      pi = r.perfusionIndex;
    const exp = r.expRmssd || 30;
    const sev = rm >= exp ? 'proj-good' : rm >= exp * 0.7 ? 'proj-warn' : 'proj-bad';
    const vc = rm >= exp ? 'proj-val-good' : rm >= exp * 0.7 ? 'proj-val-warn' : 'proj-val-bad';
    const eb = (l) => (typeof bdg === 'function' ? bdg(l) : '');
    const f = (lbl, sub, val, unit, cls) =>
      `<div class="proj-factor"><span>${eb(lbl)}${lbl} <span style="opacity:.55">${sub}</span></span><span class="pf-val cv-${cls}">${val != null && !isNaN(val) ? val + ' ' + unit : '—'}</span></div>`;
    const st = (lbl, val, unit, cls) =>
      `<div class="proj-stat ps-${cls}"><span class="ps-label">${lbl}${eb(lbl)}</span><span class="ps-val">${val != null && !isNaN(val) ? val : '—'}<span class="ps-unit">${unit}</span></span></div>`;
    const piSev = pi == null ? 'neutral' : pi >= 4 ? 'good' : pi >= 1 ? 'warn' : 'bad';
    host.innerHTML =
      `<div class="proj-card ${sev}">` +
      `<div class="proj-header"><span class="proj-icon">🩸</span><span class="proj-title">HRV Bench · PPI Time-Domain</span>` +
      `<span class="proj-badge proj-good">validated</span></div>` +
      `<div class="proj-main"><div class="proj-value ${vc}">${rm != null && !isNaN(rm) ? rm : '—'}</div><div class="proj-unit">ms · ${eb('rMSSD')}rMSSD (vagal tone)</div></div>` +
      `<div class="proj-waterfall">` +
      f('SDNN', 'norm 50–100 ms', sd, 'ms', sd > 50 ? 'good' : sd > 35 ? 'warn' : 'bad') +
      f('SD1', 'Poincaré short-axis', sd1 != null ? sd1.toFixed(1) : null, 'ms', sd1 >= 20 ? 'good' : sd1 >= 10 ? 'warn' : 'bad') +
      f('SD2', 'Poincaré long-axis', sd2 != null ? sd2.toFixed(1) : null, 'ms', sd2 >= 40 ? 'good' : sd2 >= 25 ? 'warn' : 'bad') +
      `</div>` +
      `<div class="proj-extra">` +
      st('pNN50', pn, '%', pn >= 15 ? 'good' : pn >= 3 ? 'warn' : 'bad') +
      st('Perfusion', pi != null ? pi.toFixed(1) : null, '%', piSev === 'neutral' ? 'warn' : piSev) +
      `</div>` +
      `<div class="proj-subline" style="margin-top:auto;opacity:.8">Validated HRV bench from optical PPI — RMSSD · SDNN · Poincaré SD1/SD2 · pNN50 (Task Force 1996; Schäfer 2013). The reference-grade autonomic summary.</div>` +
      `</div>`;
  }

  function renderProfileDerived() {
    const d = $('profileDerived');
    if (!d) return;
    const p = getProfile();
    // Body-comp formulas delegate to the shared engine (DuBois BSA, Mifflin/Katch
    // RMR) so every node matches; BSA label shifts Mosteller→DuBois (display-only,
    // not exported — brief §3). Node-specific age-relative norms stay local.
    let bmi, bsa, ibw, rmr, rmrF, bmiCat, hrmax;
    if (DP()) {
      const dv = DP().derive(DP().get());
      bmi = dv.bmi;
      bsa = dv.bsa;
      ibw = dv.ibw;
      rmr = dv.rmr;
      rmrF = dv.rmrFormula;
      bmiCat = dv.bmiCat;
      hrmax = dv.hrMax;
    } else {
      bmi = +(p.weight / (p.height / 100) ** 2).toFixed(1);
      bsa = +Math.sqrt((p.height * p.weight) / 3600).toFixed(2);
      ibw = +((p.sex === 'M' ? 50 : 45.5) + 2.3 * (p.height / 2.54 - 60)).toFixed(1);
      rmr = p.sex === 'M' ? Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age + 5) : Math.round(10 * p.weight + 6.25 * p.height - 5 * p.age - 161);
      rmrF = 'Mifflin';
      bmiCat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
      hrmax = p.hrmax > 0 ? Math.round(p.hrmax) : Math.round(208 - 0.7 * p.age);
    }
    const di = (l, v, f) => `<div class="prof-derived-item"><b>${l}</b> ${v}${f ? `<span class="pdi-formula">${f}</span>` : ''}</div>`;
    const grp = (l, items) => `<div class="pd-group"><span class="pd-group-label">${l}</span><div class="pd-group-grid">${items}</div></div>`;
    d.innerHTML =
      grp(
        'Body composition',
        di('BMI', bmi.toFixed(1) + ' (' + bmiCat + ')', 'kg ÷ m²') + di('IBW', ibw.toFixed(1) + ' kg', 'Devine') + di('BSA', bsa.toFixed(2) + ' m²', 'DuBois') + di('BMR', rmr + ' kcal', rmrF)
      ) +
      grp(
        'Age-relative norms',
        di('HRmax', hrmax + ' bpm', p.hrmax > 0 ? 'your entry' : 'Tanaka 208−0.7·' + p.age) +
          di('Expected rMSSD', expectedRmssd(p.age) + ' ms', 'age ' + p.age + ' median') +
          di('Expected pulse HR', expectedRHR(p.age) + ' bpm', 'age-typical resting')
      );
  }

  function computeHints(r) {
    if (DP()) return; // unified panel owns the field hints now (legacy DOM inputs removed)
    const set = (id, txt, est) => {
      const l = $(id);
      if (!l) return;
      l.textContent = txt;
      l.classList.toggle('est', !!est);
    };
    const p = getProfile();
    const n = popNorms(p.sex);
    if (r) {
      const aa = r.ansAge || ansAge(r.dispRm, r.dispSd, r.dispHr);
      if (aa.age != null) set('lbl_ppgAge', '↑ chronological age · HRV-estimated autonomic age ≈ ' + aa.age + ' yr', true);
    }
    const ideal = +(22.5 * ((parseFloat($('ppgHeight').value) || n.h) / 100) ** 2).toFixed(1);
    set('lbl_ppgWeight', '~ pop. avg ' + n.w + ' kg · ideal ' + ideal + ' kg');
    set('lbl_ppgHeight', '~ pop. avg ' + n.h + ' cm');
    if (r) {
      const hm = r.hrmaxEff || Math.round(208 - 0.7 * p.age),
        rh = Math.round(r.rhrEff || r.dispHr);
      const altTxt = r.altFactor && r.altFactor < 1 ? ' · alt ×' + r.altFactor : '';
      set('lbl_ppgVO2', '~ Uth–Sørensen → ' + r.vo2base + ' (HRmax ' + hm + '/rest ' + rh + altTxt + ')');
      if (r.hrmaxRejected) set('lbl_ppgHRmax', '⚠ entry too low — using Tanaka ' + r.tanaka + ' bpm', true);
      else {
        const hrIn = Number($('ppgHRmax').value) || 0;
        set('lbl_ppgHRmax', hrIn > 0 ? '✓ your value ' + hm + ' bpm' : '~ Tanaka: 208 − 0.7 × age = ' + r.tanaka);
      }
      const ev = Number($('ppgElev').value) || 0;
      if (ev > 1500) set('lbl_ppgElev', '⛰ ' + ev.toLocaleString() + ' m · VO₂ ×' + r.altFactor, true);
      else set('lbl_ppgElev', '~ sea level · adjusts VO₂max above 1500 m');
      const rhrIn = Number($('ppgRHR').value) || 0;
      if (rhrIn > 0) set('lbl_ppgRHR', '✓ your value');
      else set('lbl_ppgRHR', '~ measured ' + Math.round(r.dispHr) + ' bpm', true);
    }
  }

  function render(r) {
    $('heroTop').style.display = 'grid';
    $('sec-profile').style.display = 'block';
    $('profilePanel').style.display = 'block';
    personalize(r);
    computeHints(r);
    renderHero(r);
    renderHrvBench(r);
    if (_dexPanel) _dexPanel.refresh();
    else renderProfileDerived(r);
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
    if (lblId) {
      const l = $(lblId);
      if (l) {
        l.textContent = '✓ your value';
        l.classList.remove('est');
      }
    }
    if (reRenderFn) reRenderFn();
  }
  function toggle() {
    const b = $('profileBody'),
      btn = $('profileToggleBtn');
    const open = b.style.display !== 'none';
    b.style.display = open ? 'none' : 'block';
    if (btn) btn.textContent = open ? '▼ expand' : '▲ collapse';
  }
  function applyNorms(ideal) {
    // Element-existence guard (PROFILE-DOM-READ-AUDIT §2/§5): under the unified panel the
    // legacy ppgHeight/ppgWeight inputs are gone — a bare `.value=` write would throw.
    const hEl = $('ppgHeight'),
      wEl = $('ppgWeight');
    if (!hEl || !wEl) return;
    const p = getProfile();
    const n = popNorms(p.sex);
    hEl.value = n.h;
    wEl.value = ideal ? +(22.5 * (n.h / 100) ** 2).toFixed(1) : n.w;
    saveProfile();
    if (reRenderFn) reRenderFn();
  }
  function init(reRender) {
    reRenderFn = reRender;
    loadProfile();
    if (DP() && DP().renderPanel) {
      _dexPanel = DP().renderPanel({
        node: 'ppgdex',
        mount: 'dexProfilePanel',
        onChange: function () {
          if (reRenderFn) reRenderFn();
        }
      });
    } else {
      renderProfileDerived();
    }
  }

  global.PPGProfile = { init, render, hide, getProfile, personalize, renderHero };
  Object.assign(global, { ppgProfileInput: onInput, ppgProfileToggle: toggle, ppgApplyNorms: applyNorms });
})(window);
