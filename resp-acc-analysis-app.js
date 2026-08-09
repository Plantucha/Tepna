/*
 * resp-acc-analysis-app.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Driver for resp-acc-analysis.html: folder ingest → per-night pipeline → paper tables.
 * The estimator is the SHIPPED MOTIONDSP.respiratoryRate; this file only orchestrates.
 */
(function () {
  'use strict';
  var A = window.RespAccAnalysis,
    M = window.MOTIONDSP;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var logEl = $('log');
  function log(m) {
    logEl.textContent += m + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
  function status(t, cls) {
    var p = $('status');
    p.textContent = t;
    p.className = 'pill ' + (cls || 'idle');
  }
  function fmt(v, d) {
    return v == null || !isFinite(v) ? '—' : v.toFixed(d == null ? 2 : d);
  }
  function row(tb, cells) {
    var tr = document.createElement('tr');
    for (var i = 0; i < cells.length; i++) {
      var td = document.createElement('td');
      td.innerHTML = cells[i];
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }

  /* Delegates to the PURE module, which both test runners load and this app layer does not — so the
     parser that decides which nights a paper may see is gateable. See `RespAccAnalysis.sessionStamp`
     for why the capture-host layout was invisible here. */
  var sessionStamp = A.sessionStamp;

  // ── group dropped files into nights ────────────────────────────────────
  // `nAcc` / `unstamped` / `noFlow` ride on the returned array so the caller can say WHY a drop produced
  // nothing, rather than reporting a bare zero — the failure mode the comment above describes.
  function groupFiles(files) {
    var acc = [],
      brp = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i],
        n = f.name;
      if (/_ACC\.txt$/i.test(n) && /Polar_H10/i.test(n)) acc.push(f);
      else if (/_BRP\.edf$/i.test(n)) {
        var d = (f.webkitRelativePath || n).match(/(\d{8})/);
        if (d) (brp[d[1]] = brp[d[1]] || []).push(f);
      }
    }
    var out = [];
    out.nAcc = acc.length;
    out.unstamped = [];
    out.noFlow = [];
    for (var k = 0; k < acc.length; k++) {
      var st = sessionStamp(acc[k].name);
      if (!st) {
        out.unstamped.push(acc[k].name);
        continue;
      }
      var m = [null, st.day, st.hhmmss];
      var y = +m[1].slice(0, 4),
        mo = +m[1].slice(4, 6),
        da = +m[1].slice(6, 8),
        hh = +m[2].slice(0, 2);
      // a session starting before noon belongs to the previous CPAP night folder
      var key = m[1];
      if (hh < 12) {
        var prev = new Date(Date.UTC(y, mo - 1, da - 1));
        key = '' + prev.getUTCFullYear() + String(prev.getUTCMonth() + 1).padStart(2, '0') + String(prev.getUTCDate()).padStart(2, '0');
      }
      if (brp[key] && brp[key].length) out.push({ name: acc[k].name, acc: acc[k], brp: brp[key], dayNum: Date.UTC(y, mo - 1, da) / 86400000 });
      else out.noFlow.push(acc[k].name + ' (wanted CPAP night ' + key + ')');
    }
    out.sort(function (a, b) {
      return a.dayNum - b.dayNum;
    });
    return out;
  }

  function readText(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        res(r.result);
      };
      r.onerror = rej;
      r.readAsText(f);
    });
  }
  function readBytes(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        res(new Uint8Array(r.result));
      };
      r.onerror = rej;
      r.readAsArrayBuffer(f);
    });
  }

  // ── one night ──────────────────────────────────────────────────────────
  async function runNight(nt) {
    var txt = await readText(nt.acc);
    var rows = M.parseSensorXYZ(txt);
    if (!rows || rows.length < 5000) return { name: nt.name, skip: 'ACC too short' };
    // pick the longest BRP session of the night
    var best = null;
    for (var i = 0; i < nt.brp.length; i++) {
      var edf = A.readEDF(await readBytes(nt.brp[i]), ['Flow.40ms']);
      if (edf && edf.signals['Flow.40ms'] && (!best || edf.signals['Flow.40ms'].data.length > best.signals['Flow.40ms'].data.length)) best = edf;
    }
    if (!best) return { name: nt.name, skip: 'no BRP flow' };
    var flow = best.signals['Flow.40ms'].data,
      fsF = best.signals['Flow.40ms'].fs;

    var ref = A.referenceEpochs(flow, fsF, A._const.EPOCH, A._const.WIN);
    // reference self-noise: the two flow-derived estimators against each other
    var selfAg = A.agreement(ref.rrMedian, ref.rrCount);
    var selfR = A.pearson(ref.rrMedian, ref.rrCount);

    // clock lock — the dominant band-passed ACC component vs band-passed flow, both on the
    // exact 5 Hz grid. respChannel/flowChannel are the ONLY sanctioned way to build these:
    // they fix the sample-rate precision and the double-filtering that both silently destroy
    // the lock (see the notes on nativeHz and recoverOffset).
    var t0 = rows[0].tMs;
    var rc = A.respChannel(rows);
    if (!rc) return { name: nt.name, skip: 'no usable sample rate' };
    var accHz = rc.hz;
    var flowG = A.flowChannel(flow, fsF);
    var accT0 = (t0 - best.startMs) / 1000;
    var lock = A.recoverOffset(rc.channel, accT0, flowG, 90, 25);

    // the shipped estimator
    var est = M.respiratoryRate(rows, t0, 'mg');
    return {
      name: nt.name,
      dayNum: nt.dayNum,
      rows: rows.length,
      hours: rows.length / accHz / 3600,
      ref: ref,
      selfAg: selfAg,
      selfR: selfR,
      lock: lock,
      est: est,
      accT0: accT0,
      cpapDur: flow.length / fsF
    };
  }

  // ── align an estimator series to the reference using a validated offset ──
  function pair(n, offsetSec) {
    var pred = [],
      rf = [],
      cf = [];
    var ep = A._const.EPOCH;
    for (var i = 0; i < n.est.series.length; i++) {
      var s = n.est.series[i];
      if (s.brpm == null && s.conf == null) continue;
      var tAcc = (s.tMs - n.est.series[0].tMs) / 1000; // s from stream start
      var tCpap = n.accT0 + tAcc + offsetSec;
      var idx = Math.round(tCpap / ep);
      if (idx < 0 || idx >= n.ref.rrMedian.length) continue;
      var r = n.ref.rrMedian[idx];
      if (!isFinite(r)) continue;
      // score the tracked ridge, gate later — coverage is applied in the curve
      pred.push(s.brpm != null ? s.brpm : NaN);
      rf.push(r);
      cf.push(s.conf);
    }
    return { name: n.name, pred: pred, ref: rf, conf: cf };
  }

  /* ════════ 6 · FIGURES ═══════════════════════════════════════════════════════════════════════════
     Three canvases, one series each, drawn to match the eleven figures already in `papers/figures/`
     (dark surface, 11px ui-monospace, hairline axes). Single-series throughout, so no legend boxes —
     the title names what is plotted and the reference lines are direct-labelled with their own values.

     Mark specs held to deliberately: 2px lines, markers r ≥ 4 with a 2px surface ring so overlapping
     dots stay countable, hairline SOLID gridlines (never dashed), and text in ink tokens rather than
     the series colour. Labels are selective — the extremes and the endpoint, never a number per point.
     ════════════════════════════════════════════════════════════════════════════════════════════════ */
  var FIG = {
    surface: '#0f141b',
    grid: 'rgba(255,255,255,.10)',
    axis: 'rgba(255,255,255,.22)',
    ink: '#e6edf6', // primary text
    ink2: '#9fb0c4', // secondary text
    ink3: '#6f8096', // muted text / tick labels
    series: '#3987e5', // one categorical slot; dark-mode step
    warn: '#f0b429',
    mono: '11px ui-monospace,SFMono-Regular,monospace'
  };
  function figBase(cv, title, sub) {
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = FIG.surface;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = FIG.ink;
    ctx.font = 'bold 13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, 14, 22);
    if (sub) {
      ctx.fillStyle = FIG.ink3;
      ctx.font = FIG.mono;
      ctx.fillText(sub, 14, 38);
    }
    return ctx;
  }
  // A plot box with hairline axes + ticks. Returns the scale helpers so a caller never rescales by hand.
  function figAxes(ctx, box, xmin, xmax, ymin, ymax, xlab, ylab, xfmt, yfmt) {
    var X = function (v) {
        return box.l + ((v - xmin) / (xmax - xmin || 1)) * (box.r - box.l);
      },
      Y = function (v) {
        return box.b - ((v - ymin) / (ymax - ymin || 1)) * (box.b - box.t);
      };
    ctx.font = FIG.mono;
    ctx.lineWidth = 1;
    var i, v, px;
    for (i = 0; i <= 4; i++) {
      v = ymin + ((ymax - ymin) * i) / 4;
      px = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = FIG.grid;
      ctx.beginPath();
      ctx.moveTo(box.l, px);
      ctx.lineTo(box.r, px);
      ctx.stroke();
      ctx.fillStyle = FIG.ink3;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        (
          yfmt ||
          function (x) {
            return x.toFixed(1);
          }
        )(v),
        box.l - 8,
        px
      );
    }
    // Explicit ticks when the caller has clean numbers to show; even fractions otherwise. Dividing a
    // range into fifths gives 45 % · 56 % · 68 % — arithmetically correct and unreadable.
    var xticks = box.xticks;
    if (!xticks) {
      xticks = [];
      for (i = 0; i <= 5; i++) xticks.push(xmin + ((xmax - xmin) * i) / 5);
    }
    for (i = 0; i < xticks.length; i++) {
      v = xticks[i];
      if (v < xmin || v > xmax) continue;
      px = Math.round(X(v)) + 0.5;
      ctx.fillStyle = FIG.ink3;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        (
          xfmt ||
          function (x) {
            return x.toFixed(0);
          }
        )(v),
        px,
        box.b + 7
      );
    }
    ctx.strokeStyle = FIG.axis;
    ctx.beginPath();
    ctx.moveTo(box.l + 0.5, box.t);
    ctx.lineTo(box.l + 0.5, box.b + 0.5);
    ctx.lineTo(box.r, box.b + 0.5);
    ctx.stroke();
    ctx.fillStyle = FIG.ink2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(xlab, (box.l + box.r) / 2, box.b + 24);
    ctx.save();
    ctx.translate(14, (box.t + box.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText(ylab, 0, 0);
    ctx.restore();
    return { X: X, Y: Y };
  }
  // A dot with a 2px surface ring — the ring is what keeps a dense scatter countable where marks overlap.
  function figDot(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, 6.2832);
    ctx.fillStyle = FIG.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawBlandAltman(allP, allR) {
    var cv = $('figBA'),
      ba = A.blandAltman(allP, allR);
    var ctx = figBase(cv, 'Agreement with the CPAP-flow reference', ba ? 'Bland–Altman · ' + ba.n.toLocaleString() + ' epochs · diff = estimate − reference' : 'no usable epochs');
    if (!ba) return;
    /* MEASURE THE LABELS, THEN RESERVE THE GUTTER. A fixed 96 px right margin clipped
       "−1.96 SD −3.32" to "−1.96 SD -3.3" the first time this was rendered and looked at — the skill's
       rule that a label which will not fit must not be clipped, caught by screenshotting rather than by
       reasoning. The gutter is now whatever the widest of the three actually needs. */
    var neg = function (x) {
      return (x < 0 ? '\u2212' : '') + Math.abs(x).toFixed(2); // one minus glyph, never a hyphen
    };
    var labels = ['bias ' + neg(ba.bias), '+1.96 SD ' + neg(ba.upper), '\u22121.96 SD ' + neg(ba.lower)];
    ctx.font = FIG.mono;
    var gutter = 0;
    for (var li = 0; li < labels.length; li++) gutter = Math.max(gutter, ctx.measureText(labels[li]).width);
    var box = { l: 54, r: cv.width - Math.ceil(gutter) - 20, t: 52, b: cv.height - 44 };
    var xs = ba.points.map(function (p) {
        return p.mean;
      }),
      lo = Math.min.apply(null, xs),
      hi = Math.max.apply(null, xs);
    var span = Math.max(Math.abs(ba.upper), Math.abs(ba.lower)) * 1.35 || 1;
    var sc = figAxes(ctx, box, Math.floor(lo) - 1, Math.ceil(hi) + 1, -span, span, 'mean of estimate and reference (br/min)', 'difference (br/min)');
    // The cloud. Low alpha because n is in the thousands and overplot IS the density signal.
    ctx.fillStyle = FIG.series;
    ctx.globalAlpha = ba.points.length > 400 ? 0.18 : 0.5;
    for (var i = 0; i < ba.points.length; i++) {
      var p = ba.points[i];
      if (p.mean < lo - 1 || p.mean > hi + 1) continue;
      ctx.beginPath();
      ctx.arc(sc.X(p.mean), Math.max(box.t, Math.min(box.b, sc.Y(p.diff))), 2.2, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Bias + limits of agreement, each DIRECT-LABELLED with its value — this is the whole reason the
    // figure exists, and a reader should never have to go back to the table to read the three numbers.
    var lines = [
      { v: ba.bias, c: FIG.ink, w: 2, t: labels[0] },
      { v: ba.upper, c: FIG.warn, w: 1.5, t: labels[1] },
      { v: ba.lower, c: FIG.warn, w: 1.5, t: labels[2] }
    ];
    for (i = 0; i < lines.length; i++) {
      var L = lines[i],
        y = Math.round(sc.Y(L.v)) + 0.5;
      if (y < box.t || y > box.b) continue;
      ctx.strokeStyle = L.c;
      ctx.lineWidth = L.w;
      ctx.beginPath();
      ctx.moveTo(box.l, y);
      ctx.lineTo(box.r, y);
      ctx.stroke();
      ctx.fillStyle = FIG.ink2; // text wears ink, never the mark colour
      ctx.font = FIG.mono;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(L.t, box.r + 8, y);
    }
    ctx.lineWidth = 1;
  }

  function drawCoverage(cov) {
    var cv = $('figCov');
    var ctx = figBase(cv, 'What abstention buys', 'MAE against the fraction of epochs the estimator is allowed to decline');
    if (!cov || cov.length < 2) return;
    var box = { l: 54, r: cv.width - 90, t: 52, b: cv.height - 44 };
    var maes = cov
      .map(function (c) {
        return c.mae;
      })
      .filter(isFinite);
    var ymax = Math.max.apply(null, maes) * 1.15,
      ymin = Math.min(0, Math.min.apply(null, maes) * 0.85);
    box.xticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]; // clean deciles — fifths of the range read 45/56/68 %
    var sc = figAxes(ctx, box, 0.45, 1.02, ymin, ymax, 'coverage (fraction of epochs answered)', 'MAE (br/min)', function (v) {
      return (v * 100).toFixed(0) + '%';
    });
    var pts = cov
      .filter(function (c) {
        return isFinite(c.mae);
      })
      .slice()
      .sort(function (a, b) {
        return a.coverage - b.coverage;
      });
    ctx.strokeStyle = FIG.series;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = sc.X(pts[i].coverage),
        y = sc.Y(pts[i].mae);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (i = 0; i < pts.length; i++) figDot(ctx, sc.X(pts[i].coverage), sc.Y(pts[i].mae), 4, FIG.series);
    // Selective labels only: the two ends are the trade-off, everything between is the axis's job.
    var ends = [pts[0], pts[pts.length - 1]];
    ctx.font = FIG.mono;
    ctx.fillStyle = FIG.ink;
    for (i = 0; i < ends.length; i++) {
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ends[i].mae.toFixed(2) + ' @ ' + (ends[i].coverage * 100).toFixed(0) + '%', sc.X(ends[i].coverage) + (i === 0 ? 8 : -8), sc.Y(ends[i].mae) - 9);
    }
  }

  function drawPerNight(rows) {
    var cv = $('figNights');
    var ctx = figBase(cv, 'Per-night MAE', rows.length + ' night(s), sorted — the spread is the n-of-1 caveat made visible');
    if (!rows.length) return;
    var box = { l: 54, r: cv.width - 34, t: 52, b: cv.height - 52 };
    var d = rows.slice().sort(function (a, b) {
      return a.mae - b.mae;
    });
    var ymax =
      Math.max.apply(
        null,
        d.map(function (r) {
          return r.mae;
        })
      ) * 1.2;
    var sc = figAxes(ctx, box, -0.5, d.length - 0.5, 0, ymax, 'night (sorted by MAE)', 'MAE (br/min)', function () {
      return '';
    });
    // Median rule, direct-labelled — the one summary a reader wants off this figure.
    var med = A.median(
      d.map(function (r) {
        return r.mae;
      })
    );
    var my = Math.round(sc.Y(med)) + 0.5;
    ctx.strokeStyle = FIG.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.l, my);
    ctx.lineTo(box.r, my);
    ctx.stroke();
    ctx.fillStyle = FIG.ink2;
    ctx.font = FIG.mono;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('median ' + med.toFixed(2), box.r, my - 4);
    for (var i = 0; i < d.length; i++) figDot(ctx, sc.X(i), sc.Y(d[i].mae), 4.5, FIG.series);
    // Label the extremes only — they are the ones a reader will ask about.
    ctx.fillStyle = FIG.ink;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(d[0].mae.toFixed(2), sc.X(0) + 8, sc.Y(d[0].mae) - 6);
    ctx.textAlign = 'right';
    ctx.fillText(d[d.length - 1].mae.toFixed(2), sc.X(d.length - 1) - 8, sc.Y(d[d.length - 1].mae) - 6);
  }

  function pngFrom(cv, name) {
    cv.toBlob(function (bl) {
      var u = URL.createObjectURL(bl),
        a = document.createElement('a');
      a.href = u;
      a.download = name;
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(u);
      }, 4000);
    }, 'image/png');
  }
  function drawFigures(allP, allR, cov, perNightMae) {
    drawBlandAltman(allP, allR);
    drawCoverage(cov);
    drawPerNight(perNightMae);
    $('figPill').textContent = 'rendered';
    $('figPill').className = 'pill ok';
    $('dlFigAll').disabled = false;
  }
  /* A handle for rendering the figures without a corpus — the same shape `nights-icc-analysis.js`
     publishes as `window.NIGHTS_ICC`. It exists so the LAYOUT can be inspected (label collisions,
     clipping, axis geometry) in a headless browser, which the validator cannot check and prose cannot
     substitute for. It draws only; it computes nothing a run does not. */
  window.RESP_ACC_FIGURES = { draw: drawFigures };

  async function run(files) {
    logEl.textContent = '';
    var nights = groupFiles(files);
    if (!nights.length) {
      status('no ACC+BRP night pairs found', 'bad');
      // SAY WHY. A bare "found nothing" is what let every box-captured night vanish without a trace —
      // the drop looked identical whether the files were absent, misnamed, or simply unpaired.
      log('Found no Polar_H10_*_ACC.txt with a matching CPAP/<date>/*_BRP.edf.');
      log('  · ' + nights.nAcc + ' Polar_H10 *_ACC.txt file(s) in the drop');
      if (nights.unstamped.length) {
        log('  · ' + nights.unstamped.length + ' carried NO recognisable session stamp — expected ' + '_YYYYMMDD_HHMMSS_ACC.txt (phone) or _YYYYMMDDHHMMSS_ACC.txt (capture host):');
        for (var u = 0; u < Math.min(5, nights.unstamped.length); u++) log('      ' + nights.unstamped[u]);
      }
      if (nights.noFlow.length) {
        log('  · ' + nights.noFlow.length + ' were stamped but had no CPAP flow for their night:');
        for (var v = 0; v < Math.min(5, nights.noFlow.length); v++) log('      ' + nights.noFlow[v]);
      }
      return;
    }
    if (nights.unstamped.length) log('⚠ ' + nights.unstamped.length + ' ACC file(s) ignored — unrecognised session stamp (e.g. ' + nights.unstamped[0] + ')');
    status('processing ' + nights.length + ' night(s)…', 'busy');
    log('grouped ' + nights.length + ' night(s) with both ACC and CPAP flow');

    var done = [];
    for (var i = 0; i < nights.length; i++) {
      status('night ' + (i + 1) + ' of ' + nights.length + '…', 'busy');
      var r;
      try {
        r = await runNight(nights[i]);
      } catch (e) {
        log('! ' + nights[i].name + ' — ' + e.message);
        continue;
      }
      if (r.skip) {
        log('⊘ ' + r.name + ' — ' + r.skip);
        continue;
      }
      done.push(r);
      log('✓ ' + r.name + '  ' + r.hours.toFixed(2) + ' h  lock=' + (r.lock ? r.lock.off + 's r=' + r.lock.r.toFixed(2) : 'none'));
      await new Promise(function (res) {
        setTimeout(res, 0);
      });
    }
    if (!done.length) {
      status('no night produced usable data', 'bad');
      return;
    }

    // ── 1 · reference self-noise ──
    var tb = $('tblRef').querySelector('tbody');
    tb.innerHTML = '';
    var maes = [];
    for (i = 0; i < done.length; i++) {
      var n = done[i];
      if (!n.selfAg) continue;
      maes.push(n.selfAg.mae);
      row(tb, [n.name.replace(/Polar_H10_\d+_/, '').replace('_ACC.txt', ''), n.ref.nBreaths, fmt(A.median(n.ref.periods)), '<b>' + fmt(n.selfAg.mae) + '</b>', fmt(n.selfR, 3)]);
    }
    $('refSummary').innerHTML = maes.length
      ? 'Median self-noise across nights: <b>' + fmt(A.median(maes)) + ' br/min</b>. Treat this as the floor — an estimator scoring below it is not more accurate than the reference.'
      : '';

    // ── 2 · clock drift ──
    var drift = A.fitDrift(done, 0.4);
    var tc = $('tblClock').querySelector('tbody');
    tc.innerHTML = '';
    var okLocks = 0;
    for (i = 0; i < done.length; i++) {
      var d = done[i];
      if (!d.lock) {
        row(tc, [d.name.slice(-22), '—', '—', '—', '—', '—', '<span style="color:var(--red)">no lock</span>']);
        continue;
      }
      var predOff = drift ? drift.predict(d.dayNum) : NaN;
      var delta = isFinite(predOff) ? d.lock.off - predOff : NaN;
      var good = isFinite(delta) ? Math.abs(delta) < 5 : d.lock.r >= 0.4;
      if (good) okLocks++;
      d.offsetUsed = good && isFinite(predOff) ? (Math.abs(delta) < 5 ? d.lock.off : predOff) : d.lock.off;
      row(tc, [
        d.name.replace(/Polar_H10_\d+_/, '').replace('_ACC.txt', ''),
        d.lock.off,
        fmt(predOff, 1),
        fmt(delta, 1),
        fmt(d.lock.r, 2),
        fmt(d.lock.sharp, 1),
        good ? '<span style="color:var(--teal)">drift-consistent</span>' : '<span style="color:var(--amber)">off-model</span>'
      ]);
    }
    $('driftSummary').innerHTML = drift
      ? 'Drift fit on ' +
        drift.n +
        ' confidently-locked nights: <b>' +
        fmt(drift.slopePerDay, 3) +
        ' s/day</b>, residual SD <b>' +
        fmt(drift.residSD) +
        ' s</b> (max ' +
        fmt(drift.residMax) +
        ' s). ' +
        okLocks +
        ' of ' +
        done.length +
        ' nights are drift-consistent. Validity is this Δ, not |r|.'
      : 'Too few locks to fit a drift model.';

    // ── 3 · agreement ──
    var perNight = [];
    for (i = 0; i < done.length; i++) {
      if (done[i].offsetUsed == null) continue;
      var p = pair(done[i], done[i].offsetUsed);
      if (p.pred.length > 50) perNight.push(p);
    }
    if (!perNight.length) {
      status('no night aligned well enough to score', 'bad');
      return;
    }
    var corrected = A.looBias(perNight);
    function flat(pool, key) {
      var o = [];
      for (var a = 0; a < pool.length; a++) for (var b = 0; b < pool[a][key].length; b++) o.push(pool[a][key][b]);
      return o;
    }
    var allP = flat(corrected, 'pred'),
      allR = flat(corrected, 'ref');
    var ag = A.agreement(allP, allR);
    var ci = A.bootstrapCI(corrected, function (pool) {
      var a = A.agreement(flat(pool, 'pred'), flat(pool, 'ref'));
      return a ? a.mae : NaN;
    });
    var ta = $('tblAgree').querySelector('tbody');
    ta.innerHTML = '';
    row(ta, [
      '<b>Spectral ridge (shipped), all epochs</b>',
      ag.n,
      '<b>' + fmt(ag.mae) + '</b>',
      ci ? fmt(ci[0]) + '–' + fmt(ci[1]) : '—',
      fmt(ag.bias),
      fmt(ag.rmse),
      '±' + fmt(ag.loa),
      fmt(ag.within2 * 100, 1) + '%',
      fmt(A.pearson(allP, allR), 3)
    ]);
    // null baseline: predict the corpus median every epoch
    var med = A.median(allR.filter(isFinite));
    var constP = allR.map(function () {
      return med;
    });
    var cag = A.agreement(constP, allR);
    row(ta, ['Constant = corpus median (null baseline)', cag.n, fmt(cag.mae), '—', fmt(cag.bias), fmt(cag.rmse), '±' + fmt(cag.loa), fmt(cag.within2 * 100, 1) + '%', '—']);
    $('nPill').textContent = ag.n.toLocaleString() + ' epochs';
    $('nPill').className = 'pill ok';

    // ── 4 · coverage curve ──
    var cov = A.coverageCurve(corrected, [1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5]);
    var tv = $('tblCov').querySelector('tbody');
    tv.innerHTML = '';
    for (i = 0; i < cov.length; i++) {
      var c = cov[i];
      row(tv, [fmt(c.coverage * 100, 1) + '%', fmt(c.confMin, 3), '<b>' + fmt(c.mae) + '</b>', fmt(c.rmse), '±' + fmt(c.loa), fmt(c.within2 * 100, 1) + '%', fmt(c.r, 3)]);
    }

    // ── 5 · per night ──
    var tn = $('tblNights').querySelector('tbody');
    tn.innerHTML = '';
    var perNightMae = [];
    for (i = 0; i < corrected.length; i++) {
      var cn = corrected[i],
        a2 = A.agreement(cn.pred, cn.ref);
      if (!a2) continue;
      var src = null;
      for (var q = 0; q < done.length; q++) if (done[q].name === cn.name) src = done[q];
      row(tn, [
        cn.name.replace(/Polar_H10_\d+_/, '').replace('_ACC.txt', ''),
        src ? fmt(src.hours, 1) : '—',
        a2.n,
        fmt(a2.mae),
        fmt(a2.bias),
        fmt(a2.within2 * 100, 1) + '%',
        fmt(A.pearson(cn.pred, cn.ref), 3)
      ]);
      perNightMae.push({ name: cn.name.replace(/Polar_H10_\d+_/, '').replace('_ACC.txt', ''), mae: a2.mae, n: a2.n });
    }

    // ── 6 · figures ──
    drawFigures(allP, allR, cov, perNightMae);

    $('prov').innerHTML =
      'Estimator: <code>MOTIONDSP.respiratoryRate</code> — the shipped DSP, method <code>' +
      (done[0].est.method || '?') +
      '</code>, bias applied <code>' +
      done[0].est.biasApplied +
      '</code> br/min. Reference: ResMed <code>Flow.40ms</code> @ ' +
      fmt(A._const.FS_REF, 0) +
      ' Hz. Epoch ' +
      A._const.EPOCH +
      ' s / window ' +
      A._const.WIN +
      ' s. Nights scored: <b>' +
      corrected.length +
      '</b>. Bias correction leave-one-night-out; CIs night-level bootstrap.';
    status('done — ' + corrected.length + ' night(s), ' + ag.n.toLocaleString() + ' epochs', 'ok');
  }

  // ── wiring ─────────────────────────────────────────────────────────────
  // Figure export. Individually by the name each paper embeds, or stacked into the one PNG — the same
  // shape `nights-icc-analysis.js` already uses, so `papers/figures/` stays one convention.
  [
    ['dlBA', 'figBA', 'acc-resp-bland-altman.png'],
    ['dlCov', 'figCov', 'acc-resp-coverage.png'],
    ['dlNights', 'figNights', 'acc-resp-per-night.png']
  ].forEach(function (t) {
    var el = $(t[0]);
    if (el)
      el.addEventListener('click', function (e) {
        e.preventDefault();
        pngFrom($(t[1]), t[2]);
      });
  });
  if ($('dlFigAll'))
    $('dlFigAll').addEventListener('click', function () {
      var cs = [$('figBA'), $('figCov'), $('figNights')],
        gap = 16;
      var W = cs[0].width + gap * 2,
        H = gap;
      for (var i = 0; i < cs.length; i++) H += cs[i].height + gap;
      var out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      var c = out.getContext('2d');
      c.fillStyle = '#0c0f14';
      c.fillRect(0, 0, W, H);
      var y = gap;
      for (i = 0; i < cs.length; i++) {
        c.drawImage(cs[i], gap, y);
        y += cs[i].height + gap;
      }
      pngFrom(out, 'acc-resp-figures.png');
    });

  var drop = $('drop');
  drop.addEventListener('click', function () {
    $('folderInput').click();
  });
  $('folderInput').addEventListener('change', function (e) {
    run(Array.prototype.slice.call(e.target.files));
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add('hot');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.remove('hot');
    });
  });
  drop.addEventListener('drop', async function (e) {
    var items = e.dataTransfer.items,
      files = [];
    async function walk(entry, path) {
      if (entry.isFile) {
        await new Promise(function (res) {
          entry.file(function (f) {
            f.webkitRelativePath = path + '/' + f.name;
            files.push(f);
            res();
          });
        });
      } else if (entry.isDirectory) {
        var rd = entry.createReader();
        var batch;
        do {
          batch = await new Promise(function (res) {
            rd.readEntries(res);
          });
          for (var i = 0; i < batch.length; i++) await walk(batch[i], path + '/' + entry.name);
        } while (batch.length);
      }
    }
    var tasks = [];
    for (var i = 0; i < items.length; i++) {
      var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (en) tasks.push(walk(en, ''));
    }
    await Promise.all(tasks);
    run(files);
  });
})();
