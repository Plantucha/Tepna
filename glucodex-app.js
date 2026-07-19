/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   GlucoDex · APP  (glucodex-app.js)
   ────────────────────────────────────────────────────────────────────────
   Glue: CGM ingest (CSV / synthetic) · pipeline orchestration · UI population ·
   the FUSION engine (ingest an ECGDex JSON → autonomic-risk vector → IR-risk
   band + autonomic⟷glycemic plot → emit Ganglior events AND write the
   producer-side correlation back for ECGDex's reserved slot) · all exports.
   Depends on window.GLUDSP, window.GLUUI, window.GLUProfile.
   ════════════════════════════════════════════════════════════════════════ */
// ESM-MIGRATION Phase 1: app is the ES-module entry. It imports the render surface (load-bearing) and
// side-effect-imports the profile module (which publishes window.GLUProfile, read below). The DSP +
// registry stay classic globals (co-loaded raw by the orchestrators + both test runners), so DSP is
// still read off window.GLUDSP here.
import { GLUDSP } from './glucodex-dsp.js';
import { GLUUI } from './glucodex-render.js';
import './glucodex-profile.js';

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DSP = GLUDSP,
    UI = GLUUI;
  let RESULT = null,
    SCOPE = null,
    ECGJSON = null,
    FUSION = null,
    LASTPARSED = null,
    NUTRITION = null;
  let CORR = { levelSessions: false, deDrift: false };
  let MEALS = [];
  try {
    MEALS = JSON.parse(localStorage.getItem('glucodex_meals') || '[]');
  } catch (e) {
    MEALS = [];
  }
  function saveMeals() {
    try {
      localStorage.setItem('glucodex_meals', JSON.stringify(MEALS));
    } catch (e) {}
  }

  // analyze with the profile's optional lab-A1c sensor-bias calibration folded in:
  // run once uncalibrated to read the true sensor mean, then (if requested) re-run with
  // the offset that aligns sensor mean to the lab-A1c-implied average glucose.
  function analyzeWithProfile(parsed, prog) {
    const baseOpts = { mealMarkers: MEALS, nutrition: NUTRITION, levelSessions: CORR.levelSessions, deDrift: CORR.deDrift };
    let r = DSP.analyze(parsed, prog, baseOpts);
    const p = window.GLUProfile ? window.GLUProfile.getProfile() : null;
    if (p && p.calib && p.a1c > 0) {
      const bias = Math.round(28.7 * p.a1c - 46.7 - r.mean);
      if (Math.abs(bias) >= 1) {
        r = DSP.analyze(parsed, null, Object.assign({}, baseOpts, { biasOffset: bias }));
      }
    }
    return r;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INGEST
  // ════════════════════════════════════════════════════════════════════════
  function loadCSV(file) {
    showChip(file.name);
    progress(6, 'Reading ' + (file.size / 1e6).toFixed(2) + ' MB…');
    const fr = new FileReader();
    fr.onload = (e) => {
      setTimeout(() => {
        var _txt = e.target.result;
        // SELF-INGEST: a GlucoDex ganglior.node-export among the input → review mode (a faithful VIEW of the
        // stored glucose summary, no recompute); a foreign export shows the redirect message.
        try {
          if (typeof glucoClearReview === 'function') glucoClearReview();
        } catch (_gc) {}
        var _j = null;
        try {
          _j = JSON.parse(_txt);
        } catch (_pe) {}
        if (_j && _j.schema && _j.schema.name === 'ganglior.node-export') {
          var _res = window.GlucoDex && typeof window.GlucoDex.loadOwnExport === 'function' ? window.GlucoDex.loadOwnExport(_j) : null;
          if (_res && _res.ok) {
            if (typeof glucoRenderReview === 'function') glucoRenderReview(_res);
            showOK('Loaded GlucoDex export \u2014 review mode (not recomputed).');
            progress(0, '');
            $('prog').classList.remove('show');
            return;
          }
          if (_res && _res.reason === 'foreign-node') {
            showErr(_res.message);
            progress(0, '');
            $('prog').classList.remove('show');
            return;
          }
          // not a GlucoDex envelope kind \u2014 fall through to the CSV path (which reports if unreadable).
        }
        let parsed;
        try {
          parsed = DSP.parseCSV(_txt);
          parsed.source = 'file';
        } catch (err) {
          showErr(err.message || String(err));
          progress(0, '');
          $('prog').classList.remove('show');
          return;
        }
        runPipeline(parsed);
      }, 20);
    };
    fr.readAsText(file);
  }
  // Synthetic CGM via the SHARED patient engine (dex-patient-gen.js → SYNTH.renderGlucoAll),
  // so a GlucoDex synthetic patient is the SAME person OxyDex/HRVDex/etc. generate and fuses
  // in the Integrator. 'predm' reuses the baseline-OSA patient with an elevated fasting
  // baseline (glucBaseMmol) so the glycemic readout reads pre-diabetic.
  function genSynthetic() {
    if (!window.DexPatientGen || !window.SYNTH || typeof SYNTH.renderGlucoAll !== 'function') {
      showErr('Synthetic generator unavailable');
      return;
    }
    const sel = $('genScenario').value;
    const daysEl = $('genDays');
    const days = daysEl ? +daysEl.value : 7;
    const profile = sel === 'predm' ? 'baseline' : sel;
    const opts = sel === 'predm' ? { glucBaseMmol: 6.6 } : null;
    const r = DexPatientGen.resolve(profile, days, opts);
    if (!r) {
      showErr('Synthetic generator unavailable');
      return;
    }
    progress(4, 'Synthesizing ' + days + ' days of CGM…');
    showChip(sel === 'predm' ? 'synthetic · ' + days + '-day · pre-diabetes' : DexPatientGen.chip(r));
    setTimeout(() => {
      try {
        const csv = SYNTH.renderGlucoAll(r.tls);
        const parsed = DSP.parseCSV(csv);
        parsed.source = 'synthetic';
        runPipeline(parsed);
      } catch (err) {
        showErr(err.message || String(err));
        progress(0, '');
        $('prog').classList.remove('show');
      }
    }, 30);
  }

  function runPipeline(parsed) {
    clearAlerts();
    LASTPARSED = parsed;
    setTimeout(() => {
      let r;
      try {
        r = analyzeWithProfile(parsed, progress);
      } catch (err) {
        showErr(err.message || String(err));
        progress(0, '');
        $('prog').classList.remove('show');
        return;
      }
      RESULT = r;
      // if a fusion JSON was already loaded, recompute against this recording
      if (ECGJSON) {
        try {
          FUSION = computeFusion(r, ECGJSON);
          r.fusion = FUSION;
        } catch (e) {
          FUSION = null;
        }
      }
      r.events = r.events.concat(FUSION && FUSION.events ? FUSION.events : []);
      renderAll(r);
      document.body.classList.add('has-data');
      $('mealCard').style.display = 'block';
      $('exportBar').classList.add('show');
      showOK(
        'Analyzed ' +
          r.nReadings.toLocaleString() +
          ' readings · ' +
          (r.durDays >= 1 ? r.durDays.toFixed(1) + ' days' : Math.round(r.activeMin / 60) + ' h') +
          ' · ' +
          r.pctActive +
          '% sensor active · GMI ' +
          r.gmi +
          '%'
      );
      setTimeout(() => {
        $('prog').classList.remove('show');
        $('proc').textContent = '';
      }, 700);
    }, 20);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  SELF-INGEST review mode (SELF-INGEST-FOLLOWUPS · GlucoDex enrich-first pass)
  //  Renders GlucoDex's OWN reloaded export as a faithful clinical VIEW from the
  //  stored `glucose` summary block (mean/GMI/CV/TIR/MODD/ADRR/dawn) + events.
  //  No recompute, no re-stamp; the full-resolution per-reading trace is greyed.
  // ════════════════════════════════════════════════════════════════════════
  function _gesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function _glucoFmtGen(g) {
    if (!g) return '';
    try {
      return String(g).replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ' UTC');
    } catch (e) {
      return String(g);
    }
  }
  function _glucoInjectReviewCSS() {
    if (typeof document === 'undefined' || document.getElementById('gluco-selfingest-css')) return;
    var css =
      '' +
      '#glucoReviewCard{margin:0 0 22px}' +
      '.grv-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 18px;padding:13px 18px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}' +
      '.grv-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}' +
      '.grv-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}' +
      '.grv-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}' +
      '.grv-spacer{flex:1 1 auto}' +
      '.grv-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}' +
      '.grv-card{padding:24px 26px;border-radius:14px;background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}' +
      '.grv-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}' +
      '.grv-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}' +
      '.grv-sub{font-size:13px;color:var(--text3,#5E7187)}' +
      '.grv-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5E7187);margin:18px 0 9px}' +
      '.grv-imp{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}' +
      '.grv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}' +
      '.grv-kpi{padding:12px 14px;border-radius:10px;background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}' +
      '.grv-kpi .k-lab{font-size:11px;color:var(--text3,#5E7187);margin-bottom:5px}' +
      '.grv-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}' +
      '.grv-kpi .k-sub{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}' +
      '.grv-tl{display:flex;flex-direction:column;border:1px solid var(--border,#1f2e45);border-radius:10px;overflow:hidden}' +
      '.grv-tlrow{display:grid;grid-template-columns:84px 1fr auto;align-items:center;gap:10px;padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}' +
      '.grv-tlrow:first-child{border-top:none}' +
      '.grv-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}' +
      '.grv-tlrow .tl-conf{color:var(--text3,#5E7187);font-family:ui-monospace,monospace;font-size:11.5px;text-align:right}' +
      '.grv-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic;padding:6px 2px}' +
      '.grv-greyed{border:1px dashed var(--border,#1f2e45);border-radius:12px;padding:20px;margin-top:4px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 10px,transparent 10px 20px);color:var(--text3,#5E7187);font-size:12.5px;text-align:center}' +
      '.grv-greyed strong{display:block;color:var(--text2,#9FB0C3);font-size:13px;margin-bottom:4px}' +
      '.grv-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}' +
      '.grv-disc .dxl{font-weight:700;color:var(--text2,#9FB0C3)}' +
      '@media print{body.has-data > *:not(#glucoReviewCard){display:none !important} #glucoReviewCard .grv-print{display:none !important}}';
    var st = document.createElement('style');
    st.id = 'gluco-selfingest-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function glucoReviewTimeline(events) {
    var evs = Array.isArray(events) ? events.slice() : [];
    if (!evs.length) return '<div class="grv-none">No scored events in this export.</div>';
    evs.sort(function (a, b) {
      return (a.tMs || 0) - (b.tMs || 0);
    });
    var CAP = 40,
      shown = evs.slice(0, CAP);
    var nm = function (e) {
      return e.impulse === 'dawn_surge' ? 'Dawn surge' : e.impulse === 'nocturnal_hypo' ? 'Nocturnal hypo' : e.impulse === 'glucose_excursion' ? 'Glucose excursion' : e.impulse || 'event';
    };
    var h =
      '<div class="grv-tl">' +
      shown
        .map(function (e) {
          var when = e.t || '\u2014';
          return (
            '<div class="grv-tlrow"><span class="tl-t">' + _gesc(when) + '</span><span>' + _gesc(nm(e)) + '</span><span class="tl-conf">conf ' + (e.conf != null ? e.conf : '\u2014') + '</span></div>'
          );
        })
        .join('') +
      '</div>';
    if (evs.length > CAP) h += '<div class="grv-none">+ ' + (evs.length - CAP) + ' more events</div>';
    return h;
  }
  function glucoReviewView(review) {
    var g = review.glucose || {},
      rec = review.recording || {},
      tir = g.tir || {};
    var prov = review.provenance || {},
      bh = prov.buildHash || (review.derivedFrom && review.derivedFrom.buildHash) || null,
      gen = _glucoFmtGen(prov.generated || review.generated);
    var nv = function (v, d) {
      return v == null || Number.isNaN(v) ? d || '\u2014' : v;
    };
    var below = tir.tbr1 != null || tir.tbr2 != null ? +((tir.tbr1 || 0) + (tir.tbr2 || 0)).toFixed(1) : null;
    var above = tir.tar1 != null || tir.tar2 != null ? +((tir.tar1 || 0) + (tir.tar2 || 0)).toFixed(1) : null;
    var h =
      '<div class="grv-banner" role="status">' +
      '<span class="grv-tag"><span class="grv-dot"></span>Review mode</span>' +
      '<span>Loaded from export \u00b7 <strong>not recomputed</strong>' +
      (review.scrubbed ? ' \u00b7 <strong>scrubbed for sharing</strong>' : '') +
      '</span>' +
      '<span class="grv-meta">' +
      (bh ? 'built <code>' + _gesc(bh) + '</code>' : 'build unknown') +
      (gen ? ' on <code>' + _gesc(gen) + '</code>' : '') +
      '</span>' +
      '<span class="grv-spacer"></span>' +
      '<button class="grv-print" type="button" data-act="print">\ud83d\udda8 Save clinical PDF</button></div>';
    h += '<div class="grv-card">';
    h +=
      '<div class="grv-head"><span class="grv-title">GlucoDex \u2014 CGM review</span>' +
      '<span class="grv-sub">' +
      _gesc(g.tier || rec.source || 'recording') +
      (rec.events != null ? ' \u00b7 ' + rec.events + ' events' : '') +
      '</span></div>';
    h += '<div class="grv-sec">Impression</div>';
    h +=
      '<div class="grv-imp">Mean ' +
      nv(g.mean) +
      ' mg/dL \u00b7 GMI ' +
      nv(g.gmi) +
      '% \u00b7 TIR ' +
      nv(tir.tir) +
      '% \u00b7 CV ' +
      nv(g.cv) +
      '%. Rendered from the export\u2019s stored glycemic summary \u2014 no re-analysis of the raw trace.</div>';
    var kpis = [
      ['Mean glucose', nv(g.mean), 'mg/dL'],
      ['GMI', nv(g.gmi), '%'],
      ['Time in Range', nv(tir.tir), '% (70\u2013180)'],
      ['Time Below', nv(below), '% (<70)'],
      ['Time Above', nv(above), '% (>180)'],
      ['CV', nv(g.cv), '%'],
      ['MODD', nv(g.modd), 'mg/dL'],
      ['ADRR', nv(g.adrr), 'risk'],
      ['Dawn rise', g.dawn && g.dawn.present ? '+' + nv(g.dawn.medianDelta) : '\u2014', 'mg/dL']
    ];
    h +=
      '<div class="grv-sec">Key metrics</div><div class="grv-kpis">' +
      kpis
        .map(function (k) {
          return (
            '<div class="grv-kpi"><div class="k-lab">' +
            (typeof evBadge === 'function' ? evBadge(k[0]) : '') +
            _gesc(k[0]) +
            '</div><div class="k-val">' +
            _gesc(k[1]) +
            '</div><div class="k-sub">' +
            _gesc(k[2]) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>';
    h += '<div class="grv-sec">Event timeline</div>' + glucoReviewTimeline(review.events);
    h +=
      '<div class="grv-sec">Raw signal</div>' +
      '<div class="grv-greyed"><strong>Full-resolution CGM trace not included</strong>Per-reading glucose samples are not carried in the export \u2014 review mode shows the derived glycemic summary only. Re-run the original CGM file for the full AGP + daily-overlay charts.</div>';
    h +=
      '<div class="grv-disc">' +
      (bh ? 'Provenance \u00b7 build <code>' + _gesc(bh) + '</code>' + (gen ? ' \u00b7 generated ' + _gesc(gen) : '') : 'Provenance \u00b7 build unknown') +
      '<br><span class="dxl">Tepna \u00b7 not a medical device.</span> Computes glycemic patterns for personal self-quantification; does not diagnose, treat, or monitor any condition.' +
      '</div></div>';
    return h;
  }
  function glucoRenderReview(review) {
    if (typeof document === 'undefined' || !review) return;
    _glucoInjectReviewCSS();
    var host = document.getElementById('glucoReviewCard');
    if (!host) {
      host = document.createElement('section');
      host.id = 'glucoReviewCard';
      var anchor = document.getElementById('scopeSection');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(host, anchor);
      } else {
        var m = document.querySelector('main') || document.body;
        m.insertBefore(host, m.firstChild);
      }
    }
    host.innerHTML = glucoReviewView(review);
    host.style.display = '';
    try {
      document.body.classList.add('has-data');
    } catch (e) {}
  }
  function glucoClearReview() {
    var h = document.getElementById('glucoReviewCard');
    if (h) {
      h.innerHTML = '';
      h.style.display = 'none';
    }
  }
  // F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — the review renderer is reachable via the node
  // namespace (<Node>.reviewView / .renderReview) so the suite's live review probe (and any global
  // caller) can drive it; the bare names stay IIFE-local.
  try {
    if (typeof window !== 'undefined' && window.GlucoDex) {
      window.GlucoDex.reviewView = glucoReviewView;
      window.GlucoDex.renderReview = glucoRenderReview;
    }
  } catch (_rvx) {}

  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════
  function renderAll(r) {
    $('scopeSection').style.display = 'block';
    if (!SCOPE) {
      SCOPE = new UI.GlucoScope($('gluCanvas'), $('gluMini'));
      SCOPE.onView = updateScopeReadout;
    }
    SCOPE.light = document.body.classList.contains('light');
    SCOPE.setData(r);
    updateScopeReadout(SCOPE.view, r.cadence, r.series.N, r.series.gT);

    if (window.GLUProfile) window.GLUProfile.render(r); // personalises r + hero (before KPI/table use it)
    renderContext(r);
    renderKPI(r);
    renderQuality(r);
    renderSessions(r);
    renderAGP(r);
    renderVariability(r);
    renderPatterns(r);
    renderPPGR(r);
    renderNutrition(r);
    renderDaily(r);
    renderFusion(r);
    renderGanglior(r);
    renderTable(r);

    $('sidebarDataCard').style.display = 'block';
    $('sidebarDataInfo').innerHTML =
      (r.source === 'synthetic' ? 'Synthetic CGM' : 'CGM file') +
      '<br>' +
      r.nReadings.toLocaleString() +
      ' readings · ' +
      r.cadence +
      '-min · GMI ' +
      r.gmi +
      '%' +
      '<br>' +
      r.pctActive +
      '% sensor active';
  }

  function updateScopeReadout(view, cad, N, gT) {
    const t0 = gT[Math.max(0, Math.floor(view.start))],
      t1 = gT[Math.min(N - 1, Math.floor(view.start + view.span))];
    const spanH = (view.span * cad) / 60;
    const fmt = (ms) => {
      const d = new Date(ms);
      return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    };
    $('scopeReadout').innerHTML =
      `<span>window <b>${fmt(t0)} – ${fmt(t1)}</b></span><span>span ${spanH < 24 ? spanH.toFixed(1) + ' h' : (spanH / 24).toFixed(1) + ' d'}</span><span>${((N * cad) / 1440).toFixed(1)} d total</span>`;
  }

  const sevTIR = (v) => (v >= 70 ? 'ok' : v >= 50 ? 'warn' : 'bad');

  function renderContext(r) {
    const tierColor = { partial: 'warn', 'multi-day': 'ok', agp: 'ok' }[r.tier] || 'neutral';
    let notes = '';
    if (r.tier === 'partial')
      notes = '<div class="ctx-note">⚠ Under 24 h — mean glucose, GMI, SD, CV and basic TIR are valid; MODD, dawn-trend and AGP percentile bands need more days and are withheld or flagged.</div>';
    else if (r.tier === 'multi-day')
      notes =
        '<div class="ctx-note">Full TIR/TAR/TBR, MAGE, CONGA, GVP and dawn-phenomenon are valid at this length. AGP percentile bands shown but firm up at ≥14 days (international consensus).</div>';
    else notes = '<div class="ctx-note">≥14 days — the AGP reporting standard. Percentile envelope, MODD and a robust GMI are all on solid footing.</div>';
    let calibNote = '';
    if (r.calib) {
      if (r.calib.applied)
        calibNote = `<div class="ctx-note" style="color:var(--green)">🧪 <b>Lab-A1c calibration applied:</b> every reading shifted <b>${r.calib.appliedOffset > 0 ? '+' : ''}${window.GluDisp.delta(r.calib.appliedOffset)} ${window.GluDisp.label()}</b> so the sensor mean matches the ${window.GluDisp.val(r.calib.labEAG)} ${window.GluDisp.label()} average your ${r.profile.a1c}% lab A1c implies (ADAG eAG = 28.7·A1c − 46.7). All metrics below reflect the corrected trace.</div>`;
      else if (r.calib.magnitude !== 'small')
        calibNote = `<div class="ctx-note" style="color:var(--amber)">⚠ <b>Sensor bias detected:</b> your sensor mean (${window.GluDisp.val(r.calib.sensorMean)} ${window.GluDisp.label()}) sits <b>${window.GluDisp.spread(Math.abs(r.calib.bias))} ${window.GluDisp.label()} ${r.calib.bias > 0 ? 'below' : 'above'}</b> the ${window.GluDisp.val(r.calib.labEAG)} ${window.GluDisp.label()} your ${r.profile.a1c}% lab A1c implies — so GMI/eA1c may read ${r.calib.bias > 0 ? 'optimistically' : 'pessimistically'}. Tick <i>Calibrate trace to lab A1c</i> in your profile to correct it.</div>`;
    }
    $('ctxBanner').innerHTML = `<div class="ctx-main">
      <div><div class="ctx-mode">${r.tierLabel} recording</div>
      <div class="ctx-why">${r.durDays.toFixed(1)} days active · ${r.nReadings.toLocaleString()} readings · ${r.cadence}-min cadence · ${r.pctActive}% sensor active</div></div>
      <div class="ctx-conf ${tierColor}">${r.tierMsg}</div>
    </div>${notes}${calibNote}`;
    $('ctxBanner').style.display = 'flex';
  }

  function renderKPI(r) {
    const p = r.profile || {};
    const hypo = +(r.tir.tbr1 + r.tir.tbr2).toFixed(1);
    // Metabolic Age REMOVED 2026-06-21 (external-review WP-A)
    const personalized = [
      { l: 'Stability Score', v: r.stabilityScore, sub: 'TIR+CV+hypo · 0–100', s: r.stabilityScore >= 65 ? 'ok' : r.stabilityScore >= 50 ? 'warn' : 'bad' },
      { l: 'GMI', v: r.gmi + '%', sub: 'lab-A1c proxy', s: r.gmi < 6 ? 'ok' : r.gmi < 6.5 ? 'warn' : 'bad' },
      { l: 'Est. HbA1c', v: r.ea1c + '%', sub: 'ADAG · differs from GMI', s: r.ea1c < 6 ? 'ok' : r.ea1c < 6.5 ? 'warn' : 'bad' }
    ];
    if (r.gmiCheck)
      personalized.push({ l: 'GMI vs Lab', v: (r.gmiCheck.delta > 0 ? '+' : '') + r.gmiCheck.delta + '%', sub: 'GMI ' + r.gmi + ' vs lab ' + r.gmiCheck.lab, s: r.gmiCheck.agree ? 'ok' : 'warn' });
    if (r.calib) {
      if (r.calib.applied)
        personalized.push({ l: 'Calibrated', v: (r.calib.appliedOffset > 0 ? '+' : '') + window.GluDisp.delta(r.calib.appliedOffset), sub: window.GluDisp.label() + ' · lab-A1c shift', s: 'ok' });
      else if (r.calib.magnitude !== 'small')
        personalized.push({ l: 'Sensor bias', v: (r.calib.bias > 0 ? '+' : '') + window.GluDisp.delta(r.calib.bias), sub: window.GluDisp.label() + ' vs lab A1c', s: 'warn' });
    }
    if (r.fusion) personalized.push({ l: 'IR-risk band', v: r.fusion.irBand, sub: 'autonomic+glycemic · directional', s: r.fusion.irSev });
    if (r.fusion && r.fusion.morph && r.fusion.morph.qtc != null)
      personalized.push({
        l: 'QTc (ECGDex)',
        v: r.fusion.morph.qtc,
        sub: r.fusion.morph.hypoQtcRisk === 'elevated' ? '⚠ hypo⟷QTc risk' : 'ms · ' + r.fusion.morph.qtcMethod,
        s: r.fusion.morph.hypoQtcRisk === 'elevated' ? 'bad' : r.fusion.morph.qtcProlonged ? 'warn' : 'ok'
      });
    const items = personalized.concat([
      { l: 'Mean glucose', v: window.GluDisp.val(r.mean), sub: window.GluDisp.label(), s: r.mean < 140 ? 'ok' : r.mean < 160 ? 'warn' : 'bad' },
      { l: 'Time in Range', v: r.tir.tir + '%', sub: window.GluDisp.range(70, 180) + ' · goal >70', s: sevTIR(r.tir.tir) },
      { l: 'Tight Range', v: r.titr + '%', sub: window.GluDisp.range(70, 140) + ' · 2023 target', s: r.titr >= 50 ? 'ok' : r.titr >= 30 ? 'warn' : 'bad' },
      { l: 'Time Below', v: hypo + '%', sub: window.GluDisp.cmp('<', 70) + ' · goal <' + r.hypoGoal, s: hypo <= r.hypoGoal ? 'ok' : hypo <= r.hypoGoal * 2 ? 'warn' : 'bad' },
      {
        l: 'Time Above',
        v: (r.tir.tar1 + r.tir.tar2).toFixed(1) + '%',
        sub: window.GluDisp.cmp('>', 180) + ' · goal <25',
        s: r.tir.tar1 + r.tir.tar2 < 25 ? 'ok' : r.tir.tar1 + r.tir.tar2 < 40 ? 'warn' : 'bad'
      },
      { l: 'CV', v: r.cv + '%', sub: '<36 stable', s: r.cv < 36 ? 'ok' : r.cv < 42 ? 'warn' : 'bad' },
      { l: 'SD', v: window.GluDisp.spread(r.sd), sub: window.GluDisp.label(), s: r.sd < 50 ? 'ok' : r.sd < 65 ? 'warn' : 'bad' },
      {
        l: 'MAGE',
        v: r.mage == null ? '—' : window.GluDisp.spread(r.mage),
        sub: window.GluDisp.label() + ' · excursions',
        s: r.mage == null ? 'neutral' : r.mage < 60 ? 'ok' : r.mage < 100 ? 'warn' : 'bad'
      },
      { l: 'GVP', v: r.gvp == null ? '—' : r.gvp + '%', sub: 'path-length var', s: r.gvp == null ? 'neutral' : r.gvp < 20 ? 'ok' : r.gvp < 35 ? 'warn' : 'bad' },
      ...(r.modd != null ? [{ l: 'MODD', v: window.GluDisp.spread(r.modd), sub: window.GluDisp.label() + ' · day-to-day', s: r.modd < 40 ? 'ok' : r.modd < 60 ? 'warn' : 'bad' }] : []),
      { l: 'LBGI', v: r.lbgi, sub: 'low-BG risk', s: r.lbgi < 2.5 ? 'ok' : r.lbgi < 5 ? 'warn' : 'bad' },
      { l: 'HBGI', v: r.hbgi, sub: 'high-BG risk', s: r.hbgi < 4.5 ? 'ok' : r.hbgi < 9 ? 'warn' : 'bad' },
      ...(r.dawn.present ? [{ l: 'Dawn rise', v: '+' + window.GluDisp.val(r.dawn.medianDelta), sub: window.GluDisp.label() + ' · median', s: r.dawn.medianDelta < 30 ? 'warn' : 'bad' }] : []),
      ...(r.nocturnalHypo.length ? [{ l: 'Nocturnal hypo', v: r.nocturnalHypo.length, sub: 'episodes ' + window.GluDisp.cmp('<', 70), s: 'bad' }] : []),
      {
        l: '% Sensor active',
        v: r.pctActive + '%',
        sub: r.nGaps ? r.nGaps + ' gap' + (r.nGaps === 1 ? '' : 's') + ' · ' + r.gapMin + ' min' : 'continuous',
        s: r.pctActive >= 70 ? 'ok' : r.pctActive >= 50 ? 'warn' : 'bad'
      }
    ]);
    $('kpiGrid').innerHTML = items
      .map((k) => `<div class="kpi ${k.s}"><div class="kpi-label">${evBadge(k.l)}${k.l}</div><div class="kpi-val ${k.s}">${k.v}</div><div class="kpi-sub">${k.sub}</div></div>`)
      .join('');
    $('kpiGrid').classList.add('show');
    $('slKPI').style.display = 'flex';
  }

  function renderSessions(r) {
    const card = $('sessionCard');
    if (!card) return;
    const ss = r.sessions || [];
    if (ss.length < 2) {
      card.style.display = 'none';
      return;
    } // only interesting across multiple wears
    card.style.display = 'block';
    const sc = r.sessionCorr || {};
    // DEEP-AUDIT-II §5.3 — single-sourced onto GluDisp.drift() so the KPI below and these rows
    // cannot format the same quantity differently again (see the helper for the value/severity split).
    const driftSev = (d) => window.GluDisp.drift(d).sev;
    const rows = ss
      .map(
        (s) => `<tr>
    <td style="font-family:Inter,sans-serif;color:var(--text2);font-weight:600">#${s.idx}</td>
    <td class="mono">${new Date(s.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}–${new Date(s.endMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
    <td class="mono">${s.days}d</td>
    <td class="mono">${s.median == null ? '—' : window.GluDisp.val(s.median)}</td>
    <td class="mono ${driftSev(s.driftPerDay)}">${s.driftPerDay == null ? '—' : (s.driftPerDay > 0 ? '+' : '') + window.GluDisp.spread(s.driftPerDay)}</td>
  </tr>`
      )
      .join('');
    const medians = ss.map((s) => s.median).filter((v) => v != null);
    const spread = medians.length > 1 ? Math.max(...medians) - Math.min(...medians) : 0;
    // `driftPerDay` is STORED mg/dL; GluDisp.drift() owns the display-vs-severity split (§5.3).
    const maxDrift = Math.max(...ss.map((s) => Math.abs(s.driftPerDay || 0)));
    $('sessionBody').innerHTML = `
    <div class="card-h" style="margin-bottom:10px">Sensor sessions &amp; drift <span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:6px">${ss.length} wears detected · v1.2</span></div>
    <div class="q-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      <div class="q-stat"><div class="q-val neutral">${evBadge('Sessions')}${ss.length}</div><div class="q-lbl">Sessions</div><div class="q-sub">split on ≥90-min gaps / warm-ups</div></div>
      <div class="q-stat"><div class="q-val ${spread < 15 ? 'ok' : spread < 30 ? 'warn' : 'bad'}">${window.GluDisp.spread(spread)}<span style="font-size:12px;font-weight:600;color:var(--text3)"> ${window.GluDisp.label()}</span></div><div class="q-lbl">${evBadge('Between-session spread')}Between-session spread</div><div class="q-sub">range of session medians</div></div>
      <div class="q-stat"><div class="q-val ${window.GluDisp.drift(maxDrift).sev}">${window.GluDisp.drift(maxDrift).display}<span style="font-size:12px;font-weight:600;color:var(--text3)"> /day</span></div><div class="q-lbl">${evBadge('Largest drift')}Largest drift</div><div class="q-sub">${window.GluDisp.label()} per day, within a wear</div></div>
    </div>
    <div class="tbl-wrap show" style="margin:10px 0"><table><thead><tr><th>Session</th><th>Dates</th><th>Length</th><th>Median</th><th>Drift /day</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="sess-toggles">
      <label class="sess-tog"><input type="checkbox" id="togLevel" ${CORR.levelSessions ? 'checked' : ''}><span><b>Level sessions</b> — align each wear's median to the global median (${window.GluDisp.val(sc.globalMedian || r.median)} ${window.GluDisp.label()}). Removes step-changes between sensors.</span></label>
      <label class="sess-tog"><input type="checkbox" id="togDrift" ${CORR.deDrift ? 'checked' : ''}><span><b>De-drift</b> — remove the slow linear trend within each wear. <span style="color:var(--amber)">Experimental</span> — can shave real slow physiology, off by default.</span></label>
    </div>
    <div class="q-note" style="margin-top:8px">A multi-week file spans several sensor wears, each with its own factory bias and slow drift. ${spread >= 15 ? `<b style="color:var(--amber)">The ${window.GluDisp.spread(spread)} ${window.GluDisp.label()} spread between session medians is large</b> — a between-sensor step, not necessarily physiology.` : 'Session medians are close — little between-sensor step.'} ${maxDrift >= 7 ? `<b style="color:var(--amber)">One wear drifts ${window.GluDisp.spread(maxDrift)} ${window.GluDisp.label()}/day</b> — possible sensor aging.` : ''} Corrections re-run the whole pipeline on the adjusted trace. ${sc.leveled || sc.deDrifted ? `<b style="color:var(--green)">Active:</b> ${[sc.leveled ? 'leveling' : null, sc.deDrifted ? 'de-drift' : null].filter(Boolean).join(' + ')}.` : 'Both off — metrics reflect the raw sensor.'} <span style="opacity:.7">Reference-free corrections — defensible for leveling, experimental for de-drift; neither is a substitute for fingerstick calibration.</span></div>`;
    const tl = $('togLevel'),
      td = $('togDrift');
    if (tl)
      tl.addEventListener('change', () => {
        CORR.levelSessions = tl.checked;
        reanalyzeMeals(true);
      });
    if (td)
      td.addEventListener('change', () => {
        CORR.deDrift = td.checked;
        reanalyzeMeals(true);
      });
  }

  function renderNutrition(r) {
    const sec = $('nutSection');
    if (!sec) return;
    const n = r.nutrition;
    if (!n) {
      sec.style.display = 'none';
      return;
    }
    sec.style.display = 'block';
    if (n.matchedDays < 3) {
      $('nutBody').innerHTML =
        `<div class="q-note">${n.note || 'Not enough overlapping days between the CGM and nutrition logs.'} <b>${n.matchedDays}</b> shared day${n.matchedDays === 1 ? '' : 's'} found — load logs that cover the same dates.</div>`;
      return;
    }
    const cc = n.corr;
    const carbLbl = n.carbsKey === 'netCarbs' ? 'Net carbs' : 'Carbs';
    const strength = (v) => (v == null ? '—' : Math.abs(v) < 0.2 ? 'none' : Math.abs(v) < 0.4 ? 'weak' : Math.abs(v) < 0.6 ? 'moderate' : 'strong');
    const sev = (v, invert) => {
      if (v == null) return 'neutral';
      const a = invert ? -v : v;
      return a > 0.4 ? 'bad' : a > 0.2 ? 'warn' : 'ok';
    };
    const cell = (lbl, v, sub, invert) =>
      `<div class="q-stat">${typeof evBadge === 'function' ? evBadge(lbl) : ''}<div class="q-val ${sev(v, invert)}">${v == null ? '—' : (v > 0 ? '+' : '') + v}</div><div class="q-lbl">${lbl}</div><div class="q-sub">${v == null ? 'insufficient variance' : strength(v) + (v > 0 ? ' positive' : ' negative') + ' · ' + sub}</div></div>`;
    // scatter: carbs (x) vs daily mean (y)
    const pts = n.matched.filter((m) => m[n.carbsKey] != null && m.mean != null).map((m) => ({ x: m[n.carbsKey], y: m.mean }));
    const scatter =
      pts.length > 2
        ? UI.lineChart(
            pts.slice().sort((a, b) => a.x - b.x),
            UI.COLORS.amber,
            { W: 680, H: 170, xfmt: (x) => Math.round(x) + 'g' }
          )
        : '';
    const rows = n.matched
      .slice()
      .sort((a, b) => a.ms - b.ms)
      .map(
        (m) => `<tr>
    <td style="font-family:Inter,sans-serif;color:var(--text2);font-weight:600">${new Date(m.ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
    <td class="mono">${m[n.carbsKey] == null ? '—' : m[n.carbsKey] + 'g'}</td><td class="mono">${m.sugars == null ? '—' : m.sugars + 'g'}</td><td class="mono">${m.fiber == null ? '—' : m.fiber + 'g'}</td>
    <td class="mono">${m.mean == null ? '—' : window.GluDisp.val(m.mean)}</td><td class="mono ${m.tir >= 70 ? 'ok' : m.tir >= 50 ? 'warn' : 'bad'}">${m.tir == null ? '—' : m.tir + '%'}</td><td class="mono">${m.cv == null ? '—' : m.cv + '%'}</td></tr>`
      )
      .join('');
    $('nutBody').innerHTML = `
    <div class="q-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      ${cell(carbLbl + ' → mean', cc.carbsVsMean, 'higher carbs, higher mean')}
      ${cell(carbLbl + ' → TIR', cc.carbsVsTIR, 'higher carbs, less in-range', true)}
      ${cell(carbLbl + ' → CV', cc.carbsVsCV, 'higher carbs, more variability')}
      ${cell('Sugars → mean', cc.sugarsVsMean, 'added/total sugar effect')}
      ${cell('Fiber → TIR', cc.fiberVsTIR, 'more fiber, more in-range')}
    </div>
    ${scatter ? `<div class="mini-h" style="margin-top:8px">${carbLbl} vs daily mean glucose <span class="mini-sub">${pts.length} shared days · r = ${cc.carbsVsMean == null ? '—' : cc.carbsVsMean}</span></div>${scatter}` : ''}
    <div class="tbl-wrap show" style="margin-top:10px"><table><thead><tr><th>Day</th><th>${carbLbl}</th><th>Sugar</th><th>Fiber</th><th>Mean</th><th>TIR</th><th>CV</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="q-note" style="margin-top:10px">Pearson correlation across <b>${n.matchedDays}</b> days where both logs overlap. A positive ${carbLbl.toLowerCase()}→mean / negative ${carbLbl.toLowerCase()}→TIR is the expected diet-glucose link; fiber often protects TIR. <b>Directional, n is small, and day-totals can't see meal timing</b> — a day's carbs and its glucose are only loosely coupled without meal-level alignment. For per-meal tagging, export Cronometer's <i>timestamped servings</i> instead and it auto-seeds meal markers. <span style="opacity:.7">Correlation ≠ causation — confounded by activity, sleep, stress.</span></div>`;
  }

  function renderQuality(r) {
    const agpOk = r.pctActive >= 70;
    $('qualityCard').innerHTML = `
    <div class="q-grid">
      <div class="q-stat">${evBadge('Sensor active')}<div class="q-val ${r.pctActive >= 70 ? 'ok' : r.pctActive >= 50 ? 'warn' : 'bad'}">${r.pctActive}%</div><div class="q-lbl">Sensor active</div><div class="q-sub">AGP needs ≥70%</div></div>
      <div class="q-stat"><div class="q-val neutral">${r.activeMin >= 1440 ? (r.activeMin / 1440).toFixed(1) + 'd' : Math.round(r.activeMin / 60) + 'h'}</div><div class="q-lbl">${evBadge('Active time')}Active time</div><div class="q-sub">of ${(r.spanMin / 1440).toFixed(1)}d span${r.nGaps ? ` · ${r.nGaps} gap${r.nGaps === 1 ? '' : 's'}` : ''}</div></div>
      <div class="q-stat"><div class="q-val ${r.warmupMin > 0 ? 'warn' : 'ok'}">${r.warmupMin}m</div><div class="q-lbl">${evBadge('Warm-up suppressed')}Warm-up suppressed</div><div class="q-sub">fresh-sensor low/garbage</div></div>
      <div class="q-stat"><div class="q-val ${r.compMin > 0 ? 'warn' : 'ok'}">${r.compMin}m</div><div class="q-lbl">${evBadge('Compression lows')}Compression lows</div><div class="q-sub">flagged · not deleted</div></div>
    </div>
    ${!agpOk ? `<div class="q-note" style="color:var(--amber);border:1px solid rgba(255,184,77,.25);background:rgba(255,184,77,.06);border-radius:8px;padding:10px 12px;margin-bottom:10px">⚠ <b>Sensor active ${r.pctActive}%</b> — below the 70% AGP-validity floor over this period. Percentile bands and time-in-range are computed on the usable signal only; treat them as indicative.</div>` : ''}
    ${r.clampSat && r.clampSat.detected ? `<div class="q-note" style="color:var(--red);border:1px solid rgba(255,107,122,.28);background:rgba(255,107,122,.06);border-radius:8px;padding:10px 12px;margin-bottom:10px">⚠ <b>Clipped export${r.clampSat.vendor === 'lingo' ? ' · Abbott Lingo (55–200 mg/dL)' : ''}.</b> ${r.clampSat.note} The blind metrics below read against the clip, not your true extremes — interpret them as floors, not facts.</div>` : ''}
    <div class="q-note"><b>% sensor active</b> = analyzable cells ÷ total timeline (the CGM honesty metric). Warm-up (first ~1 h of a fresh sensor reading low/garbage) is <b>suppressed</b>; gaps (sensor off / out of range) are <b>flagged & bridged</b> by linear interpolation and greyed on the trace; nocturnal compression lows (sleeping on the sensor) are <b>flagged</b>, not deleted. Excluded spans never enter the distribution metrics, and the <code>conf</code> of every Ganglior event scales with local completeness.</div>`;
    $('qualitySection').style.display = 'block';
  }

  function renderAGP(r) {
    $('tirBody').innerHTML =
      UI.tirBar(r.tir) +
      `<div class="q-note" style="margin-top:10px"><b>Time in Tight Range (70–140)</b>: <b style="color:${r.titr >= 50 ? 'var(--green)' : r.titr >= 30 ? 'var(--amber)' : 'var(--red)'}">${r.titr}%</b> — the stricter 2023-consensus target (vs ${r.tir.tir}% in the standard 70–180 range). A useful stretch goal once standard TIR is solid.</div>`;
    $('agpBody').innerHTML =
      `<div class="mini-h">${evBadge('Mean glucose')}Ambulatory Glucose Profile <span class="mini-sub">median (teal) · IQR 25–75 · 10–90 band · ${r.durDays.toFixed(1)} days stacked onto one 24-h clock</span></div>` +
      UI.agpChart(r.hourly, { W: 720, H: 230 }) +
      `<div class="q-note" style="margin-top:8px">Every day's readings collapsed onto a single 24-h day: the <b>teal line</b> is the median glucose at each time, the darker band the middle 50% (IQR), the lighter band the 10–90th percentile spread. The green zone is the ${window.GluDisp.range(70, 180)} ${window.GluDisp.label()} target. ${r.tier !== 'agp' ? '<b>Bands shown but provisional</b> — the AGP standard wants ≥14 days; with ' + r.durDays.toFixed(1) + ' days they will tighten as more data accrues.' : '≥14 days — bands meet the AGP reporting standard.'}</div>`;
    $('agpSection').style.display = 'block';
  }

  function renderDaypart(r) {
    const d = r.daypart;
    if (!d) return '';
    const parts = [
      ['overnight', 'Overnight', '00–06h'],
      ['morning', 'Morning', '06–12h'],
      ['afternoon', 'Afternoon', '12–18h'],
      ['evening', 'Evening', '18–24h']
    ];
    const cells = parts
      .map(([k, lbl, win]) => {
        const s = d[k];
        const cv = s && s.cv != null ? s.cv : null;
        const sev = cv == null ? 'neutral' : cv < 36 ? 'ok' : cv < 45 ? 'warn' : 'bad';
        return `<div class="q-stat"><div class="q-val ${sev}">${evBadge(lbl + ' CV')}${cv == null ? '—' : cv + '<span style="font-size:12px;font-weight:600;color:var(--text3)">%</span>'}</div><div class="q-lbl">${lbl} CV</div><div class="q-sub">${win}${s && s.mean ? ' · mean ' + window.GluDisp.val(s.mean) : ''}</div></div>`;
      })
      .join('');
    return `<div class="mini-h" style="margin-top:6px">${evBadge('CV')}Variability by time of day <span class="mini-sub">CV split into dayparts — localises where the swings live · total CV ${d.total}%</span></div>
    <div class="q-grid" style="margin-bottom:10px"><div class="q-stat" style="border-color:rgba(61,224,208,.25)"><div class="q-val neutral">${evBadge('Total CV')}${d.total}<span style="font-size:12px;font-weight:600;color:var(--text3)">%</span></div><div class="q-lbl">Total CV</div><div class="q-sub">whole recording</div></div>${cells}</div>`;
  }

  function renderVariability(r) {
    const eb = (label, val, unit, sub, sev, note) =>
      `<div class="q-stat">${evBadge(label)}<div class="q-val ${sev}">${val == null ? '—' : val}${val != null && unit ? `<span style="font-size:12px;font-weight:600;color:var(--text3)"> ${unit}</span>` : ''}</div><div class="q-lbl">${label}</div><div class="q-sub">${sub}</div></div>`;
    $('variBody').innerHTML = `
    <div class="q-grid">
      ${eb('MAGE', window.GluDisp.spread(r.mage), window.GluDisp.label(), 'mean excursion >1 SD', r.mage == null ? 'neutral' : r.mage < 60 ? 'ok' : r.mage < 100 ? 'warn' : 'bad')}
      ${eb('CONGA-1h', window.GluDisp.spread(r.conga1), window.GluDisp.label(), 'SD of 1-h Δ', r.conga1 == null ? 'neutral' : r.conga1 < 25 ? 'ok' : 'warn')}
      ${eb('CONGA-2h', window.GluDisp.spread(r.conga2), window.GluDisp.label(), 'SD of 2-h Δ', r.conga2 == null ? 'neutral' : r.conga2 < 35 ? 'ok' : 'warn')}
      ${eb('CONGA-4h', window.GluDisp.spread(r.conga4), window.GluDisp.label(), 'SD of 4-h Δ', r.conga4 == null ? 'neutral' : r.conga4 < 45 ? 'ok' : 'warn')}
      ${eb('MODD', window.GluDisp.spread(r.modd), window.GluDisp.label(), 'mean |day-to-day Δ|', r.modd == null ? 'neutral' : r.modd < 40 ? 'ok' : r.modd < 60 ? 'warn' : 'bad')}
      ${eb('GVP', r.gvp, '%', 'trace path-length', r.gvp == null ? 'neutral' : r.gvp < 20 ? 'ok' : r.gvp < 35 ? 'warn' : 'bad')}
      ${eb('J-index', r.jIndex, '', '0.001·(mean+SD)²', r.jIndex == null ? 'neutral' : r.jIndex < 30 ? 'ok' : r.jIndex < 45 ? 'warn' : 'bad')}
      ${eb('LBGI', r.lbgi, '', 'Kovatchev low-risk', r.lbgi < 2.5 ? 'ok' : r.lbgi < 5 ? 'warn' : 'bad')}
      ${eb('HBGI', r.hbgi, '', 'Kovatchev high-risk', r.hbgi < 4.5 ? 'ok' : r.hbgi < 9 ? 'warn' : 'bad')}
      ${eb('MAG', window.GluDisp.spread(r.magRate), window.GluDisp.label() + '/h', 'mean abs rate', r.magRate == null ? 'neutral' : r.magRate < 30 ? 'ok' : r.magRate < 55 ? 'warn' : 'bad')}
      ${eb('GRADE', r.grade ? r.grade.score : null, '', 'glycemic risk score', r.grade == null ? 'neutral' : r.grade.score < 5 ? 'ok' : r.grade.score < 10 ? 'warn' : 'bad')}
      ${eb('ADRR', r.adrr, '', 'avg daily risk range', r.adrr == null ? 'neutral' : r.adrr < 20 ? 'ok' : r.adrr < 40 ? 'warn' : 'bad')}
    </div>
    ${r.grade ? `<div class="q-note" style="margin:-2px 0 10px">GRADE risk attribution — <b style="color:var(--red)">${r.grade.hypoPct}%</b> from hypo · <b style="color:var(--green)">${r.grade.euPct}%</b> from target · <b style="color:var(--amber)">${r.grade.hyperPct}%</b> from hyper (where your risk score actually comes from).</div>` : ''}
    ${renderDaypart(r)}
    <div class="q-note"><b>MAGE</b> averages swings bigger than one SD (the meal/excursion amplitude). <b>CONGA(n)</b> is the SD of n-hour differences — short-range instability. <b>MODD</b> is mean day-to-day difference at matched clock times (reproducibility; needs ≥2 days). <b>GVP</b> is how much longer the glucose trace is than a flat line, as a %. <b>MAG</b> is the mean absolute rate of change (mg/dL per hour). <b>GRADE</b> &amp; <b>ADRR</b> are recognised single-number glycemic-risk scores — GRADE from a log-log transform of glucose, ADRR from the daily low+high risk extremes. <b>LBGI/HBGI</b> are Kovatchev's asymmetric low/high risk indices — LBGI especially predicts hypoglycemia. ${r.modd == null ? 'MODD withheld — needs ≥2 full days.' : ''}${r.adrr == null ? ' ADRR withheld — needs ≥2 days.' : ''}</div>`;
    $('variSection').style.display = 'block';
  }

  function renderPatterns(r) {
    // dawn per-day mini-trend
    let dawnHtml = '';
    if (r.dawn.days && r.dawn.days.length) {
      const pts = r.dawn.days.map((d, i) => ({ x: i, y: d.delta }));
      dawnHtml =
        `<div class="mini-h" style="margin-top:4px">${evBadge('Dawn phenomenon')}Dawn rise per day <span class="mini-sub">nadir(03–06h) → pre-breakfast(06–08h) · median +${window.GluDisp.val(r.dawn.medianDelta)} ${window.GluDisp.label()}${r.dawn.present ? ' · flagged ≥' + window.GluDisp.tick(20) : ''}</span></div>` +
        UI.lineChart(pts, r.dawn.present ? UI.COLORS.amber : UI.COLORS.teal, { W: 680, H: 130, ymn: 0, med: 20, xfmt: (x) => 'd' + (x + 1) });
    }
    // nocturnal hypos
    const noct = r.nocturnalHypo
      .map(
        (h) =>
          `<div class="gang-ev bad"><span class="ge-t">${DSP.hhmm(h.startMs).slice(0, 5)}</span><span class="ge-imp">nocturnal_hypo</span><span class="ge-meta">min ${window.GluDisp.val(h.min)} · ${h.durMin}m</span><span class="ge-conf">&lt;70</span></div>`
      )
      .join('');
    // excursions summary
    const exc = r.excursions;
    const nAnn = exc.filter((e) => e.annotated).length;
    const excStream = exc.length
      ? exc
          .slice(0, 40)
          .map((e) => {
            const cat = e.mealCat;
            const catCls = cat === 'heavy' ? 'bad' : cat === 'medium' ? 'surge' : '';
            return `<div class="gang-ev ${catCls}"><span class="ge-t">${DSP.hhmm(e.startMs).slice(0, 5)}</span><span class="ge-imp">${e.annotated ? e.meal : 'unannotated'}</span><span class="ge-meta">+${window.GluDisp.val(e.rise)} ${window.GluDisp.label()} · ${e.rateMgMin}/min · peak ${window.GluDisp.val(e.peak)}</span><span class="ge-conf">${e.annotated ? e.mealCat : 'slope'}</span></div>`;
          })
          .join('')
      : '';
    $('patternsBody').innerHTML = `
    <div class="gang-summary">
      <div class="gang-pill" style="border-color:${r.dawn.present ? UI.COLORS.amber : UI.COLORS.dim}"><b>Dawn phenomenon</b> ${r.dawn.present ? 'present · +' + window.GluDisp.val(r.dawn.medianDelta) + ' ' + window.GluDisp.label() : r.dawn.days && r.dawn.days.length ? 'not flagged (' + window.GluDisp.val(r.dawn.medianDelta) + ' ' + window.GluDisp.label() + ')' : '—'}</div>
      <div class="gang-pill" style="border-color:${r.nocturnalHypo.length ? UI.COLORS.red : UI.COLORS.dim}"><b>${r.nocturnalHypo.length}</b> nocturnal hypo${r.nocturnalHypo.length === 1 ? '' : 's'}</div>
      <div class="gang-pill"><b>${exc.length}</b> ${nAnn ? `excursion${exc.length === 1 ? '' : 's'} · <b style="color:var(--green)">${nAnn} meal-annotated</b>` : `unannotated excursion${exc.length === 1 ? '' : 's'}`}</div>
    </div>
    ${dawnHtml}
    ${excStream ? `<div class="mini-h" style="margin-top:12px">Excursion events <span class="mini-sub">${nAnn ? 'tagged against your meal markers where they line up' : 'slope-detected · add meal markers above to annotate'}</span></div><div class="gang-stream" style="max-height:200px">${excStream}</div>` : ''}
    ${noct ? `<div class="mini-h" style="margin-top:12px">Nocturnal hypoglycemia episodes <span class="mini-sub">00:00–06:00 · ≥15 min &lt;70 mg/dL · high-priority</span></div><div class="gang-stream" style="max-height:170px">${noct}</div>` : ''}
    <div class="q-note" style="margin-top:10px"><b>Dawn phenomenon</b> — the early-morning hepatic glucose rise; flagged when the nadir→pre-breakfast climb exceeds ~20 mg/dL. <b>Nocturnal hypos</b> are time-below-range runs in the 00:00–06:00 window (high-priority — easy to sleep through). <b>Excursions</b> are slope-detected rapid rises; with no meal markers in v1 they're labelled <i>unannotated</i> (likely meals, but not asserted). Each becomes a typed event on the Ganglior bus — <code>dawn_surge</code> / <code>nocturnal_hypo</code> / <code>glucose_excursion</code> — with confidence scaled by local data quality. <span style="opacity:.7">Hypo flags are informational; review timing and symptoms with your clinician — never a dosing instruction.</span></div>`;
    $('patternsSection').style.display = 'block';
  }

  function renderPPGR(r) {
    const sec = $('ppgrSection');
    if (!sec) return;
    const pp = r.postprandial;
    if (!pp) {
      sec.style.display = 'none';
      return;
    }
    sec.style.display = 'block';
    const catCol = { light: UI.COLORS.green, medium: UI.COLORS.amber, heavy: UI.COLORS.red };
    const cards = pp
      .map((m) => {
        const col = catCol[m.category] || UI.COLORS.teal;
        const sev = m.peakDelta == null ? 'neutral' : m.peakDelta < 40 ? 'ok' : m.peakDelta < 70 ? 'warn' : 'bad';
        const ret = m.returnedPct;
        return `<div class="q-stat" style="border-left:3px solid ${col}">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><div class="q-lbl" style="margin:0">${typeof evBadge === 'function' ? evBadge(m.label) : ''}${m.label}</div><span style="font-size:9.5px;color:var(--text4);font-family:'IBM Plex Mono',monospace">${m.nDays}d · ${m.category}</span></div>
      <div class="q-val ${sev}" style="margin-top:6px">+${m.peakDelta == null ? '—' : window.GluDisp.val(m.peakDelta)}<span style="font-size:12px;font-weight:600;color:var(--text3)"> ${window.GluDisp.label()} peak</span></div>
      <div class="q-sub" style="margin-top:5px;line-height:1.7">
        peak at <b style="color:var(--text2)">${m.timeToPeakMin == null ? '—' : m.timeToPeakMin} min</b> · +2 h Δ <b style="color:var(--text2)">${m.delta2h == null ? '—' : (m.delta2h > 0 ? '+' : '') + window.GluDisp.val(m.delta2h)}</b><br>
        returned to baseline <b style="color:${ret >= 70 ? 'var(--green)' : ret >= 40 ? 'var(--amber)' : 'var(--red)'}">${ret == null ? '—' : ret + '%'}</b> of days within 3 h
      </div></div>`;
      })
      .join('');
    $('ppgrBody').innerHTML = `
    <div class="q-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${cards}</div>
    <div class="q-note" style="margin-top:6px">For each meal marker, GlucoDex takes the 30-min pre-meal <b>baseline</b>, then measures the <b>peak rise</b>, <b>time-to-peak</b>, the <b>+2 h delta</b> (how much is still elevated two hours later — the classic postprandial-control number), and how often glucose <b>returned to baseline</b> within 3 h. A lower peak, earlier time-to-peak, small +2 h delta and high return % all signal a well-handled meal. Averaged across every day the meal appears. <span style="opacity:.7">Directional — depends on your meal markers being roughly accurate; v1 has no carb-quantity input.</span></div>`;
  }

  function renderDaily(r) {
    // build per-day 24h overlay traces from cleaned series
    const cad = r.cadence;
    const days = new Map();
    for (let i = 0; i < r.series.N; i++) {
      if (r.series.gF[i] === r.series.FLAG.WARMUP) continue;
      const d = new Date(r.series.gT[i]);
      const k = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
      if (!days.has(k)) days.set(k, []);
      days.get(k).push({ h: d.getUTCHours() + d.getUTCMinutes() / 60, v: r.series.gV[i] });
    }
    const daysCells = [...days.values()].map((pts) => ({ pts: pts.sort((a, b) => a.h - b.h) }));
    // distribution values (analyzable)
    // DEEP-AUDIT §5: long-gap cells are interpolation, not measurement — keep them out of the daily distribution.
    const dvals = [];
    for (let i = 0; i < r.series.N; i++) {
      if (r.series.gF[i] !== r.series.FLAG.WARMUP && r.series.gF[i] !== r.series.FLAG.COMPRESSION && r.series.gF[i] !== r.series.FLAG.GAP_LONG) dvals.push(r.series.gV[i]);
    }

    const rows = r.daily
      .map((d) => {
        const s = sevTIR(d.tir);
        return `<tr><td style="font-family:Inter,sans-serif;color:var(--text2);font-weight:600">${new Date(d.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td>
      <td class="mono">${d.mean}</td><td class="mono ${s}">${d.tir}%</td><td class="mono ${d.tbr <= r.hypoGoal ? 'ok' : 'warn'}">${d.tbr}%</td><td class="mono">${d.tar}%</td><td class="mono">${d.cv}%</td><td class="mono">${d.gmi}%</td></tr>`;
      })
      .join('');

    $('dailyBody').innerHTML = `
    <div class="ch-grid">
      <div><div class="mini-h">${evBadge('Mean glucose')}Daily overlay <span class="mini-sub">${daysCells.length} days · each faint line is one 24-h trace</span></div>${UI.dayOverlay(daysCells, { ymx: Math.max(300, r.max + 20) })}</div>
      <div><div class="mini-h">${evBadge('Mean glucose')}Glucose distribution <span class="mini-sub">all readings · coloured by zone</span></div>${UI.distribution(dvals, { max: r.max + 20 })}</div>
    </div>
    <div class="tbl-wrap show" style="margin-top:12px">
      <table><thead><tr><th>Day</th><th>Mean</th><th>TIR</th><th>TBR</th><th>TAR</th><th>CV</th><th>GMI</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
    $('dailySection').style.display = 'block';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FUSION — ingest ECGDex JSON → autonomic-risk vector → IR-risk + handshake
  // ════════════════════════════════════════════════════════════════════════
  // ─── nutrition (Cronometer) ──────────────────────────────────────────────────
  function loadNutrition(file) {
    const fr = new FileReader();
    fr.onload = (e) => {
      let nut;
      try {
        nut = DSP.parseNutrition(e.target.result);
      } catch (err) {
        showErr('Could not parse nutrition CSV: ' + (err.message || err));
        return;
      }
      NUTRITION = nut;
      const st = $('nutStatus');
      st.textContent = '✅ ' + nut.nDays + '-day ' + (nut.shape === 'servings' ? 'servings → ' + nut.mealMarkers.length + ' meal markers' : 'daily summary');
      st.classList.add('ok');
      $('nutLoad').classList.add('loaded');
      if (nut.shape === 'servings' && nut.mealMarkers && nut.mealMarkers.length) {
        MEALS = nut.mealMarkers.map((m) => ({ minOfDay: m.minOfDay, category: m.category, label: m.label }));
        saveMeals();
        renderMealList();
      }
      if (LASTPARSED) {
        reanalyzeMeals(true);
        const n = RESULT && RESULT.nutrition;
        showOK(
          nut.shape === 'servings'
            ? 'Loaded ' + nut.mealMarkers.length + ' meal markers from Cronometer servings — excursions re-annotated.'
            : 'Nutrition log matched ' + (n ? n.matchedDays : 0) + ' shared days — carbs ⟷ glycemia correlation below.'
        );
      } else showOK('Nutrition log loaded — will correlate once a CGM recording is analyzed.');
    };
    fr.readAsText(file);
  }

  function loadECGJSON(file) {
    const fr = new FileReader();
    fr.onload = (e) => {
      let json;
      try {
        json = JSON.parse(e.target.result);
      } catch (err) {
        showErr('Could not parse ECGDex JSON.');
        return;
      }
      if (json.node !== 'ECGDex' && !(json.schema && json.schema.node === 'ECGDex')) {
        // tolerate but warn
      }
      ECGJSON = json;
      $('ecgJsonStatus').textContent =
        '✅ ' +
        (json.schema ? 'schema ' + json.schema.version : json.version ? 'v' + json.version : 'loaded') +
        (json.recording && json.recording.startEpochMs ? ' · ' + new Date(json.recording.startEpochMs).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '');
      $('ecgJsonStatus').classList.add('ok');
      $('ecgJsonLoad').classList.add('loaded');
      if (RESULT) {
        try {
          FUSION = computeFusion(RESULT, json);
          RESULT.fusion = FUSION;
          RESULT.events = RESULT.events.filter((ev) => ev.node === 'GlucoDex').concat(FUSION.events || []);
          renderKPI(RESULT);
          renderFusion(RESULT);
          renderGanglior(RESULT);
          renderTable(RESULT);
          showOK('Fusion computed — autonomic-risk vector vs glycemic variability cross-validated. IR-risk band: ' + FUSION.irBand + '.');
        } catch (err) {
          showErr('Fusion failed: ' + (err.message || err));
        }
      } else showOK('ECGDex JSON loaded — will fuse once a CGM recording is analyzed.');
    };
    fr.readAsText(file);
  }

  // regress lnRMSSD vs tMin → slope per hour (fallback when scalar is null/short ECG)
  function regressLnRmssd(epochs) {
    const xs = [],
      ys = [];
    for (const e of epochs) {
      const rm = e.rmssd;
      if (rm > 0 && isFinite(rm) && isFinite(e.tMin)) {
        xs.push(e.tMin);
        ys.push(Math.log(rm));
      }
    }
    if (xs.length < 4) return null;
    const n = xs.length,
      mx = xs.reduce((a, b) => a + b, 0) / n,
      my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    if (den === 0) return null;
    const slopePerMin = num / den;
    return +(slopePerMin * 60).toFixed(4); // per hour
  }

  function computeFusion(r, json) {
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    // ── pull autonomic-risk inputs (priority order, defensive across schema versions) ──
    const hrvStab = json.hrvStability || null;
    const epochs = (json.timeseries && json.timeseries.epochs) || json.epochs || (json.timeseries && json.timeseries.epochs) || [];
    let slope = hrvStab && hrvStab.sigma_lnRMSSD_slope != null ? hrvStab.sigma_lnRMSSD_slope : null;
    let slopeRecomputed = false;
    if (slope == null) {
      const s = regressLnRmssd(epochs);
      if (s != null) {
        slope = s;
        slopeRecomputed = true;
      }
    }
    const surgeEsc = json.apnea && json.apnea.surgeEscalationPct != null ? json.apnea.surgeEscalationPct : null;
    const coupling = json.cardiorespiratory && json.cardiorespiratory.couplingStrength != null ? json.cardiorespiratory.couplingStrength : null;
    const cvhrIdx = json.apnea ? json.apnea.cvhrIndex : null;
    const ecgStartMs = (json.recording && json.recording.startEpochMs) || json.t0Ms || null;

    // ── ECG MORPHOLOGY (ECGDex 1.1+) — defensive across nestings ──
    const mInt = (json.morphology && json.morphology.intervals) || json.intervals || (json.nonlinear && json.nonlinear.intervals) || null;
    const qtc = mInt ? (mInt.qtcBazett != null ? mInt.qtcBazett : mInt.qtcFridericia != null ? mInt.qtcFridericia : null) : null;
    const qtcMethod = mInt && mInt.qtcBazett != null ? 'Bazett' : mInt && mInt.qtcFridericia != null ? 'Fridericia' : null;
    const prInt = mInt ? mInt.pr : null,
      qrsDur = mInt ? mInt.qrsDur : null,
      stLevel = mInt ? mInt.stLevel : null;
    const sex = (r.profile && r.profile.sex) || 'M';
    // QTc prolongation thresholds (consensus): >450 M / >460 F borderline, >470/>480 prolonged.
    const qtcBorderline = sex === 'F' ? 460 : 450,
      qtcLong = sex === 'F' ? 480 : 470;
    const qtcProlonged = qtc != null && qtc > qtcBorderline;

    // ── HYPOGLYCEMIA ⟷ QTc fusion (the clinically real glucose×morphology link) ──
    //   Nocturnal hypoglycemia prolongs QTc (sympathoadrenal surge + hypokalemia) and is
    //   implicated in the "dead-in-bed" arrhythmia. GlucoDex sees the hypos; ECGDex now
    //   exports QTc. The same-night coincidence is a cross-node signal neither sees alone.
    const nNocturnalHypo = r.nocturnalHypo.length;
    const minNightGlucose = r.nocturnalHypo.length ? Math.min(...r.nocturnalHypo.map((h) => h.min)) : null;
    let hypoQtcRisk = 'none',
      hypoQtcNote = null;
    if (qtc != null) {
      if (nNocturnalHypo > 0 && qtcProlonged) {
        hypoQtcRisk = 'elevated';
        hypoQtcNote =
          'Nocturnal hypoglycemia (' +
          nNocturnalHypo +
          ' episode' +
          (nNocturnalHypo > 1 ? 's' : '') +
          ', nadir ' +
          minNightGlucose +
          ' mg/dL) coincides with a prolonged QTc (' +
          qtc +
          ' ms). Hypoglycemia is a recognised QTc-prolonging trigger — this same-night coincidence is the arrhythmic-risk pattern behind "dead-in-bed". Directional, single-lead — confirm with a clinician/12-lead.';
      } else if (qtcProlonged) {
        hypoQtcRisk = 'qtc-only';
        hypoQtcNote =
          'QTc ' +
          qtc +
          ' ms is ' +
          (qtc > qtcLong ? 'prolonged' : 'borderline') +
          ' (threshold ' +
          qtcBorderline +
          ' ms for ' +
          (sex === 'F' ? 'F' : 'M') +
          ') but no nocturnal hypos were measured this period — repolarisation watch, not a glucose-linked flag.';
      } else if (nNocturnalHypo > 0) {
        hypoQtcRisk = 'hypo-only';
        hypoQtcNote =
          'Nocturnal hypos present but QTc (' + qtc + ' ms) is within range — no repolarisation amplification seen on this (possibly different) night. Keep aligned-night data to watch the pair.';
      } else {
        hypoQtcRisk = 'clear';
        hypoQtcNote = 'QTc ' + qtc + ' ms within range and no nocturnal hypos — the hypo⟷QTc arrhythmic pattern is absent.';
      }
    }
    const morph = mInt
      ? {
          qtc,
          qtcMethod,
          qtcBorderline,
          qtcLong,
          qtcProlonged,
          pr: prInt,
          qrsDur,
          stLevel,
          pPresent: json.morphology && json.morphology.intervals ? json.morphology.intervals.pWaveResolved : null,
          hypoQtcRisk,
          hypoQtcNote,
          nNocturnalHypo,
          minNightGlucose
        }
      : null;

    // ── NOCTURNAL QTc TREND ⟷ overnight glucose (ECGDex 1.2+ forward-compat) ──
    //   ECGDex doesn't yet export a per-epoch QTc series — only a summary median beat.
    //   When it does (morphology.qtcTrend[] / timeseries.epochs[].qtc), line each QTc
    //   point up against GlucoDex's measured glucose at that wall-clock and correlate:
    //   a rising QTc that tracks falling glucose is the beat-level hypo⟷repolarisation link.
    if (morph) {
      const mo = json.morphology || {};
      let trend = Array.isArray(mo.qtcTrend) ? mo.qtcTrend : null;
      if (!trend && Array.isArray(epochs) && epochs.some((e) => e.qtc != null || e.qtcBazett != null))
        trend = epochs.filter((e) => e.qtc != null || e.qtcBazett != null).map((e) => ({ tMin: e.tMin, qtc: e.qtc != null ? e.qtc : e.qtcBazett }));
      // glucose at a wall-clock ms (nearest cleaned cell, skip warm-up)
      const gluAt = (ms) => {
        let best = null,
          bd = 1e9;
        const cad = r.series.cadence * 60000;
        const idx = Math.round((ms - r.series.gT[0]) / cad);
        for (let k = Math.max(0, idx - 2); k <= Math.min(r.series.N - 1, idx + 2); k++) {
          if (r.series.gF[k] === r.series.FLAG.WARMUP) continue;
          const d = Math.abs(r.series.gT[k] - ms);
          if (d < bd) {
            bd = d;
            best = r.series.gV[k];
          }
        }
        return bd <= cad * 3 ? best : null;
      };
      if (trend && trend.length >= 4 && ecgStartMs) {
        const qs = [],
          gs = [],
          pairs = [];
        for (const pt of trend) {
          const ms = ecgStartMs + (pt.tMin || 0) * 60000;
          const g = gluAt(ms);
          if (g != null && pt.qtc != null) {
            qs.push(pt.qtc);
            gs.push(g);
            pairs.push({ ms, qtc: pt.qtc, glu: Math.round(g) });
          }
        }
        if (qs.length >= 4) {
          morph.qtcTrend = {
            n: qs.length,
            r: DSP.pearson(gs, qs),
            pairs,
            qtcRange: [Math.min(...qs), Math.max(...qs)],
            note: 'Per-epoch QTc lined up against same-clock glucose. A negative r (QTc rises as glucose falls) is the beat-level hypoglycemia⟷repolarisation signature.'
          };
        }
      }
      // T-wave alternans (µV) — electrical-instability marker, if exported
      const twa = mo.twa != null ? mo.twa : mInt && mInt.twa != null ? mInt.twa : null;
      if (twa != null) morph.twa = { uv: twa, abnormal: twa >= 47, note: 'T-wave alternans ≥47 µV flags repolarisation instability (MTWA). Co-travels with hypoglycemic QTc stress.' };
      morph.trendAvailable = !!morph.qtcTrend;
      morph.twaAvailable = twa != null;
    }

    // ── autonomic-risk scalar (slope weighted highest; others corroborate) ──
    const parts = [];
    const w = [];
    let slopeRisk = null;
    if (slope != null) {
      slopeRisk = clamp(0.5 + slope * 4, 0, 1);
      parts.push(slopeRisk);
      w.push(0.6);
    } // rising slope = instability
    let surgeRisk = null;
    if (surgeEsc != null) {
      surgeRisk = clamp(surgeEsc / 60, 0, 1);
      parts.push(surgeRisk);
      w.push(0.2);
    }
    let couplingRisk = null;
    if (coupling != null) {
      couplingRisk = clamp(1 - coupling, 0, 1);
      parts.push(couplingRisk);
      w.push(0.2);
    } // low coupling = dysfunction
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    const autoRisk = parts.length ? +(parts.reduce((a, b, i) => a + b * w[i], 0) / wsum).toFixed(3) : null;

    // ── glycemic-variability scalar (measured by GlucoDex) ──
    const cvR = clamp((r.cv - 25) / 25, 0, 1),
      mageR = clamp(((r.mage || 50) - 40) / 80, 0, 1),
      dawnR = clamp((r.dawn.present ? r.dawn.medianDelta : 0) / 60, 0, 1);
    const glyVar = +(0.45 * cvR + 0.35 * mageR + 0.2 * dawnR).toFixed(3);

    // ── directional IR-risk (recalibrated bands so a normal trace doesn't flag) ──
    let irScore, irBand, irSev;
    if (autoRisk != null) {
      irScore = +(0.45 * autoRisk + 0.55 * glyVar).toFixed(3);
    } else irScore = +glyVar.toFixed(3);
    if (irScore < 0.34) {
      irBand = 'Lower';
      irSev = 'ok';
    } else if (irScore < 0.6) {
      irBand = 'Moderate';
      irSev = 'warn';
    } else {
      irBand = 'Higher';
      irSev = 'bad';
    }

    // ── concordance: do autonomic instability & glycemic variability point the same way? ──
    const autoHigh = autoRisk != null && autoRisk >= 0.55;
    const glyHigh = glyVar >= 0.4;
    let concordance = autoRisk == null ? 'autonomic-input-missing' : autoHigh === glyHigh ? (autoHigh ? 'concordant-elevated' : 'concordant-low') : 'discordant';

    // ── night alignment honesty ──
    let nightOverlap = false,
      alignNote;
    if (ecgStartMs) {
      const ecgDay = new Date(ecgStartMs);
      ecgDay.setHours(0, 0, 0, 0);
      // does GlucoDex cover that calendar night?
      nightOverlap = r.series.gT[0] <= ecgStartMs + 86400000 && r.series.gT[r.series.N - 1] >= ecgStartMs - 43200000;
      alignNote = nightOverlap
        ? 'ECG night (' + new Date(ecgStartMs).toLocaleDateString(undefined, { timeZone: 'UTC' }) + ') overlaps the CGM window — aligned by shared wall-clock.'
        : 'ECG and CGM appear to be different nights — comparing typical-night profiles, not the same night (directional).';
    } else alignNote = 'ECG export carries no start timestamp — comparing typical-night profiles.';

    // overnight glucose variability (00:00–06:00) as the GlucoDex-measured night signal.
    // DEEP-AUDIT §5: long-gap cells are interpolation — an overnight dropout must not be read as "measured".
    let nightCV = null;
    {
      const nv = [];
      for (let i = 0; i < r.series.N; i++) {
        const f = r.series.gF[i];
        if (f === r.series.FLAG.WARMUP || f === r.series.FLAG.GAP_LONG) continue;
        const h = new Date(r.series.gT[i]).getUTCHours();
        if (h < 6) nv.push(r.series.gV[i]);
      }
      if (nv.length > 10) {
        const m = DSP._mean(nv);
        nightCV = +((DSP._std(nv, m) / m) * 100).toFixed(1);
      }
    }

    // ── producer-side handshake value for ECGDex's reserved.glucoseCorrelation slot ──
    // The old `(nightCV || r.cv)` silently substituted the DAYTIME CV when there was no nocturnal coverage,
    // and still surfaced (and emitted) the number as a NOCTURNAL risk. With no night data the risk is
    // UNKNOWN — null — and the nocturnal_glucose_risk event is not emitted at all (DEEP-AUDIT §5 residue).
    const nocturnalGlucoseRisk = nightCV == null ? null : +(0.5 * glyVar + 0.5 * clamp(nightCV / 50, 0, 1)).toFixed(3);
    const glucoseAutonomicCorrelation = autoRisk != null ? +((concordance === 'concordant-elevated' ? 0.6 : concordance === 'discordant' ? -0.2 : 0.2) + (autoRisk - 0.5) * 0.4).toFixed(2) : null;

    // ── Ganglior events emitted back onto the bus ──
    const conf = +(0.5 + 0.3 * (r.pctActive / 100) + (slopeRecomputed ? 0 : 0.1)).toFixed(2);
    const t0 = DSP.hhmm(ecgStartMs || r.t0Ms);
    // absolute floating wall-clock ms for the fusion anchor (Clock Contract §6); null when no anchor.
    const t0ms = ecgStartMs || r.t0Ms || null;
    const events = [{ t: t0, tMs: t0ms, impulse: 'glucose_autonomic_correlation', node: 'GlucoDex', conf, meta: { irBand, irScore, concordance, autoRisk, glyVar } }];
    // Only emit a NOCTURNAL risk when there is nocturnal data behind it (DEEP-AUDIT §5).
    if (nocturnalGlucoseRisk != null) {
      events.push({ t: t0, tMs: t0ms, impulse: 'nocturnal_glucose_risk', node: 'GlucoDex', conf, meta: { value: nocturnalGlucoseRisk, nightCV } });
    }
    if (morph && morph.hypoQtcRisk === 'elevated') {
      events.push({
        t: t0,
        tMs: t0ms,
        impulse: 'hypo_qtc_arrhythmia_risk',
        node: 'GlucoDex',
        conf: +Math.min(0.95, conf + 0.05).toFixed(2),
        meta: { qtcMs: morph.qtc, nocturnalHypos: morph.nNocturnalHypo, nadirMgdl: morph.minNightGlucose }
      });
    }

    return {
      slope,
      slopeRecomputed,
      slopeRisk,
      surgeEsc,
      surgeRisk,
      coupling,
      couplingRisk,
      cvhrIdx,
      autoRisk,
      glyVar,
      irScore,
      irBand,
      irSev,
      concordance,
      nightOverlap,
      alignNote,
      nightCV,
      nocturnalGlucoseRisk,
      glucoseAutonomicCorrelation,
      ecgStartMs,
      morph,
      inputs: { usedSlope: slope != null, usedSurge: surgeEsc != null, usedCoupling: coupling != null, usedMorphology: morph != null, nEpochs: epochs.length },
      events
    };
  }

  function renderFusion(r) {
    const f = r.fusion;
    if (!f) {
      $('fusionResult').style.display = 'none';
      $('fusionEmpty').style.display = 'block';
      return;
    }
    $('fusionEmpty').style.display = 'none';
    $('fusionResult').style.display = 'block';
    const col = { ok: UI.COLORS.green, warn: UI.COLORS.amber, bad: UI.COLORS.red }[f.irSev];
    // autonomic vector pills
    const vec = [];
    vec.push(
      `<div class="gang-pill"${f.slope != null ? ` style="border-color:${f.slopeRisk > 0.55 ? UI.COLORS.amber : UI.COLORS.dim}"` : ''}><b>bσ(lnRMSSD) slope</b> ${f.slope != null ? (f.slope > 0 ? '+' : '') + f.slope + '/h' : '—'}${f.slopeRecomputed ? ' · recomputed' : ''}</div>`
    );
    if (f.surgeEsc != null) vec.push(`<div class="gang-pill">surge escalation <b>${f.surgeEsc > 0 ? '+' : ''}${f.surgeEsc}%</b></div>`);
    if (f.coupling != null) vec.push(`<div class="gang-pill">CR coupling <b>${f.coupling}</b> · inv ${(1 - f.coupling).toFixed(2)}</div>`);
    vec.push(`<div class="gang-pill" style="border-color:${col};color:${col}"><b>autonomic risk ${f.autoRisk != null ? f.autoRisk : '—'}</b></div>`);

    // 2D plane point (autonomic × glycemic)
    const scatter = UI.fusionScatter([{ x: f.autoRisk != null ? f.autoRisk : 0.5, y: f.glyVar, label: 'this night', col }], {
      xmn: 0,
      xmx: 1,
      ymn: 0,
      ymx: 1,
      xlab: 'autonomic instability →',
      ylab: 'glycemic variability →'
    });

    const concTxt = {
      'concordant-elevated':
        '<b style="color:var(--status-concern)">Concordant — both elevated.</b> ECGDex\'s autonomic instability and GlucoDex\'s glucose variability agree, the stronger cross-node signal neither app sees alone.',
      'concordant-low': '<b style="color:var(--status-ok)">Concordant — both low.</b> Stable autonomics and stable glucose corroborate each other.',
      discordant: '<b style="color:var(--amber)">Discordant.</b> One channel is elevated and the other isn\'t — worth another aligned night before reading into it.',
      'autonomic-input-missing': 'Autonomic input unavailable in this export — showing the glycemic side only.'
    }[f.concordance];

    $('fusionBody').innerHTML = `
    ${!f.nightOverlap ? `<div class="q-note" style="color:var(--amber);border:1px solid rgba(255,184,77,.28);background:rgba(255,184,77,.06);border-radius:8px;padding:10px 13px;margin-bottom:12px">⚠ <b>Different nights.</b> This ECG export and the CGM window don't share a calendar night, so the readout compares <i>typical-night</i> autonomic profile against <i>average</i> glycemic variability — not the same night. Until a Ganglior <b>Integrator</b> timestamp-aligns the two nodes to one night, treat the IR-risk band as directional. It's the single biggest thing to solve for clinical value, and it's a known v1 limitation — not a modelling error.</div>` : `<div class="q-note" style="color:var(--green);border:1px solid rgba(57,217,138,.25);background:rgba(57,217,138,.06);border-radius:8px;padding:10px 13px;margin-bottom:12px">✓ <b>Aligned night.</b> The ECG recording falls inside the CGM window — this compares the same night's autonomic and glycemic signals.</div>`}
    <div class="ch-grid">
      <div>
        <div class="mini-h">${evBadge('IR-risk band')}Autonomic ⟷ Glycemic <span class="mini-sub">ECGDex-predicted instability vs GlucoDex-measured variability</span></div>
        ${scatter}
      </div>
      <div>
        <div class="mini-h">${evBadge('IR-risk band')}Software-only IR-risk readout <span class="mini-sub">no new hardware · directional</span></div>
        <div class="ir-readout">
          <div class="ir-band ${f.irSev}">${f.irBand}<span>insulin-resistance-risk band</span></div>
          ${UI.riskGauge(f.irScore * 100, f.irBand, col)}
          <div class="ir-inputs">CV ${r.cv}% · MAGE ${r.mage == null ? '—' : window.GluDisp.spread(r.mage)} · dawn ${r.dawn.present ? '+' + window.GluDisp.val(r.dawn.medianDelta) : 'none'}${f.autoRisk != null ? ' · autonomic ' + f.autoRisk : ''}</div>
        </div>
      </div>
    </div>
    <div class="gang-summary" style="margin-top:10px">${vec.join('')}</div>
    ${
      f.morph
        ? (
            () => {
              const m = f.morph;
              const rk = { elevated: 'bad', 'qtc-only': 'warn', 'hypo-only': 'warn', clear: 'ok', none: 'neutral' }[m.hypoQtcRisk];
              const rc = { bad: UI.COLORS.red, warn: UI.COLORS.amber, ok: UI.COLORS.green, neutral: UI.COLORS.dim }[rk];
              const qtcCol = m.qtc == null ? UI.COLORS.dim : m.qtcProlonged ? UI.COLORS.red : UI.COLORS.green;
              return `<div class="mini-h" style="margin-top:14px">${evBadge('QTc')}ECG morphology ⟷ glucose <span class="mini-sub">ECGDex 1.1 median-beat delineation · single-lead, directional</span></div>
      <div class="gang-summary">
        <div class="gang-pill" style="border-color:${qtcCol};color:${qtcCol}"><b>QTc ${m.qtc == null ? '—' : m.qtc + ' ms'}</b>${m.qtcMethod ? ' · ' + m.qtcMethod : ''}${m.qtcProlonged ? ' · prolonged' : ''}</div>
        ${m.pr != null ? `<div class="gang-pill">PR <b>${m.pr} ms</b></div>` : ''}
        ${m.qrsDur != null ? `<div class="gang-pill">QRS <b>${m.qrsDur} ms</b></div>` : ''}
        ${m.stLevel != null ? `<div class="gang-pill">ST <b>${m.stLevel > 0 ? '+' : ''}${m.stLevel} µV</b></div>` : ''}
        <div class="gang-pill" style="border-color:${rc};color:${rc}"><b>hypo⟷QTc ${{ elevated: 'ELEVATED', ['qtc-only']: 'QTc watch', ['hypo-only']: 'hypo only', clear: 'clear', none: '—' }[m.hypoQtcRisk]}</b></div>
      </div>
      ${m.hypoQtcRisk === 'elevated' ? `<div class="q-note" style="color:var(--red);border:1px solid rgba(255,107,122,.3);background:rgba(255,107,122,.06);border-radius:8px;padding:10px 13px">🫀 <b>Hypoglycemia ⟷ QTc-prolongation pattern.</b> ${m.hypoQtcNote}</div>` : `<div class="q-note">🫀 <b>Hypoglycemia ⟷ QTc:</b> ${m.hypoQtcNote} Nocturnal hypoglycemia is a recognised QTc-prolonging trigger (sympathoadrenal + hypokalemia) — GlucoDex measures the hypos, ECGDex 1.1 now exports QTc, so the same-night coincidence becomes a cross-node arrhythmic-risk read neither node makes alone.</div>`}
      ${(() => {
        const t = m.qtcTrend,
          tw = m.twa;
        const twaPill = tw
          ? `<div class="gang-pill" style="border-color:${tw.abnormal ? UI.COLORS.red : UI.COLORS.green};color:${tw.abnormal ? UI.COLORS.red : UI.COLORS.green}"><b>TWA ${tw.uv} µV</b>${tw.abnormal ? ' · abnormal' : ''}</div>`
          : '';
        if (t) {
          const pts = t.pairs.map((p, i) => ({ x: i, y: p.qtc }));
          const gpts = t.pairs.map((p, i) => ({ x: i, y: p.glu }));
          const rstr = t.r == null ? '—' : t.r;
          const rsev = t.r == null ? 'neutral' : t.r <= -0.4 ? 'bad' : t.r <= -0.2 ? 'warn' : 'ok';
          return `<div class="mini-h" style="margin-top:12px">${evBadge('QTc')}Nocturnal QTc ⟷ glucose trend <span class="mini-sub">${t.n} epochs aligned · r = ${rstr}</span></div>
            ${twaPill ? `<div class="gang-summary">${twaPill}</div>` : ''}
            ${UI.lineChart(pts, UI.COLORS.red, { W: 680, H: 140, xfmt: (x) => 'e' + (x + 1) })}
            <div class="q-note"><b>Beat-level coupling:</b> QTc ranged ${t.qtcRange[0]}–${t.qtcRange[1]} ms across the night; correlated against same-clock glucose at <b>r = ${rstr}</b> ${t.r != null && t.r <= -0.3 ? '<b style="color:var(--red)">— QTc rises as glucose falls, the beat-level hypoglycemia⟷repolarisation signature.</b>' : '(a strong negative r would mark glucose-driven repolarisation stress).'} ${t.note}</div>`;
        }
        return `<div class="q-note" style="opacity:.85">📈 <b>Per-epoch QTc trend:</b> this ECGDex export carries a single summary median-beat QTc, not a per-epoch series — so the beat-level QTc⟷glucose correlation can't run yet. GlucoDex is ready to consume <code>morphology.qtcTrend[]</code> (or <code>timeseries.epochs[].qtc</code>)${tw ? '' : ' and <code>morphology.twa</code>'} the moment ECGDex 1.2 exports ${tw ? 'it' : 'them'}. ${twaPill ? 'T-wave alternans was present and is shown above.' : 'No T-wave alternans in this export either.'}</div>${twaPill ? `<div class="gang-summary">${twaPill}</div>` : ''}`;
      })()}`;
            }
          )()
        : ''
    }
    <div class="gang-summary">
      <div class="gang-pill" style="border-color:${UI.COLORS.blue}"><b>→ nocturnal_glucose_risk</b> ${f.nocturnalGlucoseRisk}</div>
      <div class="gang-pill" style="border-color:${UI.COLORS.blue}"><b>→ glucose_autonomic_correlation</b> ${f.glucoseAutonomicCorrelation == null ? '—' : f.glucoseAutonomicCorrelation}</div>
      <div class="gang-pill">producer-side · feeds ECGDex reserved slot</div>
    </div>
    <div class="q-note" style="margin-top:10px">${concTxt} ${f.alignNote} The autonomic-risk vector weights the <b>bσ(lnRMSSD) slope</b> highest (Li &amp; Kiyono 2026 — rising overnight instability tracks glucose metabolism, |d|&gt;1.1)${f.slopeRecomputed ? ", here <b>recomputed by regressing this export's per-epoch rMSSD</b> because the scalar was null (short ECG)" : ''}${f.surgeEsc != null || f.coupling != null ? ', corroborated by ' + [f.surgeEsc != null ? 'late-night CVHR surge escalation' : null, f.coupling != null ? 'cardiorespiratory coupling' : null].filter(Boolean).join(' & ') : ''}.
    <b>The handshake is bidirectional:</b> GlucoDex emits <code>nocturnal_glucose_risk</code> and <code>glucose_autonomic_correlation</code> back onto the bus, the exact values a future Integrator drops into ECGDex's reserved <code>glucoseCorrelation</code> slot. <span style="opacity:.7">Directional, not diagnostic — the same honesty bar as ECGDex's est-AHI. No insulin-dosing advice.</span></div>`;
    $('fusionCard').className = 'card';
  }

  function renderGanglior(r) {
    const ev = r.events;
    $('gangCount').textContent = ev.length;
    const byType = (t) => ev.filter((e) => e.impulse === t).length;
    $('gangBody').innerHTML = `
    <div class="gang-summary">
      <div class="gang-pill"><b>${byType('glucose_excursion')}</b> glucose_excursion</div>
      <div class="gang-pill"><b>${byType('dawn_surge')}</b> dawn_surge</div>
      <div class="gang-pill"><b>${byType('nocturnal_hypo')}</b> nocturnal_hypo</div>
      ${r.fusion ? `<div class="gang-pill" style="border-color:${UI.COLORS.blue}"><b>${byType('glucose_autonomic_correlation') + byType('nocturnal_glucose_risk')}</b> fusion</div>` : ''}
      <div class="gang-pill">node <b>GlucoDex</b></div>
    </div>
    <div class="gang-stream">${ev
      .slice(0, 160)
      .map((e) => {
        const cls = e.impulse === 'nocturnal_hypo' || e.impulse === 'hypo_qtc_arrhythmia_risk' ? 'bad' : /correlation|risk/.test(e.impulse) ? 'fusion' : e.impulse === 'dawn_surge' ? 'surge' : '';
        const meta = e.meta
          ? Object.entries(e.meta)
              .filter(([k, v]) => typeof v !== 'object')
              .slice(0, 2)
              .map(([k, v]) => k + ' ' + v)
              .join(' · ')
          : '';
        return `<div class="gang-ev ${cls}"><span class="ge-t">${e.t}</span><span class="ge-imp">${e.impulse}</span><span class="ge-meta">${meta}</span><span class="ge-conf">conf ${e.conf}</span></div>`;
      })
      .join('')}${ev.length > 160 ? `<div class="gang-more">+ ${ev.length - 160} more in JSON export</div>` : ''}</div>
    <div class="q-note">Canonical bus shape: <code>{ "t":"${ev[0] ? ev[0].t : '02:14:31'}", "impulse":"glucose_excursion", "node":"GlucoDex", "conf":${ev[0] ? ev[0].conf : 0.8} }</code>. Glucose values in <code>meta</code> mirror the raw <code>ganglior.node-export</code> — always <b>mg/dL</b>, independent of the display toggle. GlucoDex is both <b>producer</b> (glucose events) and <b>consumer</b> (it ingests ECGDex exports) — the only node in the fleet that closes a bidirectional handshake.</div>`;
    $('gangSection').style.display = 'block';
  }

  function renderTable(r) {
    const f = r.fusion;
    const rows = [
      ['Source', r.source === 'synthetic' ? 'Synthetic CGM (demo)' : 'CGM file', '—', '—', 'neutral', 'One signal in — glucose'],
      ['Tier', r.tierLabel, '—', '—', 'neutral', r.tierMsg],
      ['Active duration', r.durDays.toFixed(1), 'days', '—', 'neutral', r.cadence + '-min cadence'],
      ['Sensor active', r.pctActive, '%', '≥70', r.pctActive >= 70 ? 'ok' : r.pctActive >= 50 ? 'warn' : 'bad', 'AGP validity floor'],
      ['Compression flagged', r.compMin, 'min', '—', r.compMin > 0 ? 'warn' : 'ok', 'Positional nocturnal artifact · held out of TBR'],
      ['Data confidence', r.dataQualityConf, '×', '≥0.85', r.dqLabel === 'high' ? 'ok' : r.dqLabel === 'moderate' ? 'warn' : 'bad', 'Scales stability-score interpretation'],
      ['Readings', r.nReadings, '—', '—', 'neutral', 'Raw CGM samples ingested'],
      ['— Core glycemic —', '', '', '', 'neutral', 'consensus 2019 ranges'],
      ['Mean glucose', window.GluDisp.val(r.mean), window.GluDisp.label(), window.GluDisp.cmp('<', 154), r.mean < 140 ? 'ok' : r.mean < 160 ? 'warn' : 'bad', 'Average sensor glucose'],
      ['GMI', r.gmi, '%', '<6.0', r.gmi < 6 ? 'ok' : r.gmi < 6.5 ? 'warn' : 'bad', '3.31 + 0.02392·mean — lab-A1c PROXY, not A1c'],
      ['Est. HbA1c', r.ea1c, '%', '<6.0', r.ea1c < 6 ? 'ok' : r.ea1c < 6.5 ? 'warn' : 'bad', '(mean+46.7)/28.7 ADAG — differs from GMI'],
      ['SD', window.GluDisp.spread(r.sd), window.GluDisp.label(), '—', r.sd < 50 ? 'ok' : 'warn', 'Standard deviation'],
      ['CV', r.cv, '%', '<36', r.cv < 36 ? 'ok' : r.cv < 42 ? 'warn' : 'bad', 'SD/mean — stability threshold'],
      ['TIR 70–180', r.tir.tir, '%', '>70', sevTIR(r.tir.tir), 'Time in target range'],
      ['TITR 70–140', r.titr, '%', '—', r.titr >= 50 ? 'ok' : r.titr >= 30 ? 'warn' : 'bad', 'Time in tight range (2023 consensus)'],
      ['TBR 54–69', r.tir.tbr1, '%', '<4', r.tir.tbr1 < 3 ? 'ok' : r.tir.tbr1 < 5 ? 'warn' : 'bad', 'Time below range (low)'],
      ['TBR <54', r.tir.tbr2, '%', '<1', r.tir.tbr2 < 1 ? 'ok' : 'bad', 'Time below range (very low)'],
      ['TAR 181–250', r.tir.tar1, '%', '<25', r.tir.tar1 < 25 ? 'ok' : 'warn', 'Time above range (high)'],
      ['TAR >250', r.tir.tar2, '%', '<5', r.tir.tar2 < 5 ? 'ok' : 'bad', 'Time above range (very high)'],
      ['— Variability —', '', '', '', 'neutral', 'full series, not decimated'],
      [
        'MAGE',
        r.mage == null ? '—' : window.GluDisp.spread(r.mage),
        window.GluDisp.label(),
        '—',
        r.mage == null ? 'neutral' : r.mage < 60 ? 'ok' : r.mage < 100 ? 'warn' : 'bad',
        'Mean amplitude of excursions >1 SD'
      ],
      ['CONGA-1h', r.conga1 == null ? '—' : window.GluDisp.spread(r.conga1), window.GluDisp.label(), '—', 'neutral', 'SD of 1-h differences'],
      ['CONGA-2h', r.conga2 == null ? '—' : window.GluDisp.spread(r.conga2), window.GluDisp.label(), '—', 'neutral', 'SD of 2-h differences'],
      ['CONGA-4h', r.conga4 == null ? '—' : window.GluDisp.spread(r.conga4), window.GluDisp.label(), '—', 'neutral', 'SD of 4-h differences'],
      ['MODD', r.modd == null ? '—' : window.GluDisp.spread(r.modd), window.GluDisp.label(), '—', r.modd == null ? 'neutral' : r.modd < 40 ? 'ok' : 'warn', 'Mean of daily differences (needs ≥2 d)'],
      ['GVP', r.gvp == null ? '—' : r.gvp, '%', '—', r.gvp == null ? 'neutral' : r.gvp < 20 ? 'ok' : r.gvp < 35 ? 'warn' : 'bad', 'Glucose variability percentage'],
      ...(r.daypart
        ? [
            [
              'CV · overnight',
              r.daypart.overnight.cv == null ? '—' : r.daypart.overnight.cv,
              '%',
              '<36',
              r.daypart.overnight.cv == null ? 'neutral' : r.daypart.overnight.cv < 36 ? 'ok' : 'warn',
              '00–06h'
            ],
            ['CV · morning', r.daypart.morning.cv == null ? '—' : r.daypart.morning.cv, '%', '<36', r.daypart.morning.cv == null ? 'neutral' : r.daypart.morning.cv < 36 ? 'ok' : 'warn', '06–12h'],
            [
              'CV · afternoon',
              r.daypart.afternoon.cv == null ? '—' : r.daypart.afternoon.cv,
              '%',
              '<36',
              r.daypart.afternoon.cv == null ? 'neutral' : r.daypart.afternoon.cv < 36 ? 'ok' : 'warn',
              '12–18h'
            ],
            ['CV · evening', r.daypart.evening.cv == null ? '—' : r.daypart.evening.cv, '%', '<36', r.daypart.evening.cv == null ? 'neutral' : r.daypart.evening.cv < 36 ? 'ok' : 'warn', '18–24h']
          ]
        : []),
      ['J-index', r.jIndex, '—', '<30', r.jIndex < 30 ? 'ok' : r.jIndex < 45 ? 'warn' : 'bad', '0.001·(mean+SD)²'],
      [
        'MAG',
        r.magRate == null ? '—' : window.GluDisp.spread(r.magRate),
        window.GluDisp.label() + '/h',
        '—',
        r.magRate == null ? 'neutral' : r.magRate < 30 ? 'ok' : r.magRate < 55 ? 'warn' : 'bad',
        'Mean absolute glucose rate of change'
      ],
      ['GRADE', r.grade ? r.grade.score : '—', '—', '<5', r.grade == null ? 'neutral' : r.grade.score < 5 ? 'ok' : r.grade.score < 10 ? 'warn' : 'bad', 'Glycaemic risk score (Hill 2007)'],
      ['ADRR', r.adrr == null ? '—' : r.adrr, '—', '<20', r.adrr == null ? 'neutral' : r.adrr < 20 ? 'ok' : r.adrr < 40 ? 'warn' : 'bad', 'Average daily risk range (needs ≥2 d)'],
      ['LBGI', r.lbgi, '—', '<2.5', r.lbgi < 2.5 ? 'ok' : r.lbgi < 5 ? 'warn' : 'bad', 'Kovatchev low-BG index'],
      ['HBGI', r.hbgi, '—', '<4.5', r.hbgi < 4.5 ? 'ok' : r.hbgi < 9 ? 'warn' : 'bad', 'Kovatchev high-BG index'],
      ['— Patterns —', '', '', '', 'neutral', 'event-level → Ganglior'],
      [
        'Dawn phenomenon',
        r.dawn.present ? 'Present' : r.dawn.days && r.dawn.days.length ? 'Not flagged' : '—',
        r.dawn.medianDelta != null ? '+' + window.GluDisp.val(r.dawn.medianDelta) + ' ' + window.GluDisp.label() : '—',
        '≥20 flags',
        r.dawn.present ? 'warn' : 'ok',
        'Nadir(03–06h)→pre-breakfast rise'
      ],
      ['Nocturnal hypos', r.nocturnalHypo.length, 'episodes', '0', r.nocturnalHypo.length ? 'bad' : 'ok', '00:00–06:00 ≥15 min <70'],
      ['Excursions', r.excursions.length, 'events', '—', 'neutral', 'Slope-detected · unannotated'],
      ['— Personalised —', '', '', '', 'neutral', 'vs profile (age ' + (r.profile ? r.profile.age : '—') + ' · ' + (r.profile ? r.profile.diab : '—') + ')'],
      ['Stability score', r.stabilityScore, '0–100', '≥65', r.stabilityScore >= 65 ? 'ok' : r.stabilityScore >= 50 ? 'warn' : 'bad', 'TIR + CV + hypo composite'],
      /* Metabolic age row REMOVED 2026-06-21 (external-review WP-A) */
      ...(r.gmiCheck
        ? [
            [
              'GMI vs lab A1c',
              (r.gmiCheck.delta > 0 ? '+' : '') + r.gmiCheck.delta,
              '%',
              '±0.5',
              r.gmiCheck.agree ? 'ok' : 'warn',
              'GMI ' + r.gmi + ' vs your lab ' + r.gmiCheck.lab + ' — they measure differently'
            ]
          ]
        : []),
      ...(r.calib
        ? [
            [
              'Sensor bias vs lab A1c',
              (r.calib.bias > 0 ? '+' : '') + window.GluDisp.delta(r.calib.bias),
              window.GluDisp.label(),
              '±' + window.GluDisp.spread(8),
              r.calib.magnitude === 'small' ? 'ok' : 'warn',
              'sensor mean ' +
                r.calib.sensorMean +
                ' vs lab-implied eAG ' +
                r.calib.labEAG +
                (r.calib.applied ? ' · CALIBRATION APPLIED (' + (r.calib.appliedOffset > 0 ? '+' : '') + r.calib.appliedOffset + ')' : '')
            ]
          ]
        : []),
      ...(r.postprandial
        ? [
            ['— Postprandial —', '', '', '', 'neutral', 'per meal marker · ' + r.postprandial.length + ' meals'],
            ...r.postprandial.map((m) => [
              'PPGR · ' + m.label,
              '+' + window.GluDisp.val(m.peakDelta),
              window.GluDisp.label() + ' peak',
              '—',
              m.peakDelta < 40 ? 'ok' : m.peakDelta < 70 ? 'warn' : 'bad',
              'peak @' + m.timeToPeakMin + 'min · +2h Δ' + (m.delta2h > 0 ? '+' : '') + m.delta2h + ' · returned ' + m.returnedPct + '% of ' + m.nDays + 'd'
            ])
          ]
        : []),
      ...(f
        ? [
            ['— Fusion (ECGDex) —', '', '', '', 'neutral', f.alignNote],
            [
              'Autonomic risk',
              f.autoRisk == null ? '—' : f.autoRisk,
              '0–1',
              '—',
              f.autoRisk == null ? 'neutral' : f.autoRisk < 0.45 ? 'ok' : f.autoRisk < 0.6 ? 'warn' : 'bad',
              'slope' + (f.slopeRecomputed ? '(recomputed)' : '') + ' + surge + coupling'
            ],
            ['bσ(lnRMSSD) slope', f.slope == null ? '—' : f.slope, '/h', '≤0', f.slope == null ? 'neutral' : f.slope <= 0 ? 'ok' : 'warn', 'Li/Kiyono headline signal'],
            ['Glycemic variability', f.glyVar, '0–1', '—', f.glyVar < 0.35 ? 'ok' : f.glyVar < 0.5 ? 'warn' : 'bad', 'CV+MAGE+dawn composite'],
            ['IR-risk band', f.irBand, '—', 'Lower', f.irSev, 'Directional insulin-resistance risk'],
            ...(f.morph && f.morph.qtc != null
              ? [
                  ['QTc (ECGDex)', f.morph.qtc, 'ms', r.profile && r.profile.sex === 'F' ? '<460' : '<450', f.morph.qtcProlonged ? 'warn' : 'ok', f.morph.qtcMethod + ' · single-lead median beat'],
                  [
                    'Hypo⟷QTc risk',
                    { elevated: 'Elevated', 'qtc-only': 'QTc watch', 'hypo-only': 'Hypo only', clear: 'Clear', none: '—' }[f.morph.hypoQtcRisk],
                    '—',
                    'Clear',
                    f.morph.hypoQtcRisk === 'elevated' ? 'bad' : f.morph.hypoQtcRisk === 'clear' ? 'ok' : 'warn',
                    'Nocturnal hypo + prolonged QTc = dead-in-bed pattern'
                  ]
                ]
              : []),
            ['→ nocturnal_glucose_risk', f.nocturnalGlucoseRisk, '0–1', '—', 'neutral', 'Producer-side · for ECGDex reserved slot'],
            ['→ glucose_autonomic_correlation', f.glucoseAutonomicCorrelation == null ? '—' : f.glucoseAutonomicCorrelation, '−1..1', '—', 'neutral', 'Producer-side handshake value']
          ]
        : [])
    ];
    window.__summaryRows = rows; // structured source for the tidy CSV export (not a DOM scrape)
    $('tblBody').innerHTML = rows
      .map(
        ([m, v, u, nr, s, n]) => `<tr>
    <td class="fmt-m" style="color:var(--text2);font-weight:600;font-family:Inter,sans-serif">${evBadge(m)}${m}</td>
    <td class="${s}">${v}</td><td style="color:var(--text3)">${u}</td><td style="color:var(--text3)">${nr}</td>
    <td class="${s}">${{ ok: '✅ Good', warn: '⚠️ Watch', bad: '❌ Concern', neutral: '—' }[s] || s}</td>
    <td style="color:var(--text3);font-family:Inter,sans-serif;font-size:10px">${n}</td></tr>`
      )
      .join('');
    $('tblWrap').classList.add('show');
    $('slTbl').style.display = 'flex';
  }

  // ════════════════════════════════════════════════════════════════════════
  //  EXPORTS
  // ════════════════════════════════════════════════════════════════════════
  function dl(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8;' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ── CSV toolkit (mirrored; null≠0, RFC-4180, Excel-safe) ──
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    v = String(v);
    if (v && '=+-@\t\r'.indexOf(v[0]) !== -1) v = '\t' + v;
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csvDoc(rows) {
    return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function csvClean(t) {
    const s = String(t == null ? '' : t)
      .replace(/[\u2191\u2193\u2192\u2197\u2198\u2B06\u2B07]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s === '' || s === '—' || s === '–' || /^n\/?a$/i.test(s) ? '' : s;
  }

  function exportCleanCSV() {
    if (!RESULT) return;
    const r = RESULT,
      s = r.series;
    const fnames = { 0: 'ok', 1: 'warmup', 2: 'gap-interp', 3: 'compression' };
    const rows = [['timestamp', 'glucose_mgdl', 'flag']];
    // missing reading → blank, NOT Math.round(null)=0 (that would fabricate a real-looking value)
    for (let i = 0; i < s.N; i++) {
      const g = s.gV[i];
      rows.push([new Date(s.gT[i]).toISOString(), g == null || !isFinite(g) ? '' : Math.round(g), fnames[s.gF[i]] || 'ok']);
    }
    dl(csvDoc(rows), 'glucodex_cleaned_' + new Date(r.t0Ms).toISOString().slice(0, 10) + '.csv', 'text/csv');
    showOK('Cleaned series exported (' + s.N.toLocaleString() + ' rows · warm-up/gap/compression flagged).');
  }

  function exportJSON() {
    if (!RESULT) return;
    const r = RESULT,
      p = r.profile || {},
      f = r.fusion;
    const out = {
      kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
      schema: {
        name: 'ganglior.node-export',
        version: '2.0',
        node: 'GlucoDex',
        nodeVersion: '1.0',
        generated: new Date().toISOString(),
        provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null, // R1: build + input fingerprints
        doc: 'Single-signal CGM analyzer export. All metrics computed in-browser from the CGM file only (nothing leaves the device). null = not computed at this recording length/quality. `timeseries` per-hour/day aggregates are the cross-node currency; `fusion` carries BOTH the ECGDex-correlation results and the producer-side values GlucoDex feeds back to the bus.',
        units: { glucose: 'mg/dL', gmi: '%', a1c: '%', cv: '%', tir: '%', mage: 'mg/dL', conga: 'mg/dL', modd: 'mg/dL', gvp: '%', time: 'min', age: 'yr', slope: 'ln-units/h', conf: '0..1' }
      },
      recording: {
        source: r.source,
        unit: 'mg/dL (normalised internally)',
        sourceUnit: r.unit,
        cadenceMin: r.cadence,
        startEpochMs: r.t0Ms,
        durationDaysActive: r.durDays,
        spanMin: r.spanMin,
        activeMin: r.activeMin,
        tier: r.tier,
        tierNote: r.tierMsg,
        readings: r.nReadings,
        longRecording: r.longRec
      },
      quality: {
        sensorActivePct: r.pctActive,
        gaps: r.nGaps,
        gapMin: r.gapMin,
        warmupMinSuppressed: r.warmupMin,
        compressionLowMin: r.compMin,
        dataQualityConfidence: r.dataQualityConf,
        dataQualityLabel: r.dqLabel,
        sensorSessions: (r.sessions || []).map((s) => ({ idx: s.idx, startEpochMs: s.startMs, days: s.days, median: s.median, mean: s.mean, driftMgdlPerDay: s.driftPerDay })),
        sessionCount: r.nSessions,
        sessionCorrections: {
          leveled: r.sessionCorr && r.sessionCorr.leveled,
          deDrifted: r.sessionCorr && r.sessionCorr.deDrifted,
          offsetsMgdl: r.sessionCorr ? r.sessionCorr.offsets : [],
          globalMedian: r.sessionCorr ? r.sessionCorr.globalMedian : null,
          note: 'leveling aligns each wear median to the global median (between-sensor step removal); de-drift removes the within-wear linear trend (experimental). Both reference-free, off unless enabled.'
        },
        note: 'sensorActivePct = analyzable cells ÷ timeline. Warm-up suppressed; gaps interpolated+greyed; compression lows (sustained nocturnal dip with bracketing recovery — positional artifact) flagged & held out of TBR/LBGI/hypo so they do not inflate them. AGP needs ≥70%. dataQualityConfidence scales the stability-score interpretation.',
        compressionDetector: 'night-hours sustained low ≥25 min, both 2-h shoulders euglycemic (>95/>92) and dip >32 mg/dL below them with fast bilateral recovery',
        agpValid: r.pctActive >= 70
      },
      glycemic: {
        mean: r.mean,
        gmi: r.gmi,
        estA1c: r.ea1c,
        sd: r.sd,
        cv: r.cv,
        median: r.median,
        p10: r.p10,
        p25: r.p25,
        p75: r.p75,
        p90: r.p90,
        min: r.min,
        max: r.max,
        timeInRanges: { tbr2_under54: r.tir.tbr2, tbr1_54to69: r.tir.tbr1, tir_70to180: r.tir.tir, tar1_181to250: r.tir.tar1, tar2_over250: r.tir.tar2 },
        timeInTightRange_70to140: r.titr,
        formulas: { gmi: '3.31 + 0.02392·meanMgdl', estA1c: '(meanMgdl + 46.7) / 28.7', cv: 'SD/mean·100' },
        thresholds: {
          veryLow: 54,
          low: 70,
          high: 180,
          veryHigh: 250,
          cvStablePct: 36,
          tirGoalPct: 70,
          tbrGoalPct: r.hypoGoal,
          note: 'mg/dL · consensus 2019. tbrGoal tightens to 4% on insulin therapy.'
        },
        labels: { gmi: 'GMI is a lab-A1c PROXY, NOT your A1c. estA1c (ADAG) and GMI use different formulas and will differ.' }
      },
      variability: {
        mage: r.mage,
        conga1h: r.conga1,
        conga2h: r.conga2,
        conga4h: r.conga4,
        modd: r.modd,
        gvp: r.gvp,
        jIndex: r.jIndex,
        lbgi: r.lbgi,
        hbgi: r.hbgi,
        mag: r.magRate,
        grade: r.grade ? { score: r.grade.score, hypoPct: r.grade.hypoPct, euPct: r.grade.euPct, hyperPct: r.grade.hyperPct } : null,
        adrr: r.adrr,
        byDaypart: r.daypart
          ? {
              totalCV: r.daypart.total,
              overnightCV: r.daypart.overnight.cv,
              morningCV: r.daypart.morning.cv,
              afternoonCV: r.daypart.afternoon.cv,
              eveningCV: r.daypart.evening.cv,
              windows: r.daypart.windows,
              note: 'CV localised to time-of-day — where the swings live'
            }
          : null,
        formulas: {
          jIndex: '0.001·(mean+SD)²',
          lbgi: 'mean(10·f² for f<0), f=1.509·(ln(BG)^1.084 − 5.381)',
          hbgi: 'mean(10·f² for f>0)',
          gvp: '(traceLength/flatLength − 1)·100',
          mag: 'Σ|ΔBG| / hours',
          grade: 'mean of 425·(log10(log10(BG_mmol))+0.16)², capped 50',
          adrr: 'mean over days of (LRmax+HRmax) in Kovatchev risk space'
        },
        note: 'MODD/ADRR null if <2 days. All on the full cleaned series — decimation is render-only.'
      },
      patterns: {
        dawnPhenomenon: {
          present: r.dawn.present,
          medianRiseMgdl: r.dawn.medianDelta ?? null,
          nDays: r.dawn.nDays ?? 0,
          perDay: r.dawn.days || [],
          flagThresholdMgdl: 20,
          note: 'nadir(03–06h)→pre-breakfast(06–08h)'
        },
        nocturnalHypos: r.nocturnalHypo,
        excursions: r.excursions,
        mealMarkers:
          r.mealMarkers && r.mealMarkers.length
            ? r.mealMarkers.map((m) => ({ timeOfDay: ('0' + Math.floor(m.minOfDay / 60)).slice(-2) + ':' + ('0' + (m.minOfDay % 60)).slice(-2), category: m.category, label: m.label }))
            : null,
        postprandial: r.postprandial
          ? r.postprandial.map((m) => ({
              label: m.label,
              category: m.category,
              nDays: m.nDays,
              baselineMgdl: m.baseline,
              peakDeltaMgdl: m.peakDelta,
              timeToPeakMin: m.timeToPeakMin,
              delta2hMgdl: m.delta2h,
              returnedToBaselinePct: m.returnedPct
            }))
          : null,
        ppgrNote: 'per meal marker: 30-min pre-meal baseline, peak rise, time-to-peak, +2 h delta, % of days returned to baseline within 3 h',
        note:
          r.mealMarkers && r.mealMarkers.length
            ? 'Excursions tagged against user meal markers (−20→+75 min window); annotated=true carries the meal label/category.'
            : 'No meal markers set — excursions are slope-detected & labelled unannotated.'
      },
      // DEEP-AUDIT §19 — age/sex/diabetesStatus/therapy could never be null: the population default
      // (45 y · M · 'none' · 'none') shipped as though the user had stated it. Only what was actually
      // entered survives into `profile`; the priors COMPUTE used move to `assumedDefaults`, labelled.
      personalization: {
        profile: (function () {
          var o = p._origins || null;
          var ent = function (f, v) {
            return o && (o[f] === 'you' || o[f] === 'detected') ? v : null;
          };
          return {
            age: ent('age', p.age),
            sex: ent('sex', p.sex),
            diabetesStatus: ent('diabetes', p.diab),
            therapy: ent('dxTherapy', p.therapy),
            targetRangeMgdl: [r.tgtLo, r.tgtHi],
            labA1cGroundTruth: p.a1c && p.a1c > 0 ? p.a1c : null,
            note: 'fields the user set in the profile panel; null = default/auto'
          };
        })(),
        assumedDefaults: (function () {
          var o = p._origins || null;
          var asm = function (f, v) {
            return o && (o[f] === 'you' || o[f] === 'detected') ? null : v;
          };
          return {
            age: asm('age', p.age),
            sex: asm('sex', p.sex),
            diabetesStatus: asm('diabetes', p.diab),
            therapy: asm('dxTherapy', p.therapy),
            source: 'population norm / code default — the value the analysis ran on',
            note: 'NOT a statement by this user. A null diabetesStatus here means they did tell us.'
          };
        })(),
        glycemicStabilityScore: r.stabilityScore,
        dataQualityConfidence: r.dataQualityConf,
        stabilityScoreFormula:
          'clamp(0.55·TIR + 0.45·cvScore − min(28, hypoTBR·5)); cvScore=clamp(100−(CV−25)·3); hypoTBR excludes flagged compression artifacts. Read alongside dataQualityConfidence.',
        metabolicAge: null /* Metabolic Age REMOVED 2026-06-21 (external-review WP-A); key kept null for node-export back-compat. */,
        gmiVsLabA1c: r.gmiCheck
          ? { gmi: r.gmiCheck.gmi, labA1c: r.gmiCheck.lab, deltaPct: r.gmiCheck.delta, agree: r.gmiCheck.agree, note: 'validates the GMI proxy against the user lab value' }
          : null,
        sensorBiasCalibration: r.calib
          ? {
              labImpliedEAG: r.calib.labEAG,
              sensorMean: r.calib.sensorMean,
              biasMgdl: r.calib.bias,
              applied: r.calib.applied,
              appliedOffsetMgdl: r.calib.appliedOffset,
              magnitude: r.calib.magnitude,
              formula: 'eAG = 28.7·labA1c − 46.7 (ADAG); bias = eAG − sensorMean; when applied, every reading is shifted by bias',
              note: 'optional. Corrects a systematically low/high sensor against lab ground truth. +bias ⇒ sensor reads low. Informational; all metrics here reflect the corrected trace when applied.'
            }
          : null
      },
      fusion: f
        ? {
            ecgInputs: {
              usedSlopeScalar: f.inputs.usedSlope && !f.slopeRecomputed,
              slopeRecomputedFromEpochs: f.slopeRecomputed,
              sigma_lnRMSSD_slope: f.slope,
              surgeEscalationPct: f.surgeEsc,
              couplingStrength: f.coupling,
              cvhrIndex: f.cvhrIdx,
              nEpochsRegressed: f.inputs.nEpochs
            },
            autonomicRiskVector: {
              score: f.autoRisk,
              slopeRisk: f.slopeRisk,
              surgeRisk: f.surgeRisk,
              couplingRisk: f.couplingRisk,
              weights: { slope: 0.6, surgeEscalation: 0.2, couplingInverse: 0.2 },
              note: 'slope weighted highest (Li & Kiyono 2026); others corroborate. Renormalised over available inputs.'
            },
            glycemicVariabilityScore: f.glyVar,
            morphology: f.morph
              ? {
                  qtcMs: f.morph.qtc,
                  qtcMethod: f.morph.qtcMethod,
                  qtcProlonged: f.morph.qtcProlonged,
                  qtcThresholds: { borderline: f.morph.qtcBorderline, prolonged: f.morph.qtcLong, note: 'sex-specific consensus; single-lead median-beat estimate, directional' },
                  prMs: f.morph.pr,
                  qrsDurMs: f.morph.qrsDur,
                  stLevelUv: f.morph.stLevel,
                  hypoQtcRisk: f.morph.hypoQtcRisk,
                  nocturnalHypos: f.morph.nNocturnalHypo,
                  nadirMgdl: f.morph.minNightGlucose,
                  qtcGlucoseTrend: f.morph.qtcTrend ? { nEpochs: f.morph.qtcTrend.n, pearsonR: f.morph.qtcTrend.r, qtcRangeMs: f.morph.qtcTrend.qtcRange, note: f.morph.qtcTrend.note } : null,
                  tWaveAlternans: f.morph.twa ? { uv: f.morph.twa.uv, abnormal: f.morph.twa.abnormal, note: f.morph.twa.note } : null,
                  trendAvailable: !!f.morph.trendAvailable,
                  twaAvailable: !!f.morph.twaAvailable,
                  consumerNote: 'GlucoDex consumes morphology.qtcTrend[] / timeseries.epochs[].qtc / morphology.twa when ECGDex exports them; falls back to summary QTc otherwise.',
                  note: 'Consumes ECGDex 1.1 morphology.intervals. hypoQtcRisk=elevated when nocturnal hypoglycemia coincides with prolonged QTc (the dead-in-bed arrhythmic pattern). Directional, single-lead ≠ 12-lead.'
                }
              : null,
            irRisk: {
              band: f.irBand,
              score: f.irScore,
              formula: '0.45·autonomicRisk + 0.55·glycemicVariability',
              note: 'directional insulin-resistance-risk band, recalibrated bands — NOT a diagnosis, no dosing advice'
            },
            concordance: f.concordance,
            nightOverlap: f.nightOverlap,
            alignment: f.alignNote,
            nightCV: f.nightCV,
            producerSide: {
              nocturnalGlucoseRisk: f.nocturnalGlucoseRisk,
              glucoseAutonomicCorrelation: f.glucoseAutonomicCorrelation,
              note: 'GlucoDex feeds these back to the bus — a future Integrator drops glucoseAutonomicCorrelation into ECGDex reserved.glucoseCorrelation (the §5 handshake).'
            },
            refs: { dynamicHRVglucose: 'Li & Kiyono 2026 Sensors 26(4):1118 [CC BY 4.0]' }
          }
        : {
            available: false,
            note: 'No ECGDex export present at analysis time — single-node CGM run. Cross-signal autonomic⟷glycemic fusion (IR-risk, hypo-QTc) is computed by the Integrator when an overlapping ECGDex night is also loaded; this is not missing computation.'
          },
      timeseries: {
        doc: 'Per-hour AGP percentiles + per-day rollups + per-cell trace. cells[] makes this continuous node SLICEABLE: a consumer (the Integrator) recomputes glycemic metrics on any sub-window (e.g. a same-night ECG/Oxy overlap) without GlucoDex ever pre-segmenting into nights. One signal, one codex — windowing lives at the fusion layer.',
        cadenceMin: r.cadence,
        t0Ms: r.t0Ms,
        unit: 'mg/dL',
        cells: (function () {
          const s = r.series;
          if (!s || !s.N) return [];
          const W = s.FLAG ? s.FLAG.WARMUP : 1;
          const out = [];
          for (let i = 0; i < s.N; i++) {
            if (s.gF[i] === W) continue; // skip warm-up garbage; keep OK/GAP/COMPRESSION (consumer holds COMPRESSION out of stats)
            out.push({ tMs: s.gT[i], v: Math.round(s.gV[i]), f: s.gF[i] });
          } // absolute floating tMs straight from r.series.gT[i]
          return out;
        })(),
        cellsNote:
          'ONE entry per cell in time order; WARMUP cells dropped. tMs = absolute floating wall-clock ms (NOT reconstructed from a string); v = mg/dL; f = clean flag (0 OK · 2 gap-interp · 3 compression-low). Native cadence — no downsampling.',
        agpHourly: r.hourly,
        perDay: r.daily
      },
      nutrition: r.nutrition
        ? {
            matchedDays: r.nutrition.matchedDays,
            carbsField: r.nutrition.carbsKey,
            correlations: r.nutrition.corr || null,
            perDay: r.nutrition.matched
              ? r.nutrition.matched.map((m) => ({ date: m.date, netCarbs: m.netCarbs, carbs: m.carbs, sugars: m.sugars, fiber: m.fiber, energy: m.energy, glucoseMean: m.mean, tir: m.tir, cv: m.cv }))
              : null,
            source: 'Cronometer (date-matched)',
            note: r.nutrition.note || 'Pearson r across shared days; directional, n small, day-totals miss meal timing. Confounded by activity/sleep/stress.'
          }
        : null,
      ganglior_events: r.events,
      reserved: {
        doc: 'Fields awaiting other fleet nodes; null until available.',
        autonomicInstabilitySlope: f ? f.slope : null,
        autonomicSource: 'ECGDex',
        desatCorrelation: null,
        desatSource: 'OxyDex',
        mealMarkers: null,
        mealSource: 'Integrator (v1 has no food log)'
      }
    };
    dl(JSON.stringify(out, null, 2), exportName({ node: 'GlucoDex', t0Ms: r.t0Ms, kind: 'summary', ext: 'json' }), 'application/json;charset=utf-8');
    showOK('Exported AI-readable JSON (all metrics + schema/units/thresholds/weights/formulas' + (f ? ' + fusion handshake' : '') + ').');
  }
  // Export download FILENAMES come from the shared dex-export.js exportName() — recording-anchored
  // (RESULT.t0Ms via getUTC*), viewer-TZ-independent, controlled-vocab (EXPORT-HYGIENE §2); the old
  // local-clock _exportTs() (export-click wall-clock, TZ-dependent) is DELETED (EXPORT-HYGIENE-FOLLOWUPS §1).
  // Tidy summary CSV from the structured table rows: Value is a pure number column, Unit is its
  // own column (no fusing), Status is plain text (no emoji), section dividers marked, missing→blank.
  function _summaryCSV() {
    const rows = window.__summaryRows || [];
    const STAT = { ok: 'Good', warn: 'Watch', bad: 'Concern', neutral: '' };
    const dash = (x) => (x === '—' || x === '–' || x == null ? '' : x);
    const tier = (label) => {
      try {
        const R = window.GlucoRegistry;
        if (!R || !R.idForLabel) return '';
        const id = R.idForLabel(label);
        return (id && R.REGISTRY[id] && R.REGISTRY[id].evidence) || '';
      } catch (e) {
        return '';
      }
    };
    const out = [['Metric', 'Value', 'Unit', 'Normal Range', 'Status', 'Evidence', 'Notes']];
    rows.forEach((row) => {
      const metric = String(row[0] == null ? '' : row[0])
        .replace(/^[\s—–]+|[\s—–]+$/g, '')
        .trim();
      const isSection = (row[1] === '' || row[1] == null) && (row[2] === '' || row[2] == null);
      out.push(
        isSection ? [metric, '', '', '', '(section)', '', ''] : [metric, dash(row[1]), dash(row[2]), dash(row[3]), STAT[row[4]] !== undefined ? STAT[row[4]] : dash(row[4]), tier(row[0]), dash(row[5])]
      );
    });
    return csvDoc(out);
  }
  function exportSummaryCSV() {
    if (!RESULT) return;
    dl(_summaryCSV(), exportName({ node: 'GlucoDex', t0Ms: RESULT.t0Ms, kind: 'summary', ext: 'csv' }), 'text/csv');
    showOK('Summary CSV exported (tidy: metric · value · unit · range · status · notes).');
  }
  function exportGanglior() {
    if (!RESULT) return;
    const r = RESULT;
    // ONE shared builder (glucodex-dsp.js) — same node-export compute() emits, so the
    // app stream and the headless/Unifier export stay byte-identical (brief §1B parity).
    const out = (window.GlucoDex || window.GLUDSP).buildNodeExport(r, {
      kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
      provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null
    });
    dl(JSON.stringify(out, null, 2), exportName({ node: 'GlucoDex', t0Ms: r.t0Ms, kind: 'ganglior', ext: 'json' }), 'application/json;charset=utf-8');
    showOK('Ganglior event stream exported (' + (r.events ? r.events.length : 0) + ' events).');
  }
  function copyTable() {
    const rows = document.querySelectorAll('#tblWrap table tr');
    const txt = [...rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join('\t')).join('\n');
    navigator.clipboard.writeText(txt).then(() => showOK('Metrics table copied.'));
  }

  function resetAll() {
    document.body.classList.remove('has-data');
    RESULT = null;
    ECGJSON = null;
    FUSION = null;
    ['scopeSection', 'qualitySection', 'agpSection', 'variSection', 'patternsSection', 'ppgrSection', 'dailySection', 'gangSection'].forEach((id) => {
      const e = $(id);
      if (e) e.style.display = 'none';
    });
    $('fusionResult').style.display = 'none';
    $('fusionEmpty').style.display = 'block';
    ['slKPI', 'slTbl'].forEach((id) => ($(id).style.display = 'none'));
    $('kpiGrid').classList.remove('show');
    $('kpiGrid').innerHTML = '';
    $('tblWrap').classList.remove('show');
    $('tblBody').innerHTML = '';
    $('ctxBanner').style.display = 'none';
    $('exportBar').classList.remove('show');
    $('sidebarDataCard').style.display = 'none';
    $('gluChip').classList.remove('show');
    $('mealCard').style.display = 'none';
    LASTPARSED = null;
    NUTRITION = null;
    CORR = { levelSessions: false, deDrift: false };
    {
      const ns = $('nutStatus');
      if (ns) {
        ns.textContent = 'No nutrition log';
        ns.classList.remove('ok');
      }
      $('nutLoad').classList.remove('loaded');
    }
    {
      const sec = $('nutSection');
      if (sec) sec.style.display = 'none';
    }
    {
      const sc = $('sessionCard');
      if (sc) sc.style.display = 'none';
    }
    const st = $('ecgJsonStatus');
    if (st) {
      st.textContent = 'No ECGDex JSON';
      st.classList.remove('ok');
    }
    $('ecgJsonLoad').classList.remove('loaded');
    if (window.GLUProfile) window.GLUProfile.hide();
    $('aInfo').classList.add('show');
    clearAlertsExceptInfo();
  }
  function reRenderProfile() {
    if (!RESULT) return;
    if (LASTPARSED) {
      reanalyzeMeals(true);
      return;
    }
    if (window.GLUProfile) window.GLUProfile.render(RESULT);
    renderKPI(RESULT);
    if (RESULT.fusion) renderFusion(RESULT);
    renderTable(RESULT);
  }

  // ── meal markers ───────────────────────────────────────────────────────────────
  function minOfDay(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
  function fmtMin(mod) {
    return String(Math.floor(mod / 60)).padStart(2, '0') + ':' + String(mod % 60).padStart(2, '0');
  }
  function renderMealList() {
    const el = $('mealList');
    if (!el) return;
    MEALS.sort((a, b) => a.minOfDay - b.minOfDay);
    el.innerHTML = MEALS.map(
      (m, i) =>
        `<div class="meal-row"><span class="mr-time">${fmtMin(m.minOfDay)}</span><span class="mr-cat ${m.category}">${m.category}</span><span class="mr-label">${m.label || '(meal)'}</span><button class="mr-del" data-i="${i}" title="remove">✕</button></div>`
    ).join('');
    el.querySelectorAll('.mr-del').forEach((b) =>
      b.addEventListener('click', () => {
        MEALS.splice(+b.dataset.i, 1);
        saveMeals();
        renderMealList();
        reanalyzeMeals();
      })
    );
  }
  function addMeal() {
    const t = $('mealTime').value || '07:30',
      cat = $('mealCat').value,
      lbl = $('mealLabel').value.trim();
    MEALS.push({ minOfDay: minOfDay(t), category: cat, label: lbl || { light: 'Snack', medium: 'Meal', heavy: 'Large meal' }[cat] });
    $('mealLabel').value = '';
    saveMeals();
    renderMealList();
    reanalyzeMeals();
  }
  function seedMeals() {
    MEALS = [
      { minOfDay: 7 * 60 + 30, category: 'medium', label: 'Breakfast' },
      { minOfDay: 12 * 60 + 45, category: 'medium', label: 'Lunch' },
      { minOfDay: 19 * 60 + 15, category: 'heavy', label: 'Dinner' }
    ];
    saveMeals();
    renderMealList();
    reanalyzeMeals();
  }
  function reanalyzeMeals(silent) {
    if (!LASTPARSED) return;
    let r;
    try {
      r = analyzeWithProfile(LASTPARSED, null);
    } catch (e) {
      return;
    }
    RESULT = r;
    if (ECGJSON) {
      try {
        FUSION = computeFusion(r, ECGJSON);
        r.fusion = FUSION;
      } catch (e) {}
    }
    r.events = r.events.concat(FUSION && FUSION.events ? FUSION.events : []);
    if (window.GLUProfile) window.GLUProfile.render(r);
    renderKPI(r);
    renderPatterns(r);
    renderVariability(r);
    renderPPGR(r);
    renderNutrition(r);
    renderSessions(r);
    renderGanglior(r);
    renderTable(r);
    if (SCOPE) SCOPE.setData(r);
    if (silent === true) {
      if (r.calib && r.calib.applied)
        showOK('Calibrated to lab A1c — trace shifted ' + (r.calib.appliedOffset > 0 ? '+' : '') + r.calib.appliedOffset + ' mg/dL to match your lab-implied average glucose.');
      return;
    }
    const nAnn = r.excursions.filter((e) => e.annotated).length;
    showOK('Re-analyzed with ' + MEALS.length + ' meal marker' + (MEALS.length === 1 ? '' : 's') + ' — ' + nAnn + ' excursion' + (nAnn === 1 ? '' : 's') + ' now annotated.');
  }

  // alerts / progress
  function progress(pct, msg) {
    $('prog').classList.add('show');
    $('progBar').style.width = pct + '%';
    $('proc').textContent = msg || '';
  }
  function clearAlerts() {
    ['aInfo', 'aOK', 'aErr'].forEach((id) => $(id).classList.remove('show'));
  }
  function clearAlertsExceptInfo() {
    ['aOK', 'aErr'].forEach((id) => $(id).classList.remove('show'));
  }
  function showOK(m) {
    $('aOKmsg').textContent = m;
    $('aOK').classList.add('show');
    setTimeout(() => $('aOK').classList.remove('show'), 6500);
  }
  function showErr(m) {
    $('aErrmsg').textContent = m;
    $('aErr').classList.add('show');
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WIRE UP
  // ════════════════════════════════════════════════════════════════════════
  function init() {
    if (window.GLUProfile) window.GLUProfile.init(reRenderProfile);
    // ── glucose display-unit toggle (DEEP-AUDIT-FIXES §3) — DISPLAY-ONLY: compute + export stay
    //    mg/dL; this only reformats surfaced numbers/thresholds via window.GluDisp. mg/dL default. ──
    (function () {
      const actions = document.querySelector('.topbar-actions');
      if (!actions || !window.GluDisp || document.getElementById('gluUnitToggle')) return;
      if (!document.getElementById('gluUnitToggleCss')) {
        const st = document.createElement('style');
        st.id = 'gluUnitToggleCss';
        st.textContent =
          '.unit-toggle{display:inline-flex;border:1px solid var(--border2,rgba(255,255,255,.14));border-radius:8px;overflow:hidden}' +
          '.unit-btn{font:600 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.02em;padding:6px 9px;background:transparent;color:var(--text3,#6F8096);border:0;cursor:pointer;transition:.14s}' +
          '.unit-btn+.unit-btn{border-left:1px solid var(--border2,rgba(255,255,255,.14))}' +
          '.unit-btn:hover{color:var(--text,#fff)}' +
          '.unit-btn.on{background:var(--teal,#3DE0D0);color:#08131a}';
        document.head.appendChild(st);
      }
      const wrap = document.createElement('div');
      wrap.className = 'unit-toggle';
      wrap.id = 'gluUnitToggle';
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Glucose display unit');
      wrap.title = 'Display unit — glucose is stored & computed in mg/dL either way';
      [
        ['mgdl', 'mg/dL'],
        ['mmol', 'mmol/L']
      ].forEach(([u, txt]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = txt;
        b.dataset.u = u;
        b.className = 'unit-btn' + (window.GluDisp.unit === u ? ' on' : '');
        wrap.appendChild(b);
      });
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('.unit-btn');
        if (!b) return;
        window.GluDisp.set(b.dataset.u);
        wrap.querySelectorAll('.unit-btn').forEach((x) => x.classList.toggle('on', x.dataset.u === window.GluDisp.unit));
        if (RESULT) renderAll(RESULT);
      });
      actions.insertBefore(wrap, actions.firstChild);
    })();
    const tb = $('themeBtn');
    tb.addEventListener('click', () => {
      document.body.classList.toggle('light');
      tb.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
      if (SCOPE && RESULT) {
        SCOPE.light = document.body.classList.contains('light');
        SCOPE.draw();
        SCOPE.drawMini();
      }
    });

    const zone = $('gluZone'),
      input = $('gluInput');
    // skip clicks on interactive children (the Choose-File button is now data-act="clickEl";
    // the zone must not also fire input.click() — CSP-strict handler migration).
    zone.addEventListener('click', (e) => {
      if (e.target.closest('button,a,label,select,input')) return;
      input.click();
    });
    input.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadCSV(f);
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) loadCSV(f);
    });
    $('genBtn').addEventListener('click', genSynthetic);
    $('replaceBtn').addEventListener('click', () => input.click());
    $('ecgJsonInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadECGJSON(f);
    });
    $('nutInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) loadNutrition(f);
    });
    $('mealAdd').addEventListener('click', addMeal);
    $('mealSeed').addEventListener('click', seedMeals);
    $('mealLabel').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addMeal();
    });
    renderMealList();

    $('zoomIn').addEventListener('click', () => SCOPE && SCOPE.zoom(0.7));
    $('zoomOut').addEventListener('click', () => SCOPE && SCOPE.zoom(1.4));
    $('zoomFit').addEventListener('click', () => SCOPE && SCOPE.fitAll());
    $('spanSel').addEventListener('change', (e) => {
      if (SCOPE) SCOPE.setSpanMin(parseFloat(e.target.value));
    });

    $('btnCSV').addEventListener('click', exportCleanCSV);
    $('btnJSON').addEventListener('click', exportJSON);
    if ($('btnSumCSV')) $('btnSumCSV').addEventListener('click', exportSummaryCSV);
    $('btnClear').addEventListener('click', resetAll);

    const navItems = [...document.querySelectorAll('.sb-nav .sb-item')];
    function setActive(id) {
      navItems.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
    }
    navItems.forEach((a) => a.addEventListener('click', () => setActive(a.getAttribute('href').slice(1))));
    const spy = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-18% 0px -72% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    ['sec-input', 'heroTop', 'scopeSection', 'sec-profile', 'slKPI', 'qualitySection', 'agpSection', 'variSection', 'patternsSection', 'dailySection', 'fusionCard', 'gangSection', 'slTbl'].forEach(
      (id) => {
        const e = $(id);
        if (e) spy.observe(e);
      }
    );
    if (navItems[0]) navItems[0].classList.add('active');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ── PDF/print: render a clean, light, chrome-free page. Leverages the shipped
   light theme (a user-facing feature) + a print-only stylesheet. JS-injected so
   the .src.html skeleton — and thus buildHash + provenance fixtures — stays put.
   Mirrored verbatim across nodes (like the Clock Contract). ── */
(function () {
  if (window.__dexPrintWired) return;
  window.__dexPrintWired = true;
  var st = document.createElement('style');
  st.textContent =
    '@media print{' +
    '@page{margin:12mm}' +
    'html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff!important;color:#0a0e12!important}' +
    '.sidebar,#exportBar,#exportBar.show,#backToTop,#themeToggle,#themeToggleBtn,.theme-toggle,#themeBtn,.mob-bar,#mobBar,.mobile-nav,.mobile-sticky-header,.mode-bar{display:none!important}' +
    '.app-shell{grid-template-columns:1fr!important}' +
    '.main-wrap,.content,.main,main,.app-main,.main-content{margin-left:0!important;max-width:100%!important}' +
    '.kpi,.metric,.chart-wrap,.chart-card,canvas,svg,figure,tr,td,th{break-inside:avoid}' +
    'table{break-inside:auto}thead{display:table-header-group}tfoot{display:table-footer-group}' +
    '}';
  (document.head || document.documentElement).appendChild(st);
  var _added = false;
  function pre() {
    _added = !document.body.classList.contains('light');
    if (_added) document.body.classList.add('light');
  }
  function post() {
    if (_added) {
      document.body.classList.remove('light');
      _added = false;
    }
  }
  window.addEventListener('beforeprint', pre);
  window.addEventListener('afterprint', post);
  if (window.matchMedia) {
    try {
      window.matchMedia('print').addEventListener('change', function (e) {
        e.matches ? pre() : post();
      });
    } catch (_) {}
  }
  // Event-delegation actions (CSP strict script-src — dex-actions.js). print/clickEl are DexActions
  // builtins; the profile toggle/input are GlucoDex globals (glucodex-profile.js).
  if (window.DexActions)
    DexActions.registerAll({
      gluProfileToggle: function () {
        return gluProfileToggle();
      },
      gluProfileInput: function () {
        return gluProfileInput();
      }
    });
})();
