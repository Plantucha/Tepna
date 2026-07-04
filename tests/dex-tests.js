/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   tests/dex-tests.js — Tepna shared assertion library
   ────────────────────────────────────────────────────────────────────────
   ONE set of assertions, TWO runners:
     · Node  → tests/run-tests.mjs   (CI gate, `node tests/run-tests.mjs`)
     · Browser → Dex-Test-Suite.html (interactive + render-coverage)

   Pure & headless-safe. The runner does ALL I/O and passes a ready `env`:

     env = {
       MetricRegistry, CrossNightEnvelope, ECGCross,   // loaded modules
       parseTimestamp, adaptEnvelopeNode, recWindow,
       overlapInterval, fuseHRVConsensus,
       sources:  { 'pulsedex-dsp.js': '<source text>', ... },   // for static checks
       fixtures: { ecgdex:{...}, oxydex:[...], events:{...} }    // parsed real exports
     }

   Returns { groups: [ { title, tag, tests:[ {name,pass,detail} ] } ] }.
   No DOM here — render-coverage lives in the HTML harness (browser-only).
   ════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* ── Section filter (SECTION-SCOPED-RUNS 2026-07-01) ────────────────────────
   ONE matcher, shared by all three runners (Node CLI, browser headless, browser
   render-coverage rig selection) AND verify-provenance's bundle scope, so a
   `--group=oxydex` / `?group=oxydex` means the SAME thing everywhere. Semantics:
   comma-separated terms (OR); each term is case-insensitive, tried as a RegExp
   and falling back to a literal substring if it isn't a valid pattern; a group
   matches when ANY term hits its title OR its tag. A null/empty filter matches
   everything (the DEFAULT — an unfiltered run is byte-for-byte the canonical
   gate, unchanged). A filtered run is NEVER the canonical pass; each runner
   marks it loudly so a scoped green can't be mistaken for the full gate. */
function dexGroupMatcher(filter) {
  if (filter == null) return function () { return true; };
  var terms = String(filter).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!terms.length) return function () { return true; };
  var tests = terms.map(function (t) {
    var rx = null; try { rx = new RegExp(t, 'i'); } catch (_) { rx = null; }
    var lc = t.toLowerCase();
    return function (s) { s = String(s == null ? '' : s); return rx ? rx.test(s) : s.toLowerCase().indexOf(lc) >= 0; };
  });
  return function (title, tag) {
    for (var i = 0; i < tests.length; i++) { if (tests[i](title) || tests[i](tag)) return true; }
    return false;
  };
}

function runDexTests(env) {
  env = env || {};
  var GROUPS = [];
  var U = function (y, mo, d, h, mi, s, ms) { return Date.UTC(y, mo, d, h || 0, mi || 0, s || 0, ms || 0); };

  function group(title, tag, fn) {
    var G = { title: title, tag: tag, tests: [] };
    var T = {
      ok: function (name, cond, detail) { G.tests.push({ name: name, pass: !!cond, detail: detail == null ? '' : String(detail) }); },
      eq: function (name, got, want, detail) {
        var pass = JSON.stringify(got) === JSON.stringify(want);
        G.tests.push({ name: name, pass: pass, detail: pass ? (detail || '') : ('got ' + JSON.stringify(got) + ' · want ' + JSON.stringify(want)) });
      },
      approx: function (name, got, want, tol, detail) {
        var pass = (got != null && isFinite(got) && Math.abs(got - want) <= (tol == null ? 1e-6 : tol));
        G.tests.push({ name: name, pass: pass, detail: pass ? (detail || ('' + got)) : ('got ' + got + ' · want ≈' + want) });
      },
      // Environmental SKIP — counted as NEITHER pass nor fail (mirrors Dex-Test-Suite.html's
      // render-coverage addSkip/⊘ convention, DEX-TEST-DETERMINISM 2026-07-01). Use only when a
      // precondition outside the code's control is unmet (e.g. a gitignored uploads/ input absent
      // on a fresh CI clone) — never for a real regression, which must still fail via T.ok.
      skip: function (name, detail) { G.tests.push({ name: name, pass: false, skip: true, detail: detail == null ? '' : String(detail) }); }
    };
    try { fn(T); } catch (e) { G.tests.push({ name: 'group threw: ' + e.message, pass: false, detail: (e.stack || '').split('\n')[1] || '' }); }
    GROUPS.push(G);
  }

  /* ════ 1 · CLOCK CONTRACT — parseTimestamp ════ */
  group('Clock Contract — parseTimestamp', 'live mirror', function (T) {
    var P = env.parseTimestamp;
    T.ok('parseTimestamp present', typeof P === 'function');
    if (typeof P !== 'function') return;
    var a = P('2026-06-07T22:00:00.123', {});
    T.eq('ms-fraction no-zone → tMs preserves ms', a && a.tMs, U(2026, 5, 7, 22, 0, 0, 123));
    T.eq('ms-fraction no-zone → offsetMin null', a && a.offsetMin, null);
    var b = P('2026-06-07T22:00:00.500+02:00', {});
    T.eq('ms-fraction zoned → tMs', b && b.tMs, U(2026, 5, 7, 22, 0, 0, 500));
    T.eq('ms-fraction zoned → offsetMin +120', b && b.offsetMin, 120);
    T.eq('zoned Z → offsetMin 0', (P('2026-06-07T22:00:00Z', {}) || {}).offsetMin, 0);
    T.eq('plain "YYYY-MM-DD HH:MM:SS"', (P('2026-06-07 22:00:00', {}) || {}).tMs, U(2026, 5, 7, 22, 0, 0));
    T.eq('no seconds "HH:MM"', (P('2026-06-07 22:00', {}) || {}).tMs, U(2026, 5, 7, 22, 0));
    T.eq('DMY (preferDMY) 13/05/2026', (P('13/05/2026 08:30', { preferDMY: true }) || {}).tMs, U(2026, 4, 13, 8, 30));
    T.eq('MDY (preferDMY false) 05/13/2026', (P('05/13/2026 08:30', { preferDMY: false }) || {}).tMs, U(2026, 4, 13, 8, 30));
    T.eq('O2Ring "HH:MM:SS DD/MM/YYYY"', (P('22:00:00 07/06/2026', { preferDMY: true }) || {}).tMs, U(2026, 5, 7, 22, 0, 0));
    var anchor = U(2026, 5, 7);
    var t1 = P('23:30', { dateAnchorMs: anchor, prevTMs: null });
    T.eq('time-only 23:30 + anchor', t1 && t1.tMs, U(2026, 5, 7, 23, 30));
    var t2 = P('00:15', { dateAnchorMs: anchor, prevTMs: t1 && t1.tMs });
    T.eq('time-only 00:15 rolls to next day', t2 && t2.tMs, U(2026, 5, 8, 0, 15));
    T.eq('garbage → null', P('not a date', {}), null);
    T.eq('empty → null', P('', {}), null);
    T.ok('floating tMs via Date.UTC (TZ-independent)', (P('2026-06-07 03:00', {}) || {}).tMs === U(2026, 5, 7, 3, 0));
  });

  /* ════ 2 · CROSS-NIGHT SIGNIFICANCE (#1 boundary fix) ════ */
  group('Cross-night significance — CI-includes-0 (#1)', 'crossnight-envelope', function (T) {
    var newRule = function (ci) { return (ci[0] > 0 || ci[1] < 0); };
    var oldRule = function (ci) { return (ci[0] > 0) === (ci[1] > 0); };
    T.ok('CI touching 0 [-0.3,0] → NOT significant (was true)', newRule([-0.3, 0]) === false && oldRule([-0.3, 0]) === true);
    T.ok('CI [0,0.4] (includes 0) → not significant', newRule([0, 0.4]) === false);
    T.ok('CI [0.2,0.9] entirely + → significant', newRule([0.2, 0.9]) === true);
    T.ok('CI [-0.9,-0.2] entirely − → significant', newRule([-0.9, -0.2]) === true);
    var CNE = env.CrossNightEnvelope, CC = env.ECGCross;
    if (!(CNE && CNE.build && CC && CC.crossNight)) { T.ok('build + crossNight present', false); return; }
    var defn = [{ id: 'm', label: 'M', unit: '', goodDirection: 'up', get: function (it) { return it.v; } }];
    var mkItems = function (vals) { return vals.map(function (v, i) { return { t0Ms: U(2026, 4, 1 + i), v: v }; }); };
    var flat = CNE.build({ node: 'TEST', unit: 'night', items: mkItems([50, 51, 49, 50, 50, 51, 49, 50]), metrics: defn, crossNight: CC.crossNight });
    T.eq('flat 8-night series → significant=false', flat.metrics.m.change && flat.metrics.m.change.significant, false);
    var rising = CNE.build({ node: 'TEST', unit: 'night', items: mkItems([40, 43, 47, 52, 58, 63, 69, 75]), metrics: defn, crossNight: CC.crossNight });
    T.ok('strong monotone rise → significant=true', rising.metrics.m.change && rising.metrics.m.change.significant === true);
  });

  /* ════ 3 · CROSS-NIGHT BASELINE mean/sd (#7) ════ */
  group('Cross-night baseline mean/sd published (#7)', 'ecgdex-cross · crossnight-envelope', function (T) {
    var CC = env.ECGCross, CNE = env.CrossNightEnvelope;
    if (!(CC && CC.crossNight)) { T.ok('ECGCross.crossNight present', false); return; }
    var ser = [50, 51, 49, 50, 50, 51, 49, 50].map(function (v, i) { return { x: i, t: U(2026, 4, 1 + i), v: v, w: 1 }; });
    var st = CC.crossNight(ser, { good: 'up' });
    T.ok('crossNight returns baselineMean', st.baselineMean != null, 'baselineMean=' + st.baselineMean);
    T.ok('crossNight returns baselineSd', st.baselineSd != null, 'baselineSd=' + st.baselineSd);
    if (st.baselineMean != null && st.baselineSd) T.approx('zLatest reconstructs from published baseline', st.zLatest, (50 - st.baselineMean) / st.baselineSd, 0.06);
    if (CNE && CNE.build) {
      var env2 = CNE.build({ node: 'TEST', unit: 'night', items: [50, 51, 49, 50, 50, 51, 49, 50].map(function (v, i) { return { t0Ms: U(2026, 4, 1 + i), v: v }; }), metrics: [{ id: 'm', label: 'M', unit: '', goodDirection: 'up', get: function (it) { return it.v; } }], crossNight: CC.crossNight });
      T.ok('envelope baseline.mean not null', env2.metrics.m.baseline && env2.metrics.m.baseline.mean != null);
    }
  });

  /* ════ 4 · INTEGRATOR window honors durationMin (#2/#3) ════ */
  group('Integrator window — sparse-event collapse (#2/#3)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, RW = env.recWindow, OV = env.overlapInterval;
    T.ok('adaptEnvelopeNode present', typeof A === 'function');
    if (typeof A !== 'function') return;
    var node = function (j) { return A(j, j.schema.node, 'test.json')[0]; };
    var t0 = U(2026, 5, 7, 8, 30, 0);
    var pulse = node({ schema: { node: 'PulseDex' }, recording: { startEpochMs: t0, durationMin: 5, coveragePct: 96 }, hrv: { time: { rmssd: 42, sdnn: 55 } }, ganglior_events: [{ t: '08:30:05', tMs: t0 + 5000, impulse: 'w', node: 'PulseDex', conf: .9 }] });
    T.eq('endMs honors recording.durationMin (not last event)', pulse.endMs, t0 + 5 * 60000);
    T.eq('window span = 5 min (not ~0.08)', (RW(pulse).endMs - RW(pulse).startMs) / 60000, 5);
    var ecg = node({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0 - 3600000, durationMin: 120 }, quality: { analyzablePct: 95 }, hrv: { time: { rmssd: 40, sdnn: 58 } }, ganglior_events: [{ t: '07:30:10', tMs: t0 - 3600000 + 10000, impulse: 's', node: 'ECGDex', conf: .8 }] });
    var ov = OV(pulse, ecg);
    T.ok('sparse PulseDex now overlaps spanning ECG (not excluded)', !!ov && ov.overlapMin === 5, ov && ('overlapMin=' + ov.overlapMin));
  });

  /* ════ 5 · INTEGRATOR HRV consensus quality gate (#5) ════ */
  group('Integrator HRV consensus — quality gate (#5)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, FC = env.fuseHRVConsensus;
    if (typeof A !== 'function' || typeof FC !== 'function') { T.ok('fuseHRVConsensus present', false); return; }
    var t0 = U(2026, 5, 7, 8, 30, 0);
    var mk = function (node, rm, sd, q) { return A({ schema: { node: node }, recording: { startEpochMs: t0, durationMin: 120 }, quality: { analyzablePct: q }, hrv: { time: { rmssd: rm, sdnn: sd } }, ganglior_events: [{ t: '08:30:10', tMs: t0 + 10000, impulse: 'x', node: node, conf: .8 }] }, node, 'test.json')[0]; };
    var cons = FC([mk('ECGDex', 40, 58, 95), mk('HRVDex', 44, 60, 90), mk('PpgDex', 120, 160, 22)], 1000);
    var blk = cons && cons.blocks && cons.blocks[0];
    T.ok('consensus produced', !!blk);
    if (!blk) return;
    T.eq('trashed 22% PpgDex excluded', blk.lowQualityExcluded, ['PpgDex (22%)']);
    T.eq('surviving nodes = ECGDex + HRVDex', blk.nodes.slice().sort(), ['ECGDex', 'HRVDex']);
    T.ok('verdict agreement (not false divergent)', blk.qc === 'agreement', 'divergence ' + blk.divergencePct + '%');
  });

  /* ════ 5b · INTEGRATOR HRV consensus — self-reported lowConfidence + 3-LED agreement gate (FU §2) ════
     PPGDEX-BEAT-DETECTION-PERF-FOLLOWUPS §2 — PpgDex now EMITS hrv.time.lowConfidence (§3 coverage
     gate) + quality.ledAgreementPct (§5). This proves the Integrator CONSUMES them: a PPG night that
     CLEARS the analyzablePct floor but self-reports lowConfidence (or has too-low 3-LED agreement) is
     excluded from the HRV consensus, exactly like a sub-QFLOOR night; a clean PPG stays (gate inert). */
  group('Integrator HRV consensus — lowConfidence + LED-agreement gate (FU §2)', 'integrator-dsp · FU', function (T) {
    var A = env.adaptEnvelopeNode, FC = env.fuseHRVConsensus;
    if (typeof A !== 'function' || typeof FC !== 'function') { T.ok('fuseHRVConsensus present', false); return; }
    var t0 = U(2026, 5, 7, 8, 30, 0);
    var mk2 = function (node, rm, sd, q, opts) { opts = opts || {};
      var time = { rmssd: rm, sdnn: sd }; if (opts.lowConfidence) time.lowConfidence = true;
      var quality = { analyzablePct: q }; if (opts.led != null) quality.ledAgreementPct = opts.led;
      return A({ schema: { node: node }, recording: { startEpochMs: t0, durationMin: 120 }, quality: quality, hrv: { time: time }, ganglior_events: [{ t: '08:30:10', tMs: t0 + 10000, impulse: 'x', node: node, conf: .8 }] }, node, 'test.json')[0]; };
    // (a) lowConfidence PPG that CLEARS the analyzablePct floor (95%) is still excluded.
    var consA = FC([mk2('ECGDex', 40, 58, 95), mk2('HRVDex', 44, 60, 90), mk2('PpgDex', 130, 160, 95, { lowConfidence: true })], 1000);
    var blkA = consA && consA.blocks && consA.blocks[0];
    T.ok('consensus produced (a)', !!blkA);
    if (blkA) {
      T.eq('lowConfidence PPG excluded despite 95% analyzable', blkA.lowQualityExcluded, ['PpgDex (lowConfidence)']);
      T.eq('surviving nodes = ECGDex + HRVDex', blkA.nodes.slice().sort(), ['ECGDex', 'HRVDex']);
    }
    // (b) low 3-LED agreement (below the optical-consensus floor) is excluded too.
    var consB = FC([mk2('ECGDex', 40, 58, 95), mk2('HRVDex', 44, 60, 90), mk2('PpgDex', 130, 160, 95, { led: 20 })], 1000);
    var blkB = consB && consB.blocks && consB.blocks[0];
    if (blkB) T.eq('low-LED-agreement PPG excluded', blkB.lowQualityExcluded, ['PpgDex (LED 20%)']);
    // (c) a CLEAN PPG (high analyzable, no lowConfidence, high LED) is KEPT — gate inert on good data.
    var consC = FC([mk2('ECGDex', 40, 58, 95), mk2('PpgDex', 42, 60, 95, { led: 95 })], 1000);
    var blkC = consC && consC.blocks && consC.blocks[0];
    if (blkC) T.ok('clean PPG stays in consensus (gate inert on good data)', (blkC.nodes || []).indexOf('PpgDex') >= 0, 'nodes=' + (blkC.nodes || []).join(','));
  });

  /* ════ 5c · INTEGRATOR three-cornered-hat — reference-free per-sensor error ════
     Known-answer: inject KNOWN per-sensor noise into a shared latent series and
     recover each sensor's σ² from the 3 pairwise-difference variances (Gray–Allan).
     Truth cancels in every difference, so recovery depends only on injected noise.
     Also: external-ρ correlated solve, inverse-variance weights, culprit, degrade,
     epoch alignment. (INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF §1–§3.) */
  group('Integrator three-cornered-hat — per-sensor error (TCH)', 'integrator-tch', function (T) {
    var K = env.IntegratorTCH;
    T.ok('IntegratorTCH present', !!(K && K.threeCorneredHat), 'load integrator-tch.js + wire env.IntegratorTCH in both runners');
    if (!(K && K.threeCorneredHat)) return;
    function rng(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    function normals(seed,n){ var r=rng(seed),o=[]; for(var i=0;i<n;i+=2){ var u1=Math.max(r(),1e-12),u2=r(),m=Math.sqrt(-2*Math.log(u1)); o.push(m*Math.cos(2*Math.PI*u2)); o.push(m*Math.sin(2*Math.PI*u2)); } return o.slice(0,n); }
    function rel(a,b){ return Math.abs(a-b)/Math.abs(b); }
    var N=6000;
    var truth=(function(){ var w=normals(1,N),v=[],acc=60; for(var i=0;i<N;i++){acc+=w[i]*0.8; v.push(acc);} return v; })();

    // (1) INDEPENDENT noise → classic recovers injected σ² = {4,9,25}
    (function(){
      var nE=normals(11,N),nP=normals(22,N),nO=normals(33,N),A=[],B=[],C=[];
      for(var i=0;i<N;i++){ A.push(truth[i]+2*nE[i]); B.push(truth[i]+3*nP[i]); C.push(truth[i]+5*nO[i]); }
      var r=K.threeCorneredHat(A,B,C,{labels:['ECG','PPG','Oxy']});
      T.ok('independent: ok + classic (rho=0)', r.ok && r.method==='classic', 'method='+r.method);
      T.ok('recover σ²(ECG)=4 within 20%', rel(r.sigma2.ECG,4)<0.20, r.sigma2.ECG.toFixed(2));
      T.ok('recover σ²(PPG)=9 within 20%', rel(r.sigma2.PPG,9)<0.20, r.sigma2.PPG.toFixed(2));
      T.ok('recover σ²(Oxy)=25 within 20%', rel(r.sigma2.Oxy,25)<0.20, r.sigma2.Oxy.toFixed(2));
      T.eq('culprit = noisiest (Oxy)', r.culprit, 'Oxy');
      T.ok('inverse-variance weights ordered ECG>PPG>Oxy', r.weights.ECG>r.weights.PPG && r.weights.PPG>r.weights.Oxy);
      T.ok('weights sum to 1', Math.abs(r.weights.ECG+r.weights.PPG+r.weights.Oxy-1)<1e-9);
    })();

    // (1b) REGULARIZED weights — a spuriously near-zero σ² (sampling noise at short
    //      records) must NOT capture ~all the inverse-variance weight.
    (function(){
      var w = K.inverseVarianceWeights({A:100, B:0.0001, C:100});
      T.ok('inverse-variance weight floored (no single-σ² domination)', w.B < 0.9 && w.B > w.A, 'wB='+w.B.toFixed(3));
      var w2 = K.inverseVarianceWeights({A:4, B:9, C:25});   // well-separated, none tiny → floor inert
      T.ok('floor inert when variances well-separated', w2.A>w2.B && w2.B>w2.C, JSON.stringify({A:+w2.A.toFixed(3),C:+w2.C.toFixed(3)}));
    })();

    // (2) POSITIVE COMMON-MODE (ρ0=0.75) biases classic but stays non-negative;
    //     supplying the external ρ recovers injected σ² = {1,16,16}.
    (function(){
      var rho0=0.75, kc=Math.sqrt(rho0), ki=Math.sqrt(1-rho0);
      var g=normals(101,N),eE=normals(111,N),eP=normals(122,N),eO=normals(133,N),A=[],B=[],C=[];
      for(var i=0;i<N;i++){
        A.push(truth[i]+1*(kc*g[i]+ki*eE[i]));
        B.push(truth[i]+4*(kc*g[i]+ki*eP[i]));
        C.push(truth[i]+4*(kc*g[i]+ki*eO[i]));
      }
      var naive=K.threeCorneredHat(A,B,C,{labels:['ECG','PPG','Oxy']});
      T.ok('positive common-mode stays non-negative (classic, biased)', naive.method==='classic');
      var r=K.threeCorneredHat(A,B,C,{labels:['ECG','PPG','Oxy'], rho:rho0});
      T.ok('external-ρ: correlated solver engages', r.ok && r.method==='correlated-external', 'method='+r.method);
      T.ok('external-ρ recover σ²(ECG)=1 within 40%', rel(r.sigma2.ECG,1)<0.40, r.sigma2.ECG.toFixed(2));
      T.ok('external-ρ recover σ²(PPG)=16 within 25%', rel(r.sigma2.PPG,16)<0.25, r.sigma2.PPG.toFixed(2));
    })();

    // (3) DEGRADE — insufficient overlap → ok:false (never throws)
    var d=K.threeCorneredHat([1,2,3],[1,2,3],[1,2,3],{minN:12});
    T.ok('degrade: n<minN → ok:false', d.ok===false && /overlap/.test(d.reason||''), d.reason);

    // (4) alignTriplet keeps only common epoch keys, ascending
    var al=K.alignTriplet([{tMin:0,v:10},{tMin:5,v:11},{tMin:10,v:12}],[{tMin:5,v:20},{tMin:10,v:21}],[{tMin:5,v:30},{tMin:10,v:31},{tMin:15,v:9}],{});
    T.eq('alignTriplet common keys', al.keys, [5,10]);
    T.eq('alignTriplet maps values', al.A, [11,12]);

    // (5) Allan deviation vs τ (§3) — known-answer single-series primitive.
    (function(){
      T.ok('allanDeviation present', typeof K.allanDeviation==='function');
      if(typeof K.allanDeviation!=='function') return;
      var c=K.allanDeviation([5,5,5,5,5,5,5],[1,2]);
      T.ok('constant series → AVAR 0', c[0].avar===0 && c[1].avar===0, JSON.stringify(c.map(function(o){return o.avar;})));
      var ramp=[]; for(var i=0;i<40;i++) ramp.push(2*i);            // slope c=2 → AVAR(1)=c²/2=2
      T.ok('linear ramp → AVAR(1)=c²/2', rel(K.allanDeviation(ramp,[1])[0].avar,2)<1e-9, ''+K.allanDeviation(ramp,[1])[0].avar);
      var alt=[]; for(var i=0;i<40;i++) alt.push(i%2?-3:3);         // ±3 → AVAR(1)=2a²=18
      T.ok('alternating ±a → AVAR(1)=2a²', rel(K.allanDeviation(alt,[1])[0].avar,18)<1e-9, ''+K.allanDeviation(alt,[1])[0].avar);
      var sh=K.allanDeviation([1,2],[4]);
      T.ok('too-short series → null (n=0)', sh[0].avar===null && sh[0].n===0);
    })();

    // (5b) allanTriplet — per-sensor Allan deviation via TCH in the AVAR domain. Truth
    //      cancels in the pairwise differences → white per-sensor noise, so σᵢ(τ=1)²
    //      recovers the injected {4,9,25}; white noise then averages down with τ.
    (function(){
      T.ok('allanTriplet present', typeof K.allanTriplet==='function');
      if(typeof K.allanTriplet!=='function') return;
      var nE=normals(11,N),nP=normals(22,N),nO=normals(33,N),A=[],B=[],C=[];
      for(var i=0;i<N;i++){ A.push(truth[i]+2*nE[i]); B.push(truth[i]+3*nP[i]); C.push(truth[i]+5*nO[i]); }
      var a=K.allanTriplet(A,B,C,{labels:['ECG','PPG','Oxy'],taus:[1,2,4,8]});
      T.ok('allanTriplet returns per-label adev arrays (len 4)', !!(a && a.adev && a.adev.ECG.length===4 && a.adev.Oxy.length===4));
      T.ok('recover σ²(ECG,τ1)=4 within 30%', rel(a.adev.ECG[0]*a.adev.ECG[0],4)<0.30, (a.adev.ECG[0]*a.adev.ECG[0]).toFixed(2));
      T.ok('recover σ²(Oxy,τ1)=25 within 30%', rel(a.adev.Oxy[0]*a.adev.Oxy[0],25)<0.30, (a.adev.Oxy[0]*a.adev.Oxy[0]).toFixed(2));
      T.ok('Oxy noisier than ECG at τ1 and τ8', a.adev.Oxy[0]>a.adev.ECG[0] && a.adev.Oxy[3]>a.adev.ECG[3]);
      T.ok('white noise averages down (ECG τ8 < τ1)', a.adev.ECG[3]<a.adev.ECG[0], JSON.stringify([+a.adev.ECG[0].toFixed(2),+a.adev.ECG[3].toFixed(2)]));
    })();
  });

  /* ════ 5d · INTEGRATOR fuseHRVConsensus → TCH wiring (series-fed, end-to-end) ════
     3 overlapping nodes carrying per-epoch rmssd SERIES (via adaptEnvelopeNode →
     series.hrvEpochs) → fuseHRVConsensus attaches a TCH block naming the noisiest
     node + an inverse-variance reconciled RMSSD. Degrades to tch=null with <3 series,
     leaving the pairwise consensus intact. (INTEGRATOR-THREE-CORNERED-HAT §1 + §3.) */
  group('Integrator HRV consensus — TCH wiring (§3)', 'integrator-dsp · integrator-tch', function (T) {
    var A = env.adaptEnvelopeNode, FC = env.fuseHRVConsensus, K = env.IntegratorTCH;
    if (typeof A !== 'function' || typeof FC !== 'function' || !(K && K.threeCorneredHat)) { T.ok('deps present (adapt+fuse+TCH)', false, 'need adaptEnvelopeNode + fuseHRVConsensus + IntegratorTCH'); return; }
    function rng(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    function normals(seed,n){ var r=rng(seed),o=[]; for(var i=0;i<n;i+=2){ var u1=Math.max(r(),1e-12),u2=r(),m=Math.sqrt(-2*Math.log(u1)); o.push(m*Math.cos(2*Math.PI*u2)); o.push(m*Math.sin(2*Math.PI*u2)); } return o.slice(0,n); }
    var t0 = U(2026, 5, 7, 23, 0, 0), NE = 48;   // 48 × 5-min epochs = 240 min overlap
    var truth = (function(){ var w=normals(1,NE),v=[],acc=42; for(var i=0;i<NE;i++){acc+=w[i]*1.5; v.push(Math.max(acc,8));} return v; })();
    function mk(node, noiseStd, seed){
      var nz=normals(seed,NE), eps=[];
      for(var i=0;i<NE;i++){ eps.push({ tMin:i*5, rmssd:+(truth[i]+noiseStd*nz[i]).toFixed(1), hr:55, motionIndex:0.1 }); }
      var whole = +(eps.reduce(function(a,e){return a+e.rmssd;},0)/NE).toFixed(1);
      return A({ schema:{node:node}, recording:{startEpochMs:t0, durationMin:240}, quality:{analyzablePct:95},
        hrv:{time:{rmssd:whole, sdnn:+(whole*1.3).toFixed(1)}}, timeseries:{epochs:eps},
        ganglior_events:[{t:'23:00:10', tMs:t0+10000, impulse:'x', node:node, conf:.8}] }, node, node+'.json')[0];
    }
    // ECG cleanest, HRV medium, PPG noisiest → TCH culprit must be PpgDex
    var cons = FC([ mk('ECGDex',2,11), mk('HRVDex',5,22), mk('PpgDex',14,33) ], 1000);
    var blk = cons && cons.blocks && cons.blocks[0];
    T.ok('consensus block produced', !!blk);
    if (!blk) return;
    T.ok('TCH attached + ok', !!(blk.tch && blk.tch.ok), 'status=' + blk.tchStatus);
    if (blk.tch && blk.tch.ok) {
      T.eq('TCH names noisiest node (PpgDex) as culprit', blk.tch.culprit, 'PpgDex');
      T.ok('TCH covers 3 nodes over ≥12 epochs', blk.tch.n >= 12 && Object.keys(blk.tch.sigma2).length === 3, 'n=' + blk.tch.n);
      T.ok('σ²(PpgDex) > σ²(ECGDex)', blk.tch.sigma2.PpgDex > blk.tch.sigma2.ECGDex, JSON.stringify({ppg:Math.round(blk.tch.sigma2.PpgDex), ecg:Math.round(blk.tch.sigma2.ECGDex)}));
      T.ok('inverse-variance reconciled RMSSD present', blk.rmssd && blk.rmssd.weightedMean != null, 'wm=' + (blk.rmssd && blk.rmssd.weightedMean));
      T.ok('note calls out the culprit', /PpgDex/.test(blk.note) && /TCH/.test(blk.note));
      // §3 τ-curve rides on the TCH block: per-node Allan-deviation arrays + wall-clock labels.
      T.ok('τ-curve (Allan dev) attached with per-node arrays + labels', !!(blk.tch.allan && blk.tch.allan.adev && blk.tch.allan.adev.PpgDex && blk.tch.allan.tausMin && blk.tch.allan.tausMin.length===4), JSON.stringify(blk.tch.allan&&blk.tch.allan.tausMin));
      T.ok('τ-curve: noisiest node (PpgDex) has higher Allan dev than ECGDex at τ1', (function(){ var ad=blk.tch.allan&&blk.tch.allan.adev; return !!ad && ad.PpgDex[0]!=null && ad.ECGDex[0]!=null && ad.PpgDex[0]>ad.ECGDex[0]; })());
    }
    // DEGRADE — only 2 series-bearing nodes → no TCH, pairwise consensus intact
    var cons2 = FC([ mk('ECGDex',2,11), mk('PpgDex',14,33) ], 1000);
    var blk2 = cons2 && cons2.blocks && cons2.blocks[0];
    T.ok('degrade: <3 series → tch null', !!blk2 && blk2.tch == null, 'status=' + (blk2 && blk2.tchStatus));
    T.ok('degrade: pairwise consensus still produced', !!(blk2 && blk2.rmssd));
  });

  /* ════ 5b · INTEGRATOR periodic-breathing cross-node corroboration (OXYDEX-…-II §2) ════
     PB observed by ≥2 INDEPENDENT signals (OxyDex SpO₂ oscillation · CPAPDex device flow ·
     ECGDex cardiac CVHR) corroborates; a LONE observer surfaces NO fused finding; confidence is
     the tier-weighted noisy-OR (device > CVHR > proxy); runFusion threads the finding +
     buildFusionExport carries the periodicBreathing block (additive, null-tolerant). */
  group('Integrator periodic-breathing corroboration (§2)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, FPB = env.fusePeriodicBreathing, RF = env.runFusion, BFE = env.buildFusionExport;
    if (typeof FPB !== 'function') { T.ok('fusePeriodicBreathing present', false, 'add fusePeriodicBreathing + wire into both runners'); return; }
    var t0 = U(2026, 5, 7, 22, 0, 0);
    var oxy = function () { return A({ schema: { node: 'OxyDex' }, recording: { startEpochMs: t0, durationMin: 480, offsetMin: null },
      ganglior_events: [ { t: '22:30:00', tMs: t0 + 1800000, impulse: 'periodic_breathing', node: 'OxyDex', conf: 0.62, meta: { cycleLen: 52 } },
                         { t: '23:10:00', tMs: t0 + 4200000, impulse: 'periodic_breathing', node: 'OxyDex', conf: 0.58, meta: { cycleLen: 49 } } ] }, 'OxyDex', 'oxy.json'); };
    var cpap = function () { return A({ schema: { node: 'CPAPDex' }, recording: { startEpochMs: t0, durationMin: 480, offsetMin: null, sessions: [{ mode: 'CPAP' }] },
      metrics: { residualAHI: 6, periodicBreathingPct: 18 },
      ganglior_events: [ { t: '22:35:00', tMs: t0 + 2100000, impulse: 'periodic_breathing', node: 'CPAPDex', conf: 0.8, meta: {} } ] }, 'CPAPDex', 'cpap.json'); };
    var ecgCvhr = function (idx) { return A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 480, offsetMin: null },
      apnea: { cvhrIndex: idx }, hrv: { time: { rmssd: 35, sdnn: 50 } },
      ganglior_events: [ { t: '22:40:00', tMs: t0 + 2400000, impulse: 'autonomic_surge', node: 'ECGDex', conf: 0.7 } ] }, 'ECGDex', 'ecg.json'); };

    // (1) two DIRECT observers (OxyDex + CPAPDex) on one night → ONE corroborated block
    var two = FPB(oxy().concat(cpap()));
    T.ok('two-signal corroboration produced exactly one block', !!(two && two.blocks && two.blocks.length === 1));
    if (two && two.blocks && two.blocks[0]) {
      var b = two.blocks[0];
      T.eq('block counts both observer nodes', b.observerNodes.slice().sort(), ['CPAPDex', 'OxyDex']);
      T.ok('block flagged corroborated (≥2 signals)', b.corroborated === true && b.nObservers === 2);
      T.ok('confidence is a noisy-OR in (0, 0.97]', b.conf > 0 && b.conf <= 0.97);
      T.eq('sources carry the right evidence tiers', b.sources.map(function (s) { return s.tier; }).sort().join(','), 'device-scored,experimental');
    }
    // (2) a LONE observer does not corroborate (single-signal PB is never surfaced)
    T.ok('lone OxyDex observer → null (no fused finding)', FPB(oxy()) === null);
    // (3) ECGDex cardiac CVHR is an observer ONLY above the PB_CVHR_MIN floor
    T.ok('OxyDex + elevated-CVHR ECGDex corroborate', !!(FPB(oxy().concat(ecgCvhr(12))) && FPB(oxy().concat(ecgCvhr(12))).blocks.length === 1));
    T.ok('OxyDex + sub-threshold CVHR does NOT corroborate', FPB(oxy().concat(ecgCvhr(2))) === null);
    // (4) runFusion threads a periodic_breathing finding; buildFusionExport carries the block
    if (typeof RF === 'function') {
      var fus = RF(oxy().concat(cpap()), { toleranceSec: 120 });
      var pbFind = (fus.findings || []).filter(function (f) { return f.type === 'periodic_breathing'; });
      T.eq('runFusion surfaces exactly one periodic_breathing finding', pbFind.length, 1);
      T.ok('the PB finding lists ≥2 observer nodes', !!(pbFind[0] && pbFind[0].nodes && pbFind[0].nodes.length >= 2));
      T.ok('fusion.periodicBreathing block present', !!(fus.periodicBreathing && fus.periodicBreathing.blocks));
      if (typeof BFE === 'function') {
        var exp = BFE(oxy().concat(cpap()), fus);
        T.ok('export carries periodicBreathing key (null-tolerant)', 'periodicBreathing' in exp);
        T.ok('export periodicBreathing non-null when corroborated', !!(exp.periodicBreathing && exp.periodicBreathing.blocks.length >= 1));
      }
    }
  });

  /* ════ 6 · METRIC REGISTRY infra (cohesion §2/§3) ════ */
  group('Metric registry — disclosure + evidence (cohesion)', 'metric-registry', function (T) {
    var M = env.MetricRegistry;
    T.ok('MetricRegistry present', !!M);
    if (!M) return;
    T.ok('basic visible in Core', M.visibleAtTier('basic', 'core') === true);
    T.ok('research hidden in Core', M.visibleAtTier('research', 'core') === false);
    T.ok('advanced visible in Advanced', M.visibleAtTier('advanced', 'advanced') === true);
    T.ok('research visible in Research', M.visibleAtTier('research', 'research') === true);
    var badge = M.badge('validated', 'AASM ODI');
    T.ok('badge() emits non-hue ev-validated span', /ev-validated/.test(badge) && /class="ev/.test(badge));
    T.ok('badge title carries cite', /AASM ODI/.test(badge));
    // 'measured' — top of the trust ladder (raw sensor readings). Added 2026-06; part of the contract.
    T.ok('EVIDENCE has measured level', !!(M.EVIDENCE && M.EVIDENCE.measured));
    T.ok('measured ranks above validated', M.EVIDENCE.measured.rank < M.EVIDENCE.validated.rank);
    T.ok('EVIDENCE_ORDER leads with measured', M.EVIDENCE_ORDER && M.EVIDENCE_ORDER[0] === 'measured');
    T.ok('badge(measured) emits its own ev-measured class', /ev-measured/.test(M.badge('measured', 'direct sensor reading')));
    T.ok('legend includes the measured level', /ev-measured/.test(M.legend()));
    T.eq('STORAGE_KEY is the shared suite key', M.STORAGE_KEY, 'dex_depth_tier');
    var prev = M.getTier();
    M.setTier('research'); T.eq('setTier/getTier round-trip', M.getTier(), 'research');
    M.setTier(prev || 'core');
  });

  /* ════ 6b · COHESION SINGLE-SOURCE — evidence badge CSS + grades ════
     Guards the drift class that let the reference guide fall out of sync with
     the engine. The disc VISUALS are now single-sourced: engine
     (MetricRegistry.BADGE_CSS) ≡ doc mirror (dex-badges.css) is asserted ONCE
     below (two files, not four), and every reference guide LINKS dex-badges.css
     rather than inlining a third copy (DEX-EVENT-UNIFY C3), so its discs inherit
     that gated CSS by construction. Per-guide we assert: that the guide carries
     the link; (a) no retired badge vocabulary; (b) every reference metric the
     node's OWN resolver (OxyRegistry.idForLabel) maps MUST carry the same grade
     as its registry. No hand crosswalk. */
  group('Cohesion single-source — evidence badges', 'cohesion-badges', function (T) {
    var M = env.MetricRegistry, docs = env.docs || {};
    var engineCss = M && M.BADGE_CSS, mirrorCss = docs['dex-badges.css'];
    var TIERS = ['measured','validated','emerging','experimental','heuristic'];
    var DISC  = ['background','border','box-shadow','width','height','border-radius'];

    // strip comments → walk `selector { body }` rules → merge the rules that
    // apply to a tier disc (.ev / .ev-corner / .ev-<tier>) → normalized props.
    function discProps(css, tier) {
      if (css == null) return null;
      var clean = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
      var want = { '.ev': 1, '.ev-corner': 1 }; want['.ev-' + tier] = 1;
      var re = /([^{}]+)\{([^{}]*)\}/g, m, props = {};
      while ((m = re.exec(clean))) {
        var sels = m[1].split(',').map(function (s) { return s.trim(); });
        if (!sels.some(function (s) { return want[s]; })) continue;
        m[2].split(';').forEach(function (d) {
          var i = d.indexOf(':'); if (i < 0) return;
          var k = d.slice(0, i).trim().toLowerCase();
          var v = d.slice(i + 1).trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',');
          if (k) props[k] = v;
        });
      }
      var out = {}; DISC.forEach(function (k) { if (props[k] != null) out[k] = props[k]; });
      return out;
    }
    var dec = function (s) {
      return String(s).replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
                      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
                      .replace(/<[^>]*>/g, '').trim();
    };

    T.ok('engine exposes BADGE_CSS', !!engineCss, engineCss ? '' : 'MetricRegistry.BADGE_CSS missing');
    T.ok('dex-badges.css provided', mirrorCss != null);
    if (engineCss && mirrorCss) {
      TIERS.forEach(function (tier) {
        var e = discProps(engineCss, tier), mi = discProps(mirrorCss, tier);
        T.ok('ev-' + tier + ' disc parsed (engine + mirror)', !!(e && mi) && Object.keys(e).length >= 3 && Object.keys(mi).length >= 3);
        T.eq('ev-' + tier + ' disc: dex-badges.css ≡ engine', mi, e);
      });
    }

    // Per-node: the reference guide is the CONSUMER that must conform to its
    // node's engine CSS + own registry. Parameterized so every node guide is
    // gated identically (grade join uses the node's OWN idForLabel resolver).
    var NODES = [
      { doc: 'OxyDex Reference.html', reg: env.OXY_REGISTRY, resolver: env.OxyRegistry },
      { doc: 'ECGDex Reference.html', reg: env.ECG_REGISTRY, resolver: env.EcgRegistry },
      { doc: 'PpgDex Reference.html', reg: env.PPG_REGISTRY, resolver: env.PpgRegistry },
      { doc: 'CPAPDex Reference.html', reg: env.CPAP_REGISTRY, resolver: env.CpapRegistry },
      { doc: 'PulseDex Reference.html', reg: env.PULSE_REGISTRY, resolver: env.PulseRegistry },
      { doc: 'HRVDex Reference.html', reg: env.HRV_REGISTRY, resolver: env.HrvRegistry },
      { doc: 'GlucoDex Reference.html', reg: env.GLU_REGISTRY, resolver: env.GlucoRegistry },
      // EEGDex: a GENERATED node (codegen/dex-gen.js + dex-registry-gen.js from ONE manifest).
      // Wired in to prove the manifest→registry→guide single-source: the guide's ev-corner
      // grades, joined via the GENERATED EegRegistry.idForLabel, must equal the GENERATED
      // EEG_REGISTRY. Forward-first — EEGDex is a planned scaffold, not a shipped node.
      { doc: 'EEGDex Reference.html', reg: env.EEG_REGISTRY, resolver: env.EegRegistry }
    ];
    var allowed = { 'ev-corner':1,'ev-measured':1,'ev-validated':1,'ev-emerging':1,'ev-experimental':1,'ev-heuristic':1,'ev-legend':1,'ev-legend-strip':1,'ev-sep':1,'ev-ink':1 };
    NODES.forEach(function (node) {
      var refHtml = docs[node.doc];
      T.ok(node.doc + ' provided', refHtml != null);
      if (!refHtml) return;

      // Disc VISUALS are no longer inlined in the guide — it LINKS dex-badges.css
      // (DEX-EVENT-UNIFY C3), and engine ≡ dex-badges.css is gated above, so the
      // guide's discs equal the engine by construction. Guard that the link is
      // actually present, so a future copy that re-inlines or drops it is caught.
      T.ok(node.doc + ' links dex-badges.css (single visual source)', /<link[^>]+href=["']dex-badges\.css["']/.test(refHtml));

      // (a) no retired vocabulary, all badge classes canonical
      var retired = /title="(Proxy|Composite|Provisionally validated) /.test(refHtml) || /data-ev=|validated-provisional/.test(refHtml);
      T.ok(node.doc + ' uses no retired badge vocabulary', !retired);
      var bad = (refHtml.match(/\bev-[a-z-]+\b/g) || []).filter(function (t) { return !allowed[t]; });
      T.ok(node.doc + ' badge classes are all canonical', bad.length === 0, bad.slice(0, 6).join(', '));

      // (b) every reference card the node's OWN resolver maps MUST carry the
      //     registry's grade. No hand crosswalk.
      var R = node.resolver, REG = node.reg;
      if (R && R.idForLabel && REG) {
        var cards = String(refHtml).split('<div class="mc"').slice(1), matched = 0, mism = [];
        cards.forEach(function (c) {
          var nm = c.match(/class="ma">([^<]+)</), gm = c.match(/ev-corner ev-(measured|validated|emerging|experimental|heuristic)/);
          if (!nm || !gm) return;
          var key = R.idForLabel(dec(nm[1]));
          if (!key || !REG[key]) return;
          matched++;
          if (REG[key].evidence !== gm[1]) mism.push(dec(nm[1]) + ' doc=' + gm[1] + ' reg=' + REG[key].evidence);
        });
        T.ok(node.doc + '↔registry metrics matched', matched >= 10, matched + ' matched (registry-backed cards)');
        T.ok(node.doc + '↔registry grades all agree', mism.length === 0, mism.slice(0, 8).join(' · '));
      } else {
        T.ok(node.doc + ' grade-equivalence inputs present', false, 'resolver / registry not provided');
      }
    });
  });

  /* ════ 7 · ENVELOPE evidence passthrough + integrity ════ */
  group('Envelope evidence + export integrity', 'crossnight-envelope', function (T) {
    var CNE = env.CrossNightEnvelope, CC = env.ECGCross;
    if (!(CNE && CNE.build && CC)) { T.ok('build + crossNight present', false); return; }
    var env3 = CNE.build({ node: 'TEST', unit: 'night', items: [10, 11, 12, 13, 14, 15, 16, 17].map(function (v, i) { return { t0Ms: U(2026, 4, 1 + i), v: v }; }), metrics: [{ id: 'nsi', label: 'NSI', unit: '', goodDirection: 'down', evidence: 'experimental', get: function (it) { return it.v; } }], crossNight: CC.crossNight });
    T.eq('metric def evidence reaches the envelope', env3.metrics.nsi.evidence, 'experimental');
    T.ok('a consumer can badge it identically', !!(env.MetricRegistry && /ev-experimental/.test(env.MetricRegistry.badge(env3.metrics.nsi.evidence, ''))));
    // export INTEGRITY: survives JSON round-trip (catches NaN→null / dropped undefined)
    var round = JSON.parse(JSON.stringify(env3));
    T.ok('survives JSON round-trip', JSON.stringify(round) === JSON.stringify(env3));
    T.ok('validate() passes on the round-tripped export', (CNE.validate(round) || {}).ok === true, (CNE.validate(round).errors || []).join('; '));
    T.ok('no NaN/Infinity anywhere in the envelope', countNonFinite(env3) === 0, countNonFinite(env3) + ' bad numbers');
  });

  /* ════ 7b · NODE-EXPORT structural validator (validateNodeExport) ════ */
  group('Node-export validator — validateNodeExport', 'crossnight-envelope', function (T) {
    var CNE = env.CrossNightEnvelope;
    if (!(CNE && CNE.validateNodeExport)) { T.ok('validateNodeExport present', false); return; }
    var t0 = U(2026, 5, 12);
    var good = { schema: { name: 'ganglior.node-export', node: 'ECGDex', version: '2.0', bus: 'ganglior' },
      recording: { startEpochMs: t0 },
      ganglior_events: [{ tMs: t0 + 1000, t: '00:00:01', impulse: 'autonomic_surge', conf: 0.8 }] };
    var vg = CNE.validateNodeExport(good);
    T.ok('valid export → ok:true', vg.ok === true, (vg.errors || []).join('; '));
    T.eq('valid export → zero errors', (vg.errors || []).length, 0);

    // forward-compatible: an unknown MAJOR schema.version is a WARNING, never an error
    var v3 = JSON.parse(JSON.stringify(good)); v3.schema.version = '3.0';
    var r3 = CNE.validateNodeExport(v3);
    T.ok('unknown major version still ok:true (forward-compatible)', r3.ok === true);
    T.ok('unknown major version raises a warning', (r3.warnings || []).some(function (w) { return /version/i.test(w); }));

    // a malformed event (missing impulse) IS an error, and names the field
    var noImp = JSON.parse(JSON.stringify(good)); delete noImp.ganglior_events[0].impulse;
    var ri = CNE.validateNodeExport(noImp);
    T.ok('event missing impulse → ok:false', ri.ok === false);
    T.ok('error names the missing impulse', (ri.errors || []).some(function (e) { return /impulse/i.test(e); }));

    // wrong schema.name → error
    var badName = JSON.parse(JSON.stringify(good)); badName.schema.name = 'something.else';
    T.ok('wrong schema.name → ok:false', CNE.validateNodeExport(badName).ok === false);

    // missing date placement (no startEpochMs, no event tMs) → WARNING, not error (advisory)
    var noClock = { schema: { name: 'ganglior.node-export', node: 'X' },
      ganglior_events: [{ t: '00:00:01', impulse: 'e' }] };
    var rc = CNE.validateNodeExport(noClock);
    T.ok('no clock placement → still ok (advisory)', rc.ok === true, (rc.errors || []).join('; '));
    T.ok('no clock placement raises a warning', (rc.warnings || []).some(function (w) { return /clock|startEpochMs|tMs/i.test(w); }));

    // an event with absolute tMs but no t string is valid (the contract accepts t OR tMs)
    var tmsOnly = { schema: { name: 'ganglior.node-export', node: 'X' }, recording: { startEpochMs: t0 },
      ganglior_events: [{ tMs: t0 + 5000, impulse: 'e', conf: 0.5 }] };
    T.ok('event with tMs only (no t) → ok', CNE.validateNodeExport(tmsOnly).ok === true);
  });

  /* ════ 8 · EXPORT COMPLETENESS — validate REAL exports (fixtures) ════ */
  group('Export completeness — real exports get all values', 'fixtures', function (T) {
    var fx = env.fixtures || {};
    var any = false;
    Object.keys(fx).forEach(function (key) {
      var json = fx[key];
      if (json == null) { T.ok('fixture "' + key + '" loaded', false, 'missing'); return; }
      any = true;
      validateExport(T, key, json);
    });
    if (!any) T.ok('at least one export fixture provided', false, 'runner passed no fixtures');
  });

  /* ════ 9 · STATIC / MIRROR CONSISTENCY (source text) ════ */
  group('Static checks — mirror consistency & regression guards', 'sources', function (T) {
    var src = env.sources || {};
    var names = Object.keys(src);
    if (!names.length) { T.ok('source files provided', false, 'runner passed no sources'); return; }
    // (a) the significance boundary bug must not reappear in ANY source
    // (b) every full parseTimestamp mirror PRESERVES fractional seconds (#ms fix):
    //     a CAPTURING group right after the escaped dot — \.(\d…) — not the old
    //     dropping form (?:\.\d+)?. Tolerant of canonical / ppgdex / worker variants.
    var msFracRe = /\\{1,2}\.\(\\{0,2}d/;
    var boundaryBug = [];
    names.forEach(function (n) { if (/\(\s*ci\[0\]\s*>\s*0\s*\)\s*===\s*\(\s*ci\[1\]\s*>\s*0\s*\)/.test(src[n])) boundaryBug.push(n); });
    T.ok('no source has the CI-includes-0 boundary bug (#1)', boundaryBug.length === 0, boundaryBug.join(', '));
    // (b) every full parseTimestamp source (clock.js canonical + remaining node-local variants)
    //     PRESERVES fractional seconds (#ms fix)
    var mirrors = names.filter(function (n) { return (/-dsp\.js$/.test(n) || n === 'clock.js') && /function\s+parseTimestamp/.test(src[n]); });
    T.ok('found parseTimestamp sources (clock.js + node-local variants)', mirrors.length >= 2, mirrors.join(', '));
    mirrors.forEach(function (n) {
      if (n.indexOf('glucodex') >= 0) return;   // thin wrapper around _ckParse — skip
      T.ok(n + ' preserves fractional seconds (captures ms)', msFracRe.test(src[n]), 'no capturing \.(\d…) ms-group found');
    });
    // (c) no source fabricates a clock with now() in the parser path
    names.filter(function (n) { return /-dsp\.js$/.test(n); }).forEach(function (n) {
      var bad = /return\s+new Date\(\)\.getTime\(\)|tMs\s*=\s*Date\.now\(\)/.test(src[n]);
      T.ok(n + ' never fabricates now() as a timestamp', !bad);
    });
    // (d) pulsedex-dsp.js lombScargle tracks the GLOBAL spectral peak, not HF-only
    //     (SYNTH-TEXTURE-FOLLOWUPS §1 — a dominant sub-HF oscillation, e.g. the corpus CSR at
    //     ~0.017 Hz, must not be invisible; respRate stays HF-derived for back-compat).
    var pls = src['pulsedex-dsp.js'];
    if (pls) {
      var lsBody = (pls.match(/function\s+lombScargle[\s\S]*?\n\}/) || [''])[0];
      T.ok('pulsedex lombScargle tracks a global peak (gPeakP) below HF', /gPeakP/.test(lsBody) && /peakBelowHF/.test(lsBody));
      T.ok('pulsedex lombScargle still exposes HF-derived respRate (back-compat)', /respRate\s*:/.test(lsBody));
      // (e) pulsedex sampEn carries the defensive O(N²) length cap (SYNTH-TEXTURE-FOLLOWUPS §2)
      T.ok('pulsedex sampEn has a defensive length cap (MAXN)', /function\s+sampEn[\s\S]{0,500}MAXN/.test(pls));
    }
    // (f) SYNTH-TEXTURE-FOLLOWUPS-III §1 — OxyDex computeHREntropy/computeSpO2Entropy bound the O(N²)
    //     match-count with WHOLE-NIGHT DECIMATION (deterministic stride), not a head-slice. The old
    //     `slice(0,cap)` measured only the first ~16 min (settle-in window) and systematically
    //     under-stated full-night irregularity (corpus: head SampEn ≈0.42 vs decimation ≈1.5 for HR).
    //     Cost is still O(cap²); the span is now the entire recording. Guard: stride present, head-slice
    //     gone — i.e. NO `slice(0,USE)`/`slice(0,800)` survives, mirroring pulsedex-dsp.js sampEn.
    var oxy = src['oxydex-dsp.js'];
    if (oxy) {
      var heBody = (oxy.match(/function\s+computeHREntropy[\s\S]*?\n\}\n/) || [''])[0];
      var seBody = (oxy.match(/function\s+computeSpO2Entropy[\s\S]*?\n\}\n/) || [''])[0];
      T.ok('oxydex computeHREntropy bounds O(N²) by whole-night decimation (Math.ceil stride, capped)',
        /stride\s*=\s*Math\.ceil\(\s*n\s*\/\s*CAP\s*\)/.test(heBody) && /CAP\s*=\s*\d+/.test(heBody));
      T.ok('oxydex computeHREntropy no longer head-slices (no `= clean.slice(0,…)` assignment)',
        !/=\s*clean\.slice\(\s*0\s*,/.test(heBody));
      T.ok('oxydex computeSpO2Entropy bounds O(N²) by whole-night decimation (Math.ceil stride, capped)',
        /stride\s*=\s*Math\.ceil\(\s*n\s*\/\s*CAP\s*\)/.test(seBody) && /CAP\s*=\s*\d+/.test(seBody));
      T.ok('oxydex computeSpO2Entropy no longer head-slices (no `= spo2.slice(0,…)` assignment)',
        !/=\s*spo2\.slice\(\s*0\s*,/.test(seBody));
    }
    // (g) SYNTH-TEXTURE-FOLLOWUPS-II §2 — ECG/PPG lombScargle deliberately stay HF-peak-only.
    //     PORTING the PulseDex global-peak/peakBelowHF fields was AUDITED and declined:
    //       · PPGDex lombScargle has NO peak/respRate path at all (band-power only, epoch
    //         respRate:null) → the sub-HF-blindness defect is structurally ABSENT, nothing to port.
    //       · ECGDex tracks its peak only in the HF branch BY DESIGN: its whole-record respRate is a
    //         MEDIAN of per-epoch EDR (decoupled from any single-window HF peak — group 12), and
    //         sub-HF CSR/periodic-breathing is caught by a dedicated apnea-band detector (detectCVHR,
    //         ~0.022–0.05 Hz), NOT by the lombScargle peak. So CSR never "vanishes" the way it could
    //         in PulseDex (which has no such dedicated channel). These guards lock that decision.
    var ecg = src['ecgdex-dsp.js'];
    if (ecg) {
      T.ok('ecgdex lombScargle tracks its peak in the HF branch only (intentional)',
        /else\s*\{\s*hf\+=e;\s*if\(P>peakP\)/.test(ecg));
      T.ok('ecgdex covers sub-HF CSR via a dedicated apnea-band detector (detectCVHR), not lombScargle',
        /function\s+detectCVHR/.test(ecg) && /apnea-band/.test(ecg));
      T.ok('ecgdex whole-record respRate is a per-epoch EDR median (decoupled from single-window peak)',
        /_respMedian/.test(ecg));
    }
    var ppg = src['ppgdex-dsp.js'];
    if (ppg) {
      var pLsBody = (ppg.match(/function\s+lombScargle[\s\S]*?\n\}/) || [''])[0];
      T.ok('ppgdex lombScargle exposes NO respRate/peak path (band-power only → defect absent)',
        pLsBody.length > 0 && !/respRate/.test(pLsBody) && !/peakF|peakHz|peakBelowHF/.test(pLsBody));
    }
  });

  /* ════ 9b · HRVDex RENDER — nullable transparent fields never coerce to 0 / crash (DEEP-AUDIT-FIXES-FOLLOWUPS-II §1) ════
     Finding 1 made the transparent HRV columns (_sdnn/_rmssd/_hr/… numOrNull) NULLABLE. Any render
     consumer using isFinite()/!isNaN() as a "present?" test then leaks: isFinite(null)===true and
     isNaN(null)===false both PASS a null (coerced to 0, or null.toFixed() → throw). Render-layer twin
     of the DSP sdnn7 fix — the two pattern-explorer direct reads, the heatmap's _patPearson (fed RAW
     nullable series), and the table fmt. A genuine 0 must SURVIVE (physiological, e.g. pNN50). */
  group('HRVDex render — nullable fields drop null/NaN but keep a real 0 (FOLLOWUPS-II §1)', 'sources', function (T) {
    var rnd = (env.sources || {})['hrvdex-render.js'];
    if (!rnd) { T.ok('hrvdex-render.js source provided', false, 'runner passed no hrvdex-render.js'); return; }
    // (a) correlation SCATTER filters points with Number.isFinite (drops null/NaN, keeps a real 0)
    T.ok('scatter explorer uses Number.isFinite on both axes (drops null, keeps 0)',
      /filter\(p=>Number\.isFinite\(p\.x\)\s*&&\s*Number\.isFinite\(p\.y\)\)/.test(rnd));
    T.ok('scatter explorer no longer uses global isFinite(p.x) (which passes null as 0)',
      !/filter\(p=>isFinite\(p\.x\)\s*&&\s*isFinite\(p\.y\)\)/.test(rnd));
    // (b) WEEKDAY distribution presence test is typeof-number (drops null/NaN, keeps a real 0)
    T.ok('weekday distribution presence test is typeof-number',
      /const v=r\[key\];\s*if\(!\(typeof v==='number'\s*&&\s*isFinite\(v\)\)\)\s*return;/.test(rnd));
    T.ok('weekday distribution no longer uses bare if(!isFinite(v)) (which passes null)',
      !/const v=r\[key\];\s*if\(!isFinite\(v\)\)\s*return;/.test(rnd));
    // (c) _patPearson guards pair members with Number.isFinite — the heatmap feeds it RAW nullable
    //     series (renderHeatmap: rows.map(r=>r[k])), so global isFinite would bias r via null→0.
    T.ok('_patPearson uses Number.isFinite on pair members (heatmap raw-series safe)',
      /if\(Number\.isFinite\(xs\[i\]\)\s*&&\s*Number\.isFinite\(ys\[i\]\)\)/.test(rnd));
    // (d) numeric table formatters guard null before toFixed → renderTable fmt(_sdnn/_rmssd) can't
    //     hit null.toFixed() (isNaN(null)===false would have crashed). A real 0 still formats.
    var fmtGuards = (rnd.match(/const fmt[0-4]=v=>\(v==null\|\|isNaN\(v\)\)\?/g) || []).length;
    T.eq('all five fmt0–fmt4 helpers guard null before toFixed', fmtGuards, 5);
    // (e) the KPI/hero num() helpers were ALREADY correct (v != null && !isNaN(v)) — locked, unchanged
    T.ok('hero/bench num() helper keeps its correct (v != null && !isNaN(v)) form', /v != null && !isNaN\(v\)/.test(rnd));
  });

  /* ════ 10 · INTEGRATOR DEDUP — stampless duplicates (P1) ════ */
  group('Integrator dedup — stampless duplicates (P1)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, DD = env.dedupeRecs;
    if (typeof A !== 'function' || typeof DD !== 'function') { T.ok('dedupeRecs present', false); return; }
    // a DATE-UNKNOWN export (no startEpochMs) re-loaded as file / file (1) / file (2)
    var stampless = function (fname) {
      return A({ schema: { node: 'PulseDex' }, recording: {}, hrv: { time: { rmssd: 42, sdnn: 55 } },
        ganglior_events: [{ t: '00:00:05', impulse: 'w', node: 'PulseDex', conf: .9 }, { t: '00:05:00', impulse: 'w', node: 'PulseDex', conf: .9 }] }, 'PulseDex', fname)[0];
    };
    var r0 = stampless('rr.txt'), r1 = stampless('rr (1).txt'), r2 = stampless('rr (2).txt');
    T.ok('stampless rec has null t0Ms (precondition)', r0.t0Ms == null);
    var kept = [];
    [r0, r1, r2].forEach(function (r) { DD(kept, [r]).kept.forEach(function (k) { kept.push(k); }); });
    T.eq('3 identical stampless copies collapse to 1', kept.length, 1);
    // a genuinely different stampless recording is NOT merged
    var diff = A({ schema: { node: 'PulseDex' }, recording: {}, hrv: { time: { rmssd: 30, sdnn: 40 } },
      ganglior_events: [{ t: '01:00:00', impulse: 'w', node: 'PulseDex', conf: .9 }, { t: '02:00:00', impulse: 'w', node: 'PulseDex', conf: .9 }, { t: '03:00:00', impulse: 'w', node: 'PulseDex', conf: .9 }] }, 'PulseDex', 'other.txt')[0];
    T.eq('a different stampless recording is kept', DD(kept, [diff]).kept.length, 1);
    // dated ±30 s dedup still works
    var t0 = U(2026, 5, 7, 8, 0, 0);
    var mkDated = function (off, f) { return A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0 + off, durationMin: 60 }, hrv: { time: { rmssd: 40, sdnn: 58 } }, ganglior_events: [{ t: '08:00:10', tMs: t0 + 10000, impulse: 's', node: 'ECGDex', conf: .8 }] }, 'ECGDex', f)[0]; };
    T.eq('dated ±30 s duplicate still collapses', DD([mkDated(0, 'e.json')], [mkDated(15000, 'e (1).json')]).kept.length, 0);
    // EXPORT-IDENTITY-FOLLOWUPS-III §1: dedup on recording.contentId — the strongest signal.
    // adaptEnvelopeNode now carries recording.contentId onto the record; dedupeRecs treats
    // same node + same contentId as a duplicate REGARDLESS of stamp (catches a re-load / cross-stamp
    // dup the ±30 s and stampless-sig heuristics miss), with full back-compat fallback when absent
    // (the dated/stampless cases above carry NO contentId → they exercise the fallback unchanged).
    var mkCid = function (cid, off, f) { return A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0 + off, durationMin: 60, contentId: cid }, hrv: { time: { rmssd: 40, sdnn: 58 } }, ganglior_events: [{ t: '08:00:10', tMs: t0 + off + 10000, impulse: 's', node: 'ECGDex', conf: .8 }] }, 'ECGDex', f)[0]; };
    T.ok('adaptEnvelopeNode carries recording.contentId onto the record', mkCid('abc123abc123', 0, 'c.json').contentId === 'abc123abc123');
    T.eq('same contentId dedups across a >30 s stamp gap (cross-stamp re-load)', DD([mkCid('abc123abc123', 0, 'c.json')], [mkCid('abc123abc123', 60000, 'c (1).json')]).kept.length, 0);
    T.eq('different contentId at the same stamp is KEPT (not merged by the ±30 s rule)', DD([mkCid('abc123abc123', 0, 'c.json')], [mkCid('dddddddddddd', 0, 'd.json')]).kept.length, 1);
  });

  /* ════ 11 · NUMERICAL SAFETY — zero-variance & DST-immune (P2/P3/P11) ════ */
  group('Numerical safety — zero-variance & DST-immune (P2/P3/P11)', 'ecgdex-cross · integrator-dsp', function (T) {
    var CC = env.ECGCross, P = env.parseTimestamp;
    if (CC && CC.crossNight) {
      // constant series (zero variance) must not poison downstream with NaN/Infinity
      var flat = [50, 50, 50, 50, 50, 50, 50, 50].map(function (v, i) { return { x: i, t: U(2026, 4, 1 + i), v: v, w: 1 }; });
      var st = CC.crossNight(flat, { good: 'up' });
      T.ok('zero-variance cv is finite (0, not NaN/Inf)', st.cv === 0 || (st.cv != null && isFinite(st.cv)), 'cv=' + st.cv);
      T.ok('zero-variance sd is 0/finite', st.sd === 0 || st.sd == null);
      T.ok('zero-variance zLatest finite (baseline sd guarded)', st.zLatest == null || isFinite(st.zLatest));
      var one = CC.crossNight([{ x: 0, t: U(2026, 4, 1), v: 42, w: 1 }], { good: 'up' });
      T.ok('single-point series → no throw, mean=42, trend "—"', one.mean === 42 && one.trendLabel === '—');
      var none = CC.crossNight([], { good: 'up' });
      T.ok('empty series → no throw, mean null', none.mean == null);
    }
    if (typeof P === 'function') {
      // DST-immune: a "spring-forward" local time that does not exist on the wall
      // clock still encodes to its LITERAL components (floating model never shifts).
      var dst = P('2026-03-08 02:30:00', {});
      T.eq('non-existent DST-gap local time encodes literally', dst && dst.tMs, U(2026, 2, 8, 2, 30, 0));
      // overnight rollover 23:59 → 00:00 stays monotonic (+60 s, not −1439 min)
      var a = P('23:59:00', { dateAnchorMs: U(2026, 5, 7), prevTMs: null });
      var b = P('00:00:00', { dateAnchorMs: U(2026, 5, 7), prevTMs: a && a.tMs });
      T.ok('overnight 23:59→00:00 is +60 s monotonic', !!(a && b) && (b.tMs - a.tMs) === 60000, (a && b) ? ((b.tMs - a.tMs) / 1000 + 's') : '');
    }
  });

  /* ════ 12 · ECGDex respRate aggregation — median, not HF-peak (whole-record scalar) ════ */
  group('ECGDex respRate aggregation (median, not HF-peak)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.analyze + genSynthetic available', false, 'not loaded'); return; }
    var rec = D.genSynthetic({ durSec: 1800, scenario: 'hour' });   // medium → epochs exist, not longRec
    var r = D.analyze(rec, function () {});
    T.ok('respStats present (≥3 epochs)', !!(r.respStats && r.respStats.n >= 3));
    if (!r.respStats) return;
    T.ok('scalar respRate is finite', isFinite(r.respRate));
    T.ok('scalar respRate == epoch median (not HF-peak)', Math.abs(r.respRate - r.respStats.median) < 0.06, 'scalar ' + r.respRate + ' vs median ' + r.respStats.median);
    T.ok('scalar respRate ≤ epoch max (no max-latch)', r.respRate <= r.respStats.max + 0.06, 'scalar ' + r.respRate + ' max ' + r.respStats.max);
  });

  /* ════ 12b · ECGDex STAMPLESS DETERMINISM — events never carry a fabricated now() ════ */
  group('ECGDex stampless events — null clock, never now() (Clock §2.6)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP available', false, 'not loaded'); return; }
    var rec = D.genSynthetic({ durSec: 6 * 3600, scenario: 'osa' });
    rec.t0Ms = null;                                   // simulate a recording with no parseable timestamp
    var r = D.analyze(rec, function () {});
    T.ok('result startEpochMs anchor stays null', r.t0Ms == null);
    var evs = r.events || [];
    T.ok('events were produced', evs.length > 0, 'n=' + evs.length);
    T.ok('NO event carries a fabricated now()-based clock (t===null)', evs.every(function (e) { return e.t === null; }));
    T.ok('NO event carries a fabricated tMs (tMs===null)', evs.every(function (e) { return e.tMs == null; }));
    // determinism: re-analyzing the same stampless rec yields byte-identical event clocks
    var r2 = D.analyze(rec, function () {});
    T.eq('two exports of the same stampless file match', JSON.stringify((r2.events || []).map(function (e) { return [e.t, e.tMs, e.impulse]; })), JSON.stringify(evs.map(function (e) { return [e.t, e.tMs, e.impulse]; })));
    // sanity: a STAMPED rec still gets a real wall-clock + absolute tMs
    var rec2 = D.genSynthetic({ durSec: 6 * 3600, scenario: 'osa' });
    var rS = D.analyze(rec2, function () {});
    var se = (rS.events || []).filter(function (e) { return e.impulse === 'autonomic_surge'; })[0];
    if (se) { T.ok('stamped surge has HH:MM:SS clock', /^\d{2}:\d{2}:\d{2}$/.test(se.t)); T.ok('stamped surge has absolute floating tMs', typeof se.tMs === 'number' && se.tMs === rec2.t0Ms + Math.round(se._sec * 1000)); }
  });

  /* ════ 12b2 · ECGDex DEVICE CROSS-CHECK PARSERS — Clock-Contract-faithful, no Date.parse / now()
     (DEEP-AUDIT 2026-07-01 Finding 2). The app's device cross-check loaders (loadDeviceRR/HR/ACC)
     now delegate to the DSP twins ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC — regex
     parseTimestamp = FLOATING wall-clock (viewer-TZ-independent), a missing stamp stays null,
     never a fabricated now(). The old app-local parser used a locale Date-parse (viewer-TZ-
     dependent) + a _floatNow() ramp for stampless HR, diverging from the twins the Unifier/
     OverDex routed path already calls. Locks: (1) the twin's tMs == Date.UTC(components), NOT
     the viewer-local Date-parse instant; (2) a stampless HR row keeps tsMs null; (3) the app
     loaders call the twins and no longer contain parseRows / a Date-parse call. ════ */
  group('ECGDex device cross-check parsers — floating clock, no Date-parse/now() (Finding 2)', 'ecgdex-dsp · ecgdex-app', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.parseDeviceRR === 'function' && typeof D.parseDeviceHR === 'function' && typeof D.parseDeviceACC === 'function')) {
      T.ok('ECGDSP.parseDeviceRR/parseDeviceHR/parseDeviceACC exposed', false, 'ECGDSP device twins not loaded'); return;
    }
    // (1) RR: floating wall-clock tMs == Date.UTC(components) — viewer-TZ-independent (NOT a Date-parse instant)
    var rr = D.parseDeviceRR('2026-06-13 20:44:48,0.5,900\n2026-06-13 20:44:49,0.5,905\n');
    T.ok('parseDeviceRR → [{tsMs,rr}] with the RR value in range', rr.length === 2 && rr[0].rr === 900 && rr[1].rr === 905, 'len=' + rr.length);
    T.eq('parseDeviceRR tsMs is FLOATING (Date.UTC), not a viewer-local Date-parse instant',
      rr[0].tsMs, Date.UTC(2026, 5, 13, 20, 44, 48));
    // (2) HR: a stamped row is floating; a STAMPLESS row keeps tsMs null (never a fabricated now()/ramp)
    var hrStamp = D.parseDeviceHR('2026-06-13 20:44:48,58\n');
    T.eq('parseDeviceHR stamped tsMs is floating (Date.UTC)', hrStamp[0].tsMs, Date.UTC(2026, 5, 13, 20, 44, 48));
    var hrBare = D.parseDeviceHR('58\n60\n62\n');   // no timestamp column
    T.ok('parseDeviceHR stampless row → tsMs null (no fabricated clock)',
      hrBare.length === 3 && hrBare.every(function (r) { return r.tsMs === null; }),
      'tsMs=' + hrBare.map(function (r) { return r.tsMs; }).join(','));
    // (3) source-mirror: the app loaders delegate to the twins; parseRows + Date-parse are GONE
    var app = (env.sources || {})['ecgdex-app.js'];
    if (app) {
      T.ok('ecgdex-app loadDeviceRR/HR/ACC delegate to DSP.parseDevice* twins',
        /DSP\.parseDeviceRR\(/.test(app) && /DSP\.parseDeviceHR\(/.test(app) && /DSP\.parseDeviceACC\(/.test(app));
      T.ok('ecgdex-app no longer defines its own parseRows', !/function\s+parseRows\b/.test(app));
      T.ok('ecgdex-app cross-check loaders no longer call Date.parse (viewer-TZ-dependent)', !/Date\.parse\(/.test(app));
      // ── FOLLOWUPS §1: the primary ECG loader + RR/HRV exporters no longer fabricate a now() anchor
      //    for a stampless recording — thread null (Clock §2.6), so the render falls to a relative axis
      //    and the node-export startEpochMs stays null (matching the orchestrate path). ──
      T.ok('ecgdex-app retired the _floatNow() now()-fallback (Clock §2.6 — missing stamp → null)', !/function\s+_floatNow\b/.test(app));
      T.ok('primary ECG loaders thread null for a missing t0Ms (not a fabricated now())',
        /t0Ms:\(d\.t0Ms!=null\?d\.t0Ms:null\)/.test(app) && /t0Ms:\(t0Ms!=null\?t0Ms:null\)/.test(app));
      T.ok('RR / Welltory-CSV exporters anchor an undated recording at 0, never now()',
        !/r\.t0Ms!=null\?r\.t0Ms:_floatNow/.test(app) && /r\.t0Ms!=null\?r\.t0Ms:0/.test(app));
    }
  });

  /* ════ 12c · R-PEAK SEED ROBUSTNESS — a startup electrode-settling transient must NOT
     suppress detection (ECG-RPEAK-SEED-FIX-2026-06-27). A recording that opens mid
     electrode-settle (a multi-kµV transient ≫ the real QRS) used to seed the Pan-Tompkins
     integrate threshold from max(first 2 s) → seed ~10–20× the true QRS level → no beat
     crosses THRI → SPKI never decays (it only updates when a peak FIRES) → <12 peaks →
     a false "signal may be flat" throw on an otherwise-good night. The robust global-
     percentile seed (_seedScale) makes a ≤2 s transient a negligible fraction of the
     record, so detection survives. ════ */
  group('ECGDex R-peak seed — survives a startup settling transient (ECG-RPEAK-SEED-FIX)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.analyze + genSynthetic available', false, 'not loaded'); return; }
    var fs = 130;
    var syn = D.genSynthetic({ fs: fs, durSec: 2 * 3600, scenario: 'osa' });
    // scale to ~600 µV R-peaks (this real recording's amplitude) so the prepended ~5 kµV
    // settling transient is ~8× the QRS — the actual Polar-H10 20260625 failure ratio.
    var mx = 0; for (var i = 0; i < syn.int16.length; i++){ var a = Math.abs(syn.int16[i]); if (a > mx) mx = a; }
    var sc = 600 / (mx || 1), clean = new Int16Array(syn.int16.length);
    for (var j = 0; j < clean.length; j++) clean[j] = Math.round(syn.int16[j] * sc);
    // a 2 s exponential electrode-settling decay from +5000 µV (then a short taper to 0)
    var pre = [], P = Math.round(2 * fs);
    for (var k = 0; k < P; k++) pre.push(Math.round(5000 * Math.exp(-k / (0.27 * fs))));
    for (var m = 1; m <= 20; m++) pre.push(Math.round(pre[pre.length - 1] * (1 - m / 20)));
    var dirty = new Int16Array(pre.length + clean.length);
    dirty.set(pre, 0); dirty.set(clean, pre.length);
    var rc = null, rd = null, threw = '';
    try { rc = D.analyze({ int16: clean, fs: fs, gaps: [], t0Ms: syn.t0Ms, durSec: clean.length / fs }, function(){}); } catch(e){ rc = null; }
    try { rd = D.analyze({ int16: dirty, fs: fs, gaps: [], t0Ms: syn.t0Ms, durSec: dirty.length / fs }, function(){}); } catch(e){ threw = e.message; }
    T.ok('clean overnight analyzes (baseline)', !!rc && rc.nn.length > 100, rc ? (rc.nn.length + ' beats') : 'threw');
    T.ok('+startup transient no longer throws "Too few R-peaks"', !!rd, threw || 'ok');
    if (rc && rd) {
      var ratio = rd.nn.length / rc.nn.length;
      T.ok('transient does not suppress detection (≥85% of clean beats)', ratio >= 0.85, 'ratio ' + ratio.toFixed(2) + ' (' + rd.nn.length + '/' + rc.nn.length + ')');
      T.ok('mean HR unchanged by the transient (Δ ≤ 3 bpm)', Math.abs(rc.hr - rd.hr) <= 3, 'ΔHR ' + Math.abs(rc.hr - rd.hr).toFixed(1));
    }
    // the fix must be the robust SEED, not a relaxed peak-count floor
    var src = (env.sources || {})['ecgdex-dsp.js'];
    if (src) {
      T.ok('detectPeaks seeds from a robust global scale (_seedScale), not max(first 2 s)', /_seedScale\s*\(\s*integ/.test(src) && !/for \(let i = 0; i < initN; i\+\+\) init = Math\.max/.test(src));
      T.ok('the <12-peak guard is unchanged (still errors on a genuinely flat signal)', /peaks\.length < 12\)\s*throw new Error/.test(src));
    }
  });

  /* ════ 12c2 · R-PEAK STALL RECOVERY — a SUPRA-PHYSIOLOGIC MID-RECORD artifact must NOT
     kill detection for the rest of the night (ECGDEX-FOLLOWUPS-II §1 — search-back / stall
     recovery; the sibling of 12c's STARTUP-seed fix). SPKI only updates when a peak FIRES,
     so ONE multi-kµV in-band transient (electrode-settling / motion, ~20–30× a real QRS in
     the SQUARED integrate) parks SPKI — hence THRI — above every later real QRS; with no
     recovery, detection dies SILENTLY for the rest of the record. A real Polar-H10 20260625
     ~7 h night collapsed to 63 beats / 4 min exactly this way (integ artifact ≈1.1e7 vs
     ~5e5 real QRS), AFTER 12c's seed fix (which only prevents the startup <12-peak THROW).
     Guard: once a cadence is established (rrAvg>0) and detection stalls past a
     non-physiologic gap (>2.5 s ⇒ <24 bpm), bleed SPKI toward the noise floor so a real QRS
     re-crosses THRI. Inert on clean records (a real RR never exceeds 2.5 s). ════ */
  group('ECGDex R-peak stall recovery — a mid-record artifact does not kill the night (ECGDEX-FOLLOWUPS-II §1)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.analyze + genSynthetic available', false, 'not loaded'); return; }
    var fs = 130;
    var syn = D.genSynthetic({ fs: fs, durSec: 2 * 3600, scenario: 'osa' });
    // scale to ~600 µV R-peaks (the real recording's amplitude)
    var mx = 0; for (var i = 0; i < syn.int16.length; i++){ var a = Math.abs(syn.int16[i]); if (a > mx) mx = a; }
    var sc = 600 / (mx || 1), clean = new Int16Array(syn.int16.length);
    for (var j = 0; j < clean.length; j++) clean[j] = Math.round(syn.int16[j] * sc);
    // a SHARP ±6000 µV bipolar artifact at ~60 s — in-band (survives the 5–15 Hz band-pass),
    // ~10× the QRS amplitude → tens-of-× in the squared integrate. Mid-record (cadence
    // already established) so it tests the STALL path, not 12c's startup-seed path.
    var dirty = new Int16Array(clean); var a0 = Math.round(60 * fs);
    for (var k = 0; k < 6; k++) dirty[a0 + k] = (k < 3 ? 6000 : -6000);
    var rc = null, rd = null;
    try { rc = D.analyze({ int16: clean, fs: fs, gaps: [], t0Ms: syn.t0Ms, durSec: clean.length / fs }, function(){}); } catch(e){ rc = null; }
    try { rd = D.analyze({ int16: dirty, fs: fs, gaps: [], t0Ms: syn.t0Ms, durSec: dirty.length / fs }, function(){}); } catch(e){ rd = null; }
    T.ok('clean overnight analyzes (baseline)', !!rc && rc.nn.length > 100, rc ? (rc.nn.length + ' beats') : 'threw');
    // long-record coverage gate — closes the equiv-gate large-file BLIND SPOT (the compute()≡export
    // equivalence fixtures are all ~6-min clips, so before this NO ≥2 h record was exercised; the
    // pre-stall-fix silent collapse to 1 min of a 7 h night slipped every gate). A regression that
    // truncates a long record now turns this RED.
    T.ok('long (2 h) record analyzes at FULL coverage (no silent truncation)', !!rc && rc.coveragePct >= 95 && rc.nn.length > 3000, rc ? (rc.coveragePct + '% cov · ' + rc.nn.length + ' beats') : 'threw');
    T.ok('+mid-record artifact still analyzes', !!rd, rd ? 'ok' : 'threw');
    if (rc && rd) {
      var ratio = rd.nn.length / rc.nn.length;
      // WITHOUT the idle-decay guard, detection dies at the artifact (a real night collapsed
      // to ~1% of its beats); WITH it, the whole night past the artifact is recovered.
      T.ok('artifact does not kill detection (≥85% of clean beats recovered)', ratio >= 0.85, 'ratio ' + ratio.toFixed(2) + ' (' + rd.nn.length + '/' + rc.nn.length + ')');
      T.ok('mean HR unchanged by the artifact (Δ ≤ 3 bpm)', Math.abs(rc.hr - rd.hr) <= 3, 'ΔHR ' + Math.abs(rc.hr - rd.hr).toFixed(1));
    }
    // the fix must be the STALL-RECOVERY guard (idle-decay of a parked SPKI), not a relaxed floor
    var src = (env.sources || {})['ecgdex-dsp.js'];
    if (src) {
      T.ok('detectPeaks bleeds a stalled SPKI toward noise after a non-physiologic gap (idleLimit guard)',
        /idleLimit\s*=\s*Math\.round\(\s*2\.5\s*\*\s*fs\s*\)/.test(src) && /\(i - last\)\s*>\s*idleLimit/.test(src) && /SPKI\s*=\s*Math\.max\(\s*NPKI\s*,\s*SPKI\s*\*\s*0\.99\s*\)/.test(src));
    }
  });

  /* ════ 12d · INTEGRATOR ingests the LIGHT ECGDex orchestrate export GRACEFULLY
     (ECGDEX-FOLLOWUPS-2026-06-27 §2). The Unifier/OverDex raw-ECG path emits the light
     node-export (schema + recording + ganglior_events only — no hrv/epochs/quality), and
     adaptEnvelopeNode('ECGDex') reads every rich field through null-guards: it must ingest
     without throwing, skip HRV consensus (rmssd/sdnn null, NOT fabricated 0) + posture
     (empty), yet keep the surge/stage events flowing into fusion. ════ */
  group('Integrator ingests the LIGHT ECGDex export gracefully (ECGDEX-FOLLOWUPS §2)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode;
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var t0 = U(2026, 5, 25, 22, 0, 0);
    // exactly the shape ecgBuildNodeExport emits on the orchestrate path: no hrv/quality/timeseries.
    var light = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'ECGDex', bus: 'ganglior' },
      recording: { source: 'ecg', startEpochMs: t0, offsetMin: null, events: 2 },
      ganglior_events: [
        { t: '22:40:00', tMs: t0 + 40 * 60000, impulse: 'autonomic_surge', node: 'ECGDex', conf: 0.7, sqi: 0.8, meta: { ampBpm: 12 } },
        { t: '23:10:00', tMs: t0 + 70 * 60000, impulse: 'stage_rem', node: 'ECGDex', conf: 0.7, sqi: null, meta: {} }],
      reserved: {} };
    var recs = null, threw = '';
    try { recs = A(light, 'ECGDex', 'ecg.json'); } catch (e) { threw = e.message; }
    T.ok('light export ingests without throwing', !!recs && Array.isArray(recs) && recs.length === 1, threw || 'ok');
    if (recs && recs.length) {
      var r = recs[0];
      T.ok('HRV consensus skipped — rmssd null (no hrv.time present), not a fabricated 0', r.summary && r.summary.rmssd == null, r.summary && ('rmssd=' + r.summary.rmssd));
      T.ok('SDNN null too (degrades, never fabricates)', r.summary && r.summary.sdnn == null);
      T.ok('no posture series (no ACC / epochs in the light export)', !r.summary || !r.summary.posture || r.summary.posture.length === 0);
      T.ok('surge event still flows into fusion (apnea confirmation preserved)', (r.events || []).some(function (e) { return e.impulse === 'autonomic_surge'; }));
      T.ok('stage event preserved too', (r.events || []).some(function (e) { return /^stage_/.test(e.impulse); }));
    }
  });

  /* ════ 12d-rich · INTEGRATOR ingests the RICH ECGDex orchestrate export — option (a)
     (ECG-PPG-FOLLOWUPS-HANDOFF §1 / ECGDEX-FOLLOWUPS-II §2). emitEcgNodeExport now passes opts.rich,
     so a Unifier/OverDex-routed ECG file carries the whole-record HRV axis (wholeRecordRMSSD/SDNN),
     hrv.frequency.lfhf, quality.analyzablePct, the per-5-min timeseries.epochs[].position grid, and
     sleep stage minutes — the slice adaptEnvelopeNode('ECGDex') reads for HRV consensus + posture.
     Lock: (1) the DEFAULT (no-flag) builder is still LIGHT — no hrv/timeseries/quality/sleep keys, so
     the app's exportGanglior stream is byte-identical; (2) the rich export carries the consensus axis;
     (3) the Integrator now picks up summary.rmssd/sdnn (non-null) from it; (4) epochs[].position wires
     through to a posture series. ════ */
  group('Integrator ingests the RICH ECGDex export — HRV consensus + posture (HANDOFF §1)', 'ecgdex-dsp · integrator-dsp', function (T) {
    var D = env.ECGDSP, A = env.adaptEnvelopeNode;
    if (!(D && typeof D.compute === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.compute + genSynthetic available', false, 'not loaded'); return; }
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var syn = function () { return D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' }); };
    // (1) DEFAULT builder stays LIGHT — the app's exportGanglior() path (no opts.rich).
    var light = D.compute(syn());
    T.ok('default (no rich) export omits hrv (app light stream byte-identical)', !('hrv' in light), Object.keys(light).join(','));
    T.ok('default (no rich) export omits timeseries', !('timeseries' in light));
    T.ok('default (no rich) export omits quality', !('quality' in light));
    T.ok('default (no rich) export omits sleep', !('sleep' in light));
    // (2) RICH export carries the consensus axis + scaffolds.
    var rich = D.compute(syn(), { rich: true });
    T.ok('rich: schema still ganglior.node-export / ECGDex (additive, not a new schema)', !!(rich.schema && rich.schema.name === 'ganglior.node-export' && rich.schema.node === 'ECGDex'));
    T.ok('rich: hrv.time.wholeRecordRMSSD is a finite number (the consensus axis)', !!(rich.hrv && rich.hrv.time && typeof rich.hrv.time.wholeRecordRMSSD === 'number' && isFinite(rich.hrv.time.wholeRecordRMSSD)), rich.hrv && rich.hrv.time && rich.hrv.time.wholeRecordRMSSD);
    T.ok('rich: hrv.time.wholeRecordSDNN is a finite number', !!(rich.hrv && rich.hrv.time && typeof rich.hrv.time.wholeRecordSDNN === 'number' && isFinite(rich.hrv.time.wholeRecordSDNN)));
    T.ok('rich: hrv.frequency.lfhf present', !!(rich.hrv && rich.hrv.frequency && 'lfhf' in rich.hrv.frequency));
    T.ok('rich: quality.analyzablePct present', !!(rich.quality && 'analyzablePct' in rich.quality));
    T.ok('rich: timeseries.epochs is a non-empty array, each carrying a position key', !!(rich.timeseries && Array.isArray(rich.timeseries.epochs) && rich.timeseries.epochs.length > 0 && rich.timeseries.epochs.every(function (e) { return 'position' in e; })), rich.timeseries && rich.timeseries.epochs && rich.timeseries.epochs.length);
    T.ok('rich: ganglior_events still present (rich is a SUPERSET of light)', Array.isArray(rich.ganglior_events));
    // (3) the Integrator now gets HRV consensus from the rich export.
    var rRich = A(rich, 'ECGDex', 'ecg-rich.json')[0];
    T.ok('Integrator picks up summary.rmssd (non-null) from the rich export', !!(rRich && rRich.summary && rRich.summary.rmssd != null), rRich && rRich.summary && ('rmssd=' + rRich.summary.rmssd));
    T.ok('  and it equals hrv.time.wholeRecordRMSSD (whole-record consensus axis)', !!(rRich && rRich.summary && rRich.summary.rmssd === rich.hrv.time.wholeRecordRMSSD));
    T.ok('Integrator picks up summary.sdnn (non-null) too', !!(rRich && rRich.summary && rRich.summary.sdnn != null));
    // contrast: the LIGHT export still degrades (consensus skipped, never fabricated as 0).
    var rLight = A(light, 'ECGDex', 'ecg-light.json')[0];
    T.ok('LIGHT export still degrades — summary.rmssd null (no fabricated 0)', !!(rLight && rLight.summary && rLight.summary.rmssd == null));
    // (4) epochs[].position wires through to a posture series (companions §2b populate it on real
    //     files; inject a real posture here to prove the Integrator reads the rich scaffold).
    rich.timeseries.epochs[0].position = 'supine';
    var rPos = A(rich, 'ECGDex', 'ecg-pos.json')[0];
    T.ok('epochs[].position → adaptEnvelopeNode posture series (non-empty once a real posture is present)', !!(rPos && rPos.summary && Array.isArray(rPos.summary.posture) && rPos.summary.posture.length > 0), rPos && rPos.summary && rPos.summary.posture && rPos.summary.posture.length);
  });

  /* ════ 12d-rich-ppg · INTEGRATOR ingests the RICH PpgDex orchestrate export — option (a)
     (ECG-PPG-FOLLOWUPS-HANDOFF §1 / PPGDEX-FOLLOWUPS §1+§2). The SHARED rich-export shape, the PpgDex
     twin of the ECG group above — landing one node's (a) without the other is exactly the divergence
     the handoff forbids. emitPpgNodeExport passes opts.rich → a Unifier/OverDex-routed PPG file carries
     hrv.time.{rmssd,sdnn} (single-site PPG → whole-record directly), hrv.frequency.lfhf,
     quality.analyzablePct, and the limb-acc timeseries.epochs[].position grid. Same four locks as the
     ECG twin (default-light unchanged · rich consensus axis · Integrator picks it up · posture wires). ════ */
  group('Integrator ingests the RICH PpgDex export — HRV consensus + posture (HANDOFF §1)', 'ppgdex-dsp · integrator-dsp', function (T) {
    var PG = env.PpgDex, SY = env.SYNTH, A = env.adaptEnvelopeNode;
    if (!(PG && typeof PG.compute === 'function')) { T.ok('PpgDex.compute available', false, 'not loaded'); return; }
    if (!(SY && typeof SY.renderPPG === 'function' && typeof SY.pickWindow === 'function' && typeof SY.buildTimelines === 'function')) { T.ok('SYNTH.renderPPG available for PpgDex rich test', false, 'synth-gen not loaded into env'); return; }
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var ptl = SY.buildTimelines()[0];
    var pText = SY.renderPPG(ptl, SY.pickWindow(ptl));
    // (1) DEFAULT builder stays LIGHT.
    var light = PG.compute({ text: pText });
    T.ok('default (no rich) export omits hrv (app light stream byte-identical)', !('hrv' in light), Object.keys(light).join(','));
    T.ok('default (no rich) export omits timeseries', !('timeseries' in light));
    T.ok('default (no rich) export omits quality', !('quality' in light));
    // (2) RICH export carries the consensus axis + scaffolds.
    var rich = PG.compute({ text: pText }, { rich: true });
    T.ok('rich: schema still ganglior.node-export / PpgDex (additive)', !!(rich.schema && rich.schema.name === 'ganglior.node-export' && rich.schema.node === 'PpgDex'));
    T.ok('rich: hrv.time.rmssd is a finite number (single-site → whole-record consensus axis)', !!(rich.hrv && rich.hrv.time && typeof rich.hrv.time.rmssd === 'number' && isFinite(rich.hrv.time.rmssd)), rich.hrv && rich.hrv.time && rich.hrv.time.rmssd);
    T.ok('rich: hrv.time.sdnn is a finite number', !!(rich.hrv && rich.hrv.time && typeof rich.hrv.time.sdnn === 'number' && isFinite(rich.hrv.time.sdnn)));
    T.ok('rich: hrv.time.window === wholeRecord (matches the Integrator PpgDex axis)', !!(rich.hrv && rich.hrv.time && rich.hrv.time.window === 'wholeRecord'));
    T.ok('rich: hrv.frequency.lfhf present', !!(rich.hrv && rich.hrv.frequency && 'lfhf' in rich.hrv.frequency));
    T.ok('rich: quality.analyzablePct present', !!(rich.quality && 'analyzablePct' in rich.quality));
    T.ok('rich: timeseries.epochs is a non-empty array, each carrying a position key', !!(rich.timeseries && Array.isArray(rich.timeseries.epochs) && rich.timeseries.epochs.length > 0 && rich.timeseries.epochs.every(function (e) { return 'position' in e; })), rich.timeseries && rich.timeseries.epochs && rich.timeseries.epochs.length);
    // (3) the Integrator now gets HRV consensus from the rich PPG export.
    var rRich = A(rich, 'PpgDex', 'ppg-rich.json')[0];
    T.ok('Integrator picks up summary.rmssd (non-null) from the rich PPG export', !!(rRich && rRich.summary && rRich.summary.rmssd != null), rRich && rRich.summary && ('rmssd=' + rRich.summary.rmssd));
    T.ok('Integrator picks up summary.sdnn (non-null) too', !!(rRich && rRich.summary && rRich.summary.sdnn != null));
    T.ok('  PPG consensus window tagged wholeRecord', !!(rRich && rRich.summary && rRich.summary.hrvWindow === 'wholeRecord'));
    // (4) epochs[].position wires through to a (down-weighted, limb-acc) posture series.
    rich.timeseries.epochs[0].position = 'supine';
    var rPos = A(rich, 'PpgDex', 'ppg-pos.json')[0];
    T.ok('epochs[].position → adaptEnvelopeNode posture series (limb-acc fallback)', !!(rPos && rPos.summary && Array.isArray(rPos.summary.posture) && rPos.summary.posture.length > 0), rPos && rPos.summary && rPos.summary.posture && rPos.summary.posture.length);
    T.ok('  PPG posture tagged postureSource=limb-acc (Integrator down-weights vs chest ECG)', !!(rPos && rPos.summary && rPos.summary.postureSource === 'limb-acc'));
  });

  /* ════ 12d-light-ppg · INTEGRATOR ingests the LIGHT PpgDex orchestrate export GRACEFULLY
     (PPGDEX-FOLLOWUPS §2 — the PPG twin of the ECGDex 12d light group above). The Unifier/OverDex
     raw-PPG path emits the light node-export (schema + recording + ganglior_events only — no
     hrv/epochs/quality), and the adaptEnvelopeNode PpgDex branch reads every rich field through
     null-guards: it must ingest without throwing, skip HRV consensus (rmssd/sdnn null, NOT a
     fabricated 0) + posture (empty series, still tagged limb-acc), yet keep the autonomic_surge /
     motion events flowing into fusion — and round-trip the PpgDex-only per-event sqi axis (§3 /
     DAWN-SQI §1). Also feeds the REAL committed 0-event equiv fixture (env.equiv.ppgdex.fixture)
     to prove the exact orchestrate output ingests. ════ */
  group('Integrator ingests the LIGHT PpgDex export gracefully (PPGDEX-FOLLOWUPS §2)', 'ppgdex-dsp · integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode;
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var t0 = U(2026, 5, 21, 23, 0, 0);
    // exactly the shape ppgBuildNodeExport emits on the orchestrate path (no opts.rich): no hrv/quality/timeseries.
    var light = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'PpgDex', bus: 'ganglior' },
      recording: { source: 'ppg', startEpochMs: t0, offsetMin: null, events: 2 },
      ganglior_events: [
        { t: '23:20:00', tMs: t0 + 20 * 60000, impulse: 'autonomic_surge', node: 'PpgDex', conf: 0.7, sqi: null, meta: { ampBpm: 11 } },
        { t: '23:45:00', tMs: t0 + 45 * 60000, impulse: 'motion_artifact_segment', node: 'PpgDex', conf: 0.6, sqi: 0.42, meta: {} }],
      reserved: {} };
    var recs = null, threw = '';
    try { recs = A(light, 'PpgDex', 'ppg.json'); } catch (e) { threw = e.message; }
    T.ok('light export ingests without throwing', !!recs && Array.isArray(recs) && recs.length === 1, threw || 'ok');
    if (recs && recs.length) {
      var r = recs[0];
      T.ok('HRV consensus skipped — rmssd null (no hrv.time present), not a fabricated 0', r.summary && r.summary.rmssd == null, r.summary && ('rmssd=' + r.summary.rmssd));
      T.ok('SDNN null too (degrades, never fabricates)', r.summary && r.summary.sdnn == null);
      T.ok('no posture series (no ACC / epochs in the light export)', !r.summary || !r.summary.posture || r.summary.posture.length === 0);
      T.ok('postureSource still tagged limb-acc (PpgDex branch sets it even with an empty series)', r.summary && r.summary.postureSource === 'limb-acc');
      T.ok('autonomic_surge event still flows into fusion (apnea confirmation preserved)', (r.events || []).some(function (e) { return e.impulse === 'autonomic_surge'; }));
      T.ok('motion_artifact_segment event preserved WITH its sqi axis intact (0.42)', (r.events || []).some(function (e) { return e.impulse === 'motion_artifact_segment' && e.sqi === 0.42; }));
      T.ok('surge event sqi null round-trips (not fabricated)', (r.events || []).filter(function (e) { return e.impulse === 'autonomic_surge'; })[0].sqi == null);
    }
    // the REAL committed orchestrate export (0-event 6.5-min clip) must also ingest cleanly.
    var fx = env.equiv && env.equiv.ppgdex && env.equiv.ppgdex.fixture;
    if (fx) {
      var recs2 = null, threw2 = '';
      try { recs2 = A(fx, 'PpgDex', 'PpgDex_equiv.json'); } catch (e) { threw2 = e.message; }
      T.ok('committed light PpgDex equiv fixture ingests without throwing', !!recs2 && Array.isArray(recs2) && recs2.length === 1, threw2 || 'ok');
      T.ok('  and degrades — no HRV consensus from the light fixture (rmssd null)', !!(recs2 && recs2[0] && recs2[0].summary && recs2[0].summary.rmssd == null));
    }
  });

  /* ════ INTEGRATOR PpgDex SQI-FLOOR down-weight (NODE-RESIDUE-FOLLOWUPS-2026-06-30 §3). PpgDex already
     stamps a per-event sqi (sqiAt) on autonomic_surge/hrv_drop/motion, and effConf already tapers a surge
     PROPORTIONALLY by sqi in the noisy-OR (conf × sqi). This wires the CATEGORICAL floor — the mirror of the
     GlucoDex clamp-floor: adaptEnvelopeNode's PpgDex branch halves conf + tags sqiFloor for any event whose
     sqi is below PPG_SQI_FLOOR (0.3), the unusable-quality tail. sqi is PRESERVED (R7 — never folded into
     conf); sqi==null OR sqi≥floor → untouched (back-compat). Mirrors the GlucoDex clamp group's shape. ════ */
  group('Integrator PpgDex sqi-floor down-weight (NODE-RESIDUE-FOLLOWUPS §3)', 'ppgdex-dsp · integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode;
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var t0 = U(2026, 5, 21, 23, 0, 0);
    // three PpgDex surges: sub-floor sqi (0.20 < 0.3), clean (0.80), and null (no per-beat quality).
    var ppg = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'PpgDex', bus: 'ganglior' },
      recording: { source: 'ppg', startEpochMs: t0, offsetMin: null, events: 3 },
      ganglior_events: [
        { t: '23:20:00', tMs: t0 + 20 * 60000, impulse: 'autonomic_surge', node: 'PpgDex', conf: 0.8, sqi: 0.20, meta: { ampBpm: 14 } },
        { t: '23:30:00', tMs: t0 + 30 * 60000, impulse: 'autonomic_surge', node: 'PpgDex', conf: 0.8, sqi: 0.80, meta: { ampBpm: 14 } },
        { t: '23:45:00', tMs: t0 + 45 * 60000, impulse: 'autonomic_surge', node: 'PpgDex', conf: 0.8, sqi: null, meta: { ampBpm: 14 } }],
      reserved: {} };
    var rp = A(ppg, 'PpgDex', 'ppg-sqi.json')[0];
    var evs = (rp && rp.events) || [];
    var low = evs.filter(function (e) { return e.sqi === 0.2; })[0];
    var clean = evs.filter(function (e) { return e.sqi === 0.8; })[0];
    var nul = evs.filter(function (e) { return e.impulse === 'autonomic_surge' && e.sqi == null; })[0];
    T.ok('sub-floor PPG event down-weighted (conf ×0.5 → 0.4) + flagged sqiFloor', !!(low && low.sqiFloor === true && low.conf === 0.4), low && ('conf=' + low.conf + ' sqiFloor=' + low.sqiFloor));
    T.ok('  floored event PRESERVES its sqi axis (R7 — not folded into conf)', !!(low && low.sqi === 0.2), low && ('sqi=' + low.sqi));
    T.ok('above-floor PPG event untouched (conf 0.8, no sqiFloor)', !!(clean && clean.conf === 0.8 && !clean.sqiFloor));
    T.ok('sqi-null PPG event untouched (quality-neutral, back-compat)', !!(nul && nul.conf === 0.8 && !nul.sqiFloor));
    // source-mirror: the constant + the PpgDex-branch floor exist (not silently reverted).
    var src = (env.sources || {})['integrator-dsp.js'];
    if (src) {
      T.ok('PPG_SQI_FLOOR constant defined in integrator-dsp.js', /PPG_SQI_FLOOR\s*=\s*0\.3/.test(src));
      T.ok('PpgDex branch halves conf + tags sqiFloor below PPG_SQI_FLOOR', /_pe\.sqiFloor\s*=\s*true/.test(src) && /_pe\.sqi\s*<\s*PPG_SQI_FLOOR/.test(src));
    } else {
      T.ok('integrator-dsp.js source available (env.sources)', false, 'add it to both runners');
    }
  });

  /* ════ INTEGRATOR ingests the GlucoDex orchestrate export end-to-end (GLUCODEX-FOLLOWUPS §3).
     The GlucoDex leg verified the EMIT side headlessly but never drove the Integrator's fusion ingest
     of the light `recording + ganglior_events` CGM export. Feed the REAL committed equiv fixture
     (env.equiv.glucodex.fixture — real Abbott Lingo, 42 events, recording.clamp:{detected:false}, no
     timeseries) through adaptEnvelopeNode('GlucoDex'): every event maps (tMs already absolute /
     reconstructed via startEpochMs + t), clampSat is surfaced (null on this clean file — CHECKED, not
     absent), and it degrades gracefully on the absent cell series (no throw, empty series.cells). Plus
     a hand-built clamp-DETECTED light export to prove the §2 down-weight path (meta.clampFloor hypo →
     conf ×0.5) survives the ingest. ════ */
  group('Integrator ingests the GlucoDex export end-to-end (GLUCODEX-FOLLOWUPS §3)', 'glucodex-dsp · integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode;
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var fx = env.equiv && env.equiv.glucodex && env.equiv.glucodex.fixture;
    T.ok('committed GlucoDex equiv fixture wired into env.equiv', !!fx, fx ? '' : 'wire equiv.glucodex in both runners');
    if (fx) {
      var recs = null, threw = '';
      try { recs = A(fx, 'GlucoDex', 'GlucoDex_equiv.json'); } catch (e) { threw = e.message; }
      T.ok('light CGM export ingests without throwing', !!recs && Array.isArray(recs) && recs.length === 1, threw || 'ok');
      if (recs && recs.length) {
        var r = recs[0];
        var srcEvents = (fx.ganglior_events || []).length;
        T.ok('every ganglior_event is mapped (none dropped)', (r.events || []).length === srcEvents, (r.events || []).length + ' of ' + srcEvents);
        T.ok('event tMs reconstructed onto the floating axis (finite, from startEpochMs + t)', (r.events || []).every(function (e) { return typeof e.tMs === 'number' && isFinite(e.tMs); }));
        T.ok('nocturnal_hypo events preserved (the dominant impulse)', (r.events || []).some(function (e) { return e.impulse === 'nocturnal_hypo'; }));
        T.ok('clampSat surfaced as null on a clean (unclamped) export — CHECKED, not absent', r.summary && r.summary.clampSat === null);
        T.ok('no clip-floor down-weight applied on a clean file (no clampFloor flag)', (r.events || []).every(function (e) { return !e.clampFloor; }));
        T.ok('degrades on the absent cell series — no throw, empty cells trace', !r.series || !r.series.cells || r.series.cells.length === 0);
      }
    }
    // clamp-DETECTED light export → the Integrator down-weights clip-floor hypos (the consume side of §2).
    var t0 = U(2026, 4, 23, 0, 0, 0);
    var clamped = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'GlucoDex', bus: 'ganglior' },
      recording: { source: 'cgm', startEpochMs: t0, events: 2, clamp: { detected: true, vendor: 'lingo', floor: 55, ceiling: 200, blindMetrics: ['tbr1', 'min'] } },
      ganglior_events: [
        { t: '02:00:00', tMs: t0 + 2 * 3600000, impulse: 'nocturnal_hypo', node: 'GlucoDex', conf: 0.9, meta: { clampFloor: true, minMgdl: 55 } },
        { t: '03:00:00', tMs: t0 + 3 * 3600000, impulse: 'nocturnal_hypo', node: 'GlucoDex', conf: 0.9, meta: { minMgdl: 62 } }],
      reserved: {} };
    var rc = A(clamped, 'GlucoDex', 'gluco-clamped.json')[0];
    T.ok('clamp-detected export surfaces summary.clampSat (vendor lingo)', !!(rc && rc.summary && rc.summary.clampSat && rc.summary.clampSat.vendor === 'lingo'));
    var floorHypo = (rc.events || []).filter(function (e) { return e.meta && e.meta.clampFloor; })[0];
    var trueHypo = (rc.events || []).filter(function (e) { return e.impulse === 'nocturnal_hypo' && !(e.meta && e.meta.clampFloor); })[0];
    T.ok('clip-floor hypo is down-weighted (conf ×0.5 → 0.45) + flagged clampFloor', !!(floorHypo && floorHypo.clampFloor === true && floorHypo.conf === 0.45), floorHypo && ('conf=' + floorHypo.conf));
    T.ok('a genuine (non-clip) hypo keeps its confidence (0.9)', !!(trueHypo && trueHypo.conf === 0.9));
  });

  /* ════ COMPANION-BUNDLE INGEST — ECG/PPG device sidecars reach compute() via ctx.companions
     (ECG-PPG-FOLLOWUPS-HANDOFF §2(b)). The single-text adapter boundary used to drop the matched
     `*_RR/_HR/_ACC` (ECG) and `*_ACC/_GYRO/_MAGN/_PPI` (PPG) sidecars, so a Unifier/OverDex-routed
     waveform lost posture + device cross-checks. Now the host pairs them by filename stamp
     (SignalOrchestrate.pairCompanions) and hands their TEXT via ctx.companions; the adapter parses
     them (DSP-resident parsers, by reference) and attaches to the frame, so compute() carries
     rec.deviceACC → analyze() stamps epochs[].position (posture). Lock: (1) nearest-by-stamp pairing,
     (2) the adapter attaches the sidecars (and a no-companion call leaves the single-text frame
     unchanged), (3) compute() turns deviceACC into REAL postures (vs all-'unknown' without). ════ */
  group('Companion-bundle ingest — ECG/PPG sidecars reach compute() via ctx.companions (HANDOFF §2(b))', 'polar-h10-ecg · polar-sense-ppg · signal-orchestrate', function (T) {
    var SA = env.SignalAdapters, SF = env.SignalFrame, ORCH = env.SignalOrchestrate, ECD = env.ECGDSP, PG = env.PpgDex, SY = env.SYNTH;
    if (!(SA && SF && ORCH && typeof ORCH.pairCompanions === 'function')) { T.ok('SignalAdapters + SignalFrame + SignalOrchestrate.pairCompanions co-loaded', false, 'load signal-orchestrate.js into both runners'); return; }
    // (1) nearest-by-stamp pairing over a whole drop.
    var entries = [
      { name: 'Polar_H10_X_20260617_010000_ECG.txt', text: 'ECG' },
      { name: 'Polar_H10_X_20260617_010000_RR.txt', text: 'RR' },
      { name: 'Polar_H10_X_20260617_010000_ACC.txt', text: 'ACC-near' },
      { name: 'Polar_H10_X_20260617_233000_ACC.txt', text: 'ACC-far' }
    ];
    var pc = ORCH.pairCompanions('ecg', 'Polar_H10_X_20260617_010000_ECG.txt', entries);
    T.ok('pairCompanions(ecg) returns a companion map', !!(pc && typeof pc === 'object'));
    T.eq('  RR sidecar paired by name', pc && pc.rr, 'RR');
    T.eq('  ACC paired to the NEAREST stamp (01:00, not 23:30)', pc && pc.acc, 'ACC-near');
    T.ok('  absent HR sidecar is omitted (never fabricated)', !(pc && 'hr' in pc));
    T.ok('  companionKinds(ppg) = acc/gyro/magn/ppi', JSON.stringify(ORCH.companionKinds('ppg')) === JSON.stringify(['acc', 'gyro', 'magn', 'ppi']));
    T.ok('  a no-sidecar drop pairs nothing → null', ORCH.pairCompanions('ecg', 'lone_20260617_010000_ECG.txt', [{ name: 'lone_20260617_010000_ECG.txt', text: 'ECG' }]) === null);

    // §1 (ECG-INGEST-FOLLOWUPS) — DEVICE-ID companion filter (the cross-host analogue of the app fix).
    // A folder-walk / drop that mixes a Verity-Sense session and an H10 session must pair each primary
    // to its OWN-device sidecars, NEVER the nearer-stamp foreign-device one. Here the wrong-device Sense
    // `_ACC` is the NEARER stamp (010001) and the H10's own `_ACC` is FAR (233000) — nearest-stamp alone
    // would mis-grab the Sense ACC; the device filter must override it.
    var mixed = [
      { name: 'Polar_H10_AAAA_20260617_010000_ECG.txt', text: 'H10-ECG' },
      { name: 'Polar_H10_AAAA_20260617_233000_ACC.txt', text: 'H10-ACC' },   // same device, FAR stamp
      { name: 'Polar_H10_AAAA_20260617_010000_RR.txt',  text: 'H10-RR' },
      { name: 'Polar_VS_BBBB_20260617_010001_PPG.txt',  text: 'Sense-PPG' },
      { name: 'Polar_VS_BBBB_20260617_010001_ACC.txt',  text: 'Sense-ACC' }   // wrong device, NEAR stamp
    ];
    var pcMix = ORCH.pairCompanions('ecg', 'Polar_H10_AAAA_20260617_010000_ECG.txt', mixed);
    T.eq('  §1 H10 ECG pairs its OWN-device ACC, not the nearer-stamp Sense ACC', pcMix && pcMix.acc, 'H10-ACC');
    T.eq('  §1 H10 ECG pairs its own-device RR', pcMix && pcMix.rr, 'H10-RR');
    // A primary whose ONLY same-kind sidecar is a foreign device pairs NOTHING for that kind (no foreign grab).
    var lonely = [
      { name: 'Polar_H10_AAAA_20260617_010000_ECG.txt', text: 'H10-ECG' },
      { name: 'Polar_H10_AAAA_20260617_010000_RR.txt',  text: 'H10-RR' },
      { name: 'Polar_VS_BBBB_20260617_010001_ACC.txt',  text: 'Sense-ACC' }   // foreign-only ACC
    ];
    var pcLone = ORCH.pairCompanions('ecg', 'Polar_H10_AAAA_20260617_010000_ECG.txt', lonely);
    T.eq('  §1 still pairs the own-device RR', pcLone && pcLone.rr, 'H10-RR');
    T.ok('  §1 foreign-only ACC is NOT grabbed (kind omitted, never the foreign one)', !(pcLone && 'acc' in pcLone));
    // An O2Ring SpO₂ CSV in the drop is never an ECG sidecar (foreign-signal rejection).
    var withO2 = [
      { name: 'Polar_H10_AAAA_20260617_010000_ECG.txt', text: 'H10-ECG' },
      { name: 'Polar_H10_AAAA_20260617_010000_ACC.txt', text: 'H10-ACC' },
      { name: 'O2Ring S 2100_20260617_010000.csv',      text: 'spo2-rows' }
    ];
    var pcO2 = ORCH.pairCompanions('ecg', 'Polar_H10_AAAA_20260617_010000_ECG.txt', withO2);
    T.eq('  §1 own-device ACC pairs; the O2Ring SpO₂ CSV is ignored', pcO2 && pcO2.acc, 'H10-ACC');

    // §1 (ECG-INGEST-FOLLOWUPS-II) — pairCompanions now consults the SHARED dex-ingest.js registry
    // (DexIngest.deviceKey/foreignVendor), NOT its own local copies, so the device-id + foreign-vendor
    // rules are ONE source across the app (ecgdex/ppgdex-app) AND host (orchestrate) ingest paths.
    // Source-mirror: prove the local copies are gone and the fold is wired (the two-copy drift trap closed).
    var orchSrc = (env.sources || {})['signal-orchestrate.js'] || '';
    if (orchSrc) {
      T.ok('§1-II signal-orchestrate no longer declares its OWN deviceKey (folded onto DexIngest)', !/function\s+deviceKey\s*\(/.test(orchSrc));
      T.ok('§1-II signal-orchestrate no longer declares its OWN foreignSignal (folded onto DexIngest)', !/function\s+foreignSignal\s*\(/.test(orchSrc));
      T.ok('§1-II pairCompanions resolves the shared DexIngest registry (root.DexIngest via _ingest guard)', /root\.DexIngest/.test(orchSrc) && /function\s+_ingest\s*\(/.test(orchSrc));
      T.ok('§1-II pairCompanions consults the registry deviceKey + foreignVendor (resolved alias)', /\bDI\.deviceKey\s*\(/.test(orchSrc) && /\bDI\.foreignVendor\s*\(/.test(orchSrc));
    } else {
      T.ok('signal-orchestrate.js source available (env.sources)', false, 'add it to both runners');
    }
    // the fold is behavior-preserving only if DexIngest is co-loaded so pairCompanions can resolve it.
    T.ok('§1-II DexIngest co-loaded alongside SignalOrchestrate (host load order)', !!(env.DexIngest && typeof env.DexIngest.deviceKey === 'function'), env.DexIngest ? '' : 'load dex-ingest.js BEFORE signal-orchestrate.js');

    // UTC-ISO helpers (Clock-Contract-faithful) + a supine ACC renderer (gravity on +z).
    var p2 = function (x, w) { x = '' + x; while (x.length < (w || 2)) x = '0' + x; return x; };
    var iso = function (ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) + '.' + p2(d.getUTCMilliseconds(), 3); };
    var renderACC = function (t0, durSec, fs) { var l = ['Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]'], n = Math.floor(durSec * fs); for (var i = 0; i < n; i++) l.push(iso(t0 + Math.round(i / fs * 1000)) + ';0;6;-4;1000'); return l.join('\n'); };

    // (2) ECG adapter attaches the sidecars from ctx.companions.
    var ecgAd = SA.byId ? SA.byId('polar-h10-ecg') : null;
    T.ok('polar-h10-ecg adapter registered', !!ecgAd);
    if (ecgAd && ECD && typeof ECD.genSynthetic === 'function') {
      var syn = ECD.genSynthetic({ durSec: 12, seed: 20260617 });
      var dt = 1000 / syn.fs, el = ['Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'];
      for (var i = 0; i < syn.int16.length; i++) { var ms = i * dt; el.push(iso(syn.t0Ms + ms) + ';0;' + ms.toFixed(3) + ';' + syn.int16[i]); }
      var ecgText = el.join('\n');
      var rl = ['Phone timestamp;RR-interval [ms]'], rms = 0; for (var ri = 0; ri < 40; ri++) { var rr = 850 + ((ri * 37) % 120) - 60; rms += rr; rl.push(iso(syn.t0Ms + rms) + ';' + rr); }
      var fC = SA.runAdapter(ecgAd, ecgText, { companions: { rr: rl.join('\n'), hr: null, acc: renderACC(syn.t0Ms, 12, 4) } });
      T.ok('ECG frame usable with companions', !!(fC && fC.usable && fC.signalType === 'ecg'), fC && fC.reason);
      T.ok('  deviceRR attached from ctx.companions.rr', Array.isArray(fC.deviceRR) && fC.deviceRR.length > 0, fC.deviceRR && fC.deviceRR.length);
      T.ok('  deviceACC + accFs attached from ctx.companions.acc', Array.isArray(fC.deviceACC) && fC.deviceACC.length > 0 && typeof fC.accFs === 'number', fC.deviceACC && (fC.deviceACC.length + ' @ ' + fC.accFs + 'Hz'));
      T.ok('  frame still schema-valid (companions ride as extra fields)', SF.validateFrame(fC).ok, SF.validateFrame(fC).errors.join('; '));
      var fN = SA.runAdapter(ecgAd, ecgText, {});
      T.ok('no ctx.companions → no device sidecars on the frame (single-text path unchanged)', !fN.deviceRR && !fN.deviceHR && !fN.deviceACC);
    }
    // (3) ECG compute(): deviceACC → epochs[].position posture; none → all 'unknown'.
    if (ECD && typeof ECD.compute === 'function' && typeof ECD.genSynthetic === 'function') {
      var s2 = ECD.genSynthetic({ durSec: 8 * 60, scenario: 'osa' });
      var accFs2 = 4, acc2 = []; for (var a = 0; a < s2.durSec * accFs2; a++) acc2.push({ tsMs: s2.t0Ms + Math.round(a / accFs2 * 1000), x: 6, y: -4, z: 1000 });
      var expWith = ECD.compute({ samples: s2.int16, fs: s2.fs, t0Ms: s2.t0Ms, deviceACC: acc2, accFs: accFs2 }, { rich: true });
      var eps = (expWith.timeseries && expWith.timeseries.epochs) || [];
      var real = eps.filter(function (e) { return e.position && e.position !== 'unknown'; });
      T.ok('deviceACC companion → ≥1 epoch carries a REAL posture (the §2(b) payoff)', real.length > 0, real.length + '/' + eps.length + ' epochs posed');
      var expNo = ECD.compute({ samples: s2.int16, fs: s2.fs, t0Ms: s2.t0Ms }, { rich: true });
      var epsN = (expNo.timeseries && expNo.timeseries.epochs) || [];
      T.ok('no ACC companion → epochs[].position all unknown (degrades, never fabricated)', epsN.length > 0 && epsN.every(function (e) { return (e.position || 'unknown') === 'unknown'; }));
    }
    // (2)+(3) PPG adapter: ctx.companions → frame.acc → compute() motion gate.
    var ppgAd = SA.byId ? SA.byId('polar-sense-ppg') : null;
    T.ok('polar-sense-ppg adapter registered', !!ppgAd);
    if (ppgAd && PG && typeof PG.compute === 'function' && typeof PG.parsePPG === 'function' && SY && typeof SY.renderPPG === 'function' && typeof SY.pickWindow === 'function') {
      var ptl = SY.buildTimelines()[0];
      var pText = SY.renderPPG(ptl, SY.pickWindow(ptl));
      var pf0 = PG.parsePPG(pText);
      var pt0 = (pf0 && pf0.t0Ms != null) ? pf0.t0Ms : Date.UTC(2026, 5, 17, 6, 5, 0);
      var pDur = (pf0 && pf0.durSec) ? pf0.durSec : 540;
      var fP = SA.runAdapter(ppgAd, pText, { companions: { acc: renderACC(pt0, pDur, 26) } });
      T.ok('PPG frame usable with companions', !!(fP && fP.usable && fP.signalType === 'ppg'), fP && fP.reason);
      T.ok('  acc attached from ctx.companions.acc (motion-gate input)', Array.isArray(fP.acc) && fP.acc.length > 0, fP.acc && fP.acc.length);
      T.ok('  frame still schema-valid', SF.validateFrame(fP).ok, SF.validateFrame(fP).errors.join('; '));
      var fPN = SA.runAdapter(ppgAd, pText, {});
      T.ok('no ctx.companions → no motion sidecars on the PPG frame', !fPN.acc && !fPN.gyro && !fPN.devicePPI);
      var expP = PG.compute(fP, { rich: true });
      T.ok('PPG compute(frame+acc) → schema-valid export (motion gate ran, no throw)', !!(expP && expP.schema && expP.schema.node === 'PpgDex' && Array.isArray(expP.ganglior_events)));
      var pPosed = ((expP.timeseries && expP.timeseries.epochs) || []).some(function (e) { return e.position && e.position !== 'unknown'; });
      T.ok('PPG acc companion → ≥1 epoch carries a limb posture', pPosed, 'epochs posed');
    }
  });

  /* ════ INGEST ROUTING TABLE — DexIngest (ECG-INGEST-FOLLOWUPS §3). The pure file-ingest classifiers
     ("which app/stream is this dropped file?") were promoted out of ecgdex-app.js / ppgdex-app.js into the
     shared, headless dex-ingest.js so a regex regression (an _ECG-vs-_ECG2 slip, an O2Ring header rename,
     the device-serial-as-date trap) is GATE-BACKED — the equiv gate exercises compute({text}), never the
     drop path, and the render-coverage rig drives genSynthetic, so this routing was previously untested in
     BOTH gates. BOTH apps now consume DexIngest, so this table IS their live ingest behaviour. ════ */
  group('Ingest routing table — DexIngest classifiers (ECG-INGEST-FOLLOWUPS §3)', 'dex-ingest', function (T) {
    var DI = env.DexIngest;
    if (!(DI && typeof DI.ecgKind === 'function')) { T.ok('DexIngest co-loaded (window.DexIngest / ctx.DexIngest)', false, 'load dex-ingest.js into both runners'); return; }
    // — ECGDex routing: H10 *_ECG primary · *_RR/_HR/_ACC companions · everything else → skip —
    T.eq('ecgKind  _ECG → ecg (the chest-strap waveform)', DI.ecgKind('Polar_H10_AAAAAAAA_20260617_010000_ECG.txt'), 'ecg');
    T.eq('ecgKind  _RR  → rr', DI.ecgKind('Polar_H10_AAAAAAAA_20260617_010000_RR.txt'), 'rr');
    T.eq('ecgKind  _PPI → rr (peak-to-peak shares the rr lane)', DI.ecgKind('Polar_H10_AAAAAAAA_20260617_010000_PPI.txt'), 'rr');
    T.eq('ecgKind  _HR  → hr', DI.ecgKind('Polar_H10_AAAAAAAA_20260617_010000_HR.txt'), 'hr');
    T.eq('ecgKind  _ACC → acc', DI.ecgKind('Polar_H10_AAAAAAAA_20260617_010000_ACC.txt'), 'acc');
    T.eq('ecgKind  _MAGN → skip (the magnetometer-as-ECG bug, report 1)', DI.ecgKind('Polar_Sense_0C30_20260617_010000_MAGN.txt'), 'skip');
    T.eq('ecgKind  _GYRO → skip', DI.ecgKind('Polar_Sense_0C30_20260617_010000_GYRO.txt'), 'skip');
    T.eq('ecgKind  _PPG → skip (optical → PulseDex/PpgDex, never QRS)', DI.ecgKind('Polar_Sense_0C30_20260617_010000_PPG.txt'), 'skip');
    T.eq('ecgKind  MARKER_ → skip', DI.ecgKind('MARKER_20260617_010000.txt'), 'skip');
    T.eq('ecgKind  O2Ring SpO₂ CSV → skip (→ OxyDex, report 2)', DI.ecgKind('O2Ring S 2100_20260612230016.csv'), 'skip');
    T.eq('ecgKind  Checkme/Wellue → skip', DI.ecgKind('Checkme_O2_20260617.csv'), 'skip');
    T.eq('ecgKind  Libre/CGM → skip (→ GlucoDex)', DI.ecgKind('Libre_glucose_2026.csv'), 'skip');
    T.eq('ecgKind  bare .dat waveform → ecg (suffix-less default)', DI.ecgKind('recording_001.dat'), 'ecg');
    // — PpgDex routing: Sense *_PPG primary · acc/gyro/magn/ppi/marker companions · _ECG + foreign → skip —
    T.eq('ppgKind  _PPG → ppg', DI.ppgKind('Polar_Sense_0C30_20260617_010000_PPG.txt'), 'ppg');
    T.eq('ppgKind  _ACC → acc (companion, NOT skip — the PPG asymmetry)', DI.ppgKind('Polar_Sense_0C30_20260617_010000_ACC.txt'), 'acc');
    T.eq('ppgKind  _GYRO → gyro (companion)', DI.ppgKind('Polar_Sense_0C30_20260617_010000_GYRO.txt'), 'gyro');
    T.eq('ppgKind  _MAGN → magn (companion)', DI.ppgKind('Polar_Sense_0C30_20260617_010000_MAGN.txt'), 'magn');
    T.eq('ppgKind  _PPI → ppi (companion)', DI.ppgKind('Polar_Sense_0C30_20260617_010000_PPI.txt'), 'ppi');
    T.eq('ppgKind  _HR  → hr (ignored-with-note)', DI.ppgKind('Polar_Sense_0C30_20260617_010000_HR.txt'), 'hr');
    T.eq('ppgKind  MARKER → marker', DI.ppgKind('Polar_Sense_0C30_20260617_010000_MARKER.txt'), 'marker');
    T.eq('ppgKind  _ECG → skip (raw ECG → ECGDex, never a PPG waveform)', DI.ppgKind('Polar_H10_AAAAAAAA_20260617_010000_ECG.txt'), 'skip');
    T.eq('ppgKind  O2Ring SpO₂ → skip', DI.ppgKind('O2Ring S 2100_20260612230016.csv'), 'skip');
    T.eq('ppgKind  bare waveform → ppg (suffix-less default)', DI.ppgKind('recording_001.dat'), 'ppg');
    // — deviceKey: H10 vs Sense split; null for bare / non-Polar —
    T.eq('deviceKey H10 session', DI.deviceKey('Polar_H10_AAAAAAAA_20260617_010000_ECG.txt'), 'POLAR_H10_AAAAAAAA');
    T.eq('deviceKey Sense session (DIFFERENT id → H10≠Sense)', DI.deviceKey('Polar_Sense_BBBBBBBB_20260617_010000_PPG.txt'), 'POLAR_SENSE_BBBBBBBB');
    T.ok('deviceKey null for a bare name', DI.deviceKey('recording_001.dat') === null);
    T.ok('deviceKey null for an O2Ring CSV', DI.deviceKey('O2Ring S 2100_20260612230016.csv') === null);
    // — stampMs: floating wall-clock, ANCHORED after the (possibly all-numeric) 8-digit serial —
    T.eq('stampMs reads the session stamp', DI.stampMs('Polar_H10_AAAAAAAA_20260617_010000_ECG.txt'), Date.UTC(2026, 5, 17, 1, 0, 0));
    T.eq('stampMs anchors past an ALL-NUMERIC serial (no serial-as-date misread)', DI.stampMs('Polar_H10_12345678_20260617_233000_ECG.txt'), Date.UTC(2026, 5, 17, 23, 30, 0));
    T.ok('stampMs null for a bare name', DI.stampMs('recording_001.dat') === null);
    // — foreignVendor —
    T.eq('foreignVendor O2Ring → spo2', DI.foreignVendor('O2Ring S 2100_20260612230016.csv'), 'spo2');
    T.eq('foreignVendor Libre → cgm', DI.foreignVendor('Libre_glucose_2026.csv'), 'cgm');
    T.ok('foreignVendor Polar ECG → null (not foreign)', DI.foreignVendor('Polar_H10_AAAAAAAA_20260617_010000_ECG.txt') === null);
    // — sniffFirstLine: header content-sniff verdicts (node-neutral; caller decides which is foreign) —
    T.eq('sniff  ecg [uV] header → ecg', DI.sniffFirstLine('Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'), 'ecg');
    T.eq('sniff  Verity channel/ambient → ppg', DI.sniffFirstLine('Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient'), 'ppg');
    T.eq('sniff  X [dps] → gyro', DI.sniffFirstLine('Phone timestamp;sensor timestamp [ns];X [dps];Y [dps];Z [dps]'), 'gyro');
    T.eq('sniff  X [G] → magn', DI.sniffFirstLine('Phone timestamp;sensor timestamp [ns];X [G];Y [G];Z [G]'), 'magn');
    T.eq('sniff  X [mg] → acc', DI.sniffFirstLine('Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]'), 'acc');
    T.eq('sniff  SpO₂ header → spo2', DI.sniffFirstLine('Time,SpO2,Pulse Rate,Motion'), 'spo2');
    T.eq('sniff  glucose header → cgm', DI.sniffFirstLine('Device,Serial,Glucose mg/dL'), 'cgm');
    T.ok('sniff  bare-numeric first row → null (a plain .dat passes as primary)', DI.sniffFirstLine('123,456,789') === null);
    T.ok('sniff  empty first line → null', DI.sniffFirstLine('') === null);
  });

  /* ════ INGEST PLANNING — DexIngest.planIngest (ECG-INGEST-FOLLOWUPS-II §4). The ORCHESTRATION of
     ecgdex-app.js loadFiles (bucket → device-anchor companion filter → _RR-over-_PPI → de-dupe →
     part-group) was lifted into the shared, headless dex-ingest.js so the multi-file DROP path is
     gate-backed directly — the equiv gate drives compute({text}) and render-coverage drives
     genSynthetic, so NEITHER exercised a mixed drop. planIngest is NAME-only (the app still runs the
     byte-reading header sniff and feeds verdicts via opts.sniffedForeign). The app CONSUMES it (a
     source-mirror below proves no second drifting copy). ════ */
  group('Ingest planning — DexIngest.planIngest (ECG drop path, ECG-INGEST-FOLLOWUPS-II §4)', 'dex-ingest · ecgdex-app', function (T) {
    var DI = env.DexIngest;
    if (!(DI && typeof DI.planIngest === 'function')) { T.ok('DexIngest.planIngest present', false, 'add planIngest to dex-ingest.js + load in both runners'); return; }
    var pk = (env.ECGDSP && env.ECGDSP.partKey) || null;   // real multipart splitter (matches the app's DSP.partKey)
    var nm = function (n) { return { name: n }; };
    var laneNames = function (gs) { return gs.map(function (g) { return g.map(function (x) { return x.name; }); }); };

    // (a) mixed Verity-Sense + H10 drop — the H10 ECG anchors; ONLY same-device companions attach,
    //     the nearer-irrelevant Sense streams are set aside (the "Sense+H10 processes everything" fix).
    var pA = DI.planIngest([
      nm('Polar_H10_AAAA_20260617_010000_ECG.txt'),
      nm('Polar_H10_AAAA_20260617_010000_RR.txt'),
      nm('Polar_H10_AAAA_20260617_010000_ACC.txt'),
      nm('Polar_VS_BBBB_20260617_010001_PPG.txt'),   // foreign optical primary → skip
      nm('Polar_VS_BBBB_20260617_010001_ACC.txt')    // foreign-device companion → otherdevice
    ], { partKey: pk });
    T.eq('(a) one ECG group (the H10 night)', pA.ecgGroups.length, 1);
    T.eq('(a) H10 RR lane attaches (own device)', JSON.stringify(laneNames(pA.companionLanes.rr)), JSON.stringify([['Polar_H10_AAAA_20260617_010000_RR.txt']]));
    T.eq('(a) H10 ACC lane attaches (own device)', JSON.stringify(laneNames(pA.companionLanes.acc)), JSON.stringify([['Polar_H10_AAAA_20260617_010000_ACC.txt']]));
    T.ok('(a) the Verity-Sense _ACC is set aside as other-device (never cross-attached)', pA.skipped.some(function (s) { return s.name === 'Polar_VS_BBBB_20260617_010001_ACC.txt' && s.kind === 'otherdevice'; }));
    T.ok('(a) the Verity-Sense _PPG is set aside (foreign optical stream)', pA.skipped.some(function (s) { return s.name === 'Polar_VS_BBBB_20260617_010001_PPG.txt' && s.kind === 'ppg'; }));

    // (b) _RR-over-_PPI: a Polar H10 session ships both; firmware _RR wins, _PPI drops from the rr lane.
    var pB = DI.planIngest([
      nm('Polar_H10_AAAA_20260617_010000_ECG.txt'),
      nm('Polar_H10_AAAA_20260617_010000_RR.txt'),
      nm('Polar_H10_AAAA_20260617_010000_PPI.txt')
    ], { partKey: pk });
    T.eq('(b) rr lane keeps the firmware _RR only (deterministic, not last-wins)', JSON.stringify(laneNames(pB.companionLanes.rr)), JSON.stringify([['Polar_H10_AAAA_20260617_010000_RR.txt']]));
    var pBp = DI.planIngest([nm('Polar_H10_AAAA_20260617_010000_ECG.txt'), nm('Polar_H10_AAAA_20260617_010000_PPI.txt')], { partKey: pk });
    T.eq('(b) _PPI feeds the rr lane when no _RR is dropped', JSON.stringify(laneNames(pBp.companionLanes.rr)), JSON.stringify([['Polar_H10_AAAA_20260617_010000_PPI.txt']]));

    // (c) duplicate-night set-aside vs genuine multi-night (device id + structured start second).
    var pC = DI.planIngest([nm('Polar_H10_AAAA_20260617_010000_ECG.txt'), nm('Polar_H10_AAAA_20260617_010000_ECG (2).txt')], { partKey: pk });
    T.eq('(c) the duplicate night collapses to ONE ECG group', pC.ecgGroups.length, 1);
    T.ok('(c) the second copy is set aside (kind=duplicate)', pC.skipped.some(function (s) { return s.kind === 'duplicate'; }));
    var pCd = DI.planIngest([nm('Polar_H10_AAAA_20260617_010000_ECG.txt'), nm('Polar_H10_AAAA_20260618_010000_ECG.txt')], { partKey: pk });
    T.eq('(c) two DISTINCT nights both load (different stamp → not a dup)', pCd.ecgGroups.length, 2);

    // (d) the caller's header content-sniff verdict: a misnamed _ECG (sniffed non-ECG) is set aside.
    var pD = DI.planIngest([nm('Polar_H10_AAAA_20260617_010000_ECG.txt')], { partKey: pk, sniffedForeign: new Map([['Polar_H10_AAAA_20260617_010000_ECG.txt', 'magn']]) });
    T.eq('(d) a sniff-foreign ECG yields NO ECG group', pD.ecgGroups.length, 0);
    T.ok('(d) it is set aside with the sniffed kind (magnetometer-as-ECG guard)', pD.skipped.some(function (s) { return s.kind === 'magn'; }));

    // (e) companions-ONLY drop anchors on the ACTIVE recording's device (§4 cross-drop awareness).
    var pE = DI.planIngest([nm('Polar_VS_BBBB_20260617_010001_ACC.txt')], { partKey: pk, activeDeviceKey: 'POLAR_H10_AAAA' });
    T.eq('(e) no ECG → no ECG group', pE.ecgGroups.length, 0);
    T.ok('(e) a foreign-device sidecar is set aside vs the active H10 recording', pE.skipped.some(function (s) { return s.kind === 'otherdevice'; }));
    var pEs = DI.planIngest([nm('Polar_H10_AAAA_20260617_010000_ACC.txt')], { partKey: pk, activeDeviceKey: 'POLAR_H10_AAAA' });
    T.eq('(e) a same-device sidecar attaches to the active recording', JSON.stringify(laneNames(pEs.companionLanes.acc)), JSON.stringify([['Polar_H10_AAAA_20260617_010000_ACC.txt']]));

    // (f) the app CONSUMES planIngest (single source, no drifting second copy of the orchestration).
    var app = (env.sources || {})['ecgdex-app.js'] || '';
    if (app) {
      T.ok('(f) ecgdex-app loadFiles consults ING.planIngest', /\bING\.planIngest\s*\(/.test(app));
      T.ok('(f) the per-app grouping + companion de-dupe copies are GONE (folded into planIngest)', !/function\s+groupFileParts\s*\(/.test(app) && !/function\s+dedupeCompanionGroups\s*\(/.test(app));
    } else {
      T.ok('ecgdex-app.js source available (env.sources)', false, 'add it to both runners');
    }
  });

  /* ════ INGEST PLANNING — DexIngest.planIngestPpg (ECG-INGEST-FOLLOWUPS-III §1). The PpgDex sibling of
     planIngest. PpgDex's loadFiles is CONTENT-first (reads every file's text, folds multipart on PARSED
     objects, picks the nearest companion by the PARSED rec.t0Ms), so a NAME-only planner owns only what
     IS name-based — classify · skip/foreign · duplicate-session set-aside · per-primary device-ELIGIBILITY
     — and the app keeps the rec.t0Ms nearest pick over the returned eligible candidates. The return is
     PER-PRIMARY (eligibleByPrimary), NOT global lanes, and there is no partKey fold (PPG merges multipart
     content-side first). Same gap §4 closed for ECG: the equiv gate drives compute({text}) and render-
     coverage drives genSynthetic — NEITHER a multi-file drop — so the mixed Sense+H10 split + the
     duplicate-`_PPG` set-aside were live-only. The app CONSUMES it (a source-mirror proves no second copy). ════ */
  group('Ingest planning — DexIngest.planIngestPpg (PPG drop path, ECG-INGEST-FOLLOWUPS-III §1)', 'dex-ingest · ppgdex-app', function (T) {
    var DI = env.DexIngest;
    if (!(DI && typeof DI.planIngestPpg === 'function')) { T.ok('DexIngest.planIngestPpg present', false, 'add planIngestPpg to dex-ingest.js + load in both runners'); return; }
    var nm = function (n) { return { name: n }; };
    var names = function (arr) { return (arr || []).map(function (x) { return x.name; }); };

    // (a) mixed Verity-Sense + H10 drop — the Sense `_PPG` is the primary; ONLY same-device Sense
    //     companions are eligible; the H10 `_ECG` is set aside (foreign raw-ECG), the H10 `_ACC` is
    //     never eligible for the Sense PPG (the "Sense+H10 processes everything" bug class, PPG side).
    var pA = DI.planIngestPpg([
      nm('Polar_VS_BBBB_20260617_010001_PPG.txt'),
      nm('Polar_VS_BBBB_20260617_010001_ACC.txt'),
      nm('Polar_VS_BBBB_20260617_010001_GYRO.txt'),
      nm('Polar_H10_AAAA_20260617_010000_ECG.txt'),   // foreign raw-ECG primary → skip
      nm('Polar_H10_AAAA_20260617_010000_ACC.txt')    // foreign-device companion → not eligible
    ]);
    T.eq('(a) one PPG primary (the Sense session)', pA.ppgPrimaries.length, 1);
    var eligA = pA.eligibleByPrimary['Polar_VS_BBBB_20260617_010001_PPG.txt'] || {};
    T.eq('(a) Sense ACC is eligible (own device)', JSON.stringify(names(eligA.acc)), JSON.stringify(['Polar_VS_BBBB_20260617_010001_ACC.txt']));
    T.eq('(a) Sense GYRO is eligible (own device)', JSON.stringify(names(eligA.gyro)), JSON.stringify(['Polar_VS_BBBB_20260617_010001_GYRO.txt']));
    T.ok('(a) the H10 _ECG is set aside (foreign raw-ECG stream → ECGDex)', pA.skipped.some(function (s) { return s.name === 'Polar_H10_AAAA_20260617_010000_ECG.txt' && s.kind === 'ecg'; }));
    T.ok('(a) the H10 _ACC is NOT eligible for the Sense PPG (cross-device)', !names(eligA.acc).some(function (n) { return n === 'Polar_H10_AAAA_20260617_010000_ACC.txt'; }));

    // (b) duplicate-_PPG set-aside vs genuine multi-session (device id + structured start second).
    var pB = DI.planIngestPpg([nm('Polar_VS_BBBB_20260617_010001_PPG.txt'), nm('Polar_VS_BBBB_20260617_010001_PPG (2).txt')]);
    T.eq('(b) the duplicate session collapses to ONE PPG primary', pB.ppgPrimaries.length, 1);
    T.ok('(b) the second copy is set aside (kind=duplicate)', pB.skipped.some(function (s) { return s.kind === 'duplicate'; }));
    var pBd = DI.planIngestPpg([nm('Polar_VS_BBBB_20260617_010001_PPG.txt'), nm('Polar_VS_BBBB_20260618_010001_PPG.txt')]);
    T.eq('(b) two DISTINCT sessions both load (different stamp → not a dup)', pBd.ppgPrimaries.length, 2);

    // (c) device `_HR` → the ignored-with-note lane (not a primary, not a companion).
    var pC = DI.planIngestPpg([nm('Polar_VS_BBBB_20260617_010001_PPG.txt'), nm('Polar_VS_BBBB_20260617_010001_HR.txt')]);
    T.eq('(c) a Polar device _HR routes to the ignored-with-note lane', pC.hr.length, 1);
    T.eq('(c) ... and does not reduce the PPG primary', pC.ppgPrimaries.length, 1);

    // (d) the caller's header content-sniff verdict: a misnamed _PPG (sniffed non-PPG) is set aside.
    var pD = DI.planIngestPpg([nm('Polar_VS_BBBB_20260617_010001_PPG.txt')], { sniffedForeign: { 'Polar_VS_BBBB_20260617_010001_PPG.txt': 'ecg' } });
    T.eq('(d) a sniff-foreign PPG yields NO PPG primary', pD.ppgPrimaries.length, 0);
    T.ok('(d) it is set aside with the sniffed kind (raw-ECG-as-PPG guard)', pD.skipped.some(function (s) { return s.kind === 'ecg'; }));

    // (e) PER-PRIMARY device split — each `_PPG` is eligible ONLY for its own device's sidecars (the
    //     final nearest-stamp pick over these stays app-side; this gates the eligibility upstream of it).
    var pE = DI.planIngestPpg([
      nm('Polar_VS_BBBB_20260617_010001_PPG.txt'),
      nm('Polar_VS_CCCC_20260618_020002_PPG.txt'),
      nm('Polar_VS_BBBB_20260617_010001_ACC.txt'),
      nm('Polar_VS_CCCC_20260618_020002_ACC.txt')
    ]);
    T.eq('(e) two distinct-device PPG primaries', pE.ppgPrimaries.length, 2);
    var eB = pE.eligibleByPrimary['Polar_VS_BBBB_20260617_010001_PPG.txt'] || {}, eC = pE.eligibleByPrimary['Polar_VS_CCCC_20260618_020002_PPG.txt'] || {};
    T.eq('(e) BBBB PPG is eligible ONLY for the BBBB ACC', JSON.stringify(names(eB.acc)), JSON.stringify(['Polar_VS_BBBB_20260617_010001_ACC.txt']));
    T.eq('(e) CCCC PPG is eligible ONLY for the CCCC ACC', JSON.stringify(names(eC.acc)), JSON.stringify(['Polar_VS_CCCC_20260618_020002_ACC.txt']));

    // (f) the app CONSUMES planIngestPpg (single source, no drifting second copy of the orchestration).
    var app = (env.sources || {})['ppgdex-app.js'] || '';
    if (app) {
      T.ok('(f) ppgdex-app loadFiles consults ING.planIngestPpg', /\bING\.planIngestPpg\s*\(/.test(app));
      T.ok('(f) the inline dedupe + device-eligibility copies are GONE (folded into planIngestPpg)', !/seen\.has\(sig\)/.test(app) && !/cd===pfDev/.test(app));
    } else {
      T.ok('ppgdex-app.js source available (env.sources)', false, 'add it to both runners');
    }
  });

  /* ════ COMPANION PICK — DexIngest.pickNearestByStamp (ECG-INGEST-FOLLOWUPS-IV §1). planIngestPpg
     device-FILTERS the candidates per primary but deliberately leaves the nearest-`t0Ms` PICK app-side
     (it needs the PARSED rec.t0Ms). After -III that pick was the SOLE un-gated link in PPG companion
     association — and PPG-UNIQUE (ECG's planIngest loads every deduped companion per lane; no pick to
     mirror). -IV §1 extracts it to this headless surface. The biting case: two SAME-device sessions
     dropped together expose BOTH sidecars as device-eligible for BOTH primaries — ONLY this pick
     assigns each its own. ════ */
  group('Companion pick — DexIngest.pickNearestByStamp (PPG nearest-t0Ms, ECG-INGEST-FOLLOWUPS-IV §1)', 'dex-ingest · ppgdex-app', function (T) {
    var DI = env.DexIngest;
    if (!(DI && typeof DI.pickNearestByStamp === 'function')) { T.ok('DexIngest.pickNearestByStamp present', false, 'add pickNearestByStamp to dex-ingest.js + load in both runners'); return; }
    var c = function (n, ms) { return { name: n, stampMs: ms }; };
    var s1 = 1782000000000, s2 = s1 + 24 * 3600 * 1000;   // two sessions ~24 h apart
    var accs = [c('A_s1', s1), c('A_s2', s2)];
    // (a) each session's ref picks its OWN nearest companion (not the other session's).
    T.eq('(a) session-1 ref picks its own ACC', DI.pickNearestByStamp(accs, s1).name, 'A_s1');
    T.eq('(a) session-2 ref picks its own ACC (no cross-pair)', DI.pickNearestByStamp(accs, s2).name, 'A_s2');
    // (b) the rec.t0Ms || pf.stampMs reference need not be exact — nearest still resolves correctly.
    T.eq('(b) a ref 1 min after s1 still picks s1', DI.pickNearestByStamp(accs, s1 + 60000).name, 'A_s1');
    // (c) empty candidate set → null (no attach); a single candidate → itself (ref irrelevant).
    T.eq('(c) empty candidates → null', DI.pickNearestByStamp([], s1), null);
    T.eq('(c) single candidate → itself', DI.pickNearestByStamp([c('only', s2)], 0).name, 'only');
    // (d) ties → FIRST (deterministic); a missing .stampMs counts as 0 (byte-faithful to the old closure).
    T.eq('(d) equal distance → first candidate wins', DI.pickNearestByStamp([c('x', 100), c('y', 100)], 0).name, 'x');
    // (e) the app CONSUMES it (no drifting inline distance-pick copy left in ppgdex-app.js).
    var app = (env.sources || {})['ppgdex-app.js'] || '';
    if (app) {
      T.ok('(e) ppgdex-app nearest consults ING.pickNearestByStamp', /\bING\.pickNearestByStamp\s*\(/.test(app));
      T.ok('(e) the inline distance-pick copy is GONE', !/Math\.abs\(\(c\.stampMs/.test(app));
    } else {
      T.ok('ppgdex-app.js source available (env.sources)', false, 'add it to both runners');
    }
  });

  /* ════ INGEST PLANNER PRIMITIVES — shared dedupe + device-eligibility (ECG-INGEST-FOLLOWUPS-IV §2).
     -III's option (a) (a whole-plan PPG sibling) left the device-session dedupe + the device-eligibility
     predicate DUPLICATED inline in planIngest (ECG) AND planIngestPpg (PPG) — the same two-copy drift
     trap dex-ingest.js closed at the classifier layer (ecgKind/ppgKind), reopened one layer up. -IV §2
     factors `_dedupeBySession` + `_isDeviceEligible` as ONE source each, called by both planners. The
     behavior is gated by the planIngest/planIngestPpg groups above (they route through these); this
     source-mirror prevents a future inline re-implementation drifting one planner from the other. ════ */
  group('Ingest planner primitives — shared dedupe + eligibility (ECG-INGEST-FOLLOWUPS-IV §2)', 'dex-ingest', function (T) {
    var src = (env.sources || {})['dex-ingest.js'] || '';
    if (!src) { T.ok('dex-ingest.js source available (env.sources)', false, 'add it to both runners'); return; }
    T.eq('_dedupeBySession defined exactly once', (src.match(/function\s+_dedupeBySession\s*\(/g) || []).length, 1);
    T.eq('_isDeviceEligible defined exactly once', (src.match(/function\s+_isDeviceEligible\s*\(/g) || []).length, 1);
    // both planners (+ the _dedupeGroups companion wrapper) route through the shared primitives.
    T.ok('the shared dedupe is CALLED by both planners (≥2 call sites beyond its definition)', (src.match(/_dedupeBySession\s*\(/g) || []).length >= 3);
    T.ok('the shared eligibility predicate is CALLED by both planners (≥2 call sites beyond its definition)', (src.match(/_isDeviceEligible\s*\(/g) || []).length >= 3);
    // the keep-first signature loop now lives in EXACTLY ONE place (no second inline copy in a planner).
    T.eq('the `seen[sig]` keep-first loop exists in ONE place only (_dedupeBySession)', (src.match(/seen\[sig\]\s*=\s*1/g) || []).length, 1);
  });

  /* ════ MANIFEST JSON WELL-FORMED — BUILD-MANIFEST + FIXTURE-PROVENANCE parse (ECG-INGEST-FOLLOWUPS §6).
     A stray-quote corruption once shipped FIXTURE-PROVENANCE.json as invalid JSON, which made
     verify-provenance.html GATE B unable to JSON.parse the sidecar — and it degraded SILENTLY (FIXPROV=null
     → code-gated fixtures fell back to the coarse buildHash check) instead of going red. This cheap
     structural assertion catches a future corruption in BOTH runners (incl. Node CI); verify-provenance now
     hard-fails visibly on a parse error too. SIGNAL-ADAPTER-AND-FRONTIER Phase 7 retired that buildHash
     fallback entirely (GATE B is now the content-addressed known-answer audit), and extended the structural
     check below to the new schema: every fixture is { bundle, manifestHash, inputHashes, outputHash } (or a
     historical byte-pinned { bundle, historical, outputHash }), and NO record may carry a (retired) buildHash. ════ */
  group('Manifest JSON well-formed — BUILD-MANIFEST + FIXTURE-PROVENANCE (ECG-INGEST-FOLLOWUPS §6)', 'manifests', function (T) {
    var M = env.manifests || {};
    [['BUILD-MANIFEST.json', 'bundles'], ['FIXTURE-PROVENANCE.json', 'fixtures']].forEach(function (pair) {
      var f = pair[0], topKey = pair[1], txt = M[f];
      if (txt == null) { T.ok(f + ' provided to the runner', false, 'wire env.manifests in both runners'); return; }
      var obj = null, err = '';
      try { obj = JSON.parse(txt); } catch (e) { err = e.message; }
      T.ok(f + ' is valid JSON', obj != null, err);
      T.ok(f + ' has a `' + topKey + '` map', !!(obj && obj[topKey] && typeof obj[topKey] === 'object'));
    });
    if (M['BUILD-MANIFEST.json']) {
      try {
        var b = JSON.parse(M['BUILD-MANIFEST.json']);
        var bad = Object.keys(b.bundles || {}).filter(function (k) { return !/^[0-9a-f]{12}$/.test((b.bundles[k] || {}).manifestHash || ''); });
        T.ok('every BUILD-MANIFEST bundle has a 12-hex manifestHash', bad.length === 0, bad.join(', '));
      } catch (e) {}
    }
    if (M['FIXTURE-PROVENANCE.json']) {
      try {
        var fp = JSON.parse(M['FIXTURE-PROVENANCE.json']);
        var fxs = fp.fixtures || {};
        var hex12 = /^[0-9a-f]{12}$/, hex16 = /^[0-9a-f]{16}$/;
        // Phase 7 (SIGNAL-ADAPTER-AND-FRONTIER): every fixture is a CONTENT-ADDRESSED known-answer.
        //   code-gated: { bundle, 12-hex manifestHash, inputHashes:{file:16-hex} (may be {} for synthetic), 16-hex outputHash }
        //   historical: { bundle, historical:true, 16-hex outputHash }  (byte-pinned only)
        var badf = Object.keys(fxs).filter(function (k) {
          if (k.charAt(0) === '_') return false;                 // tolerate any metadata key under fixtures
          var e = fxs[k] || {};
          if (!e.bundle) return true;
          if (!hex16.test(e.outputHash || '')) return true;      // EVERY record is output-pinned
          if (e.historical) return false;                        // historical = byte-pinned only, OK
          if (!hex12.test(e.manifestHash || '')) return true;    // code-gated needs the executed-code hash
          var ih = e.inputHashes;
          if (ih == null || typeof ih !== 'object') return true; // ... and an inputHashes map (possibly empty)
          return Object.keys(ih).some(function (f) { return !hex16.test(ih[f] || ''); });
        });
        T.ok('every FIXTURE-PROVENANCE fixture is a content-addressed known-answer {bundle, manifestHash, inputHashes, outputHash} (or historical+outputHash)', badf.length === 0, badf.join(', '));
        // Phase 7: buildHash is RETIRED as a provenance signal — no fixture record may carry one.
        var withBuild = Object.keys(fxs).filter(function (k) { return k.charAt(0) !== '_' && fxs[k] && fxs[k].buildHash != null; });
        T.ok('no FIXTURE-PROVENANCE record carries a (retired) buildHash field', withBuild.length === 0, withBuild.join(', '));
      } catch (e) {}
    }

    /* GATE-LIVE-RUNNABILITY §3 (+ FOLLOWUPS §4) — gate-back verify-provenance.html's parse-failure
       banner branch WITHOUT touching the real committed sidecar (the brief's "corrupt it momentarily"
       instruction risks shipping a corrupted gate if a revert step fails). FOLLOWUPS §4 gave it TEETH:
       instead of a private MIRROR of the banner stems (which could drift silently from the page), we
       assert against env.pickProvenanceBanner — the SHARED pure fn (provenance-banner.js) that
       verify-provenance.html itself renders — so an edit to a real banner message goes RED here. We
       feed a KNOWN-BAD JSON string through the same JSON.parse(...)+catch path the page uses to SET
       FIXPROV_ERR/MANIFEST_ERR. Pure in-memory → runs identically in Node CI + the browser suite. */
    (function redBranchBannerLogic() {
      var pickBanner = env.pickProvenanceBanner;
      if (typeof pickBanner !== 'function') {
        T.ok('pickProvenanceBanner wired into the runner (provenance-banner.js)', false, 'load provenance-banner.js + expose env.pickProvenanceBanner in BOTH runners');
        return;
      }
      // derive a REAL error message exactly as the page does: JSON.parse(bad) inside try/catch.
      // Trailing comma == the class of stray-quote/comma corruption that once shipped the sidecar invalid.
      var bad = '{ "fixtures": { "x.json": { "bundle": "ECGDex.html", "manifestHash": "abc" }, } }';
      var obj = null, err = '';
      try { obj = JSON.parse(bad); } catch (e) { err = e.message; }
      T.ok('known-bad JSON throws (the parse path that sets *_ERR fires)', obj === null && err.length > 0, err);
      // RED branch: a captured *_ERR must select the VISIBLE FAIL banner the PAGE renders (no silent fall-back).
      var bFix = pickBanner({ MANIFEST: { bundles: {} }, gateAChecked: 8, gateAComplete: true, bundlesLength: 8, FIXPROV_ERR: err });
      T.ok('GATE B banner → FAIL when FIXPROV_ERR is set', /GATE B FAIL — FIXTURE-PROVENANCE\.json failed to load\/parse/.test(bFix.gateB), bFix.gateB);
      var bMan = pickBanner({ MANIFEST: null, MANIFEST_ERR: err, bundlesLength: 8 });
      T.ok('GATE A banner → FAIL when MANIFEST absent + MANIFEST_ERR set', /GATE A FAIL — BUILD-MANIFEST\.json failed to load\/parse/.test(bMan.gateA), bMan.gateA);
      // GREEN contrast: a clean parse + complete manifest must NOT trip either FAIL branch (catches an inverted predicate).
      var bOk = pickBanner({ MANIFEST: { bundles: {} }, gateAChecked: 8, gateAComplete: true, bundlesLength: 8, FIXPROV_ERR: null });
      T.ok('GATE B banner → parsed (no FAIL) when FIXPROV_ERR is null', /FIXTURE-PROVENANCE\.json parsed/.test(bOk.gateB) && !/FAIL/.test(bOk.gateB));
      T.ok('GATE A banner → PASS (no FAIL) when MANIFEST present + complete', /GATE A PASS/.test(bOk.gateA) && !/FAIL/.test(bOk.gateA));
    })();
  });

  /* ════ ORIENTATION MAP — the Dex roster stays current (rot-gate for ORIENTATION.md). ORIENTATION.md's
     one volatile list is the Dex roster table; this asserts every shipped bundle (BUILD-MANIFEST.json) is
     named in the map, so shipping a node + forgetting the doc REDS the suite (the same gate trick used to
     keep registries/guides honest). env.docs['ORIENTATION.md'] + env.manifests['BUILD-MANIFEST.json'] are
     wired into BOTH runners (run-tests.mjs readDocs + Dex-Test-Suite docs fetch). ════ */
  group('Orientation map — roster covers the shipped fleet (ORIENTATION.md)', 'docs · orientation', function (T) {
    var orient = (env.docs || {})['ORIENTATION.md'];
    if (orient == null) { T.ok('ORIENTATION.md provided to the runner', false, 'wire ORIENTATION.md into env.docs (readDocs + Dex-Test-Suite docs fetch)'); return; }
    var nodes = [];
    try { var bm = JSON.parse((env.manifests || {})['BUILD-MANIFEST.json'] || '{}'); nodes = Object.keys(bm.bundles || {}).map(function (k) { return k.replace(/\.html$/, ''); }); } catch (e) {}
    T.ok('derived the shipped fleet from BUILD-MANIFEST.json', nodes.length >= 7, nodes.join(', '));
    var missing = nodes.filter(function (n) { return orient.indexOf(n) < 0; });
    T.ok('every shipped bundle is named in ORIENTATION.md (roster not stale)', missing.length === 0, 'missing: ' + missing.join(', '));
  });

  /* ════ HOST EMIT ALLOWLIST — ecg/ppg/cgm now emit in the live hosts (HOST-EMIT-ALLOWLIST-2026-06-27).
     Both hosts (Data Unifier `canEmit` / OverDex auto-emit) gated their emit UI to rr/spo2/hrv, so the
     migrated cgm/ppg/ecg nodes never emitted in the live UI. Now both gate on the SHARED predicate
     SignalOrchestrate.canEmit (ONE place, no per-host drift), which covers exactly the 6 nodes with an
     emit path; aux channels (acc/hr companions) stay non-emitters. ════ */
  group('Host emit allowlist — SignalOrchestrate.canEmit covers the migrated nodes (HOST-EMIT-ALLOWLIST)', 'signal-orchestrate · co-load', function (T) {
    var ORCH = env.SignalOrchestrate;
    if (!(ORCH && typeof ORCH.canEmit === 'function')) { T.ok('SignalOrchestrate.canEmit present', false, 'load signal-orchestrate.js into both runners'); return; }
    ['rr', 'spo2', 'hrv', 'cgm', 'ppg', 'ecg', 'cpap'].forEach(function (t) { T.ok('canEmit(' + t + ') = true (has an emit path)', ORCH.canEmit(t) === true); });
    ['acc', 'hr', 'eeg', 'flow', 'unknown', ''].forEach(function (t) { T.ok('canEmit(' + t + ') = false (aux / unmigrated)', ORCH.canEmit(t) === false); });
    T.ok('canEmit(null/undefined) = false (no fabrication)', ORCH.canEmit(null) === false && ORCH.canEmit(undefined) === false);
    // every emittable type must actually have an emitNodeExport dispatch — canEmit can't advertise a broken path.
    var orchSrc = (env.sources || {})['signal-orchestrate.js'] || '';
    if (orchSrc) ['rr', 'spo2', 'hrv', 'cgm', 'ppg', 'ecg', 'cpap'].forEach(function (st) { T.ok('emitNodeExport dispatches "' + st + '"', new RegExp("st === '" + st + "'").test(orchSrc)); });
    // both hosts gate on the SHARED predicate (no per-host rr/spo2/hrv literal that drifts) — when present in env.
    var du = (env.sources || {})['data-unifier-app.js'], od = (env.sources || {})['overdex-app.js'];
    if (du) T.ok('Data Unifier canEmit routes through SignalOrchestrate.canEmit', /SignalOrchestrate\.canEmit\(/.test(du));
    if (od) T.ok('OverDex auto-emit routes through SignalOrchestrate.canEmit', /\.canEmit\(\s*sigType\s*\)/.test(od));
  });

  /* ════ GLUCODEX CLAMP-SATURATION HONESTY FLAG (GLUCODEX-FOLLOWUPS §2). A clamped CGM (Abbott Lingo
     clips 55–200 mg/dL) under-counts below/above-range, so the nocturnal_hypo events fired off the clip
     FLOOR may be artifacts, not true hypos. glucoBuildNodeExport now surfaces the clamp fact on
     recording.clamp + stamps those events meta.clampFloor:true; the Integrator's adaptGlucoDex reads it
     → summary.clampSat + down-weights the clip-floor hypos (conf ×0.5). Lock both sides + back-compat. ════ */
  group('GlucoDex clamp-saturation honesty flag (GLUCODEX-FOLLOWUPS §2)', 'glucodex-dsp · integrator-dsp', function (T) {
    var G = env.GlucoDex || env.GLUDSP, A = env.adaptEnvelopeNode;
    var build = G && (G.buildNodeExport || G._build);
    if (typeof build !== 'function') { T.ok('GlucoDex.buildNodeExport available', false); return; }
    var t0 = U(2026, 5, 23, 22, 0, 0);
    var clampedR = {
      source: 'file', t0Ms: t0,
      clampSat: { detected: true, vendor: 'lingo', floor: { value: 55, saturated: true }, ceiling: { value: 200, saturated: true }, blindMetrics: ['tbr1', 'tbr2', 'lbgi', 'min', 'nocturnalHypo', 'tar1'] },
      events: [
        { t: '22:30:00', tMs: t0 + 30 * 60000, impulse: 'nocturnal_hypo', node: 'GlucoDex', conf: 0.9, meta: { minMgdl: 55, durMin: 25 } },
        { t: '03:10:00', tMs: t0 + 310 * 60000, impulse: 'nocturnal_hypo', node: 'GlucoDex', conf: 0.8, meta: { minMgdl: 55, durMin: 40 } },
        { t: '07:00:00', tMs: t0 + 540 * 60000, impulse: 'glucose_excursion', node: 'GlucoDex', conf: 0.7, meta: { riseMgdl: 60 } }
      ]
    };
    var exp = build(clampedR, {});
    T.ok('clamped export carries recording.clamp.detected:true', !!(exp.recording && exp.recording.clamp && exp.recording.clamp.detected === true));
    T.eq('  clamp.vendor', exp.recording.clamp.vendor, 'lingo');
    T.eq('  clamp.floor (clip value)', exp.recording.clamp.floor, 55);
    T.ok('  clamp.blindMetrics lists nocturnalHypo', (exp.recording.clamp.blindMetrics || []).indexOf('nocturnalHypo') >= 0);
    var hypos = exp.ganglior_events.filter(function (e) { return e.impulse === 'nocturnal_hypo'; });
    T.ok('  both clip-floor nocturnal_hypo stamped meta.clampFloor:true', hypos.length === 2 && hypos.every(function (e) { return e.meta && e.meta.clampFloor === true; }));
    T.ok('  the glucose_excursion is NOT stamped (only clip-floor hypos)', exp.ganglior_events.filter(function (e) { return e.impulse === 'glucose_excursion'; }).every(function (e) { return !(e.meta && e.meta.clampFloor); }));
    // clean export → recording.clamp.detected:false, event stream byte-identical (back-compat).
    var cleanR = { source: 'file', t0Ms: t0, clampSat: { detected: false, floor: { saturated: false }, ceiling: { saturated: false }, vendor: null, blindMetrics: [] },
      events: [{ t: '02:00:00', tMs: t0 + 240 * 60000, impulse: 'nocturnal_hypo', node: 'GlucoDex', conf: 0.85, meta: { minMgdl: 62 } }] };
    var expC = build(cleanR, {});
    T.ok('clean export → recording.clamp.detected:false', !!(expC.recording.clamp && expC.recording.clamp.detected === false));
    T.ok('clean export → nocturnal_hypo NOT stamped (no clamp)', !(expC.ganglior_events[0].meta && expC.ganglior_events[0].meta.clampFloor));
    // Integrator adaptGlucoDex: surfaces the clamp + down-weights the clip-floor hypos.
    if (typeof A === 'function') {
      var rec = A(exp, 'GlucoDex', 'gluco-clamp.json')[0];
      T.ok('adaptGlucoDex surfaces summary.clampSat (vendor lingo)', !!(rec && rec.summary && rec.summary.clampSat && rec.summary.clampSat.vendor === 'lingo'));
      var adHypos = (rec.events || []).filter(function (e) { return e.impulse === 'nocturnal_hypo'; });
      T.ok('  clip-floor hypos flagged + conf down-weighted ×0.5', adHypos.length === 2 && adHypos.every(function (e) { return e.clampFloor === true && e.conf <= 0.451; }), adHypos.map(function (e) { return e.conf; }).join(','));
      var recC = A(expC, 'GlucoDex', 'gluco-clean.json')[0];
      T.ok('  clean export → summary.clampSat null (no down-weight)', !!(recC && recC.summary && recC.summary.clampSat == null));
    }
  });

  /* ════ GlucoDex EVENT BYTE-SHAPE — dawn_surge (GLUCODEX-FOLLOWUPS §6). The Lingo equiv fixture emits
     nocturnal_hypo + glucose_excursion but ZERO dawn_surge, so that third impulse's t/tMs/conf/meta
     byte-shape went untested (the equiv gate byte-checks only impulses actually present). genSynthetic
     is non-deterministic (Math.random), so drive a HAND-BUILT deterministic CGM frame — a planted
     ≥20 mg/dL pre-breakfast (06–08h) rise over the 03–06h nadir — straight through compute() (= analyze
     → buildEvents → glucoBuildNodeExport) and lock the dawn_surge byte-shape + byte-reproducibility.
     Self-contained (the input is deterministic in-test, no committed fixture); covers the impulse the
     real fixture can't reach. ════ */
  group('GlucoDex event byte-shape — dawn_surge (GLUCODEX-FOLLOWUPS §6)', 'glucodex-dsp', function (T) {
    var G = env.GlucoDex || env.GLUDSP;
    if (!(G && typeof G.compute === 'function')) { T.ok('GlucoDex.compute available', false, 'not loaded'); return; }
    // deterministic 2-day CGM frame @5-min cadence; civil time encoded as floating UTC (Clock Contract).
    var t0 = U(2026, 4, 23, 0, 0, 0), STEP = 5 * 60000, tMs = [], vMgdl = [];
    for (var day = 0; day < 2; day++) {
      for (var m = 0; m < 288; m++) {
        var h = m / 12, v = 95;
        v -= 8 * Math.exp(-Math.pow((h - 3.5) / 1.5, 2));                                       // 03:30 nadir ~87
        v += 38 / (1 + Math.exp(-(h - 5.5) * 1.4)) * Math.exp(-Math.pow(Math.max(0, h - 7.5) / 3, 2)); // dawn rise to ~06–07h
        v += (h >= 12 && h < 14 ? 30 : 0) + (h >= 18 && h < 20 ? 25 : 0);                        // meals (excursions)
        tMs.push(t0 + day * 86400000 + m * STEP); vMgdl.push(Math.round(v));
      }
    }
    var exp = G.compute({ tMs: tMs, vMgdl: vMgdl, unit: 'mg/dL', t0Ms: t0 });
    var dawn = (exp.ganglior_events || []).filter(function (e) { return e.impulse === 'dawn_surge'; });
    T.ok('≥1 dawn_surge emitted from the planted dawn rise', dawn.length >= 1, dawn.length + ' dawn_surge');
    if (dawn.length) {
      var d = dawn[0];
      T.ok('dawn_surge: node GlucoDex', d.node === 'GlucoDex');
      T.ok('dawn_surge: t is HH:MM:SS', /^\d{2}:\d{2}:\d{2}$/.test(d.t), d.t);
      T.ok('dawn_surge: tMs is a finite number', typeof d.tMs === 'number' && isFinite(d.tMs));
      T.ok('dawn_surge: conf is a number in (0,1]', typeof d.conf === 'number' && d.conf > 0 && d.conf <= 1, d.conf + '');
      T.ok('dawn_surge: meta.riseMgdl is a number ≥20 (the flag threshold)', d.meta && typeof d.meta.riseMgdl === 'number' && d.meta.riseMgdl >= 20, d.meta && (d.meta.riseMgdl + ''));
      T.ok('dawn_surge: meta.nadir is a number', d.meta && typeof d.meta.nadir === 'number', d.meta && (d.meta.nadir + ''));
    }
    // byte-reproducible: the same deterministic frame → an identical event stream.
    var exp2 = G.compute({ tMs: tMs.slice(), vMgdl: vMgdl.slice(), unit: 'mg/dL', t0Ms: t0 });
    T.ok('event stream byte-reproducible (deterministic frame → compute)', JSON.stringify(exp.ganglior_events) === JSON.stringify(exp2.ganglior_events));
  });

  /* ════ PpgDex EVENT BYTE-SHAPE — the sqi axis round-trip (PPGDEX-FOLLOWUPS §3). PpgDex events carry an
     extra `sqi` quality axis (R7 — rides ALONGSIDE conf, NOT folded into it): a number for the per-beat-
     quality impulses (e.g. motion_artifact_segment via sqiAt()), null where it doesn't apply. The 6.5-min
     equiv fixture emits 0 events, so the sqi round-trip was untested — and §3 FOUND it broken:
     ppgBuildNodeExport's explicit field-list DROPPED sqi (vs ecgBuildNodeExport, which copies all keys),
     so the PpgDex export silently diverged from ECGDex. §3 fix: carry sqi through. This group locks the
     round-trip via the shared builder on a hand-built event set (deterministic; no 7-MB synthetic optical
     waveform) covering all three sqi states, plus a source-mirror of the emit + preserve contract. ════ */
  group('PpgDex event byte-shape — sqi axis round-trip (PPGDEX-FOLLOWUPS §3)', 'ppgdex-dsp', function (T) {
    var P = env.PpgDex || env.PPGDSP;
    var build = P && (P.buildNodeExport || P._build);
    if (typeof build !== 'function') { T.ok('PpgDex.buildNodeExport available', false, 'not loaded'); return; }
    var t0 = U(2026, 5, 21, 6, 5, 0);
    // hand-built r.events covering the three sqi states buildEvents produces: surge / hrv_drop → sqi null
    // (no per-beat quality), motion_artifact_segment → a real sqi number (the quality flag, via sqiAt()).
    var r = { t0Ms: t0, nn: [820, 835, 810, 845, 800],
      events: [
        { t: '06:07:00', tMs: t0 + 120000, impulse: 'autonomic_surge', node: 'PpgDex', conf: 0.7, sqi: null, meta: { ampBpm: 12, position: null } },
        { t: '06:09:00', tMs: t0 + 240000, impulse: 'hrv_drop', node: 'PpgDex', conf: 0.7, sqi: null, meta: { rmssdFrom: 44, rmssdTo: 26 } },
        { t: '06:11:00', tMs: t0 + 360000, impulse: 'motion_artifact_segment', node: 'PpgDex', conf: 0.3, sqi: 0.41, meta: {} }
      ] };
    var exp = build(r, {});
    var ev = exp.ganglior_events || [];
    T.ok('all 3 events exported', ev.length === 3, ev.length + '');
    T.ok('EVERY exported event carries an sqi key (R7 axis preserved, not dropped)', ev.length === 3 && ev.every(function (e) { return 'sqi' in e; }), ev.map(function (e) { return e.impulse + ':' + ('sqi' in e); }).join(' '));
    T.ok('sqi is a number-in-[0,1] OR null on every event', ev.every(function (e) { return e.sqi === null || (typeof e.sqi === 'number' && e.sqi >= 0 && e.sqi <= 1); }));
    var motion = ev.filter(function (e) { return e.impulse === 'motion_artifact_segment'; })[0];
    T.ok('motion_artifact_segment round-trips a NON-NULL sqi (the quality flag)', !!(motion && motion.sqi === 0.41), motion && (motion.sqi + ''));
    var surge = ev.filter(function (e) { return e.impulse === 'autonomic_surge'; })[0];
    T.ok('autonomic_surge round-trips sqi null (no per-beat quality)', !!(surge && surge.sqi === null));
    // source-mirror: the emit contract (sqi on every event; motion uses sqiAt()) + the §3 preserve fix.
    var src = (env.sources || {})['ppgdex-dsp.js'];
    if (src) {
      T.ok('evt() helper stamps an sqi axis (number|null) on every emitted event', /sqi\s*:\s*\(\s*sqiVal\s*!==\s*undefined\s*\?\s*sqiVal\s*:\s*null\s*\)/.test(src));
      T.ok('motion_artifact_segment passes a real sqi via sqiAt()', /motion_artifact_segment'[\s\S]{0,40}sqiAt\(/.test(src));
      T.ok('ppgBuildNodeExport PRESERVES sqi (the §3 round-trip fix, not the old drop)', /conf:e\.conf,\s*sqi:\(e\.sqi\s*!==\s*undefined/.test(src));
    } else {
      T.ok('ppgdex-dsp.js source available (env.sources)', false, 'add it to both runners');
    }
  });


  /* ════ 12e · ECGDex EVENT BYTE-SHAPE — the surge/stage impulse stream incl. the sqi axis
     + meta (ECGDEX-FOLLOWUPS-2026-06-27 §4). The equiv fixture is 0-event, so the byte-shape
     of ECGDex's emitted impulses went untested. Drive a deterministic overnight synthetic
     through compute() (= analyze → the SHARED ecgBuildNodeExport the app delegates to) and
     lock: autonomic_surge carries conf + a SEPARATE sqi axis (R7) + rich meta; stage_* carries
     conf 0.7 / sqi null / meta {}; the internal _sec helper is stripped; tMs ordering is
     monotonic; and the whole stream is byte-reproducible (so a committed byte-fixture would
     be regenerate-able). ════ */
  group('ECGDex event byte-shape — surge sqi axis + meta, stage, no _sec, deterministic (ECGDEX-FOLLOWUPS §4)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.compute === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.compute + genSynthetic available', false, 'not loaded'); return; }
    var exp = D.compute(D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' }));
    var evs = (exp && exp.ganglior_events) || [];
    T.ok('overnight synthetic emits events', evs.length > 0, evs.length + ' events');
    var surges = evs.filter(function (e) { return e.impulse === 'autonomic_surge'; });
    var stages = evs.filter(function (e) { return /^stage_/.test(e.impulse); });
    T.ok('≥1 autonomic_surge emitted', surges.length > 0, surges.length + '');
    if (surges.length) {
      var s = surges[0];
      T.ok('surge: t is HH:MM:SS', typeof s.t === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(s.t), s.t);
      T.ok('surge: tMs is a finite number', typeof s.tMs === 'number' && isFinite(s.tMs));
      T.ok('surge: node ECGDex', s.node === 'ECGDex');
      T.ok('surge: conf is a number in (0,1]', typeof s.conf === 'number' && s.conf > 0 && s.conf <= 1, s.conf + '');
      T.ok('surge: carries a SEPARATE sqi axis (R7), a number in [0,1]', typeof s.sqi === 'number' && s.sqi >= 0 && s.sqi <= 1, s.sqi + '');
      T.ok('surge: meta is an object (ampBpm/periodSec/…)', s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta), JSON.stringify(s.meta).slice(0, 70));
    }
    if (stages.length) {
      var st = stages[0];
      T.ok('stage: conf 0.7', st.conf === 0.7, st.conf + '');
      T.ok('stage: sqi null (no per-beat quality for a stage transition)', st.sqi === null);
      T.eq('stage: meta is {}', JSON.stringify(st.meta), '{}');
    }
    T.ok('NO event leaks the internal _sec helper', evs.every(function (e) { return !('_sec' in e); }));
    var stamped = evs.filter(function (e) { return typeof e.tMs === 'number'; });
    var mono = true; for (var i = 1; i < stamped.length; i++) if (stamped[i].tMs < stamped[i - 1].tMs) mono = false;
    T.ok('event tMs ordering is monotonic non-decreasing', mono);
    // determinism: same seed + pure analyze ⇒ byte-identical event stream (a committed
    // env.equiv.ecgdex_events fixture would reproduce with 0 diffs).
    var exp2 = D.compute(D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' }));
    T.ok('event stream is byte-reproducible (deterministic genSynthetic → compute)', JSON.stringify(evs) === JSON.stringify((exp2 && exp2.ganglior_events) || []));
  });

  /* ════ 13 · THRESHOLD-EDGE INCLUSIVITY — OxyDex desat (P8) ════ */
  group('Threshold-edge inclusivity — OxyDex desat (P8)', 'oxydex-dsp', function (T) {
    var src = (env.sources || {})['oxydex-dsp.js'];
    if (!src) { T.ok('oxydex-dsp.js source available', false); return; }
    // DEX-EVENT-UNIFY Task A: desaturations are detected ONCE by the canonical primitive
    // detectDesatEvents; ODI and every satellite metric (slopes, hypoxic load, breathing
    // irregularity, post-dip HR, WtDSI/nadir bins) derive from it instead of each re-running
    // a private trailing-MEAN loop that silently disagreed with the headline ODI. Lock the
    // primitive's contract AND that detectODI routes through it so the two can't drift.
    var ddeBody = (src.match(/function detectDesatEvents\([\s\S]*?\n}/) || [''])[0];
    T.ok('single desat primitive detectDesatEvents exists', ddeBody.length > 0);
    // inclusive <= : a dip of EXACTLY dropPct% counts (ODI-4 = ≥4%), never strict <
    T.ok('primitive enters on inclusive <= bl-dropPct', /spo2\[i\]\s*<=\s*bl\s*-\s*dropPct/.test(ddeBody));
    // ceiling baseline (computeCeilingBaselineArr), NOT the self-suppressing trailing MEAN
    // (computeBaselineArr) that dragged the bl−drop threshold down in severe OSA and made ODI
    // under-count proportionally to severity. See OXYDEX-ODI-CEILING-FIX-BRIEF.md.
    T.ok('primitive uses the ceiling baseline (computeCeilingBaselineArr)', /computeCeilingBaselineArr\s*\(\s*spo2\s*,\s*WIN/.test(ddeBody));
    T.ok('primitive does NOT use the trailing-mean baseline (computeBaselineArr)', !/computeBaselineArr\s*\(/.test(ddeBody));
    // entry/hysteresis thresholds are sourced from the kernel, not hardcoded
    T.ok('primitive sources drop from DexKernel.K.ODI_DROP', /DexKernel\.K\.ODI_DROP\s*:\s*opts\.dropPct/.test(ddeBody));
    T.ok('primitive hysteresis exit uses inclusive >= bl-hystPct', /spo2\[i\]\s*>=\s*bl\s*-\s*hystPct/.test(ddeBody));
    T.ok('primitive hysteresis level from DexKernel.K.ODI_HYST', /DexKernel\.K\.ODI_HYST\s*:\s*opts\.hystPct/.test(ddeBody));
    // detectODI is now a thin wrapper: it asks the primitive for the SAME event set with a
    // simple re-rise close (exitPct === drop), so ODI is event-for-event identical to the
    // primitive's count and ODI ↔ satellite metrics can never disagree by construction.
    var odiBody = (src.match(/function detectODI\([\s\S]*?\n}/) || [''])[0];
    // tolerate a threaded opts.blArr after exitPct:drop (DEX-EVENT-UNIFY-FOLLOWUPS-II §1 perf-memoize) —
    // the contract is "routes through the primitive with dropPct:drop/exitPct:drop", not the brace position.
    T.ok('detectODI routes through detectDesatEvents (one definition, agrees event-for-event)', /detectDesatEvents\s*\(\s*spo2\s*,\s*\{\s*dropPct:\s*drop,\s*exitPct:\s*drop\b/.test(odiBody));
    T.ok('detectODI keeps no private baseline loop', !/computeBaselineArr\s*\(/.test(odiBody) && !/computeCeilingBaselineArr\s*\(/.test(odiBody));
  });

  /* ════ 14 · ROLLING-WINDOW BOUNDARY SAFETY (P4) ════ */
  group('Rolling-window boundary safety (P4)', 'oxydex-dsp', function (T) {
    var src = (env.sources || {})['oxydex-dsp.js'];
    if (!src) { T.ok('oxydex-dsp.js source available', false); return; }
    // centered ±WIN(=300) nadir window: needs n>2*WIN for ≥1 iteration. Guard was
    // `n<600` → at exactly n==600 the loop ran zero times and minHR stayed Infinity,
    // leaking "Infinity" into hrNadirSmoothed. Must be inclusive `n<=600`.
    T.ok('computeHRNadirTime guards n<=600 (centered ±WIN needs n>2·WIN)', /n\s*<=\s*600\s*\)\s*return null/.test(src));
    T.ok('HR-nadir output is isFinite-guarded (no Infinity leak)', /hrNadirSmoothed:\s*isFinite\(minHR\)/.test(src));
  });

  /* ════ 14b · O2RING NATIVE BINARY (.dat/.bin) INGESTION CONTRACT ════
     The O2Ring writes its on-device recording as a compact binary (10-byte header
     + 3-byte [SpO2,pulse,motion] records @1Hz, 0xFF 0xFF end-of-data trailer). The
     device's own filename is *.dat; *.bin is the renamed variant. Detection is by
     HEADER, not extension (readFile reads every upload as an ArrayBuffer), so a
     .dat decodes via the identical path as .bin and is handed to parseCSV — every
     downstream metric is computed exactly as for the 1Hz CSV. Source-mirror, like
     the other oxydex-dsp groups (these fns aren't headless-loadable). */
  group('O2Ring native binary (.dat/.bin) ingestion contract', 'oxydex-dsp', function (T) {
    var src = (env.sources || {})['oxydex-dsp.js'];
    if (!src) { T.ok('oxydex-dsp.js source available', false); return; }
    // header signature: 01 03, then bytes[2..7]==0x00, then 08==0x04 09==0x00
    T.ok('isO2RingBin checks 01 03 signature', /bytes\[0\]\s*!==\s*0x01\s*\|\|\s*bytes\[1\]\s*!==\s*0x03/.test(src));
    T.ok('isO2RingBin checks 04 00 at bytes[8..9]', /bytes\[8\]\s*!==\s*0x04\s*\|\|\s*bytes\[9\]\s*!==\s*0x00/.test(src));
    // decode: 10-byte header skip, 3-byte stride, 0xFF 0xFF trailer break, 1Hz step
    T.ok('decoder starts at offset 10, 3-byte stride', /for\s*\(\s*var\s+off\s*=\s*10\s*;[^;]*;\s*off\s*\+=\s*3\s*\)/.test(src));
    T.ok('decoder breaks on 0xFF 0xFF end-of-data trailer', /s\s*===\s*0xff\s*&&\s*h\s*===\s*0xff/.test(src));
    T.ok('decoder advances clock by 1000ms per record (1Hz)', /tMs\s*\+=\s*1000/.test(src));
    // extension-agnostic: every upload is read as an ArrayBuffer, then header-detected
    T.ok('readFile reads ArrayBuffer (header-detect, not extension)', /reader\.readAsArrayBuffer\(file\)/.test(src) && /if\s*\(\s*isO2RingBin\(_bytes\)\s*\)/.test(src));
    // date anchor honors the Clock Contract: 14-digit filename YYYYMMDDHHMMSS
    T.ok('bin start-time anchored to 14-digit filename (Clock Contract §4)', /_o2BinStartMs[\s\S]*?\\d\{14\}/.test(src));
  });

  /* ════ 15 · INTEGRATOR CORRELATION INTEGRITY (P10) ════ */
  group('Integrator correlation integrity (P10)', 'integrator-dsp', function (T) {
    var RT = env.reconstructEventTMs, RF = env.runFusion;
    // midnight rollover: an event clock earlier than the recording's start clock
    // must roll forward one day (22:00 start, 01:30 event → next morning), and an
    // already-absolute tMs must pass through untouched (no double-shift).
    if (typeof RT === 'function') {
      var t0 = U(2026, 5, 7, 22, 0, 0);
      T.eq('post-midnight event rolls forward a day', RT({ t: '01:30:00' }, t0), U(2026, 5, 8, 1, 30, 0));
      T.eq('same-evening event stays same day', RT({ t: '23:00:00' }, t0), U(2026, 5, 7, 23, 0, 0));
      T.eq('absolute tMs passes through unchanged', RT({ t: '01:30:00', tMs: t0 + 999 }, t0), t0 + 999);
    } else T.ok('reconstructEventTMs present', false);
    // matching: one surge confirms exactly one desat (single-use, no double-count);
    // findings emitted in deterministic ascending tMs order.
    if (typeof RF === 'function') {
      var t0b = U(2026, 5, 7, 22, 0, 0);
      var rec = function (node, evs) { return { node: node, t0Ms: t0b, endMs: t0b + 3600000, dateUnknown: false, offsetMin: null, events: evs, nEvents: evs.length, summary: {}, series: {} }; };
      var oxy = rec('OxyDex', [
        { tMs: t0b + 600000, t: '22:10:00', impulse: 'spo2_desaturation', node: 'OxyDex', conf: 0.8, meta: { depth: 5, nadir: 88, durSec: 20 } },
        { tMs: t0b + 1800000, t: '22:30:00', impulse: 'spo2_desaturation', node: 'OxyDex', conf: 0.8, meta: { depth: 4 } }]);
      var ecg = rec('ECGDex', [{ tMs: t0b + 620000, t: '22:10:20', impulse: 'autonomic_surge', node: 'ECGDex', conf: 0.7 }]);
      var fus = RF([oxy, ecg], { toleranceSec: 120 });
      var confirmed = (fus.findings || []).filter(function (f) { return f.type === 'confirmed_apnea_event'; });
      T.eq('one surge confirms exactly one desat (no double-count)', confirmed.length, 1);
      var ts = (fus.findings || []).map(function (f) { return f.tMs; });
      var asc = ts.slice().sort(function (a, b) { return a - b; });
      T.ok('findings are time-ordered (deterministic)', JSON.stringify(ts) === JSON.stringify(asc));
      // P1: buildFusionExport carries the 3 previously-dropped result blocks (additive, null-tolerant) + bumped schema version
      var BFE = env.buildFusionExport;
      if (typeof BFE === 'function') {
        var exp = BFE([oxy, ecg], fus);
        T.eq('export schema version bumped to 1.3', exp.schema && exp.schema.version, '1.3');
        T.ok('export carries positional key (null-tolerant)', 'positional' in exp);
        T.ok('export carries hrvConsensus key (null-tolerant)', 'hrvConsensus' in exp);
        T.ok('export carries periodicBreathing key (null-tolerant)', 'periodicBreathing' in exp);
        T.ok('export carries deviceScoredAHI key (null-tolerant)', 'deviceScoredAHI' in exp);
        T.ok('export findings inherit the time order', JSON.stringify(exp.findings.map(function (f) { return f.tMs; })) === JSON.stringify(asc));
      } else T.ok('buildFusionExport present', false);
    } else T.ok('runFusion present', false);
  });

  /* ════ Null personalization fields tolerated end-to-end (P3 / WP-A back-compat) ════
     WP-A nulled personalization.ansAge / newMetrics.bpProj / metabolicAge in node
     exports for back-compat. Consumers (adaptEnvelopeNode → runFusion, CpapFusion
     coimport, oxydex-fusion) guard with != null. This pins that a node export
     carrying those EXPLICIT nulls adapts + fuses without throwing and yields a sane
     (array) findings set — so a future deref regression on a retired field is caught. */
  group('Null personalization tolerated (P3 back-compat)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, RF = env.runFusion;
    if (typeof A !== 'function' || typeof RF !== 'function') { T.ok('adaptEnvelopeNode + runFusion present', false); return; }
    var t0 = U(2026, 5, 7, 22, 0, 0);
    var mkExport = function (node) {
      return {
        schema: { node: node, name: 'ganglior.node-export', version: '2.0' },
        recording: { startEpochMs: t0, offsetMin: null },
        hrv: { time: { rmssd: 42, sdnn: 55 } },
        // the retired heuristics, now explicit nulls (the thing under test)
        personalization: { ansAge: null, metabolicAge: null },
        newMetrics: { bpProj: null, vo2est: null },
        ganglior_events: [
          { t: '22:10:00', tMs: t0 + 600000, impulse: 'autonomic_surge', node: node, conf: 0.7 },
          { t: '22:30:00', tMs: t0 + 1800000, impulse: 'spo2_desaturation', node: node, conf: 0.8, meta: { depth: 5 } }
        ]
      };
    };
    var threw = false, fus = null;
    try {
      var recsE = A(mkExport('ECGDex'), 'ECGDex', 'ecg.json');
      var recsO = A(mkExport('OxyDex'), 'OxyDex', 'oxy.json');
      fus = RF(recsE.concat(recsO), { toleranceSec: 120 });
    } catch (e) { threw = true; T.ok('no throw on nulled personalization — ' + e.message, false); }
    T.ok('adaptEnvelopeNode + runFusion tolerate explicit-null personalization (no throw)', !threw);
    T.ok('fusion still returns a findings array', !threw && fus && Array.isArray(fus.findings));
  });

  /* ════ 16 · CROSS-DEX CONSTANT DRIFT (P12) ════ */
  group('Cross-Dex constant drift (P12)', 'sources', function (T) {
    var s = env.sources || {};
    // (a) the mirrored cross-night significance rule must be byte-identical across nodes
    //     — now expressed via the shared physiology kernel (P8), so it can't drift.
    var crosses = ['ecgdex-cross.js', 'oxydex-cross.js', 'pulsedex-cross.js', 'ppgdex-cross.js', 'cpapdex-cross.js'].filter(function (f) { return s[f]; });
    var sigRe = /mk\.p\s*<\s*DexKernel\.K\.SIGNIF_P\s*&&\s*Math\.abs\(mk\.tau\|\|0\)\s*>\s*DexKernel\.K\.SIGNIF_TAU/;
    T.ok('≥3 cross modules loaded for comparison', crosses.length >= 3, crosses.join(', '));
    crosses.forEach(function (f) { T.ok(f + ' uses kernel significance rule (SIGNIF_P & SIGNIF_TAU)', sigRe.test(s[f])); });
    // (b) the baseline-headline z-threshold must be the kernel Z_HEADLINE suite-wide
    //     (was a divergent inline 1.5 in oxydex-render — the P12 drift this closes)
    var zRe = /Math\.abs\(\s*(?:st\.)?z(?:Latest)?\s*\)\s*>=\s*DexKernel\.K\.Z_HEADLINE/;
    var z15 = /Math\.abs\(\s*(?:st\.)?z(?:Latest)?\s*\)\s*>=\s*1\.[0-9]/;
    ['ecgdex-app.js', 'ppgdex-app.js', 'pulsedex-app.js', 'oxydex-render.js'].forEach(function (f) {
      if (!s[f]) return;
      T.ok(f + ' headline z-threshold is the kernel Z_HEADLINE', zRe.test(s[f]));
      T.ok(f + ' has no divergent inline σ headline cutoff', !z15.test(s[f]));
    });
    if (s['crossnight-envelope.js']) T.ok('crossnight-envelope headline threshold is kernel Z_HEADLINE', /Math\.abs\(z\)\s*>=\s*DexKernel\.K\.Z_HEADLINE/.test(s['crossnight-envelope.js']));
  });

  /* ════ 17 · MEMORY HYGIENE — no full-input retention (P9) ════ */
  group('Memory hygiene — no full-input retention (P9)', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode;
    if (typeof A !== 'function') { T.ok('adaptEnvelopeNode present', false); return; }
    var t0 = U(2026, 5, 7, 22, 0, 0);
    var heavy = []; for (var i = 0; i < 500; i++) heavy.push({ tMin: i, samples: [1, 2, 3, 4, 5] });
    var rec = A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 60 },
      quality: { analyzablePct: 95 }, hrv: { time: { rmssd: 40, sdnn: 58 } },
      timeseries: { epochs: heavy }, morphology: { medianBeat: { samples: new Array(2000).fill(0.1) } },
      ganglior_events: [{ t: '22:10:00', tMs: t0 + 600000, impulse: 'x', node: 'ECGDex', conf: .8 }] }, 'ECGDex', 'e.json')[0];
    T.ok('rec.raw does NOT retain heavy timeseries', !(rec.raw && rec.raw.timeseries));
    T.ok('rec.raw does NOT retain morphology arrays', !(rec.raw && rec.raw.morphology));
    T.ok('rec.raw keeps the event array (for dedup signature)', !!(rec.raw && Array.isArray(rec.raw.ganglior_events)));
  });

  /* ════ 18 · ECGDex SLEEP POSITION from ACC (epoch + event meta) ════ */
  group('ECGDex sleep position from ACC', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP available', false); return; }
    var vocab = ['supine', 'lateral', 'prone', 'upright', 'unknown'];
    var rec = D.genSynthetic({ durSec: 6 * 3600, scenario: 'osa' });
    var r = D.analyze(rec, function () {});
    T.ok('every epoch has a canonical position', r.epochs.length > 0 && r.epochs.every(function (e) { return vocab.indexOf(e.position) >= 0; }));
    var surges = (r.events || []).filter(function (e) { return e.impulse === 'autonomic_surge'; });
    T.ok('every autonomic_surge carries meta.position', surges.length > 0 && surges.every(function (e) { return e.meta && 'position' in e.meta; }));
    T.ok('surge meta.position is from the canonical vocabulary', surges.every(function (e) { return e.meta.position == null || vocab.indexOf(e.meta.position) >= 0; }));
    // synthetic night should exhibit >1 posture (demo actually showcases the feature)
    var distinct = {}; r.epochs.forEach(function (e) { distinct[e.position] = 1; });
    T.ok('synthetic night shows posture variety (>1 position)', Object.keys(distinct).length > 1, Object.keys(distinct).join(','));
    // no-ACC recording → epoch.position falls back to 'unknown', never undefined/null
    var rec2 = D.genSynthetic({ durSec: 6 * 3600, scenario: 'osa' }); rec2.deviceACC = null; rec2.accFs = null;
    var r2 = D.analyze(rec2, function () {});
    T.ok('no-ACC → all epoch.position === "unknown" (never undefined)', r2.epochs.every(function (e) { return e.position === 'unknown'; }));
  });

  /* ════ 19 · PPGDex limb posture from ACC (parity, down-weighted) ════ */
  group('PPGDex limb posture from ACC', 'ppgdex-dsp', function (T) {
    var P = env.PPGDSP;
    if (!(P && typeof P.analyzeMotion === 'function')) { T.ok('PPGDSP.analyzeMotion available', false); return; }
    var fs = 50, durSec = 1800, N = fs * durSec, acc = [];
    function grav(sec) { return sec < 600 ? [20, -15, 990] : sec < 1200 ? [965, 30, 70] : [40, 25, -980]; }
    for (var i = 0; i < N; i++) { var sec = i / fs, g = grav(sec); acc.push({ x: g[0], y: g[1], z: g[2], relNs: sec * 1e9 }); }
    var m = P.analyzeMotion(acc, null, 0, durSec);
    T.ok('motion exposes postureAtSec when ACC present', typeof m.postureAtSec === 'function');
    T.eq('supine segment → supine', m.postureAtSec(60, 360), 'supine');
    T.eq('left-side segment → lateral', m.postureAtSec(660, 960), 'lateral');
    T.eq('prone segment → prone', m.postureAtSec(1260, 1560), 'prone');
    // gyro-only (no ACC) → no posture function, never throws
    var mg = P.analyzeMotion(null, [{ x: 1, y: 1, z: 1, relNs: 0 }, { x: 2, y: 1, z: 1, relNs: 1e9 }], 0, durSec);
    T.ok('gyro-only session exposes no postureAtSec (null)', !mg.postureAtSec);
  });

  /* ════ 19 · POSITIONAL APNEA — epoch positions → fusion clustering (P10/feature) ════ */
  group('Positional apnea from epoch positions', 'integrator-dsp', function (T) {
    var A = env.adaptEnvelopeNode, RF = env.runFusion;
    var LP = env.labelPositionalApnea, PS = env._ecgPostureSeries;
    if (typeof PS === 'function') {
      var t0 = U(2026, 5, 7, 22, 0, 0);
      // dense epoch grid is the PRIMARY posture source (not just surge meta)
      var ser = PS({ timeseries: { epochs: [
        { tMin: 0, position: 'supine' }, { tMin: 5, position: 'unknown' }, { tMin: 10, position: 'lateral' }] },
        ganglior_events: [] }, t0);
      T.ok('reads timeseries.epochs[].position', ser.length === 2, ser.length + ' posture points');
      T.ok('skips "unknown" epoch positions', !ser.some(function (p) { return p.pos === 'unknown'; }));
    } else T.ok('_ecgPostureSeries present', false);
    if (typeof A === 'function' && typeof RF === 'function' && typeof LP === 'function') {
      var t0b = U(2026, 5, 7, 22, 0, 0);
      var mkEpochs = function (pos) { var a = []; for (var m = 0; m <= 60; m += 5) a.push({ tMin: m, position: pos }); return a; };
      var ecg = A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0b, durationMin: 65 },
        quality: { analyzablePct: 95 }, hrv: { time: { rmssd: 40, sdnn: 58 } },
        timeseries: { epochs: mkEpochs('supine') },
        ganglior_events: [
          { t: '22:10:00', tMs: t0b + 600000, impulse: 'autonomic_surge', node: 'ECGDex', conf: .8, meta: { ampBpm: 12, position: 'supine' } },
          { t: '22:30:00', tMs: t0b + 1800000, impulse: 'autonomic_surge', node: 'ECGDex', conf: .8, meta: { ampBpm: 11, position: 'supine' } },
          { t: '22:50:00', tMs: t0b + 3000000, impulse: 'autonomic_surge', node: 'ECGDex', conf: .8, meta: { ampBpm: 10, position: 'supine' } }] }, 'ECGDex', 'e.json')[0];
      T.ok('ECGDex adapt builds summary.posture from epochs', !!(ecg.summary && ecg.summary.posture && ecg.summary.posture.length >= 3));
      // hand-built OxyDex rec (desats lead each surge within the directional window)
      var oxy = { node: 'OxyDex', t0Ms: t0b, endMs: t0b + 65 * 60000, dateUnknown: false, offsetMin: null, summary: {}, series: {},
        events: [
          { tMs: t0b + 600000 - 20000, t: '22:09:40', impulse: 'spo2_desaturation', node: 'OxyDex', conf: 0.8, meta: { depth: 5, nadir: 88, durSec: 20 } },
          { tMs: t0b + 1800000 - 20000, t: '22:29:40', impulse: 'spo2_desaturation', node: 'OxyDex', conf: 0.8, meta: { depth: 6, nadir: 87, durSec: 22 } },
          { tMs: t0b + 3000000 - 20000, t: '22:49:40', impulse: 'spo2_desaturation', node: 'OxyDex', conf: 0.8, meta: { depth: 5, nadir: 88, durSec: 18 } }], nEvents: 3 };
      var apnea = RF([ecg, oxy], { toleranceSec: 120 });
      var pos = LP([ecg, oxy], apnea);
      T.ok('positional analysis available', pos && pos.available);
      T.ok('every confirmed finding carries meta.position', apnea.findings.length > 0 && apnea.findings.every(function (f) { return f.meta && 'position' in f.meta; }));
      T.ok('all-supine night flags positional clustering', pos && pos.positional === true, pos && ('supine=' + pos.supine + ' rate=' + pos.supineRate));
      T.ok('postureSource is chest-acc when ECGDex present', pos && pos.postureSource === 'chest-acc');
    } else T.ok('positional fusion fns present', false);
  });

  /* ════ 20 · PHYSIOLOGY KERNEL (P8) — versioned, content-hashed constants ════ */
  group('Physiology kernel (P8)', 'kernel-constants · sources · integrator-dsp', function (T) {
    var DK = env.DexKernel;
    T.ok('DexKernel present (loaded first)', !!DK);
    if (!DK) return;
    // (1) the hash is synchronous, deterministic & content-derived
    T.ok('VERSION is a semver string', typeof DK.VERSION === 'string' && /^\d+\.\d+\.\d+$/.test(DK.VERSION));
    T.ok('HASH is 8-hex-char FNV-1a', typeof DK.HASH === 'string' && /^[0-9a-f]{8}$/.test(DK.HASH));
    T.ok('K (constants) is frozen', Object.isFrozen(DK.K));
    if (typeof DK.fnv1a === 'function') {
      var h2 = DK.fnv1a(DK.VERSION + '|' + JSON.stringify(DK.K));
      T.eq('HASH recomputes deterministically (stable across two computations)', h2, DK.HASH);
      T.ok('a single-constant edit changes the HASH (drift is detectable)',
        DK.fnv1a(DK.VERSION + '|' + JSON.stringify(Object.assign({}, DK.K, { Z_HEADLINE: 1.3 }))) !== DK.HASH);
    }
    // every threshold the brief names exists with its frozen value
    var want = { SIGNIF_P: 0.10, SIGNIF_TAU: 0.15, Z_HEADLINE: 1.2, Z_WARN: 1, Z_BAD: 2, ODI_DROP: 4, ODI_HYST: 2, MOS_SHORT: 5, MOS_LONG: 15, QFLOOR: 50 };
    Object.keys(want).forEach(function (k) { T.eq('K.' + k + ' = ' + want[k], DK.K[k], want[k]); });

    // (2) migrated sources reference DexKernel.K — no stray inlined literal survives
    var s = env.sources || {};
    ['ecgdex-cross.js', 'oxydex-cross.js', 'pulsedex-cross.js', 'ppgdex-cross.js'].forEach(function (f) {
      if (!s[f]) return;
      T.ok(f + ' significance via DexKernel.K.SIGNIF_*', /DexKernel\.K\.SIGNIF_P/.test(s[f]) && /DexKernel\.K\.SIGNIF_TAU/.test(s[f]));
      T.ok(f + ' no inline 0.10/0.15 significance literal', !/mk\.p\s*<\s*0\.10/.test(s[f]) && !/Math\.abs\(mk\.tau\|\|0\)\s*>\s*0\.15/.test(s[f]));
    });
    ['ecgdex-app.js', 'ppgdex-app.js', 'pulsedex-app.js', 'oxydex-render.js'].forEach(function (f) {
      if (!s[f]) return;
      T.ok(f + ' headline z + z-color via DexKernel.K.Z_*', /DexKernel\.K\.Z_HEADLINE/.test(s[f]) && /DexKernel\.K\.Z_BAD/.test(s[f]) && /DexKernel\.K\.Z_WARN/.test(s[f]));
    });
    if (s['crossnight-envelope.js']) T.ok('crossnight-envelope headline via DexKernel.K.Z_HEADLINE', /DexKernel\.K\.Z_HEADLINE/.test(s['crossnight-envelope.js']));
    if (s['oxydex-dsp.js']) {
      var o = s['oxydex-dsp.js'];
      T.ok('oxydex-dsp ODI drop via DexKernel.K.ODI_DROP', /DexKernel\.K\.ODI_DROP\s*:\s*opts\.dropPct/.test(o));
      T.ok('oxydex-dsp ODI hysteresis via DexKernel.K.ODI_HYST', /DexKernel\.K\.ODI_HYST\s*:\s*opts\.hystPct/.test(o));
      T.ok('oxydex-dsp MOS grades via DexKernel.K.MOS_SHORT/MOS_LONG', /DexKernel\.K\.MOS_SHORT/.test(o) && /DexKernel\.K\.MOS_LONG/.test(o));
      T.ok('oxydex-dsp has no stray "bl - 4" desat literal', !/bl\s*-\s*4\b/.test(o));
      T.ok('oxydex-dsp has no stray "bl - 2" hysteresis literal', !/bl\s*-\s*2\b/.test(o));
    }
    if (s['integrator-dsp.js']) T.ok('integrator QFLOOR via DexKernel.K.QFLOOR', /QFLOOR\s*=\s*DexKernel\.K\.QFLOOR/.test(s['integrator-dsp.js']));

    // (3) BEHAVIORAL — a node export built against a different kernel triggers the
    //     Integrator banner; a kernel-matched node does not; a stampless legacy
    //     export reads as "missing".
    var A = env.adaptEnvelopeNode, RF = env.runFusion;
    if (typeof A === 'function' && typeof RF === 'function') {
      var t0 = U(2026, 5, 7, 22, 0, 0);
      var good = A({ kernel: { version: DK.VERSION, hash: DK.HASH }, schema: { node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 120 }, quality: { analyzablePct: 95 }, hrv: { time: { rmssd: 40, sdnn: 58 } }, ganglior_events: [{ t: '22:10:00', tMs: t0 + 600000, impulse: 'x', node: 'ECGDex', conf: .8 }] }, 'ECGDex', 'good.json')[0];
      var bad = A({ kernel: { version: '9.9.9', hash: 'deadbeef' }, schema: { node: 'OxyDex' }, recording: { startEpochMs: t0, durationMin: 120 }, ganglior_events: [{ t: '22:20:00', tMs: t0 + 1200000, impulse: 'spo2_desaturation', node: 'OxyDex', conf: .8 }] }, 'OxyDex', 'bad.json')[0];
      var miss = A({ schema: { node: 'HRVDex' }, recording: { startEpochMs: t0, durationMin: 120 }, hrv: { time: { rmssd: 44, sdnn: 60 } }, ganglior_events: [{ t: '22:30:00', tMs: t0 + 1800000, impulse: 'x', node: 'HRVDex', conf: .8 }] }, 'HRVDex', 'legacy.json')[0];
      T.eq('adapt carries node kernel hash onto the rec', good.kernelHash, DK.HASH);
      var fus = RF([good, bad, miss], { toleranceSec: 120 });
      T.ok('fusion exposes kernelAudit', !!(fus && fus.kernelAudit));
      if (fus && fus.kernelAudit) {
        var ka = fus.kernelAudit;
        T.eq('expected hash = Integrator own kernel', ka.expected, DK.HASH);
        var mm = ka.mismatches.map(function (m) { return m.node; }).sort();
        T.eq('divergent + stampless nodes flagged (HRVDex, OxyDex)', mm, ['HRVDex', 'OxyDex']);
        T.ok('kernel-matched ECGDex NOT flagged', mm.indexOf('ECGDex') < 0);
        T.ok('audit.ok=false when any node diverges', ka.ok === false);
        var oxy = ka.nodes.filter(function (n) { return n.node === 'OxyDex'; })[0];
        T.eq('divergent-hash node status = mismatch', oxy && oxy.status, 'mismatch');
        var hrv = ka.nodes.filter(function (n) { return n.node === 'HRVDex'; })[0];
        T.eq('stampless legacy node status = missing', hrv && hrv.status, 'missing');
      }
      var fus2 = RF([good], { toleranceSec: 120 });
      T.ok('all-kernel-matched fleet → audit.ok=true (no banner)', !!(fus2.kernelAudit && fus2.kernelAudit.ok === true));
    } else T.ok('adaptEnvelopeNode + runFusion present', false);
  });

  /* ════ 21 · ECGDex ACC FULL PIPELINE — RRacc · EDR agreement · consensus · gait ════ */
  group('ECGDex ACC pipeline (RRacc · agreement · consensus · gait)', 'ecgdex-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.accExtras === 'function' && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.accExtras + analyze + genSynthetic available', false); return; }
    var rec = D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' });
    var r = D.analyze(rec, function () {});
    var ex = D.accExtras(rec.deviceACC, rec.accFs, r.t0Ms, r.durSec, r.epochs, r.stages);
    T.ok('accExtras returns a payload for an ACC-bearing recording', !!ex);
    if (!ex) return;
    T.ok('no NaN/Infinity anywhere in the ACC payload', countNonFinite(ex) === 0, countNonFinite(ex) + ' bad numbers');

    // Feature 1 — RRacc per 30-s epoch
    T.ok('rracc is a non-empty array', Array.isArray(ex.rracc) && ex.rracc.length > 0, (ex.rracc || []).length + ' epochs');
    T.ok('every RRacc epoch: finite rr in 4–40 br/min', ex.rracc.every(function (e) { return isFin(e.rr) && e.rr >= 4 && e.rr <= 40; }));
    T.ok('every RRacc epoch: conf ∈ {high,low}', ex.rracc.every(function (e) { return e.conf === 'high' || e.conf === 'low'; }));
    T.ok('RRacc summary mean finite & highPct ∈ [0,100]', !!ex.rraccSummary && isFin(ex.rraccSummary.mean) && ex.rraccSummary.highPct >= 0 && ex.rraccSummary.highPct <= 100);

    // Feature 2 — RRacc vs EDR agreement (EDR epochs exist on an overnight run)
    T.ok('agreement present (EDR epochs available)', !!ex.agreement);
    if (ex.agreement) {
      var ag = ex.agreement;
      T.ok('Pearson r ∈ [-1,1]', isFin(ag.r) && ag.r >= -1 && ag.r <= 1, 'r=' + ag.r);
      T.ok('MAE finite & ≥ 0', isFin(ag.mae) && ag.mae >= 0, 'mae=' + ag.mae);
      T.ok('limits of agreement is an ordered [lo,hi] pair', Array.isArray(ag.loa) && ag.loa.length === 2 && ag.loa[0] <= ag.loa[1]);
      T.ok('Bland–Altman points = paired epoch count', Array.isArray(ag.ba) && ag.ba.length === ag.n);
      T.ok('synthetic ACC↔EDR track closely (MAE < 3 br/min)', ag.mae < 3, 'mae=' + ag.mae);
    }

    // Feature 3 — sleep-stage consensus (HRV staging available overnight)
    T.ok('consensus present (HRV staging available)', !!ex.consensus);
    if (ex.consensus) {
      var co = ex.consensus;
      T.ok('consensus rate ∈ [0,100]', isFin(co.rate) && co.rate >= 0 && co.rate <= 100, 'rate=' + co.rate);
      T.ok('voteRows length == epochs voted', Array.isArray(co.voteRows) && co.voteRows.length === co.n);
      T.ok('conflicts ≤ epochs voted', co.nConflict <= co.n);
      T.ok('every vote ∈ {Wake (motion),Ambiguous,Sleep (still)}', co.voteRows.every(function (v) { return ['Wake (motion)', 'Ambiguous', 'Sleep (still)'].indexOf(v.vote) >= 0; }));
      T.ok('mostly-still synthetic night reaches consensus ≥ 70%', co.rate >= 70, 'rate=' + co.rate);
    }

    // Feature 4 — gait: a 4-Hz ACC cannot resolve the 0.5–3.5 Hz step band → graceful no-walk
    T.ok('gait present', !!ex.gait);
    if (ex.gait) T.ok('4 Hz ACC → walking=false with lowfs reason (graceful)', ex.gait.walking === false && ex.gait.reason === 'lowfs', 'reason=' + ex.gait.reason);

    // Feature 4 — gait DOES detect a real cadence at a usable sample rate (50-Hz walk, ~108 spm)
    var fs = 50, durSec = 240, M = fs * durSec, acc = [];
    for (var i = 0; i < M; i++) { var t = i / fs, cad = 1.8;
      acc.push({ tsMs: i / fs * 1000, x: 30 * Math.sin(2 * Math.PI * cad * t * 0.5), y: 20, z: 1000 + 180 * Math.sin(2 * Math.PI * cad * t) }); }
    var gx = D.accExtras(acc, fs, 0, durSec, [], []);
    T.ok('50 Hz walking buffer → gait detected', !!(gx && gx.gait && gx.gait.walking), gx && gx.gait && ('steps=' + gx.gait.totalSteps));
    if (gx && gx.gait && gx.gait.walking) {
      T.ok('detected cadence ≈ 108 steps/min (90–130)', gx.gait.bouts.length > 0 && gx.gait.bouts[0].cadence >= 90 && gx.gait.bouts[0].cadence <= 130, (gx.gait.bouts[0] || {}).cadence + ' spm');
      T.ok('total steps plausible for a 4-min walk (> 350)', gx.gait.totalSteps > 350, gx.gait.totalSteps + ' steps');
      T.ok('activity zones sum ≈ 100%', Math.abs(gx.gait.zonePct.reduce(function (s, z) { return s + z.pct; }, 0) - 100) <= 2);
    }

    // static guard — the JSON export must keep wiring the acc section (regression)
    var appsrc = (env.sources || {})['ecgdex-app.js'];
    if (appsrc) T.ok('buildV2 export wires an `acc:` section', /acc:\s*accEx\s*\?/.test(appsrc));

    // ── FOLLOWUPS-II §2: a STAMPLESS primary ECG (t0Ms=null) drives the ACC companion on a
    //    relative-from-0 clock. accExtras/accAnalyze/stampEpochPositions each use ecgT0Ms ONLY in
    //    baseOffset = (ecgT0Ms && acc[0].tsMs) ? … : 0, so a null anchor short-circuits to off=0 —
    //    byte-IDENTICAL to a 0/misaligned anchor, never a 1970-epoch-ms absolute stamp or NaN.
    var recN = D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' });
    var rN = D.analyze(recN, function () {});
    var exNull = D.accExtras(recN.deviceACC, recN.accFs, null, rN.durSec, rN.epochs, rN.stages);
    var exZero = D.accExtras(recN.deviceACC, recN.accFs, 0, rN.durSec, rN.epochs, rN.stages);
    T.ok('stampless (null t0Ms) accExtras still returns a payload', !!exNull);
    if (exNull) {
      T.ok('stampless ACC payload has no NaN/Infinity (null never coerces to a 1970 stamp)', countNonFinite(exNull) === 0, countNonFinite(exNull) + ' bad');
      T.eq('accExtras: null t0Ms ≡ 0/misaligned anchor (both → relative off=0)', JSON.stringify(exNull), JSON.stringify(exZero));
      var maxMin = rN.durSec / 60 + 5;
      T.ok('RRacc epoch times stay relative (never 1970-ms)', (exNull.rracc || []).every(function (e) { return e.tStartMin >= -1 && e.tStartMin <= maxMin; }));
      T.ok('motion trace times stay relative', (exNull.motionSeries || []).every(function (p) { return p.x >= -1 && p.x <= maxMin; }));
    }
    var aNull = D.accAnalyze(recN.deviceACC, recN.accFs, null, rN.durSec, rN.epochs);
    var aZero = D.accAnalyze(recN.deviceACC, recN.accFs, 0, rN.durSec, rN.epochs);
    T.eq('accAnalyze: null t0Ms ≡ 0 anchor (relative off=0)', JSON.stringify(aNull), JSON.stringify(aZero));
    var epIn = rN.epochs.map(function (e) { return { tMin: e.tMin }; });
    var posNull = D.stampEpochPositions(epIn, recN.deviceACC, recN.accFs, null, rN.durSec);
    T.ok('stampEpochPositions(null t0Ms) returns one position per epoch', Array.isArray(posNull) && posNull.length === rN.epochs.length);
    T.ok('stampEpochPositions(null t0Ms) tMin stays relative (never 1970-ms)', posNull.every(function (p) { return isFin(p.tMin) && p.tMin >= -1 && p.tMin <= rN.durSec / 60 + 5; }));
    // the canonical cross-node export currency stays UNDATED (startEpochMs:null), never 0/now()
    var recNe = D.genSynthetic({ durSec: 900 }); recNe.t0Ms = null;
    var expN = D.buildNodeExport(D.analyze(recNe, function () {}), {});
    T.ok('ecgBuildNodeExport(null t0Ms) → recording.startEpochMs == null (undated)', !!(expN && expN.recording) && expN.recording.startEpochMs == null, 'startEpochMs=' + (expN && expN.recording && expN.recording.startEpochMs));
  });

  /* ════ 22 · OXIMETER SELF-GATE & CONSEQUENCE-COROBORATION ════
     Part A self-gate lives in oxydex-dsp.js / cpapdex-dsp.js (node-local, like
     parseTimestamp — not loadable headless, so verified by source mirror, as
     #13/#14/#20 do). Part B/C live in the loaded integrator-dsp.js → behavioral. */
  group('Oximeter self-gate & consequence-corroboration', 'oxydex-dsp · integrator-dsp', function (T) {
    var src = (env.sources || {})['oxydex-dsp.js'];
    // ── 1 · selfGate-kinetics (Part A, source mirror) ──
    if (src) {
      T.ok('selfGateDesat(desat, pulseSeries, spo2Series) present', /function\s+selfGateDesat\s*\(\s*desat\s*,\s*pulseSeries\s*,\s*spo2Series\s*\)/.test(src));
      T.ok('near-instant cliff → nonphysiologic-kinetics (fallRate > FALL_RATE_MAX)', /fallRate\s*>\s*SELFGATE\.FALL_RATE_MAX/.test(src) && /'nonphysiologic-kinetics'/.test(src));
      T.ok('kinetics threshold is ~1.5 %/s', /FALL_RATE_MAX:\s*1\.5/.test(src));
      T.ok('artifact desats carry a low sqi (≈0.2, for effConf = conf×sqi)', /sqi\s*=\s*0\.2/.test(src));
      // excluded from ODI: the ODI-4 count is reduced by the self-gated artifact count
      T.ok('self-gated artifacts EXCLUDED from ODI-4 (odi4.count − artifactCount)', /-\s*desat\.artifactCount/.test(src) && /artifactExcluded/.test(src));
      // the gate actually runs over the detected desats inside the profile
      T.ok('self-gate runs on each detected desat in the profile', /selfGateDesat\(\s*ev\s*,\s*pulseSeries/.test(src));
      // surviving (non-artifact) desats are what downstream + the bus see
      T.ok('profile exposes surviving events (artifacts split into eventsAll)', /events:\s*realEvents/.test(src) && /eventsAll:\s*nadirEvents/.test(src));
    } else { T.ok('oxydex-dsp.js source available', false); }
    // ── 2 · selfGate-perfusion (Part A, source mirror) ──
    if (src) {
      T.ok('perfusion collapse → perfusion-collapse (pulseValid < floor)', /pulseValid\s*<\s*SELFGATE\.PULSE_VALID_FLOOR/.test(src) && /'perfusion-collapse'/.test(src));
      T.ok('perfusion floor is 0.5 (pulse present & in [30,220])', /PULSE_VALID_FLOOR:\s*0\.5/.test(src) && /PULSE_MIN:\s*30/.test(src) && /PULSE_MAX:\s*220/.test(src));
      T.ok('edge-collapse: pulse craters by ≥40 bpm exactly at the SpO₂ edge', /EDGE_PULSE_DROP:\s*40/.test(src));
    }
    // cpapdex mirror — CPAPDex IS built (Phase-9 node 4/4, 2026-06-28); cpapdex-dsp.js is in SOURCE_FILES
    // for both runners, so this verbatim-selfGateDesat-mirror assertion is LIVE (CPAPDEX-PHASE9-FOLLOWUPS-II §4).
    var csrc = (env.sources || {})['cpapdex-dsp.js'];
    if (csrc) T.ok('cpapdex-dsp.js mirrors selfGateDesat verbatim', /function\s+selfGateDesat\s*\(/.test(csrc));

    var CD = env.corroborateDesat, PH = env.pickHRAuthority, NF = env.normalizeFile;
    var t0 = U(2026, 5, 7, 22, 0, 0);
    // ── 3 · consequence (Part B, behavioral) ──
    if (typeof CD === 'function') {
      var noResp = CD({ tMs: t0, depthPct: 6 }, [{ node: 'ECGDex', surges: [] }]);
      T.eq('depth-6% desat, NO surge on live ECG → dropped artifact-no-consequence', noResp.verdict, 'artifact-no-consequence');
      var resp = CD({ tMs: t0, depthPct: 6 }, [{ node: 'ECGDex', surges: [t0 + 12000] }]);
      T.eq('same desat WITH a surge within +30 s → confirmed', resp.verdict, 'confirmed');
      var selfGated = CD({ tMs: t0, depthPct: 31, artifact: true }, [{ node: 'ECGDex', surges: [] }]);
      T.eq('an already self-gated desat is dropped (verdict artifact)', selfGated.verdict, 'artifact');
      // ── 4 · capability (Part B, behavioral) — no live HR witness ──
      var lone = CD({ tMs: t0, depthPct: 6 }, []);
      T.eq('no live HR node → unconfirmed-desat (nadir never published as truth)', lone.verdict, 'unconfirmed-desat');
    } else { T.ok('corroborateDesat present', false); }
    // ── 5 · degradation (Part C, behavioral) — authority ladder + quarantine ──
    if (typeof PH === 'function') {
      T.eq('HR authority = ECG when chest strap present', (PH([{ node: 'ECGDex' }, { node: 'PpgDex' }]) || {}).node, 'ECGDex');
      T.eq('ECG dropout → HR/bpm falls back to PPG (next authority)', (PH([{ node: 'PpgDex' }]) || {}).node, 'PpgDex');
      T.eq('pulse-ox outranks green-LED PPG', (PH([{ node: 'PpgDex' }, { node: 'OxyDex' }]) || {}).node, 'OxyDex');
      T.eq('empty live set → no HR source (null)', PH([]), null);
    } else { T.ok('pickHRAuthority present', false); }
    // the Integrator never emits a self-gated artifact desat as a ganglior event
    if (typeof NF === 'function') {
      var night = { date: '2026-06-07', t0Ms: t0, stats: { n: 600, durationMin: 10, minSpo2: 88, meanSpo2: 96 },
        desat: { events: [ { nadirIdx: 60, depth: 5, nadir: 91, duration: 20 },
                            { nadirIdx: 120, depth: 30, nadir: 67, duration: 2, artifact: true, reason: 'nonphysiologic-kinetics' } ] } };
      var recs = (NF([night], 'oxydex_night.json') || {}).recs || [];
      var devs = ((recs[0] && recs[0].events) || []).filter(function (e) { return e.impulse === 'desat_event'; });   // EVENT-LEXICON §1: synthesis now emits the canonical name
      T.eq('artifact desat NOT emitted (1 of 2 desats survives to the bus)', devs.length, 1);
    } else { T.ok('normalizeFile present', false); }
  });

  /* ════ 23 · AMBULATORY / ACTIVITY-AWARE MODE (AMBULATORY-MODE-BRIEF) ════
     A high-motion daytime walk must NOT be scored as an overnight sleep study:
     mode is vetoed to `ambulatory`, and the sleep-only analyses (hypnogram, CVHR/AHI)
     are SUPPRESSED-with-reason (present field, explicit reason, null payload) — never
     fabricated, never silently dropped. A normal overnight is unaffected. */
  group('Ambulatory mode veto — walk is not a sleep study', 'ecgdex-dsp · integrator-dsp', function (T) {
    var D = env.ECGDSP;
    if (!(D && typeof D.analyze === 'function' && typeof D.genSynthetic === 'function')) { T.ok('ECGDSP.analyze + genSynthetic available', false); return; }

    // ── the daytime ambulatory fixture (~2.4 h from 12:14, walking, exercise HR) ──
    var amb = D.analyze(D.genSynthetic({ durSec: Math.round(2.4 * 3600), scenario: 'ambulatory' }), function () {});
    var actStr = JSON.stringify(amb.activity);

    // 1 · mode-veto — duration says "overnight" (144 min) but activity wins
    T.ok('long enough to be longRec (duration heuristic would say overnight)', amb.longRec === true, amb.durMin + ' min');
    T.eq("mode is NOT 'overnight' (activity veto)", amb.mode, 'ambulatory');
    T.ok('modeWhy cites the activity evidence', /ambulatory/.test(amb.modeWhy) && /(gait|ACC-wake|brisk|steps)/.test(amb.modeWhy), amb.modeWhy);
    T.ok('activity score is high', amb.activityScore >= 0.6, 'score=' + amb.activityScore + ' · ' + actStr);

    // 2 · staging-suppressed — hypnogram withheld with a reason, stages null
    T.ok('sleepSuppressed present', !!amb.sleepSuppressed, actStr);
    if (amb.sleepSuppressed) {
      T.eq('sleep staging suppressed:true', amb.sleepSuppressed.suppressed, true);
      T.eq('sleep staging stages:null', amb.sleepSuppressed.stages, null);
      T.ok('sleep suppression carries a reason', typeof amb.sleepSuppressed.suppressedReason === 'string' && amb.sleepSuppressed.suppressedReason.length > 0);
    }

    // 3 · ahi-suppressed — CVHR/AHI withheld with a reason, payload null
    T.ok('apneaSuppressed present', !!amb.apneaSuppressed);
    if (amb.apneaSuppressed) {
      T.eq('CVHR/AHI reportable:false', amb.apneaSuppressed.reportable, false);
      T.eq('estimatedAHI:null (never fabricated)', amb.apneaSuppressed.estimatedAHI, null);
      T.eq('cvhrIndex:null', amb.apneaSuppressed.cvhrIndex, null);
      T.ok('apnea suppression carries a reason', typeof amb.apneaSuppressed.suppressedReason === 'string' && amb.apneaSuppressed.suppressedReason.length > 0);
    }
    T.eq('live cvhr object is suppressed (index null)', amb.cvhr.index, null);
    T.ok('NO autonomic_surge events emitted on a walk', !(amb.events || []).some(function (e) { return e.impulse === 'autonomic_surge'; }), (amb.events || []).length + ' events');
    T.ok('NO sleep stage_* events emitted on a walk', !(amb.events || []).some(function (e) { return /^stage_/.test(e.impulse); }));

    // 4 · HR + gait still compute (valid for a walk)
    T.ok('heart rate still computes', isFin(amb.dispHr) && amb.dispHr > 40, amb.dispHr + ' bpm');
    T.ok('gait detected (steps logged on the walk)', !!(amb._accEx && amb._accEx.gait && amb._accEx.gait.walking), amb._accEx && amb._accEx.gait && ('steps=' + amb._accEx.gait.totalSteps));

    // 5 · overnight-unaffected — a normal sleep night still stages + screens as before
    var night = D.analyze(D.genSynthetic({ durSec: 3 * 3600, scenario: 'osa' }), function () {});
    T.eq('overnight stays mode==overnight', night.mode, 'overnight');
    T.ok('overnight is NOT ambulatory', night.ambulatory === false, 'accWake=' + (night.activity && night.activity.accWakePct) + '%');
    T.eq('overnight sleepSuppressed is null (still staged)', night.sleepSuppressed, null);
    T.eq('overnight apneaSuppressed is null (still screened)', night.apneaSuppressed, null);
    T.ok('overnight publishes a hypnogram', Array.isArray(night.stages) && night.stages.length > 0);
    T.ok('overnight publishes a numeric CVHR index', isFin(night.cvhr.index), 'cvhr=' + night.cvhr.index);

    // 6 · integrator-absent-not-zero — a suppressed sleep/apnea field is ABSENT, not 0
    var A = env.adaptEnvelopeNode;
    if (typeof A === 'function') {
      var t0 = U(2026, 5, 1, 12, 14, 0);
      var ambRec = A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 144, mode: 'ambulatory', ambulatory: true },
        quality: { analyzablePct: 96 }, hrv: { time: { rmssd: 32, sdnn: 46, wholeRecordRMSSD: 32, wholeRecordSDNN: 46 } },
        apnea: { reportable: false, suppressedReason: 'ambulatory — CVHR invalid under exercise', cvhrIndex: null, estimatedAHI: null },
        sleep: { suppressed: true, suppressedReason: 'high-activity / ambulatory', stages: null },
        ganglior_events: [] }, 'ECGDex', 'amb.json')[0];
      T.eq('Integrator: ambulatory cvhrIndex is absent (null, not 0)', ambRec.summary.cvhrIndex, null);
      T.eq('Integrator: ambulatory estAHI is absent (null, not 0)', ambRec.summary.estAHI, null);
      T.ok('Integrator: ambulatory remFraction absent (not 0)', ambRec.summary.remFraction == null, 'remFraction=' + ambRec.summary.remFraction);
      T.ok('Integrator: summary flags ambulatory', ambRec.summary.ambulatory === true);
      // control: a normal overnight ECGDex export still folds its apnea index
      var onRec = A({ schema: { node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 360 },
        quality: { analyzablePct: 95 }, hrv: { time: { rmssd: 40, sdnn: 58 } },
        apnea: { cvhrIndex: 7, estimatedAHI: { value: 7, band: 'Mild' } },
        sleep: { totalSleepMin: 360, stageMinutes: { REM: 72, Deep: 54, Light: 200, Wake: 34 } },
        ganglior_events: [] }, 'ECGDex', 'night.json')[0];
      T.eq('Integrator: normal overnight still folds cvhrIndex (control)', onRec.summary.cvhrIndex, 7);
      T.ok('Integrator: normal overnight still folds remFraction (control)', isFin(onRec.summary.remFraction), 'remFraction=' + onRec.summary.remFraction);
    } else T.ok('adaptEnvelopeNode present', false);
  });

  /* ════ 24 · LEAF-MODULE COVERAGE — CPAPDex DSP/EDF self-tests + morphology ════
     Brings modules that previously had NO shared gate under both runners:
       · cpapdex-edf.js / cpapdex-dsp.js — ran browser-only before; now Node too.
       · ecgdex-morph.js / ppgdex-morph.js — had no explicit assertion anywhere;
         loaded so ECGDSP/PPGDSP `analyze` run morph-active, plus a presence gate.
     Each EDF/DSP module exposes selfTest()→{pass,fail,log}; morph exposes analyze(). */
  group('Leaf-module coverage — CPAPDex DSP/EDF self-tests + morphology', 'cpapdex-edf · cpapdex-dsp · ecgdex-morph · ppgdex-morph', function (T) {
    var ED = env.CpapEdf, DS = env.CpapDsp, EM = env.ECGMorph, PM = env.PPGMorph;
    var failLog = function (r) {
      return (r.log || []).filter(function (l) { return String(l).charAt(0) === '\u2717'; }).join(' | ');
    };
    if (ED && typeof ED.selfTest === 'function') {
      var re = ED.selfTest();
      T.ok('cpapdex-edf.js self-test (' + re.pass + ' passed)', re.fail === 0, re.fail + ' failed · ' + failLog(re));
    } else T.ok('cpapdex-edf.js loaded with selfTest()', false, 'env.CpapEdf missing in this runner');
    if (DS && typeof DS.selfTest === 'function') {
      var rd = DS.selfTest();
      T.ok('cpapdex-dsp.js self-test (' + rd.pass + ' passed)', rd.fail === 0, rd.fail + ' failed · ' + failLog(rd));
    } else T.ok('cpapdex-dsp.js loaded with selfTest()', false, 'env.CpapDsp missing in this runner');
    T.ok('ecgdex-morph.js exposes analyze() (exercised via ECGDSP.analyze)', !!(EM && typeof EM.analyze === 'function'));
    T.ok('ppgdex-morph.js exposes analyze() (exercised via PPGDSP morphology)', !!(PM && typeof PM.analyze === 'function'));
  });

  /* ════ 24 · FULL-lane waveform fidelity — synthetic → real DSP beat recovery ════
     The ≤500 FULL lane renders a real waveform (PPG @176 Hz via SYNTH.renderPPG,
     ECG µV int16 @130 Hz via CohortFull.renderECGInt16) and runs the REAL detector
     morphology pipelines on it. This gate asserts those detectors RECOVER the planted
     beats — i.e. the synthetic waveform is faithful enough that detected/true is ≈1.
     Closes the hole that let a renderPPG dropout-step bug drive PPGDSP into 2:1
     beat-halving (recovery ~0.6) while every existing group stayed green. */
  group('FULL-lane waveform fidelity — synthetic → real DSP beat recovery', 'cohort-full · ppgdex-dsp · ecgdex-dsp', function (T) {
    var SY = env.SYNTH, CG = env.CohortGen, CF = env.CohortFull, PD = env.PPGDSP, ED = env.ECGDSP;
    var have = !!(SY && CG && CF && PD && ED
      && typeof SY.renderPPG === 'function' && typeof SY.pickWindow === 'function' && typeof SY.buildRR === 'function'
      && typeof CF.renderECGInt16 === 'function' && typeof CG.patient === 'function'
      && typeof PD.parsePPG === 'function' && typeof PD.analyze === 'function' && typeof ED.analyze === 'function');
    T.ok('FULL-lane modules present (SYNTH·CohortGen·CohortFull·PPGDSP·ECGDSP)', have,
      have ? '' : 'pass SYNTH/CohortGen/CohortFull into env in BOTH runners');
    if (!have) return;
    // seed 3 = clean/no-apnea (the 2:1-halving regression case), seed 5 = severe apnea
    var seeds = [3, 5], nPpg = 0, nEcg = 0;
    seeds.forEach(function (seed) {
      var pf;
      try { pf = CG.patient(seed, { only: [], attachTimelines: true }); }
      catch (e) { T.ok('patient ' + seed + ' generates', false, e.message); return; }
      var night = null;
      for (var i = 0; i < pf.nights.length; i++) { var nt = pf.nights[i]; if ((nt.present.ECGDex || nt.present.PulseDex) && nt.tl) { night = nt; break; } }
      if (!night) { T.ok('seed ' + seed + ' has a cardiac night with a timeline', false); return; }
      var tl = night.tl, win = SY.pickWindow(tl);
      var t0 = tl.t0Ms + win.startRel * 1000, t1 = t0 + win.lenSec * 1000;
      var trueBeats = SY.buildRR(tl).filter(function (b) { return b.tMs >= t0 && b.tMs <= t1; }).length;
      if (trueBeats < 20) { T.ok('seed ' + seed + ' window has ≥20 true beats', false, trueBeats); return; }
      // PPG — the regression-critical arm (optical beat detection on renderPPG)
      try {
        var pr = PD.analyze(PD.parsePPG(SY.renderPPG(tl, win)));
        var pRatio = pr.nPulses / trueBeats; nPpg++;
        T.ok('PPG seed ' + seed + ' beat recovery 0.80–1.30 (no 2:1 halving)', pRatio >= 0.80 && pRatio <= 1.30,
          'ratio ' + pRatio.toFixed(2) + ' (' + pr.nPulses + '/' + trueBeats + ', HR ' + pr.hr + ')');
      } catch (e) { T.ok('PPG seed ' + seed + ' analyze runs', false, e.message); }
      // ECG — Pan-Tompkins on the int16 µV waveform
      try {
        var er = ED.analyze(CF.renderECGInt16(tl, win, SY));
        var eRatio = er.nBeats / trueBeats; nEcg++;
        T.ok('ECG seed ' + seed + ' beat recovery 0.90–1.10', eRatio >= 0.90 && eRatio <= 1.10,
          'ratio ' + eRatio.toFixed(2) + ' (' + er.nBeats + '/' + trueBeats + ')');
      } catch (e) { T.ok('ECG seed ' + seed + ' analyze runs', false, e.message); }
    });
    T.ok('exercised PPG + ECG on ≥2 FULL-lane patients each', nPpg >= 2 && nEcg >= 2, 'ppg ' + nPpg + ' · ecg ' + nEcg);
  });

  /* ════ 24 · MULTI-PART SPLIT-FILE CONCATENATION (INGEST-AUDIT §1/§2) ════
     Polar Sensor Logger writes long streams as `…_part01of05.txt`. The shared
     PPGDSP/ECGDSP.mergeMultipart folds them into ONE stream (header from part 1,
     numeric part order). Both apps delegate here, so this exercises the REAL
     ingest path. Behavioral (modules loaded in both runners). */
  group('Multi-part split-file concatenation (ingest §1/§2)', 'ppgdex-dsp · ecgdex-dsp', function (T) {
    [['PPGDSP', env.PPGDSP], ['ECGDSP', env.ECGDSP]].forEach(function (pair) {
      var nm = pair[0], D = pair[1];
      if (!(D && typeof D.mergeMultipart === 'function' && typeof D.partKey === 'function')) { T.ok(nm + '.mergeMultipart + partKey present', false); return; }
      // partKey: strips the part suffix, returns numeric part/total
      var pk = D.partKey('Polar_2026-06-17_PPG_part02of15.txt');
      T.ok(nm + ' partKey base strips part suffix', pk && pk.base === 'Polar_2026-06-17_PPG.txt', pk && pk.base);
      T.ok(nm + ' partKey parses numeric part/total', pk && pk.part === 2 && pk.total === 15);
      T.ok(nm + ' partKey returns null for a non-part name', D.partKey('Polar_PPG.txt') === null);
      // feed parts OUT OF ORDER with repeated headers; expect ONE merged stream
      var H = 'Phone timestamp;val';
      var parts = [
        { name: 'cap_ECG_part10of10.txt', text: H + '\n100\n101' },     // part 10 first (tests numeric, not lexical, order)
        { name: 'cap_ECG_part02of10.txt', text: H + '\nb2\nc2' },
        { name: 'cap_ECG_part01of10.txt', text: H + '\na1\nb1' },
        { name: 'companion_ACC.txt',      text: 'x;y;z\n1;2;3' }        // a single (non-part) file passes through
      ];
      var out = D.mergeMultipart(parts);
      T.eq(nm + ' folds 3 parts + 1 single → 2 streams', out.length, 2);
      var merged = out.filter(function (o) { return o.parts; })[0];
      var single = out.filter(function (o) { return !o.parts; })[0];
      T.ok(nm + ' merged stream records part count', merged && merged.parts === 3);
      T.ok(nm + ' merged base name strips part suffix', merged && merged.name === 'cap_ECG.txt', merged && merged.name);
      T.ok(nm + ' single (non-part) file passes through untouched', !!single && /companion_ACC/.test(single.name));
      // header appears EXACTLY once; data rows in numeric part order (1,2,…,10)
      var lines = merged.text.split(/\n/);
      var headerCount = lines.filter(function (l) { return l === H; }).length;
      T.eq(nm + ' repeated header dropped (appears once)', headerCount, 1);
      T.eq(nm + ' data concatenated in numeric part order', lines.filter(function (l) { return l && l !== H; }).join(','), 'a1,b1,b2,c2,100,101');
    });
  });

  /* ════ 25 · EMPTY / ALL-ZERO ONBOARD STREAM → EXPLICIT NULL (INGEST-AUDIT §3) ════
     PulseDex trusts the device interval stream, so a header-only PPI or an
     all-zero HR/PPI must surface an explicit {usable:false, reason} and a UI
     message pointing at the raw-waveform node — never a blank/zero analysis.
     parseRRInput isn't headless-loadable (global-scope DSP), so this is a
     source-mirror gate like the oxydex-dsp groups (#13/#14/#15). */
  group('PulseDex empty/all-zero onboard stream → explicit null (ingest §3)', 'pulsedex-dsp · pulsedex-app', function (T) {
    var dsp = (env.sources || {})['pulsedex-dsp.js'];
    var app = (env.sources || {})['pulsedex-app.js'];
    T.ok('pulsedex-dsp.js source available', !!dsp);
    T.ok('pulsedex-app.js source available', !!app);
    if (dsp) {
      T.ok('parseRRInput counts physiological intervals (nUsable)', /nUsable\s*[+]{2}|nUsable\s*=/.test(dsp));
      T.ok('parseRRInput returns an explicit `usable` flag', /\busable\b\s*:\s*usable/.test(dsp) || /usable\s*=\s*nUsable\s*>=\s*10/.test(dsp));
      T.ok('parseRRInput returns a `reason` (never silent-empty)', /\breason\b/.test(dsp) && /no usable beats/.test(dsp));
      T.ok('all-zero / out-of-range stream flagged with a reason', /outside the physiological range/.test(dsp));
    }
    if (app) {
      T.ok('calculate() gates on parsed.usable === false', /parsed\.usable\s*===\s*false/.test(app));
      T.ok('empty/all-zero stream points the user at the raw-waveform node (PpgDex)', /PpgDex/.test(app) && /raw optical waveform/.test(app));
    }
  });

  /* ════ PulseDex Phase-9 — headless PulseDex.compute() public surface ════
     SIGNAL-ADAPTER-FOLLOWUPS §1/§2/§9a. PulseDex now splits READING from
     COMPUTING and exposes a DOM-free compute(SignalFrame(rr)|vals) →
     ganglior.node-export that runs the FULL windowing (hrv_drop + stress_peak +
     short branch). The app's exportGanglior and signal-orchestrate.js (the
     Data-Unifier/OverDex chokepoint) BOTH call it, so the reach-in into private
     _pdSeriesStats is gone and the event set is byte-identical across all three.
     Source-mirror gate (pulsedex bare globals aren't headless-loadable in the
     Node vm); functional coverage runs in the browser render-coverage rig. */
  group('PulseDex Phase-9 — compute() surface + orchestrate cutover', 'pulsedex-dsp · signal-orchestrate', function (T) {
    var src = env.sources || {};
    var dsp = src['pulsedex-dsp.js'], app2 = src['pulsedex-app.js'], orch = src['signal-orchestrate.js'];
    if (dsp) {
      T.ok('pulsedex-dsp.js exposes PulseDex.compute', /PulseDex\.compute\s*=/.test(dsp));
      T.ok('pulsedex-dsp.js splits reading→computing (pdComputeResult)', /function\s+pdComputeResult\b/.test(dsp));
      T.ok('pulsedex-dsp.js has ONE export builder (pdBuildNodeExport)', /function\s+pdBuildNodeExport\b/.test(dsp));
      T.ok('pulsedex-dsp.js windowing emits both hrv_drop AND stress_peak (§2 parity)',
        /function\s+pdEventsFromResult\b/.test(dsp) && /impulse:\s*'hrv_drop'/.test(dsp) && /impulse:\s*'stress_peak'/.test(dsp));
    }
    if (app2) {
      T.ok('exportGanglior delegates to the shared builder (no 2nd inline copy)', /pdBuildNodeExport\(lastResult/.test(app2));
    }
    if (orch) {
      T.ok('signal-orchestrate calls PulseDex.compute()', /PulseDex\.compute\(/.test(orch));
      T.ok('signal-orchestrate no longer reaches into private _pdSeriesStats (§1)', !/_pdSeriesStats/.test(orch));
      T.ok('signal-orchestrate no longer hand-rolls its own hrv_drop windowing', !/impulse:\s*'hrv_drop'/.test(orch));
      T.ok('signal-orchestrate dropped the isolation iframe (§3 co-load — no srcdoc host)', !/srcdoc/.test(orch));
      T.ok('signal-orchestrate co-loads the namespaced DSP (no createElement iframe host)', !/createElement\(\s*['"]iframe/.test(orch));
      T.ok('signal-orchestrate exposes the unified emitNodeExport dispatch (-II §4)', /function\s+emitNodeExport\b/.test(orch) && /signalType/.test(orch));
    } else {
      T.ok('signal-orchestrate.js source available (in SOURCE_FILES)', false, 'add it to both runners');
    }
  });

  /* ════ OxyDex Phase-9 — headless OxyDex.compute() + spo2 adapter ════
     SIGNAL-ADAPTER-FOLLOWUPS §4 (OxyDex leg). OxyDex splits READING (pure
     parseCSV) from COMPUTING (processNight) behind a DOM-free
     OxyDex.compute(SignalFrame(spo2)|rows|{text}) → ganglior.node-export single-
     night summary; adapters/oxydex-spo2.js routes O2Ring CSVs; signal-orchestrate
     hosts OxyDex in isolation and emits via emitSpO2NodeExport; the Integrator's
     adaptOxyDex synthesizes events from desatProfile/hr_spikes. Source-mirror +
     a functional adapter-route check (compute() runs in the browser rig). */
  group('OxyDex Phase-9 — compute() surface + spo2 adapter', 'oxydex-dsp · adapters · signal-orchestrate', function (T) {
    var src = env.sources || {};
    var dsp = src['oxydex-dsp.js'], app2 = src['oxydex-app.js'], orch = src['signal-orchestrate.js'];
    if (dsp) {
      T.ok('oxydex-dsp.js exposes OxyDex.compute', /OxyDex\.compute\s*=/.test(dsp));
      T.ok('oxydex-dsp.js has ONE night-element builder (oxyBuildNightElement)', /function\s+oxyBuildNightElement\b/.test(dsp));
      T.ok('oxydex-dsp.js splits reading→computing (oxyComputeNight→processNight)', /function\s+oxyComputeNight\b/.test(dsp) && /processNight\(/.test(dsp));
      T.ok('oxydex-dsp.js top-level upload wiring guarded (headless-loadable)', /if\s*\(\s*ua\s*\)/.test(dsp));
    }
    if (app2) {
      T.ok('exportJSON delegates to the shared oxyBuildNightElement (no 2nd inline copy)', /oxyBuildNightElement\(\s*n\b/.test(app2));
    }
    if (orch) {
      T.ok('signal-orchestrate has a co-loaded OxyDex host (oxyHost)', /function\s+oxyHost\b/.test(orch));
      T.ok('signal-orchestrate emits SpO₂ via OxyDex.compute (emitSpO2NodeExport)', /emitSpO2NodeExport/.test(orch) && /OxyDex\.compute\(/.test(orch));
    }
    // Functional: the spo2 adapter registers + routes an O2Ring CSV (runs in BOTH runners).
    var SA = env.SignalAdapters;
    if (SA && typeof SA.route === 'function') {
      var ids = (SA.list ? SA.list() : []).map(function (a) { return a.id; });
      T.ok('oxydex-spo2 adapter registered', ids.indexOf('oxydex-spo2') >= 0, ids.join(','));
      var o2head = 'Time,Oxygen Level,Pulse Rate,Motion\n2026-06-12T23:00:00,97,54,0';
      var ro = SA.route({ name: 'O2Ring S 2100_20260612230016.csv' }, o2head);
      T.ok('routes an O2Ring CSV → oxydex-spo2 / spo2', !!(ro.best && ro.best.id === 'oxydex-spo2' && ro.best.signalType === 'spo2'), ro.best ? (ro.best.id + '/' + ro.best.signalType) : 'no best');
      var rr = SA.route({ name: 'polar_rr.txt' }, 'Phone timestamp;RR-interval [ms]\n2026-06-12T23:00:00.000+02:00;850');
      T.ok('Polar RR still routes to rr (no spo2 regression)', !!(rr.best && rr.best.signalType === 'rr'), rr.best ? rr.best.signalType : 'no best');
    }
  });

  /* ════ OxyDex HR-artifact runaway clamp + sensor warm-up trim (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-2026-07-03) ════
     User-reported "100 bpm absolutely wrong" + "first few seconds always look like artifacts". Two coupled
     defects, both seeded by the O2Ring's frozen warm-up placeholder (observed SpO2 84 / HR 100 held until the
     finger-clip perfusion lock, then the true signal). Fix 1: cleanArtifactHR's recovery search is BOUNDED
     (CFG.HR_ARTIFACT_MAX_RUN_SEC) — a non-recovering jump no longer clamps the whole night to a stale anchor.
     Fix 2: trimSensorWarmup drops the frozen edge placeholder (adaptive length, lock-on-step gated) BEFORE
     any metric reads the rows. Verified end-to-end (compute()) AND as isolated units. Runs in BOTH runners
     when the namespace is wired; skips gracefully otherwise. */
  group('OxyDex HR-artifact runaway clamp + warm-up trim (100bpm fix)', 'oxydex-dsp', function (T) {
    var OD = env.OxyDex;
    if (!(OD && typeof OD.trimSensorWarmup === 'function' && typeof OD.cleanArtifactHR === 'function')) {
      T.ok('env.OxyDex.trimSensorWarmup + cleanArtifactHR available', false, 'namespace not wired — gate skipped'); return;
    }
    // row factory (trimSensorWarmup/cleanArtifactHR read spo2/hr; t supplied for the clock-hour soft rule)
    function rows(specs) { // specs: [ [spo2,hr,count], ... ]
      var out = [], t0 = Date.UTC(2026, 5, 12, 23, 0, 0), n = 0;
      specs.forEach(function (s) { for (var i = 0; i < s[2]; i++) { out.push({ spo2: s[0], hr: s[1], motion: 0, tMs: t0 + n * 1000, t: new Date(t0 + n * 1000) }); n++; } });
      return out;
    }

    // ── Fix 2 · trimSensorWarmup ──────────────────────────────────────────────
    // (a) frozen 84/100 placeholder ended by a perfusion lock-on step → head trimmed to the real signal.
    var warm = rows([[84, 100, 25], [93, 53, 200]]);
    var tr = OD.trimSensorWarmup(warm);
    T.eq('warm-up: 25-row frozen 84/100 placeholder trimmed at head', tr.head, 25);
    T.eq('warm-up: nothing trimmed at tail', tr.tail, 0);
    T.eq('warm-up: first surviving row is the real lock-on sample (hr 53)', warm[0].hr, 53);

    // (b) real elevated-HR settling (mirrors fixture night 20260624: 97/103 easing DOWN, not frozen) → KEPT.
    var settleSpecs = [], hr = 103; for (var k = 0; k < 40; k++) { settleSpecs.push([97, hr, 1]); if (hr > 55) hr -= 1; }
    settleSpecs.push([97, 55, 200]);
    var settle = rows(settleSpecs);
    var trS = OD.trimSensorWarmup(settle);
    T.eq('real elevated-HR settling flat is NOT trimmed (no frozen run + lock step)', trS.head, 0);

    // (c) clean immediate lock (mirrors fixture night 20260612: signal from row 0, minor variation) → KEPT.
    var cleanSpecs = []; for (var j = 0; j < 240; j++) cleanSpecs.push([96 + (j % 3), 54 + (j % 5), 1]);
    var clean = rows(cleanSpecs);
    T.eq('clean immediate-lock night is NOT trimmed', OD.trimSensorWarmup(clean).head, 0);

    // (d) a frozen run NOT ended by a lock-on step (SpO2 drifts +1, HR flat) is NOT a placeholder → KEPT.
    var frozenNoStep = rows([[95, 60, 12], [96, 60, 200]]);   // +1 SpO2 < WARMUP_SPO2_STEP(4), ΔHR 0
    T.eq('frozen edge run without a lock-on step is NOT trimmed', OD.trimSensorWarmup(frozenNoStep).head, 0);

    // ── Fix 1 · cleanArtifactHR bounded recovery search ───────────────────────
    // (e) a big jump that NEVER recovers must NOT clamp the rest of the recording to the stale anchor.
    var runaway = rows([[95, 55, 30], [95, 100, 120]]);  // +45 jump, then 120 rows never returning near 55
    var cleanedRunaway = OD.cleanArtifactHR(runaway);
    var tailAt = runaway[runaway.length - 1].hr;
    T.eq('runaway: a non-recovering jump does NOT clamp the tail to the stale anchor (stays 100, not 55)', tailAt, 100);
    T.ok('runaway: far fewer than the whole run is clamped (bounded blast radius)', cleanedRunaway < 120, cleanedRunaway + ' rows clamped of 120');
    // (f) a SHORT real artifact that recovers is STILL clamped (no regression in the normal path).
    var blip = rows([[95, 55, 30], [95, 90, 4], [95, 55, 120]]);  // +35 spike, recovers after 4 samples
    var cleanedBlip = OD.cleanArtifactHR(blip);
    T.ok('short recovering artifact is still cleaned (normal path intact)', cleanedBlip >= 4 && cleanedBlip <= 8, cleanedBlip + ' rows clamped');
    T.eq('short artifact: the spike samples are clamped to baseline 55', blip[32].hr, 55);

    // ── End-to-end · the exact reported bug via compute() ─────────────────────
    if (typeof OD.compute === 'function') {
      var csv = (function () {
        var L = ['Time,Oxygen Level,Pulse Rate,Motion'], t0 = Date.UTC(2026, 5, 12, 22, 5, 21), n = 0;
        function p2(x) { return x < 10 ? '0' + x : '' + x; }
        function stamp(ms) { var d = new Date(ms); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) + ' ' + p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); }
        function push(sp, hr) { L.push(stamp(t0 + n * 1000) + ',' + sp + ',' + hr + ',0'); n++; }
        var i; for (i = 0; i < 25; i++) push(84, 100);                 // frozen warm-up placeholder
        for (i = 0; i < 1200; i++) push(94 + (i % 4), 50 + (i % 6));   // real sleep signal ~50 bpm, ~95%
        return L.join('\n');
      })();
      var exp = OD.compute({ text: csv, fileMeta: { fname: 'O2Ring_test_20260512220521.csv' } });
      var s = exp && exp.nights && exp.nights[0] && exp.nights[0].stats;
      T.ok('compute() returns a night with stats', !!s, s ? 'ok' : 'no stats');
      if (s) {
        T.ok('meanHr is the real ~50s, NOT the placeholder 100', s.meanHr > 45 && s.meanHr < 60, 'meanHr=' + s.meanHr);
        T.ok('maxHr is not pinned at the placeholder 100', s.maxHr < 90, 'maxHr=' + s.maxHr);
        T.ok('minSpo2 is the real signal (≥90), NOT the placeholder 84', s.minSpo2 >= 90, 'minSpo2=' + s.minSpo2);
        T.eq('sensorWarmupTrimmed records the 25-sample trim', s.sensorWarmupTrimmed, 25);
      }
    }
  });

  /* ════ OxyDex nadir honesty — gated minSpo2 (OXYDEX-HR-ARTIFACT-RUNAWAY-FIX-FOLLOWUPS §1/§2) ════
     The headline nadir (minSpo2 / SPO2_CRITICAL_DIP / "nadir SpO₂ N%") must ignore non-physiological
     lows: an opening perfusion-settling RAMP (§1) and self-gated ARTIFACT desaturations (§2 — the SAME
     tested SELFGATE verdict the ODI already excludes). computeGatedNadir is unit-tested directly (hand-
     built desat.eventsAll, no self-gate dependency) + end-to-end via compute(). A REAL desat must survive. */
  group('OxyDex nadir honesty — gated minSpo2 (FOLLOWUPS §1/§2)', 'oxydex-dsp', function (T) {
    var OD = env.OxyDex;
    if (!(OD && typeof OD.computeGatedNadir === 'function')) { T.ok('env.OxyDex.computeGatedNadir available', false, 'namespace not wired — gate skipped'); return; }
    function mk(specs){ var o=[]; specs.forEach(function(s){ for(var i=0;i<s[1];i++) o.push({spo2:s[0],hr:60,motion:0}); }); return o; }

    // (1) no artifact + no opening ramp → gated nadir == raw min (the common case; committed fixtures rely on this).
    var plain = mk([[97,600],[88,20],[97,600]]);
    var g1 = OD.computeGatedNadir(plain, { eventsAll: [] }, 88);
    T.eq('no artifact + no ramp → gated nadir equals raw min (88)', g1.min, 88);
    T.eq('no exclusions', g1.excluded, 0);

    // (2) a self-gated ARTIFACT desat over the deep region is excluded → nadir rises to the real floor.
    var cliff = mk([[97,600],[61,3],[97,600]]);
    var g2 = OD.computeGatedNadir(cliff, { eventsAll: [{ artifact: true, startIdx: 600, endIdx: 602 }] }, 61);
    T.eq('self-gated artifact cliff (61) excluded from nadir → 97', g2.min, 97);
    T.eq('excluded exactly the 3 cliff samples', g2.excluded, 3);

    // (2b) a NON-artifact (real) desat MUST survive — we only drop physiologically-impossible lows.
    var realDip = mk([[97,600],[85,20],[97,600]]);
    T.eq('a real (non-artifact) desat is NOT excluded — 85 kept', OD.computeGatedNadir(realDip, { eventsAll: [{ artifact: false, startIdx: 600, endIdx: 619 }] }, 85).min, 85);

    // (3) opening settling ramp (starts ≤88, climbs monotonically to ≥90) → excluded from the nadir.
    var ramp = mk([[81,4],[83,4],[86,4],[89,4],[92,600]]);
    var g3 = OD.computeGatedNadir(ramp, { eventsAll: [] }, 81);
    T.ok('opening ramp low (81) excluded → nadir ≥ 90', g3.min >= 90, 'gated=' + g3.min);
    T.ok('ramp samples excluded', g3.excluded >= 12, 'excluded=' + g3.excluded);

    // (3b) after the opening ramp, a genuine LATER dip must still be the nadir (ramp mask is opening-only).
    var rampThenDip = mk([[82,4],[86,4],[92,300],[84,20],[95,300]]);
    T.eq('a later real dip (84) after the opening ramp is still the nadir', OD.computeGatedNadir(rampThenDip, { eventsAll: [] }, 82).min, 84);

    // (3c) a low that is NOT at the very start (a mid-record dip, series starts high) is NOT ramp-masked.
    var midDip = mk([[97,300],[84,10],[97,300]]);
    T.eq('a mid-record low with a high start is NOT ramp-masked (84 kept)', OD.computeGatedNadir(midDip, { eventsAll: [] }, 84).min, 84);

    // (4) never masks the whole night — if everything is flagged, fall back to raw min (never fabricate).
    var allLow = mk([[80,300]]);
    T.eq('never masks everything → falls back to raw min (80)', OD.computeGatedNadir(allLow, { eventsAll: [{ artifact: true, startIdx: 0, endIdx: 299 }] }, 80).min, 80);

    // End-to-end: an opening-ramp night through compute() → minSpo2 gated to the plateau, raw preserved.
    if (typeof OD.compute === 'function') {
      var csv = (function(){
        var L=['Time,Oxygen Level,Pulse Rate,Motion'], t0=Date.UTC(2026,5,12,22,0,0), n=0;
        function p2(x){return x<10?'0'+x:''+x;}
        function st(ms){var d=new Date(ms);return p2(d.getUTCHours())+':'+p2(d.getUTCMinutes())+':'+p2(d.getUTCSeconds())+' '+p2(d.getUTCDate())+'/'+p2(d.getUTCMonth()+1)+'/'+d.getUTCFullYear();}
        function push(sp,hr){L.push(st(t0+n*1000)+','+sp+','+hr+',0');n++;}
        var i,v; for(v=81;v<=95;v++) push(v,55);            // opening perfusion ramp 81→95 (not frozen → trimSensorWarmup leaves it)
        for(i=0;i<1200;i++) push(96+(i%3),52+(i%5));        // real signal ~96–98%, never critical
        return L.join('\n');
      })();
      var exp = OD.compute({ text: csv, fileMeta:{ fname:'O2Ring_ramp_20260512220000.csv' } });
      var s = exp && exp.nights && exp.nights[0] && exp.nights[0].stats;
      T.ok('compute() ramp night returns stats', !!s);
      if (s) {
        T.ok('compute(): opening-ramp nadir gated up off 81 (≥90, not critical)', s.minSpo2 >= 90, 'minSpo2=' + s.minSpo2);
        T.eq('compute(): raw absolute min preserved as minSpo2Raw (81)', s.minSpo2Raw, 81);
      }
    }
  });

  /* ════ OxyDex node-export v2.0 envelope + ganglior_events[] (OXYDEX-NODE-EXPORT-ENVELOPE-2026-06-27) ════
     The emit-side contract for the UNCONDITIONAL v2.0 envelope. Runs LIVE in BOTH runners: a deterministic
     hand-built O2Ring CSV (two gradual desaturations, depth 7% + 9%, both passing the kinetics self-gate)
     → OxyDex.compute() → envelope; env.normalizeFile re-ingests it. Covers brief §5:
       1 envelope schema   2 validateNodeExport passes   3 tolerant reader (array ≡ envelope)
       4 event tiers from OXY_REGISTRY (never `measured`)   5 round-trip tMs   6 conf ≠ tier. */
  group('OxyDex node-export v2.0 envelope + ganglior_events', 'oxydex-dsp · oxydex-registry · integrator-dsp · crossnight-envelope', function (T) {
    var OD = env.OxyDex, CNE = env.CrossNightEnvelope, NF = env.normalizeFile, OR = env.OxyRegistry, REG = env.OXY_REGISTRY;
    if (!(OD && typeof OD.compute === 'function')) { T.ok('env.OxyDex.compute available', false, 'namespace not wired — gate skipped'); return; }
    // deterministic O2Ring CSV: 600 s stable @97 → desat to 90 (depth 7) → recover → desat to 88 (depth 9)
    // → tail. Ramps are 1 %/s so the oximeter self-gate (FALL_RATE_MAX 1.5 %/s) keeps both desats REAL.
    var csv = (function () {
      var rows = ['Time,Oxygen Level,Pulse Rate,Motion'], t0 = Date.UTC(2026, 5, 12, 23, 0, 0), n = 0;
      function p2(x) { return x < 10 ? '0' + x : '' + x; }
      function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()); }
      function push(spo2, hr) { rows.push(iso(t0 + n * 1000) + ',' + spo2 + ',' + hr + ',0'); n++; }
      function ramp(a, b, hr) { var s = a < b ? 1 : -1; for (var v = a + s; s > 0 ? v <= b : v >= b; v += s) push(v, hr); }
      var i;
      for (i = 0; i < 600; i++) push(97, 55);
      ramp(97, 90, 60); for (i = 0; i < 25; i++) push(90, 64); ramp(90, 97, 56);   // desat #1 — depth 7
      for (i = 0; i < 60; i++) push(97, 55);
      ramp(97, 88, 66); for (i = 0; i < 25; i++) push(88, 68); ramp(88, 97, 56);   // desat #2 — depth 9
      for (i = 0; i < 120; i++) push(97, 55);
      return rows.join('\n');
    })();
    var exp = OD.compute({ text: csv, fileMeta: { fname: 'O2Ring_test_20260512230000.csv' } });
    // ── 1 · envelope schema ──
    T.ok('compute() → ganglior.node-export v2.0 envelope (name/version/node)', !!(exp && exp.schema && exp.schema.name === 'ganglior.node-export' && exp.schema.version === '2.0' && exp.schema.node === 'OxyDex'), exp && exp.schema ? (exp.schema.name + '/' + exp.schema.version) : 'no schema');
    T.ok('recording.startEpochMs is a finite floating number (t0Ms)', !!(exp && exp.recording && typeof exp.recording.startEpochMs === 'number' && isFinite(exp.recording.startEpochMs)), exp && exp.recording ? ('' + exp.recording.startEpochMs) : 'no recording');
    T.ok('ganglior_events[] key PRESENT and is an array', !!(exp && Array.isArray(exp.ganglior_events)), exp ? (Array.isArray(exp.ganglior_events) ? exp.ganglior_events.length + ' events' : typeof exp.ganglior_events) : 'no exp');
    T.ok('nights[] present (per-night summaries; additive wrapper)', !!(exp && Array.isArray(exp.nights) && exp.nights.length >= 1));
    var evs = (exp && Array.isArray(exp.ganglior_events)) ? exp.ganglior_events : [];
    var desats = evs.filter(function (e) { return e.impulse === 'desat_event'; });
    T.ok('the two scored desaturations emit as desat_event (real node emission, not synthesis)', desats.length === 2, desats.length + ' desat_event(s)');
    // ── 2 · validateNodeExport passes with ZERO errors ──
    if (CNE && typeof CNE.validateNodeExport === 'function') {
      var vr = CNE.validateNodeExport(exp);
      T.ok('CrossNightEnvelope.validateNodeExport → ok, ZERO errors', !!(vr && vr.ok && vr.errors.length === 0), vr ? vr.errors.slice(0, 4).join(' · ') : 'no result');
    } else { T.ok('CrossNightEnvelope.validateNodeExport available', false); }
    var impOK = evs.every(function (e) { return e.impulse === 'desat_event' || e.impulse === 'periodic_breathing'; });
    T.ok('every event is desat_event | periodic_breathing (honest SpO₂-proxy vocabulary)', evs.length > 0 && impOK, 'n=' + evs.length);
    var shapeOK = evs.every(function (e) { return typeof e.t === 'string' && /^\d{1,2}:\d{2}:\d{2}$/.test(e.t) && typeof e.tMs === 'number' && isFinite(e.tMs) && e.node === 'OxyDex' && typeof e.conf === 'number' && e.conf >= 0 && e.conf <= 1; });
    T.ok('every event carries t "HH:MM:SS" + floating tMs + conf 0..1 (Clock Contract §6)', evs.length > 0 && shapeOK);
    var mono = true; for (var mi = 1; mi < evs.length; mi++) { if (evs[mi].tMs < evs[mi - 1].tMs) { mono = false; break; } }
    T.ok('events are chronological (tMs monotonic non-decreasing)', mono);
    // ── 4 · event tiers resolve via OXY_REGISTRY, never `measured` ──
    if (OR && typeof OR.idForLabel === 'function' && REG) {
      var tierFor = function (e) {
        var label = e.impulse === 'periodic_breathing' ? 'Periodic breathing'
          : (e.meta && e.meta.depth != null && e.meta.depth < 4 ? 'ODI-3' : 'ODI-4');
        var id = OR.idForLabel(label); return (id && REG[id]) ? REG[id].evidence : null;
      };
      var tiers = evs.map(tierFor);
      T.ok('every emitted event resolves a registry grade via OxyRegistry.idForLabel', evs.length > 0 && tiers.every(function (g) { return !!g; }), tiers.filter(function (g) { return !g; }).length + ' unresolved');
      T.ok('no emitted event is graded `measured` (SpO₂ proxy ≠ direct airflow)', tiers.every(function (g) { return g !== 'measured'; }), tiers.join(','));
      T.eq('periodic_breathing → experimental tier (registry)', (function () { var id = OR.idForLabel('Periodic breathing'); return id && REG[id] && REG[id].evidence; })(), 'experimental');
      T.eq('desat_event (ODI-4 grade) → validated tier (registry)', (function () { var id = OR.idForLabel('ODI-4'); return id && REG[id] && REG[id].evidence; })(), 'validated');
    } else { T.ok('OxyRegistry.idForLabel + OXY_REGISTRY available', false); }
    // ── 6 · conf ≠ tier — two same-tier desats of DIFFERENT depth get DIFFERENT conf ──
    var byDepth = {}; desats.forEach(function (e) { var d = e.meta && e.meta.depth; if (d != null) byDepth[d] = e.conf; });
    var depthKeys = Object.keys(byDepth);
    if (depthKeys.length >= 2) {
      var confVals = {}; depthKeys.forEach(function (k) { confVals[byDepth[k]] = 1; });
      T.ok('conf is continuous f(depth,…), NOT the discrete tier (≥2 depths → ≥2 distinct conf)', Object.keys(confVals).length >= 2, depthKeys.length + ' depths → ' + Object.keys(confVals).length + ' conf');
      T.ok('deeper desat carries higher conf (monotone in depth)', byDepth['9'] > byDepth['7'], '7→' + byDepth['7'] + ' 9→' + byDepth['9']);
    } else { T.ok('conf≠tier needs ≥2 desat depths (informational)', true, depthKeys.length + ' depth(s)'); }
    // ── 3 · tolerant reader + 5 · round-trip tMs (re-ingest through the Integrator adapter) ──
    if (typeof NF === 'function') {
      var recV2 = (NF(exp, 'oxydex_v2_envelope.json') || {}).recs || [];
      var recLegacy = (NF(exp.nights, 'oxydex_legacy_array.json') || {}).recs || [];   // bare array → synthesis path
      T.ok('tolerant reader: envelope AND legacy bare array ingest to the same night count', recV2.length >= 1 && recV2.length === recLegacy.length, 'v2=' + recV2.length + ' legacy=' + recLegacy.length);
      if (recV2.length && recLegacy.length) {
        T.eq('tolerant reader: same night t0Ms from both shapes', recV2[0].t0Ms, recLegacy[0].t0Ms);
        T.eq('tolerant reader: same night summary.odi4 from both shapes', recV2[0].summary.odi4, recLegacy[0].summary.odi4);
      }
      var ingestedTMs = []; recV2.forEach(function (r) { (r.events || []).forEach(function (e) { ingestedTMs.push(e.tMs); }); });
      ingestedTMs.sort(function (a, b) { return a - b; });
      var emittedTMs = evs.map(function (e) { return e.tMs; }).slice().sort(function (a, b) { return a - b; });
      T.eq('round-trip: re-ingested event count == emitted', ingestedTMs.length, emittedTMs.length);
      T.ok('round-trip: re-ingested tMs IDENTICAL to emitted (Clock Contract §6)', JSON.stringify(ingestedTMs) === JSON.stringify(emittedTMs), emittedTMs.length ? ('first ' + emittedTMs[0]) : 'no events');
    } else { T.ok('normalizeFile (Integrator adapter) available', false); }
  });

  /* ════ SELF-INGEST — loadOwnExport clinical reload (SELF-INGEST-2026-06-27 §7) ════
     Reload OxyDex's OWN v2.0 envelope back into OxyDex as a FAITHFUL, review-mode clinical view —
     never recompute, re-grade, or re-stamp. Runs LIVE in BOTH runners off OxyDex.compute() +
     OxyDex.loadOwnExport() (the same deterministic O2Ring CSV the envelope group uses). Covers §7:
       1 round-trip   2 faithful view (no drift)   3 provenance preserved (no re-stamp)
       4 tier preserved (no upgrade)   5 review-mode not faked   6 foreign-node guard   7 scrub. */
  group('Self-ingest — loadOwnExport clinical reload', 'oxydex-dsp · self-ingest', function (T) {
    var OD = env.OxyDex, src = env.sources || {};
    if (!(OD && typeof OD.compute === 'function' && typeof OD.loadOwnExport === 'function')) {
      T.ok('env.OxyDex.compute + loadOwnExport available', false, 'namespace not wired — gate skipped'); return;
    }
    // same deterministic O2Ring CSV as the envelope group (two scored desats, depth 7 + 9).
    var csv = (function () {
      var rows = ['Time,Oxygen Level,Pulse Rate,Motion'], t0 = Date.UTC(2026, 5, 12, 23, 0, 0), n = 0;
      function p2(x) { return x < 10 ? '0' + x : '' + x; }
      function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()); }
      function push(spo2, hr) { rows.push(iso(t0 + n * 1000) + ',' + spo2 + ',' + hr + ',0'); n++; }
      function ramp(a, b, hr) { var s = a < b ? 1 : -1; for (var v = a + s; s > 0 ? v <= b : v >= b; v += s) push(v, hr); }
      var i;
      for (i = 0; i < 600; i++) push(97, 55);
      ramp(97, 90, 60); for (i = 0; i < 25; i++) push(90, 64); ramp(90, 97, 56);
      for (i = 0; i < 60; i++) push(97, 55);
      ramp(97, 88, 66); for (i = 0; i < 25; i++) push(88, 68); ramp(88, 97, 56);
      for (i = 0; i < 120; i++) push(97, 55);
      return rows.join('\n');
    })();
    var envlp = OD.compute({ text: csv, fileMeta: { fname: 'O2Ring_test_20260512230000.csv' } });
    T.ok('compute() produced a v2.0 envelope to reload', !!(envlp && envlp.schema && envlp.schema.name === 'ganglior.node-export' && Array.isArray(envlp.nights) && envlp.nights.length >= 1));

    // ── 1 · ROUND-TRIP self-ingest ──
    var res = OD.loadOwnExport(envlp);
    T.ok('loadOwnExport(own envelope) → ok + reviewMode', !!(res && res.ok === true && res.reviewMode === true), res ? ('ok=' + res.ok) : 'no result');
    T.ok('reconstructed nights[] count == envelope nights[] count', !!(res && res.ok) && res.nights.length === envlp.nights.length, res && res.ok ? (res.nights.length + '/' + envlp.nights.length) : '');
    var emitTMs = (envlp.ganglior_events || []).map(function (e) { return e.tMs; }).slice().sort(function (a, b) { return a - b; });
    var loadTMs = ((res && res.events) || []).map(function (e) { return e.tMs; }).slice().sort(function (a, b) { return a - b; });
    T.ok('round-trip: reloaded ganglior_events tMs IDENTICAL to emitted', JSON.stringify(emitTMs) === JSON.stringify(loadTMs), emitTMs.length + ' events');

    // ── 2 · FAITHFUL VIEW (no recompute drift) — reconstructed night values == export stored values ──
    if (res && res.ok && res.nights.length) {
      var rn = res.nights[0], el = envlp.nights[0];
      var fields = [
        ['stats.meanSpo2', rn.stats && rn.stats.meanSpo2, el.stats && el.stats.meanSpo2],
        ['stats.minSpo2', rn.stats && rn.stats.minSpo2, el.stats && el.stats.minSpo2],
        ['stats.t90pct', rn.stats && rn.stats.t90pct, el.stats && el.stats.t90pct],
        ['t0Ms', rn.t0Ms, el.t0Ms],
        ['odi4.rate', rn.odi4 && rn.odi4.rate, el.odi4 && el.odi4.rate],
        ['odi4.count', rn.odi4 && rn.odi4.count, el.odi4 && el.odi4.count],
        ['hb.rate', rn.hb && rn.hb.rate, el.hypoxicBurden && el.hypoxicBurden.rate]
      ];
      var drift = fields.filter(function (f) { return f[1] !== f[2]; }).map(function (f) { return f[0] + ':' + f[1] + '\u2260' + f[2]; });
      T.ok('faithful view: reconstructed night values == export stored values (no drift)', drift.length === 0, drift.slice(0, 5).join(' · '));
    }

    // ── 5 · REVIEW MODE not faked — every reconstructed night is flagged from-export ──
    T.ok('review-mode: every reconstructed night marked _fromExport (raw panels greyed, never faked)', !!(res && res.ok) && res.nights.length > 0 && res.nights.every(function (n) { return n._fromExport === true && n._reviewMode === true; }));

    // ── 3 · PROVENANCE preserved (no re-stamp) ──
    var fakeProv = { buildHash: 'abc123def456', generated: '2026-06-12T23:00:00Z', inputs: [{ name: 'O2Ring S 2100_x.csv', sha256: 'deadbeef', bytes: 12345 }] };
    var envWithProv = JSON.parse(JSON.stringify(envlp)); envWithProv.schema.provenance = fakeProv;
    var resP = OD.loadOwnExport(envWithProv);
    T.ok('provenance preserved VERBATIM (view provenance == export provenance)', JSON.stringify(resP.provenance) === JSON.stringify(fakeProv));
    var dsp = src['oxydex-dsp.js'] || '';
    var loadSeg = (dsp.indexOf('function oxyLoadOwnExport') >= 0 && dsp.indexOf('function oxyScrubExport') > dsp.indexOf('function oxyLoadOwnExport'))
      ? dsp.slice(dsp.indexOf('function oxyLoadOwnExport'), dsp.indexOf('function oxyScrubExport')) : '';
    // strip comments first — the body's OWN honest note ("no GangliorProvenance.stamp()") must not trip
    // the guard; we are asserting no real CALL, not no mention.
    var loadCode = loadSeg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    T.ok('loadOwnExport body never re-stamps (no .stamp( / GangliorProvenance in CODE)', loadSeg.length > 0 && !/\.stamp\s*\(/.test(loadCode) && !/GangliorProvenance/.test(loadCode));

    // ── 4 · TIER preserved (no upgrade) — the export's EMBEDDED crossNight evidence is shown verbatim ──
    var envTier = JSON.parse(JSON.stringify(envlp));
    envTier.crossNight = { schema: { name: 'ganglior.crossnight' }, metrics: { nsi: { label: 'NSI', evidence: 'experimental', mean: 42 } } };
    var resT = OD.loadOwnExport(envTier);
    T.eq('tier preserved: export crossNight evidence carried verbatim (experimental stays experimental)', resT && resT.crossNight && resT.crossNight.metrics && resT.crossNight.metrics.nsi && resT.crossNight.metrics.nsi.evidence, 'experimental');

    // ── 6 · FOREIGN-NODE guard — an ECGDex export is rejected with a redirect message, not loaded ──
    var foreign = { schema: { name: 'ganglior.node-export', node: 'ECGDex' }, recording: { startEpochMs: 0 }, ganglior_events: [], recordings: [{}] };
    var resF = OD.loadOwnExport(foreign);
    T.ok('foreign-node guard: ECGDex export rejected (not loaded)', !!(resF && resF.ok === false && resF.reason === 'foreign-node'));
    T.ok('foreign-node guard: redirect message names the source node + Integrator', !!(resF && /ECGDex/.test(resF.message) && /Integrator/i.test(resF.message)));

    // ── 7 · SCRUB for sharing — strips serial/filename/sha256, keeps coarse stamp + clinical summary ──
    if (typeof OD.scrubExport === 'function') {
      var scr = OD.scrubExport(envWithProv);
      var ins = (scr.schema.provenance && scr.schema.provenance.inputs) || [];
      T.ok('scrub: no inputs[].name survives', !ins.some(function (x) { return x && x.name != null; }));
      T.ok('scrub: no inputs[].sha256 survives', !ins.some(function (x) { return x && x.sha256 != null; }));
      T.eq('scrub: coarse build stamp retained (buildHash)', scr.schema.provenance && scr.schema.provenance.buildHash, 'abc123def456');
      T.ok('scrub: clinical summary retained (nights[] + ganglior_events[])', Array.isArray(scr.nights) && scr.nights.length > 0 && Array.isArray(scr.ganglior_events));
      T.ok('scrub: schema flagged scrubbed', scr.schema.scrubbed === true);
      T.eq('scrub is a PURE clone (source envelope name untouched)', (envWithProv.schema.provenance.inputs[0] || {}).name, 'O2Ring S 2100_x.csv');
    } else { T.ok('OxyDex.scrubExport available', false); }
  });

  /* ════ SELF-INGEST (CPAPDex) — cpapLoadOwnExport clinical reload (SELF-INGEST-FOLLOWUPS-2026-07-03 · CPAPDex pass) ════
     Mirror of the OxyDex §7 group for the CPAPDex port: reload CPAPDex's OWN v2.0 export back into
     CPAPDex as a FAITHFUL, review-mode clinical view — never recompute, re-grade, or re-stamp. Runs
     LIVE in BOTH runners off CPAPDex.compute({edfSets:[CpapDsp._synthEdfSet(...)]}) (the same
     deterministic synthetic night the golden gate rebuilds) → CpapFusion.cpapLoadOwnExport. Scrub is
     the SHARED helper (D1): env.DexExport.scrubExport — there is no node-local cpapScrubExport.
     Covers: 1 round-trip · 2 faithful view (no drift) · 3 provenance preserved (no re-stamp) ·
     4 review-mode not faked · 5 nights[] carrier + event gather/sort · 6 foreign-node guard · 7 scrub. */
  group('Self-ingest (CPAPDex) — cpapLoadOwnExport clinical reload', 'cpapdex-fusion · dex-export · self-ingest', function (T) {
    var CD = env.CPAPDex, CF = env.CpapFusion, DSP = env.CpapDsp, DX = env.DexExport, src = env.sources || {};
    if (!(CD && typeof CD.compute === 'function' && CF && typeof CF.cpapLoadOwnExport === 'function'
          && DSP && typeof DSP._synthEdfSet === 'function' && DX && typeof DX.scrubExport === 'function')) {
      T.ok('env.CPAPDex.compute + CpapFusion.cpapLoadOwnExport + CpapDsp._synthEdfSet + DexExport.scrubExport available', false, 'namespace not wired — gate skipped'); return;
    }
    // same deterministic synthetic night as the golden gate (oxi lane + CSL span → events guaranteed).
    var envlp = CD.compute({ edfSets: [DSP._synthEdfSet({ oxi: true, cs: true })] });
    T.ok('compute() produced a v2.0 single-night export to reload', !!(envlp && envlp.schema && envlp.schema.name === 'ganglior.node-export' && envlp.schema.node === 'CPAPDex' && envlp.recording && envlp.metrics && Array.isArray(envlp.ganglior_events)));
    T.ok('synthetic night emits ganglior_events (oxi+cs lanes)', !!(envlp && (envlp.ganglior_events || []).length > 0), (envlp && envlp.ganglior_events || []).length + ' events');
    var pristine = JSON.parse(JSON.stringify(envlp));

    // ── 1 · ROUND-TRIP self-ingest (single-night: the object itself is the carrier) ──
    var res = CF.cpapLoadOwnExport(envlp);
    T.ok('cpapLoadOwnExport(own export) → ok + reviewMode', !!(res && res.ok === true && res.reviewMode === true), res ? ('ok=' + res.ok + ' reason=' + (res.reason || '—')) : 'no result');
    T.eq('single-night carrier: 1 element (the export object itself)', res && res.ok ? res.elements.length : -1, 1);
    var emitEv = (pristine.ganglior_events || []).slice().sort(function (a, b) { return ((a && a.tMs) || 0) - ((b && b.tMs) || 0); });
    var loadEv = ((res && res.events) || []);
    T.ok('round-trip: reloaded events IDENTICAL to emitted (tMs-sorted, verbatim)', JSON.stringify(loadEv.map(function (e) { return [e.tMs, e.impulse, e.conf]; })) === JSON.stringify(emitEv.map(function (e) { return [e.tMs, e.impulse, e.conf]; })), loadEv.length + ' events');
    T.ok('reloaded events are tMs-monotonic (Clock Contract)', loadEv.every(function (e, i) { return i === 0 || ((loadEv[i - 1].tMs || 0) <= (e.tMs || 0)); }));

    // ── 2 · FAITHFUL VIEW (no recompute drift) — element == export stored bytes (flags aside) ──
    if (res && res.ok && res.elements.length) {
      var elClone = JSON.parse(JSON.stringify(res.elements[0]));
      delete elClone._reviewMode; delete elClone._fromExport;
      T.ok('faithful view: element == export STORED values verbatim (no recompute, no drift)', JSON.stringify(elClone) === JSON.stringify(pristine));
      var el0 = res.elements[0];
      T.ok('clinical KPIs read the stored derived layer directly (metrics + oximetry[] + quality present)', !!(el0.metrics && Array.isArray(el0.oximetry) && el0.quality));
    }

    // ── 4 · REVIEW MODE not faked — every element flagged from-export ──
    T.ok('review-mode: every element marked _fromExport + _reviewMode (raw waveform panels greyed, never faked)', !!(res && res.ok) && res.elements.length > 0 && res.elements.every(function (n) { return n._fromExport === true && n._reviewMode === true; }));

    // ── 5 · nights[] carrier (multi-night wrapper) — unwrap + gather events across elements ──
    var multi = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'CPAPDex', multiNight: true },
      nights: [JSON.parse(JSON.stringify(pristine)), JSON.parse(JSON.stringify(pristine))] };
    var resM = CF.cpapLoadOwnExport(multi);
    T.ok('nights[] carrier: 2 elements unwrapped + multiNight flagged', !!(resM && resM.ok) && resM.elements.length === 2 && resM.multiNight === true);
    T.eq('events gathered across ALL elements', resM && resM.ok ? resM.events.length : -1, 2 * (pristine.ganglior_events || []).length);

    // ── 3 · PROVENANCE preserved (no re-stamp) ──
    var fakeProv = { buildHash: 'abc123def456', generated: '2026-06-12T22:28:30Z', inputs: [{ name: '20260612_222830_BRP.edf', sha256: 'deadbeef', bytes: 12345 }] };
    var envP = JSON.parse(JSON.stringify(pristine)); envP.schema.provenance = fakeProv;
    envP.recording.device = 'AirSense 11'; envP.recording.serial = '23261999999';
    var resP = CF.cpapLoadOwnExport(envP);
    T.ok('provenance preserved VERBATIM (view provenance == export provenance)', JSON.stringify(resP && resP.provenance) === JSON.stringify(fakeProv));
    var fsrc = src['cpapdex-fusion.js'] || '';
    var segStart = fsrc.indexOf('function cpapLoadOwnExport'), segEnd = fsrc.indexOf('global.CpapFusion');
    var loadSeg = (segStart >= 0 && segEnd > segStart) ? fsrc.slice(segStart, segEnd) : '';
    // strip comments first — honest notes may MENTION the stamp; we assert no real CALL.
    var loadCode = loadSeg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    T.ok('cpapLoadOwnExport body never re-stamps (no .stamp( / GangliorProvenance in CODE)', loadSeg.length > 0 && !/\.stamp\s*\(/.test(loadCode) && !/GangliorProvenance/.test(loadCode));

    // ── 6 · FOREIGN-NODE guard — an ECGDex export is rejected with a redirect message, not loaded ──
    var foreign = { schema: { name: 'ganglior.node-export', node: 'ECGDex' }, recording: { startEpochMs: 0 }, ganglior_events: [], recordings: [{}] };
    var resF = CF.cpapLoadOwnExport(foreign);
    T.ok('foreign-node guard: ECGDex export rejected (not loaded)', !!(resF && resF.ok === false && resF.reason === 'foreign-node'));
    T.ok('foreign-node guard: redirect message names the source node + Integrator', !!(resF && /ECGDex/.test(resF.message) && /Integrator/i.test(resF.message)));
    var resN = CF.cpapLoadOwnExport({ notAnExport: true });
    T.ok('non-export input rejected (reason not-node-export)', !!(resN && resN.ok === false && resN.reason === 'not-node-export'));

    // ── 7 · SCRUB for sharing — the SHARED DexExport.scrubExport (D1), not a node-local copy ──
    var scr = DX.scrubExport(envP);
    var ins = (scr.schema.provenance && scr.schema.provenance.inputs) || [];
    T.ok('scrub: no inputs[].name survives (device serial / filename)', ins.length > 0 && !ins.some(function (x) { return x && x.name != null; }));
    T.ok('scrub: no inputs[].sha256 survives', !ins.some(function (x) { return x && x.sha256 != null; }));
    T.eq('scrub: non-identifying integrity kept (inputs[].bytes)', ins[0] && ins[0].bytes, 12345);
    T.eq('scrub: coarse build stamp retained (buildHash)', scr.schema.provenance && scr.schema.provenance.buildHash, 'abc123def456');
    T.ok('scrub: recording.device/serial stripped, contentId + startEpochMs kept', scr.recording.device == null && scr.recording.serial == null && scr.recording.startEpochMs === pristine.recording.startEpochMs && 'contentId' in scr.recording);
    T.ok('scrub: clinical summary retained (metrics + ganglior_events[])', !!scr.metrics && Array.isArray(scr.ganglior_events) && scr.ganglior_events.length === (pristine.ganglior_events || []).length);
    T.ok('scrub: schema flagged scrubbed', scr.schema.scrubbed === true);
    T.eq('scrub is a PURE clone (source envelope input name untouched)', (envP.schema.provenance.inputs[0] || {}).name, '20260612_222830_BRP.edf');
    var resS = CF.cpapLoadOwnExport(scr);
    T.ok('scrubbed export still reloads (ok + scrubbed surfaced)', !!(resS && resS.ok === true && resS.scrubbed === true));
  });

  /* ════ EVENT-LEXICON — canonical impulse vocabulary (OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS §1) ════
     Pins the desaturation/surge/PB canonical names + the back-compat alias policy (spec: EVENT-LEXICON.md).
     Live in BOTH runners: a legacy bare-array OxyDex ingest now SYNTHESIZES the canonical `desat_event`,
     fusion confirms a desat under EITHER the canonical name OR the `spo2_desaturation` alias, and the
     Integrator's synthetic-gen / gather sets carry the canonical name (source-mirror). */
  group('Event lexicon — canonical impulse names + back-compat aliases', 'integrator-dsp · integrator-app · oxydex-dsp · event-lexicon', function (T) {
    var NF = env.normalizeFile, RF = env.runFusion, src = env.sources || {};
    var t0 = U(2026, 5, 7, 22, 0, 0);
    // ── 1 · legacy bare-array synthesis emits the CANONICAL desat_event (not spo2_desaturation) ──
    if (typeof NF === 'function') {
      var legacyNight = { date: '2026-06-07', t0Ms: t0, stats: { n: 7200, durationMin: 120, minSpo2: 88, meanSpo2: 95 },
        desat: { events: [{ nadirIdx: 600, depth: 6, nadir: 88, duration: 20, recovery: 5 }] } };
      var synthEvents = (((NF([legacyNight], 'oxydex_legacy.json') || {}).recs || [])[0] || {}).events || [];
      T.eq('legacy bare-array synthesis emits the canonical desat_event', synthEvents.filter(function (e) { return e.impulse === 'desat_event'; }).length, 1);
      T.eq('legacy synthesis no longer emits the old spo2_desaturation name', synthEvents.filter(function (e) { return e.impulse === 'spo2_desaturation'; }).length, 0);
    } else { T.ok('normalizeFile available', false); }
    // ── 2 · fusion confirms a desat under EITHER the canonical name OR the deprecated alias ──
    if (typeof NF === 'function' && typeof RF === 'function') {
      var ecgRec = (NF({ schema: { name: 'ganglior.node-export', node: 'ECGDex' }, recording: { startEpochMs: t0, durationMin: 120, offsetMin: null },
        ganglior_events: [{ t: '22:10:20', tMs: t0 + 620000, impulse: 'autonomic_surge', node: 'ECGDex', conf: 0.7 }] }, 'ecg.json') || {}).recs || [];
      ['desat_event', 'spo2_desaturation'].forEach(function (imp) {
        var oxyEnv = { schema: { name: 'ganglior.node-export', version: '2.0', node: 'OxyDex' },
          recording: { startEpochMs: t0, durationMin: 120, offsetMin: null },
          ganglior_events: [{ t: '22:10:00', tMs: t0 + 600000, impulse: imp, node: 'OxyDex', conf: 0.8, meta: { depth: 6, nadir: 88 } }],
          nights: [{ date: '2026-06-07', t0Ms: t0, stats: { n: 7200, durationMin: 120, minSpo2: 88, meanSpo2: 95 } }] };
        var oxyRec = (NF(oxyEnv, 'oxy_' + imp + '.json') || {}).recs || [];
        var fus = RF(oxyRec.concat(ecgRec), { toleranceSec: 120 });
        var confirmed = (fus.findings || []).filter(function (f) { return f.type === 'confirmed_apnea_event'; });
        T.ok('OxyDex ' + imp + ' ⟷ ECGDex autonomic_surge → confirmed_apnea (gather accepts canonical + alias)', confirmed.length >= 1, confirmed.length + ' confirmed');
      });
    } else { T.ok('normalizeFile + runFusion available', false); }
    // ── 3 · source-mirror: emitters + gather sets speak the canonical vocabulary ──
    var iApp = src['integrator-app.js'], iDsp = src['integrator-dsp.js'], oDsp = src['oxydex-dsp.js'];
    if (iApp) {
      T.ok('integrator-app.js synthetic generator emits canonical desat_event', /impulse:\s*'desat_event'/.test(iApp));
      T.ok('integrator-app.js no longer emits the old spo2_desaturation name', !/impulse:\s*'spo2_desaturation'/.test(iApp));
    }
    if (iDsp) {
      T.ok('integrator-dsp.js apnea gather accepts canonical + alias desats', /\['spo2_desaturation',\s*'desat_event'\]/.test(iDsp));
      T.ok('integrator-dsp.js legacy synthesis emits canonical desat_event', /impulse:\s*'desat_event',\s*node:\s*'OxyDex'/.test(iDsp));
    }
    if (oDsp) {
      T.ok('OxyDex emits canonical desat_event + periodic_breathing', /impulse:\s*'desat_event'/.test(oDsp) && /impulse:\s*'periodic_breathing'/.test(oDsp));
    }
  });

  /* ════ HRVDex Phase-9 — compute() surface + summary adapter (SIGNAL-ADAPTER-FOLLOWUPS §4) ════
     The HRVDex leg: split READING (the now-pure _hrvParseSummaryRows) from EMITTING behind a
     DOM-free HRVDex.compute(SignalFrame(hrv)|rows|{text}) → ganglior.node-export, built by the
     SHARED hrvBuildNodeExport (hrvdex-app.js exportGanglior now delegates to it). adapters/
     welltory-summary.js routes Welltory-style summary CSVs → SignalFrame(hrv) AND lands the two
     ingest-boundary correctness items: the Baevsky SI/CSI ms-vs-s UNIT GUARD (DexUnits.guardBaevsky)
     and tagging Welltory's black-box composites provenance.derived:true. signal-orchestrate hosts
     HRVDex in isolation + emits via emitSummaryNodeExport. Source-mirror + functional adapter/guard
     checks (both run in BOTH runners; compute() runs live in the browser render-coverage rig). */
  group('HRVDex Phase-9 — compute() surface + summary adapter', 'hrvdex-dsp · adapters · signal-orchestrate', function (T) {
    var src = env.sources || {};
    var dsp = src['hrvdex-dsp.js'], app2 = src['hrvdex-app.js'], orch = src['signal-orchestrate.js'];
    if (dsp) {
      T.ok('hrvdex-dsp.js exposes HRVDex.compute', /HRVDex\.compute\s*=/.test(dsp));
      T.ok('hrvdex-dsp.js has ONE node-export builder (hrvBuildNodeExport)', /function\s+hrvBuildNodeExport\b/.test(dsp));
      T.ok('hrvdex-dsp.js splits reading (pure _hrvParseSummaryRows) from committing', /function\s+_hrvParseSummaryRows\b/.test(dsp) && /HRVDex\.parseRows\s*=/.test(dsp));
      T.ok('hrvdex-dsp.js shares ONE event builder (hrvEventsFromRows)', /function\s+hrvEventsFromRows\b/.test(dsp));
      T.ok('parseCSV now delegates to the pure parser + commitRows', /return\s+commitRows\(\s*_hrvParseSummaryRows\(/.test(dsp));
      // ── DEEP-AUDIT 2026-07-01 Finding 1: transparent HRV columns parse absent→null (not a
      //    fabricated 0); the rolling SDNN baseline drops null/≤0 symmetrically with its rMSSD
      //    twin so a blank core cell never biases meanSDNN7/stdSDNN7/d_sdnn_z. ──
      T.ok('hrvdex-dsp.js has a numOrNull helper (absent/blank → null)', /function\s+numOrNull\b/.test(dsp));
      T.ok('transparent SDNN/rMSSD/MeanRR parse via numOrNull (absent → null, not 0)',
        /_sdnn\s*=\s*numOrNull\(/.test(dsp) && /_rmssd\s*=\s*numOrNull\(/.test(dsp) && /_meanRR\s*=\s*numOrNull\(/.test(dsp));
      T.ok('subjective Welltory columns KEEP ||0 (the _hasSubj presence gate depends on it)',
        /_stress\s*=\s*parseFloat\(.*\|\|\s*0\)/.test(dsp) && /_energy\s*=\s*parseFloat\(.*\|\|\s*0\)/.test(dsp));
      T.ok('SDNN rolling filter is symmetric with rmssd7 (drops null/≤0)',
        /const\s+sdnn7\s*=\s*window7\.map\(x\s*=>\s*x\._sdnn\)\.filter\(v\s*=>\s*!isNaN\(v\)\s*&&\s*v\s*>\s*0\)/.test(dsp));
      T.ok('d_sdnn_z gates on the row’s OWN _sdnn presence (absent row → NaN, no fabricated z)',
        /d_sdnn_z\s*=\s*\(r\._sdnn\s*>\s*0\s*&&\s*stdSDNN7\s*>\s*0\)/.test(dsp));
      // FOLLOWUPS §2: the pNN50 rolling slope drops an ABSENT (null) day but KEEPS a real 0 (pNN50=0
      // is physiological) — Number.isFinite, not !isNaN (which coerced null→0 and polluted the slope).
      T.ok('pNN50 rolling slope uses Number.isFinite (keep real 0, drop absent null) — §2 followups',
        /pnn507\s*=\s*window7\.map\(x\s*=>\s*x\._pnn50\)\.filter\(v\s*=>\s*Number\.isFinite\(v\)\)/.test(dsp)
        && /window7\.filter\(x=>Number\.isFinite\(x\._pnn50\)\)/.test(dsp));
    }
    if (app2) {
      T.ok('exportGanglior delegates to the shared hrvBuildNodeExport (no 2nd inline copy)', /hrvBuildNodeExport\(/.test(app2));
    }
    if (orch) {
      T.ok('signal-orchestrate has a co-loaded HRVDex host (hrvHost)', /function\s+hrvHost\b/.test(orch));
      T.ok('signal-orchestrate emits summaries via HRVDex.compute (emitSummaryNodeExport)', /emitSummaryNodeExport/.test(orch) && /HRVDex\.compute\(/.test(orch));
    }
    // ── Functional: the welltory-summary adapter registers + routes (runs in BOTH runners) ──
    var SA = env.SignalAdapters, SF = env.SignalFrame, Q = env.DexUnits;
    if (SA && typeof SA.route === 'function') {
      var ids = (SA.list ? SA.list() : []).map(function (a) { return a.id; });
      T.ok('welltory-summary adapter registered (signalType hrv)', ids.indexOf('welltory-summary') >= 0 && (SA.byId('welltory-summary') || {}).signalType === 'hrv', ids.join(','));
      var whead = 'Date,Time,Stress(HRV),Energy(HRV),Coherence index,Measurement HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode\n2026-06-12 07:30,55,40,42,58,900,55,38,0.30,12,40,0.90';
      var rh = SA.route({ name: 'welltory_export.csv' }, whead);
      T.ok('routes a Welltory summary CSV → welltory-summary / hrv', !!(rh.best && rh.best.id === 'welltory-summary' && rh.best.signalType === 'hrv'), rh.best ? (rh.best.id + '/' + rh.best.signalType) : 'no best');
      // a node-export JSON must NOT be claimed by the summary adapter (JSON guard).
      var jhead = '{"schema":{"name":"ganglior.node-export","node":"ECGDex"},"hrv":{"time":{"rmssd":42,"sdnn":58}}}';
      var wa = SA.byId('welltory-summary');
      if (wa) T.ok('welltory-summary declines a node-export JSON (no mis-route)', wa.detect({ name: 'ECGDex_x_ganglior.json' }, jhead) === 0, 'conf ' + (wa && wa.detect({ name: 'x.json' }, jhead)));
      // O2Ring + RR must not regress to hrv.
      var ro = SA.route({ name: 'O2Ring S 2100.csv' }, 'Time,Oxygen Level,Pulse Rate,Motion\n2026-06-12T23:00:00,97,54,0');
      T.ok('O2Ring CSV still routes to spo2 (no hrv regression)', !!(ro.best && ro.best.signalType === 'spo2'), ro.best ? ro.best.signalType : 'no best');
    }
    // ── Functional: parse() with a stub pure-parser applies the Baevsky guard + derived tag ──
    if (SA && SF && Q && Q.guardBaevsky) {
      var wa2 = SA.byId('welltory-summary');
      var t0 = U(2026, 5, 12, 7, 30, 0);
      // Mode/MxDMn arrive in MILLISECONDS (a real-vendor case) → the guard must normalize to s.
      var stubRows = [
        { _tMs: t0, _offsetMin: null, _mode: 900, _mxdmn: 300, _amo50: 40, _rmssd: 38, _sdnn: 55, _hr: 58, _stress: 72, _energy: 40 },
        { _tMs: t0 + 86400000, _offsetMin: null, _mode: 880, _mxdmn: 320, _amo50: 42, _rmssd: 15, _sdnn: 48, _hr: 61, _stress: 50, _energy: 35 }
      ];
      var fr = SA.runAdapter(wa2, 'ignored', { parseRows: function () { return stubRows.map(function (r) { return Object.assign({}, r); }); }, files: ['welltory.csv'] });
      T.ok('welltory-summary → usable hrv SignalFrame', !!(fr && fr.signalType === 'hrv' && fr.usable && fr.kind === 'samples'));
      T.ok('hrv frame validates (irregular samples: tsMs, no fs)', SF.validateFrame(fr).ok, SF.validateFrame(fr).errors.join('; '));
      T.ok('frame carries per-sample tsMs + a real t0Ms (never fabricated)', Array.isArray(fr.tsMs) && fr.tsMs.length === 2 && fr.t0Ms === t0);
      var s0 = fr.samples && fr.samples[0];
      T.ok('Baevsky guard applied at ingest — ms Mode normalized to seconds', !!(s0 && s0._baevsky && Math.abs(s0._baevsky.modeS - 0.9) < 1e-9 && s0._baevsky.assumedMs === true), s0 && s0._baevsky ? ('modeS=' + s0._baevsky.modeS) : 'no _baevsky');
      T.ok('Baevsky guard recomputes a unit-safe Stress Index', !!(s0 && s0._baevsky && s0._baevsky.si != null && s0._baevsky.si > 50 && s0._baevsky.si < 100), s0 && s0._baevsky ? ('si=' + s0._baevsky.si) : 'no si');
      T.ok('Welltory black-box composites tagged provenance.derived:true', fr.provenance && fr.provenance.derived === true);
    }
    // The shared event builder tags the black-box stress_high event derived/heuristic and
    // the measured rMSSD-drop hrv_low — source-mirror (HRVDex's bare globals aren't headless-
    // loadable in the Node vm; the live event set runs in the browser render-coverage rig).
    if (dsp) {
      var evBody = (dsp.match(/function\s+hrvEventsFromRows[\s\S]*?\n\}/) || [''])[0];
      T.ok('stress_high tagged derived + heuristic (vendor composite)', /impulse:\s*'stress_high'[\s\S]*?evidence:\s*'heuristic'[\s\S]*?derived:\s*true/.test(evBody) || /derived:\s*true[\s\S]*?evidence:\s*'heuristic'/.test(evBody));
      T.ok('hrv_low tagged measured (time-domain rMSSD)', /impulse:\s*'hrv_low'[\s\S]*?evidence:\s*'measured'/.test(evBody));

      // ── -III §1: computeDerived's OWN SI/CSI now consume the SAME DexUnits guard the adapter
      //    uses (single-source; native path == adapter path). Source-mirror — computeDerived is
      //    page-scoped (allRows/getProfile/DOM), not headless-loadable, like the other groups here. ──
      T.ok('computeDerived guards Baevsky SI via DexUnits.guardBaevsky (single-source, not forked)',
        /DexUnits\.guardBaevsky\(r\._mode, r\._mxdmn\)/.test(dsp) && /DexUnits\.baevskySI\(r\._amo50, _baev\.modeS, _baev\.mxdmnS\)/.test(dsp));
      T.ok('computeDerived d_csi uses the guard-normalized (seconds) MxDMn, not the raw column',
        /_mxdmnS = \(r\._baevskyS/.test(dsp) && /d_csi = \(meanRR_s > 0 && _mxdmnS != null\)/.test(dsp));
      T.ok('computeDerived reads the canonical threshold (no forked RR_MS_THRESHOLD literal)', !/RR_MS_THRESHOLD\s*=/.test(dsp));
      // ── §8 #2: zero-seeded black-box composites must NOT surface a fabricated 0 on a raw recording ──
      T.ok('d_welfare gated on subjective inputs PRESENT (>0), never a fake 0',
        /d_welfare = \(r\._energy > 0 && r\._coherence > 0\)/.test(dsp));
      T.ok('d_efc gated on subjective inputs PRESENT (>0)',
        /d_efc = \(r\._energy > 0 && r\._focus > 0 && r\._coherence > 0\)/.test(dsp));
      T.ok('d_ans_load gated on subjective inputs PRESENT (>0)',
        /d_ans_load = \(r\._sns > 0 && r\._stress > 0 && r\._psns > 0 && r\._energy > 0\)/.test(dsp));
      // ── -V §1: the zero-seed gate is BROADER than the three §8 #2 KPIs — every composite FED
      //    by a black-box subjective score gates on the ONE shared _hasSubj predicate, so a raw
      //    recording renders them — (NaN), never a fabricated 0. ──
      T.ok('a single _hasSubj predicate (all six subjective inputs >0) is defined once',
        /_hasSubj = \(r\._stress > 0 && r\._energy > 0 && r\._focus > 0 && r\._coherence > 0 && r\._sns > 0 && r\._psns > 0\)/.test(dsp));
      ['d_se_div', 'd_coh_energy', 'd_pti', 'd_sfd', 'd_focus_eff', 'd_hile'].forEach(function (m) {
        T.ok(m + ' gated on _hasSubj (no fabricated 0 on a raw recording)',
          new RegExp(m.replace(/[_]/g, '\\_') + ' = _hasSubj \\?').test(dsp), m);
      });
    }
    // ── -III §1 FUNCTIONAL known-answer: the guard the native d_si/d_csi now run (DexUnits is
    //    headless). A ms-unit Mode/MxDMn row and a seconds-unit row produce the SAME Baevsky SI. ──
    if (Q && Q.guardBaevsky && Q.baevskySI) {
      var _gS = Q.guardBaevsky(0.9, 0.30), _siS = Q.baevskySI(40, _gS.modeS, _gS.mxdmnS);
      var _gMs = Q.guardBaevsky(900, 300), _siMs = Q.baevskySI(40, _gMs.modeS, _gMs.mxdmnS);
      T.ok('Baevsky SI parity — a ms-unit row and a seconds-unit row give the SAME guarded d_si',
        _siS != null && _siMs != null && Math.abs(_siS - _siMs) < 1e-9, 'siS=' + _siS + ' siMs=' + _siMs);
      T.ok('the ms-unit row is detected + normalized to seconds (assumedMs)',
        _gMs.assumedMs === true && Math.abs(_gMs.modeS - 0.9) < 1e-9 && Math.abs(_gMs.mxdmnS - 0.30) < 1e-9);
      T.ok('the seconds-unit row is NOT mis-flagged as ms', _gS.assumedMs === false);
    }
    // ── §8 #5: the native black-box composites are lower-tiered to match the adapter quarantine ──
    var hreg = env.HRV_REGISTRY;
    if (hreg) {
      ['welfare', 'efc', 'ansLoad', 'otr', 'crs'].forEach(function (k) {
        T.ok('HRV registry: black-box composite ' + k + ' demoted to heuristic (matches adapter derived quarantine)',
          hreg[k] && hreg[k].evidence === 'heuristic', hreg[k] ? hreg[k].evidence : 'missing');
      });
    }
  });

  /* ════ Phase-9 compute() — headless functional floor (§3 co-load · -II §3) ════
     Now that pulsedex/oxydex/hrvdex-dsp.js ship a NAMESPACED build, BOTH runners
     co-load them in one realm (window.__DEX_NAMESPACED__=true → env.PulseDex /
     OxyDex / HRVDex), so the FUNCTIONAL compute() path (synthetic input → schema-
     valid ganglior.node-export with a non-null core metric) finally runs in Node CI
     too — not just the browser render-coverage rig (-II §3). This complements the
     source-mirror groups above (which only check the wiring strings): it proves
     compute() actually executes the pipeline and returns the right shape. */
  group('Phase-9 compute() — headless functional floor', 'pulsedex-dsp · oxydex-dsp · hrvdex-dsp · co-load', function (T) {
    var P = env.PulseDex, O = env.OxyDex, H = env.HRVDex;
    // ── PulseDex (RR): array of NN ms with HF variability → windowed-HRV export ──
    T.ok('PulseDex namespace co-loaded (env.PulseDex.compute)', !!(P && typeof P.compute === 'function'));
    if (P && typeof P.compute === 'function') {
      var nn = [];
      for (var i = 0; i < 300; i++) nn.push(900 + Math.round(40 * Math.sin(2 * Math.PI * 0.25 * (i * 0.9))));
      var pe = P.compute(nn);
      T.ok('PulseDex.compute(vals) → non-null export', !!pe);
      if (pe) {
        T.ok('  schema.node === PulseDex', pe.schema && pe.schema.node === 'PulseDex', pe.schema && pe.schema.node);
        T.ok('  recording.source === rr', pe.recording && pe.recording.source === 'rr');
        T.ok('  core metric rMSSD is a finite number > 0', !!(pe.hrv && pe.hrv.time && isFinite(pe.hrv.time.rmssd) && pe.hrv.time.rmssd > 0), pe.hrv && pe.hrv.time ? pe.hrv.time.rmssd : 'no hrv');
        T.ok('  ganglior_events is an array', Array.isArray(pe.ganglior_events));
      }
    }
    // ── OxyDex (SpO₂): ~10 min of 1 Hz synthetic samples → single-night summary ──
    T.ok('OxyDex namespace co-loaded (env.OxyDex.compute)', !!(O && typeof O.compute === 'function'));
    if (O && typeof O.compute === 'function') {
      // -IV §2: a ≥1 h synthetic (4200 × 1 Hz = 70 min) so compute() reaches the
      // ≥1 h-only vo2est/Karvonen branch (oxydex-dsp.js `if (n < 1800)`) + the full
      // processNight fan-out a REAL overnight file hits — the path the OLD 10-min
      // (600-sample) floor never exercised, which is how the latent upVO2category
      // headless-dependency gap (-IV §1) slipped past CI. Deterministic; a few desats.
      var ot0 = U(2026, 5, 12, 23, 0, 0), samples = [];
      for (var k = 0; k < 4200; k++) {
        var dip = (k % 600 >= 580) ? -8 : 0;        // a ~20 s desat every 10 min
        samples.push({ tMs: ot0 + k * 1000, spo2: 96 + dip + (k % 7 === 0 ? -1 : 0), hr: 58 + (k % 5) + (dip ? 6 : 0), motion: 0 });
      }
      var oe = O.compute({ signalType: 'spo2', samples: samples });
      T.ok('OxyDex.compute(frame) → non-null export', !!oe);
      if (oe) {
        T.ok('  schema.node === OxyDex', oe.schema && oe.schema.node === 'OxyDex', oe.schema && oe.schema.node);
        T.ok('  recording.source === spo2', oe.recording && oe.recording.source === 'spo2');
        T.ok('  one night element with stats', Array.isArray(oe.nights) && oe.nights.length === 1 && !!oe.nights[0].stats, oe.nights ? (oe.nights.length + ' nights') : 'no nights');
        // -IV §2: the ≥1 h input must traverse the vo2est/Karvonen branch without throwing
        // (the upVO2category reach-in is guarded; vo2Category stays null headless — harmless).
        T.ok('  ≥1 h recording → durationMin > 60 (long-path fan-out exercised, no throw)', !!(oe.nights[0].stats && oe.nights[0].stats.durationMin > 60), oe.nights[0].stats && oe.nights[0].stats.durationMin);
      }
    }
    // ── HRVDex (summary): two parsed measurement rows → per-measurement export ──
    T.ok('HRVDex namespace co-loaded (env.HRVDex.compute)', !!(H && typeof H.compute === 'function'));
    if (H && typeof H.compute === 'function') {
      var ht0 = U(2026, 5, 12, 7, 30, 0);
      var rows = [
        { _tMs: ht0, _offsetMin: null, _mode: 0.9, _mxdmn: 0.30, _amo50: 40, _rmssd: 38, _sdnn: 55, _hr: 58, _stress: 50, _energy: 40 },
        { _tMs: ht0 + 86400000, _offsetMin: null, _mode: 0.88, _mxdmn: 0.32, _amo50: 42, _rmssd: 15, _sdnn: 48, _hr: 61, _stress: 72, _energy: 35 }
      ];
      var he = H.compute(rows);
      T.ok('HRVDex.compute(rows) → non-null export', !!he);
      if (he) {
        T.ok('  schema.node === HRVDex', he.schema && he.schema.node === 'HRVDex', he.schema && he.schema.node);
        T.ok('  recording.source === welltory', he.recording && he.recording.source === 'welltory');
        T.ok('  measurements === 2', he.recording && he.recording.measurements === 2, he.recording && he.recording.measurements);
        T.ok('  ganglior_events is an array', Array.isArray(he.ganglior_events));
      }
    }
    // ── DEEP-AUDIT 2026-07-01 Finding 1 (functional): the pure summary parser reads an absent
    //    TRANSPARENT cell as null, never a fabricated 0; a real "0" stays 0; subjective KEEPS 0. ──
    if (H && typeof H.parseRows === 'function') {
      var blankCsv =
        'Date,Time,Measurement HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode,Stress(HRV),Energy(HRV)\n' +
        '2026-06-01,07:00:00,58,1030,62,45,320,28,38,1020,40,60\n' +
        '2026-06-02,07:00:00,60,1000,,,300,,39,1000,,\n' +
        '2026-06-03,07:00:00,57,1040,68,50,330,31,37,1030,42,58\n';
      var bRows = H.parseRows(blankCsv);
      T.ok('parseRows → 3 rows (blank row kept on a finite timestamp)', !!bRows && bRows.length === 3, bRows && ('len=' + bRows.length));
      if (bRows && bRows.length === 3) {
        T.ok('present SDNN parses to its number (62, not null)', bRows[0]._sdnn === 62, 'got ' + bRows[0]._sdnn);
        T.ok('blank SDNN parses to null (absence, NOT a fabricated 0)', bRows[1]._sdnn === null, 'got ' + bRows[1]._sdnn);
        T.ok('blank rMSSD + pNN50 also parse to null', bRows[1]._rmssd === null && bRows[1]._pnn50 === null,
          'rmssd=' + bRows[1]._rmssd + ' pnn50=' + bRows[1]._pnn50);
        T.ok('subjective Stress KEEPS ||0 on a blank cell (0, not null — _hasSubj gate)', bRows[1]._stress === 0, 'got ' + bRows[1]._stress);
      }
      var zeroRow = H.parseRows('Date,Time,Measurement HR,SDNN,pNN50\n2026-06-04,07:00:00,58,0,0\n');
      if (zeroRow && zeroRow.length === 1) {
        T.ok('a real "0" cell parses to 0 (not null) — pNN50 can legitimately be 0', zeroRow[0]._pnn50 === 0, 'got ' + zeroRow[0]._pnn50);
      }
    }
    // ── -II §8 / -III §3: LOCK the SignalSpec.hrv resolver to the REAL HRVDex functions.
    //    The HRVDex leg wired SignalSpec.hrv.dsp() → {parse, rows, compute} but nothing
    //    pinned `rows`/`compute` to HRVDex.parseRows/.compute — a rename on EITHER side
    //    would silently no-op routing (the unifier reads field names FROM the spec). This
    //    trips the gate the moment the resolver and the node's surface drift apart. Both
    //    env.SignalSpec + env.HRVDex co-load here (namespaced), so it runs in BOTH runners. ──
    var SSx = env.SignalSpec;
    if (SSx && SSx.hrv && typeof SSx.hrv.dsp === 'function' && H) {
      var hres = SSx.hrv.dsp() || {};
      T.ok('SignalSpec.hrv.dsp().compute === HRVDex.compute (resolver pinned, rename-proof)', hres.compute === H.compute);
      T.ok('SignalSpec.hrv.dsp().rows === HRVDex.parseRows (resolver pinned, rename-proof)', hres.rows === H.parseRows);
    }
    // ── GlucoDex (CGM): 14-day synthetic → full pipeline → node-export shape check ──
    // SIGNAL-ADAPTER-PHASE9-REMAINING-NODES §1F. genSynthetic returns a pre-parsed frame
    // {tMs,vMgdl,unit,t0Ms}; compute() accepts it directly (no CSV round-trip needed).
    // 14 days exercises dawn/nocturnal-hypo/session/AGP code paths (-IV §2 lesson).
    // glucodex-dsp.js is a clean IIFE — no DOM/localStorage → no ALLOW entry needed.
    var G = env.GlucoDex;
    T.ok('GlucoDex namespace co-loaded (env.GlucoDex.compute)', !!(G && typeof G.compute === 'function'));
    if (G && typeof G.compute === 'function') {
      var gluSynth = (env.GLUDSP && typeof env.GLUDSP.genSynthetic === 'function')
        ? env.GLUDSP.genSynthetic({ days: 14 })
        : null;
      T.ok('GLUDSP.genSynthetic available for GlucoDex floor test', !!gluSynth, 'GLUDSP not loaded');
      if (gluSynth) {
        var ge;
        try { ge = G.compute(gluSynth); } catch (e2) { T.ok('GlucoDex.compute(synthetic) threw: ' + e2.message, false); }
        if (ge) {
          T.ok('  schema.name === ganglior.node-export', ge.schema && ge.schema.name === 'ganglior.node-export', ge.schema && ge.schema.name);
          T.ok('  schema.node === GlucoDex', ge.schema && ge.schema.node === 'GlucoDex', ge.schema && ge.schema.node);
          T.ok('  ganglior_events is an array', Array.isArray(ge.ganglior_events), typeof ge.ganglior_events);
          T.ok('  recording.startEpochMs is finite', ge.recording && isFinite(ge.recording.startEpochMs), ge.recording && ge.recording.startEpochMs);
          T.ok('  ganglior_events non-empty (14-day synthetic produces events)', Array.isArray(ge.ganglior_events) && ge.ganglior_events.length > 0, ge.ganglior_events && ge.ganglior_events.length);
        }
      }
    }

    // ── PpgDex (raw PPG → optical beats → self-PPI → HRV): synthetic Polar Sense PPG → full
    // pipeline → node-export shape (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 2/4). PpgDex has
    // NO genSynthetic in its DSP, so drive the REAL beat-detection pipeline with SYNTH.renderPPG
    // (the 176 Hz Polar-Sense text the FULL-lane + qrs-equiv groups already use). compute({text})
    // runs parsePPG → analyze → ppgBuildNodeExport headless. Events may be empty on a short window
    // (no between-epoch drop), so assert the SHAPE, not non-emptiness (cf. the GlucoDex 14-day case). ──
    var PG = env.PpgDex, SY = env.SYNTH;
    T.ok('PpgDex namespace co-loaded (env.PpgDex.compute)', !!(PG && typeof PG.compute === 'function'));
    if (PG && typeof PG.compute === 'function' && SY && typeof SY.renderPPG === 'function' && typeof SY.pickWindow === 'function') {
      var ptl = SY.buildTimelines()[0];
      var pText = SY.renderPPG(ptl, SY.pickWindow(ptl));
      var pe;
      try { pe = PG.compute({ text: pText }); } catch (e3) { T.ok('PpgDex.compute(synthetic PPG) threw: ' + e3.message, false); }
      if (pe) {
        T.ok('  schema.name === ganglior.node-export', pe.schema && pe.schema.name === 'ganglior.node-export', pe.schema && pe.schema.name);
        T.ok('  schema.node === PpgDex', pe.schema && pe.schema.node === 'PpgDex', pe.schema && pe.schema.node);
        T.ok('  ganglior_events is an array', Array.isArray(pe.ganglior_events), typeof pe.ganglior_events);
        T.ok('  recording.startEpochMs is finite', pe.recording && isFinite(pe.recording.startEpochMs), pe.recording && pe.recording.startEpochMs);
      }
    } else if (!(SY && typeof SY.renderPPG === 'function')) {
      T.ok('SYNTH.renderPPG available for PpgDex floor test', false, 'synth-gen not loaded into env');
    }

    // ── ECGDex (raw ECG → R-peaks → HRV → CVHR): synthetic Polar-H10-style ECG → full Pan-Tompkins
    // pipeline → node-export shape (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 3/4). ECGDSP.genSynthetic
    // returns a parsed rec {int16,fs,t0Ms}; compute() accepts it directly. A ~45-min fragment includes
    // the first synthetic apnea/CVHR window so the autonomic_surge EVENT path is exercised (the -IV §2
    // "traverse every branch" lesson), without overnight cost. R-peak detection runs WITHOUT the Web
    // Worker (parent §2b — the pure detector inside analyze()). Assert the SHAPE (like the PpgDex/GlucoDex
    // floors); the equivalence + P12 round-trip cover the canonical-frame path. ──
    var EC = env.ECGDex, ECD = env.ECGDSP;
    T.ok('ECGDex namespace co-loaded (env.ECGDex.compute)', !!(EC && typeof EC.compute === 'function'));
    if (EC && typeof EC.compute === 'function' && ECD && typeof ECD.genSynthetic === 'function') {
      var ecgSyn = ECD.genSynthetic({ durSec: 2700, seed: 20260617 });   // ~45 min @ 130 Hz, parsed rec
      var ece;
      try { ece = EC.compute(ecgSyn); } catch (e4) { T.ok('ECGDex.compute(synthetic ECG) threw: ' + e4.message, false); }
      if (ece) {
        T.ok('  schema.name === ganglior.node-export', ece.schema && ece.schema.name === 'ganglior.node-export', ece.schema && ece.schema.name);
        T.ok('  schema.node === ECGDex', ece.schema && ece.schema.node === 'ECGDex', ece.schema && ece.schema.node);
        T.ok('  recording.source === ecg', ece.recording && ece.recording.source === 'ecg', ece.recording && ece.recording.source);
        T.ok('  ganglior_events is an array', Array.isArray(ece.ganglior_events), typeof ece.ganglior_events);
        T.ok('  recording.startEpochMs is finite', ece.recording && isFinite(ece.recording.startEpochMs), ece.recording && ece.recording.startEpochMs);
        if (ece.ganglior_events.length) {
          var ev0 = ece.ganglior_events[0];
          T.ok('  events well-formed (node ECGDex · finite conf · no _sec leak)', ev0.node === 'ECGDex' && isFinite(ev0.conf) && !('_sec' in ev0), JSON.stringify(ev0).slice(0, 90));
        }
      }
    } else if (!(ECD && typeof ECD.genSynthetic === 'function')) {
      T.ok('ECGDSP.genSynthetic available for ECGDex floor test', false, 'ecgdex-dsp not loaded into env');
    }

    // ── CPAPDex (EDF → device-scored events → therapy export): a synthetic AirSense file-set
    // (CpapDsp._synthEdfSet — the SAME geometry the cpapdex-dsp self-test uses) → the FULL
    // buildSessionFromEdf → buildNight → CpapFusion.cpapBuildExport pipeline → node-export shape
    // (SIGNAL-ADAPTER-PHASE9-REMAINING-NODES, node 4/4). compute() takes the canonical cpap frame's
    // `edfSets` sidecar (or a decoded set directly). It ALSO asserts compute() ≡ the shared builder so
    // the orchestrate emit path can't drift from the app's exportNight — there is NO {text}/CSV
    // equivalence case for CPAPDex (EDF is binary), so this parity check stands in for it. ──
    var CP = env.CPAPDex, CDSPf = env.CpapDsp, CFUS = env.CpapFusion;
    T.ok('CPAPDex namespace co-loaded (env.CPAPDex.compute)', !!(CP && typeof CP.compute === 'function'));
    if (CP && typeof CP.compute === 'function' && CDSPf && typeof CDSPf._synthEdfSet === 'function') {
      var cpSet = CDSPf._synthEdfSet({ oxi: true, cs: true });
      var cpe;
      try { cpe = CP.compute({ edfSets: [cpSet] }); } catch (e5) { T.ok('CPAPDex.compute(synthetic EDF set) threw: ' + e5.message, false); }
      if (cpe) {
        T.ok('  schema.name === ganglior.node-export', cpe.schema && cpe.schema.name === 'ganglior.node-export', cpe.schema && cpe.schema.name);
        T.ok('  schema.node === CPAPDex', cpe.schema && cpe.schema.node === 'CPAPDex', cpe.schema && cpe.schema.node);
        T.ok('  recording.startEpochMs is finite (floating t0Ms)', cpe.recording && isFinite(cpe.recording.startEpochMs), cpe.recording && cpe.recording.startEpochMs);
        T.ok('  ganglior_events is an array', Array.isArray(cpe.ganglior_events), typeof cpe.ganglior_events);
        T.ok('  device-scored EVE events emitted (top apnea tier)', Array.isArray(cpe.ganglior_events) && cpe.ganglior_events.filter(function (e) { return e.meta && e.meta.source === 'device-scored'; }).length >= 4, cpe.ganglior_events && cpe.ganglior_events.length);
        if (CFUS && typeof CFUS.cpapBuildExport === 'function' && typeof CDSPf.buildNight === 'function' && typeof CDSPf.buildSessionFromEdf === 'function') {
          var directNight = CDSPf.buildNight([CDSPf.buildSessionFromEdf(cpSet, {})]);
          var direct = CFUS.cpapBuildExport(directNight);
          var stripVol = function (x) { x = JSON.parse(JSON.stringify(x)); delete x.kernel; if (x.schema) { delete x.schema.generated; delete x.schema.provenance; } return x; };
          // NOTE (CPAPDEX-PHASE9-FOLLOWUPS-II §3): this proves the two CODE PATHS agree, NOT that compute()
          // threads its 2nd arg. compute(input, opts) currently DROPS opts (ingest/fname/offsetMin/kernel) —
          // it runs _nightFromInput(input) only. Harmless while CPAPDex has no live host routing (-I §2); when
          // that lands, thread opts.ingest into cpapBuildExport(night, opts). Recorded so this parity is not
          // mistaken for full input→export fidelity (the golden gate below pins the OUTPUT tree, not just paths).
          T.ok('  compute() ≡ CpapFusion.cpapBuildExport (ONE event source — app/orchestrate parity)', JSON.stringify(stripVol(cpe)) === JSON.stringify(stripVol(direct)), 'compute() drifted from the shared builder');
        }
      }
    }
    // -II §2: chain the REAL binary decoder readEDF → compute() end-to-end. The floor above drives
    // _synthEdfSet (an already-DECODED set); CpapEdf.readEDF is gated separately (Leaf-module coverage →
    // CpapEdf.selfTest), so NOTHING chained readEDF(real-shaped EDF) → compute(). A drift between
    // _synthEdfSet's decoded shape and readEDF's ACTUAL output (a signal-label / clock / annotations
    // rename) would pass the floor yet break on real files. This pins that seam: build a real EDF
    // ArrayBuffer, decode it, feed the decoded record in as a {PLD,EVE} set, assert schema-valid.
    var CE = env.CpapEdf;
    if (CP && typeof CP.compute === 'function' && CE && typeof CE._buildSyntheticEDF === 'function' && typeof CE.readEDF === 'function') {
      var cpRec;
      try { cpRec = CE.readEDF(CE._buildSyntheticEDF({ records: 8 })); } catch (e6) { T.ok('CPAPDex readEDF(real EDF buffer) threw: ' + e6.message, false); }
      if (cpRec) {
        T.ok('  readEDF decoded a Press channel + annotations', !!(cpRec.signals && cpRec.signals['Press.40ms']) && Array.isArray(cpRec.annotations), cpRec.signals && Object.keys(cpRec.signals).join(','));
        var cpe2;
        // the decoded record carries Press (therapy clock + pressure) AND an EVE annotation → use it as both
        try { cpe2 = CP.compute({ edfSets: [{ PLD: cpRec, EVE: cpRec }] }); } catch (e7) { T.ok('CPAPDex readEDF→compute threw: ' + e7.message, false); }
        if (cpe2) {
          T.ok('  readEDF→compute(): schema-valid ganglior.node-export (CPAPDex)', cpe2.schema && cpe2.schema.name === 'ganglior.node-export' && cpe2.schema.node === 'CPAPDex', cpe2.schema && cpe2.schema.name);
          T.ok('  readEDF→compute(): recording.startEpochMs finite + 1 session', !!(cpe2.recording && isFinite(cpe2.recording.startEpochMs) && cpe2.recording.sessionCount === 1), cpe2.recording && cpe2.recording.startEpochMs);
          T.ok('  readEDF→compute(): device-scored event from the decoded EVE annotation', Array.isArray(cpe2.ganglior_events) && cpe2.ganglior_events.some(function (e) { return e.meta && e.meta.source === 'device-scored'; }), cpe2.ganglior_events && cpe2.ganglior_events.length);
        }
      }
    }
  });

  /* ════ Phase-9 compute() ≡ committed export — EQUIVALENCE GATE (-II §1 · -IV §3) ════
     The whole point of compute() is that a file dropped into the Data Unifier / OverDex
     produces the SAME node-export as the same recording run through the app. Until now
     that was guaranteed only "by construction" (one shared builder) + a one-time HAND
     regen-diff re-run on every leg (PulseDex, OxyDex ×2, HRVDex — 4 times). This gate
     AUTOMATES the §3 regen-diff: for each node with a committed uploads/*.csv input +
     export fixture (wired into env.equiv by BOTH runners), run Node.compute({text}) and
     deep-diff its result against the committed export, EXCLUDING the documented volatile
     (file/provenance/kernel) + profile-coupled (newMetrics.vo2est/karv) fields. Now NO
     future DSP/bundle edit can silently drift compute() from the shipped export without a
     red. WIRED NODES (each has a committed input + ganglior-export fixture in uploads/,
     recorded in FIXTURE-PROVENANCE.json — SIGNAL-ADAPTER-FOLLOWUPS-VI §1 extended this from
     OxyDex-only to all three migrated nodes):
       · OxyDex   — O2Ring CSV → compute({text}); compare nights[0] vs fixture[0] (array).
       · PulseDex — Polar RR txt → parseRRInput() → compute({intervals,tsMs,t0Ms,offsetMin});
                    compare the WHOLE node-export (no nights[]) vs the committed export.
       · HRVDex   — Welltory summary CSV → compute({text}); compare the WHOLE node-export.
     PulseDex/HRVDex export shapes carry schema.generated (a per-run timestamp) + kernel +
     provenance — all volatile, so EXCL strips `generated` too (added for VI §1; OxyDex's
     night element has no such keys, so it is unaffected). */
  group('Phase-9 compute() ≡ committed export — equivalence gate', 'oxydex-dsp · pulsedex-dsp · hrvdex-dsp · glucodex-dsp · ecgdex-dsp · co-load · equivalence', function (T) {
    var EQ = env.equiv || {};
    // Excluded key NAMES (anywhere in the tree): non-computed metadata the headless path
    // leaves null/volatile + the FIXTURE-PROVENANCE profile-coupled strip-list. Matches the §3 diff.
    // `generated` = schema timestamp (changes every run); `kernel` = DexKernel version/hash
    // (identical run-to-run but metadata, not a computed physiological field).
    var EXCL = { file: 1, provenance: 1, kernel: 1, generated: 1, vo2est: 1, karv: 1 };
    function diff(a, b, path, out) {
      if (out.length > 40) return;
      if (a === b) return;
      var ta = typeof a, tb = typeof b;
      if (ta === 'number' && tb === 'number') {
        if (!(isNaN(a) && isNaN(b)) && Math.abs(a - b) > 1e-9 * (1 + Math.abs(a))) out.push(path + ': ' + a + ' != ' + b);
        return;
      }
      if (a == null || b == null || ta !== 'object' || tb !== 'object') { out.push(path + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); return; }
      if (Array.isArray(a) !== Array.isArray(b)) { out.push(path + ': array/object shape mismatch'); return; }
      var keys = {};
      Object.keys(a).forEach(function (k) { keys[k] = 1; });
      Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) { if (!EXCL[k]) diff(a[k], b[k], path ? path + '.' + k : k, out); });
    }
    // Per-node wiring: run() turns the committed raw INPUT text into a compute() result via
    // the SAME seam the app/orchestrator use; pick() selects the element the fixture stores.
    var CASES = [
      { key: 'oxydex', label: 'OxyDex', node: env.OxyDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res && res.nights && res.nights[0]; },
        fixPick: function (fx) { return Array.isArray(fx) ? fx[0] : fx; } },
      { key: 'pulsedex', label: 'PulseDex', node: env.PulseDex,
        // RR text → frame (parseRRInput, on the PulseDex namespace) → compute(frame).
        run: function (n, input) {
          var f = (typeof n.parseRRInput === 'function') ? n.parseRRInput(input) : null;
          if (!f) return null;
          return n.compute({ intervals: f.vals, tsMs: f.tsMs, t0Ms: f.t0Ms, offsetMin: f.offsetMin });
        },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      { key: 'hrvdex', label: 'HRVDex', node: env.HRVDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      // GlucoDex (Phase-9 CGM leg, SIGNAL-ADAPTER-PHASE9-REMAINING-NODES §1G): a real Abbott Lingo
      // vendor CSV → compute({text}) ≡ the committed light node-export (recording + ganglior_events).
      // The Lingo input also carries ≥37 nocturnal_hypo + 5 glucose_excursion events, so this case
      // byte-checks the GlucoDex event stream (t/tMs/conf/meta/ordering), not just the recording block.
      { key: 'glucodex', label: 'GlucoDex', node: env.GlucoDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      // PpgDex (Phase-9 raw-PPG leg, node 2/4): a real Polar Verity Sense *_PPG.txt (~6.5 min, 176 Hz)
      // → compute({text}) ≡ the committed light node-export (recording + ganglior_events). Guards
      // compute()-drift on the optical beat-detection → self-PPI → multi-epoch HRV path. ganglior_events
      // is empty on this short clip (no between-epoch drop) — like the PulseDex/OxyDex equiv cases; the
      // P11 round-trip + floor cover schema-validity, event-byte coverage tracked in the follow-ups brief.
      { key: 'ppgdex', label: 'PpgDex', node: env.PpgDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      // ECGDex (Phase-9 raw-ECG leg, node 3/4): a real Polar H10 *_ECG.txt clip (~6 min, 130 Hz) →
      // compute({text}) ≡ the committed light node-export (recording + ganglior_events). Guards
      // compute()-drift on the pure parseECG + band-pass → Pan-Tompkins R-peak (NO Worker) → SQI →
      // HRV → CVHR path. ganglior_events is empty on this short clip (no sustained CVHR train, not
      // longRec) — like the PpgDex/PulseDex equiv cases; the P12 round-trip + floor cover the rest.
      { key: 'ecgdex', label: 'ECGDex', node: env.ECGDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      // CPAPDex (node 4/4) is intentionally ABSENT from this gate: its input is a BINARY multi-file EDF
      // set, not a {text}/CSV the `run: n.compute({text})` seam can drive. compute()-vs-app parity for
      // CPAPDex is covered instead by the floor group's `compute() ≡ CpapFusion.cpapBuildExport`
      // assertion on a synthetic decoded set (GENERIC-EMIT-GATE-FOLLOWUPS-I §1 frame-shape decision).
      // VII §2: event-byte-coverage cases. Same seams as the equiv cases above, but their committed
      // inputs each emit ≥1 event of EACH impulse, so the full-tree diff now byte-checks the event
      // array (t-string / conf / meta / ordering) — HRVDex: hrv_low(measured)+stress_high(heuristic,
      // derived); PulseDex windowed: hrv_drop+stress_peak.
      { key: 'hrvdex_events', label: 'HRVDex (events)', node: env.HRVDex,
        run: function (n, input) { return n.compute({ text: input }); },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } },
      { key: 'pulsedex_events', label: 'PulseDex (events)', node: env.PulseDex,
        run: function (n, input) {
          var f = (typeof n.parseRRInput === 'function') ? n.parseRRInput(input) : null;
          if (!f) return null;
          return n.compute({ intervals: f.vals, tsMs: f.tsMs, t0Ms: f.t0Ms, offsetMin: f.offsetMin });
        },
        pick: function (res) { return res; }, fixPick: function (fx) { return fx; } }
    ];
    CASES.forEach(function (c) {
      // Split the precondition: a missing DSP NAMESPACE is a real regression (co-load broke) → FAIL.
      // A missing committed INPUT is expected on a fresh CI clone — uploads/ raw recordings are
      // gitignored personal data; only the derived *.node-export.json FIXTURES are committed — so
      // that half is a vacuous SKIP, not a fail. This leg still runs the full diff locally (and in
      // any environment) where uploads/ is present.
      var nsOk = !!(c.node && typeof c.node.compute === 'function');
      T.ok(c.label + ' namespace co-loaded (compute present)', nsOk, nsOk ? '' : 'DSP namespace not wired — load into both runners');
      if (!nsOk) return;
      var haveInput = !!(EQ[c.key] && EQ[c.key].input && EQ[c.key].fixture);
      if (!haveInput) { T.skip(c.label + ' compute() ≡ committed export', 'committed input absent — uploads/ is gitignored (personal data); this leg runs locally with uploads/ present'); return; }
      var res = c.run(c.node, EQ[c.key].input);
      var el = c.pick(res);
      // serialize exactly as the export does, so the comparison is structural, not by reference.
      var elSer = el ? JSON.parse(JSON.stringify(el)) : null;
      var fx = c.fixPick(EQ[c.key].fixture);
      T.ok(c.label + ' compute() produced a serializable export element', !!elSer && !!fx);
      if (elSer && fx) {
        var d = [];
        diff(elSer, fx, '', d);
        T.ok(c.label + '.compute() ≡ committed export (physiological fields; vol/profile excluded)', d.length === 0, d.length ? d.slice(0, 8).join(' · ') : 'byte-identical');
      }
    });

    // ── CPAPDex GOLDEN-EXPORT reference gate (CPAPDEX-PHASE9-FOLLOWUPS-II §1) ──
    // CPAPDex can't join the CASES loop above — its real input is a BINARY multi-file EDF set, not {text}.
    // The Phase-9 floor only asserts compute() ≡ cpapBuildExport: that pins the two CODE PATHS to EACH
    // OTHER, not to a reference OUTPUT. Since BOTH the app's exportNight and compute() delegate to the SAME
    // CpapFusion.cpapBuildExport, a silent regression INSIDE that shared builder (crossMetrics assembly,
    // oximetry[]/sessions[] mapping, quality, …) drifts both paths together and the parity assert stays
    // green. This gate closes that: rebuild the SAME deterministic synthetic night the floor uses
    // (_synthEdfSet{oxi,cs} → buildSessionFromEdf → buildNight) → cpapBuildExport and deep-diff the FULL
    // export tree against a committed reference (uploads/cpapdex_synthetic_golden.node-export.json), reusing
    // THIS group's diff + EXCL (file/provenance/kernel/generated). crossNode is deterministically null here
    // (no peer node-exports are ingested into CpapCoimport in the shared suite). A deliberate export-shape
    // change now REQUIRES regenerating the golden; a silent one REDS. Wired into BOTH runners via env.equiv.cpapdex_golden.
    (function () {
      var CDSPg = env.CpapDsp, CFUSg = env.CpapFusion, gFix = EQ.cpapdex_golden && EQ.cpapdex_golden.fixture;
      var wiredG = !!(CDSPg && typeof CDSPg._synthEdfSet === 'function' && typeof CDSPg.buildSessionFromEdf === 'function'
        && typeof CDSPg.buildNight === 'function' && CFUSg && typeof CFUSg.cpapBuildExport === 'function' && gFix);
      T.ok('CPAPDex golden: modules + committed golden fixture available', wiredG,
        gFix ? 'present' : 'uploads/cpapdex_synthetic_golden.node-export.json not wired into env.equiv — gate skipped');
      if (!wiredG) return;
      var gNight = CDSPg.buildNight([CDSPg.buildSessionFromEdf(CDSPg._synthEdfSet({ oxi: true, cs: true }), {})]);
      var gExp = JSON.parse(JSON.stringify(CFUSg.cpapBuildExport(gNight)));
      var gd = [];
      diff(gExp, gFix, '', gd);
      T.ok('CPAPDex cpapBuildExport ≡ committed golden export (full tree; vol excluded)', gd.length === 0, gd.length ? gd.slice(0, 8).join(' · ') : 'byte-identical');
    })();

    // ── CPAPDex MULTI-NIGHT golden-export gate (CPAPDEX-PHASE9-FOLLOWUPS-III §1) ──
    // Retiring cpapdex-multi17 (-I §1, not faithfully regenerable) left exportNight's MULTI-NIGHT
    // branch (chrono.length>=3 → a schema.multiNight envelope wrapping N per-night cpapBuildExport
    // trees + a ganglior.crossnight aggregate header from CPAPCross.crossNightBlock) with NO fixture.
    // The single-night golden above pins ONE cpapBuildExport tree; CPAPCross.crossNightBlock's MATH
    // is covered by the P12 cross-Dex source-drift gate (its crossNight is byte-identical to the
    // other *-cross.js) + the shared crossNight engine's ECGCross runtime tests; but the WRAPPER that
    // stitches N nights + the crossnight header was diffed against a reference NOWHERE — a silent
    // regression in the array assembly /
    // header / nightCount could ship. This gate closes that: rebuild >=3 DETERMINISTIC nights from
    // the SAME _synthEdfSet the floor + single-night golden use, each shifted by a WHOLE day (Clock
    // Contract: floating tMs; a whole-day shift keeps the wall-clock time-of-day but advances the
    // date → a distinct dateAnchorMs per night, so buildNight keeps them as separate nights),
    // reassemble the IDENTICAL envelope exportNight builds, and deep-diff the full tree (reusing THIS
    // group's diff + EXCL: file/provenance/kernel/generated — note crossNight.schema.generated is the
    // crossnight envelope's own per-run stamp, also volatile, stripped by the same `generated` key).
    // crossNode is deterministically null here (no peer node-exports ingested into CpapCoimport in
    // the shared suite). exportNight INLINES the envelope (not a callable builder), so the shape is
    // reconstructed here (-III §1: in-test reconstruction, NO re-bundle) — and a SOURCE-PIN below
    // reds if exportNight's wrapper shape drifts, forcing this reconstruction + the golden to be
    // regenerated in lock-step (the teeth a pure in-test copy lacks). Wired into BOTH runners via
    // env.equiv.cpapdex_multinight_golden (+ env.CPAPCross / cpapdex-cross.js co-loaded in both).
    (function () {
      var CDSPm = env.CpapDsp, CFUSm = env.CpapFusion, CXm = env.CPAPCross, CNEm = env.CrossNightEnvelope,
        DKm = env.DexKernel, mFix = EQ.cpapdex_multinight_golden && EQ.cpapdex_multinight_golden.fixture;
      var wiredM = !!(CDSPm && typeof CDSPm._synthEdfSet === 'function' && typeof CDSPm.buildSessionFromEdf === 'function'
        && typeof CDSPm.buildNight === 'function' && CFUSm && typeof CFUSm.cpapBuildExport === 'function'
        && CXm && typeof CXm.crossNightBlock === 'function' && CNEm && typeof CNEm.build === 'function' && mFix);
      T.ok('CPAPDex multi-night golden: modules (incl. CPAPCross + CrossNightEnvelope) + committed golden fixture available', wiredM,
        mFix ? 'present' : 'uploads/cpapdex_synthetic_multinight_golden.node-export.json or CPAPCross not wired into env.equiv — gate skipped');
      if (!wiredM) return;
      var DAY = 86400000;
      var mkNight = function (delta) {
        var set = CDSPm._synthEdfSet({ oxi: true, cs: true });
        ['PLD', 'BRP', 'SA2', 'EVE', 'CSL'].forEach(function (k) {
          if (set[k] && set[k].clock && set[k].clock.t0Ms != null) set[k].clock.t0Ms += delta;
          if (set[k] && set[k].annotations) set[k].annotations.forEach(function (a) { if (a.tMs != null) a.tMs += delta; });
        });
        return CDSPm.buildNight([CDSPm.buildSessionFromEdf(set, {})]);
      };
      var chrono = [mkNight(0), mkNight(DAY), mkNight(2 * DAY)].sort(function (a, b) { return (a.t0Ms || 0) - (b.t0Ms || 0); });
      // CPAPDEX-PHASE9-FOLLOWUPS-IV §2 (paired with OXYDEX-NODE-EXPORT-ENVELOPE-FOLLOWUPS-II): exportNight now
      // DELEGATES to the SHARED CpapFusion.cpapBuildMultiNightExport(chrono), so this gate drives the SAME builder
      // the app runs — the -III in-test reconstruction + the 4 exportNight source-pin asserts are RETIRED. A
      // wrapper-shape change now moves the one shared function, so this golden diff reds directly (the app-drift
      // teeth the old source-pin gave, now structural rather than a regex on the app source).
      T.ok('CpapFusion.cpapBuildMultiNightExport is the shared multi-night builder (lifted from exportNight)', typeof CFUSm.cpapBuildMultiNightExport === 'function');
      if (typeof CFUSm.cpapBuildMultiNightExport !== 'function') return;
      var mExp = JSON.parse(JSON.stringify(CFUSm.cpapBuildMultiNightExport(chrono)));
      var md = [];
      diff(mExp, mFix, '', md);
      T.ok('CPAPDex multi-night envelope ≡ committed golden export (full tree; vol excluded)', md.length === 0, md.length ? md.slice(0, 8).join(' · ') : 'byte-identical');
      T.ok('multi-night wrapper exercised: >=3 nights + ganglior.crossnight header present',
        mExp.nightCount >= 3 && Array.isArray(mExp.nights) && mExp.nights.length >= 3
        && mExp.crossNight && mExp.crossNight.schema && mExp.crossNight.schema.name === 'ganglior.crossnight',
        'nightCount=' + mExp.nightCount + ' nights=' + (mExp.nights && mExp.nights.length));
    })();
  });

  /* ════ Phase-9 GENERIC adapter → emit → schema-valid export — every signalType (PPGDEX-FOLLOWUPS §10) ════
     The recurring Phase-9 trap (brief §1 / §4 #2): each node's signal-orchestrate emit hands
     compute() a CANONICAL SignalFrame, not the node's ad-hoc parser shape — and a too-small {text}/
     synthetic floor HIDES a compute() that only accepts {text}. GlucoDex/PpgDex/ECGDex each closed it
     with a PER-NODE canonical-frame round-trip (P10/P11/P12) — but that is N hand-written gates the
     next coder must remember. This ONE generic group makes "the orchestrate emit path actually works
     for this signalType" a CHECKED, by-construction invariant: for EVERY distinct signalType that has a
     registered adapter, build the canonical frame signal-orchestrate hands compute(), then run the REAL
     SignalOrchestrate.emitNodeExport(frame, host) and assert a schema-valid ganglior.node-export. A
     registered signalType with NEITHER a provider here NOR an AUX (companion-channel) exemption is a RED
     — so when CPAPDex (node 4/4) registers its adapter, the next coder is FORCED to wire both a provider
     and the emit case, and the gap cannot recur silently. DRIVER 2 (GLUCODEX-FOLLOWUPS §1) additionally
     binds coverage to the EMIT ALLOWLIST: every signalType with canEmit()===true (drawn from
     SignalSpec.types() ∪ the registered adapters ∪ the providers) must ALSO have a provider + schema-valid
     export HERE — so a node that goes emittable via canEmit + a SignalSpec entry WITHOUT a classic
     sample-stream adapter (the CPAPDex EDF/flow risk) still reds, regardless of how it lands. Needs
     SignalOrchestrate + the namespaced DSP hosts co-loaded (both present in this realm). */
  group('Phase-9 generic adapter → emit → schema-valid export (every signalType)', 'co-load · signal-orchestrate · equivalence', function (T) {
    var SO = env.SignalOrchestrate, SF = env.SignalFrame, SA = env.SignalAdapters, SP = env.SignalSpec;
    var GLU = env.GLUDSP, SY = env.SYNTH, ECD = env.ECGDSP, PG = env.PpgDex, CDSP = env.CpapDsp;
    T.ok('SignalOrchestrate.emitNodeExport + SignalFrame + SignalAdapters co-loaded', !!(SO && typeof SO.emitNodeExport === 'function' && SF && SA), SO ? '' : 'load signal-orchestrate.js into both runners');
    if (!(SO && typeof SO.emitNodeExport === 'function' && SF && SA && typeof SA.list === 'function')) return;
    var U2 = function (y, mo, d, h, mi, s) { return Date.UTC(y, mo, d, h || 0, mi || 0, s || 0); };
    // node-name per signalType (the host shim emitNodeExport reads) + a synthetic canonical-frame
    // provider that builds EXACTLY the shape signal-orchestrate hands compute().
    var NODE_OF = { rr: 'PulseDex', spo2: 'OxyDex', hrv: 'HRVDex', cgm: 'GlucoDex', ppg: 'PpgDex', ecg: 'ECGDex', cpap: 'CPAPDex' };
    var AUX = { acc: 1, hr: 1 };   // companion channels — no node/emit path by design
    var providers = {
      rr: function () { var nn = [], ts = [], t0 = U2(2026, 5, 17, 22, 0, 0), acc = t0; for (var i = 0; i < 240; i++) { nn.push(820 + Math.round(40 * Math.sin(2 * Math.PI * 0.25 * i))); acc += nn[i]; ts.push(acc); } return SF.toSignalFrame('rr', { intervals: nn, tsMs: ts, t0Ms: t0, offsetMin: null, usable: true }, { adapter: 'synthetic' }); },
      spo2: function () { var t0 = U2(2026, 5, 17, 23, 0, 0), s = [], ts = []; for (var k = 0; k < 1200; k++) { var tm = t0 + k * 1000, dip = (k % 600 >= 585) ? -7 : 0; s.push({ tMs: tm, spo2: 96 + dip, hr: 58 + (k % 5) + (dip ? 6 : 0), motion: 0 }); ts.push(tm); } return SF.toSignalFrame('spo2', { samples: s, tsMs: ts, t0Ms: t0, usable: true }, { adapter: 'synthetic' }); },
      hrv: function () { var t0 = U2(2026, 5, 17, 7, 30, 0); var rows = [{ _tMs: t0, _offsetMin: null, _mode: 0.9, _mxdmn: 0.30, _amo50: 40, _rmssd: 38, _sdnn: 55, _hr: 58, _stress: 50, _energy: 40 }, { _tMs: t0 + 86400000, _offsetMin: null, _mode: 0.88, _mxdmn: 0.32, _amo50: 42, _rmssd: 15, _sdnn: 48, _hr: 61, _stress: 72, _energy: 35 }]; return SF.toSignalFrame('hrv', { samples: rows, tsMs: [rows[0]._tMs, rows[1]._tMs], t0Ms: t0, usable: true }, { adapter: 'synthetic' }); },
      cgm: function () { if (!(GLU && typeof GLU.genSynthetic === 'function')) return null; var g = GLU.genSynthetic({ days: 3 }); var sm = g.tMs.map(function (t, i) { return { tMs: t, v: g.vMgdl[i] }; }); return SF.toSignalFrame('cgm', { samples: sm, tsMs: g.tMs, t0Ms: g.t0Ms, unit: g.unit || 'mg/dL', usable: true }, { adapter: 'synthetic' }); },
      ppg: function () { if (!(SY && typeof SY.renderPPG === 'function' && typeof SY.pickWindow === 'function' && PG && typeof PG.parsePPG === 'function')) return null; var tl = SY.buildTimelines()[0]; var rec = PG.parsePPG(SY.renderPPG(tl, SY.pickWindow(tl))); var sm = { ch: rec.ch, amb: rec.amb, relSec: rec.relSec, n: rec.n, durSec: rec.durSec, length: rec.n }; return SF.toSignalFrame('ppg', { samples: sm, fs: rec.fs, t0Ms: rec.t0Ms, offsetMin: rec.offsetMin, usable: rec.n >= 200 }, { adapter: 'synthetic' }); },
      ecg: function () { if (!(ECD && typeof ECD.genSynthetic === 'function')) return null; var r = ECD.genSynthetic({ durSec: 120, seed: 20260617 }); return SF.toSignalFrame('ecg', { samples: r.int16, fs: r.fs, t0Ms: r.t0Ms, offsetMin: null, usable: r.int16.length >= r.fs * 8 }, { adapter: 'synthetic' }); },
      // cpap (node 4/4): EDF binary is multi-file + pre-scored, so there is no single sample stream.
      // The canonical frame carries the 25 Hz BRP FLOW waveform in `samples` (so validateFrame passes)
      // + the decoded {BRP,PLD,SA2,EVE,CSL} set(s) as a `edfSets` SIDECAR (GENERIC-EMIT-GATE-FOLLOWUPS-I
      // §1 frame-shape decision); CPAPDex.compute reads the sidecar → buildNight → cpapBuildExport.
      cpap: function () { if (!(CDSP && typeof CDSP._synthEdfSet === 'function' && typeof CDSP.chan === 'function')) return null; var set = CDSP._synthEdfSet({ oxi: true, cs: true }); var fl = CDSP.chan(set.BRP, 'Flow'); var t0 = (set.PLD && set.PLD.clock && set.PLD.clock.t0Ms) || (set.BRP && set.BRP.clock && set.BRP.clock.t0Ms); var fr = SF.toSignalFrame('cpap', { samples: (fl && fl.data) || null, fs: (fl && fl.fs) || 25, t0Ms: t0, usable: !!(fl && fl.data && fl.data.length) }, { adapter: 'synthetic' }); fr.edfSets = [set]; return fr; }
    };
    // ── exercise(st): build the canonical frame signal-orchestrate hands compute() for signalType
    //    `st`, VALIDATE it, run the REAL SignalOrchestrate.emitNodeExport, and assert a schema-valid
    //    ganglior.node-export. Memoized in `covered` so the two driver loops below never double-run a
    //    type. Returns true once a type has been (successfully or soft-skip) exercised. ──
    var covered = {};
    function exercise(st) {
      if (covered[st] != null) return covered[st];
      var prov = providers[st];
      if (!prov) { covered[st] = false; return false; }
      var frame = null;
      try { frame = prov(); } catch (e) { T.ok('  ' + st + ' provider built a frame', false, e.message); covered[st] = false; return false; }
      if (!frame) {
        // §2 (GENERIC-EMIT-GATE-FOLLOWUPS): a falsy frame ⇒ the provider's synth source isn't co-loaded
        // in THIS realm. For a NON-emittable type that's intentional resilience (soft skip). But for an
        // EMITTABLE type (canEmit===true) a missing frame-source means this realm SILENTLY skips the
        // node's actual adapter→emit→export verification — exactly the latent gap the emit-allowlist
        // binding is meant to close. So make it a VISIBLE RED: an emittable type MUST have its synth
        // frame-source co-loaded in EVERY runner (pairs with §1 "co-load the synth source in both
        // runners"); a future node whose generator is missing in a realm can't quietly skip its own
        // export check there. canEmit-less SO (older build) ⇒ mustEmit=false ⇒ old soft-skip preserved.
        var mustEmit = (typeof SO.canEmit === 'function') && SO.canEmit(st) === true;
        T.ok('  ' + st + ' provider produced a frame (synth source co-loaded)', !mustEmit,
          mustEmit ? 'canEmit("' + st + '")=true but its synth frame-source is NOT co-loaded in this realm — the schema-valid export is NOT verified here; co-load the generator in BOTH runners (Dex-Test-Suite.html + tests/run-tests.mjs)'
                   : 'generator not in env — soft skip (non-emittable type)');
        covered[st] = mustEmit ? false : true; return covered[st];
      }
      T.ok('  ' + st + ' frame validates', SF.validateFrame(frame).ok, SF.validateFrame(frame).errors.join('; '));
      var nodeName = NODE_OF[st], node = env[nodeName];
      if (!(node && typeof node.compute === 'function')) { T.ok('  ' + nodeName + ' namespace co-loaded for ' + st + ' emit', false); covered[st] = false; return false; }
      var host = { DexKernel: env.DexKernel }; host[nodeName] = node;
      var exp = null;
      try { exp = SO.emitNodeExport(frame, host); } catch (e) { T.ok('  SignalOrchestrate.emitNodeExport(' + st + ' frame) threw: ' + e.message, false); covered[st] = false; return false; }
      T.ok('  emitNodeExport(' + st + ' frame) → ganglior.node-export / node ' + nodeName, !!(exp && exp.schema && exp.schema.name === 'ganglior.node-export' && exp.schema.node === nodeName), exp && exp.schema ? exp.schema.node : 'no schema');
      // payload carrier differs by node: most emit a ganglior_events[] stream; OxyDex emits a
      // nights[] summary the Integrator's adaptOxyDex synthesizes events from. Accept either.
      T.ok('  ' + st + ' export has recording + event/night payload', !!(exp && exp.recording && (Array.isArray(exp.ganglior_events) || Array.isArray(exp.nights))), exp && exp.recording ? (Array.isArray(exp.ganglior_events) ? 'events' : (Array.isArray(exp.nights) ? 'nights' : 'no payload')) : 'no recording');
      covered[st] = true; return true;
    }

    // DRIVER 1 — every signalType with a REGISTERED ADAPTER must have a provider here (or be an AUX
    // companion). When CPAPDex registers its adapter, a missing provider reds (the original §10 guarantee).
    var seen = {}; SA.list().forEach(function (a) { seen[a.signalType] = (seen[a.signalType] || 0) + 1; });
    Object.keys(seen).sort().forEach(function (st) {
      if (AUX[st]) { T.ok('signalType "' + st + '" is an auxiliary channel (no emit path by design) — skipped', true); return; }
      var prov = providers[st];
      T.ok('signalType "' + st + '" (has registered adapter) has a synthetic emit-path provider', !!prov, prov ? '' : 'NO provider — wire one + the SignalOrchestrate emit case so the compute()-shape path is gated (PPGDEX-FOLLOWUPS §10)');
      if (prov) exercise(st);
    });

    // DRIVER 2 — BIND coverage to the EMIT ALLOWLIST, not just the adapter registry (GLUCODEX-FOLLOWUPS §1).
    // DRIVER 1 only fires once a node registers a classic sample-stream adapter. CPAPDex is the distinct
    // case (EDF/flow, event-not-stream, "highest risk of a shape mismatch") and can go live by flipping
    // SignalOrchestrate.canEmit + adding a SignalSpec entry BEFORE — or WITHOUT — a classic adapter,
    // slipping DRIVER 1. So additionally require: EVERY signalType the orchestrate layer will actually
    // emit for (canEmit === true), drawn from SignalSpec.types() ∪ the registered adapters ∪ the providers
    // here, MUST have a provider that yields a schema-valid export in THIS gate. The instant a node becomes
    // emittable, a missing/broken adapter→emit→export path is a RED — regardless of HOW the node lands.
    if (typeof SO.canEmit === 'function') {
      var universe = {};
      if (SP && typeof SP.types === 'function') SP.types().forEach(function (t) { universe[t] = 1; });
      SA.list().forEach(function (a) { universe[a.signalType] = 1; });
      Object.keys(providers).forEach(function (t) { universe[t] = 1; });
      // ALSO union the orchestrate EMIT ALLOWLIST itself (its keys — read from the live accessor, or a
      // balanced parse of source as fallback; see -II §3 below) — so a node that becomes emittable WITHOUT
      // a SignalSpec entry AND without a registered adapter (a fully bespoke type added straight to
      // _EMITTABLE, e.g. a CPAPDex 'cpap'/'flow') is STILL in the universe and still reds for a missing
      // provider. canEmit stays the live source of truth for the filter; this only guarantees the
      // candidate set cannot miss an allowlisted type.
      // GENERIC-EMIT-GATE-FOLLOWUPS-II §3 + -III §1 — discover the EMIT ALLOWLIST keys ROBUSTLY. PREFER the
      // live runtime accessor SignalOrchestrate.emittableTypes() (immune to ALL source-format drift); fall back
      // to a source parse ONLY when it's absent (an older build). -III §1 makes that fallback string/comment-
      // AWARE: it counts `{`/`}` ONLY in code state (not inside //line or /*block*/ comments, or '..'/".."/`..`
      // strings), so a `}` inside a comment or string in the `_EMITTABLE` literal can't set the close brace
      // early and SILENTLY TRUNCATE the allowlist (the old brace-only scan + a "found *a* close brace" teeth A
      // passed that "trailing-comment brace" case, leaving the live accessor silently load-bearing — -III §1).
      var _emLive = (typeof SO.emittableTypes === 'function') ? SO.emittableTypes()
                  : (SO._EMITTABLE && typeof SO._EMITTABLE === 'object') ? Object.keys(SO._EMITTABLE) : null;
      var _src = (env.sources || {})['signal-orchestrate.js'] || '';
      // scan `_EMITTABLE = { … }` to the matching `}`, brace-counting only in CODE state. (_EMITTABLE values
      // are numeric/object literals, never regexes, so a regex-literal `/}/` edge can't arise here.)
      var _emittableSrcKeys = function (src) {
        var ix = src.search(/_EMITTABLE\s*=\s*\{/); if (ix < 0) return null;
        var open = src.indexOf('{', ix); if (open < 0) return null;
        var depth = 0, end = -1, st = 'code', q = '';
        for (var i = open; i < src.length; i++) {
          var c = src[i], n = src[i + 1];
          if (st === 'line') { if (c === '\n') st = 'code'; continue; }
          if (st === 'block') { if (c === '*' && n === '/') { st = 'code'; i++; } continue; }
          if (st === 'str') { if (c === '\\') i++; else if (c === q) st = 'code'; continue; }
          if (c === '/' && n === '/') { st = 'line'; i++; continue; }
          if (c === '/' && n === '*') { st = 'block'; i++; continue; }
          if (c === '\'' || c === '"' || c === '`') { st = 'str'; q = c; continue; }
          if (c === '{') depth++;
          else if (c === '}' && --depth === 0) { end = i; break; }
        }
        if (end <= open) return { keys: null, balanced: false };
        var keys = {}, m, re = /(\w+)\s*:/g, body = src.slice(open + 1, end);
        while ((m = re.exec(body))) keys[m[1]] = 1;   // top-level + nested keys; non-emittable extras are canEmit-filtered below
        return { keys: Object.keys(keys), balanced: true };
      };
      var _parsed = _emittableSrcKeys(_src);                 // null if source absent; { keys, balanced } otherwise
      var _emSrc = (_parsed && _parsed.balanced) ? _parsed.keys : null;
      // teeth A — under the comment/string-aware scan the literal MUST close; a never-closing scan is a
      // truncated parse that could silently shrink the candidate universe (only asserted when source is in env).
      if (_parsed) T.ok('_EMITTABLE source literal closes under a comment/string-aware brace scan (-III §1)', _parsed.balanced, _parsed.balanced ? '' : 'no matching close brace for _EMITTABLE in signal-orchestrate.js — the parsed allowlist may be truncated; expose SignalOrchestrate.emittableTypes() (the durable fix) or keep _EMITTABLE a flat literal');
      // teeth B — when BOTH the live accessor and the source parse are present, every LIVE emittable key MUST
      // survive the source parse; a key the parse lost is exactly the truncation bug, caught here (-II §3).
      if (_emLive && _emSrc) { var _lost = _emLive.filter(function (t) { return _emSrc.indexOf(t) < 0; }); T.ok('emit-allowlist: source parse retains every live key (no truncation) (-II §3)', _lost.length === 0, _lost.length ? 'live emittable keys missing from the source parse: ' + _lost.join(', ') : ''); }
      // teeth C — the live accessor is LOAD-BEARING for full truncation-safety. If the source DECLARES
      // emittableTypes() but the loaded module does NOT expose it, this realm silently degraded to the
      // best-effort source parse (a stale / mis-loaded build) — RED so the downgrade can't pass unnoticed (-III §1).
      if (/emittableTypes\s*\(/.test(_src)) T.ok('live SignalOrchestrate.emittableTypes() present (its source declares it) (-III §1)', typeof SO.emittableTypes === 'function', 'signal-orchestrate.js source declares emittableTypes() but the loaded module does not expose it — stale/mis-loaded realm; the gate would silently fall back to the best-effort source parse');
      // and ANNOUNCE a legitimate fallback (an older build with no accessor) so a downgrade is visible in the log.
      if (!_emLive) T.ok('emit-allowlist via best-effort source parse — live accessor absent in this realm (-III §1)', true, 'no SignalOrchestrate.emittableTypes()/_EMITTABLE in env — using the comment/string-aware source parse');
      // union the AUTHORITATIVE allowlist (live if present, else the comment/string-aware source parse).
      (_emLive || _emSrc || []).forEach(function (t) { universe[t] = 1; });
      // -III §1 red-fires PROOF — exercise the comment/string-aware scanner on adversarial literals the live
      // `_EMITTABLE` is too flat to cover, so the hardened fallback is gate-backed regardless of the real shape.
      // Each embeds a `}` the OLD brace-only / `[^}]*` parse stopped at, dropping the key AFTER it; the new
      // scan must keep that key (and report balanced).
      [
        { s: 'var _EMITTABLE = { rr:1, spo2:1 };', need: 'spo2', why: 'flat literal' },
        { s: 'var _EMITTABLE = { rr:1, cpap:{edf:true}, ecg:1 };', need: 'ecg', why: 'nested value brace' },
        { s: 'var _EMITTABLE = { rr:1, // legacy }\n spo2:1 };', need: 'spo2', why: 'line-comment brace' },
        { s: 'var _EMITTABLE = { rr:1, /* } */ spo2:1 };', need: 'spo2', why: 'block-comment brace' },
        { s: 'var _EMITTABLE = { rr:1, sep:"}", spo2:1 };', need: 'spo2', why: 'string brace' }
      ].forEach(function (cse) {
        var r = _emittableSrcKeys(cse.s);
        T.ok('comment/string-aware _EMITTABLE scan keeps "' + cse.need + '" past a ' + cse.why + ' (-III §1)', !!(r && r.balanced && r.keys.indexOf(cse.need) >= 0), (r && r.balanced) ? ('scan dropped "' + cse.need + '"') : 'scan did not balance');
      });
      Object.keys(universe).sort().forEach(function (st) {
        if (!SO.canEmit(st)) return;   // only emittable types are required to have a gated emit path
        var prov = providers[st];
        T.ok('emittable signalType "' + st + '" (canEmit) has a gated adapter→emit→export provider', !!prov, prov ? '' : 'canEmit("' + st + '")=true but NO provider in this gate — a node went emittable without a schema-valid orchestrate emit path; wire providers["' + st + '"] + the SignalOrchestrate emit case (GLUCODEX-FOLLOWUPS §1)');
        if (prov) exercise(st);   // memoized — a no-op if DRIVER 1 already exercised it
      });
    }
  });

  /* ════ Co-load manifest — single source of truth vs every host realm (PPGDEX-FOLLOWUPS §5) ════
     The adapter + namespaced-DSP set signal-orchestrate needs was hand-synced across SIX sites;
     "one miss silently drops a node from a surface" (-IV §5). dex-coload.js is now the single
     ordered source of truth. This gate asserts (a) it stays in lock-step with what SignalAdapters
     ACTUALLY registers (adapter id === file basename), and (b) every host realm (Data Unifier ·
     OverDex · Dex-Test-Suite · run-tests.mjs) co-loads every module in it — so a future add that
     misses a host is a RED, not a silent drop. (Hosts keep static <script> tags for robust load
     ordering; a later pass MAY have them generate the tags from this manifest — ECGDEX-FOLLOWUPS.) */
  group('Co-load manifest — single source vs host realms (PPGDEX-FOLLOWUPS §5)', 'co-load · sources · purity', function (T) {
    var M = env.DexCoload, SA = env.SignalAdapters;
    T.ok('dex-coload.js manifest co-loaded (env.DexCoload)', !!(M && Array.isArray(M.adapters) && Array.isArray(M.dsps) && Array.isArray(M.all)), M ? '' : 'load dex-coload.js into both runners');
    if (!(M && M.adapters && M.dsps && M.all)) return;
    // (a) self-consistency: manifest adapter ids === the actually-registered adapter ids (id === basename).
    if (SA && typeof SA.list === 'function') {
      var regIds = SA.list().map(function (a) { return a.id; }).sort();
      var manIds = (M.adapterIds || M.adapters.map(function (p) { return p.replace(/^adapters\//, '').replace(/\.js$/, ''); })).slice().sort();
      T.ok('manifest adapter set === registered adapter set (no drift)', JSON.stringify(regIds) === JSON.stringify(manIds), 'registered=[' + regIds.join(',') + '] manifest=[' + manIds.join(',') + ']');
    }
    // (b) host membership: each host realm must reference every manifest module (no silent drop).
    var hosts = env.hosts || {};
    var HOSTS = ['Data Unifier.html', 'OverDex.html', 'Dex-Test-Suite.html', 'tests/run-tests.mjs'];
    var anyHost = false;
    HOSTS.forEach(function (h) {
      var text = hosts[h];
      if (text == null) { T.ok(h + ' host source available (membership check)', true, 'not in env.hosts — skipped for this host (other hosts + Node runner cover it)'); return; }
      anyHost = true;
      var missing = M.all.filter(function (mod) { return text.indexOf(mod) < 0; });
      T.ok(h + ' co-loads every manifest module (no silent drop)', missing.length === 0, missing.length ? ('MISSING: ' + missing.join(', ')) : 'all ' + M.all.length + ' present');
    });
    T.ok('at least one host realm available to check membership', anyHost, anyHost ? '' : 'no host sources wired into env.hosts');
  });

  /* ════ CO-LOAD §2/§3 — app-bundled AUX modules are runtime-PRESENT in this realm ════
     CROSS-MODULE-RUNTIME-COVERAGE §2 (root cause) + §3 (Node↔browser symmetry). The
     adapters+dsps manifest gate above ranges over routable modules only, so a per-node
     AUX module bundled into an app (a *-cross.js, *-coimport.js) could ship to users yet
     be loaded into NEITHER runner with no gate complaining — exactly how cpapdex-cross.js
     shipped runtime-untested (the discovery that surfaced this brief). dex-coload.js now
     lists those aux modules with the global each MUST expose once co-loaded; this gate
     asserts that global is live in env HERE. Because the SAME assertion runs in BOTH
     runners against each runner's OWN env, a module co-loaded in only one runner reds in
     the other → the §3 co-load symmetry is enforced by construction, not just documented. */
  group('Co-load §2/§3 — app-bundled aux modules runtime-present + runner-symmetric', 'co-load · sources', function (T) {
    var M = env.DexCoload;
    var has = !!(M && Array.isArray(M.nodeModules) && M.nodeModules.length);
    T.ok('dex-coload.js exposes the nodeModules aux-module manifest', has, has ? '' : 'dex-coload.js needs a nodeModules:[{file,global}] leg');
    if (!has) return;
    // each aux module MUST be runtime-co-loaded in THIS realm (its global hangs off env).
    // A red here = "an app ships this module but the suite never loads/runs it" (the blind spot)
    // OR "this runner co-loads it but the other doesn't" (the §3 asymmetry — both are real bugs).
    M.nodeModules.forEach(function (m) {
      T.ok(m.file + ' runtime-co-loaded (env.' + m.global + ' present)', env[m.global] != null,
        env[m.global] != null ? '' : 'co-load ' + m.file + ' into BOTH runners + map env.' + m.global + ' (CROSS-MODULE-RUNTIME-COVERAGE §2/§3)');
    });
    // the convenience mirror is consistent with the entries (no hand-drift)
    T.eq('nodeModuleGlobals mirrors nodeModules[].global', (M.nodeModuleGlobals || []).slice(),
      M.nodeModules.map(function (m) { return m.global; }));
    // every cross engine + the cpap coimport is accounted for (the universe can't silently shrink)
    var files = M.nodeModules.map(function (m) { return m.file; });
    ['ecgdex-cross.js', 'oxydex-cross.js', 'pulsedex-cross.js', 'ppgdex-cross.js', 'cpapdex-cross.js'].forEach(function (f) {
      T.ok('manifest lists ' + f, files.indexOf(f) >= 0);
    });
  });

  /* ════ CO-LOAD §1 — the nodeModules: aux leg is EXHAUSTIVE over what the apps bundle ════
     CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS §1. The Co-load §2/§3 gate above proves every module
     ON the nodeModules: list is runtime-present in BOTH runners — but the LIST is hand-authored,
     so a NEW *-cross.js / *-coimport.js wired into some Foo.src.html tomorrow is caught ONLY if a
     human ALSO adds it here (the narrowed-but-still-open blind spot the parent's §2 named: the same
     "bundled but never loaded in the suite" class that let cpapdex-cross.js slip can recur for any
     aux module nobody hand-lists). This gate closes the cross/coimport leg of that hole: it derives
     the set of cross/coimport modules the fleet ACTUALLY bundles by scanning every *.src.html's
     <script src> list, and asserts the nodeModules: leg's cross/coimport entries EQUAL that bundled
     set — a file added to a src.html but FORGOTTEN here REDs (missing-from-leg ⇒ never co-loaded),
     and a STALE leg entry no app bundles REDs (orphan). Identical input in both runners (browser
     fetches the same *.src.html the Node runner reads off disk). *-fusion.js is deliberately OUT of
     scope (the parent excluded it from nodeModules:); *-render/-app/-dsp/-edf are not this class. */
  group('Co-load §1 — nodeModules exhaustive over bundled cross/coimport modules', 'dex-coload · *.src.html', function (T) {
    var M = env.DexCoload;
    var SRC = env.srcHtml || {};
    var srcNames = Object.keys(SRC);
    T.ok('app *.src.html sources available to the gate', srcNames.length > 0,
      srcNames.length ? srcNames.length + ' src.html loaded' : 'wire env.srcHtml in BOTH runners (Dex-Test-Suite.html fetch + run-tests.mjs readSrcHtml)');
    T.ok('dex-coload.js exposes the nodeModules aux leg', !!(M && Array.isArray(M.nodeModules)), '');
    if (!srcNames.length || !M || !Array.isArray(M.nodeModules)) return;
    // the cross/coimport modules the FLEET bundles = union of <script src="*-(cross|coimport).js"> across every src.html
    var bundled = {};
    srcNames.forEach(function (name) {
      var html = SRC[name] || '';
      var re = /<script\s+[^>]*\bsrc=["']([a-z0-9_-]+-(?:cross|coimport)\.js)["']/gi, m;
      while ((m = re.exec(html))) bundled[m[1]] = true;
    });
    var bundledSet = Object.keys(bundled).sort();
    T.ok('found bundled cross/coimport modules to check', bundledSet.length > 0, bundledSet.join(', '));
    // the leg's cross/coimport entries (compare like-for-like; the leg may carry other aux classes later)
    var legCross = M.nodeModules.map(function (x) { return x.file; })
      .filter(function (f) { return /-(?:cross|coimport)\.js$/.test(f); }).sort();
    // FORWARD: every bundled cross/coimport module is on the leg (the NAMED hole — "added to a src.html, forgot the leg")
    bundledSet.forEach(function (f) {
      var on = legCross.indexOf(f) >= 0;
      T.ok('bundled ' + f + ' is on the nodeModules leg (⇒ runtime-co-loaded by Co-load §2/§3)', on,
        on ? '' : 'add { file:"' + f + '", global:… } to dex-coload.js nodeModules: AND co-load it into both runners');
    });
    // REVERSE: no stale leg entry that no app bundles (keeps the hand list honest both ways)
    legCross.forEach(function (f) {
      var inFleet = bundledSet.indexOf(f) >= 0;
      T.ok('leg entry ' + f + ' is bundled by some app (no orphan)', inFleet,
        inFleet ? '' : 'nodeModules lists ' + f + ' but no *.src.html bundles it — drop it or fix the basename');
    });
    // one-line summary: exact set equality (closes the hole in both directions)
    T.eq('nodeModules cross/coimport set === fleet-bundled cross/coimport set', legCross, bundledSet);
  });

  /* ════ CO-LOAD §1b — EVERY module a bundle inlines is runtime-PRESENT-or-EXEMPT ════
     CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS-II §1 — the full per-bundle introspection gate that
     the parent's lighter Co-load §1 step deferred. Co-load §1 above closes the cross/coimport CLASS
     ("bundled ⇒ on the nodeModules: leg"); this gate generalizes it to the ORIGINAL structural
     invariant the parent's §2 named: ANY local `*-*.js` a Foo.src.html inlines must be EITHER
     runtime-co-loaded in the suite (its global hangs off env, via the RESOLVE table) OR on the
     reason-stamped RUNTIME_EXEMPT allow-list (DOM shells/renderers/profile cards driven by the
     render-coverage rigs; the few irregular DOM/aux helpers, each named with the gate that DOES
     cover it). A bundled module that is NEITHER co-loaded NOR exempt is a RED — so a future aux
     module of ANY shape (a new suffix, a second non-suffixed helper, a *-fusion.js that grows a
     compute surface) cannot ship "bundled but never loaded/exercised in the suite" (the class that
     let cpapdex-cross.js slip). Same input both runners: env.srcHtml (the .src.html <script src>
     lists). Test-infra only — the resolver/exempt tables are the maintained surface; adding a
     module forces a deliberate classification, which is the point. */
  group('Co-load §1b — every bundled module is runtime-present-or-exempt', 'dex-coload · *.src.html · env', function (T) {
    var SRC = env.srcHtml || {};
    var srcNames = Object.keys(SRC);
    T.ok('app *.src.html sources available to the gate', srcNames.length > 0, srcNames.length ? srcNames.length + ' src.html' : 'wire env.srcHtml in BOTH runners');
    if (!srcNames.length) return;

    // ── CO-LOADED: file basename → the env global it MUST expose once runtime-co-loaded ──
    var RESOLVE = {
      // shared spine
      'clock.js': 'DexClock',
      'kernel-constants.js': 'DexKernel', 'metric-registry.js': 'MetricRegistry', 'dex-profile.js': 'DexProfile',
      'dex-export.js': 'DexExport', 'dex-ingest.js': 'DexIngest', 'dex-patient-gen.js': 'DexPatientGen',
      'quantity.js': 'Quantity', 'signal-frame.js': 'SignalFrame', 'crossnight-envelope.js': 'CrossNightEnvelope', 'synth-gen.js': 'SYNTH',
      // node DSPs (namespaced public surface)
      'oxydex-dsp.js': 'OxyDex', 'pulsedex-dsp.js': 'PulseDex', 'hrvdex-dsp.js': 'HRVDex', 'glucodex-dsp.js': 'GlucoDex',
      'ppgdex-dsp.js': 'PPGDSP', 'ecgdex-dsp.js': 'ECGDSP', 'cpapdex-dsp.js': 'CpapDsp',
      // cross/coimport (also on the nodeModules leg — Co-load §1/§2/§3)
      'oxydex-cross.js': 'OXYCross', 'pulsedex-cross.js': 'PulseCross', 'ppgdex-cross.js': 'PPGCross',
      'ecgdex-cross.js': 'ECGCross', 'cpapdex-cross.js': 'CPAPCross', 'cpapdex-coimport.js': 'CpapCoimport',
      // node compute aux that exposes a runtime surface
      'cpapdex-edf.js': 'CpapEdf', 'cpapdex-fusion.js': 'CpapFusion', 'ecgdex-morph.js': 'ECGMorph', 'ppgdex-morph.js': 'PPGMorph',
      'integrator-dsp.js': 'IntegratorDSP', 'integrator-tch.js': 'IntegratorTCH', 'integrator-longitudinal.js': 'IntegratorLong',
      // registries (grade source of truth)
      'oxydex-registry.js': 'OXY_REGISTRY', 'ecgdex-registry.js': 'ECG_REGISTRY', 'ppgdex-registry.js': 'PPG_REGISTRY',
      'cpapdex-registry.js': 'CPAP_REGISTRY', 'pulsedex-registry.js': 'PULSE_REGISTRY', 'hrvdex-registry.js': 'HRV_REGISTRY', 'glucodex-registry.js': 'GLU_REGISTRY'
    };
    // ── RUNTIME_EXEMPT (patterns): DOM classes driven end-to-end by the render-coverage rigs ──
    // (RESOLVE is consulted FIRST, so the shared dex-profile.js → DexProfile is co-loaded, NOT caught here.)
    var EXEMPT_PATTERNS = [
      [/-app\.js$/, 'DOM app shell — driven end-to-end by the render-coverage rig (boots the real bundle in an iframe)'],
      [/-render\.js$/, 'DOM renderer — render-coverage rig'],
      [/-profile\.js$/, 'DOM node profile card — render-coverage rig']
    ];
    // ── RUNTIME_EXEMPT (explicit): the irregular DOM/aux helpers, each named with its covering gate ──
    var EXEMPT_FILES = {
      'entrance-guard.js': 'DOM print/entrance guard (CSS injection, no compute surface) — exercised by the render-coverage bundle boot',
      'ganglior-provenance.js': 'runtime build-provenance helper — exercised by verify-provenance.html GATE A/B + the render-coverage boot',
      'oxydex-util.js': 'OxyDex.compute() math dependency (computeCeilingBaselineArr etc.) — exercised by the OxyDex equiv/compute gate (env.equiv.oxydex) + render-coverage',
      'oxydex-fusion.js': 'DOM OxyDex fusion card — render-coverage rig',
      'pulsedex-overview.js': 'DOM PulseDex overview — render-coverage rig',
      'hrvdex-chart.js': 'DOM HRVDex chart — render-coverage rig',
      'hrvdex-chartbadges.js': 'DOM HRVDex chart badges — render-coverage rig'
    };

    // sanity: a file must be in AT MOST ONE explicit table (the pattern/dex-profile overlap is by design — RESOLVE wins)
    var collide = Object.keys(RESOLVE).filter(function (f) { return EXEMPT_FILES[f]; });
    T.ok('RESOLVE and RUNTIME_EXEMPT(explicit) are disjoint', collide.length === 0, collide.join(', '));

    // derive the union of LOCAL modules every *.src.html inlines (basename-keyed; no CDN exists in source — AUDIT.md)
    var bundled = {};
    srcNames.forEach(function (name) {
      var html = SRC[name] || '';
      var re = /<script\s+[^>]*\bsrc=["']([^"']+\.js)["']/gi, m;
      while ((m = re.exec(html))) {
        var s = m[1]; if (/^https?:|^\/\//.test(s)) continue;
        bundled[s.replace(/^.*\//, '')] = true;
      }
    });
    var bundledList = Object.keys(bundled).sort();
    T.ok('found bundled modules to classify', bundledList.length > 0, bundledList.length + ' modules across ' + srcNames.length + ' bundles');

    function classify(f) {
      if (RESOLVE[f]) return { kind: 'co-loaded', global: RESOLVE[f] };
      if (EXEMPT_FILES[f]) return { kind: 'exempt', why: EXEMPT_FILES[f] };
      for (var i = 0; i < EXEMPT_PATTERNS.length; i++) if (EXEMPT_PATTERNS[i][0].test(f)) return { kind: 'exempt', why: EXEMPT_PATTERNS[i][1] };
      return { kind: 'unclassified' };
    }

    // (1) THE invariant — every bundled module is classified (co-loaded or exempt). An unclassified one is the RED.
    var unclassified = bundledList.filter(function (f) { return classify(f).kind === 'unclassified'; });
    T.ok('every bundled module is classified (co-loaded OR runtime-exempt)', unclassified.length === 0,
      unclassified.length ? 'UNCLASSIFIED (bundled but neither co-loaded nor exempt — co-load it + add to RESOLVE, or add to RUNTIME_EXEMPT with a reason): ' + unclassified.join(', ') : '');

    // (2) THE teeth — every co-loaded module's global is actually runtime-PRESENT in THIS realm (both runners).
    var missing = bundledList.filter(function (f) { var c = classify(f); return c.kind === 'co-loaded' && env[c.global] == null; });
    T.ok('every co-loaded module is runtime-present (env.<global> != null)', missing.length === 0,
      missing.length ? 'co-loaded but ABSENT in this realm: ' + missing.map(function (f) { return f + '→env.' + RESOLVE[f]; }).join(', ') : '');

    // (3) keep the tables honest — no RESOLVE / explicit-exempt entry names a module no app bundles (stale ⇒ silent rot)
    var stale = Object.keys(RESOLVE).concat(Object.keys(EXEMPT_FILES)).filter(function (f) { return !bundled[f]; });
    T.ok('no stale RESOLVE / RUNTIME_EXEMPT entry (every named file is bundled by some app)', stale.length === 0, stale.join(', '));

    // (4) summary counts (informational — makes a coverage shift visible at a glance)
    var co = bundledList.filter(function (f) { return classify(f).kind === 'co-loaded'; }).length;
    T.ok('coverage: ' + co + ' co-loaded + ' + (bundledList.length - co) + ' exempt = ' + bundledList.length + ' bundled', true);
  });

  /* ════ CROSS §1 — per-node crossNightBlock / _DEFS over a VARYING series ════
     CROSS-MODULE-RUNTIME-COVERAGE §1 (subsumes CPAPDEX-PHASE9-FOLLOWUPS-IV §1). Byte-identity
     (the P12 drift gate) + the existing crossNight known-answer group cover the SHARED math;
     this group drives each node's NON-identical surface at RUNTIME — its metric/_DEFS table (the
     get accessors + goodDirection) and per-node helpers — over a node-specific STRICTLY-MONOTONIC
     8-point series. At n=8 Mann–Kendall is significant (τ=1 > SIGNIF_TAU 0.15, p≈8e-4 < SIGNIF_P
     0.10), so trend labels are DETERMINISTIC: a rising good:up metric → 'improving', a rising
     good:down → 'declining'. For the 4 envelope nodes the killer assertion is
     CrossNightEnvelope.validate(block).ok — the actual ganglior.crossnight v1.0 contract; PpgDex
     emits the legacy raw shape (metrics[id] IS the crossNight result), asserted directly. A bug in
     a node's get field, an inverted goodDirection, or a broken per-node accessor/helper
     (nightOdi · compliancePct · the qtc/cvhr guards) now reds AT THE NODE, instead of being
     inferred from one engine + a source-byte check. */
  group('Cross §1 — per-node crossNightBlock + helpers (VARYING series)', 'ecgdex-cross · oxydex-cross · pulsedex-cross · ppgdex-cross · cpapdex-cross', function (T) {
    var CNE = env.CrossNightEnvelope;
    var rng = [0, 1, 2, 3, 4, 5, 6, 7];
    var day = function (i) { return U(2026, 4, 1 + i); };
    var ids = function (b) { return b && b.metrics ? Object.keys(b.metrics).sort() : []; };
    // contract conformance for an envelope node (the real gate); validate() lives in crossnight-envelope.js
    var ok = function (b) { return CNE && typeof CNE.validate === 'function' ? CNE.validate(b) : { ok: false, errors: ['CrossNightEnvelope.validate unavailable'] }; };
    // FOLLOWUPS-V §1/§2: every crossnight metric must self-describe its evidence tier so the Integrator
    // Longitudinal view (integrator-longitudinal.js evBadge) can BADGE the trend + Pearson-coupling
    // cards — an ungraded metric renders UNBADGED (COVERAGE-MANDATE). Asserted per node below; tiers
    // mirror each node's registry. Locks all 5 nodes (Oxy/CPAP already graded; Ecg/Ppg/Pulse newly).
    var everyEv = function (b) { return !!(b && b.metrics) && Object.keys(b.metrics).length > 0 && Object.keys(b.metrics).every(function (k) { return typeof b.metrics[k].evidence === 'string' && b.metrics[k].evidence.length > 0; }); };

    /* ── OxyDex (envelope; ids odi4·meanSpo2·t90·nsi·sleepEff·meanHr·pbIndex) ── */
    var OX = env.OXYCross;
    if (OX && typeof OX.crossNightBlock === 'function') {
      var oxN = rng.map(function (i) { return { stats: { startTs: day(i), meanSpo2: 90 + i, t90pct: 12 - i, meanHr: 60 + i, coverage: 90 }, odi4: { rate: 5 + i }, comp: { nsi: 2 + i }, motSleep: { sleepEff: 80 + i } }; });
      var oxB = OX.crossNightBlock(oxN);
      T.ok('OxyDex block conforms to ganglior.crossnight v1.0', ok(oxB).ok, JSON.stringify(ok(oxB).errors));
      T.eq('OxyDex block carries its OXY_DEFS ids', ids(oxB), ['meanHr', 'meanSpo2', 'nsi', 'odi4', 'pbIndex', 'sleepEff', 't90']);  // +pbIndex: PB oscillation episodes/hr (ENVELOPE-FOLLOWUPS-III §1)
      T.eq('OxyDex n flows through (8 nights)', oxB.metrics.meanSpo2.n, 8);
      T.eq('OxyDex meanSpo2 rising + good:up → improving', oxB.metrics.meanSpo2.trend.label, 'improving');
      T.eq('OxyDex odi4 rising + good:down → declining', oxB.metrics.odi4.trend.label, 'declining');
      T.eq('OXYCross.nightTms reads stats.startTs', OX.nightTms(oxN[0]), day(0));
      T.approx('OXYCross.nightWeight = coverage/100', OX.nightWeight(oxN[0]), 0.9, 1e-6);
      T.ok('OxyDex crossnight metrics all self-describe evidence (Longitudinal badge — COVERAGE-MANDATE)', everyEv(oxB));
      T.eq('OxyDex pbIndex evidence = experimental (registry)', oxB.metrics.pbIndex.evidence, 'experimental');
    } else T.ok('OXYCross.crossNightBlock present (oxydex-cross.js co-loaded)', false, 'co-load oxydex-cross.js + map env.OXYCross');

    /* ── PulseDex (envelope; ids rmssd·sdnn·lnRMSSD·hr·stress·hrvScore·dfaAlpha1·si) ── */
    var PU = env.PulseCross;
    if (PU && typeof PU.crossNightBlock === 'function') {
      var puL = rng.map(function (i) { return { t0Ms: day(i), coverage: 100, dispRm: 40 + i, dispSd: 55 + i, lnrmssd: 3 + i * 0.1, dispHr: 60 + i, stress: 30 - i, hrv: 50 + i, dfa1: 1 + i * 0.05, si: 100 - i * 2 }; });
      var puB = PU.crossNightBlock(puL);
      T.ok('PulseDex block conforms to ganglior.crossnight v1.0', ok(puB).ok, JSON.stringify(ok(puB).errors));
      T.eq('PulseDex block carries its METRICS ids', ids(puB), ['dfaAlpha1', 'hr', 'hrvScore', 'lnRMSSD', 'rmssd', 'sdnn', 'si', 'stress']);
      T.eq('PulseDex rmssd rising + good:up → improving', puB.metrics.rmssd.trend.label, 'improving');
      T.eq('PulseDex stress falling + good:down → improving', puB.metrics.stress.trend.label, 'improving');
      T.ok('PulseDex crossnight metrics all self-describe evidence (FOLLOWUPS-V §2)', everyEv(puB));
      T.eq('PulseDex si evidence = validated (registry)', puB.metrics.si.evidence, 'validated');
      T.eq('PulseDex stress evidence = experimental (registry)', puB.metrics.stress.evidence, 'experimental');
      T.eq('PulseDex dfaAlpha1 evidence = emerging (registry)', puB.metrics.dfaAlpha1.evidence, 'emerging');
      T.eq('PulseDex hr evidence = measured (registry)', puB.metrics.hr.evidence, 'measured');
    } else T.ok('PulseCross.crossNightBlock present (pulsedex-cross.js co-loaded)', false, 'co-load pulsedex-cross.js + map env.PulseCross');

    /* ── PpgDex (MIGRATED to the envelope — CROSS-MODULE-RUNTIME-COVERAGE-FOLLOWUPS §2; ids rmssd·sdnn·lnRMSSD·hr·pi·ai·motionRejected) ── */
    var PG = env.PPGCross;
    if (PG && typeof PG.crossNightBlock === 'function') {
      var pgL = rng.map(function (i) { return { t0Ms: day(i), analyzablePct: 90, rmssd: 40 + i, sdnn: 55 + i, lnRMSSD: 3 + i * 0.1, dispHr: 60 + i, perfusionIndex: 2 + i * 0.2, morph: { augmentationIndexPct: 15 + i }, motionRejectedPct: 5 + i }; });
      var pgB = PG.crossNightBlock(pgL);
      T.ok('PpgDex block conforms to ganglior.crossnight v1.0', ok(pgB).ok, JSON.stringify(ok(pgB).errors));
      T.eq('PpgDex block carries its PPG_DEFS ids', ids(pgB), ['ai', 'hr', 'lnRMSSD', 'motionRejected', 'pi', 'rmssd', 'sdnn']);
      T.eq('PpgDex n flows through (8)', pgB.metrics.rmssd.n, 8);
      T.eq('PpgDex rmssd rising + good:up → improving', pgB.metrics.rmssd.trend.label, 'improving');
      T.eq('PpgDex motionRejected rising + good:down → declining', pgB.metrics.motionRejected.trend.label, 'declining');
      T.ok('PpgDex crossnight metrics all self-describe evidence (FOLLOWUPS-V §1/§2 — map now forwards evidence+cite)', everyEv(pgB));
      T.eq('PpgDex rmssd evidence = validated (registry)', pgB.metrics.rmssd.evidence, 'validated');
      T.eq('PpgDex ai evidence = emerging (registry)', pgB.metrics.ai.evidence, 'emerging');
      T.eq('PpgDex hr evidence = measured (registry)', pgB.metrics.hr.evidence, 'measured');
    } else T.ok('PPGCross.crossNightBlock present (ppgdex-cross.js co-loaded)', false, 'co-load ppgdex-cross.js + map env.PPGCross');

    /* ── ECGDex (envelope; node-specific accessors: qtc valid-delin guard, cvhr longRec&&!ambulatory) ── */
    var EC = env.ECGCross;
    if (EC && typeof EC.crossNightBlock === 'function') {
      var ecL = rng.map(function (i) { return { t0Ms: day(i), analyzablePct: 95, dispRm: 40 + i, dispSd: 55 + i, lnrmssd: 3 + i * 0.1, dispHr: 60 + i, dfa1: 1 + i * 0.05, morph: { delin: { valid: true, qtcBazett: 400 + i } }, longRec: true, ambulatory: false, cvhr: { index: 5 + i }, dc: 7 + i }; });
      var ecB = EC.crossNightBlock(ecL);
      T.ok('ECGDex block conforms to ganglior.crossnight v1.0', ok(ecB).ok, JSON.stringify(ok(ecB).errors));
      T.eq('ECGDex block carries its METRICS ids', ids(ecB), ['cvhrIndex', 'decelCapacity', 'dfaAlpha1', 'hr', 'lnRMSSD', 'qtc', 'rmssd', 'sdnn']);
      T.eq('ECGDex qtc.get honors valid delineation (n=8)', ecB.metrics.qtc.n, 8);
      T.eq('ECGDex cvhrIndex.get honors longRec && !ambulatory (n=8)', ecB.metrics.cvhrIndex.n, 8);
      // ambulatory night → the node-specific cvhr guard nulls the value → that metric drops to n=0
      var ecBA = EC.crossNightBlock(ecL.map(function (n) { return Object.assign({}, n, { ambulatory: true }); }));
      T.eq('ECGDex cvhrIndex nulled when ambulatory (n=0)', ecBA.metrics.cvhrIndex.n, 0);
      T.ok('ECGDex crossnight metrics all self-describe evidence (FOLLOWUPS-V §2)', everyEv(ecB));
      T.eq('ECGDex rmssd evidence = validated (registry)', ecB.metrics.rmssd.evidence, 'validated');
      T.eq('ECGDex cvhrIndex evidence = emerging (registry)', ecB.metrics.cvhrIndex.evidence, 'emerging');
      T.eq('ECGDex hr evidence = measured (registry)', ecB.metrics.hr.evidence, 'measured');
    } else T.ok('ECGCross.crossNightBlock present (ecgdex-cross.js co-loaded)', false, 'co-load ecgdex-cross.js + map env.ECGCross');

    /* ── CPAPDex (envelope; nightOdi over sessions + compliancePct aggregate helper) ── */
    var CP = env.CPAPCross;
    if (CP && typeof CP.crossNightBlock === 'function') {
      var cpN = rng.map(function (i) { return { t0Ms: day(i), therapyHours: 5 + i * 0.2, metrics: { residualAHI: 8 - i * 0.5, usageHours: 5 + i * 0.2, largeLeakPct: 12 - i, centralIndex: 4 - i * 0.3 }, sessions: [{ oximetry: { available: true, odi: 6 - i * 0.4 } }] }; });
      var cpB = CP.crossNightBlock(cpN);
      T.ok('CPAPDex block conforms to ganglior.crossnight v1.0', ok(cpB).ok, JSON.stringify(ok(cpB).errors));
      T.eq('CPAPDex block carries its CPAP_DEFS ids', ids(cpB), ['centralIndex', 'largeLeakPct', 'odi', 'periodicBreathingPct', 'residualAHI', 'usageHours']);  // +periodicBreathingPct: device-scored CSL % (ENVELOPE-FOLLOWUPS-III §1)
      T.eq('CPAPDex usageHours rising + good:up → improving', cpB.metrics.usageHours.trend.label, 'improving');
      T.eq('CPAPDex residualAHI falling + good:down → improving', cpB.metrics.residualAHI.trend.label, 'improving');
      T.eq('CPAPCross.compliancePct — all nights ≥4 h → 100%', CP.compliancePct(cpN, 4), 100);
      T.approx('CPAPCross.nightOdi averages available oximeter sessions', CP.nightOdi(cpN[0]), 6, 1e-6);
      T.ok('CPAPDex crossnight metrics all self-describe evidence', everyEv(cpB));
      T.eq('CPAPDex periodicBreathingPct evidence = measured (registry)', cpB.metrics.periodicBreathingPct.evidence, 'measured');
    } else T.ok('CPAPCross.crossNightBlock present (cpapdex-cross.js co-loaded)', false, 'co-load cpapdex-cross.js + map env.CPAPCross');
  });

  /* ════ HRVDex recording block — startEpochMs earliest, spanDays ≥ 0 (VII §1) ════
     The headless compute({text}) path used to SKIP the commitRows sort the app applies,
     so on a newest-first Welltory CSV recording.startEpochMs was the LAST day and spanDays
     went NEGATIVE (-27) — violating the Clock Contract (§4/§6: startEpochMs = the EARLIEST
     valid sample). hrvBuildNodeExport now sorts ascending by tMs (ONE rule for both callers,
     closing the -VI §2 compute()-vs-app divergence for HRVDex). Assert the recording block
     obeys the contract on the committed CSV. */
  group('HRVDex recording block — startEpochMs earliest, spanDays ≥ 0 (VII §1)', 'hrvdex-dsp · clock-contract · equivalence', function (T) {
    var EQ = env.equiv || {};
    var HD = env.HRVDex;
    var nsOk = !!(HD && typeof HD.compute === 'function');
    T.ok('HRVDex namespace co-loaded (compute present)', nsOk, nsOk ? '' : 'load hrvdex-dsp.js into both runners');
    if (!nsOk) return;
    var haveInput = !!(EQ.hrvdex && EQ.hrvdex.input);
    if (!haveInput) { T.skip('HRVDex recording block (committed Welltory CSV)', 'committed input absent — uploads/ is gitignored (personal data); this leg runs locally with uploads/ present'); return; }
    var rec = (HD.compute({ text: EQ.hrvdex.input }) || {}).recording;
    T.ok('recording present', !!rec);
    if (!rec) return;
    T.eq('startEpochMs === firstTMs (earliest sample, not the file-order first row)', rec.startEpochMs, rec.firstTMs);
    T.ok('firstTMs <= lastTMs (ascending span, not reversed)', rec.firstTMs <= rec.lastTMs, rec.firstTMs + ' .. ' + rec.lastTMs);
    T.ok('spanDays >= 0 (was -27 before the sort fix)', rec.spanDays >= 0, 'spanDays=' + rec.spanDays);
  });

  /* ════ Frequency-domain HRV — spectral known-answer (WP-C audit) ════
     Validates the Lomb–Scargle pipeline directly on unevenly-sampled RR
     (the method both ECGDSP and PPGDSP use — no interpolation, so no
     resampling-rate dependence). Synthetic RR = 800 ms mean + a pure
     sinusoid at a known frequency; the recovered spectrum must put the
     power in the right Task-Force band and (ECG) report the right peak. */
  group('Frequency-domain HRV — spectral known-answer', 'WP-C', function (T) {
    var ECG = env.ECGDSP, PPG = env.PPGDSP;
    // Synth: pure tone at fTone Hz, optional linear drift (ms/beat). Returns
    // { nn:[ms], times:[s] } with beat times = cumulative RR. Deterministic.
    function synthRR(fTone, ampMs, N, driftPerBeat) {
      var nn = [], times = [], tSec = 0;
      for (var i = 0; i < N; i++) {
        var rr = 800 + (driftPerBeat ? driftPerBeat * i : 0) + (ampMs ? ampMs * Math.sin(2 * Math.PI * fTone * tSec) : 0);
        nn.push(rr); times.push(tSec); tSec += rr / 1000;
      }
      return { nn: nn, times: times };
    }
    var hfTone = synthRR(0.25, 40, 300, 0);   // respiratory band → 15 br/min
    var lfTone = synthRR(0.10, 40, 300, 0);    // Mayer-wave band
    var ramp   = synthRR(0, 0, 300, 2);        // pure linear drift, no tone

    T.ok('ECGDSP.lombScargle exposed', ECG && typeof ECG.lombScargle === 'function');
    T.ok('PPGDSP.lombScargle exposed', PPG && typeof PPG.lombScargle === 'function');

    if (ECG && typeof ECG.lombScargle === 'function') {
      var eHF = ECG.lombScargle(hfTone.nn, hfTone.times) || {};
      var eLF = ECG.lombScargle(lfTone.nn, lfTone.times) || {};
      var eRamp = ECG.lombScargle(ramp.nn, ramp.times) || {};
      T.ok('ECG: 0.25 Hz tone → HF dominates LF', eHF.hf > eHF.lf, 'hf=' + eHF.hf + ' lf=' + eHF.lf);
      T.ok('ECG: 0.25 Hz tone → HF dominates VLF', eHF.hf > eHF.vlf, 'hf=' + eHF.hf + ' vlf=' + eHF.vlf);
      T.approx('ECG: HF peak → respRate ≈ 15 br/min', eHF.respRate, 15, 1.5, 'respRate=' + eHF.respRate);
      T.ok('ECG: 0.10 Hz tone → LF dominates HF', eLF.lf > eLF.hf, 'lf=' + eLF.lf + ' hf=' + eLF.hf);
      // linear detrend (Task Force) removes a pure ramp → near-zero total power
      T.ok('ECG: pure linear drift suppressed by detrend (tp ≪ tone tp)', eRamp.tp < eHF.tp * 0.2, 'ramp tp=' + eRamp.tp + ' vs tone tp=' + eHF.tp);
    }
    if (PPG && typeof PPG.lombScargle === 'function') {
      var pHF = PPG.lombScargle(hfTone.times, hfTone.nn) || {};   // PPG arg order: (times, nn)
      var pLF = PPG.lombScargle(lfTone.times, lfTone.nn) || {};
      T.ok('PPG: 0.25 Hz tone → HF dominates LF', pHF.hf > pHF.lf, 'hf=' + pHF.hf + ' lf=' + pHF.lf);
      T.ok('PPG: 0.25 Hz tone → HF dominates VLF', pHF.hf > pHF.vlf, 'hf=' + pHF.hf + ' vlf=' + pHF.vlf);
      T.ok('PPG: 0.10 Hz tone → LF dominates HF', pLF.lf > pLF.hf, 'lf=' + pLF.lf + ' hf=' + pLF.hf);
      T.ok('PPG: LF:HF ratio > 1 for LF tone', pLF.lfhf != null && pLF.lfhf > 1, 'lfhf=' + pLF.lfhf);
    }
    // Cross-engine agreement: both call the 0.25 Hz tone HF-dominant.
    if (ECG && PPG && typeof ECG.lombScargle === 'function' && typeof PPG.lombScargle === 'function') {
      var a = ECG.lombScargle(hfTone.nn, hfTone.times) || {};
      var b = PPG.lombScargle(hfTone.times, hfTone.nn) || {};
      T.ok('ECG and PPG agree the 0.25 Hz tone is HF-dominant', (a.hf > a.lf) && (b.hf > b.lf));
    }
  });

  /* ════ PulseDex spectral honesty — crude spectral() proxy row + borrowed grade removed (DEEP-AUDIT-FIXES §1) ════
     The 2026-06-30 deep-audit found PulseDex surfaced "VLF (night)"/"Total Pwr (night)" from the crude
     spectral() rmssd²-proxy (4–11× the real Lomb–Scargle VLF on the same file) UNDER a borrowed
     `validated` Task-Force grade (via the '… (night)' registry aliases → the validated tp/vlf entries).
     §1 dropped the two rows + the proxy fn + the aliases. This gate locks it: the proxy is gone from
     source, the app no longer emits vlfNight/tpNight, and no '(night)' label can resolve onto a graded
     registry entry — while the REAL Lomb–Scargle rows keep their validated grade. Closes SIGNAL-ADAPTER §622. */
  group('PulseDex spectral honesty — proxy row + borrowed grade removed', 'pulsedex-dsp · pulsedex-app · pulsedex-registry', function (T) {
    var reg = env.PulseRegistry, R = env.PULSE_REGISTRY || (reg && reg.REGISTRY), A = reg && reg.ALIAS;
    // (1) resolver: the two '(night)' labels must NOT resolve (so they cannot borrow any grade)
    if (reg && typeof reg.idForLabel === 'function') {
      T.eq("'vlf (night)' resolves to nothing (alias removed)", reg.idForLabel('vlf (night)'), null);
      T.eq("'total pwr (night)' resolves to nothing (alias removed)", reg.idForLabel('total pwr (night)'), null);
      // the REAL Lomb–Scargle rows still resolve to their validated entries (didn't over-correct)
      T.eq("'vlf power' still resolves to vlf", reg.idForLabel('vlf power'), 'vlf');
      T.eq("'total power' still resolves to tp", reg.idForLabel('total power'), 'tp');
    } else T.ok('env.PulseRegistry.idForLabel available', false, 'wire env.PulseRegistry into both runners');
    // (2) no alias key mentions '(night)' at all
    if (A) T.ok('no PulseDex alias key contains "(night)"', !Object.keys(A).some(function (k) { return /\(night\)/.test(k); }),
      Object.keys(A).filter(function (k) { return /\(night\)/.test(k); }).join(','));
    // (3) the surviving vlf/tp entries keep their validated grade (guards an over-correction)
    if (R) {
      T.eq('vlf still graded validated', R.vlf && R.vlf.evidence, 'validated');
      T.eq('tp still graded validated', R.tp && R.tp.evidence, 'validated');
    }
    // (4) source-mirror: the crude spectral() proxy is GONE (definition + bare-global re-export item)
    var dsp = (env.sources || {})['pulsedex-dsp.js'];
    if (dsp) {
      T.ok('spectral() function removed from pulsedex-dsp.js', !/function\s+spectral\s*\(/.test(dsp));
      T.ok('spectral no longer in the bare-global re-export list', !/\bspectral\s*,/.test(dsp));
    } else T.ok('pulsedex-dsp.js source available (env.sources)', false, 'in SOURCE_FILES for both runners');
    // (5) source-mirror: the app no longer computes the proxy split or emits its two fields
    var app = (env.sources || {})['pulsedex-app.js'];
    if (app) {
      T.ok('pulsedex-app no longer computes the crude proxy split (spNight gone)', !/\bspNight\b/.test(app));
      T.ok('pulsedex-app no longer emits vlfNight/tpNight fields', !/\bvlfNight\b/.test(app) && !/\btpNight\b/.test(app));
    } else T.ok('pulsedex-app.js source available (env.sources)', false, 'in SOURCE_FILES for both runners');
  });

  /* ════ OxyDex ODI-4 severe-night undercount caveat — carried ON the metric (SIGNAL-ADAPTER §622 item 4) ════
     A known underestimate on severe disease can't live only in a paper. The caveat now travels with the
     ODI-4 number via its registry cite (surfaced on the evidence-badge tooltip that sits on every ODI-4
     card) + a visible callout on the OxyDex reference guide's ODI card. This locks the cite so it can't
     silently revert; the GRADE stays validated (the metric IS validated — the caveat is about severe-night
     magnitude, not the method's standing). */
  group('OxyDex ODI-4 severe-night undercount caveat on the metric (SIGNAL-ADAPTER §622)', 'oxydex-registry', function (T) {
    var R = env.OXY_REGISTRY;
    if (R && R.odi4) {
      T.ok('odi4 still graded validated (caveat is about severe-night magnitude, not method standing)', R.odi4.evidence === 'validated', R.odi4.evidence);
      T.ok('odi4 cite carries the severe-night undercount caveat (not paper-only)', /under-count/i.test(R.odi4.cite || ''), (R.odi4.cite || '').slice(0, 70));
      T.ok('odi4 cite states the residual truth-AHI ≈ 1.4× relation', /1\.4\s*[×x]/.test(R.odi4.cite || ''), (R.odi4.cite || '').slice(-40));
    } else T.ok('env.OXY_REGISTRY.odi4 available', false, 'wire env.OXY_REGISTRY into both runners');
  });

  /* ════ GlucoDex mmol/L display toggle — display-only, compute stays mg/dL (DEEP-AUDIT-FIXES §3) ════
     Option A of DEEP-AUDIT-FINDINGS Finding 3: a read-only mg/dL⇄mmol/L switch. The INVARIANT this
     locks: ONLY the render boundary converts — storage/compute/export stay mg/dL — and the mmol band
     edges use the STANDARDIZED consensus cutoffs (3.0/3.9/10.0/13.9), NOT naive ÷18.018 of the mg/dL
     label. Source-mirror (glucodex-render/-app/-dsp are in both runners' source lists). */
  group('GlucoDex mmol/L display toggle — boundary-only, mg/dL default', 'glucodex-render · glucodex-app · glucodex-dsp', function (T) {
    var src = env.sources || {};
    var rnd = src['glucodex-render.js'], app = src['glucodex-app.js'], dsp = src['glucodex-dsp.js'];
    T.ok('glucodex-render.js source available (env.sources)', !!rnd, 'in SOURCE_FILES for both runners');
    if (rnd) {
      T.ok('GluDisp display-unit helper defined', rnd.indexOf('const GluDisp') >= 0);
      T.ok('exposed as window.GluDisp for app/profile', rnd.indexOf('global.GluDisp = GluDisp') >= 0);
      T.ok("default unit is mg/dL (mmol only when stored === 'mmol')", rnd.indexOf("_gluDispUnit = 'mgdl'") >= 0 && rnd.indexOf('glucodex_dispUnit') >= 0);
      // STANDARDIZED consensus mmol cutoffs — NOT naive ÷18.018 of the mg/dL band edges
      T.ok('mmol band edge 54 → 3.0 (consensus)', rnd.indexOf("54:'3.0'") >= 0);
      T.ok('mmol band edge 70 → 3.9 (consensus)', rnd.indexOf("70:'3.9'") >= 0);
      T.ok('mmol band edge 180 → 10.0 (consensus)', rnd.indexOf("180:'10.0'") >= 0);
      T.ok('mmol band edge 250 → 13.9 (consensus)', rnd.indexOf("250:'13.9'") >= 0);
      T.ok('boundary conversion factor is 18.018', rnd.indexOf('_GLU_MMOL = 18.018') >= 0);
      T.ok('TIR legend routes through GluDisp.label()', rnd.indexOf('${s.sub} ${GluDisp.label()}') >= 0);
    }
    if (app) {
      T.ok('KPI mean routes through GluDisp.val()', app.indexOf('window.GluDisp.val(r.mean)') >= 0);
      T.ok('topbar mg/dL⇄mmol/L toggle wired (sets unit + re-renders)', app.indexOf('gluUnitToggle') >= 0 && app.indexOf('window.GluDisp.set(') >= 0 && app.indexOf('renderAll(RESULT)') >= 0);
    }
    // the CRITICAL invariant: compute/export are UNTOUCHED — no display-unit logic leaked into the DSP
    if (dsp) {
      T.ok('compute (glucodex-dsp.js) carries NO display-unit toggle — mg/dL is canonical there', dsp.indexOf('GluDisp') < 0 && dsp.indexOf('_gluDispUnit') < 0 && dsp.indexOf('glucodex_dispUnit') < 0);
      T.ok('internal storage/normalisation still mg/dL (MGDL_PER_MMOL = 18.018)', dsp.indexOf('MGDL_PER_MMOL = 18.018') >= 0);
    }
  });

  /* ════ Beat artifact / ectopy rejection — known-answer (WP-D audit) ════
     Drives the canonical NN cleaner (ECGDSP.buildNN — SQI gate + physiological
     range + Malik 20% local-median ectopy rule) with a clean 1000 ms RR series
     into which three known defects are injected, and asserts each is corrected,
     that an ectopic beat (clean QRS, in-range, >20% off median) is counted
     SEPARATELY from range/SQI rejects, and that the quality rates are reported. */
  group('Beat artifact / ectopy rejection — known-answer', 'WP-D', function (T) {
    var ECG = env.ECGDSP;
    T.ok('ECGDSP.buildNN exposed', ECG && typeof ECG.buildNN === 'function');
    if (!ECG || typeof ECG.buildNN !== 'function') return;
    var N = 60, rr = [], times = [], sqi = [], tSec = 0;
    for (var i = 0; i < N; i++) { rr.push(1000); sqi.push(0.9); times.push(tSec); tSec += 1.0; }
    rr[20] = 1400;  // +40% off local median, clean QRS, in range → ECTOPIC (Malik)
    rr[30] = 250;   // < 300 ms → physiologically implausible (range-bad)
    sqi[40] = 0.1;  // < 0.30 SQI → low signal quality (sqi-bad)
    var r = ECG.buildNN(times, rr, sqi);
    T.ok('ectopic beat (>20% local dev) corrected', r.corrected[20] === 1);
    T.ok('out-of-range beat (<300 ms) corrected', r.corrected[30] === 1);
    T.ok('low-SQI beat corrected', r.corrected[40] === 1);
    T.ok('clean beat left untouched', r.corrected[10] === 0);
    T.ok('ectopy counted separately from range/SQI rejects', r.nEctopyCorrected >= 1 && r.nEctopyCorrected < r.nCorrected);
    T.ok('≥3 total corrections', r.nCorrected >= 3);
    T.approx('ectopic beat replaced by local median (~1000)', r.nn[20], 1000, 5);
    T.ok('correctionRate reported as %', typeof r.correctionRate === 'number' && r.correctionRate > 0);
    T.ok('coverage + analyzable fractions reported', typeof r.analyzablePct === 'number' && typeof r.coveragePct === 'number');
  });

  /* ════ Optical beat detector — known-answer (WP-D2) ════
     The PPG optical path (autocorrelation-primed peak detector → intersecting-
     tangent feet → PPI → Malik-style correction) is the noisiest, least-validated
     estimator in the suite and had NO known-answer test for peak placement.
     This plants a clean pulse waveform at a KNOWN rate and asserts (a) detectBeats
     recovers the beat COUNT ± tolerance and a median PPI ≈ the planted period, then
     (b) correctRR repairs an injected ectopic + an out-of-range PPI and reports nCorr. */
  group('Optical beat detector — known-answer', 'WP-D2', function (T) {
    var PPG = env.PPGDSP;
    T.ok('PPGDSP.detectBeats exposed', PPG && typeof PPG.detectBeats === 'function');
    T.ok('PPGDSP.buildPPI exposed', PPG && typeof PPG.buildPPI === 'function');
    T.ok('PPGDSP.correctRR exposed', PPG && typeof PPG.correctRR === 'function');
    if (!PPG || typeof PPG.detectBeats !== 'function') return;

    // ── (a) plant a clean pulse waveform: fs=50 Hz, 60 bpm (1.0 s period), 30 s ──
    var fs = 50, bpm = 60, period = 60 / bpm, dur = 30;
    var n = Math.round(fs * dur), bp = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var ph = 2 * Math.PI * (i / fs) / period;           // one cycle per beat
      // asymmetric pulse: fast systolic upstroke + slow diastolic decay (realistic foot/peak)
      var s = Math.sin(ph);
      bp[i] = s + 0.30 * Math.sin(2 * ph) + 1.0;          // skew + DC offset (detector de-means)
    }
    var det = PPG.detectBeats(bp, fs);
    var expBeats = dur / period;                            // 30
    T.ok('detectBeats returns peaks + feet arrays',
      det && Array.isArray(det.peaks) && Array.isArray(det.feet));
    T.approx('recovered beat count ≈ planted (30 ± 3)', det.peaks.length, expBeats, 3,
      'got ' + (det && det.peaks ? det.peaks.length : '?'));

    // median PPI from the detected feet (seconds → ms)
    var footSec = det.feet.map(function (f) { return f / fs; });
    var ppi = PPG.buildPPI(footSec);
    T.ok('buildPPI returns rr + tt', ppi && Array.isArray(ppi.rr) && Array.isArray(ppi.tt));
    var med = ppi.rr.length ? PPG.median(ppi.rr) : null;
    T.approx('median PPI ≈ planted period (1000 ± 60 ms)', med, 1000, 60, 'med=' + med);

    // ── (b) Malik-style PPI correction: inject an ectopic + an out-of-range beat ──
    var M = 40, rr = [], tt = [], t = 1.0;
    for (var k = 0; k < M; k++) { rr.push(1000); tt.push(t); t += 1.0; }
    rr[15] = 1500;   // +50% off local median (> PPI_ECTOPY_THR 0.30) → ectopic
    rr[25] = 200;    // < 300 ms → physiologically out of range
    var c = PPG.correctRR(rr, tt);
    T.ok('correctRR returns nn + flags + nCorr', c && Array.isArray(c.nn) && Array.isArray(c.flags) && typeof c.nCorr === 'number');
    T.ok('ectopic PPI (>30% dev) flagged + corrected', c.flags[15] === 1);
    T.ok('out-of-range PPI (<300 ms) flagged + corrected', c.flags[25] === 1);
    T.ok('clean PPI left unflagged', c.flags[5] === 0);
    T.ok('≥2 corrections counted', c.nCorr >= 2);
    T.approx('ectopic PPI replaced by local median (~1000)', c.nn[15], 1000, 5, 'nn15=' + c.nn[15]);
  });

  /* ════ PpgDex detector — robust to a supra-physiologic transient (FU §3) ════
     PPGDEX-BEAT-DETECTION-PERF-FOLLOWUPS §3 — VALIDATES the deliberate deviation from
     Elgendi's clipped-amplitude-square feature: the real Polar-Sense channel carries a
     supra-physiologic baseline transient (observed bp max ≈227k vs sd ≈5k, ~45×), which
     collapsed the amplitude feature to ~10 beats/6.5 min. The shipped POSITIVE-SLOPE energy
     feature + LOCAL (MA_beat) threshold must confine a transient's effect to its own
     neighbourhood, NOT suppress the whole record. */
  group('PpgDex detector — supra-physiologic transient does not collapse detection (FU §3)', 'ppgdex-dsp · FU', function (T) {
    var PPG = env.PPGDSP;
    if (!PPG || typeof PPG.detectBeats !== 'function') { T.ok('PPGDSP.detectBeats exposed', false); return; }
    var fs = 50, period = 1.0, dur = 30, n = Math.round(fs * dur), bp = new Float32Array(n);
    for (var i = 0; i < n; i++) { var ph = 2 * Math.PI * (i / fs) / period; bp[i] = Math.sin(ph) + 0.30 * Math.sin(2 * ph) + 1.0; }
    var clean = PPG.detectBeats(bp, fs).peaks.length;
    var bad = Float32Array.from(bp); bad[Math.round(10 * fs)] += 45;   // ~45× the ~1-amplitude pulse (mirrors the real 227k spike)
    var withSpike = PPG.detectBeats(bad, fs).peaks.length;
    T.approx('clean 60 bpm train recovers ~30 beats', clean, 30, 3, 'got ' + clean);
    T.ok('one 45× transient does NOT collapse detection (slope-energy + LOCAL threshold — FU §3 decision validated)',
      withSpike >= clean - 3, 'clean=' + clean + ' withSpike=' + withSpike);
  });

  /* ════ PpgDex detector — tracks an abrupt HR step (no global period; FU §4) ════
     The OLD detector estimated ONE scalar period for the whole record (autocorrelation),
     so a drifting/stepping HR dropped beats. The shipped O(N) TERMA threshold is LOCAL, so
     it must recover BOTH sides of a 60→100 bpm step. Guards the period-stationarity edge
     case the follow-up flagged. */
  group('PpgDex detector — abrupt HR step recovered (local threshold; FU §4)', 'ppgdex-dsp · FU', function (T) {
    var PPG = env.PPGDSP;
    if (!PPG || typeof PPG.detectBeats !== 'function') { T.ok('PPGDSP.detectBeats exposed', false); return; }
    var fs = 50, dur1 = 20, dur2 = 20, n = Math.round(fs * (dur1 + dur2)), bp = new Float32Array(n), phase = 0;
    for (var i = 0; i < n; i++) {
      var tsec = i / fs, per = tsec < dur1 ? 1.0 : 0.6;   // 60 → 100 bpm, continuous phase (no discontinuity)
      phase += (2 * Math.PI) / (per * fs);
      bp[i] = Math.sin(phase) + 0.30 * Math.sin(2 * phase) + 1.0;
    }
    var got = PPG.detectBeats(bp, fs).peaks.length;
    var expect = dur1 / 1.0 + dur2 / 0.6;                  // 20 + 33.3 ≈ 53
    T.approx('recovers beats across a 60→100 bpm step (no global period)', got, expect, 6, 'got ' + got + ' expect ~' + Math.round(expect));
  });

  /* ════ PpgDex long-record coverage — overnight tier, no silent collapse (FU §1) ════
     PPGDEX-BEAT-DETECTION-PERF-FOLLOWUPS §1 — the equiv fixtures are all short clips, so no
     ≥90-min PPG was exercised in-gate (the same blind spot ECGDex closed with its 3 h synthetic
     long-record group). Build a 91-min multi-channel pulse train DIRECTLY (typed arrays — no
     53 MB text round-trip), run the REAL analyze() and assert the detector SCALES with duration
     (no stall/collapse), unlocks the overnight tier, populates per-5-min epochs, and that the §3
     coverage-gate flag + §5 LED agreement are computed on a long record. */
  group('PpgDex long-record coverage — no silent collapse on a 91-min record (FU §1)', 'ppgdex-dsp · FU', function (T) {
    var PPG = env.PPGDSP;
    if (!(PPG && typeof PPG.analyze === 'function')) { T.ok('PPGDSP.analyze exposed', false); return; }
    var fs = 176, durMin = 91, n = Math.round(fs * durMin * 60);
    var relSec = new Float64Array(n), ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], phase = 0;
    for (var i = 0; i < n; i++) {
      var tsec = i / fs; relSec[i] = tsec;
      var per = 60 / (55 + 6 * Math.sin(tsec / 1200));    // slow HR drift ~49–61 bpm (exercises the local threshold)
      phase += (2 * Math.PI) / (per * fs);
      var pulse = Math.sin(phase) + 0.30 * Math.sin(2 * phase);
      var art = (tsec > 3000 && tsec < 3060) ? 900 : 0;   // a 1-min motion-artifact span
      for (var c = 0; c < 3; c++) ch[c][i] = -500000 + 4000 * pulse + 300 * Math.sin(i * 1.3 + c * 2) + art * Math.sin(i * 0.7 + c);
    }
    var rec = { ch: ch, amb: null, relSec: relSec, fs: fs, n: n, t0Ms: Date.UTC(2026, 5, 21, 23, 0, 0), offsetMin: null, durSec: (n - 1) / fs, acc: null, gyro: null, magn: null, devicePPI: null, markers: null };
    var r = PPG.analyze(rec, null);
    T.ok('analyzed a ≥90-min record', r.durMin >= 90, 'durMin=' + r.durMin);
    T.eq('tier unlocks to overnight (≥90 min)', r.tier, 'overnight');
    // NO silent collapse: at any plausible HR the beat count must be a large fraction of duration×HR,
    // NOT a handful (the pre-fix stall collapsed a 7 h night to ~1 min of beats).
    var floorBeats = r.durMin * 35;                        // ≥35 bpm floor over the whole night
    T.ok('beat count scales with duration (no stall/collapse)', r.nPulses >= floorBeats, 'nPulses=' + r.nPulses + ' floor=' + Math.round(floorBeats));
    T.ok('per-5-min epochs populated across the night', r.epochs.length >= 15, 'epochs=' + r.epochs.length);
    T.ok('§3 coverage-gate flag present as a boolean + whole-record HRV computed', typeof r.hrvLowConfidence === 'boolean' && r.rmssd != null, 'lowConf=' + r.hrvLowConfidence + ' rmssd=' + r.rmssd);
    T.ok('§5 3-LED agreement in [0,100] on the long record', r.ledAgreementPct != null && r.ledAgreementPct >= 0 && r.ledAgreementPct <= 100, 'led=' + r.ledAgreementPct);
  });

  /* ════ Clock Contract — parseTimestamp per-node conformance (WP-G) ════
     A5 (owner-ratified 2026-07-03): the canonical parser is SINGLE-SOURCED in clock.js
     (DexClock); five nodes delegate, three keep deliberate node-local variants (ppgdex/
     glucodex/cpapdex). This group pins ONE shared truth table and runs it against every
     reachable live copy (canonical + variants must agree on the shared ISO/epoch core),
     then asserts every SOURCE is structurally faithful — delegation for the five,
     Date.UTC + explicit miss path for the variants. */
  group('Clock Contract — parseTimestamp per-node conformance', 'WP-G', function (T) {
    var U = function (y, mo, d, h, mi, s, ms) { return Date.UTC(y, mo, d, h || 0, mi || 0, s || 0, ms || 0); };
    // ONE shared truth table — the ISO forms every copy MUST handle (Clock Contract §2 steps 2–3).
    var TABLE = [
      { raw: '2026-06-07T22:00:00.123',       tMs: U(2026, 5, 7, 22, 0, 0, 123), off: null },
      { raw: '2026-06-07T22:00:00.500+02:00', tMs: U(2026, 5, 7, 22, 0, 0, 500), off: 120 },
      { raw: '2026-06-07T22:00:00Z',          tMs: U(2026, 5, 7, 22, 0, 0),      off: 0 },
      { raw: '2026-06-07 22:00:00',           tMs: U(2026, 5, 7, 22, 0, 0),      off: null },
      { raw: 'not a date',                    tMs: null, miss: true }
    ];
    function checkLive(name, fn) {
      T.ok(name + ' present', typeof fn === 'function');
      if (typeof fn !== 'function') return;
      TABLE.forEach(function (row) {
        var r = fn(row.raw, {});
        if (row.miss) { T.ok(name + ': "' + row.raw + '" → null/NaN (never now())', r == null || (typeof r === 'number' && isNaN(r))); return; }
        var tMs = (r == null) ? null : (typeof r === 'number' ? r : r.tMs);   // glucodex-style copies return tMs directly
        T.eq(name + ': ' + row.raw + ' → tMs', tMs, row.tMs);
        if (r && typeof r === 'object' && 'offsetMin' in r) T.eq(name + ': ' + row.raw + ' → offsetMin', r.offsetMin, row.off);
      });
    }
    checkLive('env.parseTimestamp', env.parseTimestamp);
    if (env.PPGDSP) checkLive('PPGDSP.parseTimestamp', env.PPGDSP.parseTimestamp);
    if (env.ECGDSP) checkLive('ECGDSP.parseTimestamp', env.ECGDSP.parseTimestamp);
    // env.parseTimestamp and PPGDSP.parseTimestamp must agree beat-for-beat on the table.
    if (typeof env.parseTimestamp === 'function' && env.PPGDSP && typeof env.PPGDSP.parseTimestamp === 'function') {
      var agree = TABLE.every(function (row) {
        var a = env.parseTimestamp(row.raw, {}), b = env.PPGDSP.parseTimestamp(row.raw, {});
        var ta = a == null ? null : (typeof a === 'number' ? a : a.tMs);
        var tb = b == null ? null : (typeof b === 'number' ? b : b.tMs);
        return ta === tb;
      });
      T.ok('two live copies agree on the whole truth table', agree);
    }
    // Static: per-node SOURCE conformance. A5 (owner-ratified 2026-07-03): the canonical parser is
    // single-sourced in clock.js/DexClock — oxydex/pulsedex/hrvdex/integrator/ecgdex DELEGATE via local
    // aliases; ppgdex (strict subset + quote-strip), glucodex (_ckParse + MDY numeric wrapper) and
    // cpapdex (EDF subset) keep DELIBERATE node-local variants. Structure asserted per family:
    var src = env.sources || {};
    var DELEGATORS = ['pulsedex-dsp.js', 'oxydex-dsp.js', 'hrvdex-dsp.js', 'integrator-dsp.js', 'ecgdex-dsp.js'];
    var LOCALS = ['ppgdex-dsp.js', 'glucodex-dsp.js', 'cpapdex-dsp.js'];
    var ck = src['clock.js'];
    if (ck == null) { T.ok('clock.js source available', false, 'not in env.sources'); }
    else {
      T.ok('clock.js: defines THE canonical parseTimestamp', /function parseTimestamp/.test(ck));
      T.ok('clock.js: uses Date.UTC (floating wall-clock)', /Date\.UTC/.test(ck));
      T.ok('clock.js: has explicit null miss path', /return\s+null/.test(ck));
      T.ok('clock.js: exposes DexClock', /root\.DexClock\s*=/.test(ck));
    }
    DELEGATORS.forEach(function (f) {
      var s = src[f];
      if (s == null) { T.ok(f + ' source available', false, 'not in env.sources'); return; }
      T.ok(f + ': delegates parseTimestamp to DexClock (no local mirror)',
        /parseTimestamp\s*=\s*DexClock\.parseTimestamp/.test(s) && !/function parseTimestamp/.test(s));
      T.ok(f + ': no residual local tzOffset definition', !/function tzOffset/.test(s));
    });
    LOCALS.forEach(function (f) {
      var s = src[f];
      if (s == null) { T.ok(f + ' source available', false, 'not in env.sources'); return; }
      T.ok(f + ': defines its node-local variant', /function parseTimestamp/.test(s));
      T.ok(f + ': uses Date.UTC (floating wall-clock)', /Date\.UTC/.test(s));
      T.ok(f + ': has explicit null/NaN miss path', /return\s+null|return\s+NaN|:\s*NaN/.test(s));
    });
  });

  /* ════ 18 · HRVDex ADDITIVE INGEST — merge/dedup/ECGDex-map (FOLLOWUP P3/P4) ════
     The additive-merge, dedup-identity and ECGDex `ganglior.node-export` → HRVDex-row
     mapping shipped verified-live but assertion-free. These are public contracts a
     future edit could silently break (re-import idempotency, distinct-session survival,
     SI-input coverage). Source-mirror group (these fns are page-scope, not headless-
     loadable like parseTimestamp) — runs in BOTH runners off env.sources. */
  group('HRVDex additive ingest — merge/dedup/ECGDex-map (P3/P4)', 'hrvdex-dsp · ecgdex-app', function (T) {
    var s = (env.sources || {})['hrvdex-dsp.js'];
    if (s == null) { T.ok('hrvdex-dsp.js source available', false, 'not in env.sources'); return; }

    // ── _hrvSig: dedup identity = floating tMs + the core metric tuple ──
    T.ok('_hrvSig defined', /function _hrvSig/.test(s));
    T.ok('_hrvSig keys on the floating tMs (Math.round(r._tMs))', /Math\.round\(r\._tMs\)/.test(s));
    T.ok('_hrvSig includes the core metric tuple (rmssd+sdnn+meanRR)',
      /_hrvNum\(r\._rmssd\)/.test(s) && /_hrvNum\(r\._sdnn\)/.test(s) && /_hrvNum\(r\._meanRR\)/.test(s));
    T.ok("_hrvSig is a joined signature ('|')", /\.join\('\|'\)/.test(s));

    // ── commitRows: additive by default, wipe on replace, dedup, sort, persist ──
    T.ok('commitRows defined', /function commitRows/.test(s));
    T.ok('commitRows wipes first only on {replace}', /if\(opts\.replace\)\s*allRows\s*=\s*\[\]/.test(s));
    T.ok('commitRows dedups against existing rows by _hrvSig', /new Set\(allRows\.map\(_hrvSig\)\)/.test(s) && /seen\.has\(sig\)/.test(s));
    T.ok('commitRows sorts the merged table by floating tMs', /allRows\.sort\(\(a,\s*b\)\s*=>\s*a\._tMs\s*-\s*b\._tMs\)/.test(s));
    T.ok('commitRows mirrors to localStorage (persistHRVRows)', /persistHRVRows\(\)/.test(s));

    // ── _envToSeed: ECGDex ganglior.node-export → HRVDex row ──
    T.ok('_envToSeed defined', /function _envToSeed/.test(s));
    T.ok('_envToSeed reconstructs tMs from recording.startEpochMs', /rec\.startEpochMs/.test(s));
    T.ok('_envToSeed returns null (honest-null) when the start clock is missing', /if\(!isFinite\(tMs\)\)\s*return null/.test(s));
    T.ok('_envToSeed prefers whole-record SDNN/RMSSD (cross-node comparability)',
      /wholeRecordRMSSD/.test(s) && /wholeRecordSDNN/.test(s));
    // P4: the Baevsky-SI geometric inputs are now read from the envelope (were hardcoded 0)
    T.ok('_envToSeed reads amo50/mode/mxDMn from hrv.time (P4)',
      /n\(tm\.amo50\)/.test(s) && /n\(tm\.mode\)/.test(s) && /n\(tm\.mxDMn\)/.test(s));
    T.ok('_envToSeed no longer hardcodes the SI inputs to 0 (P4 regression guard)',
      !/_amo50:\s*0\b/.test(s) && !/_mode:\s*0\b/.test(s) && !/_mxdmn:\s*0\b/.test(s));

    // ── P5.2: persistence quota failures are visible, not silently swallowed ──
    T.ok('persistHRVRows surfaces a status when storage is full (P5.2)', /capped to the most recent/.test(s));

    // ── P4 cross-check: ECGDex emits the SAME SI inputs on the JSON path as the CSV path ──
    var e = (env.sources || {})['ecgdex-app.js'];
    if (e == null) { T.ok('ecgdex-app.js source available', false, 'not in env.sources'); return; }
    T.ok('ECGDex shares one _baevskyGeom source of truth', /function _baevskyGeom/.test(e));
    T.ok('ECGDex Welltory CSV row uses _baevskyGeom(r.nn)', /_baevskyGeom\(r\.nn\)/.test(e));
    T.ok('ECGDex envelope hrv.time carries amo50/mode/mxDMn (CSV↔JSON parity, P4)',
      /amo50:\s*_geom\.amo50/.test(e) && /mode:\s*_geom\.mode/.test(e) && /mxDMn:\s*_geom\.mxDMn/.test(e));
  });

  /* ════ GlucoDex synthetic patient-coherence — DexPatientGen → renderGlucoAll → parseCSV ════
     Gates the June-2026 coherence change: GlucoDex's generator is the SHARED patient (so it
     fuses with OxyDex/HRVDex/etc.), and the additive cfg.glucBaseMmol override expresses
     pre-diabetes WITHOUT changing the frozen corpus (omitted field → 5.4 default, byte-safe). */
  group('GlucoDex synthetic coherence (DexPatientGen → renderGlucoAll → parseCSV)',
        'dex-patient-gen · synth-gen · glucodex-dsp', function (T) {
    var DPG = env.DexPatientGen, S = env.SYNTH, G = env.GLUDSP;
    if (!(DPG && typeof DPG.buildNights === 'function')) { T.ok('DexPatientGen.buildNights available', false, 'not loaded'); return; }
    if (!(S && typeof S.renderGlucoAll === 'function'))   { T.ok('SYNTH.renderGlucoAll available', false, 'not loaded'); return; }
    if (!(G && typeof G.parseCSV === 'function'))         { T.ok('GLUDSP.parseCSV available', false, 'not loaded'); return; }

    function meanOf(profile, opts) {
      var tls = DPG.buildNights(profile, 7, opts);
      if (!tls || !tls.length) return null;
      var p = G.parseCSV(S.renderGlucoAll(tls));
      var v = p && p.vMgdl;
      if (!v || !v.length) return null;
      var s = 0; for (var i = 0; i < v.length; i++) s += v[i];
      return s / v.length;
    }

    // round-trip integrity: one shared patient → continuous CGM CSV → a real parsed series
    var tls = DPG.buildNights('baseline', 7, null);
    T.ok('buildNights(baseline,7) → 7 nights for ONE patient', tls && tls.length === 7, tls && tls.length);
    var parsed = G.parseCSV(S.renderGlucoAll(tls));
    T.ok('renderGlucoAll → GLUDSP.parseCSV yields a series', !!(parsed && parsed.vMgdl && parsed.vMgdl.length > 50), parsed && parsed.vMgdl && parsed.vMgdl.length);
    T.ok('parsed unit normalised to mg/dL', parsed && parsed.unit === 'mg/dL', parsed && parsed.unit);

    // glucBaseMmol override raises the whole series → pre-DM mean sits in the IFG band
    var healthy = meanOf('healthy', null);
    var predm   = meanOf('baseline', { glucBaseMmol: 6.6 });
    T.ok('healthy mean is euglycaemic (~90–120 mg/dL)', healthy != null && healthy > 90 && healthy < 120, healthy && healthy.toFixed(1));
    T.ok('pre-DM override elevates mean ≥ +15 mg/dL vs healthy', predm != null && healthy != null && (predm - healthy) >= 15, (predm && predm.toFixed(1)) + ' vs ' + (healthy && healthy.toFixed(1)));
    T.ok('pre-DM mean lands in IFG range (~115–140 mg/dL)', predm != null && predm > 115 && predm < 140, predm && predm.toFixed(1));

    // ADDITIVE / byte-safe: omitting glucBaseMmol must equal the legacy default (no drift)
    T.approx('no-override default == empty-opts default (5.4 mmol baseline preserved)', meanOf('baseline', {}), meanOf('baseline', null), 0.001);

    // deterministic seeded patient: same profile+days+opts → identical series
    T.approx('deterministic: repeat build → identical mean', meanOf('baseline', null), meanOf('baseline', null), 1e-9);
  });

  /* ════ GlucoDex hypo vs compression-artifact disambiguation (GLUCODEX-HYPO-DISAMBIG) ════
     Locks the June-2026 fix BOTH directions: a genuine sharp nocturnal hypo (sustained sub-70,
     ~56 mg/dL, gradual descent + Somogyi rebound) MUST reach nocturnalHypo (was a false negative —
     the compression-rejection ate it); a near-vertical positional artifact (single-cell drop onto a
     low plateau, single-cell recovery) MUST still be flagged compression and excluded. Built from a
     hand-made CSV through the REAL parseCSV → analyze path; ISO timestamps (zone-free, viewer-tz
     independent per the Clock Contract). */
  group('GlucoDex hypo ≠ compression artifact', 'glucodex-dsp · hypo-disambig', function (T) {
    var G = env.GLUDSP;
    if (!(G && typeof G.parseCSV === 'function' && typeof G.analyze === 'function')) {
      T.ok('GLUDSP.parseCSV + analyze available', false, 'not loaded'); return;
    }
    var CAD = 5, N = 72, START = U(2026, 5, 10, 0, 0, 0);   // 00:00 → 05:55, 5-min cadence
    function fmt(ms) {
      var d = new Date(ms), p = function (x) { return String(x).padStart(2, '0'); };
      return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
        ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    }
    // dip centred ~02:00 (index 24), well inside the 00:00–06:00 nocturnal window
    var GENUINE = { 21: 85, 22: 74, 23: 64, 24: 58, 25: 56, 26: 56, 27: 56, 28: 56, 29: 56,
                    30: 56, 31: 56, 32: 56, 33: 56, 34: 56, 35: 62, 36: 72, 37: 84, 38: 98, 39: 112, 40: 120, 41: 108, 42: 96 };
    var ARTIFACT = { 24: 56, 25: 56, 26: 56, 27: 56, 28: 56, 29: 56, 30: 56 };   // vertical edges, flat plateau
    function buildCSV(dip) {
      var rows = ['timestamp,glucose'];
      for (var k = 0; k < N; k++) {
        var ms = START + k * CAD * 60000;
        var g = (dip[k] != null) ? dip[k] : 95 + Math.round(3 * Math.sin(k / 4));
        rows.push(fmt(ms) + ',' + g);
      }
      return rows.join('\n');
    }
    function run(dip) { return G.analyze(G.parseCSV(buildCSV(dip))); }

    // ── direction 1: genuine sharp hypo is DETECTED (the false-negative this brief closes) ──
    var rg = run(GENUINE);
    T.ok('genuine sharp hypo → nocturnalHypo fires (was 0 — false negative)', rg.nocturnalHypo.length > 0, 'n=' + rg.nocturnalHypo.length);
    T.ok('detected hypo reaches the real ~56 mg/dL nadir', rg.nocturnalHypo.length > 0 && rg.nocturnalHypo[0].min <= 60, rg.nocturnalHypo[0] && rg.nocturnalHypo[0].min);
    T.ok('genuine hypo NOT mis-flagged as compression artifact', rg.compMin === 0, 'compMin=' + rg.compMin);
    T.ok('genuine hypo emits a nocturnal_hypo Ganglior event', rg.events.some(function (e) { return e.impulse === 'nocturnal_hypo'; }));

    // ── direction 2: a near-vertical positional artifact is STILL rejected (no new false positive) ──
    var ra = run(ARTIFACT);
    T.ok('positional artifact still flagged compression', ra.compMin > 0, 'compMin=' + ra.compMin);
    T.ok('positional artifact does NOT fire nocturnalHypo', ra.nocturnalHypo.length === 0, 'n=' + ra.nocturnalHypo.length);
    T.ok('positional artifact emits no nocturnal_hypo event', !ra.events.some(function (e) { return e.impulse === 'nocturnal_hypo'; }));

    // ── viewer-timezone independence: same inputs → identical detection regardless of host TZ ──
    T.eq('hypo detection is viewer-tz independent (re-run → identical count)', run(GENUINE).nocturnalHypo.length, rg.nocturnalHypo.length);
  });

  /* ════ Integrator evidence-grade mirror ≡ node registries ════
     The Integrator emits crossnight envelopes with an `evidence` tier per metric. A
     tier is a NODE fact from its <node>-registry.js; IntegratorDSP.GRADE_MIRROR is the
     static fallback the bundle ships (the node registries aren't loaded there). This
     gate asserts the mirror equals each registry's evidence so it can NEVER silently
     drift, and pins the two historically mis-graded (minSpo2/residualAHI = measured). */
  group('Integrator evidence-grade mirror ≡ node registries', 'integrator-dsp · cohesion', function (T) {
    var I = env.IntegratorDSP;
    if (!(I && I.GRADE_MIRROR && Array.isArray(I.GRADE_SOURCES) && typeof I.gradeFor === 'function')) {
      T.ok('IntegratorDSP grade resolver available', false, 'not loaded'); return;
    }
    var regs = { OXY_REGISTRY: env.OXY_REGISTRY, ECG_REGISTRY: env.ECG_REGISTRY,
                 GLU_REGISTRY: env.GLU_REGISTRY, CPAP_REGISTRY: env.CPAP_REGISTRY };
    I.GRADE_SOURCES.forEach(function (s) {
      var reg = regs[s.reg];
      if (!(reg && reg[s.regId])) { T.ok(s.reg + '.' + s.regId + ' present', false, 'registry/id missing'); return; }
      var regGrade = reg[s.regId].evidence;
      T.eq('mirror[' + s.id + '] ≡ ' + s.reg + '.' + s.regId + '.evidence', I.GRADE_MIRROR[s.id], regGrade);
      T.eq('gradeFor(' + s.node + ',' + s.id + ') resolves to registry grade', I.gradeFor(s.node, s.id), regGrade);
    });
    // pin the two historically hardcoded 'validated' — they are raw device readings
    T.eq('minSpo2 graded measured (not validated)', I.GRADE_MIRROR.minSpo2, 'measured');
    T.eq('residualAHI graded measured (not validated)', I.GRADE_MIRROR.residualAHI, 'measured');
    // no orphan mirror entries — every mirror id has a registry source row
    T.eq('GRADE_SOURCES covers every GRADE_MIRROR id',
         Object.keys(I.GRADE_MIRROR).sort(), I.GRADE_SOURCES.map(function (s) { return s.id; }).sort());
  });

  /* ════ Integrator longitudinal — synthetic filter (clearSynthetic / includeSynthetic) ════
     §1 of AUDIT-FOLLOWUPS / §2 of GENERATOR-FOLLOWUPS-II. The longitudinal store mixes
     generated (schema.synthetic) rows with real ones; the filter lets the view hide them and
     `clearSynthetic()` deletes ONLY synthetic rows. The pure helper `filterSynthetic` is Node-
     testable; ingest()/state()/seriesFor() run headless (in-memory mirror needs no IndexedDB). */
  group('Integrator longitudinal — synthetic filter', 'integrator-longitudinal', function (T) {
    var L = env.IntegratorLong;
    if (!(L && typeof L.filterSynthetic === 'function' && typeof L.clearSynthetic === 'function')) {
      T.ok('IntegratorLong synthetic filter API present', false, 'not loaded'); return;
    }
    // pure helper: undefined `synthetic` ⇒ real (kept); explicit false default keeps all
    var rows = [{ synthetic: true }, { synthetic: false }, {}];
    T.eq('filterSynthetic default keeps all', L.filterSynthetic(rows, undefined).length, 3);
    T.eq('filterSynthetic(true) keeps all', L.filterSynthetic(rows, true).length, 3);
    T.eq('filterSynthetic(false) drops only synthetic (undefined = real)', L.filterSynthetic(rows, false).length, 2);

    // full headless round-trip through the in-memory mirror (no IndexedDB needed)
    L.clear();
    var synEnv = { schema: { name: 'ganglior.crossnight', node: 'OxyDex', synthetic: true },
      metrics: { odi: { label: 'ODI-4', unit: '/h', goodDirection: 'down' } },
      series: [{ t0Ms: U(2026, 4, 1), values: { odi: 5 } }] };
    var realEnv = { schema: { name: 'ganglior.crossnight', node: 'HRVDex' },
      metrics: { rmssd: { label: 'RMSSD', unit: 'ms', goodDirection: 'up' } },
      series: [{ t0Ms: U(2026, 4, 1), values: { rmssd: 42 } }] };
    L.ingest(synEnv, 'syn.json'); L.ingest(realEnv, 'real.json');
    T.eq('state() counts both real + synthetic', L.state().nRows, 2);
    T.eq('state(false) view excludes synthetic', L.state(false).nRows, 1);
    T.eq('seriesFor synthetic metric, includeSynthetic=false → empty', L.seriesFor('OxyDex', 'odi', false).length, 0);
    T.eq('seriesFor synthetic metric, default → present', L.seriesFor('OxyDex', 'odi').length, 1);
    T.eq('seriesFor real metric unaffected by filter', L.seriesFor('HRVDex', 'rmssd', false).length, 1);
    T.ok('hasSynthetic true while a synthetic row is present', L.hasSynthetic() === true);
    L.clearSynthetic();
    T.eq('clearSynthetic leaves only the real row', L.state().nRows, 1);
    T.eq('clearSynthetic kept the real HRVDex row', L.seriesFor('HRVDex', 'rmssd').length, 1);
    T.ok('hasSynthetic false after clearSynthetic', L.hasSynthetic() === false);
    L.clear();

    // ── DSP-NITS-2026-07-03 §1: mixed dated/undated series sort on ONE explicit key ──
    // t0Ms when present (`!= null` — the sanctioned "undated → anchor at 0" value must sort FIRST,
    // never be rerouted by truthiness to Date.parse), Date.parse(date) only for rows with no t0Ms.
    var mixEnv = { schema: { name: 'ganglior.crossnight', node: 'ECGDex' },
      metrics: { hf: { label: 'HF power', unit: 'ms²', goodDirection: 'up' } },
      series: [{ t0Ms: U(2026, 4, 3, 1, 0), values: { hf: 3 } },   // May 3 01:00 floating
                { date: '2026-05-02', values: { hf: 2 } },          // dated-only (t0Ms null → parse fallback)
                { t0Ms: 0, values: { hf: 1 } }] };                  // undated→0 anchor (ECGDex/RR convention)
    L.ingest(mixEnv, 'mix.json');
    var mixSer = L.seriesFor('ECGDex', 'hf');
    T.eq('mixed dated/undated series: all three rows placed', mixSer.length, 3);
    T.ok('t0Ms===0 anchor sorts FIRST (explicit != null, not truthiness)', mixSer.length === 3 && mixSer[0].v === 1 && mixSer[0].t0Ms === 0);
    T.ok('dated-only row (no t0Ms) placed by Date.parse fallback, between anchors', mixSer.length === 3 && mixSer[1].v === 2 && mixSer[1].t0Ms == null);
    T.ok('t0Ms-carrying row sorts by its OWN floating key', mixSer.length === 3 && mixSer[2].v === 3);
    L.clear();
  });

  /* ════ N · DEX-PROFILE ENGINE — unified-profile formula/cascade contracts ════
     Locks the shared DexProfile engine (PROFILE-UNIFY-BRIEF) so the unified
     formulas, norms, cascade, gates, units and migration can't silently re-drift.
     State is isolated via an injected in-memory store — never touches localStorage. */
  group('Dex-Profile engine — unified contracts', 'dex-profile', function (T) {
    var DP = env.DexProfile;
    T.ok('DexProfile present', !!DP);
    if (!DP || !DP._setStore) { T.ok('DexProfile._setStore (isolatable)', false); return; }
    function mem() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = '' + v; }, removeItem: function (k) { delete m[k]; } }; }

    // ── pristine + cascade ──────────────────────────────────────────────
    DP._setStore(mem());
    T.ok('blank record is pristine', DP.isPristine() === true);
    // ── age BP-parity (2026-06-30, user request): a blank/implausible age is a 'pop' PLACEHOLDER
    //    (like BP's 120/80 default), NOT a green 'your value'; a valid entered age reads 'you'. ──
    var _a0 = DP.resolve('age');
    T.ok('blank age = default 42 @ pop tier (placeholder, not your-value)', _a0.v === 42 && _a0.origin === 'pop');
    DP.setManual('age', 103);
    T.ok('implausible age (103) clamped away → default 42 @ pop', DP.resolve('age').v === 42 && DP.resolve('age').origin === 'pop');
    DP.setManual('age', 47);
    T.ok('valid age reads back @ you tier', DP.resolve('age').v === 47 && DP.resolve('age').origin === 'you');
    DP.setManual('age', null);
    T.ok('cleared age (↺ revert) drops to default @ pop', DP.resolve('age').v === 42 && DP.resolve('age').origin === 'pop');
    DP.setManual('age', 50); DP.setManual('sex', 'M');
    T.ok('setManual clears pristine', DP.isPristine() === false);
    var rhM = DP.resolve('hrMax');
    T.eq('hrMax pop-tier = Tanaka 208−0.7·50 = 173', rhM.v, 173);
    T.eq('hrMax origin = pop', rhM.origin, 'pop');
    T.eq('resting HR flat-70 pop default', DP.resolve('hrRest').v, 70);
    T.eq('SBP flat-120 / DBP flat-80 (age/sex-independent)', [DP.resolve('sbp').v, DP.resolve('dbp').v].join('/'), '120/80');
    DP.setDetected({ hrRest: 57, _floor: 49 });
    var rd = DP.resolve('hrRest');
    T.ok('detected tier overrides pop (hrRest 57, origin detected)', rd.v === 57 && rd.origin === 'detected');
    DP.setManual('hrRest', 52);
    var ry = DP.resolve('hrRest');
    T.ok('manual tier wins (hrRest 52, origin you)', ry.v === 52 && ry.origin === 'you');
    DP.setManual('hrRest', null);
    T.eq('revert drops back to detected', DP.resolve('hrRest').origin, 'detected');

    // ── NHANES interpolation + 70-band ceiling clamp ────────────────────
    DP._setStore(mem()); DP.setManual('age', 80); DP.setManual('sex', 'M');
    T.eq('NHANES weight clamps at 70-band above 70 (M=82.1)', DP.resolve('weight').v, 82.1);

    // ── canonical derived formulas (drift-proof: expected recomputed in-test) ──
    DP._setStore(mem());
    DP.setManual('age', 50); DP.setManual('sex', 'M'); DP.setManual('weight', 90); DP.setManual('height', 175);
    var d = DP.derive(DP.get());
    var bsaDuBois = +(0.007184 * Math.pow(90, 0.425) * Math.pow(175, 0.725)).toFixed(2);
    T.approx('BSA = DuBois (NOT Mosteller)', d.bsa, bsaDuBois, 0.001);
    T.approx('BMI = 90 ÷ 1.75² ≈ 29.4', d.bmi, 29.4, 0.05);
    T.eq('MAP = DBP + ⅓(SBP−DBP)', d.map, Math.round(80 + (120 - 80) / 3));
    T.eq('Pulse pressure = SBP − DBP', d.pp, 40);
    T.eq('RMR = Mifflin-St Jeor (no body-fat)', d.rmr, Math.round(10 * 90 + 6.25 * 175 - 5 * 50 + 5));
    T.ok('RMR formula label = Mifflin', /Mifflin/.test(d.rmrFormula));
    T.eq('HRmax derived = Tanaka', d.hrMax, 173);
    // body-fat → Katch-McArdle RMR
    DP.setManual('bodyfat', 20);
    var d2 = DP.derive(DP.get());
    T.eq('RMR switches to Katch-McArdle with body-fat', d2.rmr, Math.round(370 + 21.6 * (90 * 0.8)));
    T.ok('Katch-McArdle label active', /Katch/.test(d2.rmrFormula));
    // WHtR
    DP.setManual('bodyfat', null); DP.setManual('waist', 90);
    var d3 = DP.derive(DP.get());
    T.approx('WHtR = waist ÷ height', d3.whtr, +(90 / 175).toFixed(2), 0.001);
    T.eq('WHtR ≥ 0.5 flagged elevated', d3.whtrRisk, 'elevated');

    // ── validity gates (brief §3) ───────────────────────────────────────
    DP._setStore(mem()); DP.setManual('age', 45); DP.setManual('sex', 'M');
    DP.setManual('betablk', 'yes');
    var gb = DP.derive(DP.get()).flags;
    T.ok('β-blocker → hrMaxValid & hrBasedVo2Valid false', gb.hrMaxValid === false && gb.hrBasedVo2Valid === false && gb.karvonenValid === false);
    DP.setManual('betablk', null); DP.setManual('afib', 'yes');
    T.eq('AF → hrvValid false (rMSSD/SDNN invalid)', DP.derive(DP.get()).flags.hrvValid, false);
    DP.setManual('afib', null); DP.setManual('cpap', 'yes');
    T.eq('CPAP → cpapResidual flag', DP.derive(DP.get()).flags.cpapResidual, true);

    // ── units: metric canonical, imperial display-only round-trip ───────
    DP._setStore(mem());
    T.eq('metric is the default/canonical unit', DP.resolve('units').v, 'metric');
    T.eq('toDisp in metric is identity (no conversion at compute layer)', DP.toDisp('weight', 90), 90);
    DP.setManual('units', 'imperial');
    T.approx('toDisp imperial 90 kg ≈ 198.4 lb', DP.toDisp('weight', 90), 198.4, 0.3);
    T.approx('toMetric round-trips back to 90 kg', DP.toMetric('weight', DP.toDisp('weight', 90)), 90, 0.5);

    // ── migration: legacy → unified, idempotent, never fabricates ───────
    var st = mem();
    st.setItem('ecgdex_profile', JSON.stringify({ ecgAge: '63', ecgSex: 'F', ecgRHR: '61', ecgCPAP: 'yes' }));
    DP._setStore(st);
    T.ok('migrate() returns true on legacy data', DP.migrate() === true);
    var rec = JSON.parse(st.getItem('tepna_profile') || 'null');
    T.ok('migrated age 63 / sex F', rec && rec.age === 63 && rec.sex === 'F');
    T.eq('migrated override RHR lands in manual layer', rec && rec.manual.hrRest, 61);
    T.eq('migrated CPAP yes', rec && rec.manual.cpap, 'yes');
    T.ok('migrate is idempotent (2nd run no-op)', DP.migrate() === false);
    var st2 = mem(); DP._setStore(st2);
    T.ok('no legacy data → migrate no-op, never fabricates', DP.migrate() === false && st2.getItem('tepna_profile') === null);

    // ── NORMS table is cited (auditable defaults) ───────────────────────
    T.ok('NORMS cite HRmax=Tanaka', DP.NORMS && /Tanaka/.test(DP.NORMS.hrMax.source));
    T.ok('NORMS cite weight=NHANES', DP.NORMS && /NHANES/.test(DP.NORMS.weight.source));
    T.ok('NORMS cite BP=ACC/AHA', DP.NORMS && /ACC\/AHA/.test(DP.NORMS.sbp.source));
  });

  /* ════ 22 · PROPERTY / METAMORPHIC — HRV invariants + SignalFrame contract ════
     The generative complement to the suite's known-answer tests (WP-C/D/D2) and
     synthetic→DSP recovery (FULL-lane): instead of one input→expected pair, state
     an INVARIANT and let a seeded generator hunt counterexamples across many
     inputs (brief §6 — let the agent state a property, let the machine enumerate
     edge cases). Self-contained HRV math (mirrors pulsedex-dsp's rmssd/std, which
     aren't headless-loadable as bare globals) + the loaded CORE adapter spine. */
  group('Property / metamorphic — HRV + SignalFrame', 'property-metamorphic', function (T) {
    // seeded RNG (mulberry32) — deterministic counterexample hunt, zero deps.
    function rng(seed) { var s = seed >>> 0; return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function mean(a) { for (var s = 0, i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
    function std(a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / a.length); }            // SDNN (population)
    function rmssd(a) { for (var d = 0, n = 0, i = 1; i < a.length; i++) { var x = a[i] - a[i - 1]; d += x * x; n++; } return Math.sqrt(d / n); }
    function genRR(seed, n) { var r = rng(seed), base = 700 + r() * 400, a = []; for (var i = 0; i < n; i++) a.push(base + (r() - 0.5) * 90); return a; }   // stationary RR ~physiological
    var TOL = 1e-9, RELTOL = 1e-6;
    var rel = function (a, b) { return Math.abs(a - b) <= RELTOL * Math.max(1, Math.abs(a), Math.abs(b)); };

    // ── P1 · time-shift invariance: rMSSD/SDNN depend on intervals, not absolute clock ──
    (function () {
      var bad = 0;
      for (var s = 1; s <= 40; s++) {
        var a = genRR(s, 120);
        // a constant tMs shift changes no interval → metrics identical by construction
        if (Math.abs(rmssd(a) - rmssd(a.slice())) > TOL) bad++;
        if (Math.abs(std(a) - std(a.slice())) > TOL) bad++;
      }
      T.ok('rMSSD/SDNN invariant to constant time-shift (40 seeds)', bad === 0, bad + ' violations');
    })();

    // ── P2 · linear scaling: scale every RR by k → rMSSD, SDNN scale by |k| ──
    (function () {
      var bad = 0, badCaught = false;
      var scale = function (a, k) { return a.map(function (v) { return v * k; }); };
      var badScale = function (a, k) { return a.map(function (v) { return v * k * k; }); }; // scales by k², not k → breaks linearity for k≠1
      for (var s = 1; s <= 40; s++) {
        var a = genRR(s, 100), k = 0.5 + (rng(s * 7)()) * 2;
        if (!rel(rmssd(scale(a, k)), k * rmssd(a))) bad++;
        if (!rel(std(scale(a, k)), k * std(a))) bad++;
        // the property must have TEETH: the buggy scaler must FAIL it for some seed
        if (!rel(rmssd(badScale(a, k)), k * rmssd(a)) || !rel(std(badScale(a, k)), k * std(a))) badCaught = true;
      }
      T.ok('rMSSD/SDNN scale linearly under RR×k (40 seeds)', bad === 0, bad + ' violations');
      T.ok('property has teeth — seeded non-linear scaler IS caught', badCaught === true);
    })();

    // ── P3 · time reversal preserves time-domain HRV of a stationary series ──
    (function () {
      var bad = 0;
      for (var s = 1; s <= 40; s++) {
        var a = genRR(s, 110), b = a.slice().reverse();
        if (!rel(rmssd(a), rmssd(b))) bad++;   // |successive diffs| set is reversal-invariant
        if (!rel(std(a), std(b))) bad++;        // variance is order-invariant
      }
      T.ok('time reversal preserves rMSSD + SDNN (40 seeds)', bad === 0, bad + ' violations');
    })();

    // ── P4 · SignalFrame round-trip: validateFrame(toSignalFrame(...)).ok for adapters/fixtures ──
    var SF = env.SignalFrame, SS = env.SignalSpec, SA = env.SignalAdapters;
    T.ok('CORE present — SignalFrame + SignalSpec + SignalAdapters', !!(SF && SS && SA));
    if (SF && SS && SA) {
      // simulate a node parser (parseRRInput shape) deterministically, no DSP load needed.
      function fakeParseRR(seed, n, stamped) {
        var a = genRR(seed, n), t0 = U(2026, 5, 7, 22, 0, 0), ts = null;
        if (stamped) { ts = []; var acc = t0; for (var i = 0; i < a.length; i++) { acc += a[i]; ts.push(acc); } }
        var nUse = a.filter(function (v) { return v >= 250 && v <= 3000; }).length;
        return { vals: a, t0Ms: stamped ? t0 : null, offsetMin: null, tsMs: ts, sourceFormat: 'rr', nRaw: a.length, nUsable: nUse, usable: nUse >= 10, reason: null };
      }
      var bad = 0;
      for (var s = 1; s <= 30; s++) {
        var raw = fakeParseRR(s, 60, s % 2 === 0);
        var fr = SF.toSignalFrame('rr', raw, { adapter: 'polar-rr', vendor: 'Polar', files: ['x_RR.txt'] });
        var v = SF.validateFrame(fr);
        if (!v.ok) bad++;
        // metamorphic: a frame's intervals must equal the parser vals (no mutation in transit)
        if (fr.intervals.length !== raw.vals.length) bad++;
        // t0Ms honesty: null in → null out, number in → same number out (never fabricated)
        if (raw.t0Ms === null && fr.t0Ms !== null) bad++;
        if (raw.t0Ms !== null && fr.t0Ms !== raw.t0Ms) bad++;
      }
      T.ok('SignalFrame round-trips valid for 30 seeded RR parses', bad === 0, bad + ' violations');

      // ── P5 · honesty: unparseable input → usable:false + reason, never an empty/fabricated frame ──
      var dead = SF.toSignalFrame('rr', { vals: [], t0Ms: null, usable: false, reason: 'no numeric intervals found in the file' }, { adapter: 'polar-rr', vendor: 'Polar' });
      var dv = SF.validateFrame(dead);
      T.ok('usable:false frame with reason validates (honest absence)', dv.ok === true, dv.errors.join('; '));
      T.ok('usable:false frame carries a reason string', typeof dead.reason === 'string' && dead.reason.length > 0);

      // ── P6 · validateFrame REJECTS a fabricated t0Ms-less frame (Phase 0 done-when) ──
      var noT0 = { signalType: 'rr', kind: 'intervals', intervals: [800, 810, 795], usable: true, offsetMin: null, sqi: null, reason: null, provenance: { adapter: 'x', kernelHash: 'abc' } };
      T.ok('validateFrame rejects a t0Ms-less frame', SF.validateFrame(noT0).ok === false);
      var nanT0 = SF.toSignalFrame('rr', { vals: [800, 810, 795], t0Ms: NaN, usable: true }, { adapter: 'x' });
      T.ok('validateFrame rejects a NaN t0Ms (no fabrication)', SF.validateFrame(nanT0).ok === false);
      var good = SF.toSignalFrame('rr', { vals: [800, 810, 795, 805, 812, 798, 802, 809, 791, 806, 800], t0Ms: U(2026, 5, 7, 22, 0, 0), usable: true }, { adapter: 'x' });
      T.ok('validateFrame accepts a good frame', SF.validateFrame(good).ok === true, SF.validateFrame(good).errors.join('; '));

      // ── P6b · irregular SAMPLES frame (hrv/cgm spot-reads): valid with tsMs + NO fs;
      //    a usable samples frame with NEITHER fs NOR tsMs is still rejected (teeth). ──
      if (SS && SS.hrv) {
        var t0h = U(2026, 5, 7, 7, 30, 0);
        var hrvFrame = SF.toSignalFrame('hrv', { samples: [{ _tMs: t0h }, { _tMs: t0h + 864e5 }], fs: null, t0Ms: t0h, tsMs: [t0h, t0h + 864e5], usable: true }, { adapter: 'welltory-summary' });
        T.ok('irregular hrv samples frame (tsMs, no fs) validates', SF.validateFrame(hrvFrame).ok === true, SF.validateFrame(hrvFrame).errors.join('; '));
        var noClock = { signalType: 'hrv', kind: 'samples', samples: [{ x: 1 }], fs: null, tsMs: null, t0Ms: t0h, offsetMin: null, sqi: null, usable: true, reason: null, provenance: { adapter: 'x', kernelHash: 'abc' } };
        T.ok('samples frame with neither fs nor tsMs is rejected (relaxation has teeth)', SF.validateFrame(noClock).ok === false);
      }

      // ── P6c · irregular-tsMs MONOTONICITY contract (-II §6): a gappy-but-monotonic
      //    spo2 frame validates (uneven cadence + dropped samples are fine); a frame whose
      //    tsMs steps BACKWARDS is rejected (floating tMs only advances — Clock Contract §1). ──
      if (SS && SS.spo2) {
        var _st0 = U(2026, 5, 12, 23, 0, 0);
        var gappy = { signalType: 'spo2', kind: 'samples', samples: [96, 95, 97, 96], fs: null, tsMs: [_st0, _st0 + 1000, _st0 + 9000, _st0 + 9000], t0Ms: _st0, offsetMin: null, sqi: null, usable: true, reason: null, provenance: { adapter: 'oxydex-spo2', kernelHash: 'abc' } };
        T.ok('gappy + repeated-stamp spo2 tsMs validates (irregular cadence allowed)', SF.validateFrame(gappy).ok === true, SF.validateFrame(gappy).errors.join('; '));
        var back = { signalType: 'spo2', kind: 'samples', samples: [96, 95, 97], fs: null, tsMs: [_st0, _st0 + 5000, _st0 + 2000], t0Ms: _st0, offsetMin: null, sqi: null, usable: true, reason: null, provenance: { adapter: 'oxydex-spo2', kernelHash: 'abc' } };
        T.ok('non-monotonic spo2 tsMs (backwards step) is rejected', SF.validateFrame(back).ok === false, SF.validateFrame(back).errors.join('; '));
      }

      // ── P7 · adapter registry: both RR adapters registered; detect() routes by signature ──
      var polar = SA.byId('polar-rr'), coospo = SA.byId('coospo-rr');
      T.ok('polar-rr registered (signalType rr)', !!polar && polar.signalType === 'rr');
      T.ok('coospo-rr registered (signalType rr)', !!coospo && coospo.signalType === 'rr');
      if (polar) T.ok('polar detect: *_RR.txt → high confidence', polar.detect({ name: 'PolarSensor_2026_RR.txt' }, '') >= 0.8);
      if (coospo) T.ok('coospo detect: coospo name → high confidence', coospo.detect({ name: 'Coospo_HW9_export.csv' }, '') >= 0.8);
      var wahoo = SA.byId('wahoo-rr');
      T.ok('wahoo-rr registered (signalType rr)', !!wahoo && wahoo.signalType === 'rr');
      if (wahoo) T.ok('wahoo detect: tickr name → high confidence', wahoo.detect({ name: 'Wahoo_TICKR_2026_RR.csv' }, '') >= 0.8);
      var routed = SA.route({ name: 'Coospo_HW9_2026.csv' }, 'RR(ms)');
      T.ok('route() picks coospo for a coospo file', routed.best && routed.best.id === 'coospo-rr', routed.best && routed.best.id);
      var unknown = SA.route({ name: 'mystery.bin' }, 'binary junk');
      T.ok('route() reports unknown for an unrecognized file (never guessed)', unknown.unknown === true);

      // ── P8 · same signal, new vendor = SAME math: both adapters wrap one parser ──
      var rrText = ['800', '810', '795', '805', '812', '798', '802', '809', '791', '806', '800', '804'].join('\n');
      var sharedParse = function (text) { var m = text.match(/-?\d+(\.\d+)?/g) || []; return { vals: m.map(Number), t0Ms: null, usable: m.length >= 10, reason: m.length >= 10 ? null : 'too few' }; };
      var ctx = { parseRRInput: sharedParse };
      var fa = SA.runAdapter(polar, rrText, ctx), fb = SA.runAdapter(coospo, rrText, ctx);
      T.ok('polar + coospo produce byte-identical intervals from one parser', JSON.stringify(fa.intervals) === JSON.stringify(fb.intervals));
      T.ok('both frames are usable rr SignalFrames', fa.usable && fb.usable && fa.signalType === 'rr' && fb.signalType === 'rr');

      // ── P9 · EVERY registered rr adapter round-trips to a VALID usable frame ──
      //   Makes "one signal, one math, many vendors" a checked invariant per
      //   ADD-AN-ADAPTER.md: a new rr adapter (e.g. wahoo-rr) is covered here
      //   automatically — no test edit needed beyond registering its <script>.
      //   Uses a shared parser that stamps t0Ms so validateFrame can pass (a
      //   usable frame MUST carry t0Ms — see P6).
      var rrParseTs = function (text) { var m = text.match(/-?\d+(\.\d+)?/g) || []; return { vals: m.map(Number), t0Ms: U(2026, 5, 12, 22, 0, 0), usable: m.length >= 10, reason: null }; };
      var ctxTs = { parseRRInput: rrParseTs };
      var rrAdapters = SA.bySignal('rr');
      T.ok('≥3 rr adapters registered (polar · coospo · wahoo …)', rrAdapters.length >= 3, rrAdapters.length + ' registered');
      var ref = SA.runAdapter(rrAdapters[0], rrText, ctxTs);
      var allOk = true, offender = '';
      rrAdapters.forEach(function (a) {
        var fr = SA.runAdapter(a, rrText, ctxTs);
        var ok = fr && fr.usable && fr.signalType === 'rr' && SF.validateFrame(fr).ok && JSON.stringify(fr.intervals) === JSON.stringify(ref.intervals);
        if (!ok) { allOk = false; offender = a.id; }
      });
      T.ok('every registered rr adapter → valid usable frame, identical intervals', allOk, offender || 'all pass');

      // ── P10 · CGM (GlucoDex) Phase-9 adapter + canonical-frame → compute round-trip ──
      //   signal-orchestrate.emitCgmNodeExport hands GlucoDex.compute() a canonical cgm
      //   SignalFrame (samples=[{tMs,v}] + parallel tsMs, no fs) STRAIGHT through. This asserts
      //   (a) that frame shape VALIDATES, (b) GlucoDex.compute() ACCEPTS it (not only the
      //   {tMs,vMgdl}/{text} shapes the synthetic floor exercises) and emits a schema-valid
      //   ganglior.node-export, and (c) the REAL libre-cgm adapter produces that same frame from
      //   a CGM CSV. Guards the compute()-shape gap the {tMs,vMgdl} floor hides (brief §2a/§4 #2).
      var GD = env.GlucoDex, GLU = env.GLUDSP;
      if (GD && typeof GD.compute === 'function' && GLU && typeof GLU.genSynthetic === 'function') {
        var gsyn = GLU.genSynthetic({ days: 3 });                        // {tMs,vMgdl,unit,t0Ms}
        var gsmp = gsyn.tMs.map(function (t, i) { return { tMs: t, v: gsyn.vMgdl[i] }; });
        var cgmFrame = SF.toSignalFrame('cgm', { samples: gsmp, tsMs: gsyn.tMs, t0Ms: gsyn.t0Ms, unit: gsyn.unit || 'mg/dL', usable: true }, { adapter: 'libre-cgm', vendor: 'synthetic' });
        T.ok('cgm SignalFrame (samples=[{tMs,v}] + tsMs, no fs) validates', SF.validateFrame(cgmFrame).ok, SF.validateFrame(cgmFrame).errors.join('; '));
        var cfe = null;
        try { cfe = GD.compute(cgmFrame); } catch (e) { T.ok('GlucoDex.compute(cgm SignalFrame) threw: ' + e.message, false); }
        if (cfe) {
          T.ok('GlucoDex.compute(cgm frame) → ganglior.node-export / node GlucoDex', !!(cfe.schema && cfe.schema.name === 'ganglior.node-export' && cfe.schema.node === 'GlucoDex'));
          T.ok('  recording.startEpochMs finite + ganglior_events is an array', !!(cfe.recording && isFinite(cfe.recording.startEpochMs) && Array.isArray(cfe.ganglior_events)));
        }
        // (c) real ingest path: zone-free ISO CSV → libre-cgm adapter → frame → compute.
        var cgmAd = (SA.byId ? SA.byId('libre-cgm') : null);
        T.ok('libre-cgm adapter registered (signalType cgm)', !!(cgmAd && cgmAd.signalType === 'cgm'), cgmAd ? cgmAd.signalType : 'not registered');
        if (cgmAd) {
          var gp = function (n) { return (n < 10 ? '0' : '') + n; };
          var crows = ['timestamp,glucose'];
          for (var cI = 0; cI < gsyn.tMs.length; cI++) {
            var cd = new Date(gsyn.tMs[cI]);
            crows.push(cd.getUTCFullYear() + '-' + gp(cd.getUTCMonth() + 1) + '-' + gp(cd.getUTCDate()) + 'T' + gp(cd.getUTCHours()) + ':' + gp(cd.getUTCMinutes()) + ':' + gp(cd.getUTCSeconds()) + ',' + Math.round(gsyn.vMgdl[cI]));
          }
          var afr = SA.runAdapter(cgmAd, crows.join('\n'), {});
          T.ok('libre-cgm CSV → usable cgm frame (wraps GlucoDex.parseCSV by reference)', !!(afr && afr.usable && afr.signalType === 'cgm'), afr && afr.reason);
          T.ok('libre-cgm frame validates', !!(afr && SF.validateFrame(afr).ok), afr ? SF.validateFrame(afr).errors.join('; ') : 'no frame');
          var afe = null;
          try { afe = (afr && afr.usable) ? GD.compute(afr) : null; } catch (e) { T.ok('GlucoDex.compute(adapter frame) threw: ' + e.message, false); }
          if (afe) T.ok('adapter cgm frame → GlucoDex.compute → schema-valid GlucoDex export', !!(afe.schema && afe.schema.node === 'GlucoDex' && Array.isArray(afe.ganglior_events)));
        }
      }

      // ── P11 · PPG (PpgDex) Phase-9 adapter + canonical-frame → compute round-trip ──
      //   signal-orchestrate.emitPpgNodeExport hands PpgDex.compute() a canonical ppg SignalFrame
      //   whose `samples` PACKS the multi-channel optical waveform (ch[3]+amb+relSec, typed arrays —
      //   100+ Hz, so NOT per-sample objects) with fs/t0Ms on the frame. Asserts (a) that frame
      //   VALIDATES, (b) PpgDex.compute() ACCEPTS it (not only {text}) → schema-valid node-export, and
      //   (c) the REAL polar-sense-ppg adapter produces that same frame from a Polar Sense *_PPG.txt.
      //   Guards the compute()-shape gap the {text} floor hides (brief §1 / §4 #2 — the GlucoDex trap).
      var PG2 = env.PpgDex, SY2 = env.SYNTH;
      if (PG2 && typeof PG2.compute === 'function' && typeof PG2.parsePPG === 'function' && SY2 && typeof SY2.renderPPG === 'function' && typeof SY2.pickWindow === 'function') {
        var ptl2 = SY2.buildTimelines()[0];
        var pText2 = SY2.renderPPG(ptl2, SY2.pickWindow(ptl2));
        var prec = PG2.parsePPG(pText2);                                 // {ch:[F32×3],amb,relSec,fs,n,t0Ms,offsetMin,durSec}
        var psamp = { ch: prec.ch, amb: prec.amb, relSec: prec.relSec, n: prec.n, durSec: prec.durSec, length: prec.n };
        var ppgFrame = SF.toSignalFrame('ppg', { samples: psamp, fs: prec.fs, t0Ms: prec.t0Ms, offsetMin: prec.offsetMin, usable: prec.n >= 200 }, { adapter: 'polar-sense-ppg', vendor: 'synthetic' });
        T.ok('ppg SignalFrame (samples packs multi-channel waveform + fs, no per-sample objects) validates', SF.validateFrame(ppgFrame).ok, SF.validateFrame(ppgFrame).errors.join('; '));
        var pfe = null;
        try { pfe = PG2.compute(ppgFrame); } catch (e) { T.ok('PpgDex.compute(ppg SignalFrame) threw: ' + e.message, false); }
        if (pfe) {
          T.ok('PpgDex.compute(ppg frame) → ganglior.node-export / node PpgDex', !!(pfe.schema && pfe.schema.name === 'ganglior.node-export' && pfe.schema.node === 'PpgDex'));
          T.ok('  recording.startEpochMs finite + ganglior_events is an array', !!(pfe.recording && isFinite(pfe.recording.startEpochMs) && Array.isArray(pfe.ganglior_events)));
        }
        // (c) real ingest path: Polar Sense *_PPG.txt → polar-sense-ppg adapter → frame → compute.
        var ppgAd = (SA.byId ? SA.byId('polar-sense-ppg') : null);
        T.ok('polar-sense-ppg adapter registered (signalType ppg)', !!(ppgAd && ppgAd.signalType === 'ppg'), ppgAd ? ppgAd.signalType : 'not registered');
        if (ppgAd) {
          var pafr = SA.runAdapter(ppgAd, pText2, {});
          T.ok('polar-sense-ppg PPG txt → usable ppg frame (wraps PpgDex.parsePPG by reference)', !!(pafr && pafr.usable && pafr.signalType === 'ppg'), pafr && pafr.reason);
          T.ok('polar-sense-ppg frame validates', !!(pafr && SF.validateFrame(pafr).ok), pafr ? SF.validateFrame(pafr).errors.join('; ') : 'no frame');
          var pafe = null;
          try { pafe = (pafr && pafr.usable) ? PG2.compute(pafr) : null; } catch (e) { T.ok('PpgDex.compute(adapter frame) threw: ' + e.message, false); }
          if (pafe) T.ok('adapter ppg frame → PpgDex.compute → schema-valid PpgDex export', !!(pafe.schema && pafe.schema.node === 'PpgDex' && Array.isArray(pafe.ganglior_events)));
        }
      }

      // ── P12 · ECG (ECGDex) Phase-9 adapter + canonical-frame → compute round-trip ──
      //   signal-orchestrate.emitEcgNodeExport hands ECGDex.compute() a canonical ecg SignalFrame
      //   whose `samples` is a plain Int16Array — ECG is SINGLE-channel, NOT PpgDex's packed multi-
      //   channel object (PPGDEX-FOLLOWUPS §8) — with fs/t0Ms on the frame. Asserts (a) that frame
      //   VALIDATES, (b) ECGDex.compute() ACCEPTS it (not only {text}) → schema-valid node-export, and
      //   (c) the REAL polar-h10-ecg adapter produces that same frame from a Polar Sensor Logger
      //   *_ECG.txt. Guards the compute()-shape gap the {text} floor hides (brief §1 / §4 #2 — the
      //   GlucoDex trap). R-peak detection runs WITHOUT the Web Worker (parent §2b).
      var ED2 = env.ECGDex, ECD2 = env.ECGDSP;
      if (ED2 && typeof ED2.compute === 'function' && ECD2 && typeof ECD2.genSynthetic === 'function') {
        var erec = ECD2.genSynthetic({ durSec: 120, seed: 20260617 });   // {int16,fs,t0Ms,...}
        var eframe = SF.toSignalFrame('ecg', { samples: erec.int16, fs: erec.fs, t0Ms: erec.t0Ms, offsetMin: null, usable: erec.int16.length >= erec.fs * 8 }, { adapter: 'polar-h10-ecg', vendor: 'synthetic' });
        T.ok('ecg SignalFrame (single-channel Int16 samples + fs, no per-sample objects) validates', SF.validateFrame(eframe).ok, SF.validateFrame(eframe).errors.join('; '));
        var efe = null;
        try { efe = ED2.compute(eframe); } catch (e) { T.ok('ECGDex.compute(ecg SignalFrame) threw: ' + e.message, false); }
        if (efe) {
          T.ok('ECGDex.compute(ecg frame) → ganglior.node-export / node ECGDex', !!(efe.schema && efe.schema.name === 'ganglior.node-export' && efe.schema.node === 'ECGDex'));
          T.ok('  recording.startEpochMs finite + ganglior_events is an array', !!(efe.recording && isFinite(efe.recording.startEpochMs) && Array.isArray(efe.ganglior_events)));
        }
        // (c) real ingest path: render the synthetic to a Polar Sensor Logger *_ECG.txt → adapter → frame → compute.
        var ecgAd = (SA.byId ? SA.byId('polar-h10-ecg') : null);
        T.ok('polar-h10-ecg adapter registered (signalType ecg)', !!(ecgAd && ecgAd.signalType === 'ecg'), ecgAd ? ecgAd.signalType : 'not registered');
        if (ecgAd) {
          var _p2 = function (x, w) { x = '' + x; while (x.length < w) x = '0' + x; return x; };
          var et0 = (erec.t0Ms != null ? erec.t0Ms : U(2026, 5, 17, 1, 0, 0)), edt = 1000 / erec.fs, eN = Math.min(erec.int16.length, Math.round(erec.fs * 30));
          var elines = ['Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'];
          for (var eI = 0; eI < eN; eI++) {
            var ems = eI * edt, ed = new Date(et0 + ems);
            elines.push(ed.getUTCFullYear() + '-' + _p2(ed.getUTCMonth() + 1, 2) + '-' + _p2(ed.getUTCDate(), 2) + 'T' + _p2(ed.getUTCHours(), 2) + ':' + _p2(ed.getUTCMinutes(), 2) + ':' + _p2(ed.getUTCSeconds(), 2) + '.' + _p2(ed.getUTCMilliseconds(), 3) + ';0;' + ems.toFixed(3) + ';' + erec.int16[eI]);
          }
          var eafr = SA.runAdapter(ecgAd, elines.join('\n'), {});
          T.ok('polar-h10-ecg ECG txt → usable ecg frame (wraps ECGDex.parseECG by reference)', !!(eafr && eafr.usable && eafr.signalType === 'ecg'), eafr && eafr.reason);
          T.ok('polar-h10-ecg frame validates', !!(eafr && SF.validateFrame(eafr).ok), eafr ? SF.validateFrame(eafr).errors.join('; ') : 'no frame');
          var eafe = null;
          try { eafe = (eafr && eafr.usable) ? ED2.compute(eafr) : null; } catch (e) { T.ok('ECGDex.compute(adapter frame) threw: ' + e.message, false); }
          if (eafe) T.ok('adapter ecg frame → ECGDex.compute → schema-valid ECGDex export', !!(eafe.schema && eafe.schema.node === 'ECGDex' && Array.isArray(eafe.ganglior_events)));
          // ── §9-style ROUTE-PRECEDENCE LOCK (PPGDEX-FOLLOWUPS §9 pattern): a *_ECG.txt header carries
          //   the same Phone/sensor-timestamp columns polar-rr matches at 0.6, so the ecg adapter MUST
          //   outrank it; and the device *_RR.txt must still go to an rr adapter (no ecg hijack). ──
          var ecgHead = 'Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]\n2026-06-17T01:00:00.000;599630059061536896;0.0;144';
          var rEcg = SA.route({ name: 'Polar_H10_AAAAAAAA_20260617_010615_ECG.txt' }, ecgHead);
          T.ok('*_ECG.txt routes to polar-h10-ecg / ecg (outranks polar-rr 0.6 on the shared Phone-timestamp column)', !!(rEcg.best && rEcg.best.id === 'polar-h10-ecg' && rEcg.best.signalType === 'ecg'), rEcg.best ? (rEcg.best.id + '/' + rEcg.best.signalType) : 'no best');
          var rRr2 = SA.route({ name: 'Polar_H10_AAAAAAAA_20260617_010615_RR.txt' }, 'Phone timestamp;RR-interval [ms]\n2026-06-17T01:00:00.000+02:00;850');
          T.ok('device *_RR.txt still routes to an rr adapter (ecg adapter does not hijack RR)', !!(rRr2.best && rRr2.best.signalType === 'rr'), rRr2.best ? (rRr2.best.id + '/' + rRr2.best.signalType) : 'no best');
        }
      }
    }
  });

  /* ════ 23 · DSP-PURITY GATE (brief Phase 4b) — *-dsp.js runs headless ════
     Make "DSP runs headless" a CHECKED invariant: no *-dsp.js may touch the DOM
     or localStorage. KNOWN legacy violators are grandfathered with an explicit
     allow-list + reason (TODO migrate, Phase 9) so NEW nodes are held to the rule
     without forcing a legacy refactor now. Source-text group (runs in both
     runners off env.sources). NB `window` is deliberately NOT flagged: the module
     wrapper idiom `(typeof window!=='undefined'?window:globalThis)` + reading
     `window.DexKernel` are benign and universal — the violation is DOM mutation /
     localStorage, which these patterns catch precisely. */
  group('DSP-purity gate — *-dsp.js headless (Phase 4b)', 'sources · purity', function (T) {
    var src = env.sources || {};
    var dspFiles = Object.keys(src).filter(function (f) { return /-dsp\.js$/.test(f); }).sort();
    T.ok('DSP sources present in env.sources', dspFiles.length >= 6, dspFiles.length + ' files: ' + dspFiles.join(', '));

    // Grandfathered legacy DOM/localStorage couplers — each MUST carry a reason.
    // Post-Phase-9 (SIGNAL-ADAPTER-FOLLOWUPS -II §9 / -III §3): the READING + compute()
    // paths of both files are now PURE and load headless (oxydex's top-level wiring is
    // guarded `if(ua){…}`; hrvdex's DOM/localStorage is confined to the app-commit path,
    // NOT the parse path). The residual impurity below is the INTENTIONAL app-commit/render
    // glue these grandfathered single-file DSPs still carry — it is NOT a migrate-TODO (the
    // Phase-9 migration is DONE; compute() is self-contained). Kept allow-listed so the gate
    // stays green without splitting these legacy single-file DSPs.
    var ALLOW = {
      'oxydex-dsp.js': 'guarded top-level #uploadArea file-input/drag wiring (if(ua){…}) + result-banner innerHTML — render glue only; parseCSV + OxyDex.compute() load + run headless (Phase-9 done)',
      'hrvdex-dsp.js': 'DOM + localStorage live ONLY in the app-commit path (commitRows/_hrvRefreshChrome/persistHRVRows/getFilteredRows); the reading (_hrvParseSummaryRows) + HRVDex.compute() path is pure + headless (Phase-9 done)'
    };
    var FORBIDDEN = /document\.|\blocalStorage\b|\.addEventListener\b|\.getElementById\b|\.querySelector|\.innerHTML\b/;
    function stripComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }

    dspFiles.forEach(function (f) {
      var clean = stripComments(src[f]);
      var m = clean.match(FORBIDDEN);
      var violates = !!m;
      if (ALLOW[f]) {
        // allow-listed: pass, but flag a STALE entry (file cleaned up → remove from ALLOW).
        T.ok(f + ' allow-listed (legacy) — ' + (violates ? 'still impure' : 'NOW CLEAN, remove from ALLOW'), true, ALLOW[f]);
      } else {
        // new/clean node: MUST be pure.
        T.ok(f + ' is DOM-free + localStorage-free', !violates, violates ? ('found "' + m[0] + '"') : 'clean');
      }
    });

    // Positive proof the scanner works: the two known violators DO trip the pattern.
    ['oxydex-dsp.js', 'hrvdex-dsp.js'].forEach(function (f) {
      if (src[f]) T.ok('scanner detects known impurity in ' + f, FORBIDDEN.test(stripComments(src[f])));
    });
    // And a known-clean DSP is genuinely clean (so the gate isn't trivially green).
    if (src['pulsedex-dsp.js']) T.ok('pulsedex-dsp.js confirmed headless (positive control)', !FORBIDDEN.test(stripComments(src['pulsedex-dsp.js'])));
  });

  /* ════ 24 · FUSION ALGEBRA — combineConf noisy-OR laws (brief Phase 8) ════
     State the Integrator's confidence blend (conf = 1 − ∏(1 − cᵢ), capped 0.97 —
     "never invent precision") as a small algebra and PROPERTY-TEST its laws:
     commutativity, null-as-identity, monotonicity, source-dominance (uncapped),
     bounded range, and the 0.97 cap. Makes fusion composable + auditable as the
     suite grows 6 → 10 nodes. combineConf is exposed on IntegratorDSP; pure +
     loaded in both runners (additive — integrator-dsp.js itself is untouched). */
  group('Fusion algebra — combineConf laws (Phase 8)', 'integrator-dsp · fusion-algebra', function (T) {
    var I = env.IntegratorDSP;
    var CC = I && I.combineConf;
    T.ok('IntegratorDSP.combineConf present', typeof CC === 'function');
    if (typeof CC !== 'function') return;
    function rng(seed) { var s = seed >>> 0; return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    function vec(seed, n) { var r = rng(seed), v = []; for (var i = 0; i < n; i++) v.push(+(r() * 0.9).toFixed(3)); return v; }
    function shuffle(a, seed) { var r = rng(seed * 31 + 7), b = a.slice(); for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = b[i]; b[i] = b[j]; b[j] = t; } return b; }
    var TOL = 2e-3, max = function (a) { return a.reduce(function (m, v) { return v > m ? v : m; }, -Infinity); };

    // ── L0 · null / empty identity element ──
    T.ok('all-null → null (no evidence → no claim)', CC([null, null, undefined, NaN]) === null);
    T.ok('empty → null', CC([]) === null);

    // ── L1 · bounded range + 0.97 cap (never invent precision) ──
    (function () {
      var bad = 0, capHeld = true;
      for (var s = 1; s <= 60; s++) { var o = CC(vec(s, 1 + (s % 6))); if (o != null && (o < 0 || o > 0.97 + 1e-9)) bad++; if (o != null && o > 0.97 + 1e-9) capHeld = false; }
      T.ok('output ∈ [0, 0.97] for 60 random vectors', bad === 0, bad + ' out of range');
      T.ok('0.97 cap is never exceeded', capHeld);
    })();

    // ── L2 · commutativity (noisy-OR is symmetric — order cannot matter) ──
    (function () {
      var bad = 0;
      for (var s = 1; s <= 60; s++) { var v = vec(s, 2 + (s % 5)); if (Math.abs((CC(v) || 0) - (CC(shuffle(v, s)) || 0)) > 1e-9) bad++; }
      T.ok('combineConf is order-invariant (60 vectors)', bad === 0, bad + ' violations');
    })();

    // ── L3 · null is the identity element (padding with nulls changes nothing) ──
    (function () {
      var bad = 0;
      for (var s = 1; s <= 60; s++) { var v = vec(s, 2 + (s % 5)); if (Math.abs((CC(v) || 0) - (CC(v.concat([null, null, NaN])) || 0)) > 1e-9) bad++; }
      T.ok('null/NaN are identity elements (ignored)', bad === 0, bad + ' violations');
    })();

    // ── L4 · monotonicity — raising any source conf never lowers the blend ──
    (function () {
      var bad = 0;
      for (var s = 1; s <= 60; s++) {
        var r = rng(s * 17), v = vec(s, 2 + (s % 4)), i = Math.floor(r() * v.length);
        var up = v.slice(); up[i] = Math.min(0.999, up[i] + r() * (1 - up[i]));
        if ((CC(up) || 0) < (CC(v) || 0) - 1e-9) bad++;
      }
      T.ok('monotone non-decreasing in each source (60 vectors)', bad === 0, bad + ' violations');
    })();

    // ── L5 · source dominance (uncapped regime): blend ≥ the strongest single source ──
    (function () {
      var bad = 0, tested = 0;
      for (var s = 1; s <= 80; s++) {
        var v = vec(s, 1 + (s % 4)).map(function (x) { return +(x * 0.5).toFixed(3); }); // keep small → stay below cap
        var o = CC(v); if (o == null || o >= 0.97) continue; tested++;
        if (o < max(v) - TOL) bad++;
      }
      T.ok('uncapped blend ≥ strongest source (' + tested + ' vectors)', bad === 0, bad + ' violations');
    })();

    // ── L6 · associativity within rounding (uncapped) — flatten ≡ nest ──
    (function () {
      var bad = 0, tested = 0;
      for (var s = 1; s <= 60; s++) {
        var a = +(rng(s)() * 0.4).toFixed(3), b = +(rng(s + 100)() * 0.4).toFixed(3), c = +(rng(s + 200)() * 0.4).toFixed(3);
        var flat = CC([a, b, c]), nest = CC([CC([a, b]), c]);
        if (flat == null || flat >= 0.97) continue; tested++;
        if (Math.abs(flat - nest) > TOL) bad++;
      }
      T.ok('associative within 3-dp rounding (' + tested + ' triples)', bad === 0, bad + ' violations');
    })();

    // ── L7 · the cap law has TEETH — extreme inputs land EXACTLY at 0.97, and a
    //         naive (wrong) additive blend would have blown past it ──
    (function () {
      var strong = [0.9, 0.9, 0.9];
      T.ok('strong evidence saturates exactly at the 0.97 cap', CC(strong) === 0.97, 'got ' + CC(strong));
      var naiveSum = strong.reduce(function (a, b) { return a + b; }, 0); // 2.7 — a wrong blend
      T.ok('cap has teeth — naive additive blend (2.7) would violate ≤0.97', naiveSum > 0.97 && CC(strong) <= 0.97);
      T.ok('single source passes through (≤ cap, 3dp)', CC([0.42]) === 0.42 && CC([0.985]) === 0.97);
    })();
  });

  /* ════ 25 · UNITS AS QUANTITIES — Baevsky SI/CSI unit guard (brief Phase 6) ════
     SI/metric is canonical; conversion happens only at the I/O edge; you cannot
     add mmHg to bpm. The flagship catch: a ms-vs-s Baevsky Mode/MxDMn input must
     be bounded/converted, NEVER silently mis-scaled (d_si divides by BOTH → up to
     10⁶×). Pure CORE module (quantity.js); ready to wire at the HRVDex summary
     ingest in its Phase-9 pass. Additive — no node touched. */
  group('Units as quantities — Baevsky guard (Phase 6)', 'quantity · units-boundary', function (T) {
    var Q = env.DexUnits;
    T.ok('DexUnits + Quantity present', !!(Q && Q.Quantity && Q.guardBaevsky));
    if (!(Q && Q.Quantity)) return;
    var approxEq = function (a, b, tol) { return a != null && b != null && Math.abs(a - b) <= (tol == null ? 1e-6 : tol); };

    // ── boundary conversions round-trip (metric is stored; imperial is display) ──
    T.ok('kg↔lb round-trips', approxEq(Q.Quantity(80, 'kg').as('lb'), 176.37, 0.01));
    T.ok('lb input stored as metric kg', approxEq(Q.Quantity(176.37, 'lb').value, 80, 0.001));
    T.ok('cm stored as metres', approxEq(Q.Quantity(180, 'cm').value, 1.8, 1e-9));
    T.ok('°F→°C boundary', approxEq(Q.toMetric(98.6, 'F'), 37, 1e-6));
    T.ok('mg/dL→mmol/L glucose boundary', approxEq(Q.toMetric(90, 'mg/dL'), 4.994, 0.002));
    T.ok('ms→s boundary', approxEq(Q.toMetric(800, 'ms'), 0.8, 1e-9));

    // ── dimension safety: cannot add across dimensions (mmHg + bpm) ──
    var threw = false;
    try { Q.Quantity(120, 'mmHg').add(Q.Quantity(60, 'bpm')); } catch (e) { threw = true; }
    T.ok('adding mmHg + bpm throws (dimension mismatch)', threw);
    var threw2 = false;
    try { Q.Quantity(70, 'kg').as('bpm'); } catch (e) { threw2 = true; }
    T.ok('expressing kg as bpm throws', threw2);

    // ── asSecondsRR: seconds pass through, ms band is converted + tagged ──
    var s = Q.asSecondsRR(0.8), ms = Q.asSecondsRR(800), bad = Q.asSecondsRR(50000);
    T.ok('0.8 treated as seconds (no convert)', s.valueS === 0.8 && s.assumedMs === false && s.flagged === false);
    T.ok('800 treated as ms → 0.8 s (tagged assumedMs)', approxEq(ms.valueS, 0.8) && ms.assumedMs === true && ms.flagged === false);
    T.ok('implausible RR value is FLAGGED, not silently used', bad.flagged === true);

    // ── THE CATCH: a ms vs s Baevsky input must yield the SAME guarded SI ──
    var amo50 = 40;
    var siSeconds = Q.baevskySI(amo50, 0.8, 0.3);                 // canonical seconds input
    var gMs = Q.guardBaevsky(800, 300);                           // same physiology, vendor sent ms
    var siGuardedMs = Q.baevskySI(amo50, gMs.modeS, gMs.mxdmnS);
    T.ok('guardBaevsky converts ms inputs (assumedMs)', gMs.assumedMs === true && approxEq(gMs.modeS, 0.8) && approxEq(gMs.mxdmnS, 0.3));
    T.ok('guarded ms SI ≡ seconds SI (no 10⁶× mis-scale)', approxEq(siGuardedMs, siSeconds, 1e-9), 'si=' + siGuardedMs);
    T.approx('Baevsky SI sanity (amo50=40, mode=0.8s, mxdmn=0.3s)', siSeconds, 83.33, 0.1);

    // ── teeth: the UNGUARDED ms path is the catastrophic bug the guard prevents ──
    var siUnguardedMs = Q.baevskySI(amo50, 800, 300);            // what the current node would compute
    T.ok('unguarded ms SI is wrong by ~10⁶× (the prevented bug)', siUnguardedMs != null && (siSeconds / siUnguardedMs) > 1e5, 'ratio=' + (siSeconds / siUnguardedMs).toExponential(1));
    T.ok('guard ELIMINATES that error', Math.abs(siGuardedMs - siSeconds) < 1e-6 && Math.abs(siUnguardedMs - siSeconds) > 1);

    // ── seconds input is untouched (no false conversion of correct data) ──
    var gS = Q.guardBaevsky(0.8, 0.3);
    T.ok('seconds Baevsky input passes through unchanged', gS.assumedMs === false && approxEq(gS.modeS, 0.8) && approxEq(gS.mxdmnS, 0.3) && gS.flagged === false);
  });

  /* ════ 26 · DIFFERENTIAL TESTING — redundant RR/HRV nodes agree (brief Phase 5) ════
     Turn the suite's independent RR/HRV paths from a drift RISK into a cross-check
     ORACLE: feed the SAME synthetic NN-interval truth through TWO nodes' own
     time-domain HRV code and assert agreement (brief §Phase 5, generalizing the
     three-cornered-hat idea from sensors to CODE). ECGDex (ECGDSP.rmssd/std) and
     PpgDex (PPGDSP.timeDomain) are both loaded + namespaced; PulseDex/HRVDex are
     bare globals (not co-loadable — their formula conformance is source-mirror-
     checked elsewhere and they JOIN this oracle once migrated, Phase 9).
     SDNN was UNIFIED fleet-wide to sample SD (÷N−1, HRV Task Force / Kubios) on
     2026-06-24 — ECGDex/PulseDex were ÷N, now all nodes match PpgDex/HRVDex. This
     oracle now asserts DIRECT rMSSD + SDNN agreement (ratio→1); a future estimator
     drift in either node turns it red. */
  group('Differential — ECGDex ↔ PpgDex HRV agreement (Phase 5)', 'ecgdex-dsp · ppgdex-dsp · differential', function (T) {
    var E = env.ECGDSP, P = env.PPGDSP;
    var have = !!(E && typeof E.rmssd === 'function' && typeof E.std === 'function' && P && typeof P.timeDomain === 'function');
    T.ok('ECGDSP.rmssd/std + PPGDSP.timeDomain present', have);
    if (!have) return;
    function rng(seed) { var s = seed >>> 0; return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    // a coherent physiological NN series: ~830 ms mean + AR(1) beat-to-beat wander + RSA ripple.
    function genNN(seed, n) { var r = rng(seed), base = 760 + r() * 220, nn = [], prev = 0; for (var i = 0; i < n; i++) { prev = 0.6 * prev + (r() - 0.5) * 70; nn.push(+(base + prev + 18 * Math.sin(i / 3.2)).toFixed(0)); } return nn; }
    // canonical reference formulas (the third corner) — sample SD, the unified convention.
    function refMean(a) { for (var s = 0, i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
    function refRmssd(a) { for (var s = 0, n = 0, i = 1; i < a.length; i++) { var d = a[i] - a[i - 1]; s += d * d; n++; } return Math.sqrt(s / n); }
    function refStdSample(a) { var m = refMean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }

    var N = 120, badRm = 0, badSd = 0, badMean = 0, badRef = 0, tested = 0;
    var teethOK = false;
    for (var seed = 1; seed <= 30; seed++) {
      var nn = genNN(seed, N);
      var ecgRm = E.rmssd(nn), ecgSd = E.std(nn);               // ECGDex: now sample SD
      var ppg = P.timeDomain(nn);                                // PpgDex: sample SD, 1-dp rounded
      var ref = { rm: refRmssd(nn), sdSample: refStdSample(nn), mean: refMean(nn) };
      tested++;
      // rMSSD: identical formula across nodes → agree to rounding (PPG rounds 1 dp).
      if (Math.abs(ecgRm - ppg.rmssd) > 0.1) badRm++;
      if (Math.abs(ecgRm - ref.rm) > 1e-6) badRef++;            // ECG ≡ canonical exactly
      // SDNN: BOTH now sample SD → agree DIRECTLY (no conversion factor).
      if (Math.abs(ecgSd - ppg.sdnn) > 0.1) badSd++;
      if (Math.abs(ecgSd - ref.sdSample) > 1e-6) badRef++;      // ECG ≡ canonical sample SD exactly
      // meanRR / HR: same mean formula → agree.
      if (Math.abs(refMean(nn) - ppg.meanRR) > 0.6) badMean++;
      // teeth: a 10% drift in one node's rMSSD must EXCEED the agreement tolerance.
      if (Math.abs(ecgRm * 1.1 - ppg.rmssd) > 0.1) teethOK = true;
    }
    T.ok('rMSSD agrees ECGDex ↔ PpgDex across ' + tested + ' series (≤0.1 ms)', badRm === 0, badRm + ' mismatches');
    T.ok('rMSSD ≡ canonical + SDNN ≡ canonical sample SD (ECGDex)', badRef === 0, badRef + ' mismatches');
    T.ok('SDNN agrees ECGDex ↔ PpgDex DIRECTLY post-unify (≤0.1 ms)', badSd === 0, badSd + ' mismatches');
    T.ok('meanRR agrees ECGDex ↔ PpgDex (≤0.6 ms)', badMean === 0, badMean + ' mismatches');
    T.ok('differential has teeth — a 10% rMSSD drift would be caught', teethOK === true);

    // SDNN estimator is now UNIFIED — pin ratio ≈ 1 so a node silently reverting to ÷N turns it red.
    var nn0 = genNN(7, N);
    var ratio = P.timeDomain(nn0).sdnn / E.std(nn0);
    T.approx('SDNN ratio ECGDex:PpgDex = 1.000 (unified sample SD)', ratio, 1.0, 0.004, 'ratio=' + ratio.toFixed(4));
  });

  /* ════ EXPORT-IDENTITY §2.1 — content-addressed recording handle (CORE) ════ */
  group('EXPORT-IDENTITY — recording contentId (CORE)', 'signal-frame', function (T) {
    var SF = env.SignalFrame;
    if (!SF || typeof SF.toSignalFrame !== 'function' || typeof SF.computeContentId !== 'function') {
      T.ok('SignalFrame.computeContentId present', false, 'signal-frame.js not loaded / helper missing'); return;
    }
    var t0 = U(2026, 5, 13, 20, 44, 0);
    var ivs = [812, 805, 798, 820, 811, 799, 803, 808, 791, 815, 800, 806];
    var mk = function (files) { return SF.toSignalFrame('rr', { vals: ivs.slice(), t0Ms: t0, usable: true }, { adapter: 'polar-rr', vendor: 'Polar', files: files }); };
    var a = mk(['Polar_H10_AAAAAAAA_20260613_204448_RR.txt']);
    var b = mk(['totally_different_name.txt']);
    T.ok('contentId is a 12-hex digest', typeof a.contentId === 'string' && /^[0-9a-f]{12}$/.test(a.contentId), a.contentId);
    T.eq('deterministic — same recording → same id', SF.computeContentId(mk(['x_RR.txt'])), a.contentId);
    T.eq('filename-independent — id ignores provenance.files', b.contentId, a.contentId);
    // viewer-TZ independence: the id folds the NUMERIC floating t0Ms (never a Date/getHours) →
    // a frame with the SAME t0Ms always yields the SAME id; there is no host-TZ term in the digest.
    T.eq('TZ-independent — id is a pure function of t0Ms+payload', SF.computeContentId(mk([])), a.contentId);
    // collide-resist: a genuinely different recording (different intervals) → different id
    var diff = SF.toSignalFrame('rr', { vals: [600, 615, 622, 605, 618, 611, 599, 620, 608, 612, 601, 617], t0Ms: t0, usable: true }, { adapter: 'x' });
    T.ok('two different recordings → different id', diff.contentId !== a.contentId, diff.contentId + ' vs ' + a.contentId);
    var night2 = SF.toSignalFrame('rr', { vals: ivs.slice(), t0Ms: t0 + 864e5, usable: true }, { adapter: 'x' });
    T.ok('different t0Ms (different night, same beats) → different id', night2.contentId !== a.contentId);
    // honesty: NEVER fabricate an id over an empty/absent recording (invariant #4)
    var dead = SF.toSignalFrame('rr', { vals: [], t0Ms: null, usable: false, reason: 'no intervals' }, { adapter: 'x' });
    T.eq('unusable/empty frame → contentId null (no fabrication)', dead.contentId, null);
    // additive + accepted by the schema: a frame carrying contentId still validates ok
    T.ok('frame carrying contentId validates ok', SF.validateFrame(a).ok === true, SF.validateFrame(a).errors.join('; '));
    // an irregular cgm-style samples frame also gets a deterministic 12-hex id
    var s0 = U(2026, 4, 23, 0, 0, 0);
    var sf1 = SF.toSignalFrame('cgm', { samples: [{ tMs: s0, v: 95 }, { tMs: s0 + 3e5, v: 101 }, { tMs: s0 + 6e5, v: 110 }], tsMs: [s0, s0 + 3e5, s0 + 6e5], t0Ms: s0, usable: true }, { adapter: 'libre-cgm' });
    T.ok('cgm samples frame → 12-hex id', typeof sf1.contentId === 'string' && /^[0-9a-f]{12}$/.test(sf1.contentId), sf1.contentId);
  });

  /* ════ EXPORT-IDENTITY §2.2 — PHI-free filename scrub at the ingest boundary ════ */
  group('EXPORT-IDENTITY — PHI-free filename scrub (CORE)', 'signal-frame', function (T) {
    var SF = env.SignalFrame;
    if (!SF || typeof SF.scrubFilename !== 'function') { T.ok('SignalFrame.scrubFilename present', false); return; }
    var S = SF.scrubFilename;
    T.eq('PHI name "Jane_Smith_2026-06-12_RR.txt" → lane+ext only', S('Jane_Smith_2026-06-12_RR.txt'), 'RR.txt');
    T.ok('scrub drops the patient name', S('Jane_Smith_2026-06-12_RR.txt').toLowerCase().indexOf('jane') < 0 && S('Jane_Smith_2026-06-12_RR.txt').toLowerCase().indexOf('smith') < 0);
    T.eq('Polar H10 RR — device serial stripped, vendor+lane kept', S('Polar_H10_AAAAAAAA_20260613_204448_RR.txt'), 'polar_RR.txt');
    T.eq('Polar Verity PPG — serial stripped', S('Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt'), 'polar_PPG.txt');
    T.eq('O2Ring CSV → vendor+ext', S('O2Ring S 2100_20260612230016.csv'), 'o2ring.csv');
    T.eq('Welltory CSV → vendor+ext (HRV is not a lane tag)', S('WELLTORY_HRV_DATA_EXPORT_20_May_2026.csv'), 'welltory.csv');
    T.eq('Abbott Lingo CSV → vendor+ext', S('lingo-glucose-data-2026-MAY-23.csv'), 'lingo.csv');
    T.ok('no digit run (date/serial) survives', !/[0-9]/.test(S('Polar_H10_AAAAAAAA_20260613_204448_RR.txt')));
    T.eq('unrecognised stem → scrubbed marker + ext', S('my-private-notes.txt'), '*.txt');
    // toSignalFrame applies the scrub at the boundary → provenance.files is identity-free
    var fr = SF.toSignalFrame('rr', { vals: [800, 810, 795, 805, 812, 798, 802, 809, 791, 806, 800], t0Ms: U(2026, 5, 13), usable: true }, { adapter: 'polar-rr', vendor: 'Polar', files: ['Jane_Smith_2026-06-13_RR.txt'] });
    T.eq('toSignalFrame scrubs provenance.files', JSON.stringify(fr.provenance.files), JSON.stringify(['RR.txt']));
    T.ok('scrubbed frame still validates', SF.validateFrame(fr).ok === true, SF.validateFrame(fr).errors.join('; '));
    // a companion bundle → each entry scrubbed, lanes preserved (no collapse, 1:1)
    var multi = SF.toSignalFrame('ecg', { samples: new Int16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), fs: 130, t0Ms: U(2026, 5, 17), usable: true }, { adapter: 'polar-h10-ecg', files: ['Pat_Doe_ECG.txt', 'Pat_Doe_ACC.txt'] });
    T.eq('companion lanes preserved + scrubbed', JSON.stringify(multi.provenance.files), JSON.stringify(['ECG.txt', 'ACC.txt']));
  });

  /* ════ EXPORT-HYGIENE §2 — shared recording-anchored export filename ════ */
  group('EXPORT-HYGIENE — exportName (recording-anchored, TZ-independent)', 'dex-export', function (T) {
    var DX = env.DexExport || (env.exportName ? { exportName: env.exportName, EXPORT_KINDS: env.EXPORT_KINDS } : null);
    if (!DX || typeof DX.exportName !== 'function') { T.ok('dex-export.js loaded (exportName present)', false, 'add dex-export.js to both runners'); return; }
    var EN = DX.exportName;
    var t0 = U(2026, 5, 13, 20, 44, 30, 0);   // 2026-06-13 20:44:30 floating
    T.eq('ganglior json = anchor date+HHMM', EN({ node: 'PulseDex', t0Ms: t0, kind: 'ganglior', ext: 'json' }), 'PulseDex_2026-06-13_2044_ganglior.json');
    T.eq('summary csv name', EN({ node: 'PulseDex', t0Ms: t0, kind: 'summary', ext: 'csv' }), 'PulseDex_2026-06-13_2044_summary.csv');
    T.eq('series json (NO count suffix)', EN({ node: 'PulseDex', t0Ms: t0, kind: 'series', ext: 'json' }), 'PulseDex_2026-06-13_2044_series.json');
    // an anchor in the small-hours of the NEXT civil day names THAT night (not the export-click day)
    T.eq('overnight anchor names its own night', EN({ node: 'PulseDex', t0Ms: U(2026, 5, 14, 1, 5, 0), kind: 'ganglior', ext: 'json' }), 'PulseDex_2026-06-14_0105_ganglior.json');
    // TZ-independence: getUTC* → a fixed t0Ms maps to ONE string on any machine
    T.eq('03:00 floating reads 0300 (UTC getters, not local)', EN({ node: 'OxyDex', t0Ms: U(2026, 0, 1, 3, 0, 0), kind: 'summary', ext: 'json' }), 'OxyDex_2026-01-01_0300_summary.json');
    // missing t0Ms → literal `undated`, NEVER a fabricated now()
    T.eq('null t0Ms → undated', EN({ node: 'PulseDex', t0Ms: null, kind: 'summary', ext: 'json' }), 'PulseDex_undated_summary.json');
    T.eq('NaN t0Ms → undated', EN({ node: 'PulseDex', t0Ms: NaN, kind: 'ganglior', ext: 'json' }), 'PulseDex_undated_ganglior.json');
    T.ok('undated name carries no digits (no fabricated date)', !/[0-9]/.test(EN({ node: 'PulseDex', t0Ms: null, kind: 'summary', ext: 'csv' })));
    // span-aware (brief §2.4): first night + N-day span instead of a misleading single HHMM
    T.eq('span window name (HRVDex)', EN({ node: 'HRVDex', t0Ms: U(2026, 4, 1, 7, 0, 0), kind: 'summary', ext: 'csv', spanDays: 29 }), 'HRVDex_2026-05-01_29d_summary.csv');
    T.eq('spanDays rounds to integer days', EN({ node: 'HRVDex', t0Ms: U(2026, 4, 1, 7, 0, 0), kind: 'series', ext: 'jsonl', spanDays: 6.8 }), 'HRVDex_2026-05-01_7d_series.jsonl');
    // controlled vocabulary is CLOSED (collapses the _summary/_multi<N>/_ganglior/.node-export drift)
    T.eq('EXPORT_KINDS vocabulary is closed', JSON.stringify(DX.EXPORT_KINDS), JSON.stringify(['ganglior', 'summary', 'series', 'report']));
    // EXPORT-HYGIENE-FOLLOWUPS-II §1: OPTIONAL recording.contentId disambiguator — appended `_<contentId>`
    // AFTER the kind segment, BEFORE the extension (the brief's worked example). Suffix present IFF given.
    T.eq('contentId suffix appends after kind, before ext', EN({ node: 'PulseDex', t0Ms: t0, kind: 'ganglior', ext: 'json', contentId: 'a1610b5737c2' }), 'PulseDex_2026-06-13_2044_ganglior_a1610b5737c2.json');
    T.eq('contentId rides the span-aware stamp too', EN({ node: 'HRVDex', t0Ms: U(2026, 4, 1, 7, 0, 0), kind: 'series', ext: 'jsonl', spanDays: 29, contentId: 'deadbeef0001' }), 'HRVDex_2026-05-01_29d_series_deadbeef0001.jsonl');
    T.eq('contentId rides an undated name', EN({ node: 'PulseDex', t0Ms: null, kind: 'summary', ext: 'json', contentId: 'abc123' }), 'PulseDex_undated_summary_abc123.json');
    // OPTIONAL: omit / empty / non-string → name UNCHANGED (non-adopting nodes + interop files untouched)
    T.eq('omitted contentId → name unchanged', EN({ node: 'PulseDex', t0Ms: t0, kind: 'ganglior', ext: 'json' }), 'PulseDex_2026-06-13_2044_ganglior.json');
    T.eq('empty-string contentId → no suffix', EN({ node: 'PulseDex', t0Ms: t0, kind: 'ganglior', ext: 'json', contentId: '' }), 'PulseDex_2026-06-13_2044_ganglior.json');
    T.eq('null contentId → no suffix (a node lastResult.contentId may be null)', EN({ node: 'PulseDex', t0Ms: t0, kind: 'summary', ext: 'csv', contentId: null }), 'PulseDex_2026-06-13_2044_summary.csv');
    // sanitized to [a-z0-9] (filename-safe, like ext) — a stray slash/dot can't escape the filename
    T.eq('contentId sanitized to filename-safe [a-z0-9]', EN({ node: 'PulseDex', t0Ms: t0, kind: 'ganglior', ext: 'json', contentId: 'A1/B2.C3' }), 'PulseDex_2026-06-13_2044_ganglior_a1b2c3.json');
    // source mirror — reads the clock back via getUTC*, NEVER local getters / now() (the bug it fixes)
    var src = (env.sources || {})['dex-export.js'];
    if (src) {
      // scan CODE only — the doc header names `new Date()`/`getHours()` as the bug it FIXES, so a
      // raw-source scan would false-positive on the comment. Strip block comments first.
      var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      T.ok('dex-export.js uses getUTC* (Clock Contract §5)', /getUTCFullYear|getUTCHours/.test(code));
      T.ok('dex-export.js has NO local date getters (no viewer-TZ leak)', !/\.getHours\(|\.getMonth\(|\.getDate\(|\.getFullYear\(|\.getMinutes\(/.test(code));
      T.ok('dex-export.js never falls back to now() for the stamp', !/new Date\(\)/.test(code));
    } else {
      T.ok('dex-export.js source available (env.sources)', false, 'add it to both runners');
    }
  });

  /* ════ EXPORT-IDENTITY-FOLLOWUPS §2 — provenance inputs[].name PHI scrub ════
     ganglior-provenance.js noteInput() captured file.name VERBATIM into
     schema.provenance.inputs[].name — a SECOND PHI pipe past the parent's
     provenance.files scrub. Now it scrubs the name via a byte-faithful mirror of
     SignalFrame.scrubFilename. ganglior-provenance.js is browser-only (window /
     FileReader hooks), so this is a source-mirror gate (like the parseTimestamp
     mirrors) + a functional check on the runnable SignalFrame.scrubFilename. ════ */
  group('EXPORT-IDENTITY-FOLLOWUPS §2 — provenance inputs[].name scrub', 'ganglior-provenance · signal-frame', function (T) {
    var gp = (env.sources || {})['ganglior-provenance.js'] || '';
    var sf = (env.sources || {})['signal-frame.js'] || '';
    if (!gp) { T.ok('ganglior-provenance.js source available (env.sources)', false, 'add it to both runners'); return; }
    // (a) noteInput stamps a SCRUBBED name; the raw `file.name||null` capture is gone.
    T.ok('noteInput stamps scrubFilename(file.name) into the exported record', /name:\s*scrubFilename\(file\.name\)/.test(gp));
    T.ok('the raw `name: file.name||null` capture is GONE (no PHI pipe left)', !/name:\s*file\.name\s*\|\|\s*null/.test(gp));
    // (b) the dedupe KEY still uses the raw name — internal only, never exported (precision preserved).
    T.ok('dedupe key still uses raw file.name (internal, not exported)', /key\s*=\s*\(file\.name\s*\|\|\s*'\?'\)/.test(gp));
    // (c) the scrub is a byte-faithful MIRROR of SignalFrame.scrubFilename — pin them so neither drifts.
    if (sf) {
      var clip = function (s) { var i = s.indexOf('var _VENDOR_SIG = ['); if (i < 0) return null; var j = s.indexOf("return ext ? (stem + '.' + ext) : stem;", i); return j < 0 ? null : s.slice(i, j); };
      var a = clip(gp), b = clip(sf);
      T.ok('ganglior-provenance carries the scrubFilename block', !!a);
      T.ok('signal-frame carries the scrubFilename block', !!b);
      T.eq('ganglior-provenance scrubFilename is byte-identical to SignalFrame.scrubFilename (no drift)', a, b);
    }
    // (d) functional (the runnable mirror): the exact PHI names the parent tested reduce to lane+ext —
    //     the same scrub ganglior-provenance now applies to inputs[].name.
    var SF = env.SignalFrame;
    if (SF && typeof SF.scrubFilename === 'function') {
      T.eq('PHI "Jane_Smith_2026-06-12_RR.txt" → "RR.txt"', SF.scrubFilename('Jane_Smith_2026-06-12_RR.txt'), 'RR.txt');
      T.eq('device-serial "Polar_H10_AAAAAAAA_..._RR.txt" → "polar_RR.txt"', SF.scrubFilename('Polar_H10_AAAAAAAA_20260613_204448_RR.txt'), 'polar_RR.txt');
      T.ok('no digit run (date/serial) survives the scrub', !/[0-9]/.test(SF.scrubFilename('Polar_H10_AAAAAAAA_20260613_204448_RR.txt')));
    }
  });

  /* ════ EXPORT-IDENTITY-FOLLOWUPS §1 — node adoption of recording.contentId ════
     PulseDex is the first node to surface the CORE content-addressed handle in its
     ganglior export. pdComputeResult computes it via SignalFrame.computeContentId
     (signal-frame.js is bundled into PulseDex for this); pdBuildNodeExport copies it
     into recording.contentId. Source-mirror (pulsedex bare globals aren't headless-
     loadable) + a functional check that the committed equiv fixture carries it. ════ */
  group('EXPORT-IDENTITY-FOLLOWUPS §1 — PulseDex surfaces recording.contentId', 'pulsedex-dsp · signal-frame', function (T) {
    var dsp = (env.sources || {})['pulsedex-dsp.js'] || '';
    if (!dsp) { T.ok('pulsedex-dsp.js source available (env.sources)', false, 'add it to both runners'); return; }
    T.ok('pdBuildNodeExport emits recording.contentId', /contentId:\s*r\.contentId\s*\?\?\s*null/.test(dsp));
    T.ok('contentId computed via the CORE SignalFrame.computeContentId (not a node-local copy)', /SignalFrame\.computeContentId\(/.test(dsp));
    // functional: the committed equiv fixture now carries a deterministic 12-hex identity-free id.
    var fx = (env.equiv && env.equiv.pulsedex && env.equiv.pulsedex.fixture) || null;
    if (fx && fx.recording) {
      T.ok('equiv fixture recording.contentId is a 12-hex digest', typeof fx.recording.contentId === 'string' && /^[0-9a-f]{12}$/.test(fx.recording.contentId), String(fx.recording.contentId));
    }
    // additive on the FROZEN schema: contentId is a NEW recording field; schema.name untouched.
    if (fx && fx.schema) T.eq('schema.name still ganglior.node-export (frozen, untouched)', fx.schema.name, 'ganglior.node-export');
  });

  /* ── self-test: the section-filter matcher (rides both runners) ── */
  group('group-filter — dexGroupMatcher (section-scoped runs)', 'live mirror · test-infra', function (T) {
    var mk = dexGroupMatcher;
    T.ok('null filter → matches everything', mk(null)('Anything', 'tag') === true);
    T.ok('empty filter → matches everything', mk('')('Anything', 'tag') === true);
    T.ok('substring matches title (case-insensitive)', mk('oxydex')('OxyDex ODI-4 caveat', '') === true);
    T.ok('substring matches tag (case-insensitive)', mk('ecgdex.html')('Render coverage', 'browser-only · ECGDex.html') === true);
    T.ok('non-match → false', mk('glucodex')('OxyDex ODI-4 caveat', 'oxydex-registry') === false);
    T.ok('comma = OR', mk('glucodex,oxydex')('OxyDex ODI-4 caveat', '') === true);
    T.ok('regex alternation', mk('oxy|ecg')('ECGDex crossnight', '') === true);
    T.ok('invalid regex falls back to literal substring', mk('a(b')('x a(b y', '') === true);
  });

  var _filter = env.groupFilter != null ? String(env.groupFilter).trim() : '';
  if (_filter) {
    var _match = dexGroupMatcher(_filter);
    var _sel = GROUPS.filter(function (G) { return _match(G.title, G.tag); });
    return { groups: _sel, groupFilter: _filter, totalGroups: GROUPS.length };
  }
  return { groups: GROUPS, groupFilter: null, totalGroups: GROUPS.length };
  function countNonFinite(o) {
    var bad = 0;
    (function walk(v) {
      if (v == null) return;
      if (typeof v === 'number') { if (!isFinite(v)) bad++; return; }
      if (typeof v === 'object') { for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k]); }
    })(o);
    return bad;
  }

  function isFin(x) { return typeof x === 'number' && isFinite(x); }

  function checkEvents(T, label, events, startEpochMs) {
    T.ok(label + ': ganglior_events is an array', Array.isArray(events));
    if (!Array.isArray(events) || !events.length) return;
    var bad = 0, tFmt = 0, confBad = 0, tMsBad = 0, tMsChecked = 0;
    var clk = /^(\d{2}):(\d{2}):(\d{2})$/;
    events.forEach(function (e) {
      if (!e || typeof e.impulse !== 'string' || typeof e.node !== 'string') bad++;
      if (!e || typeof e.t !== 'string' || !clk.test(e.t)) tFmt++;
      if (!e || typeof e.conf !== 'number' || e.conf < 0 || e.conf > 1) confBad++;
      // floating-clock consistency on REAL data: tMs's UTC clock must equal t
      if (e && isFin(e.tMs) && typeof e.t === 'string' && clk.test(e.t)) {
        tMsChecked++;
        var d = new Date(e.tMs), m = e.t.match(clk);
        var hh = ('0' + d.getUTCHours()).slice(-2), mm = ('0' + d.getUTCMinutes()).slice(-2), ss = ('0' + d.getUTCSeconds()).slice(-2);
        if (!(hh === m[1] && mm === m[2] && ss === m[3])) tMsBad++;
      }
    });
    T.ok(label + ': every event has impulse+node strings', bad === 0, bad + ' malformed');
    T.ok(label + ': every event t is "HH:MM:SS"', tFmt === 0, tFmt + ' bad clocks');
    T.ok(label + ': every event conf ∈ [0,1]', confBad === 0, confBad + ' out-of-range');
    if (tMsChecked) T.ok(label + ': event tMs ↔ t agree (floating-clock, getUTC*)', tMsBad === 0, tMsBad + '/' + tMsChecked + ' mismatched');
  }

  function validateExport(T, key, json) {
    // OxyDex night-array summary
    if (Array.isArray(json)) {
      T.ok(key + ': night array non-empty', json.length > 0);
      json.slice(0, 3).forEach(function (nt, i) {
        var p = key + ' night[' + i + ']';
        T.ok(p + ': date string', typeof nt.date === 'string');
        T.ok(p + ': t0Ms finite', isFin(nt.t0Ms));
        T.ok(p + ': stats.meanSpo2 finite', nt.stats && isFin(nt.stats.meanSpo2));
        T.ok(p + ': stats.minSpo2 finite', nt.stats && isFin(nt.stats.minSpo2));
        T.ok(p + ': stats.n finite', nt.stats && isFin(nt.stats.n));
        T.ok(p + ': summary.impression present', nt.summary && typeof nt.summary.impression === 'string' && nt.summary.impression.length > 0);
        T.ok(p + ': summary.ranked is array', nt.summary && Array.isArray(nt.summary.ranked));
      });
      T.ok(key + ': no NaN/Infinity anywhere', countNonFinite(json) === 0, countNonFinite(json) + ' bad numbers');
      return;
    }
    // node export (full or slim) / fusion
    var s = json.schema || {};
    if (s.name === 'ganglior.node-export') {
      T.ok(key + ': schema.node is a string', typeof s.node === 'string' && s.node.length > 0);
      T.ok(key + ': recording present', json.recording && typeof json.recording === 'object');
      if (json.recording) T.ok(key + ': recording.startEpochMs finite (dated export)', isFin(json.recording.startEpochMs), 'value=' + json.recording.startEpochMs);
      // HRV nodes: hrv.time core values populated
      if (json.hrv && json.hrv.time) {
        var ht = json.hrv.time;
        T.ok(key + ': hrv.time.rmssd finite', isFin(ht.rmssd));
        T.ok(key + ': hrv.time.sdnn finite', isFin(ht.sdnn));
      }
      checkEvents(T, key, json.ganglior_events, json.recording && json.recording.startEpochMs);
      T.ok(key + ': no NaN/Infinity anywhere', countNonFinite(json) === 0, countNonFinite(json) + ' bad numbers');
      return;
    }
    // slim ganglior events export { bus|schema, node, startEpochMs?, events|ganglior_events }
    if (json.bus || json.node || json.ganglior_events || json.events) {
      T.ok(key + ': node string', typeof json.node === 'string');
      if ('startEpochMs' in json && json.startEpochMs != null) T.ok(key + ': startEpochMs finite when present', isFin(json.startEpochMs));
      checkEvents(T, key, json.ganglior_events || json.events, json.startEpochMs);
      T.ok(key + ': no NaN/Infinity anywhere', countNonFinite(json) === 0);
      return;
    }
    // fusion export
    if (json.kind === 'fusion' || (json.window && json.findings)) {
      T.ok(key + ': window present', json.window && typeof json.window === 'object');
      T.ok(key + ': no NaN/Infinity anywhere', countNonFinite(json) === 0);
      return;
    }
    T.ok(key + ': recognized export shape', false, 'unknown schema — add a contract');
  }
}

root.runDexTests = runDexTests;
root.dexGroupMatcher = dexGroupMatcher;
if (typeof module !== 'undefined' && module.exports) module.exports = { runDexTests: runDexTests, dexGroupMatcher: dexGroupMatcher };

})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
