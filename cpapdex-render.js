/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   CPAPDex · RENDER — cohesion-native views (cpapdex-render.js)
   Loaded after cpapdex-dsp.js + cpapdex-registry.js, before cpapdex-fusion.js.
   Shares page scope (no module system).
   ────────────────────────────────────────────────────────────────────────
   Pure HTML-string builders driven by a night object (CpapDsp.buildNight):
     • renderKPIs        headline therapy read
     • residual / pressure / leak / ventilation / oximetry-QC / sessions cards
     • canvas charts (AHI-by-hour, pressure distribution) — dependency-free
     • Ganglior event stream
   Cohesion: every metric tile resolves its evidence dot from CpapRegistry
   (corner badge) and its disclosure tier from [data-tier] (depth axis), so the
   shared depth selector (Core/Advanced/Research) shows/hides advanced+research
   tiles with zero per-call churn. Clock read-back via CpapDsp.fmt* (getUTC*).
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var D   = global.CpapDsp;
var REG = global.CpapRegistry;
var MR  = global.MetricRegistry;

function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fnum(v, dec){ if (v == null || !isFinite(v)) return '—'; return dec != null ? (+v).toFixed(dec) : String(v); }
function evb(id){ return (REG && REG.evBadge) ? REG.evBadge(id) : ''; }
function tierAttr(id){
  if (!REG || !MR || !REG.REGISTRY[id]) return '';
  var attr = MR.depthToTier(REG.REGISTRY[id].depth);
  return attr ? ' data-tier="' + attr + '"' : '';
}
function lbl(id, fb){ return (REG && REG.REGISTRY[id]) ? REG.REGISTRY[id].label : (fb || id); }
function unit(id, fb){ return (REG && REG.REGISTRY[id] && REG.REGISTRY[id].unit != null) ? REG.REGISTRY[id].unit : (fb || ''); }
function sev(good, warn, val, lower){
  if (val == null || !isFinite(val)) return 'neutral';
  if (lower) return val <= good ? 'ok' : val <= warn ? 'warn' : 'bad';
  return val >= good ? 'ok' : val >= warn ? 'warn' : 'bad';
}
var KPI_CLS = { ok:'good', warn:'warn', bad:'bad', neutral:'neutral' };

/* ── tiles ──────────────────────────────────────────────────────────────── */
function kpiTile(id, valHtml, statusSev, sub){
  return '<div class="kpi ' + (KPI_CLS[statusSev] || 'neutral') + '"' + tierAttr(id) + '>'
    + '<div class="kpi-val ' + (statusSev || 'neutral') + '">' + valHtml + '</div>'
    + '<div class="kpi-label">' + evb(id) + esc(lbl(id)) + '</div>'
    + (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '')
    + '</div>';
}
function metricTile(id, valHtml, statusSev, sub){
  var u = unit(id);
  return '<div class="metric"' + tierAttr(id) + '>'
    + '<div class="m-val ' + (statusSev && statusSev !== 'neutral' ? statusSev : '') + '">' + valHtml
      + (u ? '<span class="m-unit">' + esc(u) + '</span>' : '') + '</div>'
    + '<div class="m-label">' + evb(id) + esc(lbl(id)) + '</div>'
    + (sub ? '<div class="m-sub">' + esc(sub) + '</div>' : '')
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════
   KPI GRID
   ════════════════════════════════════════════════════════════════════════ */
function renderKPIs(night){
  var nm = night.metrics || {};
  var s0 = (night.sessions && night.sessions[0]) || {};
  var cross = global.CpapFusion ? global.CpapFusion.cpapCrossMetrics(night) : null;
  var out = '';
  var ahiS = sev(5, 15, nm.residualAHI, true);
  out += kpiTile('residualAHI', fnum(nm.residualAHI, 1) + '<span class="kpi-u">/hr</span>', ahiS, 'device-scored');
  out += kpiTile('usageHours', fnum(night.therapyHours, 1) + '<span class="kpi-u">hr</span>', sev(4, 2, night.therapyHours), night.nSessions + ' session' + (night.nSessions === 1 ? '' : 's'));
  out += kpiTile('medianPressure', fnum(nm.medianPressure, 1) + '<span class="kpi-u">cmH₂O</span>', 'neutral', (s0.mode || '—') + ' · p95 ' + fnum(nm.p95Pressure, 1));
  out += kpiTile('largeLeakPct', fnum(nm.largeLeakPct, 1) + '<span class="kpi-u">%</span>', sev(2, 5, nm.largeLeakPct, true), 'median ' + fnum(nm.medianLeak, 1) + ' L/min');
  if (cross && cross.oximetryAvailable)
    out += kpiTile('odi', fnum(cross.odi, 1) + '<span class="kpi-u">/hr</span>', sev(5, 15, cross.odi, true), 'SA2 · self-gated');
  else
    out += '<div class="kpi neutral"' + tierAttr('odi') + '><div class="kpi-val" style="color:var(--text4)">n/a</div><div class="kpi-label">' + evb('odi') + esc(lbl('odi')) + '</div><div class="kpi-sub">no oximeter</div></div>';
  out += kpiTile('periodicBreathingPct', fnum(nm.periodicBreathingPct, 1) + '<span class="kpi-u">%</span>', sev(2, 10, nm.periodicBreathingPct, true), 'Cheyne-Stokes / PB');
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   CANVAS CHARTS
   ════════════════════════════════════════════════════════════════════════ */
function _dpr(){ return Math.min(global.devicePixelRatio || 1, 2); }
function _prep(cv, cssW, cssH){
  var r = _dpr();
  cv.width = cssW * r; cv.height = cssH * r;
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  var ctx = cv.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}
function _css(v){ try { return getComputedStyle(document.body).getPropertyValue(v).trim() || null; } catch(e){ return null; } }

/* AHI-by-clock-hour bars (device-scored apneas+hypopneas, RERA excluded) */
function drawAhiByHour(cv, night){
  if (!cv) return;
  var hours = Math.max(1, Math.ceil(night.therapyHours || 1));
  var buckets = new Array(hours).fill(0);
  (night.sessions || []).forEach(function (s){
    (s.events || []).forEach(function (ev){
      if (ev.type === 'RE') return;
      var tMs = ev.tMs != null ? ev.tMs : (s.t0Ms + (ev.timeSec || 0) * 1000);
      var hi = Math.floor((tMs - night.t0Ms) / 3600000);
      if (hi >= 0 && hi < hours) buckets[hi]++;
    });
  });
  var W = cv.clientWidth || 600, H = 150, ctx = _prep(cv, W, H);
  ctx.clearRect(0, 0, W, H);
  var padL = 30, padB = 22, padT = 10, gw = W - padL - 8, gh = H - padB - padT;
  var max = Math.max(2, Math.max.apply(null, buckets));
  var green = _css('--green') || '#3fb950', amber = _css('--amber') || '#d29922', red = _css('--red') || '#f85149', grid = 'rgba(255,255,255,.07)', txt = _css('--text4') || '#7d8590';
  // gridlines
  ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (var g = 0; g <= max; g += Math.ceil(max / 4)){
    var y = padT + gh - (g / max) * gh;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke();
    ctx.fillText(String(g), padL - 5, y);
  }
  var bw = gw / hours;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (var i = 0; i < hours; i++){
    var v = buckets[i], bh = (v / max) * gh, x = padL + i * bw;
    ctx.fillStyle = v === 0 ? 'rgba(125,133,144,.22)' : v <= 1 ? green : v <= 3 ? amber : red;
    var rw = bw * 0.62, rx = x + (bw - rw) / 2, ry = padT + gh - Math.max(bh, 2);
    ctx.fillRect(rx, ry, rw, Math.max(bh, 2));
    ctx.fillStyle = txt; ctx.fillText('h' + (i + 1), x + bw / 2, padT + gh + 5);
  }
}

/* Pressure distribution: P50/P95 markers over a 4–20 cmH₂O ramp */
function drawPressure(cv, nm){
  if (!cv) return;
  var W = cv.clientWidth || 600, H = 70, ctx = _prep(cv, W, H);
  ctx.clearRect(0, 0, W, H);
  var lo = 4, hi = 20, padX = 8, gw = W - padX * 2, barY = 26, barH = 11;
  var pos = function (v){ return padX + Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * gw; };
  var grad = ctx.createLinearGradient(padX, 0, padX + gw, 0);
  grad.addColorStop(0, 'rgba(88,166,255,.30)'); grad.addColorStop(0.5, 'rgba(61,224,208,.40)'); grad.addColorStop(1, 'rgba(255,184,77,.32)');
  ctx.fillStyle = grad;
  if (ctx.roundRect){ ctx.beginPath(); ctx.roundRect(padX, barY, gw, barH, 6); ctx.fill(); }
  else ctx.fillRect(padX, barY, gw, barH);
  var teal = _css('--teal') || '#3de0d0', blue = _css('--blue') || '#58a6ff', txt = _css('--text3') || '#9aa4b2';
  function marker(v, col, label){
    if (v == null || !isFinite(v)) return;
    var x = pos(v);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, barY - 8); ctx.lineTo(x, barY + barH + 8); ctx.stroke();
    ctx.fillStyle = col; ctx.font = '600 11px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillText(label + ' ' + (+v).toFixed(1), x, barY - 12);
  }
  marker(nm.medianPressure, teal, 'P50');
  marker(nm.p95Pressure, blue, 'P95');
  ctx.fillStyle = txt; ctx.font = '10px ui-monospace,monospace';
  ctx.textAlign = 'left';  ctx.fillText('4 cmH₂O', padX, barY + barH + 20);
  ctx.textAlign = 'right'; ctx.fillText('20 cmH₂O', padX + gw, barY + barH + 20);
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION CARDS  (return HTML; charts hydrate after insert via hydrate())
   ════════════════════════════════════════════════════════════════════════ */
function cardHead(title, note, id){
  return '<div class="card-h">' + (id ? evb(id) : '') + esc(title) + (note ? ' <span class="card-sub">' + esc(note) + '</span>' : '') + '</div>';
}

function residualCard(night){
  var nm = night.metrics || {};
  return '<div class="card">' + cardHead('Residual Events', 'device-scored EVE/CSL · the airflow ground truth', 'residualAHI')
    + '<canvas class="chart" data-chart="ahi" style="width:100%;height:150px;display:block;margin:4px 0 8px"></canvas>'
    + '<div class="legend-row">apneas + hypopneas per therapy hour · <span style="color:var(--green)">green ≤1</span> · <span style="color:var(--amber)">amber ≤3</span> · <span style="color:var(--red)">red &gt;3</span></div>'
    + '<div class="metric-grid" style="margin-top:14px">'
    + metricTile('residualAHI', fnum(nm.residualAHI, 2), sev(5, 15, nm.residualAHI, true))
    + metricTile('obstructiveIndex', fnum(nm.obstructiveIndex, 2), sev(5, 15, nm.obstructiveIndex, true))
    + metricTile('centralIndex', fnum(nm.centralIndex, 2), sev(5, 10, nm.centralIndex, true))
    + metricTile('hypopneaIndex', fnum(nm.hypopneaIndex, 2), sev(5, 15, nm.hypopneaIndex, true))
    + metricTile('reraIndex', fnum(nm.reraIndex, 2), sev(5, 15, nm.reraIndex, true))
    + metricTile('periodicBreathingPct', fnum(nm.periodicBreathingPct, 2), sev(2, 10, nm.periodicBreathingPct, true))
    + '</div></div>';
}

function pressureCard(night){
  var nm = night.metrics || {};
  var m = ((night.sessions && night.sessions[0]) || {}).metrics || {};
  return '<div class="card">' + cardHead('Pressure & EPR', 'delivered therapy (mask-on)', 'medianPressure')
    + '<canvas class="chart" data-chart="pressure" style="width:100%;height:70px;display:block;margin:8px 0"></canvas>'
    + '<div class="metric-grid" style="margin-top:10px">'
    + metricTile('medianPressure', fnum(nm.medianPressure, 1))
    + metricTile('p95Pressure', fnum(nm.p95Pressure, 1))
    + metricTile('pressureRange', fnum(nm.pressureRange, 1))
    + metricTile('eprDelta', fnum(m.eprDelta, 1))
    + metricTile('epap95', fnum((nm.epap95 != null ? nm.epap95 : m.epap95), 1))
    + '</div></div>';
}

function leakCard(night){
  var nm = night.metrics || {};
  return '<div class="card">' + cardHead('Leak Dynamics', 'mask seal · drives signal-quality (sqi)', 'medianLeak')
    + '<div class="metric-grid">'
    + metricTile('medianLeak', fnum(nm.medianLeak, 1), sev(12, 24, nm.medianLeak, true))
    + metricTile('p95Leak', fnum(nm.p95Leak, 1), sev(18, 24, nm.p95Leak, true))
    + metricTile('largeLeakPct', fnum(nm.largeLeakPct, 1), sev(2, 5, nm.largeLeakPct, true))
    + metricTile('leakCV', fnum(nm.leakCV, 1))
    + '</div></div>';
}

function ventCard(night){
  var m = ((night.sessions && night.sessions[0]) || {}).metrics || {};
  return '<div class="card">' + cardHead('Ventilation & Flow', '25 Hz flow + 0.5 Hz detail', 'respRateMedian')
    + '<div class="metric-grid">'
    + metricTile('respRateMedian', fnum(m.respRateMedian, 1))
    + metricTile('breathRate', fnum(m.breathRate, 1))
    + metricTile('ieRatio', fnum(m.ieRatio, 2))
    + metricTile('tidVolMedian', fnum(m.tidVolMedian, 2))
    + metricTile('minVentMedian', fnum(m.minVentMedian, 1))
    + metricTile('flowLimitedPct', fnum(m.flowLimitedPct, 1), sev(10, 25, m.flowLimitedPct, true))
    + metricTile('snorePct', fnum(m.snorePct, 1), sev(5, 15, m.snorePct, true))
    + '</div></div>';
}

function oximetryCard(night){
  var oxiS = (night.sessions || []).filter(function (s){ return s.oximetry && s.oximetry.available; })[0];
  if (!oxiS){
    return '<div class="card">' + cardHead('Oximetry QC Lane', 'SA2 · self-gated peer of O2Ring', 'odi')
      + '<div class="qc-empty"><div class="qc-shield">🛡</div><div><b>No oximeter connected this night.</b> '
      + 'The AirSense SA2 channel read the device&rsquo;s &ldquo;not connected&rdquo; sentinel for the whole recording, so ODI / T90 / SpO₂ are <b>n/a</b> — not fabricated. '
      + 'Plug in the SpO₂ accessory and the self-gated desaturation lane lights up automatically.</div></div></div>';
  }
  var o = oxiS.oximetry;
  return '<div class="card">' + cardHead('Oximetry QC Lane', 'SA2 · ' + Math.round(o.coverage * 100) + '% coverage · self-gated', 'odi')
    + '<div class="metric-grid">'
    + metricTile('odi', fnum(o.odi, 2), sev(5, 15, o.odi, true))
    + metricTile('t90Pct', fnum(o.t90Pct, 2), sev(1, 5, o.t90Pct, true))
    + metricTile('spo2Nadir', fnum(o.spo2Nadir), sev(90, 85, o.spo2Nadir))
    + metricTile('spo2Mean', fnum(o.spo2Mean, 1), sev(94, 92, o.spo2Mean))
    + metricTile('pulseMedian', fnum(o.pulseMedian))
    + '</div>'
    + '<div class="qc-note">🛡 ' + (o.artifactCount > 0
        ? '<b>' + o.artifactCount + ' desaturation' + (o.artifactCount === 1 ? '' : 's') + ' self-gated as artifact</b> — coincident perfusion/pulse collapse or non-physiologic kinetics. Excluded from ODI and never emitted to the bus (the squeeze-artifact lesson).'
        : 'Self-gate active · no perfusion-collapse artifacts this night — every counted desat had a valid pulse.')
    + '</div></div>';
}

function crossCard(night){
  var cross = global.CpapFusion ? global.CpapFusion.cpapCrossMetrics(night) : null;
  if (!cross) return '';
  function row(icon, title, body, tone){
    var col = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : 'var(--blue)';
    return '<div class="cross-row"><span class="cross-ic">' + icon + '</span><div>'
      + '<div class="cross-t" style="color:' + col + '">' + esc(title) + '</div>'
      + '<div class="cross-b">' + body + '</div></div></div>';
  }
  var rows = '';
  if (cross.oximetryAvailable && cross.concordance){
    rows += row('🔗', 'AHI ↔ ODI: ' + cross.concordance,
      'Residual AHI <b>' + fnum(cross.ahi, 1) + '/hr</b> vs ODI <b>' + fnum(cross.odi, 1) + '/hr</b> — ' + esc(cross.concordanceNote) + '.',
      cross.concordance === 'concordant' ? 'ok' : 'warn');
  } else {
    rows += row('🔗', 'AHI ↔ ODI', esc(cross.concordanceNote || 'No oximeter this night.'), 'blue');
  }
  if (cross.leakImpact){
    rows += row('💨', 'Leak ↔ AHI: ' + (cross.leakImpact === 'leak-confounded' ? 'treat the leak first' : cross.leakImpact === 'leak-ok' ? 'leak not confounding' : 'watch the seal'),
      esc(cross.leakNote) + ' (large-leak ' + fnum(cross.largeLeakPct, 1) + '% of therapy).',
      cross.leakImpact === 'leak-confounded' ? 'bad' : cross.leakImpact === 'leak-high-ahi-ok' ? 'warn' : 'ok');
  }
  return '<div class="card">' + cardHead('Cross-Metric Read', 'does the story hang together?') + rows + '</div>';
}

function sessionsCard(night){
  var rows = (night.sessions || []).map(function (s, i){
    var gap = (night.offMaskGaps || []).filter(function (g){ return g.afterIdx === i; })[0];
    var trunc = s.truncated ? ' <span class="pill pill-yellow">partial ' + s.recordsRead + '/' + s.numRecords + '</span>' : '';
    var line = '<div class="sess-row">'
      + '<span class="sess-tag">S' + (i + 1) + '</span>'
      + '<span class="sess-clock">' + (D ? D.fmtClock(s.t0Ms) : '') + ' → ' + (D ? D.fmtClock(s.endMs) : '') + '</span>'
      + '<span class="sess-meta">' + fnum(s.durMin, 0) + ' min · ' + fnum(s.usageHours, 2) + ' h · ' + (s.mode || '—') + '</span>'
      + '<span class="sess-ev">' + (s.nEvents || 0) + ' events · ' + (s.oximetry && s.oximetry.available ? 'SpO₂ ✓' : 'no SpO₂') + trunc + '</span>'
      + '</div>';
    if (gap) line += '<div class="sess-gap">⟂ off-mask gap ' + fnum(gap.gapMin, 1) + ' min before next session</div>';
    return line;
  }).join('');
  return '<div class="card">' + cardHead('Sessions', night.nSessions + ' tonight · one night, off-mask gaps preserved') + rows + '</div>';
}

/* Ganglior event stream — what this node puts on the bus */
function eventStream(night){
  var ev = global.CpapFusion ? global.CpapFusion.cpapEvents(night) : [];
  if (!ev.length) return '<div class="card">' + cardHead('Ganglior Stream', 'events emitted to the bus') + '<div class="qc-note">No events emitted this night.</div></div>';
  var IMP = { apnea:'var(--red)', hypopnea:'var(--amber)', rera:'var(--blue)', periodic_breathing:'var(--purple)', desat:'var(--teal)', large_leak:'var(--text3)' };
  var rows = ev.slice(0, 60).map(function (e){
    var col = IMP[e.impulse] || 'var(--text3)';
    var metaBits = [];
    if (e.meta){ if (e.meta.class) metaBits.push(e.meta.class); if (e.meta.durSec) metaBits.push(e.meta.durSec + 's'); if (e.meta.depthPct) metaBits.push('−' + e.meta.depthPct + '%'); if (e.meta.pctNight != null) metaBits.push(e.meta.pctNight + '% night'); }
    return '<div class="evt-row">'
      + '<span class="evt-t">' + esc(e.t) + '</span>'
      + '<span class="evt-imp" style="color:' + col + '">' + esc(e.impulse) + '</span>'
      + '<span class="evt-meta">' + esc(metaBits.join(' · ')) + '</span>'
      + '<span class="evt-conf">conf ' + fnum(e.conf, 2) + ' · sqi ' + fnum(e.sqi, 2) + '</span>'
      + '</div>';
  }).join('');
  var more = ev.length > 60 ? '<div class="qc-note">+' + (ev.length - 60) + ' more…</div>' : '';
  return '<div class="card">' + cardHead('Ganglior Stream', ev.length + ' events · node-export currency') + rows + more + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════
   MULTI-NIGHT LONGITUDINAL (OxyDex-style) — trends across loaded nights
   ════════════════════════════════════════════════════════════════════════ */
var TREND_COL = { improving:'var(--green)', declining:'var(--red)', stable:'var(--text3)', insufficient:'var(--text4)', '—':'var(--text4)' };
function drawNightTrend(cv, nights, id){
  if (!cv || !global.CPAPCross) return;
  var def = global.CPAPCross.CPAP_DEFS[id]; if (!def) return;
  var chrono = nights.slice().sort(function(a,b){ return (a.t0Ms||0)-(b.t0Ms||0); });
  var vals = chrono.map(def.get).map(function(v){ return (v==null||!isFinite(v))?null:v; });
  var pts = vals.filter(function(v){ return v!=null; });
  var W = cv.clientWidth||120, H = 34, ctx = _prep(cv, W, H);
  ctx.clearRect(0,0,W,H);
  if (pts.length < 2) return;
  var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rng = (mx-mn)||1;
  var pad = 4, gw = W-pad*2, gh = H-pad*2, n = vals.length;
  var col = def.good==='down' ? (vals[lastIdx(vals)] <= pts[0] ? _css('--green') : _css('--red')) : (vals[lastIdx(vals)] >= pts[0] ? _css('--green') : _css('--red'));
  col = col || '#58a6ff';
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); var started=false;
  for (var i=0;i<n;i++){ if (vals[i]==null) continue; var x=pad+(n===1?gw/2:gw*i/(n-1)); var y=pad+gh-((vals[i]-mn)/rng)*gh;
    if (!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y); }
  ctx.stroke();
  // last-point dot
  var li = lastIdx(vals); if (li>=0){ var lx=pad+(n===1?gw/2:gw*li/(n-1)), ly=pad+gh-((vals[li]-mn)/rng)*gh; ctx.fillStyle=col; ctx.beginPath(); ctx.arc(lx,ly,2.4,0,7); ctx.fill(); }
}
function lastIdx(arr){ for (var i=arr.length-1;i>=0;i--) if (arr[i]!=null) return i; return -1; }

function renderHistory(nights){
  if (!nights || nights.length < 2 || !D.buildLongitudinal) return '';
  var lng = D.buildLongitudinal(nights);
  var cn = lng.crossNight;
  // headline KPIs
  var ut = lng.usageTrend7d, utCls = ut>0?'good':ut<0?'bad':'neutral';
  var kpis = ''
    + '<div class="kpi neutral"><div class="kpi-val neutral">' + nights.length + '</div><div class="kpi-label">Nights</div></div>'
    + kpiTile('compliancePct', fnum(lng.compliancePct,0)+'<span class="kpi-u">%</span>', sev(70,50,lng.compliancePct), '≥4 h nights')
    + '<div class="kpi '+utCls+'"><div class="kpi-val '+(utCls==='good'?'ok':utCls==='bad'?'bad':'neutral')+'">'+(ut>0?'+':'')+fnum(ut,2)+'<span class="kpi-u">h/night</span></div><div class="kpi-label">'+evb('usageHours')+'Usage trend (7d)'+'</div></div>'
    + (lng.ahiTrend30d ? '<div class="kpi"><div class="kpi-val neutral">'+fnum(lng.ahiTrend30d.mean,1)+'<span class="kpi-u">±'+fnum(lng.ahiTrend30d.sd,1)+'</span></div><div class="kpi-label">'+evb('residualAHI')+'AHI '+lng.ahiTrend30d.n+'-night'+'</div></div>' : '');
  // trend rows from the cross-night block
  var trendRows = '';
  if (cn && cn.metrics){
    Object.keys(cn.metrics).forEach(function(id){
      var M = cn.metrics[id]; if (!M || M.n < 2) return;
      var tl = M.trend ? M.trend.label : '—';
      trendRows += '<div class="trend-row">'
        + '<span class="trend-name">' + esc(M.label) + evb(id) + '</span>'
        + '<span class="trend-mean">' + fnum(M.central && M.central.mean, 2) + ' <span class="trend-u">' + esc(M.unit||'') + '</span></span>'
        + '<span class="trend-lbl" style="color:'+(TREND_COL[tl]||'var(--text3)')+'">' + esc(tl) + '</span>'
        + '<canvas class="chart trend-spark" data-trend="'+id+'" style="width:120px;height:34px"></canvas>'
        + '</div>';
    });
  }
  // per-night table (newest first)
  var rows = nights.slice().sort(function(a,b){ return (b.t0Ms||0)-(a.t0Ms||0); }).map(function(n){
    var nm = n.metrics || {};
    return '<div class="sess-row">'
      + '<span class="sess-clock">' + (D?D.fmtDate(n.t0Ms):'') + '</span>'
      + '<span class="sess-meta">' + fnum(n.therapyHours,1) + ' h · ' + n.nSessions + ' session' + (n.nSessions===1?'':'s') + '</span>'
      + '<span class="sess-ev">AHI ' + fnum(nm.residualAHI,1) + ' · leak ' + fnum(nm.largeLeakPct,0) + '% · ' + ((n.sessions||[]).some(function(s){return s.oximetry&&s.oximetry.available;})?'SpO₂ ✓':'no SpO₂') + '</span>'
      + '</div>';
  }).join('');
  return '<div class="card">' + cardHead('Longitudinal', nights.length + ' nights · robust night-to-night trends (Mann–Kendall + bootstrap)')
    + '<div class="kpi-grid">' + kpis + '</div>'
    + (trendRows ? '<div class="trend-block">' + trendRows + '</div>' : '')
    + '<div class="sess-list">' + rows + '</div>'
    + '</div>';
}

/* ════════════════════════════════════════════════════════════════════════
   ASSEMBLY + HYDRATION
   ════════════════════════════════════════════════════════════════════════ */
function crossNodeCard(night){
  var CN = global.CpapCoimport;
  if (!CN) return '';
  var cn = CN.crossNode(night);
  if (!cn) return '';
  var oxi = cn.oximetry, aut = cn.autonomic;
  var body = '';

  if (oxi){
    var nativeNote = oxi.nativeAvailable ? 'corroborates the on-device SA2 lane' : 'fills the gap — no oximeter on the AirSense this night';
    body += '<div class="xn-block"><div class="xn-src" style="color:#58A6FF">⊕ Borrowed oximetry · OxyDex'
      + '<span class="xn-ov">' + (oxi.overlapPct != null ? oxi.overlapPct + '% overlap' : 'paired') + '</span></div>'
      + '<div class="xn-note">' + nativeNote + '.</div>'
      + '<div class="metric-grid" style="margin-top:8px">'
      + metricTile('odi', fnum(oxi.odi, 2), sev(5, 15, oxi.odi, true), oxi.odiBasis || 'external')
      + metricTile('t90Pct', fnum(oxi.t90, 2), sev(1, 5, oxi.t90, true), 'OxyDex')
      + metricTile('spo2Nadir', fnum(oxi.nadir), sev(90, 85, oxi.nadir), 'OxyDex')
      + metricTile('spo2Mean', fnum(oxi.mean, 1), sev(94, 92, oxi.mean), 'OxyDex')
      + '</div>';
    if (cn.concordance)
      body += '<div class="xn-conc xn-' + (cn.concordance === 'concordant' ? 'ok' : 'warn') + '">🔗 AHI ' + fnum(cn.ahi, 1) + ' ↔ external ODI ' + fnum(oxi.odi, 1) + ': <b>' + esc(cn.concordance) + '</b> — ' + esc(cn.concordanceNote) + '.</div>';
    body += '</div>';
  }

  if (aut){
    body += '<div class="xn-block"><div class="xn-src" style="color:#FF6B7A">⊕ Autonomic corroboration · ECGDex'
      + '<span class="xn-ov">' + (aut.overlapPct != null ? aut.overlapPct + '% overlap' : 'paired') + '</span></div>';
    if (aut.corroboratedPct != null)
      body += '<div class="xn-note"><b style="color:var(--text2)">' + aut.corroboratedPct + '%</b> of ' + aut.apneasInWindow + ' scored apneas had a matching ECG autonomic surge within the shared ±gate (' + aut.matched + '/' + aut.apneasInWindow + ').</div>';
    body += '<div class="metric-grid" style="margin-top:8px">'
      + '<div class="metric"><div class="m-val">' + fnum(aut.cvhrIndex, 1) + '</div><div class="m-label">CVHR Index <span class="xn-tag">ECG</span></div><div class="m-sub">cyclic-variation apnea screen</div></div>'
      + '<div class="metric"><div class="m-val">' + fnum(aut.estAHI, 1) + '</div><div class="m-label">ECG est. AHI <span class="xn-tag">ECG</span></div><div class="m-sub">' + esc(aut.estAHIband || 'independent estimate') + '</div></div>'
      + '<div class="metric"><div class="m-val">' + fnum(aut.respRateSd, 2) + '</div><div class="m-label">Resp-rate SD <span class="xn-tag">ECG</span></div><div class="m-sub">ventilation instability</div></div>'
      + '<div class="metric"><div class="m-val">' + fnum(aut.rmssd, 0) + '</div><div class="m-label">RMSSD <span class="xn-tag">ECG</span></div><div class="m-sub">real RR-based HRV</div></div>'
      + (aut.plvDrop != null ? '<div class="metric"><div class="m-val">' + fnum(aut.plvDrop, 2) + '</div><div class="m-label">Coupling drop <span class="xn-tag">ECG</span></div><div class="m-sub">cardioresp phase-lock loss in surges</div></div>' : '')
      + '</div></div>';
  }
  return '<div class="card">' + cardHead('Cross-Node Corroboration', 'optional peer exports · source-attributed, not re-emitted') + body + '</div>';
}

/* Primary hero — headline therapy-control read for the latest night, mirroring the
   suite's readiness-hero (ans-design.css). Residual AHI is the headline number. */
function heroCard(night){
  if (!night) return '';
  var nm = night.metrics || {};
  var ahi = nm.residualAHI;
  var cross = global.CpapFusion ? global.CpapFusion.cpapCrossMetrics(night) : null;
  var color, tier, note;
  if (ahi == null || !isFinite(ahi)) { color='neutral'; tier='AHI unavailable'; note='No device-scored events parsed for this night.'; }
  else if (ahi < 5)  { color='good'; tier='Well-controlled'; note='Residual AHI is in the controlled range (<5/hr) — therapy is suppressing events effectively.'; }
  else if (ahi < 15) { color='warn'; tier='Borderline control'; note='Residual AHI sits in the 5–15/hr band — review mask fit, pressure and leak before escalating.'; }
  else               { color='bad';  tier='Poorly controlled'; note='Residual AHI exceeds 15/hr — therapy is not controlling events; a pressure/fit review is warranted.'; }
  var css = color==='good'?'var(--status-ok)':color==='warn'?'var(--status-caution)':color==='bad'?'var(--status-concern)':'var(--blue)';

  var subs = '';
  var sub = function(val, unitTxt, label, id, sevCls){
    if (val == null || !isFinite(val)) return;
    subs += '<div class="readiness-subscore"><div class="rs-val ' + sevCls + '">' + fnum(val, val>=100?0:1) + unitTxt + '</div>'
      + '<div class="rs-label">' + evb(id) + esc(label) + '</div></div>';
  };
  sub(night.therapyHours, ' h', 'Usage', 'usageHours', sev(4,2,night.therapyHours));
  sub(nm.largeLeakPct, '%', 'Large Leak', 'largeLeakPct', sev(2,5,nm.largeLeakPct,true));
  sub(nm.medianPressure, '', 'Med. Pressure', 'medianPressure', 'neutral');
  if (cross && cross.oximetryAvailable && cross.odi != null)
    sub(cross.odi, '/h', 'ODI', 'odi', sev(5,15,cross.odi,true));
  else
    sub(nm.centralIndex, '/h', 'Central', 'centralIndex', sev(5,10,nm.centralIndex,true));

  var chips = '';
  if (night.therapyHours != null) {
    var compOk = night.therapyHours >= 4;
    chips += '<div class="readiness-zone-chip ' + (compOk?'ok':'warn') + '">' + (compOk?'✓ ≥4 h compliant':'⚠ under 4 h') + '</div>';
  }
  if (nm.periodicBreathingPct != null) {
    var pbC = nm.periodicBreathingPct<2?'ok':nm.periodicBreathingPct<10?'warn':'bad';
    chips += '<div class="readiness-zone-chip ' + pbC + '">Periodic breathing ' + fnum(nm.periodicBreathingPct,1) + '%</div>';
  }
  if (nm.obstructiveIndex != null && nm.centralIndex != null)
    chips += '<div class="readiness-zone-chip ' + (nm.centralIndex>nm.obstructiveIndex?'warn':'ok') + '">OA ' + fnum(nm.obstructiveIndex,1) + ' · CA ' + fnum(nm.centralIndex,1) + '/h</div>';

  return '<div id="heroTop"><div class="readiness-hero" style="--readiness-color:' + css + '">'
    + '<div class="readiness-hero-label">Therapy Control · Last Night</div>'
    + (D ? '<div class="readiness-date-badge">' + esc(D.fmtDate(night.t0Ms)) + ' · ' + fnum(night.therapyHours,1) + ' h · ' + night.nSessions + ' session' + (night.nSessions===1?'':'s') + '</div>' : '')
    + '<div class="readiness-score" style="color:' + css + '">' + fnum(ahi, 1) + '</div>'
    + '<div class="readiness-tier">' + esc(tier) + ' · residual AHI/hr</div>'
    + (subs ? '<div class="readiness-scores-grid">' + subs + '</div>' : '')
    + '<div class="readiness-note">' + esc(note) + '</div>'
    + (chips ? '<div class="readiness-zones">' + chips + '</div>' : '')
    + '</div></div>';
}

function renderNight(night){
  if (!night) return '';
  var warn = (global.CpapRegistry && global.CpapRegistry.WARNING)
    ? '<div class="cpap-warning">⚠ ' + esc(global.CpapRegistry.WARNING) + '</div>' : '';
  return ''
    + heroCard(night)
    + '<div class="kpi-grid">' + renderKPIs(night) + '</div>'
    + warn
    + (MR && MR.legend ? '<div class="ev-legend">' + MR.legend() + '</div>' : '')
    + '<div class="card-col">'
    + residualCard(night)
    + pressureCard(night)
    + leakCard(night)
    + ventCard(night)
    + oximetryCard(night)
    + crossCard(night)
    + crossNodeCard(night)
    + sessionsCard(night)
    + '</div>'
    + '<div class="card-col">'
    + (global.CpapFusion ? '<div class="card">' + cardHead('Full Metrics', 'every metric · normal ranges · evidence tier') + global.CpapFusion.cpapFullMetricsTable(night) + '</div>' : '')
    + eventStream(night)
    + '</div>';
}
/* draw the canvases inside a container after its HTML is in the DOM */
function hydrate(container, night){
  if (!container) return;
  container.querySelectorAll('canvas[data-chart]').forEach(function (cv){
    if (cv.dataset.chart === 'ahi') drawAhiByHour(cv, night);
    else if (cv.dataset.chart === 'pressure') drawPressure(cv, night.metrics || {});
  });
}
/* hydrate the longitudinal trend sparklines (multi-night view) */
function hydrateHistory(container, nights){
  if (!container) return;
  container.querySelectorAll('canvas[data-trend]').forEach(function (cv){
    drawNightTrend(cv, nights, cv.dataset.trend);
  });
}

global.CpapRender = {
  renderNight: renderNight, renderHistory: renderHistory, hydrate: hydrate, hydrateHistory: hydrateHistory,
  renderKPIs: renderKPIs,
  residualCard: residualCard, pressureCard: pressureCard, leakCard: leakCard,
  ventCard: ventCard, oximetryCard: oximetryCard, crossCard: crossCard, crossNodeCard: crossNodeCard,
  sessionsCard: sessionsCard, eventStream: eventStream,
  drawAhiByHour: drawAhiByHour, drawPressure: drawPressure, drawNightTrend: drawNightTrend
};

})(window);
