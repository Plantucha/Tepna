/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   qrs-yield-analysis.js — figure engine for the candidate paper
   "QRS / pulse beat-yield under apnea: the perfusion gap consumer pulse
    detectors miss while signal-quality stays green (FULL lane)."

   Orchestrates a small pool of qrs-yield-worker.js realms (the FULL-lane ECGDex
   + PpgDex pipelines), one ~9-min apnea-cluster window per patient per arm, and
   matches the REAL detectors' beats against the master-timeline ground-truth
   beats. Per window it returns recall (yield) stratified by apnea vs clean state,
   the per-beat SQI the detector reported in those same segments, and the
   detected-vs-true rMSSD. Aggregated → three figures + tables.

   HONEST FRAMING (in-page + export): synthetic ground truth. The apnea beats are
   the generator's perfusion model (PPG pulse amplitude ×0.30 in apnea); this
   certifies that the ECG arm is yield-robust and isolates the modest PPG apnea
   yield dip + over-detection and the resulting HRV bias — not a real-patient miss rate.
   100% local; reuses synth-gen.js + cohort-gen.js + cohort-full.js + the real DSP.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ARMS = ['ECG', 'PPG'];
  var META = {
    ECG: { label: 'ECGDex', sub: 'Pan–Tompkins QRS', color: '#58A6FF', node: 'ECGDex' },
    PPG: { label: 'PpgDex', sub: 'optical pulse', color: '#FFB84D', node: 'PpgDex' }
  };

  var WIN = { ECG: [], PPG: [] }; // per-arm window records
  var workers = [],
    RESULT = null;

  function $(id) {
    return document.getElementById(id);
  }
  function setStatus(t, c) {
    var e = $('status');
    e.textContent = t;
    e.className = 'pill ' + (c || 'idle');
  }
  function setProg(f) {
    $('progBar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%';
  }

  // ── worker pool ──
  function bootPool(n) {
    workers = [];
    var readies = [];
    for (var i = 0; i < n; i++) {
      (function () {
        var w = new Worker('qrs-yield-worker.js');
        var rec = { w: w, ready: false, err: null, busy: false };
        readies.push(
          new Promise(function (res) {
            w.onmessage = function (ev) {
              var m = ev.data || {};
              if (m.type === 'ready') {
                rec.ready = !m.err;
                rec.err = m.err || null;
                res();
              }
            };
          })
        );
        workers.push(rec);
        w.postMessage({ type: 'init' });
      })();
    }
    return Promise.all(readies);
  }
  function runSeeds(seeds, onProg) {
    return new Promise(function (resolve) {
      var idx = 0,
        done = 0,
        total = seeds.length;
      function pump(rec) {
        if (CANCEL || idx >= total) {
          if (
            !workers.some(function (r) {
              return r.busy;
            })
          )
            resolve();
          return;
        }
        var seed = seeds[idx++];
        rec.busy = true;
        rec.w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type !== 'done') return;
          if (m.result) collect(m.result);
          done++;
          onProg(done / total);
          rec.busy = false;
          if (CANCEL) {
            if (
              !workers.some(function (r) {
                return r.busy;
              })
            )
              resolve();
            return;
          }
          if (done >= total) {
            resolve();
            return;
          }
          pump(rec);
        };
        rec.w.postMessage({ type: 'job', reqId: seed, seed: seed });
      }
      workers.forEach(function (rec) {
        if (rec.ready) pump(rec);
      });
      if (
        !workers.some(function (r) {
          return r.ready;
        })
      )
        resolve();
    });
  }
  function collect(res) {
    if (res.ecg) WIN.ECG.push(res.ecg);
    if (res.ppg) WIN.PPG.push(res.ppg);
  }

  // ── aggregation ──
  function poolArm(arr) {
    var rec = { apnea: { tot: 0, hit: 0 }, clean: { tot: 0, hit: 0 } };
    var prec = { tot: 0, hit: 0 };
    var sqiA = { sum: 0, n: 0 },
      sqiC = { sum: 0, n: 0 };
    var biasAbs = [],
      biasPct = [],
      trueBeats = 0;
    arr.forEach(function (w) {
      rec.apnea.tot += w.recall.apnea.tot;
      rec.apnea.hit += w.recall.apnea.hit;
      rec.clean.tot += w.recall.clean.tot;
      rec.clean.hit += w.recall.clean.hit;
      prec.tot += w.prec.tot;
      prec.hit += w.prec.hit;
      sqiA.sum += w.sqiApnea.sum;
      sqiA.n += w.sqiApnea.n;
      sqiC.sum += w.sqiClean.sum;
      sqiC.n += w.sqiClean.n;
      trueBeats += w.nTrue;
      if (w.rmssdTrue != null && w.rmssdDet != null && isFinite(w.rmssdTrue) && isFinite(w.rmssdDet) && w.rmssdTrue > 0) {
        biasAbs.push(w.rmssdDet - w.rmssdTrue);
        biasPct.push((100 * (w.rmssdDet - w.rmssdTrue)) / w.rmssdTrue);
      }
    });
    var apneaTot = rec.apnea.tot + rec.clean.tot;
    return {
      nWindows: arr.length,
      trueBeats: trueBeats,
      recallAll: apneaTot ? (rec.apnea.hit + rec.clean.hit) / apneaTot : null,
      recallApnea: rec.apnea.tot ? rec.apnea.hit / rec.apnea.tot : null,
      recallClean: rec.clean.tot ? rec.clean.hit / rec.clean.tot : null,
      apneaBeats: rec.apnea.tot,
      cleanBeats: rec.clean.tot,
      precision: prec.tot ? prec.hit / prec.tot : null,
      sqiApnea: sqiA.n ? sqiA.sum / sqiA.n : null,
      sqiClean: sqiC.n ? sqiC.sum / sqiC.n : null,
      biasMedPct: median(biasPct),
      biasMedAbs: median(biasAbs),
      nBias: biasAbs.length
    };
  }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) {
      return x - y;
    });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(a) {
    return a.length
      ? a.reduce(function (x, y) {
          return x + y;
        }, 0) / a.length
      : null;
  }

  // ── run ──
  var targetN;
  async function run() {
    $('run').disabled = true;
    WIN = { ECG: [], PPG: [] };
    CANCEL = false;
    if ($('cancel')) {
      $('cancel').style.display = '';
      $('cancel').disabled = false;
    }
    targetN = Math.max(10, Math.min(20000, +$('nSubj').value || 60));
    setStatus('booting FULL-lane realms…', 'run');
    setProg(0);
    var cores = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4));
    await bootPool(cores);
    var bad = workers.filter(function (w) {
      return !w.ready;
    });
    if (bad.length === workers.length) {
      setStatus('worker boot failed: ' + ((bad[0] && bad[0].err) || 'unknown'), 'idle');
      $('run').disabled = false;
      return;
    }
    setStatus('measuring ' + targetN + ' patients · ' + cores + ' realms…', 'run');
    var seeds = [];
    for (var s = 0; s < targetN; s++) seeds.push(s);
    await runSeeds(seeds, function (f) {
      setProg(f);
      setStatus('window ' + (WIN.ECG.length + WIN.PPG.length) + ' · ECG ' + WIN.ECG.length + ' · PPG ' + WIN.PPG.length, 'run');
    });
    workers.forEach(function (w) {
      try {
        w.w.terminate();
      } catch (e) {}
    });
    setProg(1);
    if ($('cancel')) $('cancel').style.display = 'none';
    var nWin = WIN.ECG.length + WIN.PPG.length;
    setStatus((CANCEL ? 'cancelled — partial · ' : 'analyzing ') + nWin + ' windows', CANCEL ? 'idle' : 'done');
    if (nWin) analyze();
    $('run').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach(function (id) {
      $(id).disabled = !nWin;
    });
  }

  // ── analyze ──
  function analyze() {
    var agg = { ECG: poolArm(WIN.ECG), PPG: poolArm(WIN.PPG) };

    // headline cards
    var cards = '';
    function pct(v) {
      return v == null ? '—' : (100 * v).toFixed(1);
    }
    cards += hcard(META.ECG.color, pct(agg.ECG.recallApnea) + '<span class="hu">%</span>', 'ECG QRS recall in apnea', 'vs ' + pct(agg.ECG.recallClean) + '% clean — yield-robust');
    cards += hcard(META.PPG.color, pct(agg.PPG.recallApnea) + '<span class="hu">%</span>', 'PPG pulse recall in apnea', 'vs ' + pct(agg.PPG.recallClean) + '% clean — the perfusion gap');
    cards += hcard('#39D98A', agg.PPG.sqiApnea != null ? agg.PPG.sqiApnea.toFixed(2) : '—', 'PPG SQI in apnea', 'quality stays green while yield falls');
    var bias = agg.PPG.biasMedPct;
    cards += hcard('#FF6B7A', (bias != null ? (bias >= 0 ? '+' : '') + bias.toFixed(1) : '—') + '<span class="hu">%</span>', 'PPG rMSSD bias', 'median detected−true (missed-beat inflation)');
    $('headline').innerHTML = cards;

    // table
    var tb = '';
    ARMS.forEach(function (a) {
      var g = agg[a],
        mm = META[a];
      tb +=
        '<tr>' +
        '<td><span class="chip" style="background:' +
        mm.color +
        '"></span>' +
        mm.label +
        ' <span class="muted">' +
        mm.sub +
        '</span></td>' +
        '<td class="num">' +
        g.nWindows +
        '</td>' +
        '<td class="num">' +
        g.trueBeats +
        '</td>' +
        '<td class="num">' +
        p1(g.recallAll) +
        '</td>' +
        '<td class="num">' +
        p1(g.recallClean) +
        '</td>' +
        '<td class="num">' +
        p1(g.recallApnea) +
        '</td>' +
        '<td class="num">' +
        p1(g.precision) +
        '</td>' +
        '<td class="num">' +
        (g.sqiClean != null ? g.sqiClean.toFixed(2) : '—') +
        '</td>' +
        '<td class="num">' +
        (g.sqiApnea != null ? g.sqiApnea.toFixed(2) : '—') +
        '</td>' +
        '<td class="num">' +
        (g.biasMedPct != null ? (g.biasMedPct >= 0 ? '+' : '') + g.biasMedPct.toFixed(1) + '%' : '—') +
        '</td>' +
        '</tr>';
    });
    $('tblBody').innerHTML = tb;

    RESULT = {
      generated: new Date().toISOString(),
      nPatients: targetN,
      framing:
        "FULL-lane beat-yield. One ~9-min apnea-cluster window per patient per arm. ECG: CohortFull.renderECGInt16 → ECGDSP.analyze (real Pan-Tompkins); truth = deviceRR. PPG: SYNTH.renderPPG → PPGDSP.analyze (real optical pulse pipeline); truth = SYNTH.buildRR in-window. Recall = PAT-corrected beat match (±120 ms) of true beats, stratified by the master timeline apnea/hypopnea windows. SQI = the detector's own per-beat signal-quality in those segments. rMSSD bias = detected − local-median-cleaned true. SYNTHETIC GROUND TRUTH — certifies ECG yield-robustness and isolates the modest PPG apnea yield dip + over-detection and the resulting HRV bias; not a real-patient miss rate.",
      arms: {}
    };
    ARMS.forEach(function (a) {
      var g = agg[a];
      RESULT.arms[a] = {
        node: META[a].node,
        windows: g.nWindows,
        trueBeats: g.trueBeats,
        recallAll: r4(g.recallAll),
        recallClean: r4(g.recallClean),
        recallApnea: r4(g.recallApnea),
        apneaBeats: g.apneaBeats,
        cleanBeats: g.cleanBeats,
        precision: r4(g.precision),
        sqiClean: r4(g.sqiClean),
        sqiApnea: r4(g.sqiApnea),
        rmssdBiasMedianPct: r2(g.biasMedPct),
        rmssdBiasMedianMs: r2(g.biasMedAbs),
        nBiasPairs: g.nBias,
        rmssdNote: a === 'ECG' ? 'faithful (R-peaks rendered at true beat times; reference arm)' : 'genuine (PPG truth + pulse-foot detection)'
      };
    });
    try {
      window.QRS_YIELD = RESULT;
    } catch (e) {}

    drawRecall(agg);
    drawDissoc();
    drawBias();
  }
  function hcard(color, hl, k, s) {
    return '<div class="hcard"><div class="hl" style="color:' + color + '">' + hl + '</div>' + '<div class="hk">' + k + '</div><div class="hs">' + s + '</div></div>';
  }
  function p1(v) {
    return v == null ? '—' : (100 * v).toFixed(1) + '%';
  }
  function r4(v) {
    return v == null ? null : +v.toFixed(4);
  }
  function r2(v) {
    return v == null ? null : +v.toFixed(2);
  }

  // ════════ figures ════════
  function clearC(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f141b';
    ctx.fillRect(0, 0, w, h);
  }
  function axes(ctx, P, w, h, xmin, xmax, ymin, ymax, xt, yt, xlab, ylab, xfmt, yfmt) {
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#6f8096';
    ctx.font = '11px ui-monospace,monospace';
    ctx.beginPath();
    ctx.moveTo(P, 12);
    ctx.lineTo(P, h - P);
    ctx.lineTo(w - 14, h - P);
    ctx.stroke();
    var i;
    for (i = 0; i <= xt; i++) {
      var xv = xmin + ((xmax - xmin) * i) / xt,
        px = P + ((w - P - 14) * i) / xt;
      ctx.fillStyle = '#6f8096';
      ctx.fillText(xfmt ? xfmt(xv) : Math.round(xv), px - 10, h - P + 16);
    }
    for (i = 0; i <= yt; i++) {
      var yv = ymin + ((ymax - ymin) * i) / yt,
        py = h - P - ((h - P - 12) * i) / yt;
      ctx.fillStyle = '#6f8096';
      ctx.fillText(yfmt ? yfmt(yv) : Math.round(yv), 8, py + 4);
      ctx.strokeStyle = 'rgba(255,255,255,.05)';
      ctx.beginPath();
      ctx.moveTo(P, py);
      ctx.lineTo(w - 14, py);
      ctx.stroke();
    }
    ctx.fillStyle = '#aab8cc';
    ctx.font = '11px ui-monospace,monospace';
    ctx.fillText(xlab, w / 2 - 50, h - 5);
    ctx.save();
    ctx.translate(13, h / 2 + 40);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(ylab, 0, 0);
    ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h) / 2);
    if (h < 0) {
      y += h;
      h = -h;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Fig 1 — grouped recall bars: ECG{clean,apnea} · PPG{clean,apnea}
  function drawRecall(agg) {
    var cv = $('recall'),
      ctx = cv.getContext('2d'),
      w = cv.width,
      h = cv.height,
      P = 46;
    clearC(ctx, w, h);
    axes(
      ctx,
      P,
      w,
      h,
      0,
      1,
      0,
      1.0,
      1,
      5,
      '',
      'beat recall (detected / true)',
      function () {
        return '';
      },
      function (v) {
        return v.toFixed(1);
      }
    );
    var groups = [
      { arm: 'ECG', clean: agg.ECG.recallClean, apnea: agg.ECG.recallApnea },
      { arm: 'PPG', clean: agg.PPG.recallClean, apnea: agg.PPG.recallApnea }
    ];
    var x0 = P + 18,
      x1 = w - 24,
      gw = (x1 - x0) / groups.length;
    var Y = function (v) {
      return h - P - (h - P - 12) * Math.max(0, Math.min(1, v));
    };
    // 1.0 reference
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(P, Y(1));
    ctx.lineTo(w - 14, Y(1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9fb0c4';
    ctx.font = '10px ui-monospace';
    ctx.fillText('1.00 (all beats)', w - 120, Y(1) - 5);
    groups.forEach(function (g, gi) {
      var col = META[g.arm].color,
        cx = x0 + gi * gw,
        bw = Math.min(64, gw * 0.3);
      var bx1 = cx + gw * 0.5 - bw - 8,
        bx2 = cx + gw * 0.5 + 8;
      // clean (solid), apnea (hatched/translucent)
      ctx.fillStyle = col;
      rrect(ctx, bx1, Y(g.clean), bw, h - P - Y(g.clean) > 0 ? -(h - P - Y(g.clean)) : -1, 4);
      ctx.fill();
      ctx.fillStyle = hexA(col, 0.42);
      rrect(ctx, bx2, Y(g.apnea), bw, -(h - P - Y(g.apnea)), 4);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      rrect(ctx, bx2, Y(g.apnea), bw, -(h - P - Y(g.apnea)), 4);
      ctx.stroke();
      // labels
      ctx.fillStyle = '#e6edf6';
      ctx.font = 'bold 11px ui-monospace';
      ctx.textAlign = 'center';
      ctx.fillText((100 * g.clean).toFixed(0) + '%', bx1 + bw / 2, Y(g.clean) - 6);
      ctx.fillText((100 * g.apnea).toFixed(0) + '%', bx2 + bw / 2, Y(g.apnea) - 6);
      ctx.fillStyle = '#cdd9e6';
      ctx.font = 'bold 12px ui-sans-serif,system-ui';
      ctx.fillText(META[g.arm].label, cx + gw * 0.5, h - P + 30);
      ctx.fillStyle = '#6f8096';
      ctx.font = '10px ui-monospace';
      ctx.fillText('clean   apnea', cx + gw * 0.5, h - P + 16);
      ctx.textAlign = 'left';
    });
  }

  // Fig 2 — dissociation scatter: x = per-window apnea recall, y = per-window apnea SQI, color by arm
  function drawDissoc() {
    var cv = $('dissoc'),
      ctx = cv.getContext('2d'),
      w = cv.width,
      h = cv.height,
      P = 46;
    clearC(ctx, w, h);
    var x0 = 0.7,
      x1 = 1.0,
      y0 = 0.7,
      y1 = 1.0;
    axes(
      ctx,
      P,
      w,
      h,
      x0,
      x1,
      y0,
      y1,
      6,
      6,
      'beat recall in apnea segments',
      'detector SQI in apnea segments',
      function (v) {
        return v.toFixed(2);
      },
      function (v) {
        return v.toFixed(2);
      }
    );
    var X = function (v) {
      return P + (w - P - 14) * Math.max(0, Math.min(1, (v - x0) / (x1 - x0)));
    };
    var Y = function (v) {
      return h - P - (h - P - 12) * Math.max(0, Math.min(1, (v - y0) / (y1 - y0)));
    };
    // SQI ≥ 0.5 "green" band reference (the clean-beat gate) — every point sits inside it
    ctx.fillStyle = 'rgba(57,217,138,.06)';
    ctx.fillRect(P, 12, w - P - 14, h - P - 12);
    var stD = ptStyle(WIN.ECG.length + WIN.PPG.length);
    ARMS.forEach(function (a) {
      var col = META[a].color;
      WIN[a].forEach(function (win) {
        if (!win.recall.apnea.tot) return;
        var rc = win.recall.apnea.hit / win.recall.apnea.tot;
        var sq = win.sqiApnea.n ? win.sqiApnea.sum / win.sqiApnea.n : null;
        if (sq == null) return;
        ctx.fillStyle = hexA(col, stD.a);
        dot(ctx, X(rc), Y(sq), stD);
      });
    });
    ctx.fillStyle = '#9fb0c4';
    ctx.font = '10px ui-monospace';
    ctx.fillText('SQI flat & green across a wide recall range → quality blind to the gap', P + 6, 24);
    $('dissocLeg').innerHTML =
      ARMS.map(function (a) {
        return '<span class="chip" style="background:' + META[a].color + '"></span>' + META[a].label;
      }).join(' &nbsp; ') + ' &nbsp;·&nbsp; each point = one patient window (apnea-segment beats only)';
  }

  // Fig 3 — HRV bias (PPG): detected vs true rMSSD, identity line, points shaded by apnea recall.
  // PPG only by design: it is the modality that carries the yield-driven rMSSD bias. ECG rMSSD now
  // tracks truth (R-peaks rendered at their true beat times → bias ≈0, on the identity line), so it
  // is omitted here for clarity. PPG truth (buildRR) and detection (pulse feet) are both genuine.
  function drawBias() {
    var cv = $('bias'),
      ctx = cv.getContext('2d'),
      w = cv.width,
      h = cv.height,
      P = 46;
    clearC(ctx, w, h);
    var pts = WIN.PPG.filter(function (win) {
      return win.rmssdTrue != null && win.rmssdDet != null && isFinite(win.rmssdTrue) && isFinite(win.rmssdDet);
    });
    if (!pts.length) {
      ctx.fillStyle = '#6f8096';
      ctx.font = '12px ui-monospace';
      ctx.fillText('run to populate', 20, 40);
      return;
    }
    var vals = [];
    pts.forEach(function (p) {
      vals.push(p.rmssdTrue, p.rmssdDet);
    });
    var hi = Math.min(160, Math.ceil(Math.max.apply(null, vals) / 10) * 10 + 5);
    axes(
      ctx,
      P,
      w,
      h,
      0,
      hi,
      0,
      hi,
      5,
      5,
      'true rMSSD (ms)',
      'PPG detected rMSSD (ms)',
      function (v) {
        return Math.round(v);
      },
      function (v) {
        return Math.round(v);
      }
    );
    var X = function (v) {
      return P + (w - P - 14) * Math.max(0, Math.min(1, v / hi));
    };
    var Y = function (v) {
      return h - P - (h - P - 12) * Math.max(0, Math.min(1, v / hi));
    };
    // identity
    ctx.strokeStyle = 'rgba(255,255,255,.30)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(hi), Y(hi));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9fb0c4';
    ctx.font = '10px ui-monospace';
    ctx.fillText('identity (detected = true)', X(hi) - 150, Y(hi) + 16);
    var stB = ptStyle(pts.length);
    pts.forEach(function (win) {
      // shade by apnea-segment recall: lower recall → redder (the missed-beat windows sit highest)
      var rc = win.recall.apnea.tot ? win.recall.apnea.hit / win.recall.apnea.tot : 1;
      var col = rc < 0.9 ? '#FF6B7A' : rc < 0.96 ? '#FFB84D' : '#9CC7FF';
      ctx.fillStyle = hexA(col, stB.a + 0.1);
      dot(ctx, X(win.rmssdTrue), Y(win.rmssdDet), stB);
    });
    $('biasLeg').innerHTML =
      '<span class="chip" style="background:#FF6B7A"></span>apnea recall &lt;0.90 &nbsp; <span class="chip" style="background:#FFB84D"></span>0.90–0.96 &nbsp; <span class="chip" style="background:#9CC7FF"></span>≥0.96' +
      ' &nbsp;·&nbsp; PpgDex only — points above identity = inflated rMSSD (missed beats + PAT jitter)';
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16),
      r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  // N-aware point style (ported from hrv-confound-analysis.js; SYNTH-TEXTURE-PAPERS-RERUN-FOLLOWUPS Part 2).
  function ptStyle(n) {
    if (n <= 3000) return { r: 3.2, a: 0.5 };
    if (n <= 15000) return { r: 1.6, a: 0.32 };
    if (n <= 40000) return { r: 0.9, a: 0.2 };
    return { r: 0.6, a: 0.12 };
  }
  function dot(ctx, x, y, st) {
    if (st.r <= 0.9) {
      ctx.fillRect(x, y, 1, 1);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, st.r, 0, 7);
      ctx.fill();
    }
  }

  // ── exports ──
  function dl(name, text, mime) {
    var b = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1500);
  }
  $('dlCsv').onclick = function () {
    var rows = [['arm', 'ahi', 'cpap', 'nTrue', 'nDet', 'lagMs', 'recallClean', 'recallApnea', 'precision', 'sqiClean', 'sqiApnea', 'rmssdTrue', 'rmssdDet', 'rmssdNode']];
    ARMS.forEach(function (a) {
      WIN[a].forEach(function (w) {
        rows.push([
          a,
          w.ahi,
          w.cpap ? 1 : 0,
          w.nTrue,
          w.nDet,
          w.lagMs,
          frac(w.recall.clean),
          frac(w.recall.apnea),
          frac(w.prec),
          w.sqiClean.n ? (w.sqiClean.sum / w.sqiClean.n).toFixed(3) : '',
          w.sqiApnea.n ? (w.sqiApnea.sum / w.sqiApnea.n).toFixed(3) : '',
          w.rmssdTrue != null ? w.rmssdTrue.toFixed(1) : '',
          w.rmssdDet != null ? w.rmssdDet.toFixed(1) : '',
          w.rmssdNode != null ? w.rmssdNode.toFixed(1) : ''
        ]);
      });
    });
    dl(
      'qrs-yield-results.csv',
      rows
        .map(function (r) {
          return r.join(',');
        })
        .join('\n'),
      'text/csv'
    );
  };
  function frac(o) {
    return o.tot ? (o.hit / o.tot).toFixed(4) : '';
  }
  $('dlStats').onclick = function () {
    dl('qrs-yield-stats.json', JSON.stringify(RESULT, null, 2), 'application/json');
  };
  $('dlFig').onclick = function () {
    var a = $('recall'),
      b = $('dissoc'),
      c = $('bias'),
      gap = 16;
    var W = a.width + gap * 2,
      H = a.height + b.height + c.height + gap * 4;
    var out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(a, gap, gap);
    ctx.drawImage(b, gap, gap * 2 + a.height);
    ctx.drawImage(c, gap, gap * 3 + a.height + b.height);
    out.toBlob(function (bl) {
      var u = URL.createObjectURL(bl);
      var an = document.createElement('a');
      an.href = u;
      an.download = 'qrs-yield-figures.png';
      an.click();
    }, 'image/png');
  };
  var CANCEL = false;
  $('run').onclick = run;
  if ($('cancel'))
    $('cancel').onclick = function () {
      CANCEL = true;
      $('cancel').disabled = true;
      setStatus('cancelling…', 'run');
    };
})();
