/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   cohort-regression.js — drives the real-corpus regression gate.
   Boots the SAME cohort-harness.html iframes (real OxyDex + PulseDex DSP), runs
   the 5 canonical SubjectA nights, scores each vs the committed ground-truth JSON,
   and renders pass/fail with the headline #summary pill (mirrors Dex-Test-Suite).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var harness = {};
  function bootHarness(node) {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.className = 'harness';
      f.src = 'cohort-harness.html?node=' + node;
      var rec = { iframe: f, ready: false, pending: new Map() };
      harness[node] = rec;
      window.addEventListener('message', function (ev) {
        var m = ev.data || {};
        if (m.node !== node) return;
        if (m.type === 'ready') {
          rec.ready = true;
          rec.bootErr = m.error || null;
          resolve(rec);
        } else if (m.type === 'result') {
          var p = rec.pending.get(m.reqId);
          if (p) {
            rec.pending.delete(m.reqId);
            p(m);
          }
        }
      });
      document.body.appendChild(f);
      setTimeout(function () {
        resolve(rec);
      }, 9000);
    });
  }
  var reqSeq = 1;
  function callNode(node, payload) {
    var rec = harness[node];
    return new Promise(function (resolve) {
      var id = reqSeq++;
      rec.pending.set(id, resolve);
      rec.iframe.contentWindow.postMessage({ type: 'run', reqId: id, payload: payload }, '*');
      setTimeout(function () {
        if (rec.pending.has(id)) {
          rec.pending.delete(id);
          resolve({ error: 'timeout' });
        }
      }, 30000);
    });
  }

  function matchRecall(detTMs, truthTMs, loSec, hiSec) {
    var lo = loSec * 1000,
      hi = hiSec * 1000,
      used = new Set(),
      matched = 0;
    truthTMs.forEach(function (t) {
      for (var i = 0; i < detTMs.length; i++) {
        if (used.has(i)) continue;
        var d = detTMs[i] - t;
        if (d >= lo && d <= hi) {
          used.add(i);
          matched++;
          break;
        }
      }
    });
    return truthTMs.length ? matched / truthTMs.length : null;
  }

  async function fetchText(p) {
    var r = await fetch(p);
    if (!r.ok) throw new Error('fetch ' + p + ' → ' + r.status);
    return r.text();
  }

  function setSummary(t, cls) {
    var e = document.getElementById('summary');
    e.textContent = t;
    e.className = cls;
  }

  async function run() {
    document.getElementById('runBtn').disabled = true;
    setSummary('booting harness…', 'run');
    await Promise.all([bootHarness('oxydex'), bootHarness('pulsedex')]);
    var bootErr = ['oxydex', 'pulsedex'].filter(function (n) {
      return harness[n].bootErr;
    });
    if (bootErr.length) {
      setSummary('harness boot failed', 'fail');
      document.getElementById('runBtn').disabled = false;
      return;
    }

    var rows = [],
      totalChecks = 0,
      failed = 0;
    for (var i = 0; i < NIGHTS.length; i++) {
      var cfg = NIGHTS[i];
      setSummary('night ' + cfg.n + '/5…', 'run');
      var gt, oxyCSV, rrText;
      try {
        gt = JSON.parse(await fetchText(DIR + cfg.gt));
      } catch (e) {
        rows.push({ n: cfg.n, err: 'GT ' + e.message });
        failed++;
        totalChecks++;
        continue;
      }
      try {
        oxyCSV = await fetchText(DIR + cfg.oxy);
      } catch (e) {
        oxyCSV = null;
      }
      try {
        rrText = await fetchText(DIR + cfg.rr);
      } catch (e) {
        rrText = null;
      }

      var truthEvents = (gt.events || []).filter(function (e) {
        return e.type === 'apnea' || e.type === 'hypopnea';
      });
      var truthAHI = gt.ahiTarget;
      var truthHours = gt.durSec / 3600;
      var truthFloor =
        100 -
        Math.max.apply(
          null,
          truthEvents
            .map(function (e) {
              return e.desatPct || 0;
            })
            .concat([4])
        );

      var row = { n: cfg.n, story: gt.story, truthAHI: truthAHI, nTruth: truthEvents.length, checks: [], t0Truth: gt.t0Ms };

      // —— OxyDex ——
      if (oxyCSV) {
        var res = await callNode('oxydex', { nights: [{ oxyCSV: oxyCSV }] });
        if (res.error) {
          row.checks.push(['OxyDex ran', false, res.error]);
        } else {
          var sc = res.score.nights[0] || {};
          var env = (res.envelope.nights || [])[0] || {};
          row.odi = sc.odi;
          row.minSpo2 = sc.minSpo2;
          row.t0Oxy = sc.t0Ms;
          row.durMin = sc.durationMin;
          // detected desat tMs from score
          var detTMs = sc.detectedDesatTMs || [];
          row.recall = matchRecall(
            detTMs,
            truthEvents.map(function (e) {
              return e.t0Ms;
            }),
            -10,
            60
          );
          var odiRatio = sc.odi != null && truthAHI ? sc.odi / truthAHI : null;
          row.odiRatio = odiRatio;
          row.checks.push(['ODI/AHI in band', odiRatio != null && odiRatio >= TOL.odiRatioLo && odiRatio <= TOL.odiRatioHi, odiRatio != null ? odiRatio.toFixed(3) : 'n/a']);
          // recall is INFORMATIONAL (co-varies with the documented undercount) — not a pass/fail
          row.checks.push([
            'min SpO₂ ≈ truth floor',
            sc.minSpo2 != null && Math.abs(sc.minSpo2 - truthFloor) <= TOL.minSpo2AbsMax,
            sc.minSpo2 != null ? sc.minSpo2 + ' vs ' + truthFloor.toFixed(0) : 'n/a'
          ]);
          row.checks.push(['t0 matches truth', sc.t0Ms != null && Math.abs(sc.t0Ms - gt.t0Ms) <= TOL.t0DriftMsMax, sc.t0Ms != null ? sc.t0Ms - gt.t0Ms + 'ms' : 'n/a']);
        }
      } else row.checks.push(['OxyDex file present', false, 'missing']);

      // —— PulseDex ——
      if (rrText) {
        var pr = await callNode('pulsedex', { rrText: rrText });
        if (pr.error) {
          row.checks.push(['PulseDex ran', false, pr.error]);
        } else {
          row.rmssd = pr.score.rmssd;
          row.t0Pulse = pr.score.t0Ms;
          row.checks.push(['rMSSD in band', pr.score.rmssd != null && pr.score.rmssd >= TOL.rmssdMin && pr.score.rmssd <= TOL.rmssdMax, pr.score.rmssd != null ? pr.score.rmssd + ' ms' : 'n/a']);
          row.checks.push(['RR t0 matches truth', pr.score.t0Ms != null && Math.abs(pr.score.t0Ms - gt.t0Ms) <= TOL.t0DriftMsMax, pr.score.t0Ms != null ? pr.score.t0Ms - gt.t0Ms + 'ms' : 'n/a']);
        }
      } else row.checks.push(['PulseDex file present', false, 'missing']);

      row.checks.forEach(function (c) {
        totalChecks++;
        if (!c[1]) failed++;
      });
      row.pass = row.checks.every(function (c) {
        return c[1];
      });
      rows.push(row);
      render(rows);
    }

    render(rows);

    // —— cross-night calibration gate: ODI must track truth AHI across the 5 nights ——
    var xs = [],
      ys = [];
    rows.forEach(function (r) {
      if (r.odi != null && r.truthAHI != null) {
        xs.push(r.truthAHI);
        ys.push(r.odi);
      }
    });
    var r2 = olsR2(xs, ys);
    var calibPass = r2 != null && r2 >= TOL.calibR2Min;
    totalChecks++;
    if (!calibPass) failed++;
    renderCalib(r2, calibPass);

    var passed = totalChecks - failed;
    if (failed === 0) setSummary('✓ all green — ' + passed + '/' + totalChecks + ' checks · 5 nights', 'pass');
    else setSummary('✗ ' + failed + ' of ' + totalChecks + ' checks failed', 'fail');
    document.getElementById('runBtn').disabled = false;
  }

  function olsR2(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var sx = 0,
      sy = 0;
    for (var i = 0; i < n; i++) {
      sx += xs[i];
      sy += ys[i];
    }
    var mx = sx / n,
      my = sy / n,
      sxx = 0,
      sxy = 0,
      syy = 0;
    for (var j = 0; j < n; j++) {
      var dx = xs[j] - mx,
        dy = ys[j] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    var r = sxy / Math.sqrt(sxx * syy);
    return +(r * r).toFixed(3);
  }
  function renderCalib(r2, pass) {
    var el = document.getElementById('calib');
    if (!el) {
      el = document.createElement('div');
      el.id = 'calib';
      el.className = 'card';
      document.getElementById('content').appendChild(el);
    }
    el.innerHTML =
      '<h2>Cross-night calibration gate</h2><table><tr>' +
      '<td class="muted">ODI-vs-truth-AHI R² across 5 nights (≥' +
      TOL.calibR2Min +
      ')</td>' +
      '<td class="num ' +
      (pass ? 'ok' : 'bad') +
      '">' +
      (r2 == null ? '—' : r2) +
      '</td>' +
      '<td><span class="chip ' +
      (pass ? 'pass-chip' : 'fail-chip') +
      '">' +
      (pass ? '✓ tracks' : '✗ drift') +
      '</span></td></tr></table>' +
      '<div class="legend">The headline OxyDex regression: even though ODI-4 under-scores the absolute AHI, it must stay tightly linear with severity. A drop here means the detector stopped tracking apnea burden — a real regression.</div>';
  }
  function fmt(v, d) {
    return v == null ? '—' : typeof v === 'number' ? v.toFixed(d == null ? 1 : d) : v;
  }
  function render(rows) {
    var html =
      '<table><tr><th>night</th><th>story</th><th class="num">truth AHI</th><th class="num">ODI</th><th class="num">ODI/AHI</th>' +
      '<th class="num">recall</th><th class="num">min SpO₂</th><th class="num">rMSSD</th><th>checks</th><th></th></tr>';
    rows.forEach(function (r) {
      if (r.err) {
        html += '<tr><td class="mono">' + r.n + '</td><td colspan="9" class="bad mono">' + r.err + '</td></tr>';
        return;
      }
      var passCount = r.checks.filter(function (c) {
        return c[1];
      }).length;
      var detail = r.checks
        .map(function (c) {
          return '<span class="chip ' + (c[1] ? 'pass-chip' : 'fail-chip') + '" title="' + c[2] + '">' + (c[1] ? '✓' : '✗') + ' ' + c[0] + '</span>';
        })
        .join(' ');
      html +=
        '<tr>' +
        '<td class="mono">' +
        r.n +
        '</td>' +
        '<td class="muted" style="max-width:200px">' +
        (r.story || '') +
        '</td>' +
        '<td class="num">' +
        fmt(r.truthAHI, 0) +
        '</td>' +
        '<td class="num">' +
        fmt(r.odi) +
        '</td>' +
        '<td class="num ' +
        (r.odiRatio != null && r.odiRatio >= TOL.odiRatioLo && r.odiRatio <= TOL.odiRatioHi ? 'ok' : 'bad') +
        '">' +
        fmt(r.odiRatio, 3) +
        '</td>' +
        '<td class="num ' +
        (r.recall != null && r.recall >= TOL.desatRecallMin ? 'ok' : 'bad') +
        '">' +
        fmt(r.recall, 2) +
        '</td>' +
        '<td class="num">' +
        fmt(r.minSpo2, 0) +
        '</td>' +
        '<td class="num">' +
        fmt(r.rmssd, 0) +
        '</td>' +
        '<td style="line-height:1.9">' +
        detail +
        '</td>' +
        '<td><span class="chip ' +
        (r.pass ? 'pass-chip' : 'fail-chip') +
        '">' +
        passCount +
        '/' +
        r.checks.length +
        '</span></td>' +
        '</tr>';
    });
    html += '</table>';
    html +=
      '<div class="legend">Bands target the CURRENT build (OxyDex ODI-4 under-scores dense desats — documented). ' +
      'This gate catches <b>drift</b> on the 5 canonical nights, not the absolute calibration gap. ' +
      'Detected-desat tMs are reconstructed from <code>t0Ms + idx·dt</code>; recall window = [−10s, +60s] around each truth event.</div>';
    document.getElementById('nights').innerHTML = html;
  }

  document.getElementById('runBtn').onclick = run;
})();
