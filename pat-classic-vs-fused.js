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
    hatD: [
      'experimental',
      'the hat solved on FIRST DIFFERENCES of adjacent 5-min medians — removes a drift shared by all three sites, and is NOT comparable to the classic σ: differencing changes the estimand, so a smaller number here is not a better instrument'
    ],
    delta: ['experimental', 'fused minus classic — a difference of two experimental estimates, not a measurement of either'],
    hatDF: ['experimental', 'the drift-removed hat on the WEIGHTED 5-min medians — the same differencing, and the same non-comparability with any undifferenced σ'],
    verdict: ['experimental', 'the PAT gate (pat-gate.js) on this leg — pre-stated thresholds over consumer-sensor timing; a classification, not a validated measurement'],
    match: ['measured', 'share of the beats that could couple which did — a direct count ratio'],
    resid: ['experimental', 'IQR of each beat’s lag minus its local median — a derived beat-to-beat dispersion'],
    drift: ['experimental', 'p95 step between consecutive 5-min bin medians, the gate’s own drift statistic — derived'],
    censored: ['measured', 'share of beats the physiological window discards — a direct count ratio'],
    corr: ['experimental', 'the chest→ankle lag with both devices on their packet-arrival-floor axes (buffering removed); consumer sensors, not validated against a reference'],
    buffer: ['experimental', 'raw minus corrected median lag — the two devices’ link-buffering difference, derived from the arrival sidecars']
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
    { k: 'cpF', name: 'chest → finger', corners: ['chest', 'finger'], vd: 'vdF' },
    { k: 'cp', name: 'chest → ankle', corners: ['chest', 'ankle'], vd: 'vd' },
    { k: 'cpFA', name: 'finger → ankle', corners: ['finger', 'ankle'], vd: null }
  ];

  /* A hat σ is the square root of a solved VARIANCE, and a three-cornered hat can solve a NEGATIVE one
     — the assumption failing, not a small number. Both columns refuse it; neither square-roots it.
     The worker already returns `ok:false` with its reason in that case, so this only has to not
     invent a number when it does (§∅). */
  /* ── THE CORNER KEYS COME FROM THE PRODUCER, NEVER FROM A LITERAL HERE ───────────────────────────
     Until 2026-09-27 this read `h.h10` / `h.verity` / `h.o2`. `threeHat` (pat-feasibility-worker.js:549)
     keys its `variance` and `sigma` by SITE — `{chest, finger, ankle}` — and has never written a device
     key, so all three reads were `undefined`, `undefined >= 0` is false, and `neg` was therefore TRUE for
     EVERY possible input. Both hat rows rendered REFUSED on every night since the page shipped (#3128),
     and — the part that makes this worse than a blank — the refusal asserted a PHYSICAL cause: "the hat's
     independence assumption failed". A fabricated explanation is worse than a missing number, and this one
     was wrong about the physics while a real solve sat one field away. The values live at `h.sigma[site]`,
     not `h[device]`.
     It shipped because nothing executed this function: zero tests named `hatRow` or either row label, and
     the code READS right — the old caption listed "chest / ankle / finger" in exactly the order the three
     device keys were printed, so the mapping was self-consistent and only wrong.
     So the site list is now taken from the object the worker actually sent, which also makes the caption
     and the values incapable of disagreeing: a rename in `threeHat` follows through here for free, and the
     suite pins the two key sets against each other. */
  /* ── ONE CORNER'S VERDICT AS TEXT (PAT-HAT-DRIFT-DIFFERENCED §Acceptance) ────────────────────────
     `patHatCornerStatus` answers per corner, and the three answers are NOT interchangeable:
       solved              → σ with its block-bootstrap CI, when the CI is there
       underpowered        → an UPPER BOUND, "σ < x ms": the variance came out negative but its CI spans
                             0, so the data are consistent with independence and merely too few to
                             resolve a small corner. This is the case a bare REFUSED used to swallow.
       independence-failed → a CI wholly below 0. Names the PAIR and the explaining ρ, which is COARSE by
                             construction (over 40 planted seeds it spanned −1.30 … −0.45), so a value
                             beyond ±1 is shown flagged and NEVER clamped into range — clamping would
                             make a wide point estimate look like a tight one.
     Each arm can arrive with its number MISSING (`boundMs`, `sigmaCI` and `explainRho` are all nullable in
     the producer), so each says so rather than printing `null` or borrowing a neighbour's wording. */
  function cornerText(c) {
    if (!c || !c.status) return '—';
    if (c.status === 'solved') {
      if (!(typeof c.sigma === 'number' && isFinite(c.sigma))) return 'solved, σ unavailable';
      var ci =
        c.sigmaCI &&
        c.sigmaCI.length === 2 &&
        c.sigmaCI.every(function (x) {
          return typeof x === 'number' && isFinite(x);
        });
      return num(c.sigma, 1) + (ci ? ' [' + num(c.sigmaCI[0], 1) + ', ' + num(c.sigmaCI[1], 1) + ']' : '');
    }
    /* The STATUS is named, not implied by the shape of the number: §Acceptance asks the row to render the
       status AND the bound, and "< 14.4" alone reads as a measurement with a funny format rather than as
       "we could not resolve this corner, and here is the ceiling". */
    if (c.status === 'underpowered') return typeof c.boundMs === 'number' && isFinite(c.boundMs) ? 'underpowered, σ < ' + num(c.boundMs, 1) : 'underpowered, no bound resolved';
    if (c.status === 'independence-failed') {
      var pair = Array.isArray(c.pair) ? c.pair.join('–') : 'a pair';
      if (!(typeof c.explainRho === 'number' && isFinite(c.explainRho))) return 'independence failed (' + pair + '), ρ unresolved';
      return 'independence failed (' + pair + '), ρ ≈ ' + num(c.explainRho, 2) + (c.rhoOutOfRange ? ' ⚠ beyond ±1, shown unclamped' : '');
    }
    return String(c.status);
  }

  function hatRow(label, h, badge) {
    /* WHAT THE COUNT COUNTS. A hat is solved over WINDOWS; the drift-removed hat over ADJACENT PAIRS of them, and it
       carries no window list — so the fallback to `h.n` used to print "97 windows" for 97 pairs (98 windows) while the
       note under the same row said "97 adjacent window pairs". `tauMin` is what only the differenced result carries. */
    function winCount(h) {
      if (h.windows) return h.windows.length + ' windows';
      if (typeof h.tauMin === 'number') return h.n + ' adjacent window pairs';
      return (h.n || '?') + ' windows';
    }
    if (!h || !h.ok) return card(label, '—', '', h && h.reason ? h.reason : 'not solved', C.mut, badge);
    /* THE PER-CORNER STATUS WHEN THE WORKER SENT IT. `corners` is additive (#3179), so a caller or a
       fixture from before it existed still takes the sigma path below unchanged — the #3180 plants pin
       exactly that, and a new field must never break a consumer that predates it. */
    if (h.corners && typeof h.corners === 'object' && Object.keys(h.corners).length) {
      var ck = Object.keys(h.corners);
      return card(
        label,
        ck
          .map(function (k) {
            return cornerText(h.corners[k]);
          })
          .join(' · '),
        'ms',
        ck.join(' · ') + ' · ' + winCount(h),
        C.blue,
        badge
      );
    }
    var sg = h.sigma && typeof h.sigma === 'object' ? h.sigma : null;
    var sites = sg ? Object.keys(sg) : [];
    /* A MISSING SOLVE OBJECT IS NOT AN INDEPENDENCE FAILURE — the two refusals are kept apart because
       borrowing the physical reason for a shape problem is exactly what went wrong here (§∅). */
    if (!sites.length) return card(label, '—', '', 'the solver returned no per-corner sigma — a shape change, not a physical refusal', C.mut, badge);
    /* ⚠️ `null >= 0` IS TRUE IN JAVASCRIPT, and `threeHat` writes exactly `null` for a corner whose
       solved variance went negative (`sigma[k] = v2[k] >= 0 ? sqrt(v2[k]) : null`). So the obvious
       `!(sg[k] >= 0)` ADMITS the very case this refusal exists for — caught here before it shipped, on
       the measured 2026-09-26 night (chest variance −32.0 ms² classic, −27.6 ms² fused → `sigma.chest`
       null), which must read REFUSED and rendered blue under that guard. The old code only ever flagged
       because it read a key that did not exist, and `undefined >= 0` is false: it was right by accident,
       for the wrong reason, on every night. Guard the TYPE, not the comparison. */
    var neg = sites.some(function (k) {
      return typeof sg[k] !== 'number' || !isFinite(sg[k]) || sg[k] < 0;
    });
    if (neg) return card(label, 'REFUSED', '', 'a negative solved variance — the hat’s independence assumption failed; not square-rooted', C.amber, badge);
    return card(
      label,
      sites
        .map(function (k) {
          return num(sg[k], 1);
        })
        .join(' / '),
      'ms',
      sites.join(' / ') + ' σ · ' + winCount(h),
      C.blue,
      badge
    );
  }

  /* A SIGNED WHOLE-MS DELTA. `num(-0.3)` is "-0", and a card reading "Δ median −0 ms" states a direction the
     data do not have. Round first, then choose the sign from the ROUNDED value. */
  function sgn(x) {
    if (!(typeof x === 'number' && isFinite(x))) return '—';
    var r = Math.round(x);
    return r > 0 ? '+' + r : r < 0 ? String(r) : '0';
  }
  function pct(x) {
    return typeof x === 'number' && isFinite(x) ? (100 * x).toFixed(0) : '—';
  }
  // The gate's own words: a refusal carries `why.reason`; a pass or a soft verdict carries its drift figure.
  function gateWhy(vd) {
    var w = vd && vd.why;
    if (!w) return '';
    if (w.reason) return String(w.reason);
    if (typeof w.driftMs === 'number' && isFinite(w.driftMs)) return 'drift ' + num(w.driftMs) + ' ms (' + (w.driftStat || 'drift') + ')' + (w.driftOK === false ? ' — above the gate' : '');
    return '';
  }
  /* ── THE HAT'S TIMING AXES, stated where the hat is read (owner-ordered audit, 2026-09-28) ─────────────
     Every leg the hat uses is timed on the devices' RECEIVE stamps, so each corner's σ carries that device's
     Bluetooth buffering jitter as well as its pulse timing. The arrival-floor axis removes the buffering, but
     only for the H10 and the Verity: the ring writes no arrival sidecar. Measured on 2026-09-26, putting chest
     and ankle on their floor axes with the finger left raw made chest→finger 471 ms > chest→ankle 342 ms (the
     ankle pulse "before" the finger one) and finger→ankle coupled 571 of 22 655 beats — 0 windows. So a
     corrected hat does not exist yet, and this says so instead of silently mixing axes. */
  function hatAxesNote(m) {
    var s2 =
      '<div class="note"><b>Timing axes.</b> The hat is solved on the legs as the phone <b>received</b> them, so each corner’s σ includes its device’s Bluetooth buffering jitter, not only its pulse timing. ';
    if (m.cpCorr && m.cpCorr.ok)
      s2 +=
        'The chest → ankle leg has a buffering-corrected lag below (' +
        num(m.cpCorr.med) +
        ' ms on the arrival-floor axis, ' +
        num(m.cp && m.cp.med) +
        ' ms raw). The hat cannot use it: the ring has no arrival-floor axis, and mixing axes puts the ring’s buffering into finger → ankle. ';
    else s2 += 'A buffering-corrected hat needs every site on an arrival-floor axis, and the ring has none. ';
    var vf = m.vdF;
    if (vf && vf.tier === 'no')
      s2 +=
        '⚠️ <b>chest → finger is gate-rejected (' +
        esc(vf.label) +
        ')</b>' +
        (vf.why && vf.why.reason ? ': ' + esc(vf.why.reason) : '') +
        ' — the finger corner and two of the three legs rest on that leg.';
    return s2 + '</div>';
  }
  // The chest→ankle leg on the arrival-floor axes, or the worker's named reason it is absent (§∅: never blank).
  function correctedRow(m) {
    var fsy = m.floorSync,
      cc = m.cpCorr;
    if (!fsy) return '';
    if (!fsy.available || !(cc && cc.ok))
      return '<div class="note"><b>Buffering-corrected chest → ankle:</b> not computed — ' + esc(fsy.reason || (cc && cc.reason) || 'no corrected coupling') + '.</div>';
    return (
      '<h3>chest → ankle, buffering-corrected (arrival-floor axis)</h3><div class="kpis">' +
      card('corrected median lag', num(cc.med), 'ms', 'IQR ' + num(cc.p25) + '–' + num(cc.p75) + ' · raw ' + num(m.cp && m.cp.med) + ' ms', C.green, 'corr') +
      card('buffering removed', num(fsy.bufferingDiffMs), 'ms', 'raw − corrected median: the Verity’s link buffering minus the H10’s', C.ink, 'buffer') +
      card('gate (corrected)', m.vdCorr ? m.vdCorr.label : '—', '', m.vdCorr ? gateWhy(m.vdCorr) : 'not run', m.vdCorr && m.vdCorr.tier === 'go' ? C.green : C.amber, 'verdict') +
      card('coupled', pct(cc.matchRate), '%', 'of the beats that could couple', C.ink, 'match') +
      '</div>'
    );
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

    /* ── the hat, both columns — FIRST, because it is what a reader comes here for ───────────────
       Ordering is a finding, not a preference. The owner asked for this page by naming the hats and
       naming them before the lag ("i thougt ther will be also fused 3hat and normal 3hat", 2026-09-27),
       and could not reach the page at all because the Nights pill threw. Both σ rows were already here
       and sat BELOW three per-leg card rows, so the thing that was asked for was the last thing on the
       page. No computation moved — `m.three` / `m.threeFused` are unchanged and still gated by the same
       single `#run` that requires all three corners, so the hat and the legs share one eligibility and
       neither can render without the other. */
    out.push('<h3>three-cornered hat, over the three sites — classic beside fused</h3><div class="kpis">');
    out.push(hatRow('classic hat σ', m.three, 'hat'));
    out.push(hatRow('fused hat σ', m.threeFused, 'hatF'));
    out.push('</div>');
    out.push(hatAxesNote(m));
    /* ── THE DRIFT-REMOVED HAT GETS ITS OWN ROW, AND NEVER A DELTA ───────────────────────────────
       Differencing removes a drift shared by all three sites, which CHANGES THE ESTIMAND: it is not a
       better measurement of the same quantity, so a Δ against the classic σ would invite exactly the
       reading the owner's item 2 forbids — that the smaller number is the improved instrument. Its own
       row, its own badge, and the producer's own label rather than a paraphrase. */
    /* Both columns: the worker differences the classic AND the fused medians (`threeFused.diff`), and the page used
       to render only the first — a computed estimate that crossed the worker boundary and was dropped. */
    var dh = m.three && m.three.diff,
      dhF = m.threeFused && m.threeFused.diff;
    if (dh || dhF) {
      out.push('<h3>drift-removed hat — a SEPARATE estimate, not a correction of the one above</h3><div class="kpis">');
      out.push(dh && dh.ok ? hatRow('drift-removed σ (classic)', dh, 'hatD') : card('drift-removed σ (classic)', '—', '', (dh && dh.reason) || 'not solved', C.mut, 'hatD'));
      out.push(dhF && dhF.ok ? hatRow('drift-removed σ (fused)', dhF, 'hatDF') : card('drift-removed σ (fused)', '—', '', (dhF && dhF.reason) || 'not solved', C.mut, 'hatDF'));
      out.push('</div>');
      var dlab = (dh && dh.label) || (dhF && dhF.label);
      out.push('<div class="note">' + esc(dlab || 'drift-removed σ — not comparable to the classic σ') + (dh && dh.ok ? ' · ' + dh.n + ' adjacent window pairs.' : '') + '</div>');
    }
    /* ── THE CLOSURE IS NOT A CONSISTENCY FIGURE (brief §F, owner's item 3) ──────────────────────
       `ca − cf − fa` is an IDENTITY here: both paths land on the SAME ankle beat, so 22,322 of 22,322
       per-beat triangles closed to exactly 0. Publishing it as a residual would be a gate over an
       algebraic tautology — a number that cannot fail, read as evidence that something was checked. */
    out.push(
      '<div class="note"><b>Closure.</b> The three-leg closure <i>chest→finger</i> − <i>chest→ankle</i> + <i>finger→ankle</i> is <b>identically 0 by construction</b> — every beat triangle shares its ankle beat — so it is not published as a consistency figure.</div>'
    );

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
      /* THE GATE AND THE LEG'S OWN STATISTICS — the worker publishes all of them and this page showed none. The one
         that matters most: chest → finger was WINDOW-CENSORED on 2026-09-26 ("not a transit time") and still
         rendered as an ordinary 407 ms lag. finger → ankle has no gate — it is pulse-to-pulse, not a PAT. */
      var vd = L.vd ? m[L.vd] : null;
      out.push(
        card('gate', vd ? vd.label : 'NOT GATED', '', vd ? gateWhy(vd) : 'not gated — finger → ankle is pulse-to-pulse, not a PAT', vd ? (vd.tier === 'go' ? C.green : C.amber) : C.mut, 'verdict')
      );
      out.push(card('coupled', pct(c.matchRate), '%', 'of the beats that could couple', C.ink, 'match'));
      out.push(card('beat-to-beat spread', num(c.residIQR), 'ms', 'IQR of each lag minus its local median', C.ink, 'resid'));
      out.push(card('drift', num(c.stepP95), 'ms', 'p95 step between 5-min bins · range ' + num(c.driftRange) + ' ms', C.ink, 'drift'));
      out.push(
        card(
          'censored',
          typeof c.censoredPct === 'number' && isFinite(c.censoredPct) ? num(c.censoredPct, 1) : '—',
          typeof c.censoredPct === 'number' && isFinite(c.censoredPct) ? '%' : '',
          'beats the physiological window discards',
          C.ink,
          'censored'
        )
      );
      /* NOT `inPhysPct`: since pairing ENFORCES the physiological window (pat-feasibility-worker.js, the PLO/PHI
         test inside the coupling loop), every coupled lag is inside it by construction, so that field is 1 on every
         night — a number that cannot fail, shown as if it had been checked. `censored` above is the live one. */
      if (f && f.ok) {
        out.push(card('fused median lag', num(f.med), 'ms', 'weighted IQR ' + num(f.p25) + '–' + num(f.p75), C.green, 'lagF'));
        out.push(card('fused weighted pairs', String(f.nWeighted), 'of ' + f.nPairs, (100 * f.covered).toFixed(1) + ' % of accepted pairs carried a confidence at both ends', C.ink, 'coverage'));
        out.push(card('Δ median', sgn(f.med - c.med), 'ms', 'fused − classic', Math.abs(f.med - c.med) < 1 ? C.mut : C.amber, 'delta'));
        out.push(card('Δ IQR', sgn(f.p75 - f.p25 - (c.p75 - c.p25)), 'ms', 'weighted spread − classic spread', C.amber, 'delta'));
      } else {
        out.push(card('fused median lag', 'UNWEIGHTED', '', (f && f.reason) || 'no confidence for this leg', C.amber, 'lagF'));
      }
      out.push('</div>');
      if (L.k === 'cp') out.push(correctedRow(m));
    });

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
  var PICK = { ecg: null, verity: null, ring: null, ecgArr: null, ppgArr: null, ecgAcc: null, ppgAcc: null };
  function classify(f) {
    var n = String(f.name || '');
    if (/_ECG\.txt$/i.test(n)) return 'ecg';
    /* The two optical files are told apart by VENDOR, never by order or by column count — the O2Ring
       also writes three replicated columns, so a count-based split called the ring a Verity on every
       3-column night (`ppgdex-dsp.js`'s measured 526-vs-261 finding). */
    /* OPTIONAL inputs, told apart by VENDOR like the waveforms: each Polar device's packet-arrival sidecar (the
       arrival-floor axis) and its ACC (the motion check on that axis). The ring writes neither. */
    if (/_PMDARRIVAL\.csv$/i.test(n)) return /Polar_H10/i.test(n) ? 'ecgArr' : /VeritySense/i.test(n) ? 'ppgArr' : null;
    if (/_ACC\.txt$/i.test(n)) return /Polar_H10/i.test(n) ? 'ecgAcc' : /VeritySense/i.test(n) ? 'ppgAcc' : null;
    if (/_PPG\.txt$/i.test(n)) return /wellue|o2ring|viatom|checkme/i.test(n) ? 'ring' : 'verity';
    return null;
  }
  /* ── ONE SESSION PER DEVICE, CHOSEN BY STAMP — never "the first file of each kind" ─────────────────────────────
     The capture box writes one file SET per BLE session, so one night's folder holds several sets per device, and the
     monitor hands over every arrival sidecar the night carries. Measured on the live page, 2026-09-28, for 2026-09-26:
     five Verity sidecars (07:41, 17:29, 19:15, 20:36, 21:11) arrived in that order, "first per kind" took the 07:41
     one, and the corrected lag read "not computed — Verity PPG: 0 `acc` packets in the arrival sidecar" for a night
     whose 21:11 sidecar is complete. The rule is PAT Feasibility's own (`resolvePair`): the ECG is the anchor (the
     largest, the most R-peaks); every other file is the session of its device whose START is nearest — a sidecar or
     an ACC to ITS OWN device's waveform, which is an exact stamp match whenever that session's file set is present. */
  function stampOf(n) {
    var mo = String(n || '').match(/_(\d{8})_?(\d{6})_[A-Za-z0-9]+\.(txt|csv)$/i);
    return mo ? Date.UTC(+mo[1].slice(0, 4), +mo[1].slice(4, 6) - 1, +mo[1].slice(6, 8), +mo[2].slice(0, 2), +mo[2].slice(2, 4), +mo[2].slice(4, 6)) : null;
  }
  function nearest(c, anchor) {
    if (!c || !c.length) return null;
    if (anchor == null) return c[0].file;
    return c.reduce(function (b, x) {
      return x.t != null && (b.t == null || Math.abs(x.t - anchor) < Math.abs(b.t - anchor)) ? x : b;
    }).file;
  }
  function onPick(files) {
    PICK = { ecg: null, verity: null, ring: null, ecgArr: null, ppgArr: null, ecgAcc: null, ppgAcc: null };
    var cand = {};
    for (var i = 0; i < files.length; i++) {
      var k = classify(files[i]);
      if (k) (cand[k] || (cand[k] = [])).push({ file: files[i], t: stampOf(files[i].name) });
    }
    if (cand.ecg)
      PICK.ecg = cand.ecg.reduce(function (b, x) {
        return (x.file.size || 0) > (b.file.size || 0) ? x : b;
      }).file;
    var tE = PICK.ecg ? stampOf(PICK.ecg.name) : null;
    PICK.verity = nearest(cand.verity, tE);
    PICK.ring = nearest(cand.ring, tE);
    var tV = PICK.verity ? stampOf(PICK.verity.name) : tE;
    PICK.ecgArr = nearest(cand.ecgArr, tE);
    PICK.ecgAcc = nearest(cand.ecgAcc, tE);
    PICK.ppgArr = nearest(cand.ppgArr, tV);
    PICK.ppgAcc = nearest(cand.ppgAcc, tV);
    var have = Object.keys(PICK).filter(function (k) {
      return PICK[k];
    });
    var missing = ['ecg', 'verity', 'ring'].filter(function (k) {
      return !PICK[k];
    });
    if (el('picked'))
      el('picked').textContent = have.length
        ? 'picked: ' +
          have.join(', ') +
          (missing.length ? ' · missing: ' + missing.join(', ') : '') +
          (PICK.ecgArr && PICK.ppgArr
            ? ''
            : ' · no arrival sidecar for ' + (!PICK.ecgArr && !PICK.ppgArr ? 'either device' : !PICK.ecgArr ? 'the H10' : 'the Verity') + ' — the buffering-corrected lag will not be computed')
        : 'none of these look like an _ECG.txt or a _PPG.txt';
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
    var job = { type: 'job', key: 'night', label: 'night', detail: true, ecgFile: PICK.ecg, ppgFile: PICK.verity, fingerFile: PICK.ring };
    // Both or neither: the worker's corrected path needs BOTH devices' floors, and says so if it has only one.
    if (PICK.ecgArr && PICK.ppgArr) {
      job.ecgArrFile = PICK.ecgArr;
      job.ppgArrFile = PICK.ppgArr;
    }
    if (PICK.ecgAcc && PICK.ppgAcc) {
      job.ecgAccFile = PICK.ecgAcc;
      job.ppgAccFile = PICK.ppgAcc;
    }
    worker.postMessage(job);
  }
  if (el('fileInput'))
    el('fileInput').addEventListener('change', function (e) {
      onPick(e.target.files || []);
    });
  if (el('run')) el('run').addEventListener('click', run);

  self.PatCvf = {
    render: render,
    EV: EV,
    classify: classify,
    onPick: onPick,
    hatRow: hatRow,
    run: run,
    sgn: sgn,
    pick: function () {
      return PICK;
    }
  }; // exposed for the suite's source/behaviour checks
})();
