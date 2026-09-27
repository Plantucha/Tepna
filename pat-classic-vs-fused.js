/*
 * pat-classic-vs-fused.js — Tepna analysis tool: PAT statistics and the three-cornered hat,
 * UNWEIGHTED (classic) beside CONFIDENCE-WEIGHTED (fused), for one night.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE files at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE IS FOR. `PAT Feasibility` answers "is this night's PAT usable"; this one answers
 * "does weighting each beat by how much the two sensors were trusted CHANGE the answer". Same night,
 * same pairs, two columns.
 *
 * THE CLASSIC COLUMN IS PAT FEASIBILITY'S OWN OUTPUT, not a reproduction of it. This page runs
 * `pat-feasibility-worker.js` unchanged and renders the numbers it posts. There is no second copy of
 * `coupledPAT`, of `threeHat` or of the lag statistics anywhere here — so "the classic column matches
 * PAT Feasibility" is true by construction rather than by a parity assertion, and the two pages cannot
 * drift into disagreeing about one night.
 *
 * THE FUSED COLUMN IS THE SAME SOLVER WITH A WEIGHT. `AnalysisStats.legWeights` /
 * `AnalysisStats.fusedLeg` weight each coupled pair by `c_R × c_foot` and the worker's own `threeHat`
 * takes those weights as optional arguments. One hat solver in the repo; `tch-parity` reds a page that
 * grows a private one.
 *
 * 🔴 WHERE THE TWO COLUMNS CAN DIFFER, AND WHERE THEY CANNOT — measured, and the delta card says it.
 * A localised artifact burst is a small share of a night, and a MEDIAN is robust to a small share: at
 * 12.5 % contamination the classic whole-night lag moved 220 → 222 ms in the planted test, which is
 * nothing. The weighting earns its keep one level down:
 *   · the SPREAD — the classic IQR widens over a burst, the fused one does not;
 *   · the PER-WINDOW MEDIANS THE HAT IS BUILT FROM — inside a burst every pair in the window is
 *     contaminated, so that window's classic median is wrong by the FULL inflation with no robustness
 *     left to save it, and the fused one refuses instead of averaging distrusted pairs.
 * A reader who expects the headline lag to move is reading the wrong row, so the page says so rather
 * than letting a ~0 delta be read as "weighting does nothing".
 *
 * ABSENCE IS VISIBLE (CLAUDE.md §∅). A corner that published no per-second confidence is shown
 * UNWEIGHTED and labelled; it is never weighted by 1 to make a column render. The O2Ring finger
 * corner's confidence is **UNVERIFIED** on its single-channel drawn axis — that is a different claim
 * from unusable, and this page does not upgrade it.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  function el(id) {
    return document.getElementById(id);
  }
  var C = { green: '#57D9A3', amber: '#F5C36B', blue: '#6FB3FF', mut: 'rgba(255,255,255,.45)', ink: '#E8ECF1' };

  /* ── TRUST BADGES (§🎫) — every number this page surfaces carries one, with its reason ──────────────
     The fused rows are graded exactly as `PAT Feasibility` grades its hat — `experimental`, because the
     statistic is computed from consumer sensors and has not been validated against a reference here —
     with the weighting named in the reason so the grade is not silently inherited from the classic row. */
  var EV = {
    count: ['measured', 'a count of nights, beats or windows — direct'],
    coverage: ['measured', 'share of accepted pairs that carried a confidence at both ends — a direct coverage statistic'],
    lag: ['experimental', 'R-peak → pulse-foot arrival time from consumer sensors; not validated against a reference'],
    lagF: ['experimental', 'the same lag, each pair weighted by c_R × c_foot; the weighting is unvalidated and the underlying lag is too'],
    spread: ['experimental', 'IQR of the lag — a derived dispersion'],
    spreadF: ['experimental', 'weighted IQR of the same lag — derived, and the weighting is unvalidated'],
    hat: ['experimental', 'classic three-cornered hat on 5-min PAT medians — assumes independent per-site errors; unvalidated'],
    hatF: ['experimental', 'the same hat on WEIGHTED 5-min medians — the independence assumption is unchanged and still unvalidated'],
    delta: ['experimental', 'fused minus classic — a difference of two experimental estimates, not a measurement of either']
  };
  function evb(k) {
    var e = EV[k] || EV.lag;
    return self.MetricRegistry && self.MetricRegistry.badge ? self.MetricRegistry.badge(e[0], e[1]) : '';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c2) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c2];
    });
  }
  /* A card. `position:relative` + `.ev-corner` is the §🎫 placement for a KPI; the badge is never
     omitted, and a card with no number still carries the grade of the thing it failed to show. */
  function card(label, val, unit, sub, tone, badge) {
    return (
      '<div class="kpi" style="position:relative">' +
      '<div class="kpi-label">' +
      esc(label) +
      '</div><div class="kpi-value" style="color:' +
      (tone || C.ink) +
      '">' +
      esc(val) +
      (unit ? '<span class="kpi-unit"> ' + esc(unit) + '</span>' : '') +
      '</div>' +
      (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') +
      '<span class="ev-corner">' +
      evb(badge) +
      '</span></div>'
    );
  }
  function num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v.toFixed(d == null ? 0 : d) : '—';
  }

  /* ── THE THREE LEGS, named as PAT Feasibility names them so a reader moving between the two pages
        is looking at the same thing under the same label. ── */
  var LEG = [
    { k: 'cpF', name: 'chest → finger', corners: ['chest', 'finger'] },
    { k: 'cp', name: 'chest → ankle', corners: ['chest', 'ankle'] },
    { k: 'cpFA', name: 'finger → ankle', corners: ['finger', 'ankle'] }
  ];

  /* A hat σ is the square root of a solved VARIANCE, and a three-cornered hat can solve a NEGATIVE one
     — the assumption failing, not a small number. Both columns refuse it; neither square-roots it.
     The worker already returns `ok:false` with its reason in that case, so this only has to not
     invent a number when it does (§∅). */
  function hatRow(label, h, badge) {
    if (!h || !h.ok) return card(label, '—', '', h && h.reason ? h.reason : 'not solved', C.mut, badge);
    var neg = ['h10', 'verity', 'o2'].some(function (k) {
      return !(h[k] >= 0);
    });
    if (neg) return card(label, 'REFUSED', '', 'a negative solved variance — the hat’s independence assumption failed; not square-rooted', C.amber, badge);
    return card(label, num(h.h10, 1) + ' / ' + num(h.verity, 1) + ' / ' + num(h.o2, 1), 'ms', 'chest / ankle / finger σ · ' + (h.windows ? h.windows.length : h.n || '?') + ' windows', C.blue, badge);
  }

  function render(m) {
    var host = el('cols');
    if (!host) return;
    if (!m || m.error) {
      host.innerHTML = '<div class="muted">' + esc((m && m.error) || 'no result') + '</div>';
      return;
    }
    var fused = m.fused || null,
      corners = (fused && fused.corners) || null;
    var out = [];

    /* ── the corner report FIRST, because it decides how the whole fused column should be read ────── */
    if (corners) {
      var missing = Object.keys(corners).filter(function (c2) {
        return !corners[c2];
      });
      out.push(
        '<div class="note">' +
          (missing.length
            ? '<b>UNWEIGHTED corner' +
              (missing.length > 1 ? 's' : '') +
              ':</b> ' +
              esc(missing.join(', ')) +
              ' published no per-second confidence, so every leg touching ' +
              (missing.length > 1 ? 'them' : 'it') +
              ' is shown unweighted and labelled. It is <b>not</b> weighted by 1 to make the column render.'
            : 'All three corners published a per-second confidence series.') +
          ' ⚠️ The O2Ring finger corner’s confidence is <b>UNVERIFIED</b> on its single-channel, drawn-axis PPG — a different claim from unusable, and this page does not upgrade it.' +
          '</div>'
      );
    }

    /* ── per leg: classic | fused | delta ───────────────────────────────────────────────────────── */
    LEG.forEach(function (L) {
      var c = m[L.k],
        f = fused && fused[L.k];
      out.push('<h3>' + esc(L.name) + '</h3><div class="kpis">');
      if (!c || !c.ok) {
        out.push(card('median lag', '—', '', (c && c.reason) || 'not coupled', C.mut, 'lag') + '</div>');
        return;
      }
      out.push(card('classic median lag', num(c.med), 'ms', 'IQR ' + num(c.p25) + '–' + num(c.p75), C.ink, 'lag'));
      out.push(card('classic beats', String(c.nCoupled), '', 'coupled pairs', C.ink, 'count'));
      if (f && f.ok) {
        out.push(card('fused median lag', num(f.med), 'ms', 'weighted IQR ' + num(f.p25) + '–' + num(f.p75), C.green, 'lagF'));
        out.push(card('fused weighted pairs', String(f.nWeighted), 'of ' + f.nPairs, (100 * f.covered).toFixed(1) + ' % of accepted pairs carried a confidence at both ends', C.ink, 'coverage'));
        out.push(card('Δ median', (f.med - c.med >= 0 ? '+' : '') + num(f.med - c.med), 'ms', 'fused − classic', Math.abs(f.med - c.med) < 1 ? C.mut : C.amber, 'delta'));
        out.push(card('Δ IQR', (f.p75 - f.p25 - (c.p75 - c.p25) >= 0 ? '+' : '') + num(f.p75 - f.p25 - (c.p75 - c.p25)), 'ms', 'weighted spread − classic spread', C.amber, 'delta'));
      } else {
        out.push(card('fused median lag', 'UNWEIGHTED', '', (f && f.reason) || 'no confidence for this leg', C.amber, 'lagF'));
      }
      out.push('</div>');
    });

    /* ── the hat, both columns ──────────────────────────────────────────────────────────────────── */
    out.push('<h3>three-cornered hat, over the three sites</h3><div class="kpis">');
    out.push(hatRow('classic hat σ', m.three, 'hat'));
    out.push(hatRow('fused hat σ', m.threeFused, 'hatF'));
    out.push('</div>');

    /* ── 🔴 THE DELTA CARD: where the columns differ, AND where they cannot ──────────────────────── */
    out.push(
      '<div class="note"><b>Reading the deltas.</b> A median is robust to a small share of bad beats, so ' +
        'a localised artifact burst moves the <i>whole-night</i> lag hardly at all — in the planted ' +
        'known-answer night, 12.5 % contamination moved it 220 → 222 ms. <b>A Δ median near zero is ' +
        'therefore not evidence that weighting does nothing.</b> Where the weighting acts is the ' +
        '<b>spread</b> (a burst widens the classic IQR and not the fused one) and the <b>per-5-min-window ' +
        'medians the hat is built from</b>: inside a burst every pair in the window is contaminated, so ' +
        'that window’s classic median is wrong by the full inflation with no robustness left, while the ' +
        'fused one refuses rather than averaging distrusted pairs. Read Δ IQR and the hat row, not Δ median.' +
        '</div>'
    );
    host.innerHTML = out.join('');
  }

  /* ── INGEST: one night, one run, the worker unchanged ──────────────────────────────────────────
     Deliberately NOT a batch UI. `PAT Feasibility` owns the multi-night table; this page answers one
     question about one night, and the monitor's night-derived link hands it exactly one night's files
     (`NIGHT_INPUT` → `#fileInput`, `NIGHT_RUN` → `#run`). A second copy of that page's night grouping
     would be a second copy of its ingest, which is the thing this page exists NOT to do. */
  var PICK = { ecg: null, verity: null, ring: null };
  function classify(f) {
    var n = String(f.name || '');
    if (/_ECG\.txt$/i.test(n)) return 'ecg';
    /* The two optical files are told apart by VENDOR, never by order or by column count — the O2Ring
       also writes three replicated columns, so a count-based split called the ring a Verity on every
       3-column night (`ppgdex-dsp.js`'s measured 526-vs-261 finding). */
    if (/_PPG\.txt$/i.test(n)) return /wellue|o2ring|viatom|checkme/i.test(n) ? 'ring' : 'verity';
    return null;
  }
  function onPick(files) {
    PICK = { ecg: null, verity: null, ring: null };
    for (var i = 0; i < files.length; i++) {
      var k = classify(files[i]);
      if (k && !PICK[k]) PICK[k] = files[i];
    }
    var have = Object.keys(PICK).filter(function (k) {
      return PICK[k];
    });
    var missing = ['ecg', 'verity', 'ring'].filter(function (k) {
      return !PICK[k];
    });
    if (el('picked'))
      el('picked').textContent = have.length ? 'picked: ' + have.join(', ') + (missing.length ? ' · missing: ' + missing.join(', ') : '') : 'none of these look like an _ECG.txt or a _PPG.txt';
    /* All three are REQUIRED and the button says so rather than running a partial night: the hat needs
       three corners, and two of the three legs touch the ring. A page that ran on two would render a
       column whose absent third corner is invisible (§∅). */
    if (el('run')) el('run').disabled = missing.length > 0;
    if (el('status')) el('status').textContent = missing.length ? missing.length + ' input(s) still missing' : '';
  }
  var worker = null;
  function run() {
    if (!PICK.ecg || !PICK.verity || !PICK.ring) return;
    if (el('status')) el('status').textContent = 'computing…';
    if (!worker) {
      worker = new Worker('pat-feasibility-worker.js');
      worker.onmessage = function (e) {
        var m = e.data || {};
        if (m.type === 'ready') return;
        if (el('status')) el('status').textContent = m.error ? 'refused: ' + m.error : '';
        render(m);
      };
      worker.onerror = function (er) {
        if (el('status')) el('status').textContent = 'worker failed: ' + ((er && er.message) || er);
      };
    }
    /* `detail: true` is load-bearing twice over: it is what makes the worker ship `patAtR` at all, and
       the fused numbers are computed INSIDE the worker on the full accepted set — never on the ~4000-point
       decimation `pack()` applies to the list that crosses this boundary. */
    worker.postMessage({ type: 'job', key: 'night', label: 'night', detail: true, ecgFile: PICK.ecg, ppgFile: PICK.verity, fingerFile: PICK.ring });
  }
  if (el('fileInput'))
    el('fileInput').addEventListener('change', function (e) {
      onPick(e.target.files || []);
    });
  if (el('run')) el('run').addEventListener('click', run);

  self.PatCvf = { render: render, EV: EV, classify: classify, onPick: onPick }; // exposed for the suite's source/behaviour checks
})();
