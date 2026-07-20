/* ════ OxyDex · RENDER & CHARTS — OXYUI (oxydex-render.js) ──────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Pure-SVG chart builders (line/area, bar, spike timeline) and the full render
   layer: renderAll, per-night detail, summary table, projection cards, research
   metric dump, night-rail sync, and the three-colour status helper.
   Plain global script — shares page scope with the other oxydex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: oxydex-util → oxydex-profile → oxydex-dsp → oxydex-render → oxydex-app.
   ════════════════════════════════════════════════════════════════════════ */
// ESM-MIGRATION Phase 4: explicit DSP-helper imports — destructured from the namespace's
// _bare surface (the app shell sets __DEX_NAMESPACED__, so the bare-global spray no longer
// runs on this page; every DSP helper this module uses is named here, import-style).
const { linReg, fmtDate, fmtTime, shortDate } = window.OxyDex._bare;

// ═══════════════════════════════════════════
// CHARTS  (pure SVG, no dependencies)
// ═══════════════════════════════════════════
var C = {
  // chart colors — aligned to CSS :root token system
  blue: '#58A6FF',
  green: '#2DD4BF',
  amber: '#F59E0B',
  orange: '#fb923c',
  red: '#F87171',
  purple: '#a78bfa',
  teal: '#3DE0D0',
  grid: '#1f2e45',
  text: '#3E5068',
  bg: '#0C0F15'
};

function makeSVG(w, h, content) {
  return '<svg class="chart-svg" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' + content + '</svg>';
}

// ═══════════════════════════════════════════════════════════════════════════
//  SELF-INGEST · review-mode banner + clinical "bring-to-doctor" summary
//  (SELF-INGEST-2026-06-27-BRIEF §2/§3/§4)
//  ─────────────────────────────────────────────────────────────────────────
//  Rendered ONLY when window._oxyReview is set (an export was reloaded) AND
//  every loaded night is _fromExport (gated in renderAll). All CSS is injected
//  from THIS external module (never the .src.html shell) so the bundle's
//  buildHash stays stable — the brief's re-bundle is external-JS-only.
// ═══════════════════════════════════════════════════════════════════════════
function _oxyInjectSelfIngestCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('oxy-selfingest-css')) return;
  var css =
    '' +
    '.oxy-review-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;' +
    'margin:0 0 18px;padding:13px 18px;border-radius:12px;' +
    'background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);' +
    'font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}' +
    '.oxy-review-banner .orb-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;' +
    'letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}' +
    '.oxy-review-banner .orb-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}' +
    '.oxy-review-banner .orb-meta{color:var(--text3,#5E7187)}' +
    '.oxy-review-banner .orb-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}' +
    '.oxy-review-banner .orb-spacer{flex:1 1 auto}' +
    '.oxy-review-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;' +
    'padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);' +
    'background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}' +
    '.oxy-review-print:hover{filter:brightness(1.15)}' +
    '.eb-scrub{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text3,#5E7187);' +
    'cursor:pointer;user-select:none;white-space:nowrap}' +
    '.eb-scrub input{accent-color:var(--teal,#3DE0D0);cursor:pointer}' +
    // ── clinical summary card ──
    '.oxy-clinical{margin:0 0 22px;padding:24px 26px;border-radius:14px;' +
    'background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}' +
    '.oxy-clinical .ocl-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;' +
    'padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}' +
    '.oxy-clinical .ocl-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.oxy-clinical .ocl-sub{font-size:13px;color:var(--text3,#5E7187)}' +
    '.oxy-clinical .ocl-prov{flex:1 1 100%;margin-top:6px;font-size:11px;color:var(--text3,#5E7187);' +
    'font-family:ui-monospace,monospace}' +
    '.oxy-clinical .ocl-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
    'color:var(--text3,#5E7187);margin:18px 0 9px}' +
    '.oxy-clinical .ocl-sec:first-of-type{margin-top:0}' +
    '.oxy-clinical .ocl-impression{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}' +
    '.oxy-clinical .ocl-flags{display:flex;flex-wrap:wrap;gap:7px}' +
    '.oxy-clinical .ocl-flag{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;' +
    'font-size:12px;font-weight:600;border:1px solid var(--border,#1f2e45);background:var(--surface2,#0C0F15)}' +
    '.oxy-clinical .ocl-flag.warn{border-color:rgba(245,158,11,.35);color:var(--status-caution,#F59E0B)}' +
    '.oxy-clinical .ocl-flag.bad{border-color:rgba(248,113,113,.4);color:var(--status-concern,#F87171)}' +
    '.oxy-clinical .ocl-flag.ok{border-color:rgba(45,212,191,.3);color:var(--status-ok,#2DD4BF)}' +
    '.oxy-clinical .ocl-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}' +
    '.oxy-clinical .ocl-kpi{position:relative;padding:12px 14px;border-radius:10px;' +
    'background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}' +
    '.oxy-clinical .ocl-kpi .k-lab{display:flex;align-items:center;gap:5px;font-size:11px;' +
    'color:var(--text3,#5E7187);margin-bottom:5px}' +
    '.oxy-clinical .ocl-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.oxy-clinical .ocl-kpi .k-val.warn{color:var(--status-caution,#F59E0B)}' +
    '.oxy-clinical .ocl-kpi .k-val.bad{color:var(--status-concern,#F87171)}' +
    '.oxy-clinical .ocl-kpi .k-val.ok{color:var(--status-ok,#2DD4BF)}' +
    '.oxy-clinical .ocl-kpi .k-note{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}' +
    '.oxy-clinical .ocl-tl{display:flex;flex-direction:column;gap:0;border:1px solid var(--border,#1f2e45);' +
    'border-radius:10px;overflow:hidden}' +
    '.oxy-clinical .ocl-tlrow{display:grid;grid-template-columns:84px 1fr auto;align-items:center;gap:10px;' +
    'padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}' +
    '.oxy-clinical .ocl-tlrow:first-child{border-top:none}' +
    '.oxy-clinical .ocl-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}' +
    '.oxy-clinical .ocl-tlrow .tl-name{display:flex;align-items:center;gap:6px;color:var(--text,#E6EDF5)}' +
    '.oxy-clinical .ocl-tlrow .tl-meta{color:var(--text3,#5E7187);font-size:11.5px}' +
    '.oxy-clinical .ocl-tlrow .tl-conf{color:var(--text3,#5E7187);font-family:ui-monospace,monospace;font-size:11.5px;text-align:right}' +
    '.oxy-clinical .ocl-tlmore{padding:8px 13px;font-size:11.5px;color:var(--text3,#5E7187);text-align:center}' +
    '.oxy-clinical .ocl-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic}' +
    '.oxy-clinical .ocl-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);' +
    'font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}' +
    '.oxy-clinical .ocl-disc .ocl-dxl{font-weight:700;color:var(--text2,#9FB0C3)}' +
    // ── greyed raw-only panel placeholder (review mode) ──
    '.oxy-greyed{position:relative;border:1px dashed var(--border,#1f2e45);border-radius:12px;' +
    'padding:22px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 10px,transparent 10px 20px);' +
    'color:var(--text3,#5E7187);font-size:12.5px;line-height:1.5;text-align:center}' +
    '.oxy-greyed strong{display:block;color:var(--text2,#9FB0C3);font-size:13px;margin-bottom:4px}' +
    // ── PRINT ISOLATION: a review-mode print shows ONLY the clinical summary (no raw-chart whitespace) ──
    '@media print{' +
    'body.oxy-review #results>*:not(.oxy-clinical){display:none !important}' +
    'body.oxy-review .oxy-clinical{display:block !important;border:none;padding:0;margin:0}' +
    'body.oxy-review #results{padding:0 !important}' +
    '}';
  var st = document.createElement('style');
  st.id = 'oxy-selfingest-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
}

// Short, human build stamp for the review banner / clinical header (§2 banner contract).
function _oxyBuildStamp(review) {
  var prov = review && review.provenance;
  var bh = prov && prov.buildHash ? prov.buildHash : (review && review.derivedFrom && review.derivedFrom.buildHash) || null;
  var gen = prov && prov.generated ? prov.generated : (review && review.generated) || null;
  var genShort = '';
  if (gen) {
    try {
      genShort = String(gen).replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ' UTC');
    } catch (_g) {
      genShort = String(gen);
    }
  }
  return { build: bh, generated: genShort, scrubbed: !!(review && review.scrubbed) };
}

// §2 · the persistent review-mode banner — "Loaded from export · review mode · not recomputed · built X on Y".
function oxyReviewBanner(review) {
  var s = _oxyBuildStamp(review);
  var h = '<div class="oxy-review-banner" role="status">';
  h += '<span class="orb-tag"><span class="orb-dot"></span>Review mode</span>';
  h += '<span>Loaded from export · <strong>not recomputed</strong>' + (s.scrubbed ? ' · <strong>scrubbed for sharing</strong>' : '') + '</span>';
  h += '<span class="orb-meta">' + (s.build ? 'built <code>' + escHTML(s.build) + '</code>' : 'build unknown') + (s.generated ? ' on <code>' + escHTML(s.generated) + '</code>' : '') + '</span>';
  h += '<span class="orb-spacer"></span>';
  h += '<button class="oxy-review-print" type="button" data-act="print">🖨 Save clinical PDF</button>';
  h += '</div>';
  return h;
}

// map an emitted event → the registry label its evidence badge resolves from (mirrors the
// envelope group's tierFor: desat→ODI-3 when shallow else ODI-4; PB→Periodic breathing).
function _oxyEventLabel(e) {
  if (e && e.impulse === 'periodic_breathing') return 'Periodic breathing';
  var depth = e && e.meta && e.meta.depth;
  return depth != null && depth < 4 ? 'ODI-3' : 'ODI-4';
}
function _oxyEventName(e) {
  return e && e.impulse === 'periodic_breathing' ? 'Periodic breathing' : 'Desaturation';
}
function _oxyEventMeta(e) {
  if (!e || !e.meta) return '';
  if (e.impulse === 'periodic_breathing') {
    var cl = e.meta.cycleLen,
      cr = e.meta.crossings;
    return [cl != null ? 'cycle ' + cl + 's' : '', cr != null ? cr + ' crossings' : ''].filter(Boolean).join(' · ');
  }
  var d = e.meta.depth,
    dur = e.meta.duration,
    nad = e.meta.nadir;
  return [d != null ? '−' + d + '%' : '', nad != null ? 'nadir ' + nad + '%' : '', dur != null ? dur + 's' : ''].filter(Boolean).join(' · ');
}

// §4 · the clinical event timeline — chronological ganglior_events[] with evidence badges, capped for print.
function oxyEventTimeline(events, multiNight) {
  var evs = Array.isArray(events) ? events.slice() : [];
  if (!evs.length) return '<div class="ocl-none">No scored events in this export.</div>';
  evs.sort(function (a, b) {
    return (a.tMs || 0) - (b.tMs || 0);
  });
  var desN = evs.filter(function (e) {
    return e.impulse === 'desat_event';
  }).length;
  var pbN = evs.filter(function (e) {
    return e.impulse === 'periodic_breathing';
  }).length;
  var CAP = 40,
    shown = evs.slice(0, CAP);
  var h = '<div class="ocl-tl">';
  shown.forEach(function (e) {
    var badge = typeof evBadge === 'function' ? evBadge(_oxyEventLabel(e)) : '';
    var when = e.t || (e.tMs != null && typeof fmtTime === 'function' ? fmtTime(new Date(e.tMs)) : '—');
    var datePart = multiNight && e.tMs != null && typeof fmtDate === 'function' ? fmtDate(new Date(e.tMs)).slice(5) + ' ' : '';
    h +=
      '<div class="ocl-tlrow">' +
      '<span class="tl-t">' +
      escHTML(datePart + when) +
      '</span>' +
      '<span class="tl-name">' +
      badge +
      escHTML(_oxyEventName(e)) +
      ' <span class="tl-meta">' +
      escHTML(_oxyEventMeta(e)) +
      '</span></span>' +
      '<span class="tl-conf">conf ' +
      (e.conf != null ? e.conf : '—') +
      '</span>' +
      '</div>';
  });
  if (evs.length > CAP) h += '<div class="ocl-tlmore">+ ' + (evs.length - CAP) + ' more events · ' + desN + ' desaturations · ' + pbN + ' periodic-breathing total</div>';
  h += '</div>';
  return h;
}

// §4 · the clinical "bring-to-doctor" summary. Findings → KPIs → event timeline (each badged) →
// provenance + intended-use disclaimer + dxl- stamp. Faithfully renders the EXPORT's stored values.
function oxyClinicalSummary(review, nights) {
  var s = _oxyBuildStamp(review);
  var asc = nights.slice().reverse(); // nights is DESC (newest first) → ascending for date range
  var first = asc[0],
    last = asc[asc.length - 1];
  var dateRange = first ? (first.date === (last && last.date) ? first.date : first.date + ' → ' + (last && last.date)) : '—';
  var totMin = nights.reduce(function (a, n) {
    return a + ((n.stats && n.stats.durationMin) || 0);
  }, 0);
  var durTxt = totMin ? Math.floor(totMin / 60) + 'h' + (Math.round(totMin % 60) < 10 ? '0' : '') + Math.round(totMin % 60) + 'm' + (nights.length > 1 ? ' total' : '') : '';
  var recent = nights[0] || {}; // newest night for the headline KPIs

  var h = '<section class="oxy-clinical" aria-label="Clinical summary (from export · review mode)">';
  // ── header ──
  h += '<div class="ocl-head">';
  h += '<span class="ocl-title">OxyDex · Clinical Summary</span>';
  h += '<span class="ocl-sub">' + escHTML(dateRange) + (durTxt ? ' · ' + escHTML(durTxt) : '') + ' · ' + nights.length + ' night' + (nights.length > 1 ? 's' : '') + '</span>';
  h += '</div>';

  // SELF-INGEST-FOLLOWUPS-IV F1: honest empty-nights placeholder. A nights[]-less export (e.g. an
  // events-only reload) carries no per-night clinical KPIs — say so plainly instead of rendering the
  // misleading "No flags raised — all scored metrics within range" skeleton over zero data. The banner
  // (prepended by reviewView), the "Clinical Summary" header above, the event timeline + the disclaimer
  // all still render, so the review chrome stays intact. (oxyClinicalSummary was already crash-safe on
  // [] via the `first ?` / `nights[0]||{}` guards; this just makes the empty case HONEST.)
  if (!nights.length) {
    h += '<div class="ocl-none">No per-night summary is included in this export — nothing to review here. (An events-only export carries the event timeline below but no clinical KPIs.)</div>';
    var evN0 = (review.events || []).length;
    h += '<div class="ocl-sec">Event timeline' + (evN0 ? ' · ' + evN0 + ' events' : '') + '</div>';
    h += oxyEventTimeline(review.events, !!review.multiNight);
    h += '<div class="ocl-disc">';
    h +=
      '<span class="ocl-dxl">Tepna · OxyDex</span> — wellness &amp; research tool. ' +
      '<strong>Not a medical device</strong> · does not diagnose or treat · not FDA/CE cleared. ' +
      'This summary reflects values computed at export time and is shared for discussion with a clinician, ' +
      'not for diagnosis. © 2026 Michal Planicka · Apache-2.0.';
    h += '</div></section>';
    return h;
  }

  // ── findings / flags first (headline impression + flags) ──
  h += '<div class="ocl-sec">Findings</div>';
  var imp = (recent.summary && (recent.summary.impression || recent.summary.headline)) || null;
  if (imp) h += '<div class="ocl-impression">' + escHTML(typeof imp === 'string' ? imp : imp.text || '') + '</div>';
  // flags across all nights (dedup by code, keep worst severity)
  var flagMap = {};
  nights.forEach(function (n) {
    (n.flags || []).forEach(function (f) {
      var code = typeof f === 'string' ? f : f && f.code;
      if (!code || code === 'OK') return;
      var sev = typeof f === 'object' && f.sev ? f.sev : 'warn';
      if (!flagMap[code] || sev === 'bad') flagMap[code] = sev;
    });
  });
  var flagCodes = Object.keys(flagMap);
  if (flagCodes.length) {
    h += '<div class="ocl-flags" style="margin-top:9px">';
    flagCodes.forEach(function (code) {
      var sev = flagMap[code];
      h += '<span class="ocl-flag ' + sev + '">' + (typeof evBadge === 'function' ? evBadge(code) : '') + escHTML(code) + '</span>';
    });
    h += '</div>';
  } else if (!imp) {
    h += '<div class="ocl-none">No flags raised — all scored metrics within range.</div>';
  }

  // ── KPIs (basic tier; each carries an inline evidence badge — coverage mandate) ──
  h += '<div class="ocl-sec">Key Measurements' + (nights.length > 1 ? ' · latest night (' + escHTML(recent.date || '') + ')' : '') + '</div>';
  var st = recent.stats || {};
  function kpi(label, val, note, cls) {
    return (
      '<div class="ocl-kpi"><div class="k-lab">' +
      (typeof evBadge === 'function' ? evBadge(label) : '') +
      escHTML(label) +
      '</div>' +
      '<div class="k-val ' +
      (cls || '') +
      '">' +
      escHTML(val) +
      '</div>' +
      (note ? '<div class="k-note">' + escHTML(note) + '</div>' : '') +
      '</div>'
    );
  }
  h += '<div class="ocl-kpis">';
  if (recent.odi4)
    h += kpi(
      'ODI-4',
      (recent.odi4.rate != null ? recent.odi4.rate : '—') + '/hr',
      recent.odi4.count != null ? recent.odi4.count + ' events' : '',
      recent.odi4.rate < 5 ? 'ok' : recent.odi4.rate < 15 ? 'warn' : 'bad'
    );
  if (st.meanSpo2 != null) h += kpi('Mean SpO₂', st.meanSpo2 + '%', 'min ' + (st.minSpo2 != null ? st.minSpo2 + '%' : '—'), st.meanSpo2 >= 95 ? 'ok' : st.meanSpo2 >= 92 ? 'warn' : 'bad');
  if (st.minSpo2 != null) h += kpi('Min SpO₂', st.minSpo2 + '%', 'lowest reading', st.minSpo2 >= 90 ? 'ok' : st.minSpo2 >= 85 ? 'warn' : 'bad');
  if (st.t90pct != null) h += kpi('T90', st.t90pct + '%', 'time below 90%', st.t90pct > 1 ? 'bad' : st.t90pct > 0 ? 'warn' : 'ok');
  if (recent.hb && recent.hb.rate != null) h += kpi('Hypoxic Burden', recent.hb.rate + '', '%-min/hr <94%', recent.hb.rate < 10 ? 'ok' : recent.hb.rate < 30 ? 'warn' : 'bad');
  if (recent.stab && recent.stab.score != null)
    h += kpi('Sleep Stability', recent.stab.score + '/100', recent.stab.grade || '', recent.stab.score >= 70 ? 'ok' : recent.stab.score >= 50 ? 'warn' : 'bad');
  if (recent.mos && recent.mos.mos != null) h += kpi('MOS', recent.mos.mos + '', recent.mos.mosLabel || 'McGill Oximetry', recent.mos.mos < 2 ? 'ok' : recent.mos.mos < 3 ? 'warn' : 'bad');
  h += '</div>';

  // ── multi-night trend block from the EXPORT's crossNight (show its EMBEDDED evidence — §3) ──
  if (review.crossNight && review.crossNight.metrics) {
    var mks = Object.keys(review.crossNight.metrics);
    if (mks.length) {
      h += '<div class="ocl-sec">Multi-night trend</div><div class="ocl-kpis">';
      mks.slice(0, 6).forEach(function (id) {
        var m = review.crossNight.metrics[id];
        if (!m) return;
        var badge = typeof window !== 'undefined' && window.MetricRegistry && m.evidence ? window.MetricRegistry.badge(m.evidence, '') : '';
        var mean = m.mean != null ? (+m.mean).toFixed(2) : m.value != null ? m.value : '—';
        h +=
          '<div class="ocl-kpi"><div class="k-lab">' +
          badge +
          escHTML(m.label || id) +
          '</div>' +
          '<div class="k-val">' +
          escHTML(mean + '') +
          '</div>' +
          (m.trend ? '<div class="k-note">' + escHTML(m.trend) + '</div>' : '') +
          '</div>';
      });
      h += '</div>';
    }
  }

  // ── event timeline (each event badged) ──
  var evN = (review.events || []).length;
  h += '<div class="ocl-sec">Event timeline' + (evN ? ' · ' + evN + ' events' : '') + '</div>';
  h += oxyEventTimeline(review.events, !!review.multiNight);

  // ── intended-use disclaimer + dxl- license stamp (§4) ──
  h += '<div class="ocl-disc">';
  h +=
    '<span class="ocl-dxl">Tepna · OxyDex</span> — wellness &amp; research tool. ' +
    '<strong>Not a medical device</strong> · does not diagnose or treat · not FDA/CE cleared. ' +
    'This summary reflects values computed at export time and is shared for discussion with a clinician, ' +
    'not for diagnosis. © 2026 Michal Planicka · Apache-2.0.';
  h += '</div>';

  h += '</section>';
  return h;
}

// Honest greyed placeholder for a panel that NEEDS per-second raw samples (review mode has the
// derived layer but not the firehose). NEVER fabricate a chart from summary stats (§2).
function oxyGreyedPanel(title) {
  return (
    '<div class="oxy-greyed"><strong>' +
    escHTML(title || 'Raw signal not included') +
    '</strong>' +
    'Raw signal is not included in this export — review mode. Re-run the original recording for waveforms.</div>'
  );
}

// F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — expose the review renderer via the node
// namespace (<Node>.reviewView) like the other five nodes. OxyDex's review view composes
// banner + clinical summary (review, nights DESC); nights defaults to the review's own elements.
// (OxyDex has no standalone renderReview — review render is integrated in renderAll.)
try {
  if (typeof window !== 'undefined' && window.OxyDex) {
    window.OxyDex.reviewView = function (review, nights) {
      return oxyReviewBanner(review) + oxyClinicalSummary(review, nights || (review && review.nights) || []);
    };
  }
} catch (_rvx) {}

// HRV-style chart UID counter (for gradient defs)
var _hrvChartUid = 0;

// Catmull-Rom-to-Bezier smoothing — matches Chart.js tension ~0.35
function _smoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return 'M ' + pts[0][0] + ' ' + pts[0][1] + ' L ' + pts[1][0] + ' ' + pts[1][1];
  var t = 0.35;
  var d = 'M ' + pts[0][0] + ' ' + pts[0][1];
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i];
    var p1 = pts[i];
    var p2 = pts[i + 1];
    var p3 = pts[i + 2] || p2;
    var c1x = p1[0] + ((p2[0] - p0[0]) * t) / 3;
    var c1y = p1[1] + ((p2[1] - p0[1]) * t) / 3;
    var c2x = p2[0] - ((p3[0] - p1[0]) * t) / 3;
    var c2y = p2[1] - ((p3[1] - p1[1]) * t) / 3;
    d += ' C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ', ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ', ' + p2[0] + ' ' + p2[1];
  }
  return d;
}

// Line/Area chart — multiple series. HRV-parser aesthetic:
// smooth curves, gradient fills, larger canvas, end-value annotation.
// series: [{label, color, values:[y], dashed, fill}]
// xLabels: string[]
function lineChart(series, xLabels, opts) {
  opts = opts || {};
  // Timeline must read LEFT→RIGHT (oldest→newest). The `nights` array is
  // sorted DESC (newest first), so reverse a COPY of the data for display.
  if (!opts.noReverse) {
    xLabels = xLabels.slice().reverse();
    series = series.map(function (s) {
      var c = {};
      for (var k in s) {
        c[k] = s[k];
      }
      c.values = s.values.slice().reverse();
      return c;
    });
  }
  // Apply global trend smoothing (moving average) when enabled
  if (_gcSmooth > 0 && !opts.noSmooth) {
    series = series.map(function (s) {
      var c = {};
      for (var k in s) {
        c[k] = s[k];
      }
      c.values = smoothVals(s.values, _gcSmooth);
      return c;
    });
  }
  // Cache read — skip SVG rebuild if inputs are identical
  try {
    var _ck = JSON.stringify({
      s: series.map(function (s) {
        return { l: s.label, v: s.values };
      }),
      x: xLabels,
      o: opts
    });
    if (_lineChartCache[_ck]) return _lineChartCache[_ck];
  } catch (_ce) {
    var _ck = null;
  }
  var _ckKey = _ck;

  // HRV-style proportions: ~2.55:1, more breathing room
  var W = 460,
    H = 180,
    PL = 38,
    PR = 18,
    PT = 18,
    PB = 30;
  var cW = W - PL - PR,
    cH = H - PT - PB;
  var allVals = [];
  series.forEach(function (s) {
    allVals = allVals.concat(
      s.values.filter(function (v) {
        return v != null && isFinite(v);
      })
    );
  });
  var yMin = opts.yMin !== undefined ? opts.yMin : allVals.length ? Math.floor(Math.min.apply(null, allVals)) : 0;
  var yMax = opts.yMax !== undefined ? opts.yMax : allVals.length ? Math.ceil(Math.max.apply(null, allVals)) : 1;
  if (yMax === yMin) {
    yMax += 1;
  }
  var n = xLabels.length;
  function xp(i) {
    return n === 1 ? PL + cW / 2 : PL + (i / (n - 1)) * cW;
  }
  function yp(v) {
    return PT + cH - ((v - yMin) / (yMax - yMin)) * cH;
  }

  var uid = ++_hrvChartUid;
  var svg = '';

  // ── linear-gradient defs (one per filled series) ──
  var hasFill = series.some(function (s) {
    return s.fill;
  });
  if (hasFill) {
    var defs = '<defs>';
    series.forEach(function (s, si) {
      if (!s.fill) return;
      defs +=
        '<linearGradient id="lg' +
        uid +
        '-' +
        si +
        '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' +
        s.color +
        '" stop-opacity="0.28"/>' +
        '<stop offset="100%" stop-color="' +
        s.color +
        '" stop-opacity="0"/>' +
        '</linearGradient>';
    });
    defs += '</defs>';
    svg += defs;
  }

  // ── grid lines + y-axis labels ──
  var ySteps = 4;
  for (var i = 0; i <= ySteps; i++) {
    var yv = yMin + ((yMax - yMin) * i) / ySteps;
    var ypos = PT + cH - ((yv - yMin) / (yMax - yMin)) * cH;
    svg += '<line x1="' + PL + '" y1="' + ypos + '" x2="' + (W - PR) + '" y2="' + ypos + '" stroke="rgba(30,45,66,0.55)" stroke-width="1"/>';
    svg += '<text x="' + (PL - 6) + '" y="' + (ypos + 4) + '" text-anchor="end" fill="#7E97AE" font-size="13" font-family="\'IBM Plex Mono\',monospace">' + yv.toFixed(opts.dec || 0) + '</text>';
  }
  // ── x labels — first, last + a few evenly-spaced between (readable) ──
  var _maxTicks = 6;
  var _tickIdx = [];
  if (n <= _maxTicks) {
    for (var ti = 0; ti < n; ti++) _tickIdx.push(ti);
  } else {
    var _step = (n - 1) / (_maxTicks - 1);
    for (var ti = 0; ti < _maxTicks; ti++) _tickIdx.push(Math.round(ti * _step));
    _tickIdx = _tickIdx.filter(function (v, ix, a) {
      return a.indexOf(v) === ix;
    });
  }
  _tickIdx.forEach(function (i) {
    var anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    var tx = i === 0 ? PL : i === n - 1 ? W - PR : xp(i);
    svg += '<text x="' + tx + '" y="' + (H - 8) + '" text-anchor="' + anchor + '" fill="#7E97AE" font-size="13" font-family="\'IBM Plex Mono\',monospace">' + shortDate(xLabels[i]) + '</text>';
  });

  // ── series ──
  series.forEach(function (s, si) {
    if (!s.values.length) return;
    var pts = s.values.map(function (v, i) {
      return v != null && isFinite(v) ? [xp(i), yp(v)] : null;
    });
    var validPts = pts.filter(function (p) {
      return p !== null;
    });
    if (!validPts.length) return;

    var linePath = _smoothPath(validPts);

    // gradient area fill
    if (s.fill) {
      var apath = linePath + ' L ' + validPts[validPts.length - 1][0] + ' ' + (PT + cH) + ' L ' + validPts[0][0] + ' ' + (PT + cH) + ' Z';
      svg += '<path d="' + apath + '" fill="url(#lg' + uid + '-' + si + ')"/>';
    }

    // line stroke with draw-in animation.
    // pathLength="1" normalizes the dash math to the path's own length, so the
    // whole line always draws regardless of arc length. (A fixed dasharray like
    // "900" silently truncated long/spiky series — the tail fell in the gap.)
    var dash = s.dashed ? 'stroke-dasharray="5 4"' : '';
    var drawAnim = s.dashed
      ? ''
      : ' pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">' +
        '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.8s" calcMode="spline" keySplines="0.4 0 0.2 1" fill="freeze"/>' +
        '</path>';
    if (s.dashed) {
      svg += '<path d="' + linePath + '" fill="none" stroke="' + s.color + '" stroke-width="2" ' + dash + ' stroke-linejoin="round" stroke-linecap="round"/>';
    } else {
      svg += '<path d="' + linePath + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + drawAnim;
    }

    // endpoint dot + last-value annotation (HRV signature "96.2" style)
    var last = validPts[validPts.length - 1];
    var lastVal = null,
      lastIdx = -1;
    for (var k = s.values.length - 1; k >= 0; k--) {
      if (s.values[k] != null && isFinite(s.values[k])) {
        lastVal = s.values[k];
        lastIdx = k;
        break;
      }
    }
    if (last && lastVal != null) {
      svg += '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" fill="' + C.bg + '" stroke="' + s.color + '" stroke-width="2"/>';
      // only label primary (first) series — avoid overlap with multi-series
      if (si === 0) {
        var labelY = last[1] - 10;
        // keep label inside plot area
        if (labelY < PT + 10) labelY = last[1] + 16;
        var labelX = Math.min(last[0], W - PR - 4);
        svg +=
          '<text x="' +
          labelX +
          '" y="' +
          labelY +
          '" text-anchor="end" fill="' +
          s.color +
          '" font-size="13" font-weight="600" font-family="\'IBM Plex Mono\',monospace" opacity="0">' +
          lastVal.toFixed(opts.dec || 0) +
          '<animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="0.7s" fill="freeze"/>' +
          '</text>';
      }
    }
    // subtle inner dots only when chart isn't crowded
    if (n <= 14) {
      pts.forEach(function (p, i) {
        if (p === null || !isFinite(p[1])) return;
        if (i === lastIdx) return; // already drew endpoint
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.5" fill="' + C.bg + '" stroke="' + s.color + '" stroke-width="1.5"/>';
      });
    }
  });

  var _lcOut = makeSVG(W, H, svg);
  try {
    if (_ckKey) _lineChartCache[_ckKey] = _lcOut;
  } catch (_ce3) {}
  return _lcOut;
}

// Bar chart — HRV-parser aesthetic: gradient bars, larger canvas
// series: [{label, color, values:[y]}]
function barChart(series, xLabels, opts) {
  opts = opts || {};
  // Timeline must read LEFT→RIGHT (oldest→newest). `nights` is DESC-sorted,
  // so reverse a COPY of the data for display.
  if (!opts.noReverse) {
    xLabels = xLabels.slice().reverse();
    series = series.map(function (s) {
      var c = {};
      for (var k in s) {
        c[k] = s[k];
      }
      c.values = s.values.slice().reverse();
      return c;
    });
  }
  var W = 460,
    H = 180,
    PL = 38,
    PR = 18,
    PT = 18,
    PB = 30;
  var cW = W - PL - PR,
    cH = H - PT - PB;
  var allVals = [];
  series.forEach(function (s) {
    allVals = allVals.concat(
      s.values.filter(function (v) {
        return v != null && isFinite(v);
      })
    );
  });
  var yMax = opts.yMax || (allVals.length ? Math.ceil(Math.max.apply(null, allVals) * 1.1) : 0) || 1;
  var n = xLabels.length,
    nS = series.length;
  if (!n || !nS) return '';
  var groupW = cW / n,
    barW = Math.min(groupW / nS - 3, 22);

  var uid = ++_hrvChartUid;
  var svg = '';

  // gradient defs (one per series)
  var defs = '<defs>';
  series.forEach(function (s, si) {
    defs +=
      '<linearGradient id="bg' +
      uid +
      '-' +
      si +
      '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' +
      s.color +
      '" stop-opacity="0.95"/>' +
      '<stop offset="100%" stop-color="' +
      s.color +
      '" stop-opacity="0.55"/>' +
      '</linearGradient>';
  });
  defs += '</defs>';
  svg += defs;

  // grid
  [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
    var yv = yMax * f,
      ypos = PT + cH - f * cH;
    svg += '<line x1="' + PL + '" y1="' + ypos + '" x2="' + (W - PR) + '" y2="' + ypos + '" stroke="rgba(30,45,66,0.55)" stroke-width="1"/>';
    if (f > 0)
      svg += '<text x="' + (PL - 6) + '" y="' + (ypos + 4) + '" text-anchor="end" fill="#7E97AE" font-size="13" font-family="\'IBM Plex Mono\',monospace">' + yv.toFixed(opts.dec || 0) + '</text>';
  });
  // x labels — first, last + a few evenly-spaced between (readable)
  var _bMaxTicks = 6;
  var _bTickIdx = [];
  if (n <= _bMaxTicks) {
    for (var bti = 0; bti < n; bti++) _bTickIdx.push(bti);
  } else {
    var _bStep = (n - 1) / (_bMaxTicks - 1);
    for (var bti = 0; bti < _bMaxTicks; bti++) _bTickIdx.push(Math.round(bti * _bStep));
    _bTickIdx = _bTickIdx.filter(function (v, ix, a) {
      return a.indexOf(v) === ix;
    });
  }
  _bTickIdx.forEach(function (i) {
    var anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    var gx = i === 0 ? PL : i === n - 1 ? W - PR : PL + i * groupW + groupW / 2;
    svg += '<text x="' + gx + '" y="' + (H - 8) + '" text-anchor="' + anchor + '" fill="#7E97AE" font-size="13" font-family="\'IBM Plex Mono\',monospace">' + shortDate(xLabels[i]) + '</text>';
  });
  // bars — enforce minimum 3px visible width
  var barWMin = Math.max(barW, 3);
  series.forEach(function (s, si) {
    s.values.forEach(function (v, i) {
      if (v == null || !isFinite(v)) return;
      var h = Math.max(2, (v / yMax) * cH);
      var gx = PL + i * groupW;
      var bx = gx + (si - (nS - 1) / 2) * (barWMin + 1) + groupW / 2 - barWMin / 2;
      var by = PT + cH - h;
      var delay = (i * 0.025 + si * 0.05).toFixed(2) + 's';
      svg +=
        '<rect x="' +
        bx +
        '" y="' +
        by +
        '" width="' +
        barWMin +
        '" height="' +
        h +
        '" rx="3" fill="url(#bg' +
        uid +
        '-' +
        si +
        ')" opacity="0">' +
        '<animate attributeName="y"       from="' +
        (PT + cH) +
        '" to="' +
        by +
        '" dur="0.45s" begin="' +
        delay +
        '" calcMode="spline" keySplines="0.16 1 0.3 1" fill="freeze"/>' +
        '<animate attributeName="height"  from="0"           to="' +
        h +
        '"  dur="0.45s" begin="' +
        delay +
        '" calcMode="spline" keySplines="0.16 1 0.3 1" fill="freeze"/>' +
        '<animate attributeName="opacity" from="0"           to="1"      dur="0.2s"  begin="' +
        delay +
        '" fill="freeze"/>' +
        '</rect>';
      // Only show value label when bars are wide enough to be readable
      if (v > 0 && barWMin >= 8)
        svg +=
          '<text x="' +
          (bx + barWMin / 2) +
          '" y="' +
          (by - 4) +
          '" text-anchor="middle" fill="' +
          s.color +
          '" font-size="9" font-weight="600" font-family="\'IBM Plex Mono\',monospace" opacity="0">' +
          v +
          '<animate attributeName="opacity" from="0" to="1" dur="0.2s" begin="' +
          (parseFloat(delay) + 0.3).toFixed(2) +
          's" fill="freeze"/>' +
          '</text>';
    });
  });
  return makeSVG(W, H, svg);
}

// Spike timeline — dots on time axis per night
function spikeTimeline(nights) {
  var W = 1000,
    H = Math.max(60, nights.length * 26 + 26),
    PL = 54,
    PR = 16,
    PT = 22,
    PB = 10;
  var cW = W - PL - PR;
  var tStart = 20 * 60,
    tEnd = 32 * 60;
  function xp(mfm) {
    var m = mfm < tStart ? mfm + 24 * 60 : mfm;
    return PL + Math.max(0, Math.min(1, (m - tStart) / (tEnd - tStart))) * cW;
  }

  var svg = '';
  // time axis labels — own row at top, no legend competing
  [20, 22, 0, 2, 4, 6, 8].forEach(function (h) {
    var mfm = h < 20 ? h * 60 + 24 * 60 : h * 60;
    var x = xp(mfm);
    svg += '<line x1="' + x + '" y1="' + PT + '" x2="' + x + '" y2="' + (H - PB) + '" stroke="' + C.grid + '" stroke-width="1" stroke-dasharray="2 3"/>';
    svg += '<text x="' + x + '" y="14" text-anchor="middle" fill="' + C.text + '" font-size="12" font-family="\'IBM Plex Mono\',monospace">' + (h < 10 ? '0' : '') + h + 'h</text>';
  });

  nights.forEach(function (n, ni) {
    var y = PT + 12 + ni * 26;
    svg += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="' + C.grid + '" stroke-width="1"/>';
    svg += '<text x="' + (PL - 5) + '" y="' + (y + 4) + '" text-anchor="end" fill="' + C.text + '" font-size="12" font-family="\'IBM Plex Mono\',monospace">' + escHTML(shortDate(n.date)) + '</text>';

    // ── Desaturation events — transparent blue dots, sized by severity ──
    // n.spo2Adv.events: [{depth(%), duration(s), startIdx, ...}]
    // startIdx is the seconds-from-start index into the rows array; convert
    // to mfm using n.stats.startTs (epoch ms of first row).
    if (n.spo2Adv && Array.isArray(n.spo2Adv.events) && n.stats && n.stats.startTs) {
      var _startTs = n.stats.startTs;
      n.spo2Adv.events.forEach(function (ev) {
        if (ev.startIdx == null) return;
        var evMs = _startTs + ev.startIdx * 1000;
        var d = new Date(evMs);
        var evMfm = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
        var x = xp(evMfm);
        // Severity: depth × duration (similar to SBII), capped for visual sanity.
        // Typical event: depth 4–10%, duration 10–60s → severity 40–600.
        var sev = (ev.depth || 0) * (ev.duration || 0);
        var r = Math.max(2.5, Math.min(9, Math.sqrt(sev) / 2.5));
        svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="' + r.toFixed(1) + '" fill="' + C.blue + '" opacity="0.35"/>';
      });
    }

    // ── HR spikes — purple/amber/red dots, sized by rise above baseline ──
    (Array.isArray(n.spikes) ? n.spikes : []).forEach(function (sp) {
      var x = xp(sp.mfm);
      var rise = sp.peak - sp.baseline;
      var r = Math.max(3, Math.min(8, rise / 8));
      var col = rise > 40 ? C.red : rise > 25 ? C.amber : C.purple;
      svg += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + col + '" opacity="0.85"/>';
    });
    if (n.osc && n.osc.episodeCount > 0) {
      var opacity = Math.min(0.7, ((n.osc ? n.osc.episodeCount : 0) / 20) * 0.7 + 0.1);
      svg += '<rect x="' + PL + '" y="' + (y + 6) + '" width="' + cW + '" height="3" rx="1" fill="' + C.teal + '" opacity="' + opacity + '"/>';
    }
  });

  return makeSVG(W, H, svg);
  // legend is rendered as HTML by the caller
}

// ═══════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════
// SpO₂ night-to-night CV = (SD / mean) · 100 percent — hoisted from renderAll's inline tab-4 builder so
// the surfaced hero number is a single TESTABLE function (§RN render-harness). The inline `·100` was
// unreachable by any gate, so a scale slip (·100 → ·10, a 10×-too-small CV that flips its coloring to
// always-good) shipped green.
function oxySpo2NightCV(sd, mean) {
  return +((sd / mean) * 100).toFixed(2);
}

function renderAll() {
  if (typeof window.UP === 'undefined') window.UP = {};
  try {
    // Detach the profile panel back to .main-wrap before we rebuild #results,
    // so the upcoming innerHTML wipe can't destroy it (it gets re-nested under
    // the hero after render). Preserves its form state + listeners.
    var _ppDetach = document.getElementById('userProfilePanel');
    if (_ppDetach && _ppDetach.parentElement && _ppDetach.parentElement.id === 'results') {
      var _mw = document.querySelector('.main-wrap');
      if (_mw) _mw.appendChild(_ppDetach);
    }
    var nights = Object.values(allNights).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    // Apply global View Window (affects trend charts + night list)
    // nights are DESC-sorted (newest first); slice(0, N) keeps the N newest.
    if (_gcWin && _gcWin < 999 && nights.length > _gcWin) nights = nights.slice(0, _gcWin);
    var single = nights.length === 1;
    var html = '';

    // ── SELF-INGEST review mode (SELF-INGEST-2026-06-27) ─────────────────────────────────────────────
    // Active ONLY when an export was reloaded (window._oxyReview) AND every loaded night is from that
    // export (a mixed raw+export batch falls back to the normal analysis view). When active: inject the
    // CSS, mark <body> for print isolation, and lead with the review banner + clinical "bring-to-doctor"
    // summary (findings · KPIs · badged event timeline · provenance · disclaimer) + an honest greyed
    // placeholder for the per-second waveform the export does NOT carry. Nothing here recomputes or
    // re-stamps — it renders the export's STORED values verbatim (§2/§3/§4).
    var _review =
      window._oxyReview &&
      nights.length &&
      nights.every(function (n) {
        return n && n._fromExport;
      })
        ? window._oxyReview
        : null;
    try {
      _oxyInjectSelfIngestCSS();
      var _bd = document.body;
      if (_bd) {
        if (_review) _bd.classList.add('oxy-review');
        else _bd.classList.remove('oxy-review');
      }
    } catch (_ri) {}
    if (_review) {
      try {
        html += oxyReviewBanner(_review);
      } catch (_rb) {}
      try {
        html += oxyClinicalSummary(_review, nights);
      } catch (_rc) {
        html += '<div class="render-error-inline">⚠️ Clinical summary error: ' + escHTML(_rc.message) + '</div>';
      }
      try {
        html += '<div style="margin:0 0 22px">' + oxyGreyedPanel('Per-second SpO₂ / HR waveform') + '</div>';
      } catch (_rg) {}
    }

    // ── READINESS HERO (Section 8 — most recent night) ──────────
    // nights sorted DESC at line ~10275; [0] = most recent
    var last = nights[0];
    if (last) {
      var rScore = last.karv ? last.karv.readiness : last.stab ? last.stab.score : null;
      var rColor = last.karv ? last.karv.readinessColor : rScore != null ? (rScore >= 80 ? 'good' : rScore >= 60 ? 'warn' : 'bad') : '';
      var rTier = last.karv ? last.karv.readinessTier : last.stab ? last.stab.grade : '';
      var rNote = last.karv ? last.karv.trainingNote || '' : '';
      var rCls = rColor === 'good' ? 'var(--status-ok)' : rColor === 'warn' ? 'var(--status-caution)' : rColor === 'bad' ? 'var(--status-concern)' : 'var(--text3)';
      var s0 = last.stats || {};

      var _ecg = typeof oxyEcgForNight === 'function' ? oxyEcgForNight(last) : null;
      html += '<div id="heroTop">';
      html += '<div class="readiness-hero" id="sec-readiness" style="--readiness-color:' + rCls + '"' + (rColor === 'good' ? ' data-pulse="true"' : '') + '>';
      html += '<div class="readiness-hero-label">Recovery Readiness · Last Night</div>';
      html += '<div class="readiness-date-badge">' + escHTML(last.date) + '</div>';
      html += '<div class="readiness-score">' + (rScore != null ? rScore : '—') + '</div>';
      html += '<div class="readiness-tier">' + (rTier || 'Upload overnight data') + '</div>';

      // Mini-metrics row
      html += '<div class="readiness-scores-grid">';
      if (s0.meanSpo2 != null) {
        var spo2Cls = s0.meanSpo2 >= 95 - upSpo2Adj() ? 'ok' : s0.meanSpo2 >= 92 - upSpo2Adj() ? 'warn' : 'bad';
        html += '<div class="readiness-subscore"><div class="rs-val ' + spo2Cls + '">' + evBadge('SpO₂') + s0.meanSpo2 + '%</div><div class="rs-label">SpO₂</div></div>';
      }
      if (last.hrv && last.hrv.hrSdnn != null) {
        var hrvCls = last.hrv.hrSdnn >= 4 ? 'ok' : last.hrv.hrSdnn >= 2.5 ? 'warn' : 'bad';
        html += '<div class="readiness-subscore"><div class="rs-val ' + hrvCls + '">' + evBadge('HR-Var') + last.hrv.hrSdnn + '</div><div class="rs-label">HR-Var</div></div>';
      }
      if (s0.durationMin) {
        var dh = Math.floor(s0.durationMin / 60),
          dm = Math.round(s0.durationMin % 60);
        var durCls = s0.durationMin >= 360 ? 'ok' : s0.durationMin >= 300 ? 'warn' : 'bad';
        html += '<div class="readiness-subscore"><div class="rs-val ' + durCls + '">' + evBadge('Sleep') + dh + 'h' + (dm < 10 ? '0' : '') + dm + 'm</div><div class="rs-label">Sleep</div></div>';
      }
      if (last.hrv && last.hrv.hrFloor != null) {
        var hrfCls = last.hrv.hrFloor <= 52 ? 'ok' : last.hrv.hrFloor <= 60 ? 'warn' : 'bad';
        html += '<div class="readiness-subscore"><div class="rs-val ' + hrfCls + '">' + evBadge('HR Floor') + last.hrv.hrFloor + ' bpm</div><div class="rs-label">HR Floor</div></div>';
      }
      html += '</div>';

      // Recommendation note
      if (rNote) html += '<div class="readiness-note">' + rNote + '</div>';

      // Zone 2 chips (if karv available)
      if (last.karv && last.karv.zones && last.karv.zones.z2) {
        var z2 = last.karv.zones.z2;
        html += '<div class="readiness-zones">';
        html += '<div class="readiness-zone-chip ok">' + evBadge('Z2 Window') + 'Z2 ' + z2.low + '–' + z2.high + ' bpm</div>';
        if (last.karv.mafHR) html += '<div class="readiness-zone-chip warn">' + evBadge('MAF HR') + 'MAF ≤' + last.karv.mafHR + ' bpm</div>';
        html += '</div>';
      }

      // DEEP-AUDIT §21 — the hero (Recovery Readiness) was unbadged while every mini-metric beneath it
      // was badged. Registry: `readiness` → experimental (alias 'Recovery Readiness' already resolves).
      html += '<span class="ev-corner">' + evBadge('Recovery Readiness') + '</span>';
      html += '</div>'; // .readiness-hero
      try {
        if (typeof oxyHeroBenchCard === 'function') html += oxyHeroBenchCard(last, _ecg);
      } catch (_pae) {}
      html += '</div>'; // #heroTop
      try {
        if (typeof oxyEcgFusionSection === 'function') html += oxyEcgFusionSection(last, _ecg);
      } catch (_efe) {}
    }

    // ── Evidence legend (System-Cohesion §3) — one strip per view ─
    try {
      if (window.MetricRegistry) html += window.MetricRegistry.legend();
    } catch (_evl) {}

    // ── Global controls bar (once above all charts) ──────────────
    html += '<div class="global-controls">';
    html += '<div class="gc-left">';
    html += '<span class="gc-label">View Window:</span>';
    html += '<div class="gc-btn-group">';
    html += '<button class="gc-btn' + (_gcWin === 7 ? ' active' : '') + '" data-act="setGCWindow" data-win="7">7d</button>';
    html += '<button class="gc-btn' + (_gcWin === 14 ? ' active' : '') + '" data-act="setGCWindow" data-win="14">14d</button>';
    html += '<button class="gc-btn' + (_gcWin === 30 ? ' active' : '') + '" data-act="setGCWindow" data-win="30">30d</button>';
    html += '<button class="gc-btn' + (_gcWin >= 999 ? ' active' : '') + '" data-act="setGCWindow" data-win="999">All</button>';
    html += '</div></div>';
    html += '<div class="gc-right">';
    html += '<span class="gc-label">Smoothing:</span>';
    html += '<input type="range" id="gcSmooth" class="gc-range" min="0" max="5" value="' + _gcSmooth + '" data-act-input="oxyGcSmoothInput" data-act-change="setGCSmooth">';
    html += '<span class="gc-range-val" id="gcSmoothVal">' + _gcSmooth + '</span>';
    html += '</div></div>';

    // ── CHARTS (multi or single) ──────────────
    if (nights.length >= 2) {
      var dates = nights.map(function (n) {
        return n.date;
      });

      html += '<div class="sec-label sec-label-lg" id="sec-trends">Trends <span style="color:var(--text3);font-weight:var(--fw-regular);font-size:14px;">· ' + nights.length + ' nights</span></div>';
      html += '<div class="chart-grid">';

      // Chart 1: SpO2 mean + T95%
      html += '<div class="chart-wrap">';
      html += chartTitle('SpO₂ Mean % · T95% Time Below 95%', 'Mean SpO₂');
      html += lineChart(
        [
          {
            label: 'Mean SpO₂',
            color: C.blue,
            fill: true,
            values: nights.map(function (n) {
              return n.stats ? n.stats.meanSpo2 : null;
            })
          },
          {
            label: 'T95%',
            color: C.amber,
            dashed: true,
            values: nights.map(function (n) {
              return n.stats ? n.stats.t95pct : null;
            })
          }
        ],
        dates,
        { yMin: 90, yMax: 100, dec: 1 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-line" style="background:' + C.blue + '"></div>Mean SpO₂ %</div>';
      html +=
        '<div class="legend-item"><div class="legend-line" style="background:' +
        C.amber +
        ';border-top:2px dashed ' +
        C.amber +
        '"></div><span title="T95%: time below 95% SpO₂">T95% time below</span></div>';
      html += '</div></div>';

      // Chart 2: HR spikes + oscillation windows
      html += '<div class="chart-wrap">';
      html += chartTitle('HR Spikes · Oscillation Windows per Night', 'HR Spikes');
      html += barChart(
        [
          {
            label: 'HR Spikes',
            color: C.purple,
            values: nights.map(function (n) {
              return n.spikes ? n.spikes.length : 0;
            })
          },
          {
            label: 'Osc Windows',
            color: C.teal,
            values: nights.map(function (n) {
              return n.osc ? n.osc.episodeCount : 0;
            })
          }
        ],
        dates,
        { dec: 0 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.purple + '"></div>HR spikes</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.teal + '"></div>Osc windows</div>';
      html += '</div></div>';

      // Chart 3: Min SpO2 trend (tight axis so night-to-night changes are visible)
      html += '<div class="chart-wrap">';
      html += chartTitle('Min SpO₂ % per Night', 'Min SpO₂');
      var minSpo2Vals = nights.map(function (n) {
        return n.stats ? n.stats.minSpo2 : null;
      });
      var minSpo2Defined = minSpo2Vals.filter(function (v) {
        return v !== null;
      });
      var minSpo2Floor = minSpo2Defined.length ? Math.max(80, Math.min.apply(null, minSpo2Defined) - 2) : 90;
      var minSpo2Ceil = minSpo2Defined.length ? Math.min(100, Math.max.apply(null, minSpo2Defined) + 2) : 100;
      html += lineChart([{ label: 'Min SpO₂', color: C.green, fill: true, values: minSpo2Vals }], dates, { yMin: minSpo2Floor, yMax: minSpo2Ceil, dec: 0 });
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-line" style="background:' + C.green + '"></div>Min SpO₂ %</div>';
      html += '</div></div>';

      // Chart 4: ODI-4 rate trend
      html += '<div class="chart-wrap">';
      html += chartTitle('ODI-4 Rate (events/hr) per Night', 'ODI-4');
      html += lineChart(
        [
          {
            label: 'ODI-4',
            color: C.amber,
            fill: true,
            values: nights.map(function (n) {
              return n.odi4 ? n.odi4.rate : 0;
            })
          }
        ],
        dates,
        { yMin: 0, dec: 1 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-line" style="background:' + C.amber + '"></div>ODI-4 events/hr</div>';
      html += '</div></div>';

      // Chart 5: HRV trend — pNN3 and HR floor
      var haveHrv = nights.some(function (n) {
        return n.hrv;
      });
      if (haveHrv) {
        // Chart A: HR-Var Proxy (SD bpm) — shows night-to-night arousal variation
        html += '<div class="chart-wrap">';
        html += chartTitle('HR-Var Proxy (SD bpm) per Night — relative only', 'HR-Var');
        html += lineChart(
          [
            {
              label: 'HR-Var SD',
              color: C.purple,
              fill: true,
              values: nights.map(function (n) {
                return n.hrv ? n.hrv.hrSdnn : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 2 }
        );
        html += '<div class="chart-legend">';
        html +=
          '<div class="legend-item"><div class="legend-line" style="background:' +
          C.purple +
          '"></div><span title="SD of 1Hz HR values (bpm) — higher = more variable night">HR variability (SD)</span></div>';
        html += '</div></div>';

        // Chart B: pNN3 % — HF autonomic proxy
        html += '<div class="chart-wrap">';
        html += chartTitle('pNN3 % per Night (HF autonomic proxy)', 'pNN3');
        html += lineChart(
          [
            {
              label: 'pNN3 %',
              color: C.teal,
              fill: true,
              values: nights.map(function (n) {
                return n.hrv ? n.hrv.pnn3 : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 1 }
        );
        html += '<div class="chart-legend">';
        html +=
          '<div class="legend-item"><div class="legend-line" style="background:' + C.teal + '"></div><span title="% consecutive HR pairs ≥3 bpm apart — HF vagal proxy">pNN3 HF proxy</span></div>';
        html += '</div></div>';

        // Chart C: HR Floor (p5 bpm) + HR Slope
        html += '<div class="chart-wrap">';
        html += chartTitle('HR Floor (p5 bpm) per Night', 'HR Floor');
        html += lineChart(
          [
            {
              label: 'HR Floor p5',
              color: C.green,
              fill: true,
              values: nights.map(function (n) {
                return n.hrv ? n.hrv.hrFloor : 0;
              })
            }
          ],
          dates,
          { yMin: 40, yMax: 65, dec: 0 }
        );
        html += '<div class="chart-legend">';
        html +=
          '<div class="legend-item"><div class="legend-line" style="background:' +
          C.green +
          '"></div><span title="5th-percentile HR during sleep — lower = better parasympathetic tone">HR floor (p5)</span></div>';
        html += '</div></div>';

        // Chart D: HR Slope (bpm/hr) — negative = recovery arc (healthy)
        html += '<div class="chart-wrap">';
        html += chartTitle('HR Slope (bpm/hr) per Night', 'HR Slope');
        html += lineChart(
          [
            {
              label: 'HR Slope',
              color: C.amber,
              fill: false,
              values: nights.map(function (n) {
                return n.hrv ? n.hrv.hrSlope : 0;
              })
            }
          ],
          dates,
          { dec: 2 }
        );
        html += '<div class="chart-legend">';
        html +=
          '<div class="legend-item"><div class="legend-line" style="background:' +
          C.amber +
          '"></div><span title="Negative = HR falling overnight (recovery) · Positive = rising (stress/fragmentation)">HR slope overnight</span></div>';
        html += '</div></div>';
      }

      // ── Chart 6: Motion & Restlessness ──────────────────
      html += '<div class="chart-wrap">';
      html += chartTitle('Movement & Restlessness per Night', 'Motion');
      html += barChart(
        [
          {
            label: 'Motion %',
            color: C.orange,
            values: nights.map(function (n) {
              return n.stats ? n.stats.motionPct : 0;
            })
          },
          {
            label: 'Restless Win%',
            color: C.amber,
            values: nights.map(function (n) {
              return n.motion ? n.motion.arousalIndex : 0;
            })
          }
        ],
        dates,
        { dec: 1 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.orange + '"></div>Overall motion %</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.amber + '"></div><span title="Restless windows % (≥2% per 30min block)">Restless windows</span></div>';
      html += '</div></div>';

      // ── Chart 7: Hypoxic Burden ──────────────────────────
      html += '<div class="chart-wrap">';
      html += chartTitle('Hypoxic Burden Rate (%-min/hr below SpO₂ 94%)', 'Hypoxic Burden');
      html += lineChart(
        [
          {
            label: 'Hypoxic Burden',
            color: C.red,
            fill: true,
            values: nights.map(function (n) {
              return n.hb ? n.hb.rate : 0;
            })
          }
        ],
        dates,
        { yMin: 0, dec: 1 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-line" style="background:' + C.red + '"></div>%-min/hr — flag >25</div>';
      html += '</div></div>';

      // ── Chart 8: Sleep Stability Score ──────────────────
      html += '<div class="chart-wrap">';
      html += chartTitle('Sleep Stability Score (0-100) per Night', 'Sleep Stability');
      html += lineChart(
        [
          {
            label: 'Stability',
            color: C.green,
            fill: true,
            values: nights.map(function (n) {
              return n.stab ? n.stab.score : 0;
            })
          }
        ],
        dates,
        { yMin: 0, yMax: 100, dec: 0 }
      );
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-line" style="background:' + C.green + '"></div>≥80 Good · 60-79 Fair · <60 Poor</div>';
      html += '</div></div>';

      // Move the Readiness chart up here so it sits within the core trend grid,
      // then close the core grid and open a collapsible "Advanced trends" group
      // for the long tail of research charts that follow.
      if (
        nights.some(function (n) {
          return n.karv;
        })
      ) {
        var kNights = nights.filter(function (n) {
          return n.karv;
        });
        var kDates = kNights.map(function (n) {
          return n.date;
        });
        var kRead = kNights.map(function (n) {
          return n.karv.readiness;
        });
        var kZ2lo = kNights.map(function (n) {
          return Math.round((n.karv.zones.z2.low / n.karv.hrMax) * 100);
        });
        var kZ2hi = kNights.map(function (n) {
          return Math.round((n.karv.zones.z2.high / n.karv.hrMax) * 100);
        });
        var kMAF = kNights.map(function (n) {
          return Math.round((n.karv.mafHR / n.karv.hrMax) * 100);
        });
        html += '<div class="chart-wrap" id="sec-karv">';
        html += chartTitle('Readiness &amp; Zone 2 Target per Night (% HRmax)', 'Recovery Readiness');
        html += lineChart(
          [
            { label: 'Readiness', color: C.teal, fill: true, values: kRead },
            { label: 'Z2 Low', color: C.blue, dashed: true, values: kZ2lo },
            { label: 'Z2 High', color: C.blue, values: kZ2hi },
            { label: 'MAF HR', color: C.amber, dashed: true, values: kMAF }
          ],
          kDates,
          { yMin: 0, yMax: 100, dec: 0 }
        );
        html += '<div class="chart-legend">';
        html += '<div class="legend-item"><div class="legend-line" style="background:' + C.teal + '"></div>Readiness /100</div>';
        html += '<div class="legend-item"><div class="legend-line" style="background:' + C.blue + '"></div>Zone 2 window (% HRmax)</div>';
        html += '<div class="legend-item"><div class="legend-line" style="background:' + C.amber + ';border-top:2px dashed ' + C.amber + '"></div>MAF ceiling (% HRmax)</div>';
        html += '</div></div>';
      }

      // Close core trend grid, then open the Advanced Trends collapsible.
      // The <details> element gives free expand/collapse without any JS.
      html += '</div>'; // /.chart-grid CORE trends
      html += '<details class="adv-trends" id="sec-trends-advanced">';
      html += '<summary><span class="adv-icon">▶</span> Advanced trends <span class="adv-count">' + 'HRV · motion · hypoxic burden · CVD predictors · rolling means' + '</span></summary>';
      html += '<div class="chart-grid">';

      // ── v18 NEW TREND CHARTS ──

      // Chart: Delta-Index per Night
      html += '<div class="chart-wrap">';
      html += chartTitle('Δ-Index per Night (OSA screening metric)', 'Δ-Index');
      html += lineChart(
        [
          {
            label: 'Δ-Index',
            color: C.orange,
            fill: true,
            values: nights.map(function (n) {
              return n.desat ? n.desat.deltaIndex : 0;
            })
          }
        ],
        dates,
        { yMin: 0, dec: 3 }
      );
      html +=
        '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
        C.orange +
        '"></div><span title="Mean 12s SpO₂ diff — ≤1.0 normal · >2.0 elevated">SpO₂ delta</span></div></div></div>';

      // Chart: Autonomic Arousal Index per Night
      html += '<div class="chart-wrap">';
      html += chartTitle('Autonomic Arousal Index (/hr)', 'AAI');
      html += lineChart(
        [
          {
            label: 'AAI',
            color: C.red,
            fill: true,
            values: nights.map(function (n) {
              return n.cross ? n.cross.autoArousalIdx : 0;
            })
          }
        ],
        dates,
        { yMin: 0, dec: 1 }
      );
      html +=
        '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
        C.red +
        '"></div><span title="(HR spikes + ODI-4 events)/hr — proxy for total arousal burden">Arousal burden</span></div></div></div>';

      // Chart: Sleep Efficiency per Night
      html += '<div class="chart-wrap">';
      html += chartTitle('Sleep Efficiency % per Night', 'Sleep Eff');
      html += lineChart(
        [
          {
            label: 'Sleep Eff',
            color: C.teal,
            fill: true,
            values: nights.map(function (n) {
              return n.motSleep ? n.motSleep.sleepEff : 0;
            })
          }
        ],
        dates,
        { yMin: 70, yMax: 100, dec: 1 }
      );
      html += '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' + C.teal + '"></div>% recording with zero motion — ≥90% target</div></div></div>';

      // Chart: 7-day rolling mean SpO2
      if (nights.length >= 3) {
        var roll7spo2 = nights.map(function (n, i) {
          var w = nights.slice(Math.max(0, i - 6), i + 1);
          return +(
            w.reduce(function (s, x) {
              return s + x.stats.meanSpo2;
            }, 0) / w.length
          ).toFixed(2);
        });
        html += '<div class="chart-wrap">';
        html += chartTitle('7-Day Rolling Mean SpO₂ (%)', 'Mean SpO₂');
        html += lineChart([{ label: '7d SpO₂', color: C.blue, fill: true, values: roll7spo2 }], dates, { yMin: 93, yMax: 100, dec: 2 });
        html += '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' + C.blue + '"></div>Chronic drift indicator — flag if trending down</div></div></div>';
      }

      // Chart: 7-day rolling PB burden (total crossings)
      if (nights.length >= 3) {
        var roll7pb = nights.map(function (n, i) {
          var w = nights.slice(Math.max(0, i - 6), i + 1);
          return Math.round(
            w.reduce(function (s, x) {
              return s + (x.osc ? x.osc.totalCrossings || 0 : 0);
            }, 0) / w.length
          );
        });
        html += '<div class="chart-wrap">';
        html += chartTitle('7-Day Rolling PB Burden (avg crossings)', 'PB Episodes');
        html += lineChart([{ label: 'PB Burden', color: C.purple, fill: true, values: roll7pb }], dates, { yMin: 0, dec: 0 });
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.purple +
          '"></div>Rolling avg oscillation crossings — rising = worsening PB trend</div></div></div>';
      }

      // Chart: WtDSI per Night
      if (
        nights.some(function (n) {
          return n.spo2Adv;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('WtDSI per Night (custom weighted desat severity)', 'WtDSI');
        html += lineChart(
          [
            {
              label: 'WtDSI',
              color: C.orange,
              fill: true,
              values: nights.map(function (n) {
                return n.spo2Adv ? n.spo2Adv.wtdsi : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 3 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.orange +
          '"></div>Σ(depth²×duration)/totalTime — custom depth²×duration index · <1.0 normal</div></div></div>';
      }

      // Chart: Nocturnal Stress Index
      if (
        nights.some(function (n) {
          return n.comp;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('Nocturnal Stress Index (0-100)', 'NSI');
        html += lineChart(
          [
            {
              label: 'NSI',
              color: C.red,
              fill: true,
              values: nights.map(function (n) {
                return n.comp ? n.comp.nsi : 0;
              })
            }
          ],
          dates,
          { yMin: 0, yMax: 100, dec: 0 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.red +
          '"></div>Composite: dip rate + AUC-90 + T95% + AAI — <30 green · 60-79 warn · ≥80 bad</div></div></div>';
      }

      // Chart: RMSSD proxy per Night
      if (
        nights.some(function (n) {
          return n.hrAdv;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('RMSSD Proxy per Night (1Hz HRV)', 'RMSSD');
        html += lineChart(
          [
            {
              label: 'RMSSD',
              color: C.teal,
              fill: true,
              values: nights.map(function (n) {
                return n.hrAdv ? n.hrAdv.rmssd : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 2 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.teal +
          '"></div>√(mean diff²) of clean HR — 1Hz proxy only · higher = more HRV variability</div></div></div>';
      }

      // Chart: Sleep Fragmentation Index
      if (
        nights.some(function (n) {
          return n.comp;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('Sleep Fragmentation Index (/hr)', 'SFI');
        html += lineChart(
          [
            {
              label: 'SFI',
              color: C.amber,
              fill: true,
              values: nights.map(function (n) {
                return n.comp ? n.comp.sfi : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 1 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.amber +
          '"></div>(WASO + HR spikes + osc episodes)/hr — <3 good · >6 elevated</div></div></div>';
      }

      // Chart: SBII per Night (CVD mortality predictor — Hui 2024)
      if (
        nights.some(function (n) {
          return n.sbii;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('SBII per Night — CVD Mortality Predictor', 'SBII');
        html += lineChart(
          [
            {
              label: 'SBII',
              color: C.red,
              fill: true,
              values: nights.map(function (n) {
                return n.sbii ? n.sbii.sbii : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 3 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.red +
          '"></div>SHHS quintiles: Q1<2.58 · Q2 2.58–6.49 · Q3 6.49–12.8 · Q4 12.8–25.54 · Q5>25.54 (%min²/hr)</div></div></div>';
      }

      // Chart: pRED-3p per Night (CVD morbidity predictor — Hui 2024)
      if (
        nights.some(function (n) {
          return n.pred3p;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('pRED-3p per Night — CVD Morbidity Predictor', 'pRED-3p');
        html += lineChart(
          [
            {
              label: 'pRED-3p',
              color: C.purple,
              fill: true,
              values: nights.map(function (n) {
                return n.pred3p ? n.pred3p.pred3p : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 2 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.purple +
          '"></div>SHHS quintiles: Q1<2.78% · Q2 2.78–6.19% · Q3 6.19–10.84% · Q4 10.84–19.04% · Q5>19.04%</div></div></div>';
      }

      // Chart: DesSev per Night
      if (
        nights.some(function (n) {
          return n.desSev;
        })
      ) {
        html += '<div class="chart-wrap">';
        html += chartTitle('DesSev per Night (Kulkas area-based)', 'DesSev');
        html += lineChart(
          [
            {
              label: 'DesSev',
              color: C.orange,
              fill: true,
              values: nights.map(function (n) {
                return n.desSev ? n.desSev.desSev : 0;
              })
            }
          ],
          dates,
          { yMin: 0, dec: 2 }
        );
        html +=
          '<div class="chart-legend"><div class="legend-item"><div class="legend-line" style="background:' +
          C.orange +
          '"></div>%-min/hr area under desaturation curve — fully automated, no manual scoring needed</div></div></div>';
      }

      html += '</div>'; // /.chart-grid ADVANCED trends
      html += '</details>'; // /#sec-trends-advanced

      // ── Multi-night Statistical Summary ──
      // Built here but rendered AFTER Spike Timeline (per user request) — captured into a variable.
      var _mnsHtml = '';
      if (nights.length >= 3) {
        var stabs = nights
          .map(function (n) {
            return n.stab ? n.stab.score : null;
          })
          .filter(function (v) {
            return v !== null;
          });
        var lr = linReg(stabs);
        var bestNight =
          nights.length > 1
            ? nights.reduce(function (a, b) {
                return b.stab && a.stab && b.stab.score != null && a.stab.score != null && b.stab.score > a.stab.score ? b : a;
              })
            : nights[0];
        var worstNight =
          nights.length > 1
            ? nights.reduce(function (a, b) {
                return b.stab && a.stab && b.stab.score != null && a.stab.score != null && b.stab.score < a.stab.score ? b : a;
              })
            : nights[0];
        var trend = lr.slope > 0.5 ? '📈 Improving (+' + lr.slope + '/night)' : lr.slope < -0.5 ? '📉 Declining (' + lr.slope + '/night)' : '➡ Stable (' + lr.slope + '/night)';
        _mnsHtml += '<div class="sec-label">Multi-Night Summary</div>';
        _mnsHtml += '<div class="mns-card">';
        // ── Row 1: Best/Worst/R²/Trend ──────────────────────────────
        _mnsHtml += '<div class="mns-row-label">Stability overview</div>';
        _mnsHtml +=
          '<div class="grid">' +
          metric('Best Night', bestNight.date, 'score ' + (bestNight.stab ? bestNight.stab.score : '—'), 'good') +
          metric('Worst Night', worstNight.date, 'score ' + (worstNight.stab ? worstNight.stab.score : '—'), 'bad') +
          metric('Stability R²', lr.r2, 'regression fit', '') +
          metric('Trend', lr.slope > 0 ? '+' + lr.slope : lr.slope, 'pts/night', lr.slope > 0 ? 'good' : lr.slope > -1 ? 'warn' : 'bad') +
          '</div>';
        _mnsHtml +=
          '<div class="mns-trend-pill">' +
          '<span class="mns-trend-icon">' +
          (lr.slope > 0.5 ? '📈' : lr.slope < -0.5 ? '📉' : '➡') +
          '</span>' +
          '<span class="mns-trend-txt">' +
          trend +
          '</span>' +
          '</div>';

        // v20.3 Tier 4 longitudinal metrics — always runs since we're inside nights.length>=3
        {
          var t4html = '';
          // NSI mean ± SD
          var nsiVals = nights
            .map(function (n) {
              return n.comp ? n.comp.nsi : null;
            })
            .filter(function (v) {
              return v !== null;
            });
          if (nsiVals.length >= 3) {
            var nsiMean = +(
              nsiVals.reduce(function (a, b) {
                return a + b;
              }, 0) / nsiVals.length
            ).toFixed(1);
            var nsiSD = +Math.sqrt(
              nsiVals.reduce(function (a, v) {
                return a + (v - nsiMean) * (v - nsiMean);
              }, 0) / nsiVals.length
            ).toFixed(1);
            t4html += metric('NSI Mean (' + nsiVals.length + 'n)', nsiMean, '± ' + nsiSD, nsiMean < 30 ? 'good' : nsiMean < 60 ? 'warn' : 'bad');
          }
          // SpO2 night-to-night CV
          var spo2Vals = nights
            .map(function (n) {
              return n.stats ? n.stats.meanSpo2 : null;
            })
            .filter(function (v) {
              return v !== null;
            });
          if (spo2Vals.length >= 3) {
            var spo2Mean =
              spo2Vals.reduce(function (a, b) {
                return a + b;
              }, 0) / spo2Vals.length;
            var spo2SD = Math.sqrt(
              spo2Vals.reduce(function (a, v) {
                return a + (v - spo2Mean) * (v - spo2Mean);
              }, 0) / spo2Vals.length
            );
            var spo2CV = oxySpo2NightCV(spo2SD, spo2Mean);
            t4html += metric('SpO2 Night CV', spo2CV + '%', 'variability', spo2CV < 0.5 ? 'good' : spo2CV < 1 ? 'warn' : 'bad');
          }
          // PB burden trend
          var pbVals = nights
            .map(function (n, i) {
              return n.osc ? { x: i, y: n.osc.episodeCount } : null;
            })
            .filter(function (v) {
              return v !== null;
            });
          if (pbVals.length >= 3) {
            var pbLr = linReg(
              pbVals.map(function (v) {
                return v.x;
              }),
              pbVals.map(function (v) {
                return v.y;
              })
            );
            t4html += metric('PB Trend', pbLr.slope > 0 ? '+' + pbLr.slope : pbLr.slope, 'episodes/night', pbLr.slope < 0 ? 'good' : pbLr.slope < 1 ? 'warn' : 'bad');
          }
          // Worst-night recurrence
          var poorNights = nights.filter(function (n) {
            return n.stab && n.stab.score < 50;
          }).length;
          var poorPct = +((poorNights / nights.length) * 100).toFixed(0);
          t4html += metric('Poor Nights (<50)', poorPct + '%', poorNights + ' of ' + nights.length, poorPct < 20 ? 'good' : poorPct < 50 ? 'warn' : 'bad');
          // CPAP efficacy delta (ODI-4 change)
          var odi4Vals = nights
            .map(function (n) {
              return n.odi4 ? n.odi4.rate : null;
            })
            .filter(function (v) {
              return v !== null;
            });
          if (odi4Vals.length >= 2) {
            var odi4Delta = +(odi4Vals[odi4Vals.length - 1] - odi4Vals[0]).toFixed(1);
            t4html += metric('ODI-4 Δ (first→last)', odi4Delta > 0 ? '+' + odi4Delta : odi4Delta, '/hr change', odi4Delta < 0 ? 'good' : odi4Delta < 1 ? 'warn' : 'bad');
          }
          // SOL trend
          var solVals = nights
            .map(function (n, i) {
              return n.sleepArch && n.sleepArch.solMin !== null ? { x: i, y: n.sleepArch.solMin } : null;
            })
            .filter(function (v) {
              return v !== null;
            });
          if (solVals.length >= 3) {
            var solLr = linReg(
              solVals.map(function (v) {
                return v.x;
              }),
              solVals.map(function (v) {
                return v.y;
              })
            );
            t4html += metric('SOL Trend', solLr.slope > 0 ? '+' + solLr.slope : solLr.slope, 'min/night', solLr.slope < 0 ? 'good' : solLr.slope < 2 ? 'warn' : 'bad');
          }
          if (t4html) {
            _mnsHtml += '<div class="mns-divider"></div>';
            _mnsHtml += '<div class="mns-row-label">Longitudinal metrics</div>';
            _mnsHtml += '<div class="grid">' + t4html + '</div>';
          }
        } // end tier-4 block

        // ── Robustness layer (shared crossNight() engine, §1c) — ADDITIVE ──
        // Adds Mann–Kendall (τ,p), bootstrap 95% CI & personal-baseline z-scores on top
        // of the existing stats above. Existing rows/numbers are untouched.
        if (window.OXYCross) {
          var _chrono = nights.slice().reverse(); // nights is DESC (newest first) → ascending for trend
          var _rbHtml = '',
            _rbHead = [];
          var _rbDefs = [
            { key: 'odi4', label: 'ODI-4', unit: '/hr' },
            { key: 'meanSpo2', label: 'Mean SpO₂', unit: '%' },
            { key: 't90', label: 'T90', unit: '%' },
            { key: 'nsi', label: 'NSI', unit: '' },
            { key: 'sleepEff', label: 'Sleep Eff', unit: '%' },
            { key: 'meanHr', label: 'Mean HR', unit: 'bpm' }
          ];
          _rbDefs.forEach(function (rd) {
            var def = window.OXYCross.OXY_DEFS[rd.key];
            if (!def) return;
            var ser = _chrono
              .map(function (n, i) {
                return { x: i, t: window.OXYCross.nightTms(n), v: def.get(n), w: window.OXYCross.nightWeight(n) };
              })
              .filter(function (p) {
                return p.v != null && isFinite(p.v);
              });
            if (ser.length < 3) return;
            var st = window.OXYCross.crossNight(ser, { good: def.good });
            var zsev = st.zLatest == null ? '' : Math.abs(st.zLatest) >= DexKernel.K.Z_BAD ? 'bad' : Math.abs(st.zLatest) >= DexKernel.K.Z_WARN ? 'warn' : 'good';
            var ciSig = st.ci && (st.ci[0] > 0 || st.ci[1] < 0) ? ' · Δ sig' : '';
            var sub = 'τ ' + (st.tau == null ? '—' : st.tau) + ' · p ' + (st.p == null ? '—' : st.p) + ' · ' + st.trendLabel + ciSig;
            _rbHtml += metric(rd.label + ' z', st.zLatest == null ? '—' : (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ', sub, zsev);
            if (st.zLatest != null && Math.abs(st.zLatest) >= DexKernel.K.Z_HEADLINE) _rbHead.push(rd.label + ' ' + (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ vs baseline');
          });
          if (_rbHtml) {
            _mnsHtml += '<div class="mns-divider"></div>';
            _mnsHtml +=
              '<div class="mns-row-label">Robustness · personal baseline &amp; non-parametric trend ' +
              '<span style="opacity:.6;font-weight:var(--fw-regular)">shared crossNight() engine — Mann–Kendall τ/p · bootstrap 95% CI · z-scores · coverage-weighted</span></div>';
            _mnsHtml += '<div class="grid">' + _rbHtml + '</div>';
            if (_rbHead.length)
              _mnsHtml += '<div class="mns-trend-pill"><span class="mns-trend-icon">📌</span><span class="mns-trend-txt">Newest night: ' + _rbHead.slice(0, 3).join(' · ') + '</span></div>';
          }
        } // end robustness layer

        _mnsHtml += '</div>'; // /.mns-card — always close (opened at start of nights>=3 block above)
      }
    } // if nights.length >= 2 — end of main chart-grid section

    // ── VO₂max trend graph REMOVED 2026-06-22 (per review) — the per-night
    // VO₂max estimate cards remain; the noisy research-tier trend line is gone.

    // ── Spike Timeline (next chart) ───────────────────────────────────
    if (
      nights.some(function (n) {
        return n.spikes && n.spikes.length > 0;
      })
    ) {
      html += '<div class="chart-grid"><div class="chart-wrap">';
      html += chartTitle('Spike Timeline · dot size = magnitude · teal bar = osc windows · blue = desat events', 'HR Spikes');
      html += spikeTimeline(nights);
      html += '<div class="chart-legend">';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.purple + ';width:6px;height:6px"></div>HR spike mild ≤25 BPM</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.amber + ';width:7px;height:7px"></div>HR med 26–40</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.red + ';width:9px;height:9px"></div>HR major &gt;40</div>';
      html += '<div class="legend-item"><div class="legend-dot" style="background:' + C.blue + ';width:7px;height:7px;opacity:0.5"></div>desat event (size = depth × duration)</div>';
      html += '<div class="legend-item"><div style="width:14px;height:3px;background:' + C.teal + ';border-radius:1px"></div>osc windows</div>';
      html += '</div>';
      html += '</div></div>';
    }

    // ── Multi-Night Summary — rendered AFTER Spike Timeline (per user request) ──
    if (_mnsHtml) html += _mnsHtml;

    // ── SUMMARY TABLE ────────────────────────
    html += '<div class="sec-label sec-label-lg" id="sec-nights">Night Summary</div>';
    // Research-mode night-jump rail — fixed anchors to leap between nights
    // without scrolling the (still long) expanded dumps. Hidden in core/advanced
    // and toggled by syncAccordions().
    html += '<div id="nightJumpRail" aria-label="Jump to night">';
    html += '<div class="njr-title">Nights</div>';
    nights.forEach(function (n, idx) {
      var lbl = typeof shortDate === 'function' ? shortDate(n.date) : escHTML(String(n.date).slice(0, 10));
      html +=
        '<button class="njr-item' +
        (idx === 0 ? ' njr-latest' : '') +
        '" data-act="jumpToNight" data-idx="' +
        idx +
        '" title="' +
        escHTML(n.date) +
        '">' +
        '<span class="njr-idx">' +
        (idx === 0 ? '★' : idx + 1) +
        '</span>' +
        '<span class="njr-date">' +
        lbl +
        '</span>' +
        '</button>';
    });
    html += '</div>';
    html += '<div class="night-table">';
    nights.forEach(function (n, idx) {
      html +=
        '<div class="night-row" aria-label="Night ' +
        escHTML(n.date) +
        ' — click to expand details" aria-expanded="false" data-act="toggleDetail" data-det="det' +
        idx +
        '" role="button" tabindex="0" data-act-keydown="toggleDetailKey">';
      try {
        html += nightRowInner(n);
      } catch (e) {
        html += '<div class="render-error-inline">⚠️ Row error (' + escHTML(n.date) + '): ' + escHTML(e.message) + '</div>';
      }
      html += '</div>';
      html += '<div class="night-detail" id="det' + idx + '" role="region" aria-label="Details for night ' + n.date + '">';
      try {
        html += nightDetail(n, idx);
      } catch (e) {
        html +=
          '<div class="render-error-detail">⚠️ Detail error (' +
          escHTML(n.date) +
          '): ' +
          escHTML(e.message) +
          '<br><small>' +
          escHTML((e.stack || '').split('\n').slice(1, 3).join(' | ')) +
          '</small></div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // ── FULL METRICS TABLE (ECGDex-style) — most-recent night, all modes ──
    if (last) {
      try {
        if (typeof oxyFrontFullTable === 'function') html += oxyFrontFullTable(last);
      } catch (_fte) {}
    }

    // ── EXPORTS — render into dedicated fixed bar outside #results ──
    var _exportBar = document.getElementById('exportBar');
    if (_exportBar) {
      var _ebHtml = '<span class="eb-label">Export</span>';
      _ebHtml += '<div class="eb-grp">';
      _ebHtml += '<button class="eb-btn eb-json" type="button" data-act="exportJSON">⬇ JSON' + (_review ? ' (derived)' : '') + '</button>';
      _ebHtml += '<button class="eb-btn eb-csv" type="button" data-act="exportCSV">⬇ CSV</button>';
      _ebHtml += '<button class="eb-btn eb-pdf" type="button" data-act="print">' + (_review ? '🖨 Clinical PDF' : '⬇ PDF') + '</button>';
      // SELF-INGEST §5 — "scrub for sharing" toggle (default OFF): strips the device serial / filename /
      // input sha256 from the exported JSON while keeping the clinical summary + a coarse build stamp.
      var _scrubOn = !!(typeof window !== 'undefined' && window._oxyScrub);
      _ebHtml +=
        '<label class="eb-scrub" title="Strip device serial / filename / input hash from the exported JSON — keeps the clinical summary + a coarse build stamp. For sharing with a clinician.">' +
        '<input type="checkbox" ' +
        (_scrubOn ? 'checked ' : '') +
        'data-act-change="oxySetScrub"> Scrub for sharing</label>';
      _ebHtml += '</div>';
      _ebHtml += '<span class="eb-spacer"></span>';
      _ebHtml += '<div class="eb-grp">';
      _ebHtml += '<button class="eb-btn eb-ghost" type="button" data-act="downloadParser">⬇ Parser</button>';
      _ebHtml += '<button class="eb-btn eb-ghost" type="button" data-act="addMoreFiles">＋ Add files</button>';
      _ebHtml += '<button class="eb-btn eb-danger" type="button" data-act="clearAll">✕ Clear</button>';
      _ebHtml += '</div>';
      _exportBar.innerHTML = _ebHtml;
      _exportBar.style.display = 'flex';
    }

    safeStyle('uploadArea', 'display', 'none');
    safeSet('results', 'innerHTML', html);
    safeStyle('results', 'display', 'block');
    try {
      document.dispatchEvent(new Event('renderComplete'));
    } catch (_rce) {}
    if (window.initCollapsible) window.initCollapsible(null);
    // Auto-detect profile from uploaded data
    try {
      profileAutoDetectUpdate(nights);
    } catch (_pe) {}
    // Reveal profile panel — preserve profileBody open/closed state
    var _pp = document.getElementById('userProfilePanel');
    if (_pp) {
      _pp.style.display = 'block';
      _pp.style.animation = 'fadeIn 0.4s ease';
      // Relocate the panel to sit directly under the readiness hero + ANS-age
      // row (full-width, like ECGDex) so the user can change/add data instantly.
      // IMPORTANT: insert AFTER the #heroTop grid container, not inside it —
      // nesting it between the hero and the ANS-age card squished the grid.
      var _heroTopEl = document.getElementById('heroTop');
      if (_heroTopEl && _heroTopEl.parentElement) {
        _heroTopEl.parentElement.insertBefore(_pp, _heroTopEl.nextSibling);
        _pp.style.marginTop = 'var(--sp-4)';
      } else {
        var _heroForPanel = document.getElementById('sec-readiness');
        if (_heroForPanel && _heroForPanel.parentElement) {
          _heroForPanel.parentElement.insertBefore(_pp, _heroForPanel.nextSibling);
          _pp.style.marginTop = 'var(--sp-4)';
        }
      }
      // Restore profileBody state: keep it open if it was open before re-render
      var _pb = document.getElementById('profileBody');
      var _pBtn = document.getElementById('profileToggleBtn');
      if (_pb) {
        var _wasOpen = _pb.dataset.open !== 'false';
        // v2: profile starts COLLAPSED on first render (both desktop + mobile).
        // Readers see the readiness hero first; the form opens on demand.
        if (_pb.dataset.open === undefined || _pb.dataset.open === '') {
          _wasOpen = false;
        }
        _pb.style.display = _wasOpen ? 'block' : 'none';
        _pb.dataset.open = _wasOpen ? 'true' : 'false';
        if (_pBtn) _pBtn.textContent = _wasOpen ? '▲ collapse' : '▼ expand';
      }
    }
  } catch (e) {
    var errDetail = e.message + (e.stack ? ' @ ' + e.stack.split('\n').slice(1, 3).join(' | ') : '');
    // Do NOT call showError() here — it scrolls to page top (looks like "back to front page" on Android)
    // Instead, show the error inline where the results would appear
    var errEl = document.getElementById('results');
    if (errEl) {
      errEl.innerHTML =
        '<div class="results-error-block">' +
        '<strong>⚠ Render Error</strong><br><code class="error-code">' +
        errDetail +
        '</code>' +
        '<br><br><button class="btn btn-outline" data-act="clearAll">Clear &amp; try again</button></div>';
      errEl.style.display = 'block';
    }
    safeStyle('uploadArea', 'display', 'none');
    console.error('renderAll crash:', e);
  }
}

function renderSmartSummary(n) {
  if (!n.summary) return '';
  var s = n.summary;
  var sc = s.overallScore < 3 ? 'ss-good' : s.overallScore < 6 ? 'ss-warn' : 'ss-bad';
  var st = n.stats,
    h = n.hrv,
    sa = n.sleepArch;

  function cv(val, goodMax, warnMax, unit, invert) {
    if (val == null || val === undefined) return '<span class="val-null">—</span>';
    if (goodMax == null || warnMax == null) return '<span class="cv-neutral">' + val + (unit || '') + '</span>';
    var cls = invert ? (val <= goodMax ? 'cv-bad' : val <= warnMax ? 'cv-warn' : 'cv-good') : val <= goodMax ? 'cv-good' : val <= warnMax ? 'cv-warn' : 'cv-bad';
    return '<span class="' + cls + '">' + val + (unit || '') + '</span>';
  }

  var durH = st ? Math.floor(st.durationMin / 60) : 0;
  var durM = st ? Math.round(st.durationMin % 60) : 0;

  var html = '<div class="smart-summary">';
  html += '<div class="ss-impression ' + sc + '">' + s.impression + '</div>';

  // ── Three proj-cards side-by-side (no more tabs — all visible) ────
  // sc-equivalent severity for each card border: derived from KPIs in that
  // category. For simplicity reuse the overall severity for all three; the
  // individual KPI tiles inside already carry their own per-metric colours.
  var _cardSev = sc === 'ss-good' ? 'good' : sc === 'ss-warn' ? 'warn' : 'bad';
  html += '<div class="proj-grid">';

  // ── CARD: OXYGEN ───────────────────────────────────────────────
  html += '<div class="proj-card proj-' + _cardSev + '">';
  html += '<div class="proj-header">' + '<span class="cat-tag cat-ox">O₂</span>' + '<span class="proj-title">Oxygen</span>' + '</div>';
  html += '<div class="ss-kpi-grid">';
  if (st) {
    html += ssKPI('Mean SpO₂', cv(st.meanSpo2, 93 - upSpo2Adj(), 95 - upSpo2Adj(), '%', true), st.meanSpo2 >= 95 - upSpo2Adj() ? 'good' : st.meanSpo2 >= 93 - upSpo2Adj() ? 'warn' : 'bad');
    html += ssKPI('Min SpO₂', cv(st.minSpo2, 85 - upSpo2Adj(), 90 - upSpo2Adj(), '%', true), st.minSpo2 >= 90 - upSpo2Adj() ? 'good' : st.minSpo2 >= 85 - upSpo2Adj() ? 'warn' : 'bad');
    html += ssKPI('T95% Time', cv(st.t95pct, 5, 15, '%'), st.t95pct < 5 ? 'good' : st.t95pct < 15 ? 'warn' : 'bad');
    html += ssKPI('T90% Time', cv(st.t90pct, 0.5, 2, '%'), st.t90pct < 0.5 ? 'good' : st.t90pct < 2 ? 'warn' : 'bad');
  }
  if (n.odi4) html += ssKPI('ODI-4 Rate', cv(n.odi4.rate, 5, 15, '/hr'), n.odi4.rate < 5 ? 'good' : n.odi4.rate < 15 ? 'warn' : 'bad');
  if (n.odi3) html += ssKPI('ODI-3 Rate', cv(n.odi3.rate, 5, 15, '/hr'), n.odi3.rate < 5 ? 'good' : n.odi3.rate < 15 ? 'warn' : 'bad');
  if (n.t88t85) html += ssKPI('T88 Time', cv(n.t88t85.t88Min, 0, 1, 'min'), n.t88t85.t88Min === 0 ? 'good' : n.t88t85.t88Min < 1 ? 'warn' : 'bad');
  if (n.hypDose) html += ssKPI('HD94/hr', cv(n.hypDose.hd94PerHr, 60, 200, ''), n.hypDose.hd94PerHr < 60 ? 'good' : n.hypDose.hd94PerHr < 200 ? 'warn' : 'bad');
  if (n.odri) html += ssKPI('ODRI', cv(n.odri.odri, null, null, ''), 'neutral');
  if (n.spo2Shape) html += ssKPI('SpO₂ Skew', cv(n.spo2Shape.spo2Skew, -1, -0.5, '', true), n.spo2Shape.spo2Skew > -0.5 ? 'good' : n.spo2Shape.spo2Skew > -1 ? 'warn' : 'bad');
  html += '</div>';
  html += ssIssuesBars(s.top5, 'spo2');
  html += '</div>'; // /.proj-card oxygen

  // ── CARD: CARDIO ───────────────────────────────────────────────
  html += '<div class="proj-card proj-' + _cardSev + '">';
  html += '<div class="proj-header">' + '<span class="cat-tag cat-hr">HR</span>' + '<span class="proj-title">Cardio</span>' + '</div>';
  html += '<div class="ss-kpi-grid">';
  if (st) {
    html += ssKPI('Mean HR', cv(st.meanHr, 60, 70, 'bpm'), st.meanHr < 60 ? 'good' : st.meanHr < 70 ? 'warn' : 'bad');
    html += ssKPI('Min HR', cv(st.minHr, 35, 40, 'bpm', true), st.minHr >= 40 ? 'good' : st.minHr >= 35 ? 'warn' : 'bad');
    html += ssKPI('Max HR', cv(st.maxHr, 90, 110, 'bpm'), st.maxHr < 90 ? 'good' : st.maxHr < 110 ? 'warn' : 'bad');
    // Perfusion index (OXYDEX-PULSE-RESOURCING §4 Phase 1) — rendered ONLY when the capture carried it
    // (Health-Box OXYFRAME). A ViHealth CSV night has meanPi === null and simply omits the card, rather
    // than showing a fabricated 0 or a "—" on every night that never had a PI sensor reading. The badge
    // is auto-wired from the `meanPi` registry entry by label (measured).
    if (st.meanPi != null) html += ssKPI('Perfusion Idx', cv(st.meanPi, 0.4, 1, '%', true), st.meanPi >= 1 ? 'good' : st.meanPi >= 0.4 ? 'warn' : 'bad');
    html += ssKPI(
      'HR Spikes',
      cv(n.spikes && n.spikes.length != null ? n.spikes.length : null, 3, 10, ''),
      !n.spikes || !n.spikes.length || n.spikes.length < 3 ? 'good' : n.spikes.length < 10 ? 'warn' : 'bad'
    );
  }
  if (h) {
    html += ssKPI('RMSSD', cv(h.rmssd, null, null, 'bpm*'), 'neutral'); // *1Hz proxy, not true ms
    html += ssKPI('HR-Var SD', cv(h.hrSdnn, 2, 3, 'bpm', true), h.hrSdnn >= 3 ? 'good' : h.hrSdnn >= 2 ? 'warn' : 'bad');
    html += ssKPI('HR Floor', cv(h.hrFloor, 52, 60, 'bpm'), h.hrFloor <= 52 ? 'good' : h.hrFloor <= 60 ? 'warn' : 'bad');
    html += ssKPI('HR Slope', cv(h.hrSlope, 0, 1, '/hr'), h.hrSlope <= 0 ? 'good' : h.hrSlope < 1 ? 'warn' : 'bad');
    html += ssKPI('Noc. Dip', cv(n.hrnDip ? n.hrnDip.hrnDip : null, null, null, '% (intra)'), 'neutral');
  }
  if (n.poincare) {
    html += ssKPI('SD1', cv(n.poincare.sd1, null, null, 'bpm*'), 'neutral');
    html += ssKPI('SD1/SD2', cv(n.poincare && n.poincare.sd1sd2Ratio != null ? n.poincare.sd1sd2Ratio : null, null, null, ''), 'neutral');
  }
  if (n.karv && n.karv.zones && n.karv.zones.z2) {
    html += ssKPI('Readiness', cv(n.karv.readiness, null, null, '%'), n.karv.readinessColor || 'neutral');
    html += ssKPI('Z2 Window', '<span class="text-blue">' + (n.karv.zones.z2.low || '?') + '–' + (n.karv.zones.z2.high || '?') + ' bpm</span>', 'neutral');
    html += ssKPI('MAF HR', '<span class="text-yellow">' + (n.karv.mafHR || '?') + ' bpm</span>', 'neutral');
  }
  html += '</div>';
  html += '<p class="hrv-proxy-note">* = summary-mode proxy derived from 1Hz HR data, not raw RR intervals. Use for trend tracking only, not clinical HRV comparison.</p>';
  html += ssIssuesBars(s.top5, 'hr');
  html += '</div>'; // /.proj-card cardio

  // ── CARD: SLEEP ────────────────────────────────────────────────
  html += '<div class="proj-card proj-' + _cardSev + '">';
  html += '<div class="proj-header">' + '<span class="cat-tag cat-slp">SL</span>' + '<span class="proj-title">Sleep</span>' + '</div>';
  html += '<div class="ss-kpi-grid">';
  var durStr = durH + 'h ' + (durM < 10 ? '0' : '') + durM + 'm';
  html += ssKPI('Duration', '<span class="' + (durH >= 7 ? 'cv-good' : durH >= 6 ? 'cv-warn' : 'cv-bad') + '">' + durStr + '</span>', durH >= 7 ? 'good' : durH >= 6 ? 'warn' : 'bad');
  if (sa) {
    var _motPct = st ? st.motionPct : null;
    html += ssKPI('SOL', cv(sa.solMin, 15, 30, 'min'), sa.solMin == null ? 'neutral' : sa.solMin < 15 ? 'good' : sa.solMin < 30 ? 'warn' : 'bad');
    html += ssKPI('WASO', cv(sa.wasoMin, 20, 45, 'min'), sa.wasoMin == null ? 'neutral' : sa.wasoMin < 20 ? 'good' : sa.wasoMin < 45 ? 'warn' : 'bad');
    html += ssKPI('Motion', cv(_motPct, 10, 20, '%'), _motPct != null && _motPct < 10 ? 'good' : _motPct != null && _motPct < 20 ? 'warn' : 'bad');
  } else if (n.motSleep) {
    var ms = n.motSleep;
    if (ms.sleepEff != null) html += ssKPI('Sleep Eff', cv(ms.sleepEff, 80, 90, '%', true), ms.sleepEff >= 90 ? 'good' : ms.sleepEff >= 80 ? 'warn' : 'bad');
    if (ms.wasoPct != null) html += ssKPI('WASO %', cv(ms.wasoPct, 5, 15, '%'), ms.wasoPct < 5 ? 'good' : ms.wasoPct < 15 ? 'warn' : 'bad');
    if (ms.posShifts != null) html += ssKPI('Pos Shifts', cv(ms.posShifts, 2, 4, ''), ms.posShifts <= 2 ? 'good' : ms.posShifts <= 4 ? 'warn' : 'bad');
  }
  if (n.lcsp) html += ssKPI('LCSP', cv(n.lcsp.lcspMin, 45, 90, 'min', true), n.lcsp.lcspMin >= 90 ? 'good' : n.lcsp.lcspMin >= 45 ? 'warn' : 'bad');
  if (n.stageProxy && n.stageProxy.remProxyMin != null) {
    // DEEP-AUDIT §7: an IMPLAUSIBLE REM proxy (>30% of the recording — the estimator over-firing on quiet
    // sleep) must never render as 'good'. The more minutes it claims, the LESS trustworthy it is, so the
    // old `remProxyMin>=45 ? 'good'` rule graded the failure mode as the healthiest result.
    var _remImplausible = n.stageProxy.plausible === false;
    html += ssKPI(
      'REM ~est',
      cv(n.stageProxy.remProxyMin, null, null, 'min'),
      _remImplausible ? 'bad' : n.stageProxy.remProxyMin >= 45 ? 'good' : n.stageProxy.remProxyMin >= 20 ? 'warn' : 'bad',
      _remImplausible ? 'unreliable — see note' : null
    );
    html += ssKPI(
      'Deep ~est',
      cv(n.stageProxy.nremDeepMin != null ? n.stageProxy.nremDeepMin : null, null, null, 'min'),
      (n.stageProxy.nremDeepMin || 0) >= 60 ? 'good' : (n.stageProxy.nremDeepMin || 0) >= 30 ? 'warn' : 'bad'
    );
    if (_remImplausible && n.stageProxy.plausibilityNote) {
      html += '<div class="ss-note" style="grid-column:1/-1;opacity:.85;font-size:.82em;line-height:1.35">⚠ ' + escapeHTML(n.stageProxy.plausibilityNote) + '</div>';
    }
  }
  if (n.osc) html += ssKPI('Osc Windows', cv(n.osc.episodeCount, 2, 5, ''), n.osc.episodeCount < 2 ? 'good' : n.osc.episodeCount < 5 ? 'warn' : 'bad');
  if (n.spo2NadirT) html += ssKPI('SpO₂ Nadir', cv(n.spo2NadirT.spo2NadirValue, null, null, '%'), 'neutral');
  html += '</div>';
  html += ssIssuesBars(s.top5, 'sleep');
  html += '</div>'; // /.proj-card sleep

  // ── CARD: VO₂MAX ESTIMATE — sits beside Sleep in the same grid ──
  if (n.vo2est) {
    var _v = n.vo2est;
    var _vc = _v.vo2est >= 42 ? 'good' : _v.vo2est >= 35 ? 'warn' : 'bad';
    html += '<div class="proj-card proj-' + _vc + '">';
    html +=
      '<div class="proj-header">' +
      '<span class="cat-tag cat-vo2">VO₂</span>' +
      '<span class="proj-title">' +
      evBadge('vo2est') +
      'VO₂max Estimate</span>' +
      '<span class="proj-badge proj-' +
      _vc +
      '">' +
      (_v.vo2Category || '—') +
      '</span>' +
      '</div>';
    html += '<div class="proj-main"><div class="proj-value proj-val-' + _vc + '">' + _v.vo2est + '</div><div class="proj-unit">ml/kg/min</div></div>';
    if (_v.vo2Low != null && _v.vo2High != null) html += '<div class="proj-range">Range: ' + _v.vo2Low + ' – ' + _v.vo2High + ' ml/kg/min (±' + (_v.see || 0) + ' SEE)</div>';
    html += '<div class="ss-kpi-grid">';
    var _hrRestSrc = UP.hrRestOverride && UP.hrRestOverride > 30 ? 'manual' : 'p5';
    html += ssKPI('HR Rest', '<span class="cv-neutral">' + _v.hrRest + ' bpm</span>', 'neutral', _hrRestSrc);
    html += ssKPI('HR Max', '<span class="cv-neutral">' + _v.hrMax + ' bpm</span>', 'neutral', _v.hrMaxSource || 'Tanaka');
    if (_v.vo2Conf != null) html += ssKPI('Confidence', '<span class="cv-' + _vc + '">' + _v.vo2Conf + '%</span>', _vc);
    html += '</div>';
    html += '</div>'; // /.proj-card vo2max
  }

  html += '</div>'; // /.proj-grid
  html += '</div>'; // /.smart-summary
  return html;
}

function ssKPI(label, valHtml, cls, sublabel) {
  return (
    '<div class="ss-kpi ' +
    (cls || 'neutral') +
    '">' +
    '<div class="ss-kpi-label">' +
    evBadge(label) +
    label +
    '</div>' +
    '<div class="ss-kpi-val">' +
    valHtml +
    '</div>' +
    (sublabel ? '<div class="ss-kpi-sub">' + sublabel + '</div>' : '') +
    '</div>'
  );
}
// ── Evidence badge hook (System-Cohesion §3) ───────────────────
// Resolves a non-hue epistemic badge from the metric label via the local
// OXY_REGISTRY (oxydex-registry.js). Zero-touch: any render helper that emits
// a known metric label gets a badge automatically. Safe no-op if unloaded.
function evBadge(label, fallback) {
  try {
    return (window.OxyRegistry && window.OxyRegistry.badgeForLabel(label, fallback !== false)) || '';
  } catch (e) {
    return '';
  }
}
// Chart cards carry a leading evidence disc keyed to the chart's PRIMARY metric
// (not the title text) — central badge convention, mandate: chart cards are badged.
function chartTitle(title, metricLabel) {
  var b = typeof evBadge === 'function' ? evBadge(metricLabel || title) : '';
  return '<div class="chart-title">' + b + title + '</div>';
}
function ssIssuesBars(top5, cat) {
  if (!top5 || !top5.length) return '';
  var items = top5
    .filter(function (m) {
      return !cat || !m.cat || m.cat === cat;
    })
    .slice(0, 5);
  if (!items.length) return '';
  var h = '<div class="ss-rank-label">Top issues:</div><div class="ss-bars">';
  items.forEach(function (m) {
    var barW = Math.round(m.score * 10);
    h +=
      '<div class="ss-row"><div class="ss-label">' +
      evBadge(m.label) +
      m.label +
      '</div>' +
      '<div class="ss-bar-wrap"><div class="ss-bar ' +
      m.sev +
      '" style="width:' +
      barW +
      '%"></div></div>' +
      '<div class="ss-val ' +
      m.sev +
      '">' +
      m.displayVal +
      '</div></div>';
  });
  return h + '</div>';
}
function switchSStab(id, el) {
  var card = el.closest('.smart-summary');
  card.querySelectorAll('.ss-tab').forEach(function (t) {
    t.classList.remove('active');
  });
  card.querySelectorAll('.ss-tab-content').forEach(function (t) {
    t.classList.remove('active');
  });
  el.classList.add('active');
  var tabs = card.querySelectorAll('.ss-tab-content');
  tabs.forEach(function (t) {
    if (t.id && t.id.startsWith('sstab-' + id)) t.classList.add('active');
  });
}
function setGCWindow(days, el) {
  _gcWin = days;
  document.querySelectorAll('.gc-btn').forEach(function (b) {
    b.classList.remove('active');
  });
  if (el) el.classList.add('active');
  renderAll();
}
function setGCSmooth(k) {
  _gcSmooth = k && k > 0 ? k : 0;
  renderAll();
}

function nrKpi(label, val, cls) {
  return '<div class="nr-kpi"><div class="nr-kpi-label">' + evBadge(label) + label + '</div><div class="nr-kpi-val ' + stsCls(cls) + '">' + val + '</div></div>';
}
function nrChip(label, val, cls) {
  // metric chips carry an evidence dot BEFORE the label; flag/alert chips (empty val) stay bare
  var b = val !== '' && val != null && typeof evBadge === 'function' ? evBadge(label) : '';
  return '<span class="nr-chip ' + stsCls(cls) + '">' + b + '<span class="chip-label">' + label + '</span> ' + val + '</span>';
}
function nightRowInner(n) {
  var s = n.stats || {};
  var durH = Math.floor((s.durationMin || 0) / 60),
    durM = Math.round((s.durationMin || 0) % 60);
  var durFmt = durH + 'h' + (durM < 10 ? '0' : '') + durM + 'm';

  // ── Readiness pill ──
  var readScore = n.karv ? n.karv.readiness : n.stab ? n.stab.score : null;
  var readCls = n.karv ? n.karv.readinessColor : n.stab && n.stab.score ? (n.stab.score >= 80 ? 'good' : n.stab.score >= 60 ? 'warn' : 'bad') : '';
  var readPill = readScore != null ? '<span class="nr-readiness-pill ' + stsCls(readCls) + '">💪 ' + readScore + '</span>' : '';

  // ── LEFT: date + readiness ──
  var leftHtml = '<div class="nr-left">' + '<div class="nr-date-v22">' + n.date + '</div>' + '<div class="nr-dur">' + durFmt + '</div>' + readPill + '</div>';

  // ── CENTER: 5 core KPIs ──
  var centerHtml = '<div class="nr-center">';
  var _sAdj = upSpo2Adj();
  if (s.meanSpo2 != null) centerHtml += nrKpi('SpO₂', s.meanSpo2 + '%', s.meanSpo2 >= 95 - _sAdj ? 'g' : s.meanSpo2 >= 92 - _sAdj ? 'w' : 'r');
  if (s.minSpo2 != null) centerHtml += nrKpi('Min O₂', s.minSpo2 + '%', s.minSpo2 >= 90 - _sAdj ? 'g' : s.minSpo2 >= 85 - _sAdj ? 'w' : 'r');
  if (s.t90pct != null) centerHtml += nrKpi('T<90%', s.t90pct + '%', s.t90pct === 0 ? 'g' : s.t90pct < 0.5 ? 'w' : 'r');
  if (n.odi4) centerHtml += nrKpi('ODI-4', n.odi4.rate + '/h', n.odi4.rate < 5 ? 'g' : n.odi4.rate < 15 ? 'w' : 'r');
  if (n.karv && n.karv.zones && n.karv.zones.z2) centerHtml += nrKpi('Z2', n.karv.zones.z2.low + '–' + n.karv.zones.z2.high, 'g');
  else if (n.hrv) centerHtml += nrKpi('HR⌊', n.hrv.hrFloor + ' bpm', n.hrv.hrFloor <= 52 ? 'g' : n.hrv.hrFloor <= 60 ? 'w' : 'r');
  centerHtml += '</div>';

  // ── RIGHT: removed v22.40 — the chevron button was decorative-only
  //   (onclick was just event.stopPropagation), gave the false impression
  //   of being clickable. The whole night-row is already clickable.
  var rightHtml = '';

  // ── ADVANCED CHIPS (hidden panel, shown in advanced/research mode AND when row expanded) ──
  var chipsArr = [];
  var h = n.hrv;
  if (h) {
    chipsArr.push(nrChip('HR-Var', h.hrSdnn, h.hrSdnn >= 4 ? 'g' : h.hrSdnn >= 2.5 ? 'w' : 'r'));
    chipsArr.push(nrChip('pNN3', h.pnn3 + '%', h.pnn3 >= 1.5 ? 'g' : h.pnn3 >= 0.5 ? 'w' : 'r'));
    chipsArr.push(nrChip('HRsl', (h.hrSlope > 0 ? '+' : '') + h.hrSlope, h.hrSlope < 0 ? 'g' : h.hrSlope < 1 ? 'w' : 'r'));
  }
  if (n.odi3) chipsArr.push(nrChip('ODI-3', n.odi3.rate + '/h', n.odi3.rate < 5 ? 'g' : n.odi3.rate < 15 ? 'w' : 'r'));
  if (n.comp) chipsArr.push(nrChip('NSI', n.comp.nsi, n.comp.nsi < 30 ? 'g' : n.comp.nsi < 60 ? 'w' : 'r'));
  if (n.comp) chipsArr.push(nrChip('SFI', n.comp.sfi, n.comp.sfi < 1 ? 'g' : n.comp.sfi < 3 ? 'w' : 'r'));
  if (n.motSleep) chipsArr.push(nrChip('SleepEff', n.motSleep.sleepEff + '%', n.motSleep.sleepEff >= 90 ? 'g' : n.motSleep.sleepEff >= 80 ? 'w' : 'r'));
  if (n.sleepArch && n.sleepArch.wasoMin != null) chipsArr.push(nrChip('WASO', n.sleepArch.wasoMin + 'm', n.sleepArch.wasoMin < 10 ? 'g' : n.sleepArch.wasoMin < 30 ? 'w' : 'r'));
  if (n.hrAdv) chipsArr.push(nrChip('RMSSD', n.hrAdv.rmssd, n.hrAdv.rmssd >= 2 ? 'g' : n.hrAdv.rmssd >= 1 ? 'w' : 'r'));
  if (n.sbii) chipsArr.push(nrChip('SBII', n.sbii.sbii, n.sbii.sbii < 2.58 ? 'g' : n.sbii.sbii < 12.8 ? 'w' : 'r'));
  if (n.pred3p) chipsArr.push(nrChip('pRED', n.pred3p.pred3p + '%', n.pred3p.pred3p < 2.78 ? 'g' : n.pred3p.pred3p < 10.84 ? 'w' : 'r'));
  // DEEP-AUDIT-II §2.2 — ONE band set for DesSev: <5 good · <15 warn · else bad. This chip
  // carried {10,25} while the metric card used {5,15} and the score used {5,15,30}, so the
  // same night could read green on the chip and warn on the card beside it. {5,15,30} is
  // canonical: on the corrected 37-night scale (0.24–17.6 %-min/hr) it separates 26 good /
  // 10 warn / 1 high, whereas {10,25} collapses the entire corpus into green-or-warn.
  if (n.desSev) chipsArr.push(nrChip('DesSev', n.desSev.desSev, n.desSev.desSev < 5 ? 'g' : n.desSev.desSev < 15 ? 'w' : 'r'));
  // Research-tier chips
  if (n.dfa) chipsArr.push(nrChip('DFA', n.dfa.alpha1, n.dfa.alpha1 > 0.85 ? 'g' : n.dfa.alpha1 > 0.6 ? 'w' : 'r'));
  if (n.ssi) chipsArr.push(nrChip('SSI', n.ssi.ssi, n.ssi.ssi < 0.5 ? 'g' : n.ssi.ssi < 1.5 ? 'w' : 'r'));
  if (n.rolling) chipsArr.push(nrChip('CDI', n.rolling.cdi + '/h', n.rolling.cdi < 5 ? 'g' : n.rolling.cdi < 15 ? 'w' : 'r'));
  if (n.hypLoad) chipsArr.push(nrChip('HypLoad', n.hypLoad.hypoxicLoad, n.hypLoad.hypoxicLoad < 1 ? 'g' : n.hypLoad.hypoxicLoad < 5 ? 'w' : 'r'));
  if (n.recIdx) chipsArr.push(nrChip('RecIdx', n.recIdx.recoveryIndex, n.recIdx.recoveryIndex > 1.5 ? 'g' : n.recIdx.recoveryIndex > 0.8 ? 'w' : 'r'));
  if (n.oxyCrash) chipsArr.push(nrChip('OxyCrash', n.oxyCrash.oxyCrashRate + '/h', n.oxyCrash.oxyCrashRate < 2 ? 'g' : n.oxyCrash.oxyCrashRate < 5 ? 'w' : 'r'));
  if (n.ahiEst) chipsArr.push(nrChip('AHI', n.ahiEst.ahiODI4, n.ahiEst.ahiODI4 < 5 ? 'g' : n.ahiEst.ahiODI4 < 15 ? 'w' : 'r'));
  // flags (always show — status-coded, short)
  var flagChips = (n.flags || [])
    .map(function (f) {
      return nrChip(f.code, '', f.sev);
    })
    .join('');

  // Split: show top 8 clinically relevant chips; collapse the rest
  var CHIP_LIMIT = 8;
  var primaryChips = chipsArr.slice(0, CHIP_LIMIT).join('');
  var extraChipsArr = chipsArr.slice(CHIP_LIMIT);
  var extraHtml = '';
  if (extraChipsArr.length > 0) {
    extraHtml =
      '<button class="chip-more-btn" aria-expanded="false"' +
      ' data-act="oxyChipMore" data-count="' +
      extraChipsArr.length +
      '">+' +
      extraChipsArr.length +
      ' more</button>' +
      '<span class="chip-overflow">' +
      extraChipsArr.join('') +
      '</span>';
  }

  var advPanel = chipsArr.length || flagChips ? '<div class="nr-advanced" data-tier="secondary">' + primaryChips + extraHtml + flagChips + '</div>' : '';

  return '<div class="night-row-v22">' + leftHtml + centerHtml + rightHtml + '</div>' + advPanel;
}

function toggleDetail(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
  var row = el.previousElementSibling;
  if (row) row.setAttribute('aria-expanded', el.classList.contains('open') ? 'true' : 'false');
  if (window.syncNightRail) window.syncNightRail();
}

// Jump to a night from the research rail: ensure it's expanded, scroll its row
// to the top, and mark the rail item active.
function jumpToNight(idx) {
  var det = document.getElementById('det' + idx);
  if (!det) return;
  if (!det.classList.contains('open')) {
    det.classList.add('open');
    var row = det.previousElementSibling;
    if (row) row.setAttribute('aria-expanded', 'true');
  }
  var rowEl = det.previousElementSibling;
  var target = rowEl || det;
  var y = target.getBoundingClientRect().top + window.pageYOffset - 70;
  window.scrollTo({ top: y, behavior: 'smooth' });
  if (window.syncNightRail) window.syncNightRail(idx);
}
// Reflect which nights are open / which is in view on the rail
window.syncNightRail = function (activeIdx) {
  var rail = document.getElementById('nightJumpRail');
  if (!rail) return;
  rail.querySelectorAll('.njr-item').forEach(function (btn, i) {
    var det = document.getElementById('det' + i);
    var open = det && det.classList.contains('open');
    btn.classList.toggle('njr-open', !!open);
    if (activeIdx != null) btn.classList.toggle('njr-active', i === activeIdx);
  });
};

// ── renderProjectionCards: VO₂max projection card (research tier). v22.16
//    Shared by the main dashboard and each night's detail panel so the
//    card is always visible, not buried inside the collapsed night row.
//    BP Projection REMOVED 2026-06-21 (external-review WP-A).
function renderProjectionCards(n) {
  var html = '<div class="sec-label">Performance Projection</div>';
  if (!n || !n.vo2est) {
    return (
      html +
      '<div class="proj-grid"><div class="proj-card proj-warn">' +
      '<div class="proj-header"><span class="cat-tag cat-vo2">VO₂</span>' +
      '<span class="proj-title">' +
      evBadge('vo2est') +
      'VO₂max Estimate</span>' +
      '<span class="proj-badge proj-warn">No estimate</span></div>' +
      '<div class="proj-disclaimer">⚠️ Not enough signal to estimate. ' +
      'These need a continuous recording of roughly an hour or more with enough ' +
      'motion-free heart-rate samples. Re-import a full overnight raw O2Ring CSV ' +
      '(JSONL summary imports do not carry these fields).</div></div></div>'
    );
  }
  html += '<div class="proj-grid">';
  if (n.vo2est) {
    var v = n.vo2est;
    var vc = v.vo2est >= 42 ? 'good' : v.vo2est >= 35 ? 'warn' : 'bad';
    html += '<div class="proj-card proj-' + vc + '">';
    html +=
      '<div class="proj-header"><span class="cat-tag cat-vo2">VO₂</span><span class="proj-title">' +
      evBadge('vo2est') +
      'VO₂max Estimate</span><span class="proj-badge proj-' +
      vc +
      '">' +
      (v.vo2Category || '—') +
      '</span></div>';
    html += '<div class="proj-main"><div class="proj-value proj-val-' + vc + '">' + v.vo2est + '</div><div class="proj-unit">ml/kg/min</div></div>';
    if (v.vo2Low != null && v.vo2High != null) html += '<div class="proj-range">Range: ' + v.vo2Low + ' – ' + v.vo2High + ' ml/kg/min (±' + (v.see || 0) + ' SEE)</div>';
    html += '<div class="proj-waterfall">';
    var hrRestSrc = UP.hrRestOverride && UP.hrRestOverride > 30 ? 'manual entry' : 'nocturnal p5';
    html += '<div class="proj-factor"><span>HR Rest (' + hrRestSrc + ')</span><span class="pf-val">' + v.hrRest + ' bpm</span></div>';
    html += '<div class="proj-factor"><span>HR Max (' + (v.hrMaxSource || 'Tanaka') + ')</span><span class="pf-val">' + v.hrMax + ' bpm</span></div>';
    if (v.hrMax && v.hrRest) html += '<div class="proj-factor"><span>Base (15.3 × HRmax/HRrest)</span><span class="pf-val pf-neutral">' + +(15.3 * (v.hrMax / v.hrRest)).toFixed(1) + '</span></div>';
    if (v.dfaAdj)
      html +=
        '<div class="proj-factor"><span>' +
        (v.dfaNote || 'DFA adj') +
        '</span><span class="pf-val ' +
        (v.dfaAdj > 0 ? 'pf-pos' : 'pf-neg') +
        '">' +
        (v.dfaAdj > 0 ? '+' : '') +
        v.dfaAdj +
        '</span></div>';
    if (v.rmssdAdj)
      html +=
        '<div class="proj-factor"><span>' +
        (v.rmssdNote || 'RMSSD adj') +
        '</span><span class="pf-val ' +
        (v.rmssdAdj > 0 ? 'pf-pos' : 'pf-neg') +
        '">' +
        (v.rmssdAdj > 0 ? '+' : '') +
        v.rmssdAdj +
        '</span></div>';
    html += '<div class="proj-factor proj-total"><span>Estimated VO₂max</span><span class="pf-val proj-val-' + vc + '">' + v.vo2est + ' ml/kg/min</span></div>';
    html += '</div>';
    if (v.vo2Conf != null) {
      html += '<div class="proj-conf"><div class="proj-conf-bar" style="width:' + v.vo2Conf + '%"></div></div>';
      html += '<div class="proj-conf-label">Confidence: ' + v.vo2Conf + '% · ' + (v.label || '') + '</div>';
    }
    if (v.disclaimer) html += '<div class="proj-disclaimer">⚠️ ' + v.disclaimer + '</div>';
    if (v.formula) html += '<div class="proj-cite">Formula: ' + v.formula + '</div>';
    html += '</div>';
  }
  /* BP Projection card REMOVED 2026-06-21 (external-review WP-A) — cuffless BP
     from oximetry is indefensible as a surfaced metric; deleted, not demoted. */
  html += '</div>';
  return html;
}

function nightDetail(n, idx) {
  var s = n.stats || {},
    html = '';

  // ── Date header — always shown at top of expanded card ──────────
  var _dh = n.date || '';
  var _dur = s.durationMin ? Math.floor(s.durationMin / 60) + 'h' + (Math.round(s.durationMin % 60) < 10 ? '0' : '') + Math.round(s.durationMin % 60) + 'm' : '';
  html += '<div class="night-detail-header">';
  html += '<div class="ndh-date">' + _dh + '</div>';
  if (_dur) html += '<div class="ndh-dur">' + _dur + '</div>';
  html += '<div class="ndh-file">📄 ' + sanitizeFname(n.fname) + '</div>';
  html += '</div>';

  // Smart Summary — only when computed (raw CSV + summary CSV imports; null for JSONL)
  if (n.summary) {
    html += '<div class="sec-label">Smart Summary</div>';
    (function () {
      try {
        html += renderSmartSummary(n);
      } catch (e) {
        html += '<div class="render-error-inline">⚠️ Summary error: ' + escHTML(e.message) + '</div>';
      }
    })();
    if (n.summary.ranked && n.summary.ranked.length > 5) {
      // De-dup: the three Smart Summary cards already surface every KPI. Here we
      // show ONLY the flagged metrics (warn/bad) ranked worst-first — the unique
      // signal the cards don't convey — instead of repeating the whole list.
      var _sevMap = { g: 'good', w: 'warn', r: 'bad' };
      var _flagged = [];
      for (var _i = 0; _i < n.summary.ranked.length; _i++) {
        var _m = n.summary.ranked[_i];
        if (_m.score === 0) continue;
        var _sevCls = _sevMap[_m.sev] || _m.sev || 'neutral';
        if (_sevCls === 'warn' || _sevCls === 'bad') _flagged.push({ m: _m, sev: _sevCls });
      }
      if (_flagged.length) {
        html += '<div class="sec-label mt-sm">Flagged metrics <span class="cite-note">· ranked by severity (' + _flagged.length + ')</span></div>';
        html += '<div class="grid">';
        _flagged.forEach(function (f) {
          var _bw = Math.round(f.m.score * 10);
          html +=
            '<div class="metric metric-secondary ' +
            f.sev +
            '">' +
            '<div class="m-label">' +
            evBadge(f.m.label) +
            f.m.label +
            '</div>' +
            '<div class="m-val ' +
            f.sev +
            '">' +
            f.m.displayVal +
            '</div>' +
            '<div class="ss-bar-wrap" style="margin-top:5px"><div class="ss-bar ' +
            f.sev +
            '" style="width:' +
            _bw +
            '%"></div></div>' +
            '</div>';
        });
        html += '</div>';
      } else {
        html += '<div class="sec-label mt-sm">Flagged metrics</div>';
        html += '<div class="all-normal-note">✓ All scored metrics within normal range this night.</div>';
      }
    }
  } else {
    html += '<div class="sec-label">Smart Summary</div>';
    html += '<div class="render-error-inline">Smart Summary tabs (Oxygen · Cardio · Sleep) are unavailable for this night.</div>';
  }

  // ── VO₂max + BP Projection — Advanced (secondary) tier ──
  html += '<div class="sec-section" data-tier="secondary">' + renderProjectionCards(n) + '</div>';

  // ── Karvonen Training Zones — shown for ALL import types ──────────
  if (n.karv) {
    var k = n.karv;
    var rColor = k.readinessColor;
    // Primary recommended zone drives the Training Zones card headline
    var _recZ = k.recZones && k.recZones.length ? k.recZones[0] : null;
    // Recommended zone color: derive from name or fall back to readiness color
    var _recColor = rColor;

    html += '<div class="sec-label">🏋️ Next-Day Training Zones</div>';
    // Both cards live in one proj-grid so they sit side-by-side (matches
    // VO₂max Estimate / BP Projection layout above).
    html += '<div class="proj-grid">';

    // ── CARD 1: Recovery Readiness (proj-card style) ─────────────────
    // Label-value pairs adjacent; per-row pf-prog fills give a visual cue
    // without separating label from value.
    html += '<div class="proj-card proj-' + rColor + '">';
    html +=
      '<div class="proj-header">' +
      '<span class="cat-tag">RDY</span>' +
      '<span class="proj-title">' +
      evBadge('Recovery Readiness') +
      'Recovery Readiness</span>' +
      '<span class="proj-badge proj-' +
      rColor +
      '">' +
      k.readinessTier +
      '</span>' +
      '</div>';
    html += '<div class="proj-main">' + '<div class="proj-value proj-val-' + rColor + '">' + k.readiness + '</div>' + '<div class="proj-unit">/100</div>' + '</div>';
    html += '<div class="proj-range">' + 'Composite of HRV, SpO₂, sleep architecture, HR floor &amp; nocturnal dip' + '</div>';
    html += '<div class="proj-waterfall">';
    var _kRows = [
      { label: 'HRV (RMSSD)', v: k.scores.rmssd, max: 30 },
      { label: 'SpO₂ / Hypoxia', v: k.scores.spo2, max: 25 },
      { label: 'Sleep Arch.', v: k.scores.sleep, max: 20 },
      { label: 'HR Floor', v: k.scores.hrFloor, max: 15 },
      { label: 'Nocturnal Dip', v: k.scores.hrSlope, max: 10 }
    ];
    _kRows.forEach(function (r) {
      var pct = r.max ? Math.min(100, Math.max(0, (r.v / r.max) * 100)) : 0;
      var cls = pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad';
      html +=
        '<div class="proj-factor pf-prog">' +
        '<div class="pf-bg ' +
        cls +
        '" style="width:' +
        pct.toFixed(0) +
        '%"></div>' +
        '<span>' +
        r.label +
        '</span>' +
        '<span class="pf-val">' +
        r.v +
        ' / ' +
        r.max +
        '</span>' +
        '</div>';
    });
    html += '<div class="proj-factor proj-total">' + '<span>Total Readiness</span>' + '<span class="pf-val proj-val-' + rColor + '">' + k.readiness + ' / 100</span>' + '</div>';
    html += '</div>'; // /.proj-waterfall
    html += '<div class="proj-cite">Method: ' + k.method + '</div>';
    html += '</div>'; // /.proj-card

    // ── CARD 2: Training Zones (proj-card style) ─────────────────────
    // Headline = recommended zone range. Each Z1–Z5 row uses pf-prog with
    // the zone's own colour positioned at its share of HRmax, so the visual
    // pattern mirrors the per-zone bars but sits inside a proj-card frame.
    html += '<div class="proj-card proj-' + _recColor + '">';
    html +=
      '<div class="proj-header">' +
      '<span class="cat-tag cat-vo2">ZON</span>' +
      '<span class="proj-title">' +
      evBadge('Training Zone') +
      'Training Zones</span>' +
      '<span class="proj-badge proj-' +
      _recColor +
      '">' +
      (_recZ ? _recZ.name + ' ★' : 'Recommended') +
      '</span>' +
      '</div>';
    html +=
      '<div class="proj-main">' +
      '<div class="proj-value proj-val-' +
      _recColor +
      '">' +
      (_recZ ? _recZ.low + '–' + _recZ.high : '—') +
      '</div>' +
      '<div class="proj-unit">bpm · recommended zone</div>' +
      '</div>';
    html += '<div class="proj-range">' + 'HRrest ' + k.hrRest + ' · HRmax ' + k.hrMax + ' · HRR ' + k.hrr + ' · MAF ' + k.mafHR + ' · LTHR~ ' + k.lthr + ' bpm' + '</div>';
    html += '<div class="proj-waterfall">';
    k.allZones.forEach(function (z) {
      var isRec = k.recZones.some(function (r) {
        return r.name === z.name;
      });
      // Position the colored bar to span this zone's slice of 0–100% HRmax
      var barStart = Math.round((z.low / k.hrMax) * 100);
      var barWidth = Math.round(((z.high - z.low) / k.hrMax) * 100);
      html +=
        '<div class="proj-factor pf-prog">' +
        '<div class="pf-bg" style="background:' +
        z.color +
        ';opacity:0.32;left:' +
        barStart +
        '%;width:' +
        barWidth +
        '%"></div>' +
        '<span><strong style="color:' +
        z.color +
        '">' +
        z.name +
        (isRec ? ' ★' : '') +
        '</strong>' +
        ' <span style="color:var(--text3);font-size:10px">· ' +
        z.purpose +
        '</span></span>' +
        '<span class="pf-val">' +
        z.low +
        ' – ' +
        z.high +
        ' bpm</span>' +
        '</div>';
    });
    html += '</div>'; // /.proj-waterfall
    html += '<div class="proj-cite">' + k.lthrNote + '<br>Method: ' + k.method + '</div>';
    html += '</div>'; // /.proj-card

    html += '</div>'; // /.proj-grid
  }

  html += '<div class="sec-section" data-tier="primary">';
  html += '<div class="sec-label">Recording</div>';
  html +=
    '<div class="grid grid-3">' +
    metric('Date', n.date, '', '', 'primary') +
    metric('Duration', s.durationMin, 'min', '', 'primary') +
    metric('Start', (s.start || '').substr(0, 5), '→ ' + (s.end || '').substr(0, 5), '', 'primary') +
    '</div>';
  html += '<div class="sec-label">SpO₂</div>';
  html +=
    '<div class="grid">' +
    metric('Mean', s.meanSpo2 + '%', 'std ' + s.spo2Std, s.meanSpo2 >= 95 ? 'good' : s.meanSpo2 >= 92 ? 'warn' : 'bad', 'primary') +
    metric('Min', s.minSpo2 + '%', 'max ' + s.maxSpo2 + '%', s.minSpo2 >= 90 ? 'good' : s.minSpo2 >= 85 ? 'warn' : 'bad', 'primary') +
    metric('T95', s.t95pct + '%', 'time <95%', s.t95pct < 5 ? 'good' : s.t95pct < 15 ? 'warn' : 'bad', 'primary') +
    metric('T90', s.t90pct + '%', 'time <90%', s.t90pct > 1 ? 'bad' : s.t90pct > 0 ? 'warn' : 'good', 'primary') +
    '</div>';
  html += '</div>';

  // v18: Extended Analysis Sections
  if (n.desat && n.desat.nadir) {
    var d = n.desat;
    // null-safe display helper for this section
    function _dv(v, u) {
      return v != null ? v + (u || '') : '—';
    }
    function _dc(v, g, w) {
      return v != null ? (v <= g ? 'good' : v <= w ? 'warn' : 'bad') : '';
    }
    var hasNadir = d.nadir.count > 0;
    html += '<div class="sec-section" data-tier="secondary"><div class="sec-label">Desaturation Profile</div>';
    html +=
      '<div class="grid">' +
      metric('Δ-Index', _dv(d.deltaIndex), '≤1.0 normal', _dc(d.deltaIndex, 1, 2)) +
      metric('SpO₂ CoV', _dv(d.spo2CoV, '%'), 'SD/mean×100', _dc(d.spo2CoV, 1.5, 2.5)) +
      metric('T-AUC Wt', _dv(d.tAucWeighted), 'severity load', _dc(d.tAucWeighted, 500, 2000)) +
      metric('AUC-90 Rate', _dv(d.auc90Rate), '%-min/hr <90%', d.auc90Rate != null ? (d.auc90Rate === 0 ? 'good' : d.auc90Rate < 0.5 ? 'warn' : 'bad') : '') +
      metric('Dip-3/hr', _dv(d.dip3Rate), 'events/hr', _dc(d.dip3Rate, 2, 5)) +
      metric('Nadir Count', d.nadir.count, 'ODI-4 events', d.nadir.count < 3 ? 'good' : d.nadir.count < 8 ? 'warn' : 'bad') +
      (hasNadir ? metric('Nadir Depth', _dv(d.nadir.meanDepth, '%'), 'mean drop', _dc(d.nadir.meanDepth, 4, 7)) : '') +
      (hasNadir ? metric('Nadir Recov', _dv(d.nadir.meanRecovery, 's'), 'to baseline', _dc(d.nadir.meanRecovery, 30, 60), 'secondary') : '') +
      '</div>';
    html += '</div>';
  }
  if (n.hrProf) {
    var hp = n.hrProf;
    html += '<div class="sec-section" data-tier="secondary"><div class="sec-label">HR Profile</div>';
    html +=
      '<div class="grid">' +
      metric('Circadian', hp.circadianScore, 'bpm Δ (neg=good)', hp.circadianScore < 0 ? 'good' : hp.circadianScore < 2 ? 'warn' : 'bad') +
      metric('Decel Cap', hp.decCapacity, 'bpm drop', hp.decCapacity >= 8 ? 'good' : hp.decCapacity >= 4 ? 'warn' : 'bad') +
      metric('ApEn', hp.apEn, 'HR regularity', hp.apEn >= 0.8 ? 'good' : hp.apEn >= 0.4 ? 'warn' : 'bad') +
      metric('Bradycardia', hp.bradyCount, 'events <40bpm', hp.bradyCount === 0 ? 'good' : 'bad') +
      metric('Tachycardia', hp.tachyCount, 'events >100bpm', hp.tachyCount === 0 ? 'good' : hp.tachyCount < 3 ? 'warn' : 'bad', 'secondary') +
      '</div>';
    html += '</div>';
  }
  if (n.motSleep && n.motSleep.wasoPct != null) {
    var ms2 = n.motSleep;
    html += '<div class="sec-label">Sleep Quality</div>';
    html +=
      '<div class="grid">' +
      metric('Sleep Eff', ms2.sleepEff + '%', 'motion=0 time', ms2.sleepEff >= 90 ? 'good' : ms2.sleepEff >= 80 ? 'warn' : 'bad') +
      metric('WASO %', ms2.wasoPct + '%', 'post-onset awake', ms2.wasoPct < 5 ? 'good' : ms2.wasoPct < 15 ? 'warn' : 'bad') +
      metric('WASO Win', ms2.wasoWindows, '5-min windows', ms2.wasoWindows === 0 ? 'good' : ms2.wasoWindows < 3 ? 'warn' : 'bad') +
      metric('Pos Shifts', ms2.posShifts, 'position changes', ms2.posShifts <= 2 ? 'good' : ms2.posShifts <= 4 ? 'warn' : 'bad') +
      '</div>';
  }

  // Sleep Architecture — secondary tier (advanced mode)
  if (n.sleepArch && (n.sleepArch.wasoMin != null || n.sleepArch.solMin != null)) {
    var sla = n.sleepArch;
    html += '<div class="sec-section" data-tier="secondary">';
    html += '<div class="sec-label">Sleep Architecture <span class="cite-note">(HR-valley ultradian proxy)</span></div>';
    html +=
      '<div class="grid">' +
      metric('WASO', sla.wasoMin != null ? sla.wasoMin : '—', 'min awake post-onset', sla.wasoMin == null ? '' : sla.wasoMin < 20 ? 'good' : sla.wasoMin < 45 ? 'warn' : 'bad') +
      metric('SOL', sla.solMin != null ? sla.solMin : '—', 'min to sleep onset', sla.solMin == null ? '' : sla.solMin < 15 ? 'good' : sla.solMin < 30 ? 'warn' : 'bad') +
      metric(
        'Ultradian Cycles',
        sla.ultradianCycles != null ? sla.ultradianCycles : '—',
        '~90-min cycles',
        sla.ultradianCycles == null ? '' : sla.ultradianCycles >= 3 ? 'good' : sla.ultradianCycles >= 2 ? 'warn' : 'bad'
      ) +
      metric('HR Valleys', sla.ultradianValleys != null ? sla.ultradianValleys : '—', 'detected nadirs', '') +
      '</div>';
    html += '</div>'; // /.sec-section secondary
  }
  if (n.cross && n.cross.crcIdx != null) {
    var cx = n.cross;
    html += '<div class="sec-label">Cross-Signal</div>';
    html +=
      '<div class="grid">' +
      metric('AAI', cx.autoArousalIdx, '/hr (spikes+ODI4)', cx.autoArousalIdx < 2 ? 'good' : cx.autoArousalIdx < 5 ? 'warn' : 'bad') +
      metric('CRC Index', cx.crcIdx, 'SpO₂-HR coupling', Math.abs(cx.crcIdx) > 0.4 ? 'warn' : 'good') +
      metric('PB Diverge', cx.divergeCount, 'episodes no HR', cx.divergeCount === 0 ? 'good' : cx.divergeCount < 3 ? 'warn' : 'bad') +
      metric('Diverge %', cx.divergePct != null ? cx.divergePct + '%' : '—', 'blunted arousal', cx.divergePct != null ? (cx.divergePct < 30 ? 'good' : cx.divergePct < 75 ? 'warn' : 'bad') : '') +
      '</div>';
  }
  // ── Advanced Signal Metrics — research accordion ────────────
  var hasAdvanced = (n.spo2Adv && n.spo2Adv.nadirBins) || (n.hrAdv && n.hrAdv.hrIQR != null) || n.comp;
  if (hasAdvanced) {
    html += '<div class="research-accordion sec-section" data-tier="secondary">';
    html += '<div class="research-accordion-header" data-act="toggleResearchAccordion">';
    html += '<span>📊 Composite · SpO₂ Advanced · HR Advanced</span>';
    html += '<span class="research-accordion-header-line"></span>';
    html += '<span class="research-accordion-chevron">▼</span>';
    html += '</div>';
    html += '<div class="research-accordion-body">';

    if (n.comp) {
      var cp = n.comp;
      html += '<div class="sec-label">Composite Scores</div>';
      html +=
        '<div class="grid">' +
        metric('NSI', cp.nsi, '/100 stress load', cp.nsi < 30 ? 'good' : cp.nsi < 60 ? 'warn' : 'bad', 'secondary') +
        (cp.couplingScore != null ? metric('Coupling', cp.couplingScore + '%', 'desat→HR link', cp.couplingScore >= 50 ? 'good' : cp.couplingScore >= 20 ? 'warn' : 'bad', 'secondary') : '') +
        metric('Frag Index', cp.sfi, '/hr fragmentation', cp.sfi < 3 ? 'good' : cp.sfi < 6 ? 'warn' : 'bad', 'secondary') +
        '</div>';
    }
    if (n.spo2Adv && n.spo2Adv.nadirBins) {
      var sa = n.spo2Adv;
      html += '<div class="sec-label">SpO₂ Advanced</div>';
      html +=
        '<div class="grid">' +
        metric('WtDSI', sa.wtdsi, 'weighted severity', sa.wtdsi < 1 ? 'good' : sa.wtdsi < 5 ? 'warn' : 'bad', 'secondary') +
        metric('SpO₂ IQR', sa.spo2IQR != null ? sa.spo2IQR + '%' : '—', 'p75-p25 spread', sa.spo2IQR != null ? (sa.spo2IQR <= 2 ? 'good' : sa.spo2IQR <= 4 ? 'warn' : 'bad') : '', 'secondary') +
        metric('Cond Mean', sa.condMeanBelow94 ? sa.condMeanBelow94 + '%' : '—', 'SpO₂<94 only', sa.condMeanBelow94 ? (sa.condMeanBelow94 >= 91 ? 'warn' : 'bad') : 'good', 'secondary') +
        metric(
          'Cond %',
          sa.condPctBelow94 != null ? sa.condPctBelow94 + '%' : '—',
          'time <94%',
          sa.condPctBelow94 != null ? (sa.condPctBelow94 < 5 ? 'good' : sa.condPctBelow94 < 15 ? 'warn' : 'bad') : '',
          'secondary'
        ) +
        metric('Nadir<4%', sa.nadirBins.above91, 'events shallow', sa.nadirBins.above91 < 3 ? 'good' : 'warn', 'secondary') +
        metric('Nadir 4-6', sa.nadirBins.b90_91, 'moderate', sa.nadirBins.b90_91 === 0 ? 'good' : sa.nadirBins.b90_91 < 3 ? 'warn' : 'bad', 'secondary') +
        metric('Nadir 6-9', sa.nadirBins.b88_89, 'deep', sa.nadirBins.b88_89 === 0 ? 'good' : 'bad', 'secondary') +
        metric('Nadir>9%', sa.nadirBins.b85_87 + sa.nadirBins.below85, 'severe', sa.nadirBins.b85_87 + sa.nadirBins.below85 === 0 ? 'good' : 'bad', 'secondary') +
        '</div>';
    }
    if (n.hrAdv && n.hrAdv.hrIQR != null) {
      var ha = n.hrAdv;
      html += '<div class="sec-label">HR Advanced (HRV)</div>';
      html +=
        '<div class="grid">' +
        metric('RMSSD proxy', ha.rmssd, 'bpm (1Hz)', ha.rmssd < 2 ? 'good' : ha.rmssd < 4 ? 'warn' : 'bad', 'secondary') +
        metric('HR IQR', ha.hrIQR, 'bpm spread', ha.hrIQR <= 8 ? 'good' : ha.hrIQR <= 15 ? 'warn' : 'bad', 'secondary') +
        (ha.hrPbContrast !== null ? metric('PB HR Δ', ha.hrPbContrast, 'bpm vs non-PB', Math.abs(ha.hrPbContrast) > 4 ? 'warn' : 'good', 'secondary') : '') +
        (ha.meanHRpb ? metric('Mean HR PB', ha.meanHRpb, 'bpm in PB wins', '', 'secondary') : '') +
        (ha.meanHRnonPb ? metric('Mean HR Rest', ha.meanHRnonPb, 'bpm non-PB', '', 'secondary') : '') +
        '</div>';
    }
    html += '</div></div>'; // .research-accordion-body + .research-accordion
  }

  // v20: Literature-validated metrics panel — wrapped in research accordion
  html += '<div class="research-accordion sec-section" data-tier="research">';
  html += '<div class="research-accordion-header" data-act="toggleResearchAccordion">';
  html += '<span>🔬 Clinical Hypoxic Indices &amp; CT Thresholds</span>';
  html += '<span class="research-accordion-header-line"></span>';
  html += '<span class="research-accordion-chevron">▼</span>';
  html += '</div>';
  html += '<div class="research-accordion-body">';
  html += '<div class="sec-label">Clinical Hypoxic Indices <span class="cite-note">(Hui 2024 Respirology · SHHS 4,485pt cohort)</span></div>';
  html += '<div class="grid">';
  if (n.sbii && n.sbii.sbiiQ) {
    html += metric('SBII', n.sbii.sbii, '%\u00B2\u00B7min/hr', n.sbii.sbiiQ === 'Q1(low)' ? 'good' : n.sbii.sbiiQ === 'Q2' ? 'good' : n.sbii.sbiiQ === 'Q3' ? 'warn' : 'bad', 'research');
    html += metric(
      'SBII Quintile',
      n.sbii.sbiiQ,
      'CVD mortality risk',
      n.sbii.sbiiQ.indexOf('Q1') > -1 || n.sbii.sbiiQ.indexOf('Q2') > -1 ? 'good' : n.sbii.sbiiQ === 'Q3' ? 'warn' : 'bad',
      'research'
    );
  }
  if (n.pred3p && n.pred3p.pred3pQ) {
    html += metric(
      'pRED-3p',
      n.pred3p.pred3p + '%',
      '% rec time w/ desat events',
      n.pred3p.pred3pQ.indexOf('Q1') > -1 || n.pred3p.pred3pQ.indexOf('Q2') > -1 ? 'good' : n.pred3p.pred3pQ === 'Q3' ? 'warn' : 'bad',
      'research'
    );
    html += metric(
      'pRED Quintile',
      n.pred3p.pred3pQ,
      'CVD morbidity risk',
      n.pred3p.pred3pQ.indexOf('Q1') > -1 || n.pred3p.pred3pQ.indexOf('Q2') > -1 ? 'good' : n.pred3p.pred3pQ === 'Q3' ? 'warn' : 'bad',
      'research'
    );
  }
  if (n.desSev) html += metric('DesSev', n.desSev.desSev, '%-min/hr (Kulkas)', n.desSev.desSev < 5 ? 'good' : n.desSev.desSev < 15 ? 'warn' : 'bad', 'research');
  html += '</div>';
  if (n.ctPrec) {
    var cp2 = n.ctPrec;
    html += '<div class="sec-label">CT Thresholds (precise seconds)</div>';
    html +=
      '<div class="grid">' +
      metric('CT<90', cp2.ct90m + 'min', '(' + cp2.ct90s + 's)', cp2.ct90s === 0 ? 'good' : cp2.ct90s < 60 ? 'warn' : 'bad', 'research') +
      metric('CT<89', cp2.ct89m + 'min', '(' + cp2.ct89s + 's)', cp2.ct89s === 0 ? 'good' : 'bad', 'research') +
      metric('CT<88', cp2.ct88m + 'min', '(' + cp2.ct88s + 's)', cp2.ct88s === 0 ? 'good' : 'bad', 'research') +
      metric('CT<85', cp2.ct85m + 'min', '(' + cp2.ct85s + 's)', cp2.ct85s === 0 ? 'good' : 'bad', 'research') +
      '</div>';
  }
  html += '</div></div>'; // .research-accordion-body + .research-accordion

  // T-Index + Sleep Stability — paired side-by-side in one proj-grid
  html += '<div class="sec-section">';
  html += '<div class="sec-label">T-Index · Sleep Stability</div>';
  // T90 (clinically most-cited threshold) drives the headline severity
  var _t90 = (n.tIdx && (n.tIdx[90] || n.tIdx['t90'])) || { pct: 0 };
  var _tCls = _t90.pct < 1 ? 'good' : _t90.pct < 5 ? 'warn' : 'bad';
  html += '<div class="proj-grid"><div class="proj-card proj-' + _tCls + '">';
  html +=
    '<div class="proj-header">' +
    '<span class="cat-tag cat-ox">TI</span>' +
    '<span class="proj-title">' +
    evBadge('T90') +
    'T-Index — SpO₂ time below threshold</span>' +
    '<span class="proj-badge proj-' +
    _tCls +
    '">T90 ' +
    _t90.pct +
    '%</span>' +
    '</div>';
  html +=
    '<div class="proj-main">' +
    '<div class="proj-value proj-val-' +
    _tCls +
    '">' +
    _t90.pct +
    '<span class="proj-unit" style="margin-left:4px">%</span></div>' +
    '<div class="proj-unit">of recording &lt; 90%</div>' +
    '</div>';
  html += '<div class="proj-range">Lower = better · &lt;1% T90 typical for healthy adults</div>';
  html += '<div class="proj-waterfall">';
  [95, 94, 93, 92, 91, 90, 89, 88, 85, 80].forEach(function (t) {
    var ti = (n.tIdx && (n.tIdx[t] || n.tIdx['t' + t])) || { pct: 0, secs: 0 };
    var c = tiClass(ti.pct, t);
    // Adaptive width per threshold so the inline fill is visually informative
    var tScale = t >= 93 ? 5 : t >= 90 ? 20 : t >= 88 ? 40 : 100;
    var fillPct = Math.min(100, ti.pct * tScale);
    var pfCls = c === 'good' ? 'ok' : c === 'warn' ? 'warn' : 'bad';
    html +=
      '<div class="proj-factor pf-prog">' +
      '<div class="pf-bg ' +
      pfCls +
      '" style="width:' +
      fillPct.toFixed(0) +
      '%"></div>' +
      '<span>T' +
      t +
      ' &lt; ' +
      t +
      '%</span>' +
      '<span class="pf-val ' +
      (c === 'good' ? 'pf-pos' : c === 'bad' ? 'pf-neg' : 'pf-neutral') +
      '">' +
      ti.pct +
      ' %</span>' +
      '</div>';
  });
  html += '</div></div>'; // close .proj-waterfall + T-Index .proj-card (keep .proj-grid open)

  // ── Sleep Stability Score — sits beside T-Index in the same grid ──
  if (n.stab && n.stab.components) {
    var st = n.stab,
      sc = st.components;
    var _stabGradeCls = st.gradeClass || (st.score >= 80 ? 'good' : st.score >= 60 ? 'warn' : 'bad');
    html += '<div class="proj-card proj-' + _stabGradeCls + '">';
    html +=
      '<div class="proj-header">' +
      '<span class="cat-tag cat-slp">SL</span>' +
      '<span class="proj-title">' +
      evBadge('sleepStability') +
      'Sleep Stability Score</span>' +
      '<span class="proj-badge proj-' +
      _stabGradeCls +
      '">' +
      st.grade +
      '</span>' +
      '</div>';
    html += '<div class="proj-main">' + '<div class="proj-value proj-val-' + _stabGradeCls + '">' + st.score + '</div>' + '<div class="proj-unit">/100</div>' + '</div>';
    html += '<div class="proj-range">Composite of 6 components — higher = better</div>';
    html += '<div class="proj-waterfall">';
    var _stabRows = [
      { label: 'SpO₂ Stability', v: sc.spo2Stab },
      { label: 'PB Windows', v: sc.pb },
      { label: 'Hypoxic Burden', v: sc.hypoxicBurden },
      { label: 'T95%', v: sc.t95 },
      { label: 'Motion', v: sc.motion },
      { label: 'HR Floor', v: sc.hrFloor }
    ];
    _stabRows.forEach(function (r) {
      if (r.v == null) {
        html += '<div class="proj-factor"><span>' + r.label + '</span><span class="pf-val pf-neutral">—</span></div>';
        return;
      }
      var rcls = r.v >= 80 ? 'ok' : r.v >= 60 ? 'warn' : 'bad';
      html +=
        '<div class="proj-factor pf-prog">' +
        '<div class="pf-bg ' +
        rcls +
        '" style="width:' +
        r.v +
        '%"></div>' +
        '<span>' +
        r.label +
        '</span>' +
        '<span class="pf-val">' +
        r.v +
        ' / 100</span>' +
        '</div>';
    });
    html += '<div class="proj-factor proj-total">' + '<span>Composite</span>' + '<span class="pf-val proj-val-' + _stabGradeCls + '">' + st.score + ' / 100</span>' + '</div>';
    html += '</div></div>'; // .proj-waterfall + .proj-card
  }

  html += '</div>'; // /.proj-grid
  html += '</div>'; // /.sec-section
  html += '<div class="sec-label">Desaturation · Pulse</div>';
  html +=
    '<div class="grid">' +
    (n.odi4 ? metric('ODI-4', n.odi4.rate, 'evt/hr · ' + n.odi4.count + ' total', n.odi4.rate < 5 ? 'good' : n.odi4.rate < 15 ? 'warn' : 'bad') : '') +
    (n.odi3 ? metric('ODI-3', n.odi3.rate, 'evt/hr · ' + n.odi3.count + ' total', n.odi3.rate < 15 ? 'good' : n.odi3.rate < 30 ? 'warn' : 'bad') : '') +
    metric('Mean HR', s.meanHr, 'bpm', '') +
    metric('HR Range', s.minHr + '–' + s.maxHr, 'bpm', s.maxHr > 95 ? 'warn' : '') +
    '</div>';

  // HRV proxies — secondary tier (advanced mode)
  if (n.hrv) {
    var h = n.hrv;
    html += '<div class="sec-section" data-tier="secondary">';
    html += '<div class="sec-label">HRV · 1Hz proxy <span class="cite-note">(relative comparison only)</span></div>';
    html +=
      '<div class="grid">' +
      metric('HR-Var SD', +(h.hrSdnn || 0).toFixed(2) + 'bpm', '1Hz SD (rel. only)', h.hrSdnn >= 4 ? 'good' : h.hrSdnn >= 2.5 ? 'warn' : 'bad') +
      metric('pNN3-equiv', h.pnn3 + '%', 'pairs ≥3bpm', h.pnn3 >= 1.5 ? 'good' : h.pnn3 >= 0.5 ? 'warn' : 'bad') +
      metric('HR Floor', h.hrFloor, 'bpm (p5)', h.hrFloor <= 55 ? 'good' : h.hrFloor <= 65 ? 'warn' : 'bad') +
      metric('HR Slope', (h.hrSlope > 0 ? '+' : '') + h.hrSlope, 'bpm/hr', h.hrSlope < 0 ? 'good' : h.hrSlope < 1.5 ? 'warn' : 'bad') +
      metric('RSA proxy', h.rsaProxy != null ? h.rsaProxy : '—', 'SpO₂ SD/30s', '') +
      '</div>';
    html += '</div>'; // /.sec-section secondary
  }

  // Respiratory Rate — secondary tier (advanced mode)
  if (n.respRate && n.respRate.respRateBpm != null) {
    var rr = n.respRate;
    var _rb = rr.respRateBpm;
    var _rc = _rb >= 12 && _rb <= 20 ? 'good' : _rb >= 10 && _rb <= 22 ? 'warn' : 'bad';
    html += '<div class="sec-section" data-tier="secondary">';
    html += '<div class="sec-label">Respiratory Rate <span class="cite-note">(RSA spectral proxy)</span></div>';
    html +=
      '<div class="grid">' +
      metric('Breaths/min', _rb, rr.respRateLabel || '12–20 normal', _rc) +
      metric('RSA Peak Freq', rr.rsaPeakFreq != null ? rr.rsaPeakFreq : '—', 'Hz · HF band', '') +
      metric('RSA Power', rr.rsaPeakPow != null ? rr.rsaPeakPow : '—', 'spectral peak', '') +
      '</div>';
    html += '</div>'; // /.sec-section secondary
  }

  // Spikes — core (always visible)
  html += '<div class="sec-label">HR Spikes <span class="sec-count-badge">' + n.spikes.length + '</span></div>';
  if (!n.spikes.length) {
    html += '<div class="metric"><div class="m-label">No autonomic arousal events detected</div></div>';
  } else if (!Array.isArray(n.spikes)) {
    html += '<div class="metric"><div class="m-label">' + n.spikes.length + ' HR spike(s) recorded — per-event detail unavailable in summary import</div></div>';
  } else {
    html += '<div class="spike-list">';
    (n.spikes || []).forEach(function (sp) {
      var rise = sp.peak - sp.baseline,
        bw = Math.min(100, (rise / 60) * 100);
      html +=
        '<div class="spike-item">' +
        '<div class="spike-time">' +
        sp.time.substr(0, 8) +
        '</div>' +
        '<div class="spike-bar-wrap">' +
        '<div class="spike-lbl">' +
        sp.baseline +
        ' → ' +
        sp.peak +
        ' bpm · +' +
        rise +
        ' · ' +
        sp.duration +
        's</div>' +
        '<div class="spike-mini"><div class="spike-fill" style="width:' +
        bw +
        '%"></div></div>' +
        '</div>' +
        '<div><div class="spike-badge">+' +
        rise +
        '</div><div class="spike-spo2">SpO₂ ' +
        sp.spo2 +
        '%</div></div>' +
        '</div>';
    });
    html += '</div>';
    if (n.period && n.period.intervals) {
      html +=
        '<div class="metric info mt-sm">' +
        '<div class="m-label">' +
        evBadge('Periodicity pattern') +
        'Periodicity pattern</div>' +
        '<div class="m-val">' +
        n.period.pattern.replace(/_/g, ' ') +
        ' · avg ' +
        n.period.avg +
        'min</div>' +
        '<div class="m-unit">spread ' +
        n.period.spread +
        'min · intervals: ' +
        n.period.intervals.join(', ') +
        'min</div>' +
        '</div>';
    }
  }

  // Oscillations — core (always visible)
  html += '<div class="sec-label">Periodic Breathing</div>';
  if (!n.osc || !n.osc.episodeCount) {
    html +=
      '<div class="metric good"><div class="m-label">' +
      evBadge('SpO₂ oscillation index') +
      'SpO₂ oscillation index</div><div class="m-val">Clear</div><div class="m-unit">No periodic breathing windows detected</div></div>';
  } else {
    html +=
      '<div class="grid">' +
      metric('Flagged Windows', n.osc.episodeCount, '5-min non-overlapping', n.osc.episodeCount >= 4 ? 'warn' : '') +
      metric('Peak Crossings', n.osc.peakCrossings != null ? n.osc.peakCrossings : '—', 'worst window', n.osc.peakCrossings > 12 ? 'warn' : '') +
      '</div>';
    if (n.osc.first)
      html +=
        '<div class="metric mt-sm"><div class="m-label">' +
        evBadge('Episode range') +
        'Episode range</div><div class="m-val t-caption">' +
        n.osc.first.substr(0, 8) +
        ' → ' +
        n.osc.last.substr(0, 8) +
        '</div></div>';
  }

  // ── Motion Profile — secondary tier (advanced mode) ─────────────
  html += '<div class="sec-section" data-tier="secondary">';
  html += '<div class="sec-label">Movement Profile</div>';
  if (n.motion) {
    var mp = n.motion;
    html +=
      '<div class="grid">' +
      metric('Motion %', n.stats ? n.stats.motionPct + '%' : '—', 'of recording', n.stats && n.stats.motionPct < 0.5 ? 'good' : n.stats && n.stats.motionPct < 2 ? 'warn' : 'bad') +
      metric('Restless Windows', mp.restlessWindows, 'of ' + mp.totalWindows + ' (30min)', mp.restlessWindows === 0 ? 'good' : mp.restlessWindows <= 2 ? 'warn' : 'bad') +
      metric('Arousal Index', mp.arousalIndex + '%', 'restless blocks', mp.arousalIndex < 20 ? 'good' : mp.arousalIndex < 40 ? 'warn' : 'bad') +
      '</div>';
    html += '<div class="sec-label sec-label-xs">30-min Motion Heatmap (darker = more movement)</div>';
    html += '<div class="motion-heatmap-grid">';
    if (mp.windows && mp.windows.length)
      mp.windows.forEach(function (w) {
        var intensity = Math.min(1, w.motionPct / 5.0);
        var r = Math.round(79 + intensity * 176);
        var g = Math.round(148 - intensity * 80);
        var b = Math.round(91 - intensity * 60);
        var bg = 'rgb(' + r + ',' + g + ',' + b + ')';
        html +=
          '<div title="' +
          w.start +
          ': ' +
          w.motionPct +
          '% motion" style="width:22px;height:18px;border-radius:3px;background:' +
          bg +
          ';cursor:default;font-size:8px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.8)">' +
          w.start.substr(0, 2) +
          '</div>';
      });
    html += '</div>';
  }
  html += '</div>'; // /.sec-section secondary

  // ── Hypoxic Burden — secondary tier ────────────────────────────
  html += '<div class="sec-section" data-tier="secondary">';
  html += '<div class="sec-label">Hypoxic Burden</div>';
  if (n.hb) {
    html +=
      '<div class="grid">' +
      metric('Total Burden', n.hb.total, '%-min below 94%', n.hb.total < 5 ? 'good' : n.hb.total < 20 ? 'warn' : 'bad') +
      metric('Burden Rate', n.hb.rate, '%-min/hr', n.hb.rate < 5 ? 'good' : n.hb.rate < 25 ? 'warn' : 'bad') +
      '</div>';
    html += '<div class="metric mt-xs cite-note">Hypoxic burden (AUC below SpO₂ 94%) captures sustained mild desaturation more sensitively than ODI. Clinical flag: >25 %-min/hr.</div>';
  }
  html += '</div>'; // /.sec-section secondary

  // Sleep Stability Score now rendered beside T-Index (paired grid above).

  // Flags — core
  html += '<div class="sec-label">Flags</div>';
  html +=
    '<div class="flags-wrap">' +
    (n.flags || [])
      .map(function (f) {
        return '<span class="fpill ' + f.sev + '">' + f.code + '</span>';
      })
      .join('') +
    '</div>';

  html += idx === 0 ? '' : renderResearchMetrics(n);
  return html;
}

// ── renderResearchMetrics: a complete, auto-generated dump of every
//    extended metric computed in processNight that is not already shown in a
//    dedicated panel. Research tier only. Keys are read live from each object
//    so field names can never drift out of sync with the compute functions.
function renderResearchMetrics(n) {
  if (!n) return '';
  var GROUPS = [
    [
      'SpO₂ — Extended Signal',
      [
        'spo2Drift',
        'odi2',
        'odi1',
        'spo2Over',
        'spo2Ac1',
        'spo2Shape',
        'spo2Pct',
        'condSpo2',
        't88t85',
        'ct94',
        'slopes',
        'desatAsym',
        'nadirTrend',
        'iei',
        'recovCV',
        'spo2NadirT',
        'spo2Ceil',
        'odri',
        'o2hrEff',
        'hypLoad',
        'hypDose',
        'oxyCrash'
      ]
    ],
    ['Heart Rate / HRV — Extended', ['hrFreq', 'respRate', 'hrAsym', 'hrQuart', 'hrCV', 'circHR', 'hrEnt', 'poincare', 'rmssdArc', 'hrNadirT', 'hrnDip', 'vagal', 'ssi', 'dfa', 'hrFlat', 'spo2HRLag']],
    ['HR Spike Kinematics', ['spkDecay', 'spkUnder', 'spkRise', 'spk50Rec']],
    ['Periodic Breathing & Pattern Probability', ['pbMet', 'fft', 'spo2Ent', 'patScore']],
    ['Sleep Architecture — Extended', ['stageProxy', 'lcsp', 'recIdx', 'sleepP', 'breathI', 'rolling']],
    ['Derived Indices & Recording QA', ['mos', 'ahiEst', 'extras', 'dataGaps']]
  ];
  function prettify(k) {
    return k
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      })
      .replace(/\bSpo2\b/g, 'SpO₂')
      .replace(/\bHr\b/g, 'HR')
      .replace(/\bHrv\b/g, 'HRV')
      .replace(/\bOdi\b/g, 'ODI')
      .replace(/\bAhi\b/g, 'AHI');
  }
  var body = '';
  GROUPS.forEach(function (g) {
    var rows = '',
      shown = 0;
    g[1].forEach(function (key) {
      var obj = n[key];
      if (obj == null || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (f) {
        var v = obj[f];
        if (v == null || v === '') return;
        if (typeof v === 'object') {
          try {
            v = Array.isArray(v) ? v.join(' / ') : JSON.stringify(v);
          } catch (e) {
            return;
          }
          if (v.length > 80) v = v.slice(0, 77) + '…';
        }
        // Truncate long strings — use data-tip for full text
        var vDisplay = v,
          vTip = '';
        if (typeof v === 'string' && v.length > 48) {
          vDisplay = v.slice(0, 45) + '…';
          vTip = ' title="' + v.replace(/"/g, '&quot;') + '"';
        }
        if (typeof v === 'number' && !isFinite(v)) return;
        // Color coding: zero=muted, negative=amber (notable), positive=blue (default)
        var cls = '';
        if (typeof v === 'number') {
          cls = v === 0 ? 'zero' : v < 0 ? 'warn' : '';
        } else if (typeof v === 'string') {
          // String labels: smaller font to prevent overflow, classify by keyword
          cls = 'lbl';
          if (/\b(high|severe|abrupt|worsening|critical|significant|leptokurtic)\b/i.test(v)) cls = 'bad lbl';
          else if (/\b(low|normal|stable|mild|none|occasional|regular|symmetric|platykurtic)\b/i.test(v)) cls = 'good lbl';
          else if (/\b(moderate|elevated|variable|mixed|early|blunted)\b/i.test(v)) cls = 'warn lbl';
        }
        rows += metric(prettify(f), vDisplay, prettify(key), cls, 'research', vTip);
        shown++;
      });
    });
    if (shown) body += '<div class="sec-label">' + g[0] + ' <span class="sec-count-badge">' + shown + '</span></div>' + '<div class="grid">' + rows + '</div>';
  });
  if (!body) return '';
  return (
    '<div class="research-accordion sec-section" data-tier="research">' +
    '<div class="research-accordion-header" data-act="toggleResearchAccordion">' +
    '<span>\uD83D\uDCCB Full Metrics Table</span>' +
    '<span class="research-accordion-header-line"></span>' +
    '<span class="research-accordion-chevron">▼</span></div>' +
    '<div class="research-accordion-body">' +
    (typeof buildFullMetricsTable === 'function' ? buildFullMetricsTable(n) : body) +
    '</div></div>'
  );
}

function metric(label, value, unit, cls, tier, extraAttr) {
  var tc = tier || 'primary';
  var wc = tc === 'hero' ? 'metric-hero' : tc === 'secondary' ? 'metric-secondary' : tc === 'research' ? 'metric-research' : 'metric-primary';
  return (
    '<div class="metric ' +
    wc +
    ' ' +
    (cls || '') +
    '" data-tier="' +
    tc +
    '">' +
    '<div class="m-label">' +
    evBadge(label) +
    label +
    '</div>' +
    '<div class="m-val ' +
    (cls || '') +
    '"' +
    (extraAttr || '') +
    '>' +
    value +
    '</div>' +
    '<div class="m-unit">' +
    unit +
    '</div>' +
    '</div>'
  );
}
// Three-color status helper
function stsCls(sev) {
  if (sev === 'g' || sev === 'good' || sev === 'ok') return 'ok';
  if (sev === 'w' || sev === 'warn') return 'warn';
  if (sev === 'r' || sev === 'bad') return 'bad';
  return 'neu';
}
function tiClass(pct, thr) {
  if (thr >= 92) return pct === 0 ? 'good' : pct < 1 ? 'warn' : 'bad';
  if (thr >= 88) return pct === 0 ? 'good' : pct < 0.5 ? 'warn' : 'bad';
  return pct === 0 ? 'good' : pct < 0.1 ? 'warn' : 'bad';
}

// ESM-MIGRATION deep-3: render is now an ES module — publish the cross-file surface
// (oxydex-dsp/fusion/profile's renderAll reach-in, fusion's evBadge calls, the app/data-act
// GC + detail/night controls). Bare cross-file reads resolve through window at call time.
Object.assign(window, {
  renderAll,
  evBadge,
  setGCWindow,
  setGCSmooth,
  toggleDetail,
  jumpToNight,
  metric,
  oxySpo2NightCV // §RN render-harness: testable SpO₂ night-CV
});
