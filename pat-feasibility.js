/*
 * pat-feasibility.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * PAT feasibility — BATCH driver (PAT-FEASIBILITY-2026-07-08-BRIEF). Drop a whole capture
 * folder: this auto-groups files into nights (Polar Sensor Logger naming), flags every
 * H10 _ECG + Verity _PPG eligible pair, and runs each in a worker lane (pat-feasibility-
 * worker.js) — the raw ECG is multi-MB, so nothing heavy touches the main thread. Per-night
 * summaries fill a table; the aggregate characterises inter-device clock drift across N
 * nights (the point of running >1: turn n=1 into a systematic finding + tell linear-vs-
 * wander for the fix). Click a night to see its per-beat scatter. Ingestion/night-keying
 * mirror sensor-trio-power-analysis.js. 100% local; serve over http://.
 */
(function () {
  // §1.5 — the promotion-gate thresholds are single-sourced in pat-gate.js. These used to be five
  // bare literals here, silently duplicating verdict()'s copy in the worker.
  var G = (self.PATGate || {}).PAT_GATE || { COUPLING_MIN: 0.55, BEAT_IQR_MAX_MS: 60, DRIFT_MAX_MS: 60 };
  ('use strict');
  var PHYS_LO = 200,
    PHYS_HI = 650; // chest ECG R → ankle PPG foot: longest peripheral PTT + PEP + convention
  var C = { ink: '#e6edf6', mut: '#6f8096', teal: '#3DE0D0', blue: '#58A6FF', amber: '#FFB84D', red: '#FF6B7A', green: '#39D98A' };
  /* ── TRUST BADGES — this page's grades, with the reason each one is what it is (CLAUDE.md §🎫) ────────────
     A count or a coverage share is read straight off the data → measured. A PAT lag, its spread and the hat are
     computed from consumer sensors and have not been validated against a reference here → experimental. The
     ACC-sync offset is a motion-anchored convenience correction → heuristic. */
  var EV = {
    count: ['measured', 'a count of nights, files, beats or windows — direct'],
    coupling: ['measured', 'share of coverable R-peaks whose pulse foot paired inside the window — a direct coverage statistic'],
    clock: ['measured', 'start-time offset and beat-count ratio of the two recordings — direct'],
    lag: ['experimental', 'R-peak → PPG-foot pulse arrival time from consumer sensors; not validated against a reference'],
    spread: ['experimental', 'beat-to-beat IQR of the lag around its 30 s local median — a derived dispersion'],
    drift: ['experimental', 'spread of the 5-min lag medians across the night — a derived diagnostic'],
    acc: ['heuristic', 'motion-anchored offset correction between chest and ankle ACC — a convenience estimate, not a measurement'],
    hat: ['experimental', 'classic three-cornered hat on 5-min PAT medians — assumes independent per-site errors; unvalidated']
  };
  function evb(k) {
    var e = EV[k] || EV.lag;
    return self.MetricRegistry && self.MetricRegistry.badge ? self.MetricRegistry.badge(e[0], e[1]) : '';
  }
  var NIGHTS = {}; // nightKey → { key, label, cand:{ecg:[],ppg:[]}, ecg, ppg }
  var RESULTS = {}; // nightKey → worker result
  var detailWorker = null;

  function el(id) {
    return document.getElementById(id);
  }
  function median(a) {
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) {
      return x - y;
    });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function mean(a) {
    return a.length
      ? a.reduce(function (s, x) {
          return s + x;
        }, 0) / a.length
      : NaN;
  }
  function fmtClock(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var d = new Date(ms),
      p = function (x) {
        return (x < 10 ? '0' : '') + x;
      };
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  function fmtDate(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var d = new Date(ms),
      p = function (x) {
        return (x < 10 ? '0' : '') + x;
      };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function setStatus(t, c) {
    var p = el('status');
    if (p) {
      p.textContent = t;
      p.className = 'pill ' + (c || 'idle');
    }
  }

  // ── file classification + night grouping (Polar Sensor Logger naming) ──────
  function classify(file) {
    var n = file.name,
      mo;
    // anchor the YYYYMMDD_HHMMSS immediately before the kind suffix — a loose \d{8}_\d{6}
    // scan grabs the H10 device serial (H10-01) instead of the date (the zero-nights bug).
    // `_?` between date and time: the phone app writes YYYYMMDD_HHMMSS, the capture host the same
    // 14 digits with no separator — one pattern per role, both layouts (2026-09-20; until then a box
    // night indexed 0 of 134 files). Gated by capture-host test_the_tool_classifiers_accept_box_filenames.
    if ((mo = n.match(/_(\d{8})_?(\d{6})_ECG\.txt$/i))) return { role: 'ecg', stamp: mo[1] + mo[2] };
    /* the O2Ring's raw _PPG.txt is the FINGER site; every other _PPG.txt (the Verity) is the ANKLE. Until
       2026-09-26 both were one 'ppg' role, so a dropped folder could pair the ring as the "ankle" — its session
       starts nearer the ECG than the Verity's on a box night. */
    if ((mo = n.match(/_(\d{8})_?(\d{6})_PPG\.txt$/i))) return { role: /O2Ring/i.test(n) ? 'finger' : 'ppg', stamp: mo[1] + mo[2] };
    // ACC on BOTH devices → the cross-device drift anchor (H10 chest vs Verity arm)
    if ((mo = n.match(/_(\d{8})_?(\d{6})_ACC\.txt$/i))) return { role: /Polar_H10/i.test(n) ? 'ecgacc' : 'ppgacc', stamp: mo[1] + mo[2] };
    return null;
  }
  // sessions starting before noon fold into the PREVIOUS evening (floating civil time)
  function nightKeyOf(stamp) {
    var Y = +stamp.slice(0, 4),
      M = +stamp.slice(4, 6),
      D = +stamp.slice(6, 8),
      h = +stamp.slice(8, 10);
    var ms = Date.UTC(Y, M - 1, D);
    if (h < 12) ms -= 86400000;
    var d = new Date(ms),
      p = function (x) {
        return (x < 10 ? '0' : '') + x;
      };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function largest(a) {
    return a && a.length
      ? a.reduce(function (b, x) {
          return x.file.size > b.file.size ? x : b;
        })
      : null;
  }
  /* stamp (YYYYMMDDHHMMSS, floating civil time) → ms, for ordering sessions within a night */
  function stampMs(st) {
    return Date.UTC(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8), +st.slice(8, 10), +st.slice(10, 12), +st.slice(12, 14));
  }
  /* the candidate whose session START is nearest to an anchor's — the hat's own rule (sensor-trio-power-analysis.js
     `nearest`), applied here for the same reason */
  function nearestTo(a, anchorMs) {
    if (!a || !a.length) return null;
    if (anchorMs == null) return largest(a);
    return a.reduce(function (b, x) {
      return Math.abs(stampMs(x.stamp) - anchorMs) < Math.abs(stampMs(b.stamp) - anchorMs) ? x : b;
    });
  }
  /* ONE SESSION PER DEVICE PER NIGHT IS A PHONE-APP ASSUMPTION. The capture host writes one file per BLE
     session, so a box night holds several per device — measured 2026-09-19: five Verity PPG sessions and
     two H10 ECG sessions. "Largest file per role" then pairs the 67-min ECG (19:20–20:28) with the 7-hour
     PPG that started at 22:41, and the tool reports NO OVERLAP for a night whose 19:16–20:27 Verity session
     overlaps the ECG almost exactly. The ECG stays the anchor (largest — the longest waveform is the most
     R-peaks); the PPG and both ACCs are the sessions whose start is NEAREST to it. Nearest-start is a
     heuristic, not an overlap computation — a session that started just before the anchor and ended before
     it began would still win — but it is the hat's existing rule and it needs nothing the index does not
     already carry. A pair that still does not overlap is reported as such by the coupling step, as before. */
  function resolvePair(nt) {
    var e = largest(nt.cand.ecg),
      eMs = e ? stampMs(e.stamp) : null,
      p = nearestTo(nt.cand.ppg, eMs),
      ea = nearestTo(nt.cand.ecgacc, eMs),
      pa = nearestTo(nt.cand.ppgacc, p ? stampMs(p.stamp) : eMs),
      fg = nearestTo(nt.cand.finger, eMs);
    nt.ecg = e ? e.file : null;
    nt.ppg = p ? p.file : null;
    nt.ecgAcc = ea ? ea.file : null;
    nt.ppgAcc = pa ? pa.file : null;
    nt.finger = fg ? fg.file : null;
  }
  var eligible = function (nt) {
    return !!(nt.ecg && nt.ppg);
  };

  function ingestFiles(list) {
    NIGHTS = {};
    RESULTS = {};
    for (var i = 0; i < list.length; i++) {
      var f = list[i],
        c = classify(f);
      if (!c) continue;
      var nk = nightKeyOf(c.stamp),
        nt = NIGHTS[nk] || (NIGHTS[nk] = { key: nk, label: nk, cand: { ecg: [], ppg: [], ecgacc: [], ppgacc: [], finger: [] } });
      nt.cand[c.role].push({ file: f, stamp: c.stamp });
    }
    Object.keys(NIGHTS).forEach(function (k) {
      resolvePair(NIGHTS[k]);
    });
    renderNightTable();
    var keys = Object.keys(NIGHTS),
      elig = keys.filter(function (k) {
        return eligible(NIGHTS[k]);
      }).length;
    setStatus(keys.length + ' nights · ' + elig + ' eligible (from ' + list.length + ' files)', keys.length ? 'idle' : 'idle');
    var pb = el('run');
    if (pb) pb.disabled = elig === 0;
    var tag = el('nightTag');
    if (tag) tag.textContent = keys.length + ' nights · ' + elig + ' eligible';
  }

  function renderNightTable() {
    var tb = el('nightBody');
    if (!tb) return;
    tb.innerHTML = '';
    var keys = Object.keys(NIGHTS).sort();
    if (!keys.length) {
      tb.innerHTML = '<tr><td colspan="9" class="muted">Drop a capture folder to index nights.</td></tr>';
      return;
    }
    keys.forEach(function (k) {
      var nt = NIGHTS[k],
        ok = eligible(nt),
        tr = document.createElement('tr');
      tr.setAttribute('data-k', k);
      if (ok) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', function () {
          focusNight(k);
        });
      }
      tr.innerHTML =
        '<td>' +
        k +
        '</td>' +
        '<td class="ctr">' +
        (nt.ecg ? '●' : '<span style="color:#FF6B7A">·</span>') +
        '</td>' +
        '<td class="ctr">' +
        (nt.ppg ? '●' : '<span style="color:#FF6B7A">·</span>') +
        '</td>' +
        '<td class="ctr">' +
        (nt.finger ? '●' : '<span style="color:#6f8096">·</span>') +
        '</td>' +
        '<td class="num" id="c-shared-' +
        k +
        '">—</td>' +
        '<td class="num" id="c-coup-' +
        k +
        '">—</td>' +
        '<td class="num" id="c-lag-' +
        k +
        '">—</td>' +
        '<td class="num" id="c-flag-' +
        k +
        '">—</td>' +
        '<td class="mono" id="c-vd-' +
        k +
        '" style="color:#6f8096">' +
        (ok ? 'ready' : 'ineligible') +
        '</td>';
      tb.appendChild(tr);
    });
  }

  function tierColor(t) {
    return t === 'go' ? C.green : t === 'maybe' ? C.amber : C.red;
  }
  function setRow(k, m) {
    var sh = el('c-shared-' + k),
      co = el('c-coup-' + k),
      lg = el('c-lag-' + k),
      vd = el('c-vd-' + k);
    if (m.error) {
      if (vd) {
        vd.textContent = 'error';
        vd.style.color = C.red;
        vd.title = m.error;
      }
      return;
    }
    if (sh) {
      sh.innerHTML = evb('clock') + ' ' + (m.sc.ok ? 'yes' : 'no');
      sh.style.color = m.sc.ok ? C.green : C.red;
    }
    if (m.cp.ok) {
      if (co) co.innerHTML = evb('coupling') + ' ' + (m.cp.matchRate * 100).toFixed(0) + '%';
      if (lg) lg.innerHTML = evb('lag') + ' ' + m.cp.med.toFixed(0) + ' ms';
    }
    var fl = el('c-flag-' + k);
    if (fl) fl.innerHTML = m.cpF && m.cpF.ok ? evb('lag') + ' ' + m.cpF.med.toFixed(0) + ' ms' : m.fingerError ? '<span title="' + escHtml(m.fingerError) + '">error</span>' : '—';
    if (vd) {
      /* SURFACE THE SECOND VERDICT (2026-09-02) — composed by `PATGate.verdictCell`, not here.
         The worker publishes TWO gate results (`vd` on raw drift, `vdCorr` on ACC-corrected) and this
         cell read only the first, so `vdCorr` crossed the worker boundary and was dropped at the last
         step. It lived inline in this file, which is an anonymous IIFE with no export surface — so no
         test could reach it, and `dex-tests.js` scanned the worker 5 times and the renderer 0. The
         composition now lives beside the gate where it is pure and tested.

         ⚠️ The tier COLOUR is deliberately unchanged: promoting on corrected drift is the owner's
         scientific call, which this surfaces rather than decides. */
      var cell = (self.PATGate && self.PATGate.verdictCell)(m);
      vd.textContent = cell.text;
      vd.title = cell.title;
      vd.style.color = tierColor(m.vd.tier);
    }
  }

  // ── worker pool over eligible nights ───────────────────────────────────────
  function runBatch() {
    var nights = Object.keys(NIGHTS)
      .sort()
      .map(function (k) {
        return NIGHTS[k];
      })
      .filter(eligible);
    if (!nights.length) {
      setStatus('no eligible night', 'idle');
      return;
    }
    RESULTS = {};
    el('run').disabled = true;
    setStatus('booting workers…', 'run');
    var queue = nights.slice(),
      total = nights.length,
      done = 0;
    var N = Math.min(navigator.hardwareConcurrency || 4, Math.max(1, total)),
      workers = [];
    function feed(w) {
      if (!queue.length) return;
      var nt = queue.shift();
      setStatus('processing ' + (done + 1) + '/' + total + '…', 'run');
      w.postMessage({ type: 'job', key: nt.key, label: nt.label, ecgFile: nt.ecg, ppgFile: nt.ppg, ecgAccFile: nt.ecgAcc, ppgAccFile: nt.ppgAcc, fingerFile: nt.finger || null, detail: false });
    }
    for (var i = 0; i < N; i++) {
      var w = new Worker('pat-feasibility-worker.js');
      w.onmessage = function (ev) {
        var m = ev.data,
          src = ev.target;
        if (m.type === 'ready') {
          if (!m.ok) {
            setStatus('worker DSP load failed: ' + (m.err || ''), 'idle');
          }
          feed(src);
          return;
        }
        if (m.type === 'result') {
          RESULTS[m.key] = m;
          setRow(m.key, m);
          done++;
          if (done >= total) {
            finishBatch();
            workers.forEach(function (x) {
              x.terminate();
            });
          } else feed(src);
        }
      };
      w.onerror = function (e) {
        setStatus('worker error: ' + ((e && e.message) || e), 'idle');
      };
      w.postMessage({ type: 'ping' });
      workers.push(w);
    }
  }

  function finishBatch() {
    el('run').disabled = false;
    var oks = Object.keys(RESULTS)
      .map(function (k) {
        return RESULTS[k];
      })
      .filter(function (m) {
        return m.cp && m.cp.ok && m.sc && m.sc.ok;
      });
    renderAggregate(oks);
    setStatus('done · ' + oks.length + ' coupled night(s)', 'done');
    el('dlBtn').disabled = false;
    // auto-focus the first eligible if only one, else the worst-drift night (most informative)
    var elig = Object.keys(NIGHTS)
      .sort()
      .filter(function (k) {
        return eligible(NIGHTS[k]);
      });
    if (elig.length) focusNight(elig.length === 1 ? elig[0] : elig[0]);
  }

  function agg(oks, f) {
    return oks.map(f).filter(function (v) {
      return isFinite(v);
    });
  }
  function renderAggregate(oks) {
    var cards = [];
    var nNights = Object.keys(NIGHTS).filter(function (k) {
      return eligible(NIGHTS[k]);
    }).length;
    var totalBeats = oks.reduce(function (s, m) {
      return s + (m.cp.nCoupled || 0);
    }, 0);
    var refused = Object.keys(RESULTS)
      .map(function (k) {
        return RESULTS[k];
      })
      .filter(refusedButComputed);
    cards.push(
      hcard('eligible nights', String(nNights), '', oks.length + ' coupled · ' + (refused.length ? refused.length + ' not certified · ' : '') + Object.keys(NIGHTS).length + ' indexed', C.ink, 'count')
    );
    cards.push(hcard('coupled beats (ΣN)', totalBeats.toLocaleString(), '', 'across all coupled nights', C.blue, 'count'));
    if (oks.length) {
      var ppm = agg(oks, function (m) {
          return m.cp.ppm;
        }),
        mr = agg(oks, function (m) {
          return m.cp.matchRate * 100;
        });
      var riq = agg(oks, function (m) {
          return m.cp.residIQR;
        }),
        lin = agg(oks, function (m) {
          return m.cp.linR2;
        });
      cards.push(
        hcard(
          'inter-device drift',
          isFinite(median(ppm)) ? median(ppm).toFixed(0) : '—',
          'ppm',
          'median · range ' + Math.min.apply(null, ppm).toFixed(0) + '–' + Math.max.apply(null, ppm).toFixed(0),
          C.amber,
          'drift'
        )
      );
      cards.push(hcard('coupling', median(mr).toFixed(0), '%', 'median across nights', median(mr) >= 55 ? C.green : C.amber, 'coupling'));
      cards.push(hcard('beat-to-beat spread', median(riq).toFixed(0), 'ms', 'median lag IQR', median(riq) <= 60 ? C.green : C.amber, 'spread'));
      var linMed = median(lin),
        kind = linMed >= 0.6 ? 'LINEAR — 2-point sync fixes it' : 'NON-LINEAR — needs continuous correction';
      cards.push(hcard('drift shape', linMed >= 0.6 ? 'linear' : 'wander', '', 'median R²=' + (isFinite(linMed) ? linMed.toFixed(2) : '—') + ' · ' + kind, linMed >= 0.6 ? C.green : C.amber, 'drift'));
      // ACC-sync before/after (the point of the whole stage)
      var corrN = oks.filter(function (m) {
        return m.cpCorr && m.cpCorr.ok && m.accSync && m.accSync.available;
      });
      var mCorr = NaN,
        mRaw = NaN;
      if (corrN.length) {
        var cDr = agg(corrN, function (m) {
            return m.cpCorr.driftRange;
          }),
          rDr = agg(corrN, function (m) {
            return m.cp.driftRange;
          });
        mCorr = median(cDr);
        mRaw = median(rDr);
        cards.push(
          hcard(
            'drift after ACC-sync',
            isFinite(mCorr) ? mCorr.toFixed(0) : '—',
            'ms',
            'median · was ' + (isFinite(mRaw) ? mRaw.toFixed(0) : '—') + ' ms raw · ' + corrN.length + ' nights',
            mCorr < 100 ? C.green : mCorr < mRaw * 0.5 ? C.amber : C.red,
            'acc'
          )
        );
      }
      // verdict-of-verdicts
      var drift = oks.filter(function (m) {
          return m.vd.tier === 'no';
        }).length,
        go = oks.filter(function (m) {
          return m.vd.tier === 'go';
        }).length;
      var concl =
        go === oks.length
          ? 'All nights FEASIBLE even before correction — build the provisional trend panel.'
          : drift >= oks.length * 0.5
            ? 'Raw: drift-dominated across nights (~' + median(ppm).toFixed(0) + ' ppm) — systematic device-clock drift confirmed, not viable from phone timestamps alone.'
            : 'Raw: mixed — coupling holds but drift varies night to night.';
      if (corrN.length) {
        var redPct = mRaw > 0 ? (1 - mCorr / mRaw) * 100 : 0;
        concl +=
          ' <b style="color:' +
          (mCorr < 100 ? C.green : C.amber) +
          '">ACC-sync</b> (automatic, from your sleep movements — no taps) cut drift <b>' +
          mRaw.toFixed(0) +
          '→' +
          mCorr.toFixed(0) +
          ' ms</b> (' +
          redPct.toFixed(0) +
          '% lower) over ' +
          corrN.length +
          ' nights — ' +
          (mCorr < 100
            ? 'drift is largely REMOVABLE; the residual approaches the PAT signal, so a clean-window ankle-PAT trend looks buildable.'
            : mCorr < mRaw * 0.5
              ? 'substantially reduced but not gone — refine motion anchors / clean-window selection.'
              : 'not meaningfully reduced — chest↔ankle motion may be too decorrelated; try a single-host capture.');
      }
      el('aggConcl').innerHTML = '<b style="color:' + (go === oks.length ? C.green : C.amber) + '">Across ' + oks.length + ' nights:</b> ' + concl;
    } else {
      el('aggConcl').innerHTML = refused.length
        ? '<span class="muted">No night is certified.</span>'
        : '<span class="muted">No night produced a coupled result — check that each night has BOTH a Polar H10 _ECG.txt and a Verity _PPG.txt from the same session.</span>';
    }
    if (refused.length)
      el('aggConcl').innerHTML +=
        '<div class="ncsig"><b>' +
        refused.length +
        ' night' +
        (refused.length > 1 ? 's' : '') +
        ' computed but NOT CERTIFIED</b> — excluded from every figure above: ' +
        refused
          .map(function (m) {
            return escHtml(m.key + ' · ' + m.vd.label + (m.vd.why && m.vd.why.reason ? ' — ' + m.vd.why.reason : ''));
          })
          .join('; ') +
        '</div>';
    el('aggCards').innerHTML = cards.join('');
  }

  // ── focused single-night detail (scatter + hist) ───────────────────────────
  function focusNight(k) {
    var nt = NIGHTS[k];
    if (!nt || !eligible(nt)) return;
    el('focusTitle').textContent = 'Night ' + k;
    setStatus('rendering ' + k + '…', 'run');
    if (!detailWorker) detailWorker = new Worker('pat-feasibility-worker.js');
    detailWorker.onmessage = function (ev) {
      var m = ev.data;
      if (m.type === 'ready') {
        return;
      }
      if (m.type !== 'result') return;
      setStatus('done', 'done');
      if (m.error) {
        el('focusHead').innerHTML = '<div class="muted" style="color:' + C.red + '">' + m.error + '</div>';
        return;
      }
      renderFocus(m);
    };
    detailWorker.postMessage({ type: 'job', key: k, label: k, ecgFile: nt.ecg, ppgFile: nt.ppg, ecgAccFile: nt.ecgAcc, ppgAccFile: nt.ppgAcc, fingerFile: nt.finger || null, detail: true });
  }

  /* COMPUTED BUT NOT CERTIFIED (owner, 2026-09-23): when the gate refuses a night whose lag WAS
     computed, the numbers stay on screen and the refusal is signed — a visible NOT CERTIFIED with the
     gate's own reason — never a bare label the reader has to decode. */
  function refusedButComputed(m) {
    return !!(m && m.vd && m.vd.tier === 'no' && m.cp && m.cp.ok);
  }
  function notCertifiedSig(m) {
    if (!refusedButComputed(m)) return '';
    var why = m.vd.why && m.vd.why.reason ? m.vd.why.reason : 'the gate gave no reason';
    return '<div class="ncsig"><b>NOT CERTIFIED</b> — the lag below was computed but is not a certified PAT: ' + escHtml(why) + '</div>';
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderFocus(m) {
    var cp = m.cp,
      sc = m.sc;
    el('prov').innerHTML =
      'ECG <b>' +
      fmtDate(m.ecg.t0Ms) +
      ' ' +
      fmtClock(m.ecg.t0Ms) +
      '</b> · ' +
      m.ecg.n +
      ' R' +
      (m.ecg.nRaw > m.ecg.n ? ' (of ' + m.ecg.nRaw + ' detected · ' + (m.ecg.artifactSec / 60).toFixed(0) + ' min of artifact dropped)' : '') +
      ' @ ' +
      m.ecg.fs +
      ' Hz · ' +
      (m.ecg.durSec / 60).toFixed(0) +
      ' min &nbsp;|&nbsp; PPG <b>' +
      fmtDate(m.ppg.t0Ms) +
      ' ' +
      fmtClock(m.ppg.t0Ms) +
      '</b> · ' +
      m.ppg.n +
      ' feet @ ' +
      m.ppg.fs +
      ' Hz';
    var vc = el('focusVerdict');
    vc.className = 'verdict ' + m.vd.tier;
    vc.innerHTML = '<div class="vlabel" style="color:' + tierColor(m.vd.tier) + '">' + m.vd.label + '</div>' + notCertifiedSig(m);
    var cards = [];
    cards.push(hcard('shared clock', sc.ok ? 'YES' : 'NO', '', 'Δstart ' + (sc.dT0 / 1000).toFixed(1) + ' s · beats ' + (sc.beatRatio * 100).toFixed(1) + '%', sc.ok ? C.green : C.red, 'clock'));
    if (cp.ok) {
      cards.push(hcard('beats coupled', (cp.matchRate * 100).toFixed(0), '%', cp.nCoupled + ' beats (local baseline)', cp.matchRate >= G.COUPLING_MIN ? C.green : C.amber, 'coupling'));
      cards.push(hcard('chest→ankle median lag', cp.med.toFixed(0), 'ms', 'IQR ' + cp.p25.toFixed(0) + '–' + cp.p75.toFixed(0), C.blue, 'lag'));
      cards.push(hcard('beat-to-beat', isFinite(cp.residIQR) ? cp.residIQR.toFixed(0) : '—', 'ms', 'lag IQR vs local baseline', cp.residIQR <= G.BEAT_IQR_MAX_MS ? C.green : C.amber, 'spread'));
      cards.push(
        hcard(
          'drift',
          isFinite(cp.driftRange) ? cp.driftRange.toFixed(0) : '—',
          'ms',
          (isFinite(cp.ppm) ? cp.ppm.toFixed(0) + ' ppm' : '') + (isFinite(cp.linR2) ? ' · R²=' + cp.linR2.toFixed(2) : ''),
          cp.driftRange <= G.DRIFT_MAX_MS ? C.green : C.amber,
          'drift'
        )
      );
    }
    if (m.accSync && m.accSync.available && m.cpCorr && m.cpCorr.ok) {
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(
        hcard(
          'ACC-sync drift',
          m.cp.driftRange.toFixed(0) + '→' + m.cpCorr.driftRange.toFixed(0),
          'ms',
          m.accSync.anchors + ' motion anchors · ' + (m.accSync.coverage * 100).toFixed(0) + '% cover',
          m.cpCorr.driftRange < m.cp.driftRange * 0.5 ? C.green : C.amber,
          'acc'
        )
      );
      cards.push(
        hcard(
          'after correction',
          (m.cpCorr.matchRate * 100).toFixed(0) + '%',
          '',
          'coupling · beat-to-beat ' + (isFinite(m.cpCorr.residIQR) ? m.cpCorr.residIQR.toFixed(0) : '—') + ' ms',
          C.blue,
          'acc'
        )
      );
    } else if (m.accSync) {
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(hcard('ACC-sync', 'n/a', '', m.accSync.reason || 'unavailable', C.mut));
    }
    el('focusHead').innerHTML = cards.join('');
    drawScatter(m);
    drawHist(m);
    renderThree(m);
  }

  /* ── THE THREE SITES: chest→finger · chest→ankle · finger→ankle, and the hat between them ───────────── */
  var LEG = {
    ab: { name: 'chest → finger', col: C.amber },
    ac: { name: 'chest → ankle', col: C.blue },
    bc: { name: 'finger → ankle', col: '#B98AFF' }
  };
  function legCards(tag, c, vd) {
    if (!c || !c.ok) return hcard(LEG[tag].name, '—', '', c && c.reason ? c.reason : 'not coupled', C.mut);
    var cert = vd && vd.tier === 'no' ? ' · NOT CERTIFIED: ' + escHtml(vd.why && vd.why.reason ? vd.why.reason : vd.label) : '';
    return (
      hcard(LEG[tag].name + ' median lag', c.med.toFixed(0), 'ms', 'IQR ' + c.p25.toFixed(0) + '–' + c.p75.toFixed(0) + cert, LEG[tag].col, 'lag') +
      hcard(LEG[tag].name + ' coupled', (c.matchRate * 100).toFixed(0), '%', c.nCoupled + ' beats', C.ink, 'coupling') +
      hcard(LEG[tag].name + ' beat-to-beat', isFinite(c.residIQR) ? c.residIQR.toFixed(0) : '—', 'ms', 'lag IQR vs 30 s local median', C.ink, 'spread')
    );
  }
  function renderThree(m) {
    var box = el('threeHead'),
      hb = el('hatHead');
    if (!box || !hb) return;
    if (!m.finger && !m.fingerError) {
      box.innerHTML = '<div class="muted">No O2Ring <code>_PPG.txt</code> for this night — the finger site and the hat need it.</div>';
      hb.innerHTML = '';
      drawThree(null);
      drawHat(null);
      drawHistF(m);
      return;
    }
    if (m.fingerError) {
      box.innerHTML = '<div class="muted" style="color:' + C.red + '">finger leg failed: ' + escHtml(m.fingerError) + '</div>';
      hb.innerHTML = '';
      drawThree(null);
      drawHat(null);
      drawHistF(m);
      return;
    }
    box.innerHTML =
      '<div class="tri">' +
      '<div class="headline">' +
      legCards('ab', m.cpF, m.vdF) +
      '</div>' +
      '<div class="headline">' +
      legCards('ac', m.cp, m.vd) +
      '</div>' +
      '<div class="headline">' +
      legCards('bc', m.cpFA, null) +
      '</div>' +
      '</div>';
    var h = m.three,
      hc = [];
    if (h && h.ok) {
      [
        ['chest', 'H10 chest ECG', C.teal],
        ['finger', 'O2Ring finger', C.amber],
        ['ankle', 'Verity ankle', '#B98AFF']
      ].forEach(function (r) {
        var s = h.sigma[r[0]];
        hc.push(
          hcard(
            'σ ' + r[1],
            s == null ? 'REFUSED' : s.toFixed(1),
            s == null ? '' : 'ms',
            s == null ? 'negative variance ' + h.variance[r[0]].toFixed(0) + ' ms² — the independent-error model does not fit this site' : 'from ' + h.n + ' × ' + h.winMin + '-min windows',
            s == null ? C.mut : r[2],
            'hat'
          )
        );
      });
      hc.push(
        hcard(
          'pair spreads',
          h.pairSd.ab.toFixed(1) + ' · ' + h.pairSd.ac.toFixed(1) + ' · ' + h.pairSd.bc.toFixed(1),
          'ms',
          'IQR/1.349 of window medians · finger · ankle · finger→ankle',
          C.ink,
          'hat'
        )
      );
      hc.push(hcard('windows solved', String(h.n), '', 'all three legs ≥ 50 beats in the same ' + h.winMin + ' min', C.ink, 'count'));
    } else hc.push(hcard('three-cornered hat', '—', '', h && h.reason ? h.reason : 'not solved', C.mut));
    hb.innerHTML = hc.join('');
    drawThree(h);
    drawHat(h);
    drawHistF(m);
  }
  function drawThree(h) {
    var cv = el('threeChart');
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      ht = g.h,
      pad = 44;
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    if (!h || !h.windows || h.windows.length < 2) {
      ctx.fillText('needs all three sites coupled', pad, ht / 2);
      return;
    }
    var W = h.windows,
      t0 = W[0].t,
      t1 = W[W.length - 1].t,
      all = [];
    W.forEach(function (x) {
      all.push(x.ab, x.ac, x.bc);
    });
    var lo = Math.max(-100, Math.floor(Math.min.apply(null, all) / 50) * 50 - 50),
      hi = Math.ceil(Math.max.apply(null, all) / 50) * 50 + 50;
    var X = function (t) {
        return pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad - 12);
      },
      Y = function (v) {
        return ht - 26 - ((v - lo) / (hi - lo || 1)) * (ht - 26 - 18);
      };
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    for (var gy = 0; gy <= 4; gy++) {
      var v = lo + ((hi - lo) * gy) / 4,
        y = Y(v);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - 12, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(0), 6, y + 3);
    }
    ctx.fillText('5-min median lag (ms) vs time of night', pad, 12);
    ['ab', 'ac', 'bc'].forEach(function (k) {
      ctx.strokeStyle = LEG[k].col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      W.forEach(function (x, i) {
        i ? ctx.lineTo(X(x.t), Y(x[k])) : ctx.moveTo(X(x.t), Y(x[k]));
      });
      ctx.stroke();
    });
    ctx.fillStyle = C.mut;
    for (var q = 0; q <= 4; q++) {
      var tq = t0 + ((t1 - t0) * q) / 4;
      ctx.fillText(fmtClock(tq), X(tq) - 14, ht - 8);
    }
  }
  function drawHat(h) {
    var cv = el('hatChart');
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      ht = g.h,
      pad = 110;
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    if (!h || !h.ok) {
      ctx.fillText(h && h.reason ? h.reason : 'needs all three sites coupled', 12, ht / 2);
      return;
    }
    var rows = [
        ['H10 chest', h.sigma.chest, C.teal],
        ['O2Ring finger', h.sigma.finger, C.amber],
        ['Verity ankle', h.sigma.ankle, '#B98AFF']
      ],
      mx = Math.max(10, h.pairSd.ab, h.pairSd.ac, h.pairSd.bc),
      bh = (ht - 40) / 3;
    ctx.fillText('per-site σ (ms)', 12, 12);
    rows.forEach(function (r, i) {
      var y = 24 + i * bh;
      ctx.fillStyle = C.ink;
      ctx.fillText(r[0], 12, y + bh / 2);
      if (r[1] == null) {
        ctx.fillStyle = C.mut;
        ctx.fillText('REFUSED — negative variance', pad, y + bh / 2);
        return;
      }
      ctx.fillStyle = r[2];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(pad, y + 4, ((w - pad - 60) * r[1]) / mx, bh - 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.ink;
      ctx.fillText(r[1].toFixed(1) + ' ms', pad + ((w - pad - 60) * r[1]) / mx + 6, y + bh / 2);
    });
  }
  function drawHistF(m) {
    var cv = el('histF');
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      h = g.h,
      pad = 30;
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    var legs = [
      ['chest→finger', m.detailF, C.amber],
      ['chest→ankle', m.detail, C.blue],
      ['finger→ankle', m.detailFA, '#B98AFF']
    ].filter(function (x) {
      return x[1] && x[1].pat && x[1].pat.length;
    });
    if (!legs.length) {
      ctx.fillText('no coupled beats', pad, h / 2);
      return;
    }
    var lo = 0,
      hi = 800,
      nb = 80,
      bw = (w - pad - 12) / nb;
    ctx.fillText('lag distribution per leg (ms) — each normalised to its own peak', pad, 12);
    legs.forEach(function (L) {
      var bins = new Array(nb).fill(0);
      L[1].pat.forEach(function (v) {
        var b = Math.floor(((v - lo) / (hi - lo)) * nb);
        if (b >= 0 && b < nb) bins[b]++;
      });
      var mx = Math.max.apply(null, bins) || 1;
      ctx.strokeStyle = L[2];
      ctx.lineWidth = 2;
      ctx.beginPath();
      bins.forEach(function (c, i) {
        var x = pad + (i + 0.5) * bw,
          y = h - pad - (c / mx) * (h - pad - 22);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    });
    ctx.strokeStyle = C.mut;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - 12, h - pad);
    ctx.stroke();
    ctx.fillStyle = C.mut;
    for (var q = 0; q <= 8; q++) ctx.fillText(String(q * 100), pad + (q * (w - pad - 12)) / 8 - 6, h - pad + 12);
  }

  function hcard(label, val, unit, sub, tone, ev) {
    return (
      '<div class="hcard">' +
      (ev ? '<span class="ev-corner">' + evb(ev) + '</span>' : '') +
      '<div class="hl" style="color:' +
      (tone || C.ink) +
      '">' +
      val +
      (unit ? ' <span class="hu">' + unit + '</span>' : '') +
      '</div><div class="hk">' +
      label +
      '</div>' +
      (sub ? '<div class="hs">' + sub + '</div>' : '') +
      '</div>'
    );
  }
  function prep(cv) {
    var d = Math.min(2, window.devicePixelRatio || 1),
      w = cv.clientWidth || cv.width,
      h = cv.height;
    cv.width = w * d;
    cv.height = h * d;
    var ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function drawScatter(m) {
    var cv = el('scatter');
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      h = g.h,
      pad = 44;
    if (!m.cp.ok || !m.detail) {
      ctx.fillStyle = C.mut;
      ctx.font = '12px monospace';
      ctx.fillText('no coupled beats', pad, h / 2);
      return;
    }
    var pts = m.detail.patAtR,
      cp = m.cp;
    if (!pts.length) return;
    var t0 = pts[0].t,
      t1 = pts[pts.length - 1].t;
    var lo = Math.max(0, cp.med - 300),
      hi = cp.med + 300;
    var X = function (t) {
      return pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad - 12);
    };
    var Y = function (v) {
      return h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad - 14);
    };
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    for (var gy = 0; gy <= 4; gy++) {
      var v = lo + ((hi - lo) * gy) / 4,
        y = Y(v);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - 12, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(0), 6, y + 3);
    }
    ctx.fillText('R→foot lag (ms) vs time of night', pad, 12);
    ctx.fillStyle = 'rgba(57,217,138,.07)';
    ctx.fillRect(pad, Y(PHYS_HI), w - pad - 12, Y(PHYS_LO) - Y(PHYS_HI));
    ctx.fillStyle = 'rgba(88,166,255,.5)';
    for (var i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(X(pts[i].t), Y(pts[i].lag), 1.3, 0, 6.283);
      ctx.fill();
    }
    ctx.strokeStyle = C.teal;
    ctx.lineWidth = 2;
    ctx.beginPath();
    cp.binMed.forEach(function (b, i) {
      var x = X(t0 + b.min * 60000),
        y = Y(b.med);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  function drawHist(m) {
    var cv = el('hist');
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      h = g.h,
      pad = 30;
    if (!m.cp.ok || !m.detail) {
      ctx.fillStyle = C.mut;
      ctx.font = '12px monospace';
      ctx.fillText('no coupled beats', pad, h / 2);
      return;
    }
    var cp = m.cp,
      lo = Math.max(0, cp.med - 300),
      hi = cp.med + 300,
      nb = 44,
      bins = new Array(nb).fill(0);
    m.detail.pat.forEach(function (v) {
      var b = Math.floor(((v - lo) / (hi - lo)) * nb);
      if (b >= 0 && b < nb) bins[b]++;
    });
    var mx = Math.max.apply(null, bins) || 1,
      bw = (w - pad - 12) / nb;
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    ctx.fillText('lag distribution (ms)', pad, 12);
    for (var i = 0; i < nb; i++) {
      var bh = (bins[i] / mx) * (h - pad - 16),
        x = pad + i * bw,
        cc = lo + ((i + 0.5) / nb) * (hi - lo);
      ctx.fillStyle = cc >= PHYS_LO && cc <= PHYS_HI ? C.green : C.blue;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x, h - pad - bh, bw - 1, bh);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = C.mut;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - 12, h - pad);
    ctx.stroke();
    ctx.fillStyle = C.mut;
    ctx.fillText(lo.toFixed(0), pad, h - pad + 12);
    ctx.fillText(hi.toFixed(0), w - 40, h - pad + 12);
  }

  function downloadJSON() {
    var oks = Object.keys(RESULTS)
      .map(function (k) {
        return RESULTS[k];
      })
      .filter(function (m) {
        return m.cp && m.cp.ok && m.sc && m.sc.ok;
      });
    var ppm = agg(oks, function (m) {
      return m.cp.ppm;
    });
    var out = {
      generated: new Date().toISOString(),
      nightsIndexed: Object.keys(NIGHTS).length,
      nightsEligible: Object.keys(NIGHTS).filter(function (k) {
        return eligible(NIGHTS[k]);
      }).length,
      nightsCoupled: oks.length,
      totalCoupledBeats: oks.reduce(function (s, m) {
        return s + m.cp.nCoupled;
      }, 0),
      aggregate: oks.length
        ? {
            driftPpm: { median: +median(ppm).toFixed(1), min: +Math.min.apply(null, ppm).toFixed(1), max: +Math.max.apply(null, ppm).toFixed(1) },
            matchRatePctMedian: +median(
              agg(oks, function (m) {
                return m.cp.matchRate * 100;
              })
            ).toFixed(1),
            beatToBeatIQRmsMedian: +median(
              agg(oks, function (m) {
                return m.cp.residIQR;
              })
            ).toFixed(1),
            driftShapeR2Median: +median(
              agg(oks, function (m) {
                return m.cp.linR2;
              })
            ).toFixed(2),
            afterAccSync: (function () {
              var c = oks.filter(function (m) {
                return m.cpCorr && m.cpCorr.ok && m.accSync && m.accSync.available;
              });
              return c.length
                ? {
                    nNights: c.length,
                    driftRangeMsMedian: +median(
                      agg(c, function (m) {
                        return m.cpCorr.driftRange;
                      })
                    ).toFixed(1),
                    driftPpmMedian: +median(
                      agg(c, function (m) {
                        return m.cpCorr.ppm;
                      })
                    ).toFixed(1),
                    rawDriftRangeMsMedian: +median(
                      agg(c, function (m) {
                        return m.cp.driftRange;
                      })
                    ).toFixed(1)
                  }
                : null;
            })()
          }
        : null,
      nights: Object.keys(RESULTS)
        .sort()
        .map(function (k) {
          var m = RESULTS[k];
          if (m.error) return { night: k, error: m.error };
          return {
            night: k,
            start: fmtDate(m.ecg.t0Ms) + 'T' + fmtClock(m.ecg.t0Ms),
            sharedClock: m.sc.ok,
            overlapMin: +m.ov.min.toFixed(1),
            rPeaks: m.ecg.n,
            feet: m.ppg.n,
            coupling: m.cp.ok
              ? {
                  matchRatePct: +(m.cp.matchRate * 100).toFixed(1),
                  medianLagMs: +m.cp.med.toFixed(1),
                  beatToBeatIQRms: +(+m.cp.residIQR).toFixed(1),
                  driftRangeMs: +(+m.cp.driftRange).toFixed(1),
                  driftPpm: +(+m.cp.ppm).toFixed(1),
                  linR2: +(+m.cp.linR2).toFixed(2)
                }
              : null,
            accSync: m.accSync || null,
            correctedCoupling:
              m.cpCorr && m.cpCorr.ok
                ? {
                    matchRatePct: +(m.cpCorr.matchRate * 100).toFixed(1),
                    medianLagMs: +m.cpCorr.med.toFixed(1),
                    beatToBeatIQRms: +(+m.cpCorr.residIQR).toFixed(1),
                    driftRangeMs: +(+m.cpCorr.driftRange).toFixed(1),
                    driftPpm: +(+m.cpCorr.ppm).toFixed(1)
                  }
                : null,
            verdict: m.vd.label
          };
        })
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pat-feasibility-batch.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  // ── drag-drop folder (webkitGetAsEntry recursion) ──────────────────────────
  function collectEntries(items) {
    var files = [],
      top = [];
    function walk(entry) {
      return new Promise(function (res) {
        if (!entry) return res();
        if (entry.isFile)
          entry.file(
            function (f) {
              files.push(f);
              res();
            },
            function () {
              res();
            }
          );
        else if (entry.isDirectory) {
          var rd = entry.createReader(),
            all = [];
          (function read() {
            rd.readEntries(
              function (ents) {
                if (!ents.length) {
                  Promise.all(all.map(walk)).then(function () {
                    res();
                  });
                } else {
                  all = all.concat([].slice.call(ents));
                  read();
                }
              },
              function () {
                res();
              }
            );
          })();
        } else res();
      });
    }
    for (var i = 0; i < items.length; i++) {
      var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (en) top.push(walk(en));
    }
    return Promise.all(top).then(function () {
      return files;
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    var fi = el('folderInput'),
      xi = el('fileInput'),
      dz = el('dropzone');
    if (fi)
      fi.addEventListener('change', function (e) {
        ingestFiles(e.target.files);
      });
    if (xi)
      xi.addEventListener('change', function (e) {
        ingestFiles(e.target.files);
      });
    if (dz) {
      dz.addEventListener('dragover', function (e) {
        e.preventDefault();
        dz.style.borderColor = 'rgba(88,166,255,.6)';
      });
      dz.addEventListener('dragleave', function () {
        dz.style.borderColor = 'rgba(255,255,255,.18)';
      });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.style.borderColor = 'rgba(255,255,255,.18)';
        var dt = e.dataTransfer;
        if (dt && dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) collectEntries(dt.items).then(ingestFiles);
        else if (dt && dt.files) ingestFiles(dt.files);
      });
    }
    if (el('run')) el('run').addEventListener('click', runBatch);
    if (el('dlBtn')) el('dlBtn').addEventListener('click', downloadJSON);
    renderNightTable();
  });
})();
