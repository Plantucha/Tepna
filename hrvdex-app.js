/* ════ HRVDex · APP · INGEST · EXPORTS · GLUE (hrvdex-app.js) ───────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   File ingest (drag/drop + paste), CSV/JSON exports, clear-all, progress bar,
   theme + back-to-top, and startup profile load. Loaded LAST.
   Plain global script — shares page scope with the other hrvdex-*.js files,
   exactly as in the original single-script monolith. No behavior change.
   Load order: hrvdex-dsp → hrvdex-render → hrvdex-profile → hrvdex-app.
   ES module (ESM-MIGRATION deep-3): the imports below make that load order a real
   dependency edge (the bundler + browser guarantee it).
   ════════════════════════════════════════════════════════════════════════ */
import './hrvdex-dsp.js';
import './hrvdex-render.js';
import './hrvdex-profile.js';

/* ===== FILE LOAD ===== */
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag');
  const fs = e.dataTransfer.files;
  if (fs && fs.length) Array.from(fs).forEach(processFile);
});

function loadFile(e) {
  setProgress(10);
  const fs = e.target.files;
  if (!fs || !fs.length) return;
  Array.from(fs).forEach(processFile);
}
function loadPasted() {
  const text = document.getElementById('pasteArea').value.trim();
  if (!text) {
    alert('Please paste CSV content first.');
    return;
  }
  document.getElementById('pasteFallback').style.display = 'none';
  // Paste is an import too → additive (a leading { or [ means a pasted ECGDex/Ganglior JSON).
  const head = text.replace(/^\uFEFF/, '').trimStart();
  if ((head[0] === '{' || head[0] === '[') && _hrvMaybeReview(text)) return; // SELF-INGEST: HRVDex-own export → review
  if ((head[0] === '{' || head[0] === '[') && typeof ingestGangliorJSON === 'function') ingestGangliorJSON(text, {});
  else parseCSV(text, {});
}

// ── Synthetic patient generator (shared coherence engine · dex-patient-gen.js) ──
// HRV is multi-day by nature → render N nights for one patient as a Welltory CSV.
function genSyntheticPatient() {
  if (!window.DexPatientGen || !window.SYNTH) {
    return;
  }
  const r = DexPatientGen.fromControls('genScenario', 'genDays');
  if (!r) return;
  document.getElementById('pasteArea').value = SYNTH.renderHRVAll(r.tls);
  // Generating a fresh synthetic patient REPLACES the table (a new subject, not more data).
  parseCSV(document.getElementById('pasteArea').value, { replace: true });
}
// Wire the generate button (markup sits above this script, so it already exists).
(function () {
  const b = document.getElementById('genBtn');
  if (b) b.addEventListener('click', genSyntheticPatient);
})();

// Imports are additive and accept BOTH a Welltory-style CSV and an ECGDex / Ganglior
// JSON export (single or multiRecording). Detection is by extension + first non-BOM char.
function processFile(file) {
  if (!file) return;
  const reader = new FileReader();
  const name = (file.name || '').toLowerCase();
  reader.onload = (ev) => {
    const text = ev.target.result || '';
    const head = text.replace(/^\uFEFF/, '').trimStart();
    const looksJSON = name.endsWith('.json') || head[0] === '{' || head[0] === '[';
    if (looksJSON && _hrvMaybeReview(text)) {
      try {
        var fir = document.getElementById('fileInput');
        if (fir) fir.value = '';
      } catch (_r) {}
      return;
    } // SELF-INGEST review
    if (looksJSON && typeof ingestGangliorJSON === 'function') ingestGangliorJSON(text, {});
    else parseCSV(text, {});
    try {
      var fi = document.getElementById('fileInput');
      if (fi) fi.value = '';
    } catch (_) {} // allow re-adding the same file
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SELF-INGEST review mode (SELF-INGEST-FOLLOWUPS · HRVDex enrich-first pass)
//  A dropped HRVDex OWN ganglior.node-export → a faithful clinical VIEW from the
//  enriched per-measurement `measurements[]` table (no recompute, no re-stamp,
//  no append to the ledger). Foreign JSON (ECGDex) + Welltory CSV keep the
//  existing additive-import path. HRVDex has no raw waveform → nothing greyed.
// ═══════════════════════════════════════════════════════════════════════════
function _hrvMaybeReview(text) {
  try {
    var j = JSON.parse(text);
    if (j && j.schema && j.schema.name === 'ganglior.node-export' && ((j.schema.node || '') + '').trim() === 'HRVDex') {
      var res = window.HRVDex && typeof window.HRVDex.loadOwnExport === 'function' ? window.HRVDex.loadOwnExport(j) : null;
      if (res && res.ok) {
        hrvRenderReview(res);
        if (typeof setStatus === 'function') setStatus('Loaded HRVDex export \u2014 review mode (not recomputed).');
        return true;
      }
    }
  } catch (e) {}
  return false;
}
function _hrvesc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function _hrvD(tMs) {
  if (tMs == null) return '\u2014';
  var d = new Date(tMs);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function _hrvFmtGen(g) {
  if (!g) return '';
  try {
    return String(g).replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ' UTC');
  } catch (e) {
    return String(g);
  }
}
function _hrvInjectReviewCSS() {
  if (typeof document === 'undefined' || document.getElementById('hrv-selfingest-css')) return;
  var css =
    '' +
    '#hrvReviewCard{margin:0 0 22px}' +
    '.hrvrv-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 18px;padding:13px 18px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}' +
    '.hrvrv-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}' +
    '.hrvrv-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}' +
    '.hrvrv-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}' +
    '.hrvrv-spacer{flex:1 1 auto}' +
    '.hrvrv-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}' +
    '.hrvrv-card{padding:24px 26px;border-radius:14px;background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}' +
    '.hrvrv-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}' +
    '.hrvrv-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.hrvrv-sub{font-size:13px;color:var(--text3,#5E7187)}' +
    '.hrvrv-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5E7187);margin:18px 0 9px}' +
    '.hrvrv-imp{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}' +
    '.hrvrv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}' +
    '.hrvrv-kpi{padding:12px 14px;border-radius:10px;background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}' +
    '.hrvrv-kpi .k-lab{font-size:11px;color:var(--text3,#5E7187);margin-bottom:5px}' +
    '.hrvrv-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.hrvrv-kpi .k-sub{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}' +
    '.hrvrv-tbl{width:100%;border-collapse:collapse;font-size:12px}' +
    '.hrvrv-tbl th{text-align:right;color:var(--text3,#5E7187);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--border,#1f2e45)}' +
    '.hrvrv-tbl th:first-child{text-align:left}' +
    '.hrvrv-tbl td{text-align:right;color:var(--text2,#9FB0C3);padding:6px 10px;border-bottom:1px solid var(--border2,#182234);font-variant-numeric:tabular-nums}' +
    '.hrvrv-tbl td:first-child{text-align:left;font-family:ui-monospace,monospace;color:var(--text3,#5E7187)}' +
    '.hrvrv-tl{display:flex;flex-direction:column;border:1px solid var(--border,#1f2e45);border-radius:10px;overflow:hidden;margin-top:4px}' +
    '.hrvrv-tlrow{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:10px;padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}' +
    '.hrvrv-tlrow:first-child{border-top:none}' +
    '.hrvrv-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}' +
    '.hrvrv-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic;padding:6px 2px}' +
    '.hrvrv-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}' +
    '.hrvrv-disc .dxl{font-weight:700;color:var(--text2,#9FB0C3)}' +
    '@media print{body > *:not(#hrvReviewCard){display:none !important} #hrvReviewCard .hrvrv-print{display:none !important}}';
  var st = document.createElement('style');
  st.id = 'hrv-selfingest-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
}
function hrvReviewView(review) {
  var ms = Array.isArray(review.measurements) ? review.measurements : [],
    rec = review.recording || {};
  var prov = review.provenance || {},
    bh = prov.buildHash || (review.derivedFrom && review.derivedFrom.buildHash) || null,
    gen = _hrvFmtGen(prov.generated || review.generated);
  var nv = function (v, d) {
    return v == null || Number.isNaN(v) ? d || '\u2014' : v;
  };
  var num = function (a) {
    return a.filter(function (v) {
      return typeof v === 'number' && isFinite(v);
    });
  };
  var mean = function (a) {
    a = num(a);
    return a.length
      ? +(
          a.reduce(function (x, y) {
            return x + y;
          }, 0) / a.length
        ).toFixed(1)
      : null;
  };
  var last = ms.length ? ms[ms.length - 1] : {};
  var meanRm = mean(
      ms.map(function (m) {
        return m.rmssd;
      })
    ),
    meanSd = mean(
      ms.map(function (m) {
        return m.sdnn;
      })
    );
  var h =
    '<div class="hrvrv-banner" role="status">' +
    '<span class="hrvrv-tag"><span class="hrvrv-dot"></span>Review mode</span>' +
    '<span>Loaded from export \u00b7 <strong>not recomputed</strong>' +
    (review.scrubbed ? ' \u00b7 <strong>scrubbed for sharing</strong>' : '') +
    '</span>' +
    '<span class="hrvrv-meta">' +
    (bh ? 'built <code>' + _hrvesc(bh) + '</code>' : 'build unknown') +
    (gen ? ' on <code>' + _hrvesc(gen) + '</code>' : '') +
    '</span>' +
    '<span class="hrvrv-spacer"></span>' +
    '<button class="hrvrv-print" type="button" data-act="print">\ud83d\udda8 Save clinical PDF</button></div>';
  h += '<div class="hrvrv-card">';
  h +=
    '<div class="hrvrv-head"><span class="hrvrv-title">HRVDex \u2014 HRV ledger review</span>' +
    '<span class="hrvrv-sub">' +
    ms.length +
    ' measurement' +
    (ms.length === 1 ? '' : 's') +
    (rec.spanDays != null ? ' \u00b7 ' + rec.spanDays + ' days' : '') +
    ' \u00b7 ' +
    _hrvD(rec.firstTMs) +
    ' \u2192 ' +
    _hrvD(rec.lastTMs) +
    '</span></div>';
  h += '<div class="hrvrv-sec">Impression</div>';
  h +=
    '<div class="hrvrv-imp">Latest rMSSD ' +
    nv(last.rmssd) +
    ' ms \u00b7 SDNN ' +
    nv(last.sdnn) +
    ' ms \u00b7 mean HR ' +
    nv(last.hr) +
    ' bpm' +
    (meanRm != null ? ' \u00b7 window mean rMSSD ' + meanRm + ' ms' : '') +
    '. Rendered from the export\u2019s stored per-measurement table \u2014 no re-analysis.</div>';
  var kpis = [
    ['rMSSD (latest)', nv(last.rmssd), 'ms'],
    ['SDNN (latest)', nv(last.sdnn), 'ms'],
    ['Mean HR', nv(last.hr), 'bpm'],
    ['pNN50', nv(last.pnn50), '%'],
    ['SD1', nv(last.sd1), 'ms'],
    ['SD2', nv(last.sd2), 'ms'],
    ['Mean rMSSD', nv(meanRm), 'ms (window)'],
    ['Measurements', ms.length, 'count']
  ];
  h +=
    '<div class="hrvrv-sec">Key metrics</div><div class="hrvrv-kpis">' +
    kpis
      .map(function (k) {
        return (
          '<div class="hrvrv-kpi"><div class="k-lab">' +
          (typeof evBadge === 'function' ? evBadge(k[0]) : '') +
          _hrvesc(k[0]) +
          '</div><div class="k-val">' +
          _hrvesc(k[1]) +
          '</div><div class="k-sub">' +
          _hrvesc(k[2]) +
          '</div></div>'
        );
      })
      .join('') +
    '</div>';
  // per-measurement table (most recent first, capped)
  h += '<div class="hrvrv-sec">Per-measurement table</div>';
  if (ms.length) {
    var rowsDesc = ms
      .slice()
      .sort(function (a, b) {
        return (b.tMs || 0) - (a.tMs || 0);
      })
      .slice(0, 16);
    h +=
      '<table class="hrvrv-tbl"><thead><tr><th>Date</th><th>rMSSD</th><th>SDNN</th><th>HR</th><th>pNN50</th></tr></thead><tbody>' +
      rowsDesc
        .map(function (m) {
          return '<tr><td>' + _hrvD(m.tMs) + '</td><td>' + nv(m.rmssd) + '</td><td>' + nv(m.sdnn) + '</td><td>' + nv(m.hr) + '</td><td>' + nv(m.pnn50) + '</td></tr>';
        })
        .join('') +
      '</tbody></table>' +
      (ms.length > 16 ? '<div class="hrvrv-none">+ ' + (ms.length - 16) + ' more measurements</div>' : '');
  } else h += '<div class="hrvrv-none">No per-measurement rows in this export.</div>';
  // event timeline
  h += '<div class="hrvrv-sec">Event timeline</div>';
  var evs = (review.events || []).slice().sort(function (a, b) {
    return (a.tMs || 0) - (b.tMs || 0);
  });
  if (evs.length) {
    h +=
      '<div class="hrvrv-tl">' +
      evs
        .slice(0, 30)
        .map(function (e) {
          return (
            '<div class="hrvrv-tlrow"><span class="tl-t">' +
            _hrvesc(_hrvD(e.tMs) + ' ' + (e.t || '')) +
            '</span><span>' +
            _hrvesc(e.impulse || 'event') +
            '</span><span class="tl-t">conf ' +
            (e.conf != null ? e.conf : '\u2014') +
            '</span></div>'
          );
        })
        .join('') +
      '</div>';
  } else h += '<div class="hrvrv-none">No scored events in this export.</div>';
  h +=
    '<div class="hrvrv-disc">' +
    (bh ? 'Provenance \u00b7 build <code>' + _hrvesc(bh) + '</code>' + (gen ? ' \u00b7 generated ' + _hrvesc(gen) : '') : 'Provenance \u00b7 build unknown') +
    '<br><span class="dxl">Tepna \u00b7 not a medical device.</span> Computes HRV patterns for personal self-quantification; does not diagnose, treat, or monitor any condition.' +
    '</div></div>';
  return h;
}
function hrvRenderReview(review) {
  if (typeof document === 'undefined' || !review) return;
  _hrvInjectReviewCSS();
  var host = document.getElementById('hrvReviewCard');
  if (!host) {
    host = document.createElement('section');
    host.id = 'hrvReviewCard';
    var m = document.querySelector('main') || document.body;
    m.insertBefore(host, m.firstChild);
  }
  host.innerHTML = hrvReviewView(review);
  host.style.display = '';
  try {
    window.scrollTo(0, 0);
  } catch (e) {}
}
function hrvClearReview() {
  var h = document.getElementById('hrvReviewCard');
  if (h) {
    h.innerHTML = '';
    h.style.display = 'none';
  }
}
// F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — the review renderer is reachable via the node
// namespace (<Node>.reviewView / .renderReview) so the suite's live review probe (and any global
// caller) can drive it; the bare names stay IIFE-local.
try {
  if (typeof window !== 'undefined' && window.HRVDex) {
    window.HRVDex.reviewView = hrvReviewView;
    window.HRVDex.renderReview = hrvRenderReview;
  }
} catch (_rvx) {}

/* ===== CSV TOOLKIT (mirrored per node; null≠0, RFC-4180, Excel-safe) ===== */
// missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · formula-injection guarded.
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

/* ===== EXPORT CSV ===== */
function exportCSV() {
  const rows = getFilteredRows();
  const keys = TABLE_COLS.filter((c) => c.key !== '_date').map((c) => c.key);
  const out = [['Date', ...TABLE_COLS.filter((c) => c.key !== '_date').map((c) => c.label)]];
  rows.forEach((r) => {
    const date = r._date instanceof Date ? r._date.toISOString().split('T')[0] : '';
    // keep 4-dp precision for finite numbers; missing→blank, real 0→"0" (csvCell)
    const vals = keys.map((k) => {
      const v = r[k];
      return typeof v === 'number' && isFinite(v) ? +v.toFixed(4) : v;
    });
    out.push([date, ...vals]);
  });
  // Span-aware filename (EXPORT-HYGIENE §2.4): CSV/JSONL export the dashboard WINDOW view, so the name
  // carries first-night + Nd span, not a single misleading export-click HHMM (EXPORT-HYGIENE-FOLLOWUPS §1).
  const _tms = rows.map((r) => r._tMs).filter((v) => isFinite(v));
  const _aT0 = _tms.length ? Math.min.apply(null, _tms) : null;
  const _aSpan = _tms.length > 1 ? Math.round((Math.max.apply(null, _tms) - Math.min.apply(null, _tms)) / 864e5) : null;
  const blob = new Blob([csvDoc(out)], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportName({ node: 'HRVDex', t0Ms: _aT0, kind: 'summary', ext: 'csv', spanDays: _aSpan });
  a.click();
}

// Export download FILENAMES come from the shared dex-export.js exportName() — recording-anchored,
// viewer-TZ-independent, span-aware, controlled-vocab (EXPORT-HYGIENE §2). The old local-clock
// _exportTs() (== _hrvTs(); new Date()+LOCAL getters = export-click wall-clock) is DELETED.

// JSONL export — one JSON object per measurement (AI-friendly, like OxyDex)
function exportJSONL() {
  const rows = getFilteredRows();
  const keys = TABLE_COLS.filter((c) => c.key !== '_date').map((c) => c.key);
  const lines = rows.map(function (r) {
    const o = { date: r._date instanceof Date ? r._date.toISOString().split('T')[0] : null };
    keys.forEach(function (k) {
      var v = r[k];
      o[k] = v === undefined || (typeof v === 'number' && isNaN(v)) ? null : v;
    });
    return o;
  });
  // per-measurement ARRAY (multi-day window) → 'series'; span-aware name like the CSV view.
  const _tms = rows.map((r) => r._tMs).filter((v) => isFinite(v));
  const _aT0 = _tms.length ? Math.min.apply(null, _tms) : null;
  const _aSpan = _tms.length > 1 ? Math.round((Math.max.apply(null, _tms) - Math.min.apply(null, _tms)) / 864e5) : null;
  const blob = new Blob([JSON.stringify(lines, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportName({ node: 'HRVDex', t0Ms: _aT0, kind: 'series', ext: 'json', spanDays: _aSpan });
  a.click();
}

// ─── GANGLIOR BUS EMIT SHIM (Phase 0 → Phase 9) ───────────────────────────────
// HRVDex per-measurement rows → a ganglior.node-export the Integrator fuses as a
// first-class node. Phase-9 (SIGNAL-ADAPTER-FOLLOWUPS §4): the event set + envelope
// are now built by the SHARED hrvBuildNodeExport (hrvdex-dsp.js) that HRVDex.compute
// ALSO uses — so a Unifier/OverDex summary export is byte-identical to this one.
function exportGanglior() {
  // SIGNAL-ADAPTER-FOLLOWUPS-IX §1: the Ganglior BUS export carries the FULL ingested recording
  // (every accumulated measurement, full precision) — NOT the dashboard's getFilteredRows() VIEW,
  // which defaults to the last windowDays (7) + optional morning-only. The window is a HUMAN view
  // (the CSV/JSONL exports keep it); the machine bus export must be complete so the Integrator /
  // Data Unifier fuse the SAME recording the headless HRVDex.compute({text}) path emits — otherwise
  // a >7-day Welltory file silently fused only its last 7 days when exported from the app.
  const rows = typeof allRows !== 'undefined' && Array.isArray(allRows) ? allRows : [];
  if (!rows.length) {
    if (typeof setStatus === 'function') setStatus('No measurements loaded.');
    return;
  }
  const out = hrvBuildNodeExport(
    rows.filter((r) => isFinite(r._tMs)),
    { kernel: window.DexKernel || null }
  );
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // ganglior export covers the FULL recording — anchor + span come from its OWN computed recording block.
  a.download = exportName({ node: 'HRVDex', t0Ms: out.recording.startEpochMs, kind: 'ganglior', ext: 'json', spanDays: out.recording.spanDays });
  a.click();
  if (typeof setStatus === 'function')
    setStatus('✅ Ganglior bus export — ' + out.ganglior_events.length + ' events from ' + out.recording.measurements + ' measurements. Drop into Integrator to fuse.');
}

// Clear all accumulated data + wipe the saved history mirror, then return to upload
function clearAll() {
  if (!confirm('Clear all accumulated measurements and wipe the saved history from this browser? This cannot be undone.')) return;
  allRows = [];
  try {
    localStorage.removeItem(typeof HRV_STORE_KEY !== 'undefined' ? HRV_STORE_KEY : 'hrvdex_rows_v1');
  } catch (e) {}
  var mu = document.getElementById('mainUI');
  if (mu) mu.style.display = 'none';
  var pp = document.getElementById('profilePanel');
  if (pp) pp.style.display = 'none';
  var uz = document.getElementById('uploadZone');
  if (uz) uz.style.display = '';
  var es = document.getElementById('emptyState');
  if (es) es.style.display = '';
  var eb = document.getElementById('exportBar');
  if (eb) {
    eb.classList.remove('show');
    eb.style.display = 'none';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Load saved profile + restore the accumulated measurement history on startup.
// NB: in the bundled build the app scripts are injected AFTER DOMContentLoaded has
// already fired, so a DOMContentLoaded listener would never run — invoke directly
// (this script sits at end of <body>, so the DOM is already parsed) and only fall
// back to the event on the off chance the DOM is still loading.
function _hrvInit() {
  loadProfile();
  // Enable multi-file selection without touching the .src.html skeleton (keeps buildHash stable).
  try {
    var fi = document.getElementById('fileInput');
    if (fi) fi.multiple = true;
  } catch (_) {}
  try {
    if (typeof restoreHRVRows === 'function') restoreHRVRows();
  } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _hrvInit);
else _hrvInit();

// ── Progress bar ───────────────────────────────────────────────
function setProgress(pct) {
  var pw = document.getElementById('progressWrap');
  var pb = document.getElementById('progressBar');
  if (!pw || !pb) return;
  pw.style.display = 'block';
  pb.style.width = pct + '%';
  if (pct >= 100)
    setTimeout(function () {
      pw.style.display = 'none';
      pw.classList.remove('show');
    }, 700);
}

// ── Light / dark theme toggle ──────────────────────────────────
(function () {
  var STORAGE_KEY = 'welltory_theme';
  var icon = function () {
    return document.getElementById('themeIcon');
  };
  var label = function () {
    return document.getElementById('themeLabel');
  };

  function applyTheme(theme) {
    if (theme === 'light') {
      document.body.classList.add('light');
      if (icon()) icon().textContent = '🌙';
      if (label()) label().textContent = 'Dark';
    } else {
      document.body.classList.remove('light');
      if (icon()) icon().textContent = '☀️';
      if (label()) label().textContent = 'Light';
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {}
  }

  window.toggleTheme = function () {
    applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
  };

  // Restore saved preference
  var saved = 'dark';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'dark';
  } catch (e) {}
  applyTheme(saved);
})();

// ── Back to top button visibility ──────────────────────────────
(function () {
  var btn = document.getElementById('backToTop');
  if (!btn) return;
  var visible = false;
  window.addEventListener(
    'scroll',
    function () {
      var should = window.scrollY > 300;
      if (should !== visible) {
        visible = should;
        btn.style.opacity = visible ? '1' : '0';
        btn.style.pointerEvents = visible ? 'auto' : 'none';
      }
    },
    { passive: true }
  );
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
})();

// Event-delegation actions (CSP strict script-src — dex-actions.js). print/scrollTop/scrollToEl/
// clickEl/stop are DexActions builtins; the rest are HRVDex globals. Lazy window.* wrappers resolve
// at click time.
if (window.DexActions)
  DexActions.registerAll({
    switchTab: function (el) {
      window.switchTab(el.dataset.tab, el);
    },
    setMode: function (el) {
      window.setMode(el.dataset.mode, el);
    },
    setWindow: function (el) {
      window.setWindow(+el.dataset.win, el);
    },
    hrvNavTo: function (el) {
      window.hrvNavTo(el.dataset.nav, el);
    },
    toggleTheme: function () {
      window.toggleTheme();
    },
    toggleProfilePanel: function () {
      window.toggleProfilePanel();
    },
    loadPasted: function () {
      window.loadPasted();
    },
    loadFile: function (el, ev) {
      window.loadFile(ev);
    },
    rerender: function () {
      window.rerender();
    },
    renderHistogram: function () {
      window.renderHistogram();
    },
    renderScatterExplorer: function () {
      window.renderScatterExplorer();
    },
    renderWeekday: function () {
      window.renderWeekday();
    },
    exportJSONL: function () {
      window.exportJSONL();
    },
    exportCSV: function () {
      window.exportCSV();
    },
    clearAll: function () {
      window.clearAll();
    },
    hrvTogglePaste: function () {
      var p = document.getElementById('pasteFallback');
      if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
    },
    hrvSmoothInput: function (el) {
      var o = document.getElementById('smoothVal');
      if (o) o.textContent = el.value;
      window.rerender();
    }
  });

// ESM-MIGRATION deep-3: app is now an ES module — publish the cross-file surface
// (hrvdex-dsp's export/clear/progress reach-ins + the uploadZone element it inspects,
// and the loadFile/loadPasted data-act wrappers).
Object.assign(window, {
  loadFile,
  loadPasted,
  exportCSV,
  exportJSONL,
  exportGanglior,
  clearAll,
  setProgress,
  uploadZone
});
