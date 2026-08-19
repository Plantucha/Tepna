/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   ECGDex · PERSONALIZATION  (ecgdex-profile.js)
   ────────────────────────────────────────────────────────────────────────
   The same user-profile + hero system as PulseDex, tuned for ECGDex:
     · ANS Readiness hero (HRV score + subscores + age-relative note)
     · Validated HRV bench (RMSSD/SDNN/SD1/SD2/pNN50/QTc) in the secondary hero slot
     · Apnea-risk readout from the CVHR index (overnight)
     · VO₂max (Uth–Sørensen, HRV-adjusted, altitude-corrected) + body-comp
   Why a profile? HRV / resting-HR / VO₂ norms are age- & sex-dependent —
   the same rMSSD means different things at 25 vs 65. NO BP/vascular fields:
   ECG alone has no pulse wave (brief §6), so we don't pretend to estimate them.
   Exposes window.ECGProfile.  Depends on window.ECGDSP (median/mean/std).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEYS = ['ecgAge', 'ecgSex', 'ecgWeight', 'ecgHeight', 'ecgHRmax', 'ecgRHR', 'ecgVO2', 'ecgElev', 'ecgCPAP'];
  let reRenderFn = null;
  let _dexPanel = null; // handle to the shared DexProfile.renderPanel() instance

  // ─── stats ────────────────────────────────────────────────────────────────────
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };

  // ─── profile read / persistence — thin wrapper over the shared DexProfile engine ──
  // Storage, identity and the shared formulas live in dex-profile.js (window.DexProfile,
  // key `tepna_profile`). ECGDex keeps its own DOM panel + node-specific rendering, but
  // the persisted source of truth is the ONE shared record. The DOM `0 = auto` override
  // fields (HRmax / RHR / VO₂) map to the record's manual layer; everything else resolves
  // through the cascade. A DOM-only fallback is retained for defence-in-depth.
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
      // else a value DETECTED from a loaded recording (cascade origin==='detected', e.g.
      // another node's resting-HR); else 0 ⇒ the node falls back to its own auto-detection.
      // Adopt ONLY origin==='detected' — never let the flat pop default become an override.
      const detOr0 = (field) => {
        const mv = num(man[field]);
        if (mv > 0) return mv;
        const r = DP().resolve(field);
        return r.origin === 'detected' && r.v > 0 ? r.v : 0;
      };
      // DEEP-AUDIT §19 — carry the CASCADE ORIGIN of every field COMPUTE uses. The values below are
      // still the population priors compute needs (age 42 / 80 kg / 178 cm are what the math runs on),
      // but the export must never present a prior as something the user told us. hrRest/vo2 already
      // honored this via detOr0; age/sex/weight/height/elevation never did. `_origins` is additive —
      // every existing reader of this object is unaffected.
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
        cpap: p.cpap === 'yes',
        _origins: { age: org('age'), sex: org('sex'), weight: org('weight'), height: org('height'), elevation: org('elevation'), cpap: org('cpap') }
      };
    }
    // legacy DOM fallback (DexProfile not loaded) — and the HEADLESS path, where there is no panel and
    // no record: nothing here was ever "entered", so claim no provenance at all (_origins null ⇒ the
    // export treats every field as not-entered rather than asserting one).
    const v = (id, d) => {
      const e = $(id);
      const n = e ? parseFloat(e.value) : NaN;
      return isFinite(n) ? n : d;
    };
    const sx = $('ecgSex');
    const cp = $('ecgCPAP');
    return {
      age: clamp(v('ecgAge', 42), 12, 95),
      sex: sx ? sx.value : 'M',
      weight: clamp(v('ecgWeight', 80), 30, 250),
      height: clamp(v('ecgHeight', 178), 120, 230),
      hrmax: v('ecgHRmax', 0),
      rhr: v('ecgRHR', 0),
      vo2gt: v('ecgVO2', 0),
      elev: clamp(v('ecgElev', 0), 0, 6000),
      cpap: cp ? cp.value === 'yes' : false,
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
      set('ecgAge', p.age);
      const sx = $('ecgSex');
      if (sx) sx.value = p.sex === 'F' ? 'F' : 'M';
      set('ecgWeight', p.weight);
      set('ecgHeight', p.height);
      set('ecgHRmax', man.hrMax != null ? man.hrMax : '');
      set('ecgRHR', man.hrRest != null ? man.hrRest : '');
      set('ecgVO2', man.vo2 != null ? man.vo2 : '');
      set('ecgElev', p.elevation != null ? p.elevation : 0);
      const cp = $('ecgCPAP');
      if (cp) cp.value = p.cpap === 'yes' ? 'yes' : 'no';
      return;
    }
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('ecgdex_profile') || 'null');
    } catch (e) {}
    if (saved)
      KEYS.forEach((k) => {
        const el = $(k);
        if (!el) return;
        if (el.type === 'checkbox') {
          if (saved[k] != null) el.checked = saved[k] === true || saved[k] === 'true';
        } else if (saved[k] != null && saved[k] !== '') el.value = saved[k];
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
      DP().setManual('age', num(g('ecgAge')));
      DP().setManual('sex', g('ecgSex'));
      DP().setManual('weight', num(g('ecgWeight')));
      DP().setManual('height', num(g('ecgHeight')));
      DP().setManual('hrMax', num(g('ecgHRmax')) > 0 ? num(g('ecgHRmax')) : null);
      DP().setManual('hrRest', num(g('ecgRHR')) > 0 ? num(g('ecgRHR')) : null);
      DP().setManual('vo2', num(g('ecgVO2')) > 0 ? num(g('ecgVO2')) : null);
      DP().setManual('elevation', num(g('ecgElev')));
      DP().setManual('cpap', g('ecgCPAP'));
      return;
    }
    const o = {};
    KEYS.forEach((k) => {
      const el = $(k);
      if (!el) return;
      o[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try {
      localStorage.setItem('ecgdex_profile', JSON.stringify(o));
    } catch (e) {}
  }

  // population means + altitude VO₂ factor
  function popNorms(sex) {
    return sex === 'F' ? { h: 163, w: 71 } : { h: 177, w: 86 };
  }
  function altVO2Factor(elev) {
    return elev <= 1500 ? 1 : +(1 - (0.0033 * (elev - 1500)) / 100).toFixed(3);
  }
  function vo2Base(rhr, hrmax) {
    return (15.3 * hrmax) / rhr;
  } // Uth–Sørensen 2004
  function vo2Adj(base, lnrm) {
    const d = lnrm - 3.4;
    return base * (1 + Math.max(-0.08, Math.min(0.08, d * 0.1)));
  }

  // ANS age REMOVED 2026-06-23 (BADGE-COVERAGE-AUDIT-FOLLOWUPS R9, external-review WP-A):
  // a population age-regression dressed as a personal autonomic age — removed suite-wide (OxyDex
  // 2026-06-21, PulseDex R1) and already nulled in the node-export. The ansAge() composite + all
  // three ECGDex surfaces (KPI tile, full-metrics row, profile lbl_ecgAge annotation) are deleted.
  // Do not reinstate.
  // HRV score — Welltory-calibrated, linear in rMSSD (family-consistent)
  function hrvScore(rm) {
    return Math.round(Math.max(0, Math.min(100, 1.494 * rm - 13.37)));
  }
  // age-expected rMSSD (ms) — declines ~with age (Umetani 1998 / Nunan 2010 trend)
  function expectedRmssd(age) {
    return Math.max(12, Math.round(58 * Math.exp(-0.018 * (age - 20))));
  }
  function expectedRHR(age) {
    return Math.round(60 + Math.max(0, age - 30) * 0.12);
  }

  /* RETIRED 2026-07-31 — `apneaRisk` and `estAHI` both mapped the CVHR index onto AHI clinical
     severity (ECGDEX-CARDIOPULMONARY-COUPLING §7/§9.5, executed §10).

     Both rested on one unmeasured assumption: that `cvhrIndex` tracks apnea burden closely enough
     to carry AHI's cut-points (5/15/30) and AHI's words. §9 measured it against device-scored
     residual AHI over 39 paired nights and it does not — **r = −0.151, p = 0.36**, no correlation
     at all. `estAHI` was the starker of the two: `value` was literally `Math.round(cvhrIndex)`,
     re-labelled "/h", wrapped in an invented ±30 % range and a severity band. That is not an
     estimate of AHI; it is one number wearing another number's name and units.

     What replaced them: NOTHING, deliberately. The one thing that DID validate on this corpus is
     `cpc.hfcPct` (r = −0.408, p = 0.009 — §9.2), and a single validated correlate is still not an
     AHI estimate, so promoting it into this slot would repeat the error with better inputs. The
     honest surface is the measured quantity under its own name: `cvhrIndex` (events/h of
     cyclic variation) and `cpcHfc`, each badged for what it is. A device-scored `residualAHI` from
     CPAPDex remains the only real AHI in the bus, and the Integrator already prefers it.

     Do NOT reintroduce either without a model VALIDATED against a scored label — per CLAUDE.md §📚,
     a literature correlation is not a licence to badge, and it was never the missing ingredient
     here: this suite's own corpus refutes the link. Gate: `ECGDex retires the AHI-labelled proxies`
     in tests/dex-tests.js. */

  // ════════════════════════════════════════════════════════════════════════
  //  PERSONALIZE — derive person-specific values and attach to result r
  // ════════════════════════════════════════════════════════════════════════
  function personalize(r) {
    const p = getProfile();
    const tanaka = Math.round(208 - 0.7 * p.age);
    // resting HR: overnight = nocturnal floor (p5 of epoch HR) + 8 (awake est); short = measured
    let hrFloor = null,
      autoRHR = Math.round(r.hr);
    if (r.longRec && r.epochs && r.epochs.length >= 3) {
      const hrs = r.epochs.map((e) => e.hr).sort((a, b) => a - b);
      hrFloor = Math.round(hrs[Math.floor(hrs.length * 0.05)]);
      autoRHR = hrFloor + 8;
    }
    const rhrEff = p.rhr > 0 ? p.rhr : autoRHR;
    const hrmaxValid = p.hrmax > 0 && p.hrmax >= 140 && p.hrmax > rhrEff + 45;
    const hrmaxEff = hrmaxValid ? Math.round(p.hrmax) : tanaka;
    const altF = altVO2Factor(p.elev);
    const lnrm = Math.log(Math.max(1, r.dispRm));
    const vo2b = +(vo2Base(rhrEff, hrmaxEff) * altF).toFixed(1);
    const vo2a = +vo2Adj(vo2b, lnrm).toFixed(1);
    // ANS age removed (WP-A) — no longer computed; export keeps ansAge:null for back-compat.
    // apneaRisk + estAHI RETIRED 2026-07-31 (see the note above apneaRisk). The AMBULATORY veto
    // they carried is not lost — it lives where the underlying index is computed, and `cvhrIndex`
    // is still withheld under exercise by the same `reportable:false` path in ecgdex-dsp.js.

    Object.assign(r, {
      profile: p,
      tanaka,
      hrFloor,
      autoRHR,
      rhrEff,
      hrmaxEff,
      hrmaxRejected: p.hrmax > 0 && !hrmaxValid,
      altFactor: altF,
      vo2base: vo2b,
      vo2adj: vo2a,
      vo2gt: p.vo2gt > 0 ? p.vo2gt : null,
      hrvScore: hrvScore(r.dispRm),
      expRmssd: expectedRmssd(p.age),
      expRHR: expectedRHR(p.age)
    });
    // Cross-node handoff: publish this recording's DETECTED physiology to the shared
    // detected tier (NOT the manual identity). Lights up the cascade's middle tier in
    // the unified panel and lets other Dexes see ECG's resting-HR/VO₂ — without an
    // estimate ever masquerading as a user-entered value.
    if (DP()) {
      try {
        var _det = { vo2: vo2a, hrRest: autoRHR, _note: r.longRec ? 'ECGDex overnight · resting HR from nocturnal floor (p5 + 8)' : 'ECGDex strip · resting HR measured awake' };
        if (hrFloor != null) _det._floor = hrFloor;
        DP().setDetected(_det);
        DP().prefillFrom(_det);
        if (_dexPanel) _dexPanel.refresh();
      } catch (e) {}
    }
    return r;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  HERO — ANS Readiness (HRV) + subscores + age-relative note
  // ════════════════════════════════════════════════════════════════════════
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

    // age-relative HRV note — the personalization payoff
    const ratio = r.dispRm / r.expRmssd;
    let ageNote;
    if (ratio >= 1.15) ageNote = `rMSSD ${r.dispRm} ms is <b>above</b> the ~${r.expRmssd} ms typical for age ${p.age} — favourable parasympathetic tone.`;
    else if (ratio >= 0.85) ageNote = `rMSSD ${r.dispRm} ms is <b>about typical</b> for age ${p.age} (~${r.expRmssd} ms expected).`;
    else ageNote = `rMSSD ${r.dispRm} ms is <b>below</b> the ~${r.expRmssd} ms typical for age ${p.age} — watch recovery & load.`;
    /* The apnea clauses that stood here ("flags moderate sleep-apnea risk", "therapy isn't fully
       controlling events") were all gated on `apneaRisk.sev`, i.e. on CVHR crossing AHI's
       cut-points — the mapping §9 refuted. They are removed rather than reworded: every branch made
       a clinical claim the index does not support, and there is no threshold on `cvhrIndex` this
       corpus licenses. `cvhrIndex` still renders as itself in the subscore below. */

    const subs = [
      { v: r.dispRm, fmt: (v) => v.toFixed(0), label: 'rMSSD', cls: (v) => (v >= r.expRmssd ? 'ok' : v > r.expRmssd * 0.7 ? 'warn' : 'bad') },
      { v: r.dispSd, fmt: (v) => v.toFixed(0), label: 'SDNN', cls: (v) => (v > 50 ? 'ok' : v > 35 ? 'warn' : 'bad') },
      { v: r.rhrEff, fmt: (v) => v.toFixed(0), label: 'Rest HR', cls: (v) => (v <= r.expRHR ? 'ok' : v <= r.expRHR + 8 ? 'warn' : 'bad') },
      /* Label was 'Apnea/h' with a severity colour from `apneaRisk` — both asserted these events ARE
         apneas at AHI's thresholds. Now 'CVHR/h', the quantity actually computed, and `neutral`:
         colouring it would need a validated cut-point, which is exactly what §9 could not find. */
      r.longRec && !r.ambulatory
        ? { v: r.cvhr.index, fmt: (v) => v.toFixed(0), label: 'CVHR/h', cls: () => 'neutral' }
        : { v: r.dfa1, fmt: (v) => (v == null ? '—' : v.toFixed(2)), label: 'DFA α1', cls: (v) => (v == null ? 'neutral' : v >= 0.9 && v <= 1.2 ? 'ok' : 'warn') }
    ];
    let subsHtml = '';
    subs.forEach((s) => {
      if (s.v == null || (typeof s.v === 'number' && isNaN(s.v))) return;
      subsHtml += `<div class="readiness-subscore">${typeof evBadge === 'function' ? evBadge(s.label) : ''}<div class="rs-val ${s.cls(s.v)}">${s.fmt(s.v)}</div><div class="rs-label">${s.label}</div></div>`;
    });

    // trend chip from epoch rMSSD (within-night)
    let chips = '';
    if (r.epochs && r.epochs.length >= 6) {
      const w = r.epochs,
        t = Math.floor(w.length / 3);
      const early = median(w.slice(0, t).map((x) => x.rmssd)),
        late = median(w.slice(-t).map((x) => x.rmssd));
      if (early > 0) {
        const mom = late / early;
        const c = mom > 1.05 ? 'ok' : mom > 0.9 ? 'warn' : 'bad';
        const a = mom > 1.05 ? '↗' : mom > 0.9 ? '→' : '↘';
        chips += `<div class="readiness-zone-chip ${c}">${a} HRV ${mom > 1.05 ? 'recovering' : mom > 0.9 ? 'steady' : 'declining'} overnight</div>`;
      }
    }
    /* The "Apnea risk · <category>" chip was the most directive surface of all — it put a severity
       colour and an OSA category on the hero. Removed with `apneaRisk` (§10); the CVHR/h subscore
       carries the measured quantity instead. */
    // Signal-quality is a DATA-QUALITY indicator, not a readiness chip — pin it to the
    // hero's top-right corner instead of mixing it into the training-recommendation chips.
    const qCls = r.analyzablePct >= 90 ? 'ok' : r.analyzablePct >= 75 ? 'warn' : 'bad';
    const qualBadge = `<div class="readiness-quality-badge ${qCls}" title="Signal quality — % of the record above the per-beat SQI threshold">📡 ${r.analyzablePct}% analyzable</div>`;

    wrap.classList.add('show');
    wrap.innerHTML =
      `<div class="readiness-hero" style="--readiness-color:${css}">` +
      qualBadge +
      `<div class="readiness-hero-label">ANS Readiness</div>` +
      `<div class="readiness-date-badge">${r.source === 'synthetic' ? 'synthetic' : 'recorded'} · ${r.durMin >= 90 ? (r.durSec / 3600).toFixed(1) + ' h overnight' : r.durMin + ' min'}</div>` +
      `<div class="readiness-score" style="color:${css}">${score}</div>` +
      `<div class="readiness-tier">${tier}</div>` +
      (subsHtml ? `<div class="readiness-scores-grid">${subsHtml}</div>` : '') +
      `<div class="readiness-note">${ageNote}</div>` +
      (chips ? `<div class="readiness-zones">${chips}</div>` : '') +
      `</div>`;

    // sidebar mirror
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

  // ── Projected ANS Age card REMOVED 2026-06-21 (external-review WP-A): a population
  //    age regression. VO₂ (research depth) + apnea-risk screen remain in the dashboard.

  // ── SECONDARY HERO: VALIDATED HRV BENCH (time-domain + Poincaré) ─────────────────
  //    Fills the #heroTop secondary slot (vacated by the removed ANS-age card) with
  //    the node's validated HRV bench — RMSSD/SDNN/SD1/SD2/pNN50/QTc. Reuses the
  //    .proj-card heroTop styling; no new CSS needed beyond the shared vocabulary.
  function renderHrvBench(r) {
    const top = $('heroTop');
    if (!top || !r) return;
    let host = $('heroBenchEcg');
    if (!host) {
      host = document.createElement('div');
      host.id = 'heroBenchEcg';
      host.className = 'proj-grid';
      top.appendChild(host);
    }
    const rm = r.dispRm,
      sd = r.dispSd,
      sd1 = r.sd1,
      sd2 = r.sd2,
      pn = r.longRec ? r.dispPn : r.pnn50;
    const qtc = r.morph && r.morph.delin && r.morph.delin.valid ? r.morph.delin.qtcBazett : null;
    const exp = r.expRmssd || 30;
    const sev = rm >= exp ? 'proj-good' : rm >= exp * 0.7 ? 'proj-warn' : 'proj-bad';
    const vc = rm >= exp ? 'proj-val-good' : rm >= exp * 0.7 ? 'proj-val-warn' : 'proj-val-bad';
    const eb = (l) => (typeof evBadge === 'function' ? evBadge(l) : '');
    const f = (lbl, sub, val, unit, cls) =>
      `<div class="proj-factor"><span>${eb(lbl)}${lbl} <span style="opacity:.55">${sub}</span></span><span class="pf-val cv-${cls}">${val != null && !isNaN(val) ? val + ' ' + unit : '—'}</span></div>`;
    const st = (lbl, val, unit, cls) =>
      `<div class="proj-stat ps-${cls}"><span class="ps-label">${eb(lbl)}${lbl}</span><span class="ps-val">${val != null && !isNaN(val) ? val : '—'}<span class="ps-unit">${unit}</span></span></div>`;
    host.innerHTML =
      `<div class="proj-card ${sev}">` +
      `<div class="proj-header"><span class="proj-icon">💓</span><span class="proj-title">HRV Bench · Time-Domain</span>` +
      `<span class="proj-badge proj-good">validated</span></div>` +
      `<div class="proj-main"><div class="proj-value ${vc}">${rm != null && !isNaN(rm) ? rm : '—'}</div><div class="proj-unit">ms · ${eb('rMSSD')}rMSSD (vagal tone)</div></div>` +
      `<div class="proj-waterfall">` +
      f('SDNN', 'norm 50–100 ms', sd, 'ms', sd > 50 ? 'good' : sd > 35 ? 'warn' : 'bad') +
      f('SD1', 'Poincaré short-axis', sd1 != null ? sd1.toFixed(1) : null, 'ms', sd1 >= 20 ? 'good' : sd1 >= 10 ? 'warn' : 'bad') +
      f('SD2', 'Poincaré long-axis', sd2 != null ? sd2.toFixed(1) : null, 'ms', sd2 >= 40 ? 'good' : sd2 >= 25 ? 'warn' : 'bad') +
      `</div>` +
      `<div class="proj-extra">` +
      st('pNN50', pn, '%', pn >= 15 ? 'good' : pn >= 3 ? 'warn' : 'bad') +
      st('QTc', qtc, 'ms', qtc == null ? 'neutral' : qtc > 470 ? 'bad' : qtc > 450 ? 'warn' : 'good') +
      `</div>` +
      `<div class="proj-subline" style="margin-top:auto;opacity:.8">Validated HRV bench — RMSSD · SDNN · Poincaré SD1/SD2 · pNN50 · QTc (Task Force 1996; Bazett). The reference-grade autonomic summary.</div>` +
      `</div>`;
  }

  // ── body-composition derivations ─────────────────────────────────────────────────
  function renderProfileDerived() {
    const d = $('profileDerived');
    if (!d) return;
    const p = getProfile();
    // Body-composition formulas delegate to the shared engine (DuBois BSA, Mifflin/
    // Katch RMR, ACSM VO₂ cat) so every node computes them identically; the BSA label
    // shifts Mosteller→DuBois (panel-display only, not exported — brief §3). The
    // node-specific age-relative HRV norms stay local.
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
      rmrF = 'Mifflin-St Jeor';
      bmiCat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
      hrmax = p.hrmax > 0 ? Math.round(p.hrmax) : Math.round(208 - 0.7 * p.age);
    }
    const inch = (p.height / 2.54).toFixed(0);
    const di = (l, v, f) => `<div class="prof-derived-item"><b>${l}</b> ${v}${f ? `<span class="pdi-formula">${f}</span>` : ''}</div>`;
    const grp = (l, items) => `<div class="pd-group"><span class="pd-group-label">${l}</span><div class="pd-group-grid">${items}</div></div>`;
    d.innerHTML =
      grp(
        'Body composition',
        di('BMI', bmi.toFixed(1) + ' (' + bmiCat + ')', 'kg ÷ m² = ' + p.weight + ' ÷ ' + (p.height / 100).toFixed(2) + '²') +
          di('IBW', ibw.toFixed(1) + ' kg', 'Devine: ' + (p.sex === 'M' ? '50' : '45.5') + ' + 2.3·(' + inch + 'in−60)') +
          di('BSA', bsa.toFixed(2) + ' m²', 'DuBois: 0.007184·W^0.425·H^0.725') +
          di('BMR', rmr + ' kcal', rmrF)
      ) +
      grp(
        'Age-relative norms',
        di('HRmax', hrmax + ' bpm', p.hrmax > 0 ? 'your entry' : 'Tanaka: 208−0.7·' + p.age) +
          di('Expected rMSSD', expectedRmssd(p.age) + ' ms', 'age ' + p.age + ' median (Nunan trend)') +
          di('Expected rest HR', expectedRHR(p.age) + ' bpm', 'age-typical resting HR')
      );
  }

  // ── predictive sublabels ─────────────────────────────────────────────────────────
  /* `computeHints()` REMOVED 2026-08-19 (DEAD-FIELD-HINTS-FLEET). It wrote 11 field hints to `lbl_ecg*`
     ids, and `ECGDex.src.html` defines NONE of them — nor any `lbl_` id at all. It was also unreachable
     for a second, stronger reason: it read `$('ecgHeight').value`, and `ecgHeight` does not exist
     either, so the body would have thrown a TypeError had it ever run. Its `if (DP()) return;` guard was
     therefore load-bearing against a CRASH, not merely an early exit for a superseded panel — which is
     why deleting the body is safer than leaving it guarded. The unified panel (`DexProfile`) owns these
     hints now. */

  // ── orchestration entry ──────────────────────────────────────────────────────────
  function render(r) {
    $('heroTop').style.display = 'grid';
    $('sec-profile').style.display = 'block';
    $('profilePanel').style.display = 'block';
    personalize(r);
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

  // ── handlers ─────────────────────────────────────────────────────────────────────
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
    // legacy ecgHeight/ecgWeight inputs are gone — a bare `.value=` write would throw.
    const hEl = $('ecgHeight'),
      wEl = $('ecgWeight');
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
        node: 'ecgdex',
        mount: 'dexProfilePanel',
        onChange: function () {
          if (reRenderFn) reRenderFn();
        }
      });
    } else {
      renderProfileDerived();
    }
  }

  global.ECGProfile = { init, render, hide, getProfile, personalize, renderHero, onInput, toggle, applyNorms };
  Object.assign(global, { ecgProfileInput: onInput, ecgProfileToggle: toggle, ecgApplyNorms: applyNorms });
})(window);
