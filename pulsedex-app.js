/* ════ PulseDex · App (pulsedex-app.js) ────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Orchestration & glue: theme, mobile nav, scroll-spy, file ingest (RR + Welltory
   CSV), action wiring, the main calculate() pipeline, CSV/JSON exports, reset,
   and shared helpers. Loaded LAST. Reads pulsedex-{dsp,render}.js + the overview
   module (loadProfile / renderOverviewPx / computeProfileHints).
   ES module (ESM-MIGRATION deep-3): the imports below make the DSP → render → overview →
   app load order a real dependency edge (the bundler + browser guarantee it), replacing the
   former script-tag-order convention. Immediate-execution glue lives here.
   No external libraries. ════════════════════════════════════════════════════ */
import './pulsedex-dsp.js';
import './pulsedex-render.js';
import './pulsedex-overview.js';
// ESM-MIGRATION Phase 4: explicit DSP-helper imports — destructured from the namespace's
// _bare surface (the app shell sets __DEX_NAMESPACED__, so the bare-global spray no longer
// runs on this page; every DSP helper this module uses is named here, import-style).
const {
  fmtDateTime,
  mean,
  std,
  rmssd,
  pnn50,
  nn50c,
  mxdmn,
  quant,
  modeV,
  amo50,
  sd1,
  sd2,
  lnR,
  nu,
  ansBalance,
  stressEst,
  hrvEst,
  energyEst,
  focusEst,
  cohEst,
  vo2Base,
  vo2Adj,
  altVO2Factor,
  periodicBreathingIndex,
  siCalc,
  efcIdx,
  crsIdx,
  absIdx,
  dfaAlpha1,
  sampEn,
  fragmentation,
  prsaCapacity,
  triangularIndex,
  triIdxNormApplies,
  lombScargle,
  mergeMultipart,
  parseRRInput,
  arrMin,
  arrMax,
  medianOf,
  artifactClean,
  beatTimes,
  MODE_LABEL,
  classifyRecording,
  windowAnalysis,
  compareIntervalSeries,
  pdBuildNodeExport,
  pulseLoadOwnExport
} = window.PulseDex._bare;
// mutable page state: bridge bare window.lastResult ↔ the DSP-owned PulseDex.lastResult (the DSP's own
// window proxy is spray-guarded and no longer installs here; render/overview read it bare).
Object.defineProperty(window, 'lastResult', {
  configurable: true,
  get: function () {
    return window.PulseDex.lastResult;
  },
  set: function (v) {
    window.PulseDex.lastResult = v;
  }
});

// ─── THEME ────────────────────────────────────────────────────────────────────
const themeBtn = document.getElementById('themeBtn');
themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('light');
  themeBtn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀️ Light';
});

// ─── MOBILE NAV DRAWER ─────────────────────────────────────────────────────────
(function () {
  const tgl = document.getElementById('navToggle'),
    sb = document.querySelector('.app-shell > .sidebar'),
    bd = document.getElementById('navBackdrop');
  if (!tgl || !sb) return;
  const setOpen = (open) => {
    sb.classList.toggle('open', open);
    bd.classList.toggle('show', open);
    tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
    tgl.textContent = open ? '✕' : '☰';
  };
  tgl.addEventListener('click', () => setOpen(!sb.classList.contains('open')));
  bd.addEventListener('click', () => setOpen(false));
  sb.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  window.matchMedia('(min-width:1081px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
})();

// ─── SIDEBAR ACTIVE STATE (scroll-spy) — mirrors HRVDex / OxyDex nav ──────────
const navItems = [...document.querySelectorAll('.sb-nav .sb-item')];
function setActiveNav(id) {
  navItems.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
}
navItems.forEach((a) => a.addEventListener('click', () => setActiveNav(a.getAttribute('href').slice(1))));
const navSpy = new IntersectionObserver(
  (entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (vis[0]) setActiveNav(vis[0].target.id);
  },
  { rootMargin: '-18% 0px -72% 0px', threshold: [0, 0.25, 0.5, 1] }
);
['sec-upload', 'heroTop', 'sec-profile', 'slKPI', 'slANS', 'slGraph', 'slTbl', 'slWT'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) navSpy.observe(el);
});
if (navItems[0]) navItems[0].classList.add('active');

// ─── FILE INPUTS ──────────────────────────────────────────────────────────────
const rawInput = document.getElementById('rawInput');
const rawZone = document.getElementById('rawZone');
const wtInput = document.getElementById('wtInput');

// skip clicks on interactive children (the Choose-File button is now data-act="clickEl";
// the zone must not also fire rawInput.click() — CSP-strict handler migration).
rawZone.addEventListener('click', (e) => {
  if (e.target.closest('button,a,label,select,input')) return;
  rawInput.click();
});
rawInput.addEventListener('change', (e) => {
  const fs = e.target.files;
  if (!fs || !fs.length) return;
  loadRawFiles(fs);
  e.target.value = '';
});

// drag & drop on zone
rawZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  rawZone.classList.add('drag');
});
rawZone.addEventListener('dragleave', () => rawZone.classList.remove('drag'));
rawZone.addEventListener('drop', (e) => {
  e.preventDefault();
  rawZone.classList.remove('drag');
  const fs = e.dataTransfer.files;
  if (!fs || !fs.length) return;
  loadRawFiles(fs);
});

// Load one or many RR recordings. Each becomes its own stored result (multi-day);
// the last one loaded becomes the active view. A single file behaves exactly as before.
function loadRawFiles(fileList) {
  const arr = [...fileList];
  showChip(arr.length > 1 ? arr.length + ' files' : arr[0].name);
  Promise.all(arr.map((f) => f.text().then((t) => ({ name: f.name, text: t })))).then((list) => {
    // SELF-INGEST (PulseDex pass): a PulseDex ganglior.node-export among the dropped files → review mode
    // (a faithful VIEW of the export's stored HRV, no recompute); a foreign export shows the redirect msg.
    try {
      if (typeof pulseClearReview === 'function') pulseClearReview();
    } catch (_pc) {}
    var _envItem = list.find(function (it) {
      try {
        var j = JSON.parse(it.text);
        return j && j.schema && j.schema.name === 'ganglior.node-export';
      } catch (e) {
        return false;
      }
    });
    if (_envItem) {
      var _res = typeof pulseLoadOwnExport === 'function' ? pulseLoadOwnExport(JSON.parse(_envItem.text)) : null;
      if (_res && _res.ok) {
        try {
          window._pulseReview = _res;
        } catch (_w) {}
        if (typeof pulseRenderReview === 'function') pulseRenderReview(_res);
        if (typeof showOK === 'function') showOK('Loaded PulseDex export — review mode (not recomputed).');
        _curFname = null;
        return;
      }
      if (_res && _res.reason === 'foreign-node') {
        if (typeof showErr === 'function') showErr(_res.message);
        _curFname = null;
        return;
      }
      // not a PulseDex envelope kind → fall through to the normal RR path (which reports if unreadable).
    }
    list = mergeMultipart(list); // fold Polar `_RR_part01of..` / `_PPI_part..` splits into one stream per base
    list.forEach((it) => {
      document.getElementById('rawPaste').value = it.text;
      _curFname = it.name;
      calculate(); // stores into allRecordings + sets active
    });
    _curFname = null;
  });
}

function showChip(name) {
  const chip = document.getElementById('rawChip');
  document.getElementById('rawChipName').textContent = name;
  chip.classList.add('show');
}

// Welltory CSV upload
let welltoryData = null;
// ESM-MIGRATION deep-3: app is now an ES module, so this `let` is module-scoped. pulsedex-render /
// -overview read `welltoryData` as a bare global (resolving through window at call time) — proxy the
// window property to the in-module binding, exactly like pulsedex-dsp.js does for `lastResult`.
Object.defineProperty(window, 'welltoryData', {
  configurable: true,
  get: function () {
    return welltoryData;
  },
  set: function (v) {
    welltoryData = v;
  }
});
// ── multi-day retrofit — additive; single-recording stays byte-identical ──
let allRecordings = {}; // key (floating t0Ms string) → result object
let activeKey = null,
  _recSeq = 0,
  _curFname = null;
wtInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = (ev) => {
    welltoryData = parseWelltoryCSV(ev.target.result);
    document.getElementById('wtStatus').textContent = '✅ ' + welltoryData.rows.length + ' row(s) loaded';
    if (lastResult) {
      renderWTTable(lastResult);
      reRender();
    } // refresh KPI deltas, Recov Index, SDNN-Z, hero trend chips
  };
  fr.readAsText(f);
});

// ─── COMPARE A SECOND SIGNAL (RR ↔ PPI · PRV ↔ HRV) ──────────────────────────
let cmpData = null; // parsed reference series { vals, tsMs, t0Ms, kind, label }
function _pdKind(sourceFormat, fname) {
  const u = (fname || '').toUpperCase();
  if (/_PPI\b|_PPI\./.test(u)) return 'ppi';
  if (/_RR\b|_RR\./.test(u)) return 'rr';
  return sourceFormat || 'rr';
}
(function () {
  const cmpInput = document.getElementById('cmpInput');
  if (!cmpInput) return;
  cmpInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const st = document.getElementById('cmpStatus');
    f.text().then((txt) => {
      const p = parseRRInput(txt);
      if (!p.vals || p.vals.length < 5) {
        st.textContent = '⚠ Could not read ≥5 intervals from that file.';
        return;
      }
      const kind = _pdKind(p.sourceFormat, f.name);
      cmpData = { vals: p.vals, tsMs: p.tsMs, t0Ms: p.t0Ms, kind, label: f.name };
      st.textContent = '✅ ' + p.vals.length.toLocaleString() + ' ' + (kind === 'ppi' ? 'PPI' : 'RR') + ' intervals · ' + f.name + (lastResult ? '' : ' — load/calculate a recording to compare');
      if (lastResult) renderComparison();
    });
    e.target.value = '';
  });
})();

const _CMP_COL = { ok: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' };
function _cmpTile(label, val, unit, sub, col) {
  return (
    '<div style="background:var(--surface2);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:13px 14px">' +
    '<div class="cmp-tile-l" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin-bottom:6px">' +
    (typeof evBadge === 'function' ? evBadge(label) : '') +
    label +
    '</div>' +
    "<div style=\"font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700;color:" +
    (col || 'var(--text)') +
    ';line-height:1">' +
    val +
    (unit ? '<span style="font-size:12px;color:var(--text3);font-weight:500"> ' + unit + '</span>' : '') +
    '</div>' +
    (sub ? '<div style="font-size:11px;color:var(--text2);margin-top:5px;line-height:1.4">' + sub + '</div>' : '') +
    '</div>'
  );
}
function _pdBASVG(pairs, bias, loLo, loHi) {
  if (!pairs || pairs.length < 2) return '';
  const W = 680,
    H = 210,
    P = { l: 54, r: 80, t: 14, b: 30 };
  let xmn = Infinity,
    xmx = -Infinity,
    ymn = Infinity,
    ymx = -Infinity;
  for (const pr of pairs) {
    const x = pr[0],
      y = pr[1];
    if (x < xmn) xmn = x;
    if (x > xmx) xmx = x;
    if (y < ymn) ymn = y;
    if (y > ymx) ymx = y;
  }
  ymn = Math.min(ymn, loLo);
  ymx = Math.max(ymx, loHi);
  if (xmx === xmn) xmx = xmn + 1;
  if (ymx === ymn) ymx = ymn + 1;
  const padY = (ymx - ymn) * 0.14;
  ymn -= padY;
  ymx += padY;
  const sx = (x) => P.l + ((x - xmn) / (xmx - xmn)) * (W - P.l - P.r);
  const sy = (y) => H - P.b - ((y - ymn) / (ymx - ymn)) * (H - P.t - P.b);
  const dots = pairs.map((pr) => '<circle cx="' + sx(pr[0]).toFixed(1) + '" cy="' + sy(pr[1]).toFixed(1) + '" r="1.8" fill="var(--teal)" opacity=".45"/>').join('');
  const hl = (v, col, dash, lab) =>
    '<line x1="' +
    P.l +
    '" y1="' +
    sy(v).toFixed(1) +
    '" x2="' +
    (W - P.r) +
    '" y2="' +
    sy(v).toFixed(1) +
    '" stroke="' +
    col +
    '" stroke-dasharray="' +
    dash +
    '" opacity=".75"/>' +
    '<text x="' +
    (W - P.r + 5) +
    '" y="' +
    (sy(v) + 3).toFixed(1) +
    '" fill="' +
    col +
    '" font-size="9" font-family="IBM Plex Mono,monospace">' +
    lab +
    '</text>';
  return (
    '<svg viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" preserveAspectRatio="none" style="width:100%;height:auto" role="img">' +
    '<line x1="' +
    P.l +
    '" y1="' +
    P.t +
    '" x2="' +
    P.l +
    '" y2="' +
    (H - P.b) +
    '" stroke="rgba(255,255,255,.12)"/>' +
    '<line x1="' +
    P.l +
    '" y1="' +
    (H - P.b) +
    '" x2="' +
    (W - P.r) +
    '" y2="' +
    (H - P.b) +
    '" stroke="rgba(255,255,255,.12)"/>' +
    dots +
    hl(loHi, 'var(--amber)', '3 4', '+1.96σ ' + loHi.toFixed(0)) +
    hl(bias, 'var(--blue)', '6 4', 'bias ' + bias.toFixed(1)) +
    hl(loLo, 'var(--amber)', '3 4', '−1.96σ ' + loLo.toFixed(0)) +
    '<text x="' +
    (P.l - 6) +
    '" y="' +
    (sy(ymx) + 9).toFixed(1) +
    '" fill="#6F8096" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">' +
    ymx.toFixed(0) +
    '</text>' +
    '<text x="' +
    (P.l - 6) +
    '" y="' +
    sy(ymn).toFixed(1) +
    '" fill="#6F8096" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace">' +
    ymn.toFixed(0) +
    '</text>' +
    '<text x="' +
    ((P.l + W - P.r) / 2).toFixed(0) +
    '" y="' +
    (H - 6) +
    '" fill="#6F8096" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace">mean of the two paired intervals (ms)</text>' +
    '<text x="14" y="' +
    ((P.t + H - P.b) / 2).toFixed(0) +
    '" fill="#6F8096" font-size="9" text-anchor="middle" font-family="IBM Plex Mono,monospace" transform="rotate(-90 14 ' +
    ((P.t + H - P.b) / 2).toFixed(0) +
    ')">ref − primary (ms)</text>' +
    '</svg>'
  );
}
function renderComparison() {
  const card = document.getElementById('cmpCard'),
    title = document.getElementById('slCmp');
  if (!card || !title || !lastResult || !cmpData || !lastResult._series) return;
  const res = compareIntervalSeries(lastResult._series, cmpData);
  if (!res) return;
  title.style.display = 'block';
  card.style.display = 'block';
  if (res.error) {
    card.innerHTML = '<div style="background:var(--surface);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;color:var(--text2)">' + escapeHTML(res.error) + '</div>';
    return;
  } // F2: escape error text

  const priLab = (lastResult._series.kind === 'ppi' ? 'PPI' : 'RR') + ' · ' + (lastResult.fname || 'loaded');
  const refLab = (cmpData.kind === 'ppi' ? 'PPI' : 'RR') + ' · ' + cmpData.label;
  const clk = res.haveAbs ? 'beat-matched on the shared wall-clock' : 'beat-matched by cumulative timing — no shared clock, alignment approximate';

  if (res.weak) {
    card.innerHTML =
      '<div style="background:var(--surface);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px;color:var(--text2);line-height:1.6">' +
      '<b>' +
      res.matched +
      '</b> beats lined up (' +
      res.matchRatePct +
      '%). ' +
      escapeHTML(res.note || '') + // F2: escape note
      '</div>';
    return;
  }

  const A = res.statsA,
    B = res.statsB,
    ag = res.agreement,
    dc = res.discrepancy;
  const rows = [
    ['Mean interval', 'meanRR', 'ms'],
    ['Rate', 'hr', 'bpm'],
    ['SDNN', 'sdnn', 'ms'],
    ['rMSSD', 'rmssd', 'ms'],
    ['pNN50', 'pnn50', '%']
  ];
  const tbl =
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="color:var(--text3);text-align:right">' +
    '<th style="text-align:left;padding:8px 10px;font-weight:600">Metric</th>' +
    '<th style="padding:8px 10px;font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    escapeHTML(priLab) +
    '</th>' + // F2: escape filename-derived label
    '<th style="padding:8px 10px;font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    escapeHTML(refLab) +
    '</th>' +
    '<th style="padding:8px 10px;font-weight:600">Δ (ref−pri)</th></tr></thead><tbody>' +
    rows
      .map((r) => {
        const a = A[r[1]],
          b = B[r[1]],
          d = +(b - a).toFixed(1);
        const dcol = Math.abs(d) < (r[1] === 'meanRR' ? 12 : r[1] === 'hr' ? 2 : r[1] === 'pnn50' ? 5 : 6) ? 'var(--green)' : 'var(--amber)';
        return (
          '<tr style="border-top:1px solid rgba(255,255,255,.05);font-family:\'IBM Plex Mono\',monospace;text-align:right">' +
          '<td style="text-align:left;padding:8px 10px;font-family:inherit;color:var(--text2)">' +
          r[0] +
          '<span style="opacity:.5"> ' +
          r[2] +
          '</span></td>' +
          '<td style="padding:8px 10px;color:var(--text)">' +
          a +
          '</td>' +
          '<td style="padding:8px 10px;color:var(--text)">' +
          b +
          '</td>' +
          '<td style="padding:8px 10px;color:' +
          dcol +
          '">' +
          (d > 0 ? '+' : '') +
          d +
          '</td></tr>'
        );
      })
      .join('') +
    '</tbody></table>';

  const agTiles =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px">' +
    _cmpTile('Bias', (ag.biasMs > 0 ? '+' : '') + ag.biasMs, 'ms', 'mean ref−primary', _CMP_COL[ag.grade]) +
    _cmpTile('Limits of agreement', ag.loaLoMs + ' … ' + ag.loaHiMs, 'ms', '95% (bias ±1.96σ)', 'var(--text)') +
    _cmpTile('Mean abs diff', ag.madMs, 'ms', 'beat-to-beat', _CMP_COL[ag.grade]) +
    _cmpTile('Within 25 ms', ag.within25Pct, '%', 'of matched beats', ag.within25Pct >= 90 ? 'var(--green)' : ag.within25Pct >= 75 ? 'var(--amber)' : 'var(--red)') +
    _cmpTile('Correlation', ag.pearsonR == null ? '—' : ag.pearsonR, 'r', 'paired intervals', ag.pearsonR != null && ag.pearsonR >= 0.95 ? 'var(--green)' : 'var(--amber)') +
    '</div>';

  const pttvCol = dc.pttvMs <= 15 ? 'var(--green)' : dc.pttvMs <= 30 ? 'var(--amber)' : 'var(--red)';
  const discTiles =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px">' +
    _cmpTile('Δ rMSSD', (dc.dRMSSD > 0 ? '+' : '') + dc.dRMSSD, 'ms', 'PRV − HRV (matched)', 'var(--text)') +
    _cmpTile('rMSSD ratio', dc.rmssdRatio == null ? '—' : dc.rmssdRatio, '×', 'ref ÷ primary', 'var(--text)') +
    _cmpTile('Transit-time variability', dc.pttvMs, 'ms', '√(PRV²−HRV²) · vascular tone surrogate', pttvCol) +
    '</div>';

  card.innerHTML =
    '<div style="background:var(--surface);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:16px 18px 18px;overflow-x:auto">' +
    '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.5"><b>' +
    res.matched.toLocaleString() +
    '</b> beats matched (' +
    res.matchRatePct +
    '%) · ' +
    clk +
    '.</div>' +
    tbl +
    '<div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin:18px 0 2px">Beat-level agreement</div>' +
    agTiles +
    '<div style="margin-top:14px">' +
    _pdBASVG(res.blandAltman, ag.biasMs, ag.loaLoMs, ag.loaHiMs) +
    '</div>' +
    '<div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text3);margin:18px 0 2px">PRV ↔ HRV discrepancy</div>' +
    discTiles +
    '<div style="font-size:12px;color:var(--text2);margin-top:12px;line-height:1.55">' +
    dc.note +
    '</div>' +
    '</div>';
}

// T5: derive a recording anchor from the FILENAME when the RR content has no
// timestamp (Clock Contract anchor priority: 14-digit / YYYYMMDD[_-]HHMMSS in the
// name → floating wall-clock ms via Date.UTC). Polar exports embed it, e.g.
// "Polar_H10_..._20260607_222133_RR.txt".
function _pdT0FromName(name) {
  if (!name) return null;
  const m = String(name).match(/(20\d{2})(\d{2})(\d{2})[ _-]?(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    h = +m[4],
    mi = +m[5],
    s = +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s); // floating wall-clock ms — getUTC* on read
}

function parseWelltoryCSV(txt) {
  txt = txt.replace(/^\uFEFF/, ''); // strip UTF-8 BOM (our own exports carry one; Welltory app files may too)
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  return { header, rows };
}

function findWTRow(dateStr) {
  if (!welltoryData || !welltoryData.rows.length) return null;
  const match = welltoryData.rows.find((r) => (r[0] || '').slice(0, 10) === dateStr);
  return match || welltoryData.rows[0];
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────
document.getElementById('calcBtn').addEventListener('click', calculate);
document.getElementById('btnClear').addEventListener('click', resetAll);
document.getElementById('btnCSV').addEventListener('click', exportCSV);
document.getElementById('btnJSON').addEventListener('click', exportJSON);
(function () {
  var _b = document.getElementById('btnSumCSV');
  if (_b) _b.addEventListener('click', exportSummaryCSV);
})();

// ── Synthetic patient generator (shared coherence engine · dex-patient-gen.js) ──
// Renders N consecutive nights for one patient as Polar RR streams → multi-day.
function genSyntheticPatient() {
  if (!window.DexPatientGen || !window.SYNTH) {
    return;
  }
  var r = DexPatientGen.fromControls('genScenario', 'genDays');
  if (!r) return;
  try {
    showChip(DexPatientGen.chip(r));
  } catch (_) {}
  var files = r.tls.map(function (tl) {
    return new File([SYNTH.renderRR(tl)], 'RR_synthetic_' + r.profile + '_' + tl.cfg.date + '.txt', { type: 'text/plain' });
  });
  loadRawFiles(files);
}
(function () {
  var b = document.getElementById('genBtn');
  if (b) b.addEventListener('click', genSyntheticPatient);
})();

// restore saved profile (manual entries persist across reloads)
loadProfile();

function calculate() {
  clearAlerts();
  const raw = document.getElementById('rawPaste').value;
  const parsed = parseRRInput(raw);
  if (parsed.usable === false || !parsed.vals || parsed.vals.length < 10) {
    const why = parsed.reason || 'Need at least 10 RR values (ms).';
    // an empty / all-zero device onboard stream → point at the raw-waveform node
    const deviceEmpty = parsed.nRaw === 0 || (parsed.nUsable === 0 && parsed.nRaw > 0);
    showErr(why + (deviceEmpty ? ' — analyze the raw optical waveform in PpgDex (`*_PPG.txt`) instead of the device onboard stream.' : ''));
    return;
  }
  // T5: RR content had no timestamp → try the filename so PulseDex can still be
  // placed on the shared clock and fused (was silently dropped as dateUnknown).
  let _t0Source = parsed.t0Ms != null ? 'content' : null;
  if (parsed.t0Ms == null) {
    const fnT0 = _pdT0FromName(_curFname);
    if (fnT0 != null) {
      parsed.t0Ms = fnT0;
      _t0Source = 'filename';
    } else {
      _t0Source = 'none';
      console.warn('PulseDex: no timestamp in RR content or filename — recording stays undated (excluded from fusion).');
    }
  }

  progress(15, 'Cleaning artifacts…');
  const clean = artifactClean(parsed.vals);
  const a = clean.clean;
  const N = a.length;
  if (N < 10) {
    showErr('Fewer than 10 usable RR values found.');
    return;
  }

  // ── timing & coverage ──
  const times = beatTimes(a, parsed.tsMs);
  const durSec = times[N - 1] || (N * mean(a)) / 1000;
  let coverage = 100;
  if (parsed.tsMs && isFinite(parsed.tsMs[0]) && isFinite(parsed.tsMs[N - 1])) {
    const wall = (parsed.tsMs[N - 1] - parsed.tsMs[0]) / 1000;
    let rrSum = 0;
    for (let i = 0; i < N; i++) rrSum += a[i] / 1000;
    coverage = wall > 0 ? +Math.min(100, (rrSum / wall) * 100).toFixed(1) : 100;
  }

  // ── classify (auto) + manual override ──
  const ov = document.getElementById('modeOverride').value;
  const cls = classifyRecording(a, parsed.t0Ms, durSec);
  const mode = ov && ov !== 'auto' ? ov : cls.mode;
  const overridden = !!(ov && ov !== 'auto' && ov !== cls.mode);
  const longRec = mode === 'overnight' || mode === 'continuous';

  progress(35, 'Computing metrics…');

  // ── whole-record metrics ──
  const meanRR = mean(a),
    sdnn = std(a),
    rm = rmssd(a),
    pn = pnn50(a),
    nn50 = nn50c(a);
  const hr = +(60000 / meanRR).toFixed(1),
    cv = +((sdnn / meanRR) * 100).toFixed(2);
  const mx = +mxdmn(a).toFixed(1),
    mo = modeV(a),
    amo = +amo50(a, mo).toFixed(1);

  // ── windowed (long recordings) ──
  let win = null,
    sdann = null,
    sdnnIdx = null,
    repSeg = a,
    winSpec = null;
  let dispRm = rm,
    dispSd = sdnn,
    dispHr = hr,
    dispPn = pn,
    dispMeanRR = meanRR;
  if (longRec) {
    progress(50, 'Windowing ' + (durSec / 3600).toFixed(1) + ' h into 5-min epochs…');
    win = windowAnalysis(a, times, 300);
    if (win.wins.length >= 3) {
      const rmA = win.wins.map((w) => w.rmssd),
        sdA = win.wins.map((w) => w.sdnn),
        hrA = win.wins.map((w) => w.hr),
        pnA = win.wins.map((w) => w.pnn),
        rrA = win.wins.map((w) => w.meanRR);
      dispRm = +medianOf(rmA).toFixed(2);
      dispSd = +medianOf(sdA).toFixed(2);
      dispHr = +medianOf(hrA).toFixed(1);
      dispPn = +medianOf(pnA).toFixed(1);
      dispMeanRR = +medianOf(rrA).toFixed(1);
      sdann = +std(rrA).toFixed(2); // SD of 5-min mean-RR (long-recording index)
      sdnnIdx = +mean(sdA).toFixed(2); // mean of 5-min SDNNs (long-recording index)
      let bi = 0,
        bd = Infinity; // representative window = rmssd closest to night median
      for (let i = 0; i < rmA.length; i++) {
        const d = Math.abs(rmA[i] - dispRm);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      repSeg = win.segs[bi];
      // robust spectrum = MEDIAN of per-window Lomb–Scargle (detrended), not one window
      progress(60, 'Per-window spectra…');
      const sh = [],
        sl = [],
        sv = [],
        stp = [],
        srr = [];
      for (const seg of win.segs) {
        const w = lombScargle(seg, 256);
        sh.push(w.hf);
        sl.push(w.lf);
        sv.push(w.vlf);
        stp.push(w.tp);
        if (w.respRate > 0) srr.push(w.respRate);
      }
      winSpec = { hf: Math.round(medianOf(sh)), lf: Math.round(medianOf(sl)), vlf: Math.round(medianOf(sv)), tp: Math.round(medianOf(stp)), respRate: srr.length ? +medianOf(srr).toFixed(1) : 0 };
    }
  }

  // ── spectrum via Lomb–Scargle (the single source of truth — a real, detrended PSD,
  //    not the rmssd² heuristic). Long recs use the MEDIAN of per-window spectra;
  //    short recs use the whole segment. Whole-night variance kept as VLF/ULF context. ──
  const ls = lombScargle(longRec ? repSeg : a);
  const sp = winSpec ? { tp: winSpec.tp, hf: winSpec.hf, lf: winSpec.lf, vlf: winSpec.vlf } : { tp: ls.tp, hf: ls.hf, lf: ls.lf, vlf: ls.vlf };
  const ans = ansBalance(sp.hf, sp.lf);
  const respRate = winSpec ? winSpec.respRate : ls.respRate;
  // The crude whole-night variance split (rmssd²-proxy) that fed the "VLF (night)"/"Total Pwr (night)"
  // display rows was REMOVED 2026-06-30 (DEEP-AUDIT-FIXES §1); Lomb–Scargle (ls) is the only PSD source.
  const cMeanRR = longRec ? dispMeanRR : meanRR;

  // ── composites — built from representative values so long recs aren't skewed ──
  const cSd = longRec ? dispSd : sdnn,
    cRm = longRec ? dispRm : rm,
    cPn = longRec ? dispPn : pn,
    cHr = longRec ? dispHr : hr;
  // representative geometric values for the comparable export line + the (short-term) Baevsky SI
  const gSeg = longRec ? repSeg : a;
  const cMx = +mxdmn(gSeg).toFixed(1),
    cMo = modeV(gSeg),
    cAmo = +amo50(gSeg, cMo).toFixed(1);
  const cCv = +((cSd / cMeanRR) * 100).toFixed(2);
  const expSd1 = +sd1(cRm).toFixed(2),
    expSd2 = +sd2(cSd, cRm).toFixed(2);
  const stress = stressEst(cSd, cRm),
    hrv = hrvEst(cSd, cRm, cPn),
    energy = energyEst(cSd, cRm),
    focus = focusEst(cSd, cRm),
    coh = cohEst(cRm, cSd);
  const satP = ans.psns >= 100,
    satE = energy >= 100; // ceiling-saturation flags
  const sd1v = +sd1(rm).toFixed(2),
    sd2v = +sd2(sdnn, rm).toFixed(2);
  const lnrm = +lnR(cRm).toFixed(3);
  const lfhfv = winSpec ? +(winSpec.lf / (winSpec.hf || 1)).toFixed(3) : ls.lfhf;
  const hfnu = +nu(sp.hf, sp.hf + sp.lf).toFixed(1),
    lfnu = +nu(sp.lf, sp.hf + sp.lf).toFixed(1);
  const ell = +(Math.PI * sd1v * sd2v).toFixed(1);
  const si = +siCalc(cAmo, cMo, cMx).toFixed(1); // SI is a short-term index → representative window
  const _pp = typeof pxProfile === 'function' ? pxProfile() : {};
  const age = _pp.age || 40;
  const tanaka = Math.round(208 - 0.7 * age);
  const hrmaxIn = _pp.hrmax || 0;
  const rhrIn = _pp.rhr || 0;
  // Awake resting HR for VO₂: overnight HR is SLEEPING HR (~8 bpm below awake) —
  // use nocturnal floor (p5 of window HRs) + 8 (OxyDex method). Short awake readings = measured.
  let hrFloor = null,
    autoRHR = Math.round(cHr);
  if (longRec && win && win.wins.length >= 3) {
    const hrs = win.wins.map((w) => w.hr).sort((x, y) => x - y);
    hrFloor = Math.round(hrs[Math.floor(hrs.length * 0.05)]); // nocturnal HR floor (p5)
    autoRHR = hrFloor + 8; // awake resting HR ≈ floor + 8
  }
  const rhrEff = rhrIn > 0 ? rhrIn : autoRHR;
  // Guard implausible HRmax: a true max must clear rest by a wide margin and sit in range.
  const hrmaxValid = hrmaxIn > 0 && hrmaxIn >= 140 && hrmaxIn > rhrEff + 45;
  const hrmaxEff = hrmaxValid ? Math.round(hrmaxIn) : tanaka;
  const hrmaxRejected = hrmaxIn > 0 && !hrmaxValid;
  const vo2gt = _pp.vo2gt > 0 ? +Number(_pp.vo2gt).toFixed(1) : null;
  const elev = _pp.elev || 0;
  const altFactor = altVO2Factor(elev); // ≤1 above 1500 m
  const vo2b = +(vo2Base(rhrEff, hrmaxEff) * altFactor).toFixed(1);
  const vo2a = +vo2Adj(vo2b, lnrm).toFixed(1);
  const efc = +efcIdx(energy, focus, coh).toFixed(1);
  const crs = +crsIdx(coh, cRm, cPn, stress).toFixed(4);
  const absV = +absIdx(ans.psns, ans.sns).toFixed(3);
  const sfg = stress - focus,
    fe = +(focus / (ans.sns + 1)).toFixed(3);
  const pnse = cPn >= 1 ? +(cRm / (cSd * (cPn || 1))).toFixed(4) : null;
  const otr = ans.psns && cPn ? +((ans.sns / ans.psns) * (100 / cPn)).toFixed(2) : null;
  const rsa = +(sp.hf / (cMeanRR / 1000) ** 2).toFixed(2);

  progress(70, 'Advanced / research metrics…');
  const dfa1 = dfaAlpha1(repSeg); // on representative window (caps cost)
  const sampen = sampEn(repSeg, 2, 0.2 * std(repSeg)); // r scaled to the analyzed window
  const frag = fragmentation(a) || { pip: null, ials: null, pss: null, pas: null };
  const dc = prsaCapacity(a, +1),
    ac = prsaCapacity(a, -1),
    triIdx = triangularIndex(a);
  // Span of the beats triIdx was actually computed over — the norm's precondition is about how many
  // intervals went in, so this measures the analysed series, not the file's wall-clock length.
  const triIdxSpanMin = a.length ? a.reduce((s, v) => s + v, 0) / 60000 : null;
  const triIdxNorm = triIdxNormApplies(triIdxSpanMin);
  const health = Math.max(0, Math.round(100 - clean.pct * 2)); // integrity from artifact load
  const pb = longRec ? periodicBreathingIndex(a) : null; // high-altitude periodic-breathing signature

  progress(85, 'Building tables…');
  lastResult = {
    t0Ms: parsed.t0Ms,
    offsetMin: parsed.offsetMin,
    datetime: parsed.t0Ms != null ? fmtDateTime(parsed.t0Ms) : null, // null, never now()
    t0Source: _t0Source,
    dateWarning: _t0Source === 'none' ? 'No timestamp in RR content or filename — recording is undated and cannot be fused; supply a start time to anchor it.' : null,
    mode,
    modeLabel: MODE_LABEL[mode] || mode,
    modeWhy: cls.why,
    modeConf: Math.round(cls.conf * 100),
    overridden,
    longRec,
    durMin: +(durSec / 60).toFixed(1),
    coverage,
    artifactPct: clean.pct,
    nArtifact: clean.nArt,
    health,
    nWindows: win ? win.wins.length : 0,
    windows: win ? win.wins : null,
    sdann,
    sdnnIdx,
    N,
    meanRR: +meanRR.toFixed(1),
    hr,
    sdnn: +sdnn.toFixed(2),
    rmssd: +rm.toFixed(2),
    pnn50: +pn.toFixed(1),
    nn50,
    dispRm: +dispRm.toFixed(2),
    dispSd: +dispSd.toFixed(2),
    dispHr: +dispHr.toFixed(1),
    dispPn: +dispPn.toFixed(1),
    dispMeanRR: +dispMeanRR.toFixed(1),
    cv,
    mx,
    mode_ms: mo,
    amo50: amo,
    expCv: cCv,
    expMx: cMx,
    expMo: cMo,
    expAmo: cAmo,
    expSd1,
    expSd2,
    tp: sp.tp,
    hf: sp.hf,
    lf: sp.lf,
    vlf: sp.vlf,
    stress,
    hrv,
    energy,
    focus,
    coherence: coh,
    sns: ans.sns,
    psns: ans.psns,
    snsBal: ans.snsBal,
    psnsBal: ans.psnsBal,
    satP,
    satE,
    sd1: sd1v,
    sd2: sd2v,
    sd1sd2: +(sd1v / (sd2v || 1)).toFixed(3),
    ellArea: ell,
    lnrmssd: lnrm,
    lfhf: lfhfv,
    hfnu,
    lfnu,
    si,
    vo2base: vo2b,
    vo2adj: vo2a,
    vo2gt,
    hrmaxEff,
    rhrEff,
    autoRHR,
    hrFloor,
    tanaka,
    hrmaxRejected,
    elev,
    altFactor: +altFactor.toFixed(3),
    pb,
    efc,
    crs,
    abs: absV,
    sfg: +sfg.toFixed(1),
    fe,
    pnse,
    otr,
    rsa,
    lsTP: ls.tp,
    lsVLF: ls.vlf,
    lsLF: ls.lf,
    lsHF: ls.hf,
    lsLFHF: ls.lfhf,
    respRate,
    dfa1,
    sampen,
    dc,
    ac,
    triIdx,
    triIdxSpanMin: triIdxSpanMin == null ? null : +triIdxSpanMin.toFixed(1),
    triIdxNorm,
    pip: frag.pip,
    ials: frag.ials,
    pss: frag.pss,
    pas: frag.pas,
    min: arrMin(a),
    max: arrMax(a),
    q25: quant(a, 0.25),
    median: quant(a, 0.5),
    q75: quant(a, 0.75)
  };
  if (_curFname) lastResult.fname = _curFname;
  // keep the cleaned interval series + stamps so a second signal can be beat-matched
  lastResult._series = {
    vals: a.slice(),
    tsMs: parsed.tsMs ? parsed.tsMs.slice() : null,
    t0Ms: parsed.t0Ms,
    kind: _pdKind(parsed.sourceFormat, _curFname),
    label: _curFname || lastResult.modeLabel || 'Loaded signal'
  };
  // EXPORT-IDENTITY §2.1 / -FOLLOWUPS §1: stamp the SAME deterministic, identity-free recording.contentId
  // the headless compute() path emits, so the app's exportGanglior() ≡ compute() (parity gate). Folds the
  // RAW parsed intervals + t0Ms via the CORE SignalFrame.computeContentId (signal-frame.js is bundled into
  // PulseDex); pdBuildNodeExport copies lastResult.contentId into recording.contentId.
  lastResult.contentId =
    typeof SignalFrame !== 'undefined' && SignalFrame && SignalFrame.computeContentId
      ? SignalFrame.computeContentId({ signalType: 'rr', kind: 'intervals', intervals: parsed.vals, t0Ms: parsed.t0Ms, usable: true })
      : null;

  // ── multi-day store: key by floating t0Ms (or a sequence if undated) ──
  const _key = lastResult.t0Ms != null ? String(lastResult.t0Ms) : 'rec_' + ++_recSeq;
  lastResult._key = _key;
  allRecordings[_key] = lastResult;
  activeKey = _key;

  renderContext(lastResult);
  renderOverviewPx(lastResult);
  renderANS(lastResult);
  renderGraphs(lastResult);
  renderTable(lastResult);
  if (welltoryData && welltoryData.rows.length) renderWTTable(lastResult);
  renderRecSwitcherPx();
  renderCrossNightPx();
  if (cmpData) renderComparison();
  document.body.classList.add('has-data');
  document.getElementById('exportBar').classList.add('show');
  document.getElementById('sidebarDataCard').style.display = 'block';
  document.getElementById('sidebarDataInfo').innerHTML =
    lastResult.modeLabel + '<br>' + N + ' beats · ' + hr + ' bpm · ' + (durSec >= 3600 ? (durSec / 3600).toFixed(1) + ' h' : Math.round(durSec / 60) + ' min');
  showOK('Analyzed ' + N + ' beats · ' + lastResult.modeLabel + (clean.nArt ? ' · ' + clean.nArt + ' artifacts corrected (' + clean.pct + '%)' : ' · clean signal'));
  progress(100, 'Done');
  setTimeout(() => {
    document.getElementById('prog').classList.remove('show');
    document.getElementById('proc').textContent = '';
  }, 700);
}

// ─── MULTI-DAY: switcher + cross-recording trends (additive; gated at ≥2) ─────
function recordingsSortedPx() {
  return Object.values(allRecordings).sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
}
function _pxFmtDT(ms) {
  if (ms == null) return 'undated';
  const d = new Date(ms),
    p = (n) => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
function renderRecSwitcherPx() {
  const wrap = document.getElementById('recSwitcherPx');
  if (!wrap) return;
  const list = recordingsSortedPx();
  if (list.length <= 1) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  wrap.style.display = 'block';
  wrap.innerHTML =
    '<div class="sec-label" style="margin-top:10px">Recordings · ' +
    list.length +
    '</div>' +
    list
      .map((s) => {
        const k = s._key,
          active = k === activeKey,
          q = s.coverage >= 90 ? 'ok' : s.coverage >= 70 ? 'warn' : 'bad';
        return (
          '<button class="rec-item-px ' +
          (active ? 'active' : '') +
          '" data-key="' +
          k +
          '">' +
          '<div class="ri-top-px"><span class="ri-date-px">' +
          _pxFmtDT(s.t0Ms) +
          '</span><span class="ri-q-px ' +
          q +
          '">' +
          (s.coverage != null ? s.coverage + '%' : s.modeLabel || '') +
          '</span></div>' +
          '<div class="ri-sub-px">' +
          (s.modeLabel || '') +
          ' · ' +
          s.dispHr +
          ' bpm · rMSSD ' +
          s.dispRm +
          '</div></button>'
        );
      })
      .join('');
  wrap.querySelectorAll('.rec-item-px').forEach((b) => b.addEventListener('click', () => selectRecordingPx(b.getAttribute('data-key'))));
}
function selectRecordingPx(key) {
  const r = allRecordings[key];
  if (!r) return;
  activeKey = key;
  lastResult = r;
  renderContext(r);
  renderOverviewPx(r);
  renderANS(r);
  renderGraphs(r);
  renderTable(r);
  if (welltoryData && welltoryData.rows.length) renderWTTable(r);
  renderRecSwitcherPx();
  renderCrossNightPx();
  if (cmpData) renderComparison();
  document.getElementById('sidebarDataInfo').innerHTML =
    r.modeLabel + '<br>' + r.N + ' beats · ' + r.hr + ' bpm · ' + (r.durMin >= 60 ? (r.durMin / 60).toFixed(1) + ' h' : Math.round(r.durMin) + ' min');
}
function _pxSpark(vals, color) {
  const W = 180,
    H = 42,
    P = 4,
    n = vals.length;
  if (n < 2) return '';
  let mn = Math.min(...vals),
    mx = Math.max(...vals);
  if (mx === mn) mx = mn + 1;
  const sx = (i) => P + (i / (n - 1)) * (W - 2 * P),
    sy = (v) => H - P - ((v - mn) / (mx - mn)) * (H - 2 * P);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1)).join(' ');
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  return (
    '<svg viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" preserveAspectRatio="none" style="width:100%;height:42px">' +
    '<line x1="' +
    P +
    '" y1="' +
    sy(mean).toFixed(1) +
    '" x2="' +
    (W - P) +
    '" y2="' +
    sy(mean).toFixed(1) +
    '" stroke="' +
    color +
    '" stroke-dasharray="3 3" opacity=".4"/>' +
    '<path d="' +
    d +
    '" fill="none" stroke="' +
    color +
    '" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  );
}
function renderCrossNightPx() {
  const sec = document.getElementById('crossNightSectionPx');
  if (!sec) return;
  const list = recordingsSortedPx();
  if (list.length < 2 || !window.PulseCross) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = 'block';
  const CN = window.PulseCross;
  const metrics = [
    { label: 'rMSSD', unit: 'ms', good: 'up', get: (s) => s.dispRm },
    { label: 'SDNN', unit: 'ms', good: 'up', get: (s) => s.dispSd },
    { label: 'Pulse HR', unit: 'bpm', good: 'down', get: (s) => s.dispHr },
    { label: 'HRV Score', unit: '', good: 'up', get: (s) => s.hrv },
    { label: 'Stress', unit: '', good: 'down', get: (s) => s.stress },
    { label: 'DFA α1', unit: '', good: 'up', get: (s) => s.dfa1 },
    { label: 'Baevsky SI', unit: '', good: 'down', get: (s) => s.si }
  ];
  const cov = list.map((s) => Math.max(0.05, (s.coverage != null ? s.coverage : 100) / 100));
  const tCol = (l) => (l === 'improving' ? 'ok' : l === 'declining' ? 'bad' : 'neutral');
  const C = { green: '#34d399', red: '#f87171', blue: '#60a5fa' };
  let rows = '',
    headline = [];
  metrics.forEach((m) => {
    const ser = list.map((s, i) => ({ x: i, t: s.t0Ms, v: m.get(s), w: cov[i] })).filter((p) => p.v != null && isFinite(p.v));
    if (ser.length < 2) return;
    const st = CN.crossNight(ser, { good: m.good });
    const col = st.trendLabel === 'improving' ? C.green : st.trendLabel === 'declining' ? C.red : C.blue;
    const zCol = st.zLatest == null ? 'neutral' : Math.abs(st.zLatest) >= DexKernel.K.Z_BAD ? 'bad' : Math.abs(st.zLatest) >= DexKernel.K.Z_WARN ? 'warn' : 'ok';
    rows +=
      '<tr><td class="cn-metric-px">' +
      (typeof evBadge === 'function' ? evBadge(m.label) : '') +
      m.label +
      '<span style="opacity:.5"> ' +
      m.unit +
      '</span></td>' +
      '<td style="width:188px">' +
      _pxSpark(
        ser.map((p) => p.v),
        col
      ) +
      '</td>' +
      '<td class="mono">' +
      st.mean +
      '<span style="opacity:.5"> ±' +
      st.sd +
      '</span></td>' +
      '<td class="mono">' +
      st.cv +
      '%</td>' +
      '<td class="mono">' +
      (st.slopePerDay == null ? '—' : (st.slopePerDay > 0 ? '+' : '') + st.slopePerDay) +
      '<span style="opacity:.5">/d</span></td>' +
      '<td class="mono">' +
      (st.tau == null ? '—' : st.tau) +
      ' <span style="opacity:.5">p' +
      (st.p == null ? '—' : st.p) +
      '</span></td>' +
      '<td><span class="cn-trend-px ' +
      tCol(st.trendLabel) +
      '">' +
      st.trendLabel +
      '</span></td>' +
      '<td class="mono"><span class="cn-z-px ' +
      zCol +
      '">' +
      (st.zLatest == null ? '—' : (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ') +
      '</span></td></tr>';
    if (st.zLatest != null && Math.abs(st.zLatest) >= DexKernel.K.Z_HEADLINE) headline.push(m.label + ' ' + (st.zLatest > 0 ? '+' : '') + st.zLatest + 'σ vs your ' + st.n + '-day baseline');
    if (st.ci && (st.ci[0] > 0 || st.ci[1] < 0) && st.n >= 7) headline.push(m.label + ' shifted ' + (st.deltaHalves > 0 ? '+' : '') + st.deltaHalves + m.unit + ' (95% CI excludes 0)');
  });
  document.getElementById('crossNightTablePx').innerHTML =
    '<table class="cn-table-px"><thead><tr>' +
    '<th>Metric</th><th>Trend</th><th>Mean</th><th>CV</th><th>Slope</th><th>Mann–Kendall</th><th>Direction</th><th>Latest z</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>';
  document.getElementById('crossNightHeadlinePx').innerHTML =
    '<div class="cn-head-label-px">Newest reading vs baseline</div>' +
    (headline.length
      ? headline
          .slice(0, 3)
          .map((h) => '<div class="cn-head-item-px">' + h + '</div>')
          .join('')
      : '<div class="cn-head-item-px dim">No metric is beyond ±1σ of its personal baseline — a consistent stretch.</div>');
  document.getElementById('crossNightNotePx').innerHTML =
    list.length +
    ' recordings · OLS slope vs date + non-parametric <b>Mann–Kendall</b> (τ, p) · personal-baseline <b>z-scores</b> · coverage-weighted. Same <code>crossNight()</code> engine as PpgDex/ECGDex/OxyDex.';
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
// ── CSV toolkit ── missing(null/undefined/NaN/±Inf)→blank · real 0 preserved · RFC-4180 + Excel-formula-safe.
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

// Append this measurement as one new line to the supplied Welltory file (or start
// a fresh log). Output is Welltory-compatible (HRVDex ingests it) + extra columns.
function exportCSV() {
  if (!lastResult) return;
  const obj = wtRowObj(lastResult);
  const hasBase = !!(welltoryData && welltoryData.rows.length);
  const baseHdr = hasBase ? welltoryData.header.slice() : WT_COLS.slice();
  const outHdr = baseHdr.concat(EXTRA_COLS.filter((c) => baseHdr.indexOf(c) < 0));
  const lines = [outHdr.map(csvCell).join(',')];
  lines.push(outHdr.map((h) => csvCell(obj[h] !== undefined ? obj[h] : '')).join(',')); // new line first (newest on top)
  if (hasBase) {
    for (const row of welltoryData.rows) {
      lines.push(
        outHdr
          .map((h) => {
            const i = baseHdr.indexOf(h);
            return csvCell(i >= 0 && row[i] !== undefined ? row[i] : '');
          })
          .join(',')
      );
    }
  }
  dl('\uFEFF' + lines.join('\r\n') + '\r\n', hasBase ? 'welltory_log_updated.csv' : 'pulsedex_welltory_' + (lastResult.datetime || 'unknown').slice(0, 10) + '.csv', 'text/csv');
  showOK(
    hasBase
      ? 'Appended today\u2019s line to your Welltory log — ' + (welltoryData.rows.length + 1) + ' rows, ready for HRVDex'
      : 'Welltory-style daily line exported — upload a Welltory CSV first to append to your running log'
  );
}
function exportJSON() {
  if (!lastResult) return;
  const list = recordingsSortedPx();
  if (list.length <= 1) {
    // EXPORT-HYGIENE-FOLLOWUPS-II §1: append the recording's identity-free contentId (set in calculate())
    // so re-exporting the SAME recording yields a stable, disambiguated name. null/absent → no suffix.
    dl(JSON.stringify(lastResult, null, 2), exportName({ node: 'PulseDex', t0Ms: lastResult.t0Ms, kind: 'summary', ext: 'json', contentId: lastResult.contentId }), 'application/json;charset=utf-8');
    return;
  }
  // ≥2 recordings → wrapper: array of per-recording objects + standardized crossNight envelope
  const payload = {
    kernel: window.DexKernel ? { version: DexKernel.VERSION, hash: DexKernel.HASH } : null,
    schema: {
      name: 'ganglior.node-export',
      version: '2.0',
      node: 'PulseDex',
      nodeVersion: '1.0',
      multiRecording: true,
      generated: new Date().toISOString(),
      provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null,
      doc: 'Array of per-recording PulseDex summaries + a ganglior.crossnight v1.0 aggregate header. Each element is the unmodified single-recording object.'
    },
    generated: new Date().toISOString(),
    recordingCount: list.length,
    crossNight: window.PulseCross.crossNightBlock(list),
    recordings: list
  };
  // series export (≥2 recordings): anchor on the FIRST night + an explicit day-span (brief §2.4) —
  // recordingsSortedPx() is ascending by t0Ms, so list[0]=earliest, last=latest. NO _multi<N> count (§2.3).
  // NO contentId suffix (EXPORT-HYGIENE-FOLLOWUPS-II §1): contentId digests ONE recording; a multi-recording
  // series spans N distinct contentIds, so no single id applies — the span stamp is the disambiguator here.
  const _spanDays = list[0] && list[0].t0Ms != null && list[list.length - 1] && list[list.length - 1].t0Ms != null ? Math.round((list[list.length - 1].t0Ms - list[0].t0Ms) / 864e5) : null;
  dl(JSON.stringify(payload, null, 2), exportName({ node: 'PulseDex', t0Ms: list[0] && list[0].t0Ms, kind: 'series', ext: 'json', spanDays: _spanDays }), 'application/json;charset=utf-8');
  if (typeof showOK === 'function') showOK('Exported ' + list.length + ' recordings (array + crossNight envelope).');
}

// ─── GANGLIOR BUS EMIT SHIM (Phase 0) ─────────────────────────────────────────
// Wrap PulseDex's existing windowed analysis as a ganglior.node-export so the
// Integrator can fuse PulseDex as a first-class node. Mirrors ECGDex exportGanglior.
// Bus name in ONE constant; events carry absolute floating tMs + legacy t "HH:MM:SS".
const PULSEDEX_BUS = 'ganglior';
function _pdClockS(ms) {
  const d = new Date(ms),
    p = (n) => (n < 10 ? '0' : '') + n;
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function exportGanglior() {
  if (!lastResult) return;
  // Build via the shared headless builder in pulsedex-dsp.js (PulseDex.compute's
  // sibling) so the app, the Data Unifier and OverDex all emit a byte-identical
  // node-export from ONE windowing implementation (SIGNAL-ADAPTER-FOLLOWUPS §1/§2).
  const out = pdBuildNodeExport(lastResult, {
    provenance: window.GangliorProvenance ? GangliorProvenance.stamp() : null, // R1: build + input fingerprints
    kernel: window.DexKernel || null,
    generated: new Date().toISOString()
  });
  dl(JSON.stringify(out, null, 2), exportName({ node: 'PulseDex', t0Ms: lastResult.t0Ms, kind: 'ganglior', ext: 'json', contentId: lastResult.contentId }), 'application/json;charset=utf-8');
  if (typeof showOK === 'function') showOK('Ganglior bus export — ' + out.ganglior_events.length + ' events (' + (lastResult.modeLabel || '') + '). Drop into Integrator to fuse.');
}

function dl(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
// Export filenames now come from the shared dex-export.js exportName() — recording-anchored (t0Ms read
// via getUTC*), viewer-TZ-independent, controlled-vocab (EXPORT-HYGIENE §2). The old local-clock
// _exportTs() (new Date() + local getters = export-click wall-clock, TZ-dependent) is DELETED. Summary CSV:
// Tidy summary CSV from the structured table rows: pure-number Value column, separate Unit (no
// fusing), plain-text Status (no emoji), section dividers marked, missing→blank — AI/processing-friendly.
function _summaryCSV() {
  const rows = window.__summaryRows || [];
  const STAT = { ok: 'Good', warn: 'Watch', bad: 'Concern', neutral: '' };
  const dash = (x) => (x === '—' || x === '–' || x == null ? '' : x);
  const tier = (label) => {
    try {
      const R = window.PulseRegistry;
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
  if (!lastResult) return;
  dl(_summaryCSV(), exportName({ node: 'PulseDex', t0Ms: lastResult.t0Ms, kind: 'summary', ext: 'csv', contentId: lastResult.contentId }), 'text/csv');
  showOK('Summary CSV exported (tidy: metric · value · unit · range · status · notes).');
}
function copyTable() {
  const rows = document.querySelectorAll('#tblWrap table tr');
  const txt = [...rows].map((r) => [...r.cells].map((c) => c.textContent.trim()).join('\t')).join('\n');
  navigator.clipboard.writeText(txt).then(() => showOK('Table copied to clipboard'));
}

// ─── RESET ────────────────────────────────────────────────────────────────────
function resetAll() {
  document.body.classList.remove('has-data');
  document.getElementById('sec-profile').style.display = 'none';
  document.getElementById('profilePanel').style.display = 'none';
  document.getElementById('heroTop').style.display = 'none';
  document.getElementById('rawPaste').value = '';
  document.getElementById('rawInput').value = '';
  document.getElementById('rawChip').classList.remove('show');
  document.getElementById('kpiGrid').classList.remove('show');
  document.getElementById('ansWrap').classList.remove('show');
  document.getElementById('tblWrap').classList.remove('show');
  document.getElementById('wtWrap').classList.remove('show');
  document.getElementById('graphWrap').classList.remove('show');
  document.getElementById('graphWrap').innerHTML = '';
  document.getElementById('ctxBanner').style.display = 'none';
  document.getElementById('exportBar').classList.remove('show');
  document.getElementById('sidebarDataCard').style.display = 'none';
  ['slKPI', 'slANS', 'slGraph', 'slTbl', 'slWT'].forEach((id) => (document.getElementById(id).style.display = 'none'));
  document.getElementById('kpiGrid').innerHTML = '';
  document.getElementById('ansWrap').innerHTML = '';
  document.getElementById('tblBody').innerHTML = '';
  document.getElementById('wtBody').innerHTML = '';
  document.getElementById('aInfo').classList.add('show');
  document.getElementById('aOK').classList.remove('show');
  document.getElementById('aErr').classList.remove('show');
  document.getElementById('prog').classList.remove('show');
  document.getElementById('proc').textContent = '';
  lastResult = null;
  allRecordings = {};
  activeKey = null;
  _recSeq = 0;
  _curFname = null;
  cmpData = null;
  {
    const cs = document.getElementById('cmpStatus');
    if (cs) cs.textContent = 'No reference loaded — load the loaded recording first, then drop the other sensor (e.g. ECGDex RR vs PpgDex PPI)';
  }
  {
    const ci = document.getElementById('cmpInput');
    if (ci) ci.value = '';
  }
  {
    const ct = document.getElementById('slCmp');
    if (ct) ct.style.display = 'none';
  }
  {
    const cc = document.getElementById('cmpCard');
    if (cc) {
      cc.style.display = 'none';
      cc.innerHTML = '';
    }
  }
  {
    const w = document.getElementById('recSwitcherPx');
    if (w) {
      w.style.display = 'none';
      w.innerHTML = '';
    }
  }
  {
    const c = document.getElementById('crossNightSectionPx');
    if (c) c.style.display = 'none';
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function progress(pct, msg) {
  document.getElementById('prog').classList.add('show');
  document.getElementById('progBar').style.width = pct + '%';
  document.getElementById('proc').textContent = msg || '';
}
function clearAlerts() {
  ['aInfo', 'aOK', 'aErr'].forEach((id) => document.getElementById(id).classList.remove('show'));
}
function showOK(msg) {
  document.getElementById('aOKmsg').textContent = msg;
  document.getElementById('aOK').classList.add('show');
  setTimeout(() => document.getElementById('aOK').classList.remove('show'), 6000);
}
function showErr(msg) {
  document.getElementById('aErrmsg').textContent = msg;
  document.getElementById('aErr').classList.add('show');
}

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

// Event-delegation actions (CSP strict script-src — dex-actions.js). print/clickEl are DexActions
// builtins; toggleProfilePanel is a PulseDex global (pulsedex-overview.js) and calculate is a
// top-level PulseDex function. Registered at true top level so the wrappers resolve the globals.
if (window.DexActions)
  DexActions.registerAll({
    toggleProfilePanel: function () {
      return toggleProfilePanel();
    },
    pulseModeOverride: function () {
      if (window.lastResult) calculate();
    }
  });

// ESM-MIGRATION deep-3: app is now an ES module — publish the one app symbol a sibling file
// consumes (pulsedex-render.js wtRowObj() calls findWTRow() as a bare global at render time).
window.findWTRow = findWTRow;
