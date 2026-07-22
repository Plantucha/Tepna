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

  // ── group dropped files into nights ────────────────────────────────────
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
    for (var k = 0; k < acc.length; k++) {
      var m = acc[k].name.match(/_(\d{8})_(\d{6})_ACC\.txt$/);
      if (!m) continue;
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

  async function run(files) {
    logEl.textContent = '';
    var nights = groupFiles(files);
    if (!nights.length) {
      status('no ACC+BRP night pairs found', 'bad');
      log('Found no Polar_H10_*_ACC.txt with a matching CPAP/<date>/*_BRP.edf.');
      return;
    }
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
    }

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
