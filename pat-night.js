/*
 * pat-night.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ONE NIGHT'S PULSE ARRIVAL TIME, ALL THREE LEGS — the landing page for the monitor's "PAT" click.
 *
 * One click: H10 chest ECG → Verity foot, H10 → O2Ring finger foot, Verity → O2Ring (pulse to pulse),
 * on one 5-minute grid, and a classic three-cornered hat on their within-window scatter. PAT
 * Feasibility.html stays the pair deep-dive (drift anchors, the promotion gate); this page answers the
 * question the click asks — how do the three sites' pulse timings relate on THIS night, and how much
 * of each leg's scatter is the instrument.
 *
 * BUILT ON THE SUITE'S ENGINES: ans-design.css · hrvdex-chart.js · hand-authored SVG · entrance-guard.js
 * — the same skeleton as sensor-trio-night.html. NOTHING STATISTICAL RUNS HERE: the worker is
 * pat-feasibility-worker.js (its `threeCorner` job), whose fiducials are the sanctioned ones —
 * sub-sample R-peaks on the host-disciplined axis, intersecting-tangent PPG feet from the 3-LED
 * consensus on the measured per-sample axis (tools/pat-literature-spec.mjs rule 1) — and whose solve is
 * pat-three-corner.js, shared with the rig tool. The promotion bar (60 ms) is read from pat-gate.js.
 *
 * WHAT THIS PAGE WILL NOT SAY (PAT-COMPENDIUM ⛔ 2026-08-11): an absolute PAT. A per-connection BLE
 * buffering offset spans seconds between nights against a ~10 ms requirement, so the median lag is
 * shown for its SIGN and as context, never as a vascular number. Every σ is printed beside its
 * window's w/√12 (§6.2), every leg beside its exact-repeat share (§8), and the closure line is drawn
 * only as the tautology it is. Placement is part of the result: the selector changes labels and the
 * expected sign of the pulse-to-pulse leg, never a number.
 *
 * LITERATURE — validation references, never runtime inputs (LITERATURE-USE-POLICY-2026-07-11 §2):
 * the published beat-to-beat PAT sd band 8.22–15.4 ms (7.21 optimised) and the error budget terms
 * (respiratory 4.3, fiducial 5.69 ms) are drawn as marks and cited; no computed value reads them.
 *
 * ABSENCE IS NULL: a leg that paired too few beats, a window a stream failed, a refused hat corner —
 * all null from the kernel and drawn as absences. Time is floating wall-clock read back with getUTC*.
 * 100 % local: drag-drop / monitor injection only, connect-src 'none'. An ANALYSIS tool, not a node.
 */
(function () {
  'use strict';
  const DEV = {
    h10: { name: 'Polar H10', kind: 'chest ECG · R-peak', col: '#3DE0D0', rgb: '61,224,208' },
    verity: { name: 'Verity Sense', kind: 'PPG foot', col: '#B98AFF', rgb: '185,138,255' },
    ring: { name: 'O2Ring', kind: 'finger PPG foot', col: '#FFB84D', rgb: '255,184,77' }
  };
  const SITES = ['h10', 'verity', 'ring'];
  const LEG = {
    hv: { label: 'H10 → Verity', col: '#B98AFF', from: 'h10', to: 'verity' },
    hr: { label: 'H10 → O2Ring', col: '#FFB84D', from: 'h10', to: 'ring' },
    vr: { label: 'Verity → O2Ring', col: '#58A6FF', from: 'verity', to: 'ring' }
  };
  const LKEYS = ['hv', 'hr', 'vr'];
  const FLAG = '#FF6B7A',
    MUT = '#6e85a8',
    DIM = '#3d5070',
    GRIDC = 'rgba(30,45,66,0.6)';
  // the promotion bar, single-sourced in pat-gate.js (loaded before this file); the literal is the
  // documented fallback pat-feasibility.js also carries, never a second source of truth
  const GATE = (window.PATGate && window.PATGate.PAT_GATE) || { BEAT_IQR_MAX_MS: 60 };
  const BAR_MS = GATE.BEAT_IQR_MAX_MS;
  // placement changes LABELS and the expected SIGN of the pulse-to-pulse leg — never a number
  const PLACEMENT = {
    arm: { verity: 'upper arm', vrSign: +1, why: 'the arm is proximal to the finger, so the finger foot arrives AFTER the arm foot: Verity → O2Ring positive' },
    ankle: {
      verity: 'left ankle',
      vrSign: -1,
      why: 'the ankle path is the longer one, so the finger foot arrives BEFORE the ankle foot: Verity → O2Ring negative (the 2026-08 PAT corpus, wearer-confirmed)'
    }
  };
  let placement = 'arm';
  const $ = (id) => document.getElementById(id);
  const f0 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(0));
  const f1 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(1));
  const f2 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(2));
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const hmOf = (ms) => Math.floor(ms / 3600000) + ' h ' + pad2(Math.floor((ms % 3600000) / 60000)) + ' min';
  const utcHM = (ms) => {
    const d = new Date(ms);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  };
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  function setStatus(kind, text) {
    const p = $('status');
    if (!p) return;
    p.className = 'status-pill ts-' + kind;
    p.textContent = text;
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  INGEST — box and phone layouts, one rule per role (gated by capture-host
  //  test_the_tool_classifiers_accept_box_filenames, which reads this body as text)
  // ═══════════════════════════════════════════════════════════════════════════
  const NIGHTS = {};
  /* The three raw legs and nothing else: the H10's `_ECG.txt` (never its HR — PAT needs the R-peak), a
     Verity `_PPG.txt`, and the ring's raw `_PPG.txt` (box captures only — the phone app never wrote
     one). The stamp is `(\d{8})_?(\d{6})` so the phone's `YYYYMMDD_HHMMSS` and the box's 14 digits
     both key the night. ACC, RR, HR, SPO2 and the ring's SPO2 CSV classify to null on purpose. */
  function classify(file) {
    const n = file.name;
    let mo;
    if ((mo = n.match(/^Polar_H10_[0-9A-Za-zx]+_(\d{8})_?(\d{6})_ECG\.txt$/i))) return { role: 'h10', stamp: mo[1] + mo[2] };
    if ((mo = n.match(/^Polar_(?:Sense|VeritySense)_[0-9A-Za-zx]+_(\d{8})_?(\d{6})_PPG\.txt$/i))) return { role: 'verity', stamp: mo[1] + mo[2] };
    if ((mo = n.match(/^Wellue_O2Ring-S_[0-9A-Za-z]+_(\d{14})_PPG\.txt$/i))) return { role: 'ring', stamp: mo[1] };
    return null;
  }
  // sessions starting before noon fold into the PREVIOUS evening's night (floating civil time)
  function nightKeyOf(stamp) {
    const Y = +stamp.slice(0, 4),
      M = +stamp.slice(4, 6),
      D = +stamp.slice(6, 8),
      h = +stamp.slice(8, 10);
    let ms = Date.UTC(Y, M - 1, D);
    if (h < 12) ms -= 86400000;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function stampMs(s) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  }
  // per site: the largest file of the night (the overnight fragment; a 20-second test leaves a small one)
  function resolveSites(nt) {
    const C = nt.cand || {};
    for (const s of SITES) {
      const a = C[s];
      nt[s] = a && a.length ? a.reduce((b, x) => (x.size > b.size ? x : b)).file : null;
    }
  }
  const presentSites = (nt) => SITES.filter((s) => !!nt[s]);
  const eligible = (nt) => presentSites(nt).length >= 2; // two sites make a leg; three make the hat
  let SELECTED = null;
  function ingestFiles(list) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i],
        c = classify(f);
      if (!c) continue;
      const nk = nightKeyOf(c.stamp),
        nt = NIGHTS[nk] || (NIGHTS[nk] = { key: nk, cand: {} });
      (nt.cand[c.role] || (nt.cand[c.role] = [])).push({ file: f, ms: stampMs(c.stamp), size: f.size });
    }
    Object.keys(NIGHTS).forEach((k) => resolveSites(NIGHTS[k]));
    const elig = Object.keys(NIGHTS)
      .filter((k) => eligible(NIGHTS[k]))
      .sort();
    if (!SELECTED || !NIGHTS[SELECTED] || !eligible(NIGHTS[SELECTED])) SELECTED = elig.length ? elig[elig.length - 1] : null;
    renderNightNav();
    const note = $('ingestNote');
    if (note) note.textContent = Object.keys(NIGHTS).length + ' night(s) indexed from ' + list.length + ' file(s) · ' + elig.length + ' eligible';
    if (elig.length === 1 && !RUNNING) solve(NIGHTS[elig[0]]);
    else if (elig.length > 1 && !RUNNING) setStatus('idle', 'pick a night in the sidebar, then Run');
  }
  function renderNightNav() {
    const nav = $('nightNav');
    if (!nav) return;
    nav.innerHTML = '';
    const keys = Object.keys(NIGHTS).sort();
    let elig = 0;
    if (!keys.length) nav.innerHTML = '<div class="sb-item ts-dim">no night loaded</div>';
    keys.forEach((k) => {
      const nt = NIGHTS[k],
        ps = presentSites(nt),
        ok = eligible(nt);
      if (ok) elig++;
      const el = document.createElement('div');
      el.className = 'sb-item' + (SELECTED === k ? ' active' : '') + (ok ? '' : ' ts-dim');
      el.setAttribute('data-k', k);
      el.title = SITES.map((s) => DEV[s].name + (nt[s] ? ' ●' : ' ○')).join(' · ');
      el.innerHTML = '<span class="ts-nk">' + esc(k) + '</span><span class="ts-nres" id="nres-' + esc(k) + '">' + (ok ? ps.length + '/3 sites' : 'ineligible') + '</span>';
      nav.appendChild(el);
    });
    const tag = $('nightTag');
    if (tag) tag.textContent = keys.length ? keys.length + ' night' + (keys.length > 1 ? 's' : '') + ' · ' + elig + ' eligible' : 'no night';
    // stays enabled during a run: the monitor waits for this button to enable and presses it once
    const pb = $('procBtn');
    if (pb) pb.disabled = elig === 0;
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  WORKER — pat-feasibility-worker.js, its `threeCorner` job
  // ═══════════════════════════════════════════════════════════════════════════
  let worker = null,
    workerReady = null;
  function bootWorker() {
    if (workerReady) return workerReady;
    workerReady = new Promise((resolve) => {
      let w;
      try {
        w = new Worker('pat-feasibility-worker.js');
      } catch (_e) {
        resolve(null); // no worker realm here — solve() reports it
        return;
      }
      const timer = setTimeout(() => resolve(null), 15000);
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') {
          clearTimeout(timer);
          worker = w;
          resolve(m.ok ? w : null);
          if (!m.ok) setStatus('bad', 'worker DSP failed to load: ' + (m.err || '?'));
          return;
        }
        if (m.type === 'phase') {
          setStatus('run', (m.key || '') + ' · ' + m.phase);
          return;
        }
        if (m.type === 'threeCorner' && PENDING && m.key === PENDING.key) {
          const p = PENDING;
          PENDING = null;
          p.resolve(m);
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        resolve(null);
        setStatus('bad', 'worker error: ' + ((e && e.message) || 'unknown'));
      };
      w.postMessage({ type: 'ping' });
    });
    return workerReady;
  }
  let PENDING = null;
  function runThreeCorner(nt) {
    return new Promise((resolve) => {
      PENDING = { key: nt.key, resolve: resolve };
      worker.postMessage({ type: 'threeCorner', key: nt.key, ecgFile: nt.h10 || null, verityFile: nt.verity || null, ringFile: nt.ring || null, winMin: 5 });
      setTimeout(() => {
        if (PENDING && PENDING.key === nt.key) {
          PENDING = null;
          resolve({ error: 'timeout — the worker did not answer in 20 minutes' });
        }
      }, 1200000);
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  SOLVE one night
  // ═══════════════════════════════════════════════════════════════════════════
  const RESULT = { night: null, res: null };
  window.PAT_NIGHT = RESULT;
  let RUNNING = false;
  async function solve(nt) {
    if (RUNNING || !nt || !eligible(nt)) return;
    RUNNING = true;
    SELECTED = nt.key;
    renderNightNav();
    const rc = $('nres-' + nt.key);
    if (rc) rc.textContent = 'running…';
    const pb = $('procBtn');
    if (pb) pb.textContent = 'Running…';
    setStatus('run', nt.key + ' · booting worker');
    const w = await bootWorker();
    if (!w) {
      finish(nt, { skip: true, reason: 'no worker realm available (a blob worker was refused, or its DSP failed to load)' });
      return;
    }
    const r = await runThreeCorner(nt);
    finish(nt, r && !r.error ? r : { skip: true, reason: (r && r.error) || 'no result' });
  }
  function finish(nt, res) {
    RESULT.night = nt.key;
    RESULT.res = res;
    RUNNING = false;
    const pb = $('procBtn');
    if (pb) pb.textContent = 'Run all three legs';
    const rc = $('nres-' + nt.key);
    if (res.skip) {
      if (rc) {
        rc.textContent = 'not solved';
        rc.style.color = FLAG;
      }
      setStatus('bad', nt.key + ' · not solved');
      renderSkip(nt, res);
      return;
    }
    if (rc) {
      rc.textContent = res.hat ? 'σ ' + f1(res.hat.h10) + ' / ' + f1(res.hat.verity) + ' / ' + f1(res.hat.ring) : LKEYS.filter((k) => res.legs[k]).length + ' leg(s)';
      rc.style.color = '';
    }
    setStatus('ok', nt.key + ' · ' + res.nKept + '/' + res.nWindows + ' windows · ' + hmOf(res.tE - res.t0) + ' overlap');
    renderAll(nt, res);
    ['dlLag', 'dlSd', 'dlBudget', 'dlHist', 'dlHat', 'dlJson'].forEach((id) => {
      if ($(id)) $(id).disabled = false;
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER — ans-design surfaces, hrvdex-chart canvases, hand-authored SVG
  // ═══════════════════════════════════════════════════════════════════════════
  const CARDS = ['cLag', 'cBudget', 'cSd', 'cHist', 'cHat'];
  function setEmpty(cardId, text, warn) {
    const c = $(cardId);
    if (!c) return;
    c.classList.remove('ts-filled');
    const e = c.querySelector('.ts-empty');
    if (e) {
      e.textContent = text;
      e.classList.toggle('ts-warn', !!warn);
    }
  }
  function fillCard(cardId) {
    const c = $(cardId);
    if (c) c.classList.add('ts-filled');
  }
  function kpi(id, val, sub, state) {
    const el = $(id);
    if (!el) return;
    el.className = 'kpi' + (state ? ' ' + state : '');
    const v = el.querySelector('.kpi-val'),
      s = el.querySelector('.kpi-sub');
    if (v) v.textContent = val;
    if (s) s.textContent = sub || '';
  }
  function hero(k, res) {
    const v = $('hero-' + k + '-val'),
      u = $('hero-' + k + '-unit');
    if (!v) return;
    const H = res && res.hat,
      s = H ? H[k] : null;
    v.textContent = f1(s);
    v.style.color = s == null ? FLAG : DEV[k].col;
    if (!u) return;
    if (!res) u.textContent = 'ms';
    else if (!H) u.textContent = res.present && res.present.indexOf(k) < 0 ? 'no ' + DEV[k].kind.split(' ·')[0] + ' file this night' : 'hat needs all three sites';
    else if (s == null) u.textContent = 'REFUSED — negative variance ' + f0(H['var' + k[0].toUpperCase() + k.slice(1)]) + ' ms²';
    else {
      // the robust sibling rides along as a cross-check; when the two estimators DISAGREE about whether
      // the corner exists at all, say so — a bare em-dash there reads as "not computed"
      const q = res.hatIqr ? res.hatIqr[k] : null;
      u.textContent = 'ms · robust (IQR) hat ' + (res.hatIqr ? (q == null ? 'REFUSES this corner' : f1(q)) : 'n/a');
    }
  }
  function renderSkip(nt, res) {
    for (const k of SITES) hero(k, null);
    $('heroNight').textContent = nt.key;
    kpi('kWin', '—', res.reason || 'no result', 'bad');
    kpi('kLag', '—', '');
    kpi('kRatio', '—', '');
    kpi('kRep', '—', '');
    kpi('kAxis', '—', '');
    kpi('kBar', '—', '');
    for (const id of CARDS) setEmpty(id, 'This night could not be solved — ' + (res.reason || 'no result'), true);
  }
  const legRow = (res, k) => res.legs && res.legs[k];
  function renderAll(nt, res) {
    $('heroNight').textContent = nt.key;
    for (const k of SITES) hero(k, res);
    const P = PLACEMENT[placement];
    kpi('kWin', res.nKept + ' / ' + res.nWindows, res.winMin + '-min windows kept · every present stream passed quality, every leg ≥ ' + res.rules.minPairs + ' pairs', res.nKept ? 'good' : 'bad');
    /* Median lag per leg — SIGN and context only, never an absolute PAT. The pulse-to-pulse sign is
       compared to the selected placement and the comparison is ADVISORY, not a verdict: the two
       devices' streams carry a differential BLE delivery offset, and that offset spans SECONDS between
       nights (PAT-COMPENDIUM ⛔ 2026-08-11) — orders of magnitude above the tens of ms anatomy puts
       here. So a disagreeing sign is worth a look and cannot condemn a placement, and an agreeing one
       is not evidence for it either. Never coloured `bad`; the honest state for "unverifiable" is a
       flag to read, not a failure. */
    const vr = legRow(res, 'vr');
    const signOk = vr && vr.medLag != null ? Math.sign(vr.medLag) === P.vrSign : null;
    kpi(
      'kLag',
      LKEYS.map((k) => f0(legRow(res, k) ? legRow(res, k).medLag : null)).join(' · '),
      'ms · HV · HR · VR medians' +
        (signOk == null
          ? ''
          : signOk
            ? ' · VR sign matches the ' + P.verity + ' (advisory — a BLE delivery offset can flip it)'
            : ' · VR sign is opposite to the ' + P.verity + ' — advisory only, a differential BLE delivery offset of seconds can flip it'),
      signOk === false ? 'warn' : ''
    );
    const ratios = LKEYS.map((k) => (legRow(res, k) ? legRow(res, k).wRatio : null));
    kpi(
      'kRatio',
      ratios.map(f2).join(' · '),
      'σ ÷ (band width/√12) · near 1.00 = the window, not the signal',
      ratios.some((r) => r != null && r > 0.5) ? 'bad' : ratios.some((r) => r != null && r > 0.25) ? 'warn' : 'good'
    );
    const reps = LKEYS.map((k) => (legRow(res, k) ? legRow(res, k).repeatShare : null));
    kpi(
      'kRep',
      reps.map((r) => (r == null ? '—' : (r * 100).toFixed(0) + ' %')).join(' · '),
      'exact-repeat share of per-beat lags · high = integer-sample fiducial',
      reps.some((r) => r != null && r > 0.5) ? 'bad' : reps.some((r) => r != null && r > 0.2) ? 'warn' : 'good'
    );
    const ax = res.axis || {};
    const axTxt = SITES.filter((s) => res.present.indexOf(s) >= 0)
      .map((s) => DEV[s].name.split(' ')[0] + ' ' + (ax[s] && ax[s].timingSource ? ax[s].timingSource : '?'))
      .join(' · ');
    const drawn = SITES.some((s) => ax[s] && /drawn|synth|index/i.test(String(ax[s].timingSource || '')));
    kpi('kAxis', axTxt || '—', 'timing source per leg, as each parser decided it', drawn ? 'bad' : '');
    const sds = LKEYS.map((k) => (legRow(res, k) ? legRow(res, k).sigmaSd : null));
    kpi(
      'kBar',
      sds.map(f1).join(' · '),
      'ms · beat-to-beat sd per leg · pat-gate bar ' + BAR_MS + ' ms · literature ' + res.lit.bandLoMs + '–' + res.lit.bandHiMs,
      sds.some((s) => s != null && s > BAR_MS) ? 'warn' : sds.some((s) => s != null) ? 'good' : ''
    );
    const pl = $('placementNote');
    if (pl) pl.textContent = 'Verity on the ' + P.verity + ' — ' + P.why + '.';
    drawLag(res);
    drawSd(res);
    drawBudget(res);
    drawHist(res);
    drawHat(res);
    for (const id of CARDS) fillCard(id);
    const cl = $('closureNote');
    if (cl)
      cl.textContent =
        res.closureMs == null
          ? 'closure not computed (hat needs all three legs)'
          : 'closure HR − HV − VR = ' + f1(res.closureMs) + ' ms — VACUOUS: both paths pick the same beat, so this identity holds for any data (2001/2001 on a synthetic train). Not evidence.';
  }
  // ── the house Chart wrapper (engine = hrvdex-chart.js) ─────────────────────
  const charts = {};
  function mkChart(id, labels, datasets, opts) {
    opts = opts || {};
    const canvas = $(id);
    if (!canvas || typeof Chart === 'undefined') return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas, {
      type: opts.type || 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: Object.assign({ labels: { color: MUT, font: { size: 10 }, boxWidth: 12 } }, opts.legend || {}) },
        scales: {
          x: Object.assign({ ticks: { color: DIM, maxTicksLimit: opts.maxTicks || 8, font: { size: 9 } }, grid: { color: GRIDC } }, opts.xAxis || {}),
          y: Object.assign({ ticks: { color: MUT, font: { size: 9 } }, grid: { color: GRIDC } }, opts.yAxis || {})
        },
        elements: { point: { radius: 0 } }
      }
    });
  }
  const winLabels = (res) => res.windows.map((w) => utcHM(w.t));
  const winSeries = (res, k, f) => res.windows.map((w) => (w.kept && w.legs[k] ? w.legs[k][f] : null));
  // FIGURE 1 — per-window median lag per leg; a window a stream failed is a gap
  function drawLag(res) {
    const keys = LKEYS.filter((k) => legRow(res, k));
    if (!keys.length) {
      setEmpty('cLag', 'no leg paired enough beats in any window', true);
      return;
    }
    mkChart(
      'ch_lag',
      winLabels(res),
      keys.map((k) => ({
        label: LEG[k].label + ' · median ' + f0(legRow(res, k).medLag) + ' ms',
        data: winSeries(res, k, 'med'),
        borderColor: LEG[k].col,
        borderWidth: 1.6,
        pointRadius: 0,
        fill: false
      })),
      { maxTicks: 9, yAxis: { title: { display: true, text: 'lag (ms) — sign and context, not absolute PAT' } } }
    );
    const sub = $('sLag');
    if (sub) sub.textContent = utcHM(res.t0) + ' – ' + utcHM(res.tE) + ' floating wall-clock · ' + res.winMin + '-min windows · ' + res.nKept + ' kept of ' + res.nWindows;
  }
  // FIGURE 2 — per-window beat-to-beat sd per leg, against the literature band and the gate bar
  function drawSd(res) {
    const keys = LKEYS.filter((k) => legRow(res, k));
    if (!keys.length) {
      setEmpty('cSd', 'no leg paired enough beats in any window', true);
      return;
    }
    const labels = winLabels(res),
      flat = (v) => labels.map(() => v);
    const ds = keys.map((k) => ({
      label: LEG[k].label + ' · sd ' + f1(legRow(res, k).sigmaSd) + ' ms',
      data: winSeries(res, k, 'sd'),
      borderColor: LEG[k].col,
      borderWidth: 1.6,
      pointRadius: 0,
      fill: false
    }));
    ds.push({
      label: 'literature ' + res.lit.bandLoMs + '–' + res.lit.bandHiMs + ' ms',
      data: flat(res.lit.bandHiMs),
      borderColor: 'rgba(230,237,246,.55)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false
    });
    ds.push({ label: 'pat-gate bar ' + BAR_MS + ' ms', data: flat(BAR_MS), borderColor: FLAG, borderWidth: 1, borderDash: [2, 4], pointRadius: 0, fill: false });
    let Y = BAR_MS * 1.3;
    for (const k of keys) for (const v of winSeries(res, k, 'sd')) if (v != null && v > Y) Y = v;
    mkChart('ch_sd', labels, ds, { maxTicks: 9, yAxis: { min: 0, max: Math.ceil(Y * 1.1), title: { display: true, text: 'beat-to-beat sd (ms)' } } });
  }
  // FIGURE 4 — per-beat lag histogram per leg on one 10-ms grid: a coupled leg is a peak inside its band,
  // an uncoupled one is flat across it (and its sd reads the band's w/√12)
  function drawHist(res) {
    const keys = LKEYS.filter((k) => legRow(res, k));
    if (!keys.length) {
      setEmpty('cHist', 'no per-beat lags to bin', true);
      return;
    }
    const H = res.hist,
      nb = Math.round((H.hi - H.lo) / H.step);
    const labels = [];
    for (let i = 0; i < nb; i++) labels.push(H.lo + i * H.step);
    mkChart(
      'ch_hist',
      labels.map((v) => v + ''),
      keys.map((k) => ({
        label: LEG[k].label + ' · band ' + legRow(res, k).band.join('…') + ' ms',
        data: legRow(res, k).hist,
        borderColor: LEG[k].col,
        backgroundColor: 'rgba(' + hexRgb(LEG[k].col) + ',.35)',
        borderWidth: 1
      })),
      {
        type: 'bar',
        maxTicks: 12,
        yAxis: { title: { display: true, text: 'beats' } },
        xAxis: { title: { display: true, text: 'lag (ms), 10-ms bins' }, ticks: { color: DIM, maxTicksLimit: 12, font: { size: 9 } }, grid: { color: GRIDC } }
      }
    );
  }
  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  // ── SVG helpers ────────────────────────────────────────────────────────────
  const svgEl = (tag, attrs, inner) =>
    '<' +
    tag +
    Object.keys(attrs || {})
      .map((a) => ' ' + a + '="' + esc(attrs[a]) + '"')
      .join('') +
    (inner == null ? '/>' : '>' + inner + '</' + tag + '>');
  function niceTicks(max, n) {
    const raw = max / n,
      p = Math.pow(10, Math.floor(Math.log10(raw))),
      f = raw / p,
      step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p,
      out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  const MONO = 'ui-monospace,monospace';
  // FIGURE 3 — the error budget per leg (pat-literature-spec): measured sd as a bar; the part the
  // literature already accounts for (sampling ⊕ respiratory ⊕ fiducial, in quadrature) filled, the
  // unexplained remainder hatched; the published band shaded, the gate bar dashed
  function drawBudget(res) {
    const host = $('svg_budget');
    if (!host) return;
    const keys = LKEYS.filter((k) => legRow(res, k));
    if (!keys.length) {
      setEmpty('cBudget', 'no leg to budget', true);
      return;
    }
    const W = 440,
      L = 118,
      R = 18,
      T = 24,
      rowH = 64,
      H = T + rowH * keys.length + 36;
    let max = BAR_MS;
    for (const k of keys) max = Math.max(max, legRow(res, k).sigmaSd || 0);
    max = Math.ceil((max * 1.15) / 10) * 10;
    const x = (v) => L + (Math.max(0, v) / max) * (W - L - R);
    let s = '';
    s += svgEl('rect', { x: x(res.lit.bandLoMs), y: T - 4, width: Math.max(1, x(res.lit.bandHiMs) - x(res.lit.bandLoMs)), height: H - T - 28, fill: 'rgba(230,237,246,.06)' });
    for (const t of niceTicks(max, 5)) {
      s += svgEl('line', { x1: x(t), x2: x(t), y1: T, y2: H - 30, stroke: GRIDC, 'stroke-width': 1 });
      s += svgEl('text', { x: x(t), y: H - 12, fill: MUT, 'font-size': 10, 'text-anchor': 'middle', 'font-family': MONO }, t.toFixed(0));
    }
    s += svgEl('line', { x1: x(BAR_MS), x2: x(BAR_MS), y1: T - 6, y2: H - 30, stroke: FLAG, 'stroke-width': 1, 'stroke-dasharray': '2 4' });
    s += svgEl('text', { x: x(BAR_MS), y: T - 9, fill: FLAG, 'font-size': 9, 'text-anchor': 'middle', 'font-family': MONO }, 'bar ' + BAR_MS);
    s += svgEl('text', { x: x(max), y: H - 12, fill: DIM, 'font-size': 9, 'text-anchor': 'end', 'font-family': MONO, dy: 12 }, 'sd (ms)');
    keys.forEach((k, i) => {
      const cy = T + rowH * i + rowH / 2,
        Lg = legRow(res, k),
        B = Lg.budget,
        col = LEG[k].col;
      s += svgEl('text', { x: 8, y: cy - 4, fill: col, 'font-size': 11, 'font-weight': 700, 'font-family': 'inherit' }, LEG[k].label);
      s += svgEl('text', { x: 8, y: cy + 11, fill: MUT, 'font-size': 10, 'font-family': 'inherit' }, B.published ? 'ECG → PPG budget' : 'sampling floor only');
      if (Lg.sigmaSd == null) {
        s += svgEl('text', { x: x(max / 2), y: cy + 5, fill: FLAG, 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': MONO }, '—');
        return;
      }
      const known = Math.sqrt((B.samp || 0) ** 2 + (B.resp || 0) ** 2 + (B.fid || 0) ** 2);
      s += svgEl('rect', { x: x(0), y: cy - 9, width: Math.max(1, x(Lg.sigmaSd) - x(0)), height: 18, rx: 4, fill: 'rgba(' + hexRgb(col) + ',.16)', stroke: col, 'stroke-width': 1 });
      s += svgEl('rect', { x: x(0), y: cy - 9, width: Math.max(1, x(Math.min(known, Lg.sigmaSd)) - x(0)), height: 18, rx: 4, fill: 'rgba(' + hexRgb(col) + ',.55)' });
      /* The components as ticks along the bar — in quadrature, so they do NOT sum to it. Two terms can
         land on the same millisecond (on this corpus the H10→Verity sampling floor is 5.69 ms and the
         published fiducial RMSE is 5.69 ms, to the pixel), so ticks closer than the label width MERGE
         into one rather than overprinting each other into an unreadable smear. */
      const ticks = [
        ['sampling', B.samp],
        ['resp', B.resp],
        ['fiducial', B.fid]
      ].filter((t) => t[1] != null);
      const merged = [];
      for (const t of ticks) {
        const near = merged.find((g) => Math.abs(x(g.v) - x(t[1])) < 34);
        if (near) near.names.push(t[0] + ' ' + f1(t[1]));
        else merged.push({ v: t[1], names: [t[0] + ' ' + f1(t[1])] });
      }
      merged.forEach((g, j) => {
        s += svgEl('line', { x1: x(g.v), x2: x(g.v), y1: cy + 11, y2: cy + 16, stroke: MUT, 'stroke-width': 1 });
        g.names.forEach((nm, r) => {
          s += svgEl('text', { x: x(g.v), y: cy + 25 + (j % 2) * 9 + r * 9, fill: MUT, 'font-size': 8.5, 'text-anchor': 'middle', 'font-family': MONO }, nm);
        });
      });
      s += svgEl(
        'text',
        { x: x(Lg.sigmaSd) + 6, y: cy + 4, fill: '#e6edf6', 'font-size': 11, 'font-weight': 700, 'font-family': MONO },
        f1(Lg.sigmaSd) + (B.unexplained != null ? ' · unexplained ' + f1(B.unexplained) : '')
      );
    });
    host.innerHTML = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'per-leg PAT scatter against its literature error budget' }, s);
  }
  // FIGURE 5 — the three sites as a triangle: edges carry each leg's median lag ± sd, nodes the hat's σ
  function drawHat(res) {
    const host = $('svg_hat');
    if (!host) return;
    const W = 460,
      H = 290,
      cx = W / 2,
      cy = H / 2 + 22,
      Rr = 100;
    const pos = { h10: [cx, cy - Rr], verity: [cx - Rr * 0.98, cy + Rr * 0.62], ring: [cx + Rr * 0.98, cy + Rr * 0.62] };
    let s = '';
    for (const k of LKEYS) {
      const Lg = legRow(res, k),
        a = pos[LEG[k].from],
        b = pos[LEG[k].to];
      s += svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: Lg ? 'rgba(230,237,246,.5)' : MUT, 'stroke-width': Lg ? 2.5 : 1, 'stroke-dasharray': Lg ? '0' : '5 5' });
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2;
      s += svgEl('rect', { x: mx - 46, y: my - 10, width: 92, height: 18, rx: 9, fill: '#0f141b' });
      s += svgEl(
        'text',
        { x: mx, y: my + 4, fill: Lg ? LEG[k].col : FLAG, 'font-size': 10, 'text-anchor': 'middle', 'font-family': MONO },
        Lg ? f0(Lg.medLag) + ' ± ' + f1(Lg.sigmaSd) + ' ms' : 'no leg'
      );
    }
    const Hh = res.hat;
    for (const k of SITES) {
      const p = pos[k],
        present = res.present.indexOf(k) >= 0,
        sig = Hh ? Hh[k] : null;
      s += svgEl('circle', {
        cx: p[0],
        cy: p[1],
        r: 23,
        fill: present ? DEV[k].col : '#1a2230',
        stroke: Hh && sig == null ? FLAG : 'none',
        'stroke-width': 2,
        'stroke-dasharray': Hh && sig == null ? '4 3' : '0'
      });
      s += svgEl('text', { x: p[0], y: p[1] + 4, fill: present ? '#0b0f14' : MUT, 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': MONO }, DEV[k].name.split(' ')[0]);
      s += svgEl(
        'text',
        { x: p[0], y: p[1] + (k === 'h10' ? -28 : 38), fill: Hh && sig == null ? FLAG : MUT, 'font-size': 10, 'text-anchor': 'middle', 'font-family': MONO },
        !present ? 'absent' : !Hh ? 'σ needs 3 sites' : sig == null ? 'σ REFUSED' : 'σ ' + f1(sig) + ' ms'
      );
    }
    host.innerHTML = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'three-site PAT triangle with the hat sigma per site' }, s);
  }
  // ── exports ────────────────────────────────────────────────────────────────
  function dl(name, blob) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  const stamp = () => 'pat-night-' + (RESULT.night || 'night');
  function dlCanvas(id, tag) {
    const c = $(id);
    if (!c || !RESULT.res || RESULT.res.skip) return;
    c.toBlob((b) => b && dl(stamp() + '-' + tag + '.png', b));
  }
  function dlSvg(hostId, tag) {
    const h = $(hostId);
    if (!h || !h.innerHTML) return;
    dl(stamp() + '-' + tag + '.svg', new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + h.innerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }));
  }
  function exportJson() {
    const r = RESULT.res;
    if (!r) return;
    const legs = {};
    if (r.legs)
      for (const k of Object.keys(r.legs)) {
        const L = r.legs[k];
        legs[k] = {
          from: L.from,
          to: L.to,
          band: L.band,
          nWin: L.nWin,
          nPairs: L.nPairs,
          medLag: L.medLag,
          sigmaSd: L.sigmaSd,
          sigmaIqr: L.sigmaIqr,
          wRatio: L.wRatio,
          repeatShare: L.repeatShare,
          budget: L.budget
        };
      }
    const out = {
      tool: 'pat-night',
      night: RESULT.night,
      placement: placement,
      skip: !!r.skip,
      reason: r.skip ? r.reason || null : null,
      present: r.present || null,
      windows: r.skip ? null : { total: r.nWindows, kept: r.nKept, minutes: r.winMin },
      legs: r.skip ? null : legs,
      hat: r.skip ? null : r.hat,
      hatIqr: r.skip ? null : r.hatIqr,
      closure: r.skip ? null : { ms: r.closureMs, vacuous: true, note: 'both paths pick the same beat — an identity, not evidence' },
      axis: r.axis || null,
      fs: r.fs || null,
      gateBarMs: BAR_MS,
      reference: { literature: r.lit || null, note: 'validation references, not inputs (LITERATURE-USE-POLICY §2); the median lag is sign and context, never an absolute PAT (PAT-COMPENDIUM ⛔)' }
    };
    dl(stamp() + '.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  }
  // ── wiring ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const onPick = (e) => {
      const list = e.target.files;
      if (list && list.length) ingestFiles(list);
      e.target.value = '';
    };
    if ($('folderInput')) $('folderInput').addEventListener('change', onPick);
    if ($('fileInput')) $('fileInput').addEventListener('change', onPick);
    const drop = $('dropCard');
    if (drop) {
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('ts-over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('ts-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('ts-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files);
      });
    }
    const nav = $('nightNav');
    if (nav)
      nav.addEventListener('click', (e) => {
        const it = e.target.closest && e.target.closest('.sb-item[data-k]');
        if (!it || it.classList.contains('ts-dim')) return;
        SELECTED = it.getAttribute('data-k');
        renderNightNav();
        if (!RUNNING) solve(NIGHTS[SELECTED]);
      });
    if ($('procBtn'))
      $('procBtn').addEventListener('click', () => {
        if (RUNNING) return; // the monitor presses this once the button enables; a run in flight is the answer
        const nt = SELECTED && NIGHTS[SELECTED];
        if (!nt || !eligible(nt)) {
          setStatus('idle', 'pick an eligible night first');
          return;
        }
        solve(nt);
      });
    const sel = $('placement');
    if (sel)
      sel.addEventListener('change', () => {
        placement = PLACEMENT[sel.value] ? sel.value : 'arm';
        const vl = $('verityKind');
        if (vl) vl.textContent = PLACEMENT[placement].verity + ' PPG';
        if (RESULT.res && !RESULT.res.skip && NIGHTS[RESULT.night]) renderAll(NIGHTS[RESULT.night], RESULT.res);
        else {
          const pl = $('placementNote');
          if (pl) pl.textContent = 'Verity on the ' + PLACEMENT[placement].verity + ' — ' + PLACEMENT[placement].why + '.';
        }
      });
    const bind = (id, fn) => {
      if ($(id)) $(id).addEventListener('click', fn);
    };
    bind('dlLag', () => dlCanvas('ch_lag', 'lag'));
    bind('dlSd', () => dlCanvas('ch_sd', 'sd'));
    bind('dlHist', () => dlCanvas('ch_hist', 'hist'));
    bind('dlBudget', () => dlSvg('svg_budget', 'budget'));
    bind('dlHat', () => dlSvg('svg_hat', 'hat'));
    bind('dlJson', exportJson);
    setStatus('idle', 'waiting for a night');
  });
})();
