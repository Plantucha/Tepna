/* ════ PulseDex · Render (pulsedex-render.js) ────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   DOM/SVG builders: context banner, night-trend graphs, KPI strip, ANS bars,
   the full metrics table, the canonical Welltory-format table, and the live
   reRender() used when profile edits change derivations. Declarations only.
   ES module (ESM-MIGRATION deep-3; matches pulsedex-overview.js convention): top-level
   declarations are module-scoped, so the cross-file surface (render* / reRender / evBadge /
   WT_COLS …) is published to window in the block at the end of this file — the classic-style
   consumers (pulsedex-overview / -app) read them as bare globals at call time.
   No external libraries. ════════════════════════════════════════════════════ */
// ESM-MIGRATION Phase 4: explicit DSP-helper imports — destructured from the namespace's
// _bare surface (the app shell sets __DEX_NAMESPACED__, so the bare-global spray no longer
// runs on this page; every DSP helper this module uses is named here, import-style).
const { fmtClock, vo2Base, vo2Adj, altVO2Factor, lineChartSVG, triIdxGrade } = window.PulseDex._bare;

// ── evidence badge hook (System-Cohesion) — resolves a badge from a rendered
// label via PulseRegistry (pulsedex-registry.js). Zero-touch; safe no-op if the
// registry is unloaded. Global so overview/app can call it too.
function evBadge(label, fallback) {
  try {
    return (window.PulseRegistry && window.PulseRegistry.badgeForLabel(label, fallback !== false)) || '';
  } catch (e) {
    return '';
  }
}

// ─── RENDER CONTEXT BANNER ────────────────────────────────────────────────────
function renderContext(r) {
  const el = document.getElementById('ctxBanner');
  let note = '';
  if (r.mode === 'exercise') note = '⚠ Non-stationary recording — time- and frequency-domain averages are unreliable here; watch the trajectory, not the mean.';
  else if ((r.mode === 'morning' || r.mode === 'spot') && r.durMin < 5) note = '⚠ Short reading — SDNN, VLF, DFA α1 and SampEn need ≥5 min; treat them as low-confidence below.';
  else if (r.longRec) note = 'Per-window medians are the representative "daily" value; whole-night figures are shown too and feed the long-recording indices (SDANN, SDNN-index).';
  // ── altitude caveats ──
  let alt = '';
  if (r.elev >= 2500) {
    alt =
      '🏔 <b>High altitude (' +
      r.elev.toLocaleString() +
      ' m).</b> HRV reference ranges below are <b>sea-level norms</b> — chronic hypoxia legitimately lowers HRV, raises HR and shifts LF/HF sympathetic, so red flags here may be adaptive, not pathological. VO₂max is altitude-corrected (×' +
      r.altFactor +
      ').';
  } else if (r.elev > 1500) {
    alt = '⛰ <b>Moderate altitude (' + r.elev.toLocaleString() + ' m).</b> VO₂max altitude-corrected (×' + r.altFactor + '); HRV norms still broadly apply.';
  }
  let pbNote = '';
  if (r.pb && r.pb.strong) {
    pbNote =
      '🌬 <b>Periodic-breathing signature detected</b> (low-freq HR cycling, PB index ' +
      r.pb.frac +
      '). Common at altitude — it inflates VLF/LF and confounds LF/HF, Resp Rate and the SNS/PSNS split. Treat spectral & composite metrics with caution.';
  }
  const notes = [note, alt, pbNote]
    .filter(Boolean)
    .map((n) => `<div class="ctx-note">${n}</div>`)
    .join('');
  el.innerHTML = `<div class="ctx-main">
      <div><div class="ctx-mode">${r.modeLabel}</div><div class="ctx-why">${r.modeWhy}${r.overridden ? ' · <span style="color:var(--blue);font-weight:700">manual override</span>' : ''}</div></div>
      <div class="ctx-conf">${r.overridden ? 'OVERRIDE' : 'auto · ' + r.modeConf + '%'}</div>
    </div>${notes}`;
  el.style.display = 'block';
}

// ─── RENDER NIGHT-TREND GRAPHS ─────────────────────────────────────────────────
function renderGraphs(r) {
  const wrap = document.getElementById('graphWrap'),
    sl = document.getElementById('slGraph');
  if (!r.windows || r.windows.length < 3) {
    wrap.classList.remove('show');
    wrap.innerHTML = '';
    sl.style.display = 'none';
    return;
  }
  const rmPts = r.windows.map((w) => ({ x: w.tMin, y: w.rmssd }));
  const hrPts = r.windows.map((w) => ({ x: w.tMin, y: w.hr }));
  wrap.innerHTML = `
    <div class="graph-card">
      <h4>${evBadge('rMSSD')}rMSSD across the night <span class="gc-sub">median ${r.dispRm} ms · ${r.windows.length} × 5-min windows</span></h4>
      ${lineChartSVG(rmPts, '#3DE0D0', r.dispRm)}
    </div>
    <div class="graph-card">
      <h4>${evBadge('Mean HR')}Heart rate across the night <span class="gc-sub">median ${r.dispHr} bpm</span></h4>
      ${lineChartSVG(hrPts, '#58A6FF', r.dispHr)}
    </div>`;
  wrap.classList.add('show');
  sl.style.display = 'flex';
}

// ─── RENDER KPI ───────────────────────────────────────────────────────────────
function renderKPI(r) {
  const useRm = r.longRec ? r.dispRm : r.rmssd,
    useSd = r.longRec ? r.dispSd : r.sdnn,
    usePn = r.longRec ? r.dispPn : r.pnn50,
    useHr = r.longRec ? r.dispHr : r.hr;
  const sfx = r.longRec ? ' (med)' : '';
  const hrStat = (v) => (v < 35 ? 'bad' : v <= 80 ? 'ok' : v <= 95 ? 'warn' : 'bad'); // low resting HR is GOOD
  const items = [
    { l: 'HRV Score', v: r.hrv, sub: '0–100', s: r.hrv >= 50 ? 'ok' : r.hrv >= 35 ? 'warn' : 'bad' },
    { l: 'Stress', v: r.stress, sub: 'lower better', s: r.stress <= 45 ? 'ok' : r.stress <= 60 ? 'warn' : 'bad' },
    { l: 'Mean HR' + sfx, v: useHr, sub: 'bpm', s: hrStat(useHr) },
    { l: 'rMSSD' + sfx, v: useRm + 'ms', sub: '≥30 good', s: useRm >= 30 ? 'ok' : useRm >= 20 ? 'warn' : 'bad' },
    { l: 'SDNN' + sfx, v: useSd + 'ms', sub: r.longRec ? '5-min' : '≥50 good', s: useSd >= 50 ? 'ok' : useSd >= 30 ? 'warn' : 'bad' },
    { l: 'pNN50' + sfx, v: usePn + '%', sub: '≥15% good', s: usePn >= 15 ? 'ok' : usePn >= 5 ? 'warn' : 'bad' },
    r.longRec ? { l: 'SDANN', v: (r.sdann || 0) + 'ms', sub: 'long-rec', s: 'neutral' } : { l: 'Energy', v: r.energy, sub: 'est', s: r.energy >= 60 ? 'ok' : r.energy >= 40 ? 'warn' : 'bad' },
    { l: 'Coverage', v: r.coverage + '%', sub: 'data captured', s: r.coverage >= 95 ? 'ok' : r.coverage >= 85 ? 'warn' : 'bad' },
    { l: 'Artifacts', v: r.artifactPct + '%', sub: 'corrected', s: r.artifactPct < 2 ? 'ok' : r.artifactPct < 8 ? 'warn' : 'bad' },
    { l: 'VO₂ adj', v: r.vo2adj, sub: 'ml/kg/min', s: 'neutral' }
  ];
  const g = document.getElementById('kpiGrid');
  g.innerHTML = items
    .map(
      (k) => `<div class="kpi ${k.s}">
    <div class="kpi-label">${evBadge(k.l)}${k.l}</div>
    <div class="kpi-val ${k.s}">${k.v}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`
    )
    .join('');
  g.classList.add('show');
  document.getElementById('slKPI').style.display = 'flex';
}

// Tanaka HRmax (Tanaka, Monahan & Seals 2001) — hoisted from reRender's inline copy so it is a
// single, TESTABLE function (§RN render-harness): the render module carried its OWN duplicate of the
// 208−0.7·age formula, drift-prone vs the canonical ECGProfile copy and unpinnable by any gate.
function tanakaHRmax(age) {
  return Math.round(208 - 0.7 * age);
}

// ─── RE-RENDER (profile edits update derivations + projections live) ──────────
function reRender() {
  renderProfileDerivedPx();
  if (typeof lastResult !== 'undefined' && lastResult) {
    // profile-dependent values (age · HRmax) recompute live so cards aren't stale
    const r = lastResult;
    const _pp = typeof pxProfile === 'function' ? pxProfile() : {};
    const age = _pp.age || 40;
    const tanaka = tanakaHRmax(age);
    const hrmaxIn = _pp.hrmax || 0;
    const rhrIn = _pp.rhr || 0;
    r.rhrEff = rhrIn > 0 ? rhrIn : r.autoRHR || Math.round(r.dispHr);
    const hrmaxValid = hrmaxIn > 0 && hrmaxIn >= 140 && hrmaxIn > r.rhrEff + 45;
    r.hrmaxEff = hrmaxValid ? Math.round(hrmaxIn) : tanaka;
    r.tanaka = tanaka;
    r.hrmaxRejected = hrmaxIn > 0 && !hrmaxValid;
    r.elev = _pp.elev || 0;
    r.altFactor = +altVO2Factor(r.elev).toFixed(3);
    r.vo2base = +(vo2Base(r.rhrEff, r.hrmaxEff) * r.altFactor).toFixed(1);
    r.vo2adj = +vo2Adj(r.vo2base, r.lnrmssd).toFixed(1);
    const gtIn = _pp.vo2gt;
    r.vo2gt = gtIn > 0 ? +Number(gtIn).toFixed(1) : null;
    computeProfileHints(r);
    renderContext(r);
    renderHeroPx(r);
    renderKpiGridPx(r);
  }
}

// ─── RENDER ANS BARS ──────────────────────────────────────────────────────────
function renderANS(r) {
  const wrap = document.getElementById('ansWrap');
  wrap.innerHTML = `
  <div class="ans-card">
    <div class="ans-title">ANS Activation</div>
    <div class="bar-row"><div class="bar-lbl" style="color:var(--red)">${evBadge('SNS')}SNS</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, r.sns)}%;background:var(--red)"></div></div>
      <div class="bar-v" style="color:var(--red)">${r.sns}</div></div>
    <div class="bar-row"><div class="bar-lbl" style="color:var(--green)">${evBadge('PSNS')}PSNS</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, r.psns)}%;background:var(--green)"></div></div>
      <div class="bar-v" style="color:var(--green)">${r.psns}</div></div>
  </div>
  <div class="ans-card">
    <div class="ans-title">Spectral Power</div>
    <div class="bar-row"><div class="bar-lbl">${evBadge('HF')}HF</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (r.hf / (r.tp || 1)) * 100)}%;background:var(--teal)"></div></div>
      <div class="bar-v" style="color:var(--teal)">${r.hf}</div></div>
    <div class="bar-row"><div class="bar-lbl">${evBadge('LF')}LF</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (r.lf / (r.tp || 1)) * 100)}%;background:var(--blue)"></div></div>
      <div class="bar-v" style="color:var(--blue)">${r.lf}</div></div>
    <div class="bar-row"><div class="bar-lbl">${evBadge('Total Power')}Total</div>
      <div class="bar-track"><div class="bar-fill" style="width:100%;background:var(--surface3)"></div></div>
      <div class="bar-v">${r.tp}</div></div>
  </div>`;
  wrap.classList.add('show');
  document.getElementById('slANS').style.display = 'flex';
}

// ─── RENDER FULL TABLE ────────────────────────────────────────────────────────
function renderTable(r) {
  const sc = (v, ok, warn) => (v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad');
  const hrStat = (v) => (v < 35 ? 'bad' : v <= 80 ? 'ok' : v <= 95 ? 'warn' : 'bad'); // low resting/sleep HR is GOOD
  const short = (r.mode === 'morning' || r.mode === 'spot') && r.durMin < 5;
  const insuf = (st) => (short ? 'neutral' : st);
  const sdnnRange = r.longRec ? 'long-rec' : '≥50';
  const rows = [
    ['DateTime', r.datetime || '—', '—', '—', 'neutral', 'Measurement timestamp'],
    ['Recording', r.modeLabel, '—', '—', 'neutral', r.modeWhy + (r.overridden ? ' · manual override' : ' · auto ' + r.modeConf + '%')],
    ['Duration', r.durMin, 'min', '—', 'neutral', r.nWindows ? r.nWindows + ' × 5-min windows' : 'single segment'],
    ['Coverage', r.coverage, '%', '≥95', r.coverage >= 95 ? 'ok' : r.coverage >= 85 ? 'warn' : 'bad', 'RR-sum vs wall-clock (dropped-beat check)'],
    ['Artifacts', r.artifactPct + ' (' + r.nArtifact + ')', '%', '<2', r.artifactPct < 2 ? 'ok' : r.artifactPct < 8 ? 'warn' : 'bad', 'Beats corrected to local median'],
    ['N (beats)', r.N, 'beats', '60–300+', 'neutral', 'Sample size (after cleaning)'],
    ['Mean RR', r.meanRR, 'ms', '700–1100', 'neutral', 'Average RR interval'],
    ['Median RR', r.median, 'ms', '700–1100', 'neutral', '50th percentile RR'],
    ['HR', r.hr, 'bpm', '40–80', hrStat(r.hr), 'Mean HR (lower at rest/sleep is better)'],
    [
      'SDNN',
      r.sdnn,
      'ms',
      sdnnRange,
      r.longRec ? 'neutral' : insuf(sc(r.sdnn, 50, 30)),
      r.longRec ? 'Whole-night spread — use SDANN / SDNN-index instead' : 'Total HRV spread' + (short ? ' · needs ≥5 min' : '')
    ],
    ['rMSSD', r.rmssd, 'ms', '≥30', sc(r.rmssd, 30, 20), 'Parasympathetic HRV'],
    ['pNN50', r.pnn50, '%', '≥15', sc(r.pnn50, 15, 5), 'Beat-to-beat variability'],
    ['NN50', r.nn50, 'count', '—', 'neutral', 'Pairs with |diff|>50ms'],
    ...(r.longRec
      ? [
          ['SDANN', r.sdann == null ? '—' : r.sdann, 'ms', '≥50', r.sdann == null ? 'neutral' : sc(r.sdann, 50, 30), 'SD of 5-min mean-RR (long-recording index)'],
          ['SDNN index', r.sdnnIdx == null ? '—' : r.sdnnIdx, 'ms', '≥40', r.sdnnIdx == null ? 'neutral' : sc(r.sdnnIdx, 40, 25), 'Mean of 5-min SDNNs (long-recording index)']
        ]
      : []),
    ['CV', r.cv, '%', '5–12 rest', 'neutral', 'SDNN/MeanRR×100'],
    ['MxDMn', r.mx, 'ms', '—', 'neutral', 'Max−Min RR' + (r.longRec ? ' (whole-night range)' : '')],
    ['Mode', r.mode_ms, 'ms', '≈mean', 'neutral', 'Most common RR bin (±10ms)'],
    ['AMo50', r.amo50, '%', '20–50', 'neutral', '% beats within Mode±25ms'],
    ['Min RR', r.min, 'ms', '—', 'neutral', 'Shortest interval (post-clean)'],
    ['Max RR', r.max, 'ms', '—', 'neutral', 'Longest interval (post-clean)'],
    ['Q1 (25th)', r.q25, 'ms', '—', 'neutral', '25th percentile'],
    ['Q3 (75th)', r.q75, 'ms', '—', 'neutral', '75th percentile'],
    ['Total Power', r.tp, 'ms²', '—', 'neutral', 'Lomb–Scargle total power (∫PSD=variance)'],
    ['HF Power', r.hf, 'ms²', '≥100', sc(r.hf, 100, 50), 'Lomb–Scargle HF (parasympathetic)'],
    ['LF Power', r.lf, 'ms²', '—', 'neutral', 'Lomb–Scargle LF'],
    ['VLF Power', r.vlf, 'ms²', '—', 'neutral', 'Lomb–Scargle VLF'],
    // "VLF (night)"/"Total Pwr (night)" rows REMOVED 2026-06-30 (DEEP-AUDIT-FIXES §1): they surfaced
    // the crude spectral() rmssd²-proxy (VLF 4–11× the real LS row) under a borrowed `validated` grade.
    // The LS "VLF Power" row above is the single VLF source; whole-night ULF isn't recoverable from the proxy.
    ['LF/HF', r.lfhf, 'ratio', '0.5–2.0', 'neutral', 'Sympathovagal balance'],
    ['HF nu', r.hfnu, 'nu', '40–60', 'neutral', 'HF normalized units'],
    ['LF nu', r.lfnu, 'nu', '40–60', 'neutral', 'LF normalized units'],
    ['SD1', r.sd1, 'ms', '≥20', sc(r.sd1, 20, 10), 'Poincaré short-axis'],
    ['SD2', r.sd2, 'ms', '≥50', sc(r.sd2, 50, 30), 'Poincaré long-axis'],
    ['SD1/SD2', r.sd1sd2, 'ratio', '0.25–0.5', 'neutral', 'Short vs long-term balance'],
    ['Ellipse Area', r.ellArea, 'ms²', '—', 'neutral', 'π·SD1·SD2 complexity proxy'],
    ['ln(rMSSD)', r.lnrmssd, '—', '≥3.5', r.lnrmssd >= 3.5 ? 'ok' : r.lnrmssd >= 3.1 ? 'warn' : 'bad', 'Log-RMSSD readiness'],
    ['Baevsky SI', r.si, 'a.u.', '<150', r.si < 150 ? 'ok' : r.si < 200 ? 'warn' : 'bad', 'Stress index AMo/(2·Mo·MxDMn) · Mo & MxDMn in seconds' + (r.longRec ? ' · rep. window' : '')],
    // SBP est / DBP est / HTN Pattern rows REMOVED 2026-06-22 (DEX-SUITE-EXTERNAL-REVIEW-v2 §🔴):
    // HRV→BP has no validity and these rendered unbadged after their registry entries were dropped.
    ['VO₂ base', r.vo2base, 'ml/kg/min', '—', 'neutral', 'Uth–Sørensen HR ratio'],
    ['VO₂ adj', r.vo2adj, 'ml/kg/min', '—', 'neutral', 'HRV-adjusted VO₂ proxy'],
    ['VO₂ GT', r.vo2gt || '—', 'ml/kg/min', 'lab', 'neutral', 'Ground truth (if entered)'],
    ['Stress est', r.stress, '0–100', '<50', r.stress <= 45 ? 'ok' : r.stress <= 60 ? 'warn' : 'bad', 'Welltory-style estimate'],
    ['HRV Score', r.hrv, '0–100', '>50', r.hrv >= 50 ? 'ok' : r.hrv >= 35 ? 'warn' : 'bad', 'Welltory-style estimate'],
    ['Energy est', r.satE ? '100 (max)' : r.energy, '0–100', '>60', r.energy >= 60 ? 'ok' : r.energy >= 40 ? 'warn' : 'bad', 'Welltory-style estimate' + (r.satE ? ' · saturated (off-scale)' : '')],
    ['Focus est', r.focus, '0–100', '>55', r.focus >= 55 ? 'ok' : r.focus >= 35 ? 'warn' : 'bad', 'Welltory-style estimate'],
    ['Coherence', r.coherence, '0–100', '>50', r.coherence >= 50 ? 'ok' : r.coherence >= 30 ? 'warn' : 'bad', 'Welltory-style estimate'],
    ['ANS SNS', r.sns, '0–100', '<40', r.sns <= 40 ? 'ok' : r.sns <= 60 ? 'warn' : 'bad', 'Sympathetic activation'],
    ['ANS PSNS', r.satP ? '100 (max)' : r.psns, '0–100', '>30', r.psns >= 30 ? 'ok' : r.psns >= 15 ? 'warn' : 'bad', 'Parasympathetic activation' + (r.satP ? ' · saturated (off-scale)' : '')],
    ['SNS bal', r.snsBal, 'ratio', '<1.5', 'neutral', 'LF/HF-based sympathetic ratio'],
    ['PSNS bal', r.psnsBal, 'ratio', '>0.7', 'neutral', 'HF/LF-based parasympathetic'],
    ['EFC Readiness', r.efc, '0–100', '>60', r.efc >= 60 ? 'ok' : r.efc >= 40 ? 'warn' : 'bad', 'Energy×0.4+Focus×0.3+Coh×0.3'],
    ['Cardiac CRS', r.crs, 'a.u.', '>0.05', r.crs >= 0.05 ? 'ok' : r.crs >= 0.02 ? 'warn' : 'bad', '(Coh·rMSSD·pNN50)/Stress×1000'],
    ['ABS', r.abs, '−1..+1', '~0', Math.abs(r.abs) <= 0.3 ? 'ok' : Math.abs(r.abs) <= 0.6 ? 'warn' : 'bad', 'Autonomic Balance Score'],
    ['Stress-Focus', r.sfg, 'pts', '≈0', Math.abs(r.sfg) <= 10 ? 'ok' : Math.abs(r.sfg) <= 25 ? 'warn' : 'bad', 'Stress−Focus gap'],
    ['Focus Effic', r.fe, 'a.u.', '>0.3', r.fe >= 0.3 ? 'ok' : r.fe >= 0.15 ? 'warn' : 'bad', 'Focus/(SNS+1)'],
    ['PNS Effic', r.pnse === null ? '—' : r.pnse, 'a.u.', '>0.002', r.pnse === null ? 'neutral' : r.pnse >= 0.002 ? 'ok' : r.pnse >= 0.001 ? 'warn' : 'bad', 'rMSSD/(SDNN·pNN50)'],
    ['OTR', r.otr === null ? '—' : r.otr, 'a.u.', '<8', r.otr === null ? 'neutral' : r.otr < 8 ? 'ok' : r.otr < 15 ? 'warn' : 'bad', 'Overtraining risk proxy'],
    ['RSA Proxy', r.rsa, 'a.u.', '—', 'neutral', 'HF/MeanRR² RSA proxy'],
    ['— ADVANCED / RESEARCH —', '', '', '', 'neutral', r.longRec ? 'Computed on a representative 5-min window; not Welltory-derived' : 'Single-segment metrics; not Welltory-derived'],
    [
      'Resp Rate',
      r.respRate,
      'br/min',
      '12–20',
      r.pb && r.pb.strong ? 'warn' : r.respRate >= 10 && r.respRate <= 22 ? 'ok' : 'neutral',
      r.pb && r.pb.strong
        ? 'From HF spectral peak (RSA) — ⚠ periodic breathing detected: the dominant HR oscillation is sub-HF (PB/CSR), so this RSA-derived resp rate is unreliable'
        : 'From HF spectral peak (RSA frequency)'
    ],
    [
      'DFA α1',
      r.dfa1 === null ? '—' : r.dfa1,
      '—',
      '0.9–1.2',
      r.dfa1 === null ? 'neutral' : r.dfa1 >= 0.9 && r.dfa1 <= 1.2 ? 'ok' : r.dfa1 < 0.75 || r.dfa1 > 1.5 ? 'bad' : 'warn',
      (r.dfa1 !== null && r.dfa1 > 1.2 ? 'Above range (rigid / over-correlated)' : 'Short-term fractal scaling (Peng, box 4–16)') + (r.longRec ? ' · rep. window' : '')
    ],
    [
      'SampEn',
      r.sampen === null ? '—' : r.sampen,
      '—',
      '1.0–2.2',
      r.sampen === null ? 'neutral' : r.sampen >= 1.0 ? 'ok' : r.sampen >= 0.6 ? 'warn' : 'bad',
      'Sample entropy (m=2, r=0.2·SDNN of analyzed window)'
    ],
    [
      'Tri Index',
      r.triIdx,
      '—',
      r.triIdxNorm === true ? '≥15' : '—',
      // ≥15 is the 24 h Holter norm (Task Force 1996), applied only when the analysed series meets
      // that same literature's ≥20 min precondition. An unknown span (legacy stored row) also grades
      // neutral — we cannot assert a norm applies to a recording whose length we cannot measure.
      triIdxGrade(r.triIdx, r.triIdxSpanMin),
      r.triIdxNorm === true
        ? 'HRV triangular index (geometric)'
        : 'HRV triangular index (geometric) — analysed span ' +
          (r.triIdxSpanMin == null ? 'unknown' : r.triIdxSpanMin + ' min') +
          '; under the 20 min the ≥15 norm requires, so the value is shown but not graded'
    ],
    ['Decel Cap', r.dc === null ? '—' : r.dc, 'ms', '>4.5', r.dc === null ? 'neutral' : r.dc >= 4.5 ? 'ok' : r.dc >= 2.5 ? 'warn' : 'bad', 'PRSA deceleration capacity (vagal, mortality marker)'],
    ['Accel Cap', r.ac === null ? '—' : r.ac, 'ms', '< −4.5', 'neutral', 'PRSA acceleration capacity (sympathetic)'],
    [
      'PIP',
      r.pip === null ? '—' : r.pip,
      '%',
      '<55 healthy',
      r.pip === null ? 'neutral' : r.pip < 55 ? 'ok' : r.pip < 69 ? 'warn' : 'bad',
      'Fragmentation: % inflection points (>69% = AF risk, 2025)'
    ],
    ['IALS', r.ials === null ? '—' : r.ials, '—', 'age-dep', 'neutral', 'Fragmentation: inverse avg segment length (informational)'],
    ['PSS', r.pss === null ? '—' : r.pss, '%', 'age-dep', 'neutral', 'Fragmentation: % NN in short segments (informational)'],
    ['PAS', r.pas === null ? '—' : r.pas, '%', 'age-dep', 'neutral', 'Fragmentation: % NN in alternation segments (informational)'],
    [
      'Health',
      r.health,
      '0–100',
      '≥90 OK',
      r.artifactPct < 2 ? 'ok' : r.artifactPct < 8 ? 'warn' : 'bad',
      'Real integrity = 100 − 2×artifact% (' + r.artifactPct + '% corrected, ' + r.coverage + '% coverage)'
    ]
  ];
  window.__summaryRows = rows; // structured source for the tidy CSV export (not a DOM scrape)
  const body = document.getElementById('tblBody');
  body.innerHTML = rows
    .map(
      ([m, v, u, nr, s, n]) => `<tr>
    <td class="fmt-m" style="color:var(--text2);font-weight:600;font-family:Inter,sans-serif">${evBadge(m)}${m}</td>
    <td class="${s}">${v}</td>
    <td style="color:var(--text3)">${u}</td>
    <td style="color:var(--text3)">${nr}</td>
    <td class="${s}">${{ ok: '✅ Good', warn: '⚠️ Watch', bad: '❌ Concern', neutral: '—' }[s] || s}</td>
    <td style="color:var(--text3);font-family:Inter,sans-serif;font-size:10px">${n}</td>
  </tr>`
    )
    .join('');
  document.getElementById('tblWrap').classList.add('show');
  document.getElementById('slTbl').style.display = 'flex';
}

// ─── WELLTORY FORMAT (canonical header — feeds HRVDex) ───────────────────────
const WT_COLS = [
  'Date',
  'Time',
  'Stress(HRV)',
  'Energy(HRV)',
  'Focus',
  'ANS balance(SNS)',
  'ANS balance(PSNS)',
  'Coherence index',
  'HRV Score',
  'CV',
  'Measurement HR',
  'Mean RR',
  'SDNN',
  'rMSSD',
  'MxDMn',
  'pNN50',
  'AMo50',
  'Mode',
  'Total power',
  'HF',
  'LF',
  'VLF',
  'Health'
];
// Extra columns PulseDex measures that Welltory never exports (HRVDex reads by
// header name and ignores unknown columns, so these ride along safely):
const EXTRA_COLS = [
  'Recording mode',
  'Duration min',
  'Coverage %',
  'Artifacts %',
  'LF/HF',
  'SD1',
  'SD2',
  'ln(rMSSD)',
  'Baevsky SI',
  'DFA a1',
  'SampEn',
  'Tri Index',
  'Decel Cap',
  'Accel Cap',
  'PIP %',
  'Resp Rate',
  'SDANN',
  'SDNN index',
  'VO2 adj'
];

// One measurement → {col:value}. Long recordings export per-window MEDIANS (the
// representative daily value), with Mode & MxDMn in SECONDS like real Welltory.
function wtRowObj(r) {
  const iso = (r.datetime || '').replace(' ', 'T');
  const useRm = r.longRec ? r.dispRm : r.rmssd,
    useSd = r.longRec ? r.dispSd : r.sdnn,
    useHr = r.longRec ? r.dispHr : r.hr,
    usePn = r.longRec ? r.dispPn : r.pnn50,
    useRR = r.longRec ? r.dispMeanRR : r.meanRR;
  return {
    Date: iso,
    Time: iso,
    'Stress(HRV)': r.stress,
    'Energy(HRV)': r.energy,
    Focus: r.focus,
    'ANS balance(SNS)': r.sns,
    'ANS balance(PSNS)': r.psns,
    'Coherence index': r.coherence,
    'HRV Score': r.hrv,
    CV: r.expCv,
    'Measurement HR': useHr,
    'Mean RR': useRR,
    SDNN: useSd,
    rMSSD: useRm,
    MxDMn: +(r.expMx / 1000).toFixed(3),
    pNN50: usePn,
    AMo50: r.expAmo,
    Mode: +(r.expMo / 1000).toFixed(3),
    'Total power': r.tp,
    HF: r.hf,
    LF: r.lf,
    VLF: r.vlf,
    Health: r.health,
    // ── PulseDex extras ──
    'Recording mode': r.mode,
    'Duration min': r.durMin,
    'Coverage %': r.coverage,
    'Artifacts %': r.artifactPct,
    'LF/HF': r.lfhf,
    SD1: r.expSd1,
    SD2: r.expSd2,
    'ln(rMSSD)': r.lnrmssd,
    'Baevsky SI': r.si,
    'DFA a1': r.dfa1 == null ? '' : r.dfa1,
    SampEn: r.sampen == null ? '' : r.sampen,
    'Tri Index': r.triIdx,
    'Decel Cap': r.dc == null ? '' : r.dc,
    'Accel Cap': r.ac == null ? '' : r.ac,
    'PIP %': r.pip == null ? '' : r.pip,
    'Resp Rate': r.respRate,
    SDANN: r.sdann == null ? '' : r.sdann,
    'SDNN index': r.sdnnIdx == null ? '' : r.sdnnIdx,
    'VO2 adj': r.vo2adj
  };
}

function renderWTTable(r) {
  const obj = wtRowObj(r);
  const dateStr = (r.datetime || '').slice(0, 10);
  const wtRow = findWTRow(dateStr);
  const baseHdr = welltoryData && welltoryData.header.length ? welltoryData.header : WT_COLS;
  document.getElementById('wtHead').innerHTML = WT_COLS.map((h) => `<th>${h}</th>`).join('');
  const rawCols = WT_COLS.map((h) => (obj[h] !== undefined ? obj[h] : '—'));
  const wtCols = WT_COLS.map((h) => {
    const i = baseHdr.indexOf(h);
    return wtRow && i >= 0 && wtRow[i] !== undefined && wtRow[i] !== '' ? wtRow[i] : '—';
  });
  document.getElementById('wtBody').innerHTML =
    `<tr class="wt-row-label"><td colspan="${WT_COLS.length}">📊 PULSEDEX — this measurement${r.longRec ? ' (per-window medians)' : ''}</td></tr>` +
    `<tr class="wt-row-raw">${rawCols.map((c) => `<td>${c}</td>`).join('')}</tr>` +
    `<tr class="wt-row-label"><td colspan="${WT_COLS.length}">📱 WELLTORY export — same day, if matched</td></tr>` +
    `<tr class="wt-row-wt">${wtCols.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  document.getElementById('wtWrap').classList.add('show');
  document.getElementById('slWT').style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════════════════
//  SELF-INGEST review mode (SELF-INGEST-FOLLOWUPS-2026-07-03 · PulseDex pass)
//  Rendered when a PulseDex ganglior.node-export is dropped: pulseLoadOwnExport
//  (pulsedex-dsp.js) returns the review context; the app calls pulseRenderReview.
//  Reads the export's STORED rich layer (hrv/summary/recording) VERBATIM — no
//  recompute, no re-stamp. Raw-only panels (RR tachogram, Poincaré) are greyed,
//  never faked. CSS injected from THIS external module (never the shell).
// ═══════════════════════════════════════════════════════════════════════════
function _pesc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function _pulseFmtGen(g) {
  if (!g) return '';
  try {
    return String(g).replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ' UTC');
  } catch (e) {
    return String(g);
  }
}
function _pulseInjectReviewCSS() {
  if (typeof document === 'undefined' || document.getElementById('pulse-selfingest-css')) return;
  var css =
    '' +
    '#pulseReviewCard{margin:0 0 22px}' +
    '.prv-banner{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:0 0 18px;padding:13px 18px;border-radius:12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);font-size:13px;color:var(--text2,#9FB0C3);line-height:1.5}' +
    '.prv-tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--amber,#F59E0B)}' +
    '.prv-dot{width:8px;height:8px;border-radius:50%;background:var(--amber,#F59E0B)}' +
    '.prv-meta code{font-family:ui-monospace,monospace;color:var(--text2,#9FB0C3)}' +
    '.prv-spacer{flex:1 1 auto}' +
    '.prv-print{display:inline-flex;align-items:center;gap:7px;cursor:pointer;padding:8px 15px;border-radius:9px;border:1px solid rgba(61,224,208,.4);background:rgba(61,224,208,.12);color:var(--teal,#3DE0D0);font-size:12.5px;font-weight:700}' +
    '.prv-print:hover{filter:brightness(1.15)}' +
    '.prv-card{padding:24px 26px;border-radius:14px;background:var(--surface,#10151D);border:1px solid var(--border,#1f2e45)}' +
    '.prv-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border,#1f2e45)}' +
    '.prv-title{font-size:19px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.prv-sub{font-size:13px;color:var(--text3,#5E7187)}' +
    '.prv-sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3,#5E7187);margin:18px 0 9px}' +
    '.prv-imp{font-size:14px;line-height:1.55;color:var(--text2,#9FB0C3)}' +
    '.prv-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}' +
    '.prv-kpi{padding:12px 14px;border-radius:10px;background:var(--surface2,#0C0F15);border:1px solid var(--border,#1f2e45)}' +
    '.prv-kpi .k-lab{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text3,#5E7187);margin-bottom:5px}' +
    '.prv-kpi .k-val{font-size:21px;font-weight:800;color:var(--text,#E6EDF5)}' +
    '.prv-kpi .k-sub{font-size:10.5px;color:var(--text3,#5E7187);margin-top:3px}' +
    '.prv-tl{display:flex;flex-direction:column;border:1px solid var(--border,#1f2e45);border-radius:10px;overflow:hidden}' +
    '.prv-tlrow{display:grid;grid-template-columns:84px 1fr auto;align-items:center;gap:10px;padding:8px 13px;font-size:12.5px;border-top:1px solid var(--border,#1f2e45)}' +
    '.prv-tlrow:first-child{border-top:none}' +
    '.prv-tlrow .tl-t{font-family:ui-monospace,monospace;color:var(--text3,#5E7187);font-size:12px}' +
    '.prv-tlrow .tl-conf{color:var(--text3,#5E7187);font-family:ui-monospace,monospace;font-size:11.5px;text-align:right}' +
    '.prv-none{font-size:13px;color:var(--text3,#5E7187);font-style:italic;padding:6px 2px}' +
    '.prv-greyed{border:1px dashed var(--border,#1f2e45);border-radius:12px;padding:20px;margin-top:4px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.012) 0 10px,transparent 10px 20px);color:var(--text3,#5E7187);font-size:12.5px;text-align:center}' +
    '.prv-greyed strong{display:block;color:var(--text2,#9FB0C3);font-size:13px;margin-bottom:4px}' +
    '.prv-disc{margin-top:20px;padding-top:14px;border-top:1px solid var(--border,#1f2e45);font-size:11px;line-height:1.55;color:var(--text3,#5E7187)}' +
    '.prv-disc .dxl{font-weight:700;color:var(--text2,#9FB0C3)}' +
    '@media print{body.has-data > *:not(#pulseReviewCard){display:none !important} #pulseReviewCard .prv-print{display:none !important}}';
  var st = document.createElement('style');
  st.id = 'pulse-selfingest-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
}
function pulseReviewTimeline(events) {
  var evs = Array.isArray(events) ? events.slice() : [];
  if (!evs.length) return '<div class="prv-none">No scored events in this export.</div>';
  evs.sort(function (a, b) {
    return (a.tMs || 0) - (b.tMs || 0);
  });
  var CAP = 40,
    shown = evs.slice(0, CAP);
  var name = function (e) {
    return e.impulse === 'stress_peak' ? 'Stress peak' : e.impulse === 'hrv_drop' ? 'HRV drop' : e.impulse || 'event';
  };
  var h =
    '<div class="prv-tl">' +
    shown
      .map(function (e) {
        var when = e.t || (e.tMs != null && typeof fmtClock === 'function' ? fmtClock(e.tMs) : '—');
        return (
          '<div class="prv-tlrow"><span class="tl-t">' +
          _pesc(when) +
          '</span><span>' +
          (typeof evBadge === 'function' ? evBadge('rMSSD') : '') +
          _pesc(name(e)) +
          '</span><span class="tl-conf">conf ' +
          (e.conf != null ? e.conf : '—') +
          '</span></div>'
        );
      })
      .join('') +
    '</div>';
  if (evs.length > CAP) h += '<div class="prv-none">+ ' + (evs.length - CAP) + ' more events</div>';
  return h;
}
function pulseReviewView(review) {
  var rec = review.recording || {},
    hrv = review.hrv || {},
    t = hrv.time || {},
    pc = hrv.poincare || {};
  var prov = review.provenance || {},
    bh = prov.buildHash || (review.derivedFrom && review.derivedFrom.buildHash) || null,
    gen = _pulseFmtGen(prov.generated || review.generated);
  var nv = function (v, d) {
    return v == null || Number.isNaN(v) ? d || '—' : v;
  };
  var h =
    '<div class="prv-banner" role="status">' +
    '<span class="prv-tag"><span class="prv-dot"></span>Review mode</span>' +
    '<span>Loaded from export · <strong>not recomputed</strong>' +
    (review.scrubbed ? ' · <strong>scrubbed for sharing</strong>' : '') +
    '</span>' +
    '<span class="prv-meta">' +
    (bh ? 'built <code>' + _pesc(bh) + '</code>' : 'build unknown') +
    (gen ? ' on <code>' + _pesc(gen) + '</code>' : '') +
    '</span>' +
    '<span class="prv-spacer"></span>' +
    '<button class="prv-print" type="button" data-act="print">🖨 Save clinical PDF</button></div>';
  h += '<div class="prv-card">';
  h +=
    '<div class="prv-head"><span class="prv-title">PulseDex — HRV review</span>' +
    '<span class="prv-sub">' +
    _pesc(rec.modeLabel || rec.mode || 'recording') +
    (rec.durationMin != null ? ' · ' + Math.round(rec.durationMin) + ' min' : '') +
    (rec.beats != null ? ' · ' + rec.beats + ' beats' : '') +
    '</span></div>';
  h += '<div class="prv-sec">Impression</div>';
  h +=
    '<div class="prv-imp">rMSSD ' +
    nv(t.rmssd) +
    ' ms · SDNN ' +
    nv(t.sdnn) +
    ' ms · mean HR ' +
    nv(t.hr) +
    ' bpm' +
    (rec.coveragePct != null ? ' · coverage ' + rec.coveragePct + '%' : '') +
    '. Rendered from the export\u2019s stored values — no waveform recomputation.</div>';
  var kpis = [
    ['rMSSD', nv(t.rmssd), 'ms'],
    ['SDNN', nv(t.sdnn), 'ms'],
    ['Mean HR', nv(t.hr), 'bpm'],
    ['Mean RR', nv(t.meanRR), 'ms'],
    ['SD1', nv(pc.sd1), 'ms'],
    ['SD2', nv(pc.sd2), 'ms'],
    ['pNN50', nv(t.pnn50), '%'],
    ['Coverage', nv(rec.coveragePct), '%']
  ];
  h +=
    '<div class="prv-sec">Key metrics</div><div class="prv-kpis">' +
    kpis
      .map(function (k) {
        return (
          '<div class="prv-kpi"><div class="k-lab">' +
          (typeof evBadge === 'function' ? evBadge(k[0]) : '') +
          _pesc(k[0]) +
          '</div><div class="k-val">' +
          _pesc(k[1]) +
          '</div><div class="k-sub">' +
          _pesc(k[2]) +
          '</div></div>'
        );
      })
      .join('') +
    '</div>';
  h += '<div class="prv-sec">Event timeline</div>' + pulseReviewTimeline(review.events);
  h +=
    '<div class="prv-sec">Raw signal</div>' +
    '<div class="prv-greyed"><strong>RR tachogram &amp; Poincaré scatter not included</strong>Per-beat RR intervals are not carried in the export — review mode shows the derived HRV layer only. Re-run the original RR/IBI recording for the beat-by-beat charts.</div>';
  h +=
    '<div class="prv-disc">' +
    (bh ? 'Provenance · build <code>' + _pesc(bh) + '</code>' + (gen ? ' · generated ' + _pesc(gen) : '') : 'Provenance · build unknown') +
    '<br><span class="dxl">Tepna · not a medical device.</span> Computes HRV patterns for personal self-quantification; does not diagnose, treat, or monitor any condition.' +
    '</div></div>';
  return h;
}
// DOM glue: inject CSS, create/populate the review container, mark body has-data.
function pulseRenderReview(review) {
  if (typeof document === 'undefined' || !review) return;
  _pulseInjectReviewCSS();
  var host = document.getElementById('pulseReviewCard');
  if (!host) {
    host = document.createElement('section');
    host.id = 'pulseReviewCard';
    var anchor = document.getElementById('ctxBanner');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(host, anchor);
    } else {
      var main = document.querySelector('main') || document.body;
      main.insertBefore(host, main.firstChild);
    }
  }
  host.innerHTML = pulseReviewView(review);
  host.style.display = '';
  try {
    document.body.classList.add('has-data');
  } catch (e) {}
}
function pulseClearReview() {
  try {
    window._pulseReview = null;
  } catch (e) {}
  var host = document.getElementById('pulseReviewCard');
  if (host) {
    host.innerHTML = '';
    host.style.display = 'none';
  }
}
// F5 (SELF-INGEST-FOLLOWUPS-II): fleet convention — the review renderer is reachable via the node
// namespace (<Node>.reviewView / .renderReview) so the suite's live review probe (and any global
// caller) can drive it. dsp loads first, so window.PulseDex exists here.
try {
  if (typeof window !== 'undefined' && window.PulseDex) {
    window.PulseDex.reviewView = pulseReviewView;
    window.PulseDex.renderReview = pulseRenderReview;
    window.PulseDex.tanakaHRmax = tanakaHRmax; // §RN render-harness: testable Tanaka HRmax
  }
} catch (_rvx) {}

// ESM-MIGRATION deep-3: render is now an ES module, so its top-level declarations are
// module-scoped. Publish the cross-file surface — pulsedex-overview / -app (and the suite's
// live probes) resolve these as bare globals through window at call time. Mirrors
// pulsedex-overview.js's existing "expose for inline handlers" block.
Object.assign(window, {
  evBadge,
  reRender,
  renderContext,
  renderGraphs,
  renderKPI,
  renderANS,
  renderTable,
  wtRowObj,
  renderWTTable,
  pulseRenderReview,
  pulseClearReview,
  WT_COLS,
  EXTRA_COLS
});
