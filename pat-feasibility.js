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
     ACC-sync offset is a motion-anchored convenience correction → heuristic. The arrival-floor correction is a
     derived re-timing from measured packet arrivals, not validated against a reference → experimental. */
  var EV = {
    count: ['measured', 'a count of nights, files, beats or windows — direct'],
    coupling: ['measured', 'share of coverable R-peaks whose pulse foot paired inside the window — a direct coverage statistic'],
    clock: ['measured', 'start-time offset and beat-count ratio of the two recordings — direct'],
    lag: ['experimental', 'R-peak → PPG-foot pulse arrival time from consumer sensors; not validated against a reference'],
    spread: ['experimental', 'beat-to-beat IQR of the lag around its 30 s local median — a derived dispersion'],
    drift: ['experimental', 'spread of the 5-min lag medians across the night — a derived diagnostic'],
    floor: ['experimental', "each leg re-timed on its device's packet-arrival floor (the minimum of arrival − last sample, per 10-min window) — derived, unvalidated"],
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
    /* ── §∅ THE VALIDITY SIDECARS — `{base}RUNS.txt`, written by capture-host beside the waveform
       (`writers.py` `_RunSidecar`). They name the spans where the stream measured nothing, which is
       the fact no sample value can carry: `0` is a legal reading. The O2Ring split mirrors the
       `_PPG.txt` rule two lines above and for the same reason — a ring sidecar paired to the
       Verity's text would mark the WRONG spans invalid, which is worse than marking none.
       `_ECG\.txt$` and `_PPG\.txt$` are end-anchored, so neither rule above ever saw these names. */
    if ((mo = n.match(/_(\d{8})_?(\d{6})_ECGRUNS\.txt$/i))) return { role: 'ecgruns', stamp: mo[1] + mo[2] };
    if ((mo = n.match(/_(\d{8})_?(\d{6})_PPGRUNS\.txt$/i))) return { role: /O2Ring/i.test(n) ? 'fingerruns' : 'ppgruns', stamp: mo[1] + mo[2] };
    // ACC on BOTH devices → the cross-device drift anchor (H10 chest vs Verity arm)
    if ((mo = n.match(/_(\d{8})_?(\d{6})_ACC\.txt$/i))) return { role: /Polar_H10/i.test(n) ? 'ecgacc' : 'ppgacc', stamp: mo[1] + mo[2] };
    /* the packet-arrival sidecar: the corrected path's anchor, one per device. The ring's used to classify
       to `null` ("not used here") because it carried only `OXYLIVE_DURATION_S` rows — no PPG packets and no
       device position, so there was nothing to anchor. E11 (#3267) writes one row per PPG frame with the
       ring's own cumulative stream position, so it now has its own role and the FINGER leg can take a
       floor. A sidecar from before that change still parses: it carries no positioned frames and the
       worker refuses the finger floor by name rather than silently mixing axes. */
    if ((mo = n.match(/_(\d{8})_?(\d{6})_PMDARRIVAL\.csv$/i)))
      return /Polar_H10/i.test(n)
        ? { role: 'ecgarr', stamp: mo[1] + mo[2] }
        : /VeritySense|Polar_Sense/i.test(n)
          ? { role: 'ppgarr', stamp: mo[1] + mo[2] }
          : /O2Ring/i.test(n)
            ? { role: 'ringarr', stamp: mo[1] + mo[2] }
            : null;
    return null;
  }
  /* THE NIGHT A FILE BELONGS TO COMES FROM ITS FIRST DATA ROW, NOT ITS NAME.
     The 14-digit stamp in the name is written when the capture host OPENS the session, before the
     connect; the first data row is written when the recording actually started. This page is the
     FOURTH trio page to key a night, and the only one the 2026-10-12 census never read: its own
     comment below cites `sensor-trio-power-analysis.js` as the rule it copies, and that rule was
     repaired under this residue (#3791) while the copy here was not. Ported verbatim from the three,
     so `tests/dex-tests.js` can slice all four out of their pages and execute them against one table.
     A file whose rows carry no stamp keeps the filename key and the ingest note says how many did,
     because a fallback nobody can see is the defect this replaces (§∅). */
  const ROW_SCAN_BYTES = 65536,
    ROW_SCAN_LINES = 400;
  /* §2.7 — `Date.UTC` SILENTLY ROLLS an out-of-range component onto a real instant, so every field is
     range-checked first. The copy is deliberate. This page carries no `clock.js`, so `DexClock` is
     undefined here and a delegation would throw at evaluation (CLAUDE.md §👥.3). The rules read in
     `_ckMk`'s own order — the DATE round-trip, the ISO end-of-day escape, then the TIME range — and
     the order is load-bearing twice over. A bare `h > 23` guard rejects ISO-8601 `24:00:00`, which the
     Clock Contract names as the one legitimate overflow, so the escape sits above the range check.
     And the round-trip cannot stand in for the range check: minute 99 rolls the HOUR and leaves the
     date alone, so `getUTCDate()` still matches and only the explicit bound refuses it.
     `tests/dex-tests.js` pins this copy against the three trio pages, so the mirrors cannot drift. */
  function _mkTMs(Y, M, D, h, mi, se, ms) {
    se = se || 0;
    ms = ms || 0;
    var day0 = Date.UTC(Y, M - 1, D),
      dd = new Date(day0);
    if (dd.getUTCFullYear() !== Y || dd.getUTCMonth() !== M - 1 || dd.getUTCDate() !== D) return null;
    if (h === 24 && mi === 0 && se === 0 && ms === 0) return day0 + 86400000;
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59 || ms < 0 || ms > 999) return null;
    return Date.UTC(Y, M - 1, D, h, mi, se, ms);
  }
  const _ISO_ROW = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/,
    _RING_ROW = /(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/;
  /* The ring's CSV writes `HH:MM:SS DD/MM/YYYY` and the same vendor also ships MM/DD/YYYY, so §3
     applies: a scanned row whose first date field exceeds 12 locks the order for the whole head,
     and an all-ambiguous head takes the contract's DMY default. Never `new Date(str)`. */
  function _rowTMs(text) {
    const lines = text.split(/\r?\n/, ROW_SCAN_LINES);
    let ringFirst = null,
      dmy = true;
    for (let i = 0; i < lines.length; i++) {
      const m = _RING_ROW.exec(lines[i]);
      if (!m) continue;
      if (ringFirst == null) ringFirst = m;
      if (+m[4] > 12) {
        dmy = true;
        break;
      }
      if (+m[5] > 12) {
        dmy = false;
        break;
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const iso = _ISO_ROW.exec(lines[i]);
      if (iso) {
        const t = _mkTMs(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +iso[6], +(iso[7] || 0));
        if (t != null) return t;
      }
    }
    if (ringFirst) {
      const D = dmy ? +ringFirst[4] : +ringFirst[5],
        M = dmy ? +ringFirst[5] : +ringFirst[4];
      return _mkTMs(+ringFirst[6], M, D, +ringFirst[1], +ringFirst[2], +ringFirst[3], 0);
    }
    return null;
  }
  async function firstRowTMs(file) {
    try {
      const blob = file.slice(0, ROW_SCAN_BYTES);
      const text = typeof blob.text === 'function' ? await blob.text() : null;
      return text == null ? null : _rowTMs(text);
    } catch (_e) {
      return null;
    }
  }
  // the same noon fold as nightKeyOf, over an instant instead of a 14-digit filename stamp
  function nightKeyOfMs(tMs) {
    const d = new Date(tMs);
    let ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (d.getUTCHours() < 12) ms -= 86400000;
    const b = new Date(ms);
    return b.getUTCFullYear() + '-' + String(b.getUTCMonth() + 1).padStart(2, '0') + '-' + String(b.getUTCDate()).padStart(2, '0');
  }
  // sessions starting before noon fold into the PREVIOUS evening (floating civil time)
  function nightKeyOf(stamp) {
    /* §2.7 — one refusal for the WHOLE stamp, before any field is read, so the night key and the
       instant `stampMs` returns can never disagree about whether the stamp was real. */
    if (stampMs(stamp) == null) return null;
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
  /* stamp (YYYYMMDDHHMMSS, floating civil time) → ms, for ordering sessions within a night. The
     bare `Date.UTC` that stood here rolled an impossible stamp onto a real instant, and `nearestTo`
     picks a companion by this value, so a fabricated instant mis-pairs a session instead of
     declining to pair one. The length test is the §∅ leg: a short stamp reads its missing fields
     as zero, which is a value standing in for an absence. */
  function stampMs(st) {
    var t = String(st == null ? '' : st);
    if (!/^\d{14}$/.test(t)) return null;
    return _mkTMs(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12), +t.slice(12, 14), 0);
  }
  /* the candidate whose session START is nearest to an anchor's — the hat's own rule (sensor-trio-power-analysis.js
     `nearest`), applied here for the same reason. The comparison reads `.ms`, which the ingest set from
     the first data row wherever one existed: comparing NAME stamps inside a bucket mis-picks a companion
     even when every file landed on the right night, because the name can sit hours from the capture. */
  function nearestTo(a, anchorMs) {
    if (!a || !a.length) return null;
    if (anchorMs == null) return largest(a);
    return a.reduce(function (b, x) {
      return Math.abs(x.ms - anchorMs) < Math.abs(b.ms - anchorMs) ? x : b;
    });
  }
  /* A SIDECAR IS NOT PAIRED BY NEARNESS. `nearestTo` is right for a companion STREAM, which is its own
     recording with its own start; a `…RUNS.txt` is written for ONE file, as `{base}RUNS.txt`, so the
     filename stamp it shares with that file is an identity rather than a proximity. Nearest-start
     here would hand a session another session's validity on exactly the box nights that carry several
     per device, and a sidecar pointing at the wrong samples is worse than no sidecar at all.
     `.stamp` is the FILENAME stamp on both sides deliberately — `.ms` is re-read from the first data
     row, which the sidecar and its waveform have no reason to share.
     Two candidates with one stamp is ambiguous, and §∅ refuses an ambiguity rather than picking: the
     leg then runs with no sidecar and says so, instead of running with a coin-flip. */
  function sameStamp(a, pick) {
    if (!pick || !a || !a.length) return null;
    var hit = a.filter(function (x) {
      return x.stamp === pick.stamp;
    });
    return hit.length === 1 ? hit[0] : null;
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
      eMs = e ? e.ms : null,
      p = nearestTo(nt.cand.ppg, eMs),
      ea = nearestTo(nt.cand.ecgacc, eMs),
      pa = nearestTo(nt.cand.ppgacc, p ? p.ms : eMs),
      er = nearestTo(nt.cand.ecgarr, eMs),
      pr = nearestTo(nt.cand.ppgarr, p ? p.ms : eMs),
      fg = nearestTo(nt.cand.finger, eMs),
      // the ring's sidecar is matched to the RING's own session, not to the ECG anchor: the ring runs its
      // own file-set and its session start is the thing its sidecar shares a stamp with.
      rr = nearestTo(nt.cand.ringarr, fg ? fg.ms : eMs),
      eru = sameStamp(nt.cand.ecgruns, e),
      pru = sameStamp(nt.cand.ppgruns, p),
      fru = sameStamp(nt.cand.fingerruns, fg);
    nt.ecg = e ? e.file : null;
    nt.ppg = p ? p.file : null;
    nt.ecgAcc = ea ? ea.file : null;
    nt.ppgAcc = pa ? pa.file : null;
    nt.ecgArr = er ? er.file : null;
    nt.ppgArr = pr ? pr.file : null;
    nt.finger = fg ? fg.file : null;
    nt.ringArr = rr ? rr.file : null;
    nt.ecgRuns = eru ? eru.file : null;
    nt.ppgRuns = pru ? pru.file : null;
    nt.fingerRuns = fru ? fru.file : null;
  }
  var eligible = function (nt) {
    return !!(nt.ecg && nt.ppg);
  };

  async function ingestFiles(list) {
    NIGHTS = {};
    RESULTS = {};
    var impossibleStamp = 0,
      keyedByName = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i],
        c = classify(f);
      if (!c) continue;
      const rowMs = await firstRowTMs(f);
      if (rowMs == null) keyedByName++;
      /* §∅ — a file whose NAME carries an impossible stamp and whose ROWS carry none is not indexed,
         and the status line says how many were dropped. Bucketing it under a rolled date files a real
         capture on a night it never happened, which is worse than leaving it out loudly. */
      var nk = rowMs == null ? nightKeyOf(c.stamp) : nightKeyOfMs(rowMs);
      if (nk == null) {
        impossibleStamp++;
        continue;
      }
      var nt =
        NIGHTS[nk] ||
        (NIGHTS[nk] = { key: nk, label: nk, cand: { ecg: [], ppg: [], ecgacc: [], ppgacc: [], finger: [], ecgarr: [], ppgarr: [], ringarr: [], ecgruns: [], ppgruns: [], fingerruns: [] } });
      nt.cand[c.role].push({ file: f, stamp: c.stamp, ms: rowMs == null ? stampMs(c.stamp) : rowMs, stampSource: rowMs == null ? 'filename' : 'first-row' });
    }
    Object.keys(NIGHTS).forEach(function (k) {
      resolvePair(NIGHTS[k]);
    });
    renderNightTable();
    var keys = Object.keys(NIGHTS),
      elig = keys.filter(function (k) {
        return eligible(NIGHTS[k]);
      }).length;
    setStatus(
      keys.length +
        ' nights · ' +
        elig +
        ' eligible (from ' +
        list.length +
        ' files)' +
        (keyedByName ? ' · ' + keyedByName + ' keyed by filename (no row stamp)' : '') +
        (impossibleStamp ? ' · ' + impossibleStamp + ' not indexed (impossible filename stamp)' : ''),
      keys.length ? 'idle' : 'idle'
    );
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
         The worker publishes TWO gate results (`vd` on raw drift, `vdCorr` on the arrival-floor-corrected coupling) and this
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
      w.postMessage({
        type: 'job',
        key: nt.key,
        label: nt.label,
        ecgFile: nt.ecg,
        ppgFile: nt.ppg,
        ecgAccFile: nt.ecgAcc,
        ppgAccFile: nt.ppgAcc,
        fingerFile: nt.finger || null,
        ecgArrFile: nt.ecgArr || null,
        ppgArrFile: nt.ppgArr || null,
        ringArrFile: nt.ringArr || null,
        ecgRunsFile: nt.ecgRuns || null,
        ppgRunsFile: nt.ppgRuns || null,
        fingerRunsFile: nt.fingerRuns || null,
        detail: false
      });
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

  /* `agg()` and `median()` used to live here. Both are GONE rather than left unused: `agg` filtered
     with the bare global `isFinite`, which admits `null` and coerces it to 0, and a dead helper
     carrying the defect is the first thing the next aggregate on this page would have reached for.
     `coverStat` below replaces both, and rejects `null` by using `Number.isFinite`. */
  /* ── THE CORPUS-LEVEL STATISTIC AND ITS COVERAGE ───────────────────────────────────────────────
     Single-sourced in `pat-gate.js` (see its §∅ AT THE AGGREGATE LAYER block). Called the way
     `verdictCell` is called below — a hard dependency, not a guarded one, because a second copy
     here would be a second source and that is precisely what this split exists to prevent. Every
     aggregate number on this page and in the download goes through it, so a card, the conclusion
     sentence and the JSON can no longer disagree about one absence. */
  function coverStat(rows, f, label) {
    return (self.PATGate && self.PATGate.coverStat)(rows, f, label);
  }
  /* What a sub-line adds when the statistic saw FEWER nights than it had. §∅: a discontinuity
     refuses and reduced coverage annotates — this is the annotation, and it is empty on full
     coverage so a complete corpus reads exactly as it did before. */
  function covNote(s) {
    return s.covered ? '' : ' · ' + s.n + ' of ' + s.nTotal + ' nights';
  }
  /* The download's one numeric writer. `+(+NaN).toFixed(1)` is NaN and `JSON.stringify` writes it
     as `null`, so the old form reached the right byte by accident; this one decides it. */
  function numOrNull(x, d) {
    return typeof x === 'number' && Number.isFinite(x) ? +x.toFixed(d == null ? 1 : d) : null;
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
      var ppm = coverStat(
          oks,
          function (m) {
            return m.cp.ppm;
          },
          'inter-device drift rate'
        ),
        mr = coverStat(
          oks,
          function (m) {
            return m.cp.matchRate * 100;
          },
          'coupling rate'
        );
      var riq = coverStat(
          oks,
          function (m) {
            return m.cp.residIQR;
          },
          'beat-to-beat spread'
        ),
        lin = coverStat(
          oks,
          function (m) {
            return m.cp.linR2;
          },
          'drift shape R²'
        );
      cards.push(
        hcard(
          'inter-device drift',
          ppm.n ? ppm.value.toFixed(0) : '—',
          'ppm',
          ppm.n ? 'median · range ' + ppm.min.toFixed(0) + '–' + ppm.max.toFixed(0) + covNote(ppm) : ppm.reason,
          ppm.n ? C.amber : C.mut,
          'drift'
        )
      );
      cards.push(hcard('coupling', mr.n ? mr.value.toFixed(0) : '—', '%', mr.n ? 'median across nights' + covNote(mr) : mr.reason, mr.n ? (mr.value >= 55 ? C.green : C.amber) : C.mut, 'coupling'));
      cards.push(
        hcard('beat-to-beat spread', riq.n ? riq.value.toFixed(0) : '—', 'ms', riq.n ? 'median lag IQR' + covNote(riq) : riq.reason, riq.n ? (riq.value <= 60 ? C.green : C.amber) : C.mut, 'spread')
      );
      /* 🔴 THE CARD THIS BLOCK EXISTS FOR. `median([])` is NaN, `NaN >= 0.6` is false, and the
         false arm of that ternary is a VERDICT — so a page that had measured no night at all used
         to publish "wander · NON-LINEAR — needs continuous correction" in the confident voice of a
         measurement. §∅ forbids an in-range sentinel for an unmeasured value; the refusal arm now
         prints the em-dash and the reason. */
      var linMed = lin.value,
        kind = linMed >= 0.6 ? 'LINEAR — 2-point sync fixes it' : 'NON-LINEAR — needs continuous correction';
      cards.push(
        hcard(
          'drift shape',
          lin.n ? (linMed >= 0.6 ? 'linear' : 'wander') : '—',
          '',
          lin.n ? 'median R²=' + linMed.toFixed(2) + ' · ' + kind + covNote(lin) : lin.reason,
          lin.n ? (linMed >= 0.6 ? C.green : C.amber) : C.mut,
          'drift'
        )
      );
      // the arrival-floor correction, before/after — and what it removed (buffering, not drift)
      var corrN = oks.filter(function (m) {
        return m.cpCorr && m.cpCorr.ok && m.floorSync && m.floorSync.available;
      });
      var cDr = null,
        rDr = null,
        bufs = null,
        mCorr = NaN,
        mRaw = NaN;
      if (corrN.length) {
        cDr = coverStat(
          corrN,
          function (m) {
            return m.cpCorr.driftRange;
          },
          'corrected drift range'
        );
        rDr = coverStat(
          corrN,
          function (m) {
            return m.cp.driftRange;
          },
          'raw drift range'
        );
        mCorr = cDr.value;
        mRaw = rDr.value;
        cards.push(
          hcard(
            'drift after arrival-floor correction',
            cDr.n ? mCorr.toFixed(0) : '—',
            'ms',
            cDr.n ? 'median · was ' + (rDr.n ? mRaw.toFixed(0) : '—') + ' ms raw · ' + cDr.n + ' of ' + cDr.nTotal + ' nights' : cDr.reason,
            cDr.n ? (mCorr < 100 ? C.green : mCorr < mRaw * 0.5 ? C.amber : C.red) : C.mut,
            'floor'
          )
        );
        bufs = coverStat(
          corrN,
          function (m) {
            return m.floorSync.bufferingDiffMs;
          },
          'buffering difference'
        );
        cards.push(
          hcard(
            'buffering difference removed',
            bufs.n ? bufs.value.toFixed(0) : '—',
            'ms',
            bufs.n ? "median raw − corrected lag · the two links' BLE buffering, not clock drift" + covNote(bufs) : bufs.reason,
            bufs.n ? C.amber : C.mut,
            'floor'
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
            ? 'Raw: drift-dominated across nights (' +
              (ppm.n ? '~' + ppm.value.toFixed(0) + ' ppm' + covNote(ppm) : ppm.reason) +
              ') — systematic device-clock drift confirmed, not viable from phone timestamps alone.'
            : 'Raw: mixed — coupling holds but drift varies night to night.';
      if (corrN.length) {
        /* The SAME `bufs` the card above drew, not a second pass over the same nights: one source,
           so the card and this sentence cannot report two different buffering medians. */
        concl +=
          ' <b style="color:' +
          C.amber +
          "\">Arrival-floor correction</b> re-times each leg on its device's packet-arrival floor (the fastest packets, whose delay is only the link's minimum), over " +
          corrN.length +
          ' night' +
          (corrN.length > 1 ? 's' : '') +
          ': it removed a median <b>' +
          (bufs && bufs.n ? bufs.value.toFixed(0) : '—') +
          " ms</b> of lag — the two Bluetooth links' different buffering, not clock drift — and left drift at <b>" +
          (cDr && cDr.n ? mCorr.toFixed(0) : '—') +
          ' ms</b> (raw ' +
          (rDr && rDr.n ? mRaw.toFixed(0) : '—') +
          ' ms).';
      }
      var refusedFloor = oks.filter(function (m) {
        return m.floorSync && !m.floorSync.available;
      }).length;
      if (refusedFloor) concl += ' <span class="muted">' + refusedFloor + ' night(s) have no usable arrival floor and show only the raw lag.</span>';
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
    detailWorker.postMessage({
      type: 'job',
      key: k,
      label: k,
      ecgFile: nt.ecg,
      ppgFile: nt.ppg,
      ecgAccFile: nt.ecgAcc,
      ppgAccFile: nt.ppgAcc,
      fingerFile: nt.finger || null,
      ecgArrFile: nt.ecgArr || null,
      ppgArrFile: nt.ppgArr || null,
      ringArrFile: nt.ringArr || null,
      ecgRunsFile: nt.ecgRuns || null,
      ppgRunsFile: nt.ppgRuns || null,
      fingerRunsFile: nt.fingerRuns || null,
      detail: true
    });
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

  /* §∅ AN OUTPUT OVER ABSENT INPUT REPORTS THE ABSENCE. The legs now refuse fiducials inside the
     spans the box recorded as measuring nothing, and a refusal a reader cannot see is the same
     silence the sidecar exists to end. Prose beside the count it qualifies, in the shape the
     artifact-drop parenthetical next to it already uses — so it inherits that number's badge rather
     than planting a second, unbadged one (§🎫, badge the series not the caption). Empty string when
     no sidecar was paired: absence of a sidecar is not a clean recording. */
  function validityNote(v) {
    if (!v) return '';
    var bits = [v.spans != null ? v.spans + ' recorded span' + (v.spans === 1 ? '' : 's') : v.channels + '-channel sidecar'];
    bits.push(v.dropped + ' dropped');
    if (v.partial) bits.push(v.partial + ' partly pinned, kept');
    if (v.unmeasuredSec != null) bits.push((v.unmeasuredSec / 60).toFixed(0) + ' min unmeasured');
    if (!v.comparable) bits.push('sidecar not comparable');
    return ' <span class="muted">[' + v.source + ': ' + bits.join(' · ') + ']</span>';
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
      validityNote(m.ecg.validity) +
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
      ' feet' +
      validityNote(m.ppg.validity) +
      ' @ ' +
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
      cards.push(
        hcard(
          'beat-to-beat',
          isFinite(cp.residIQR) ? cp.residIQR.toFixed(0) : '—',
          'ms',
          isFinite(cp.residIQR) ? 'lag IQR vs local baseline' : escHtml(cp.residIQRReason || 'lag IQR vs local baseline'),
          cp.residIQR <= G.BEAT_IQR_MAX_MS ? C.green : C.amber,
          'spread'
        )
      );
      cards.push(
        hcard(
          'drift',
          isFinite(cp.driftRange) ? cp.driftRange.toFixed(0) : '—',
          'ms',
          isFinite(cp.driftRange)
            ? (isFinite(cp.ppm) ? cp.ppm.toFixed(0) + ' ppm' : escHtml(cp.ppmReason || '')) + (isFinite(cp.linR2) ? ' · R²=' + cp.linR2.toFixed(2) : '')
            : escHtml(cp.driftRangeReason || ''),
          cp.driftRange <= G.DRIFT_MAX_MS ? C.green : C.amber,
          'drift'
        )
      );
    }
    var fsy = m.floorSync;
    if (fsy && fsy.available && m.cpCorr && m.cpCorr.ok) {
      var cov = function (L) {
        return L.windows - L.refused + '/' + L.windows + ' floor windows usable (' + L.stream + ' stream)' + (L.unmapped ? ' · ' + L.unmapped + ' beats outside every anchored packet dropped' : '');
      };
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(
        hcard(
          'corrected lag · arrival floors',
          m.cpCorr.med.toFixed(0),
          'ms',
          'IQR ' + m.cpCorr.p25.toFixed(0) + '–' + m.cpCorr.p75.toFixed(0) + ' · coupled ' + (m.cpCorr.matchRate * 100).toFixed(0) + ' %',
          C.blue,
          'floor'
        )
      );
      cards.push(
        hcard(
          'buffering difference removed',
          isFinite(fsy.bufferingDiffMs) ? fsy.bufferingDiffMs.toFixed(0) : '—',
          'ms',
          "raw − corrected median lag: the two Bluetooth links' buffering, not clock drift",
          C.amber,
          'floor'
        )
      );
      cards.push(hcard('drift, corrected', m.cpCorr.driftRange.toFixed(0), 'ms', 'raw ' + m.cp.driftRange.toFixed(0) + ' ms', m.cpCorr.driftRange <= G.DRIFT_MAX_MS ? C.green : C.amber, 'drift'));
      cards.push(hcard('anchors', fsy.ecg.windows - fsy.ecg.refused + ' · ' + (fsy.ppg.windows - fsy.ppg.refused), 'windows', 'H10 ' + cov(fsy.ecg) + ' · Verity ' + cov(fsy.ppg), C.ink, 'count'));
      var ck = fsy.accCheck || {};
      cards.push(
        ck.ok
          ? hcard(
              'motion check',
              ck.deltaMedianMs.toFixed(0),
              'ms',
              'chest vs ankle movement on the two floor axes should align at ≈ 0 (±' + (ck.tolMs || 25) + ' ms resolution) · ' + ck.anchors + ' shared movements',
              Math.abs(ck.deltaMedianMs) <= (ck.tolMs || 25) ? C.green : C.amber,
              'acc'
            )
          : hcard('motion check', 'n/a', '', ck.reason || 'unavailable', C.mut)
      );
    } else if (fsy) {
      cards.push('<div style="height:1px;background:rgba(255,255,255,.08);margin:2px 0"></div>');
      cards.push(hcard('arrival-floor correction', 'n/a', '', (fsy.reason || 'unavailable') + " — the raw lag carries the two links' buffering difference", C.mut));
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
      hcard(
        LEG[tag].name + ' beat-to-beat',
        isFinite(c.residIQR) ? c.residIQR.toFixed(0) : '—',
        'ms',
        isFinite(c.residIQR) ? 'lag IQR vs 30 s local median' : escHtml(c.residIQRReason || 'lag IQR vs 30 s local median'),
        C.ink,
        'spread'
      )
    );
  }
  function renderThree(m) {
    var box = el('threeHead'),
      hb = el('hatHead');
    if (!box || !hb) return;
    if (!m.finger && !m.fingerError) {
      box.innerHTML = '<div class="muted">No O2Ring <code>_PPG.txt</code> for this night — the finger site and the hat need it.</div>';
      hb.innerHTML = '';
      drawThree(null, null);
      drawHat(null);
      drawHistF(m);
      return;
    }
    if (m.fingerError) {
      box.innerHTML = '<div class="muted" style="color:' + C.red + '">finger leg failed: ' + escHtml(m.fingerError) + '</div>';
      hb.innerHTML = '';
      drawThree(null, null);
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
        var a = hatSiteArgs(h, r[0], r[1], r[2]);
        hc.push(hcard(a[0], a[1], a[2], a[3], a[4], 'hat'));
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
      /* ── THE AXES, AND BOTH σ SETS WHEN THERE ARE TWO ────────────────────────────────────────────────
         This card used to read "RAW … a corrected hat needs the ring on an arrival-floor axis, which is
         not recorded", which stopped being true with E11 (#3267). Now: when the three-floor hat solved,
         the RAW set and the CORRECTED set are shown SIDE BY SIDE, each labelled with its own axis.

         NEVER A DELTA between them, which is the drift-removed row's rule in PAT-HAT-DRIFT-DIFFERENCED: the
         two hats are different estimators over different axes, so a difference is not an error bar and a
         reader who sees one number will treat it as one. Two sets, both badged, both named.

         When it did NOT solve the card stays RAW and carries the FLOOR LAYER'S OWN REASON rather than a
         general sentence — "no arrival sidecar for the O2Ring" and "the row accounting differs" are
         different findings and the page must not blur them (§∅: name the absence). */
      var hcorr = m.threeCorr,
        fsF = m.floorSync && m.floorSync.finger;
      if (hcorr && hcorr.ok) {
        hc.push(hcard('timing axes', 'RAW + FLOOR', '', 'both hats below: raw receive stamps, and every leg re-timed on its own device’s packet-arrival floor', C.ink, 'floor'));
        [
          ['chest', 'H10 chest ECG', C.teal],
          ['finger', 'O2Ring finger', C.amber],
          ['ankle', 'Verity ankle', '#B98AFF']
        ].forEach(function (r) {
          var a = hatSiteArgs(hcorr, r[0], r[1], r[2]);
          // the same site card as the raw set, re-labelled so the two can never be read as one series
          hc.push(hcard(a[0] + ' · floor', a[1], a[2], a[3], a[4], 'floor'));
        });
        hc.push(
          hcard(
            'pair spreads · floor',
            hcorr.pairSd.ab.toFixed(1) + ' · ' + hcorr.pairSd.ac.toFixed(1) + ' · ' + hcorr.pairSd.bc.toFixed(1),
            'ms',
            'IQR/1.349 of window medians on the floor axes · finger · ankle · finger→ankle',
            C.ink,
            'floor'
          )
        );
        hc.push(hcard('windows solved · floor', String(hcorr.n), '', 'all three FLOOR legs ≥ 50 beats in the same ' + hcorr.winMin + ' min', C.ink, 'count'));
      } else {
        hc.push(
          hcard(
            'timing axes',
            'RAW',
            '',
            'phone receive stamps — each σ includes its device’s Bluetooth buffering. Corrected hat not solved: ' +
              ((hcorr && hcorr.reason) || (fsF && !fsF.ok && fsF.reason) || 'no arrival-floor result for the finger'),
            C.amber,
            'hat'
          )
        );
      }
    } else hc.push(hcard('three-cornered hat', '—', '', h && h.reason ? h.reason : 'not solved', C.mut));
    hb.innerHTML = hc.join('');
    drawThree(h, m);
    drawHat(h);
    drawHistF(m);
  }
  /* ── THE THREE LEGS ACROSS THE NIGHT, THREE WAYS (owner 2026-10-18) ──────────────────────────────────────
     a · raw receive stamps (`h` = the raw hat). b · every leg on every arrival-floor sidecar the night has
     (`m.threeSide`), each leg computed from its own beat pairs. c · each leg DERIVED from the other two
     computed legs of b, the computed leg drawn faint beside it. By the per-beat closure
     (PAT-HAT-DRIFT-DIFFERENCED F5) a derived line tracks its computed twin by arithmetic, so c measures
     the window medians' disagreement, not a second measurement. */
  function drawThree(h, m) {
    drawLegs('threeChart', h && h.windows, ['ab', 'ac', 'bc'], null, '5-min median lag (ms) vs time of night — raw receive stamps', 'needs all three sites coupled');
    var s = m && m.threeSide,
      note = el('threeSideNote'),
      why = !m
        ? 'needs all three sites coupled'
        : !m.floorSync || !m.floorSync.available
          ? 'no floor axis — ' + ((m.floorSync && m.floorSync.reason) || 'no arrival sidecars')
          : !s
            ? 'needs all three sites coupled'
            : s.windows.length < 2
              ? s.reason || 'fewer than 2 windows'
              : null;
    if (note)
      // plain text, no markup: textContent needs no escaping (xss-sink-gate)
      note.textContent = !s
        ? why || ''
        : (s.ringEnd === 'raw'
            ? 'The finger end stays on its raw receive stamp: ' + (s.ringReason || 'the ring floor did not solve') + '. Each finger leg moves only its Polar end onto that device’s floor.'
            : 'All three ends are on their own arrival floors.') +
          (s.check && s.check.shiftedMedMs != null && s.check.corrMedMs != null
            ? ' Check: chest → ankle shifted per beat ' +
              s.check.shiftedMedMs.toFixed(0) +
              ' ms vs computed on the floor axis ' +
              s.check.corrMedMs.toFixed(0) +
              ' ms (' +
              s.check.droppedBeats +
              ' beats without an anchor dropped).'
            : '') +
          (s.ok ? '' : ' ' + (s.reason || ''));
    var W = why ? null : s.windows;
    drawLegs('threeChartSide', W, ['ab', 'ac', 'bc'], null, '5-min median lag (ms) — every leg on its sidecars', why);
    var D = W
      ? W.map(function (x) {
          return { t: x.t, ab: x.ab, ac: x.ac, bc: x.bc, dab: x.ac - x.bc, dac: x.ab + x.bc, dbc: x.ac - x.ab };
        })
      : null;
    drawLegs('threeChartDer', D, ['dab', 'dac', 'dbc'], ['ab', 'ac', 'bc'], '5-min median lag (ms) — solid = derived from the other two, faint = computed', why);
  }
  function drawLegs(id, W, keys, faint, title, why) {
    var cv = el(id);
    if (!cv) return;
    var g = prep(cv),
      ctx = g.ctx,
      w = g.w,
      ht = g.h,
      pad = 44;
    ctx.fillStyle = C.mut;
    ctx.font = '10px monospace';
    if (!W || W.length < 2) {
      ctx.fillText(why || 'needs all three sites coupled', pad, ht / 2);
      return;
    }
    var t0 = W[0].t,
      t1 = W[W.length - 1].t,
      all = [],
      ks = keys.concat(faint || []);
    W.forEach(function (x) {
      ks.forEach(function (k) {
        all.push(x[k]);
      });
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
    ctx.fillText(title, pad, 12);
    var line = function (k, col, alpha) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      W.forEach(function (x, i) {
        i ? ctx.lineTo(X(x.t), Y(x[k])) : ctx.moveTo(X(x.t), Y(x[k]));
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    (faint || []).forEach(function (k) {
      line(k, LEG[k].col, 0.3);
    });
    keys.forEach(function (k, i) {
      line(k, LEG[(faint || keys)[i]].col, 1);
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

  /* ── ONE SITE'S HAT CARD — the solver's per-corner STATUS, not a bare sign test (PAT-HAT-DRIFT-DIFFERENCED) ──
     This read `sigma == null ⇒ "REFUSED — the independent-error model does not fit this site"`, the wording
     #3183 removed from PAT Classic vs Fused and left here. On 2026-09-26 the chest corner's variance was −32 ms²
     with a 95 % CI of [−226, +206]: consistent with independence, too few windows to resolve — `underpowered`,
     with a bound. Only a CI wholly below 0 is an independence failure. A result from before `corners` existed
     keeps the old sign test. Returns the hcard arguments [label, value, unit, sub, tone]. */
  function hatSiteArgs(h, site, name, tone) {
    var s = h.sigma ? h.sigma[site] : null,
      c = h.corners ? h.corners[site] : null,
      v = h.variance ? h.variance[site] : null,
      vs = typeof v === 'number' && isFinite(v) ? v.toFixed(0) + ' ms²' : 'a negative variance';
    var lab = 'σ ' + name;
    if (typeof s === 'number' && isFinite(s)) return [lab, s.toFixed(1), 'ms', 'from ' + h.n + ' × ' + h.winMin + '-min windows', tone];
    if (c && c.status === 'underpowered')
      return [
        lab,
        'UNDERPOWERED',
        '',
        (typeof c.boundMs === 'number' && isFinite(c.boundMs) ? 'σ < ' + c.boundMs.toFixed(1) + ' ms' : 'no bound resolved') +
          ' — variance ' +
          vs +
          ', but its 95 % CI reaches 0: too few windows to resolve this site, not an independence failure',
        C.mut
      ];
    if (c && c.status === 'independence-failed')
      return [
        lab,
        'REFUSED',
        '',
        'variance ' +
          vs +
          ' with its whole 95 % CI below 0 — errors shared between ' +
          (Array.isArray(c.pair) ? c.pair.join(' and ') : 'two sites') +
          (typeof c.explainRho === 'number' && isFinite(c.explainRho) ? ', ρ ≈ ' + c.explainRho.toFixed(2) + (c.rhoOutOfRange ? ' (beyond ±1, unclamped)' : '') : ''),
        C.mut
      ];
    return [lab, 'REFUSED', '', 'negative variance ' + vs + ' — the independent-error model does not fit this site', C.mut];
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
    /* ── THE AGGREGATE HALF OF §∅ ─────────────────────────────────────────────────────────────────
       Each corpus statistic below is published with the COUNT of nights it was actually taken over
       (`*N`, against the `nightsCoupled` / `nNights` denominators already in this file) and with a
       `*Reason` sibling that is null whenever the number IS published. A reader can therefore tell
       "no night could measure this" from "0 ms", and "the median of 3 nights" from "the median of
       25" — neither of which the older shape carried. The reason text comes from the same
       `coverStat` the cards read, so the page and this file cannot explain one absence two ways. */
    var ppm = coverStat(
        oks,
        function (m) {
          return m.cp.ppm;
        },
        'inter-device drift rate'
      ),
      mrA = coverStat(
        oks,
        function (m) {
          return m.cp.matchRate * 100;
        },
        'coupling rate'
      ),
      riqA = coverStat(
        oks,
        function (m) {
          return m.cp.residIQR;
        },
        'beat-to-beat spread'
      ),
      linA = coverStat(
        oks,
        function (m) {
          return m.cp.linR2;
        },
        'drift shape R²'
      );
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
            driftPpm: { median: numOrNull(ppm.value), min: numOrNull(ppm.min), max: numOrNull(ppm.max), n: ppm.n, reason: ppm.reason },
            matchRatePctMedian: numOrNull(mrA.value),
            matchRatePctMedianN: mrA.n,
            matchRatePctMedianReason: mrA.reason,
            beatToBeatIQRmsMedian: numOrNull(riqA.value),
            beatToBeatIQRmsMedianN: riqA.n,
            beatToBeatIQRmsMedianReason: riqA.reason,
            driftShapeR2Median: numOrNull(linA.value, 2),
            driftShapeR2MedianN: linA.n,
            driftShapeR2MedianReason: linA.reason,
            afterArrivalFloor: (function () {
              var c = oks.filter(function (m) {
                return m.cpCorr && m.cpCorr.ok && m.floorSync && m.floorSync.available;
              });
              if (!c.length) return null;
              var cd = coverStat(
                  c,
                  function (m) {
                    return m.cpCorr.driftRange;
                  },
                  'corrected drift range'
                ),
                cp2 = coverStat(
                  c,
                  function (m) {
                    return m.cpCorr.ppm;
                  },
                  'corrected drift rate'
                ),
                rd = coverStat(
                  c,
                  function (m) {
                    return m.cp.driftRange;
                  },
                  'raw drift range'
                );
              return {
                nNights: c.length,
                driftRangeMsMedian: numOrNull(cd.value),
                driftRangeMsMedianN: cd.n,
                driftRangeMsMedianReason: cd.reason,
                driftPpmMedian: numOrNull(cp2.value),
                driftPpmMedianN: cp2.n,
                driftPpmMedianReason: cp2.reason,
                rawDriftRangeMsMedian: numOrNull(rd.value),
                rawDriftRangeMsMedianN: rd.n,
                rawDriftRangeMsMedianReason: rd.reason
              };
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
                  beatToBeatIQRmsReason: m.cp.residIQRReason || null,
                  driftRangeMs: +(+m.cp.driftRange).toFixed(1),
                  driftRangeMsReason: m.cp.driftRangeReason || null,
                  driftPpm: +(+m.cp.ppm).toFixed(1),
                  driftPpmReason: m.cp.ppmReason || null,
                  linR2: +(+m.cp.linR2).toFixed(2)
                }
              : null,
            floorSync: m.floorSync || null,
            correctedCoupling:
              m.cpCorr && m.cpCorr.ok
                ? {
                    matchRatePct: +(m.cpCorr.matchRate * 100).toFixed(1),
                    medianLagMs: +m.cpCorr.med.toFixed(1),
                    beatToBeatIQRms: +(+m.cpCorr.residIQR).toFixed(1),
                    beatToBeatIQRmsReason: m.cpCorr.residIQRReason || null,
                    driftRangeMs: +(+m.cpCorr.driftRange).toFixed(1),
                    driftRangeMsReason: m.cpCorr.driftRangeReason || null,
                    driftPpm: +(+m.cpCorr.ppm).toFixed(1),
                    driftPpmReason: m.cpCorr.ppmReason || null
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
        void ingestFiles(e.target.files);
      });
    if (xi)
      xi.addEventListener('change', function (e) {
        void ingestFiles(e.target.files);
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
        else if (dt && dt.files) void ingestFiles(dt.files);
      });
    }
    if (el('run')) el('run').addEventListener('click', runBatch);
    if (el('dlBtn')) el('dlBtn').addEventListener('click', downloadJSON);
    renderNightTable();
  });
})();
