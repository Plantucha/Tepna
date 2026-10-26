/*
 * sensor-trio-night.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ONE NIGHT'S THREE-CORNERED HAT — the landing page for the monitor's "3 corner hat" click.
 *
 * sensor-trio-power-analysis answers "HOW MANY windows pin a sensor's σ?" — a Monte-Carlo sweep
 * whose figures are empty until a long simulation runs, with one real-data overlay. Opened from
 * the Nights ledger with a single night's files, four of its six panels stay blank by
 * construction (measured 2026-09-22). This page answers the question that click actually asks:
 * WHAT DID THIS NIGHT'S HAT SOLVE TO, and what did it solve it from?
 *
 * BUILT ON THE SUITE'S OWN ENGINES, not the harness idiom: ans-design.css for the surface,
 * hrvdex-chart.js (the first-party Chart-shaped canvas engine) for the time-series figures,
 * hand-authored SVG (the house norm for every other node, THIRD-PARTY.md) for the σ-with-CI and
 * correlation figures, entrance-guard.js so a frozen timeline (print / PDF / capture) cannot leave
 * the cards at opacity 0.
 *
 * NOTHING STATISTICAL RUNS HERE. Same kernel, same worker (sensor-trio-worker.js `realNight` with
 * `wantSeries`), same classifier, same corner gates. The derivations that need the aligned series
 * — the bootstrap CI `wantSeries` skips, the running hat over prefixes, the sd of each pairwise
 * difference, the per-corner confidence means, the per-minute display bins — run in the worker's
 * `nightDerive` job, so this file carries no estimator of its own to drift from the gated one.
 *
 * LITERATURE — VALIDATION REFERENCES, NEVER RUNTIME INPUTS (LITERATURE-USE-POLICY-2026-07-11 §1/§2;
 * INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06 §8/§9). Drawn as labelled marks and cited in prose;
 * never fed to a number, never promoted to an evidence badge (there is no registry entry for a
 * TCH σ̂, and `no-fabricated-tier` exists to stop exactly that). Anchors, rest/sleep vs ECG criterion:
 *   · H10 (chest ECG) — the criterion device in essentially every wearable-HR study (≈0 by
 *     construction): Schweizer & Gilgen-Ammann 2025, JMIR Cardio, doi:10.2196/67110; Budig 2021,
 *     Sensors, doi:10.3390/s22010180.
 *   · Verity Sense (upper-arm PPG) — MAE 1.43 bpm, bias −0.05 bpm (Schweizer & Gilgen-Ammann 2025).
 *   · wrist/arm PPG in sleep — MAE < 1 beat (Rehman 2024, Sensors); meta-analysis mean difference
 *     −0.40 bpm in sleep (Zhang 2020, J Sports Sci).
 *   · O2Ring (finger pulse) — no published HR-MAE; validated for ODI/OSA screening, AUC 0.91
 *     (Tisyakorn 2024, Sleep Breath, doi:10.1007/s11325-024-03232-9); ring nocturnal HR is low-bias
 *     (Cao 2021, JMIR).
 *   The published statistic is MAE (trueness); TCH σ̂ is reference-free precision. For a zero-mean
 *   Gaussian error σ ≈ MAE·√(π/2) ≈ 1.253·MAE — an order-of-magnitude and RANKING check, not an
 *   identity (§8, statistic caveat). Method precedent: the N-cornered hat and its maximum-likelihood
 *   form, non-negative by construction (Schatzman 2020 IFCS-ISAF, 2021); the Groslambert covariance
 *   that outperforms TCH on the negative-variance case (Calosso et al. 2018, IEEE TUFFC); the same
 *   3CH transplanted to atmospheric datasets with the same unknown-correlation limit (Sjoberg et al.
 *   2021, J Atmos Oceanic Tech). Corpus reference: median σ, ρ-on, over the committed nights —
 *   H10 0.79 · O2Ring 1.08 · Verity 2.20 bpm (validation doc §11).
 *
 * ABSENCE IS NULL: a gated or negative-variance corner is `null` from the worker and renders as an
 * absence here — never 0, never a placeholder inside the σ axis. Clock Contract §5: the worker's keys
 * are floor-seconds of floating wall-clock ms; the time axis reads them back with getUTC* only.
 * 100 % local: drag-drop / monitor injection only, connect-src 'none'. An ANALYSIS tool, not a
 * bundled node — no ganglior export, no provenance fragment.
 */
(function () {
  'use strict';
  // the trio family's device palette (the paper's captions: O2Ring amber · H10 teal · Verity purple)
  const DEV = {
    h10: { name: 'Polar H10', kind: 'chest ECG', col: '#3DE0D0', rgb: '61,224,208' },
    verity: { name: 'Verity Sense', kind: 'ankle PPG', col: '#B98AFF', rgb: '185,138,255' },
    o2: { name: 'O2Ring', kind: 'finger pulse · 1 Hz native', col: '#FFB84D', rgb: '255,184,77' }
  };
  const DKEYS = ['h10', 'verity', 'o2'];
  const FLAG = '#FF6B7A',
    MUT = '#6e85a8',
    DIM = '#3d5070',
    GRIDC = 'rgba(30,45,66,0.6)';
  const rgba = (k, a) => 'rgba(' + DEV[k].rgb + ',' + a + ')';
  // ── literature anchors (author-time constants; display only — see header) ─────────────────
  const MAE_TO_SIGMA = Math.sqrt(Math.PI / 2);
  const LIT = {
    h10: { sigma: null, mark: 'criterion device', cite: 'Schweizer & Gilgen-Ammann 2025 · Budig 2021' },
    verity: { sigma: 1.43 * MAE_TO_SIGMA, mark: 'arm MAE 1.43 → σ≈1.8', cite: 'Schweizer & Gilgen-Ammann 2025, JMIR Cardio, doi:10.2196/67110' },
    o2: { sigma: null, mark: 'no published HR-MAE', cite: 'Tisyakorn 2024 (ODI/OSA, AUC 0.91) · Cao 2021 (ring HR)' }
  };
  const CORPUS = { h10: 0.79, verity: 2.2, o2: 1.08 }; // §11 ρ-on medians, bpm
  const PAIRS = [
    { key: 'hv', a: 'h10', b: 'verity', label: 'H10 − Verity' },
    { key: 'ho', a: 'h10', b: 'o2', label: 'H10 − O2Ring' },
    { key: 'vo', a: 'verity', b: 'o2', label: 'Verity − O2Ring' }
  ];
  const $ = (id) => document.getElementById(id);
  const f2 = (x) => (x == null ? '—' : x.toFixed(2));
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const hmOf = (sec) => Math.floor(sec / 3600) + ' h ' + pad2(Math.floor((sec % 3600) / 60)) + ' min';
  // floating wall-clock read-back — getUTC* only (Clock Contract §5)
  const utcHM = (sec) => {
    const d = new Date(sec * 1000);
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
  //  INGEST — the hat's classifier, VERBATIM (gated by capture-host
  //  test_the_tool_classifiers_accept_box_filenames, which reads this body as text)
  // ═══════════════════════════════════════════════════════════════════════════
  const NIGHTS = {};
  /* ── §∅ · THE VALIDITY COMPANION IS PAIRED BY NAME, NOT NIGHT-KEYED ──────────────────────────────
     Residue `2026-10-17-sample-parsers-called-without-their-sidecar`. The box writes
     `<base>RUNS.txt` beside a stream it blanked, and the parsers take those bytes as `opts.runsText`.
     A companion carries no sample rows, so the first-data-row night key cannot read one; its night is
     the night of the file it sits beside, which is what pairing by name says and nothing else can.
     The map is keyed by the companion's OWN filename and read once a corner's file is chosen, so a
     companion can never be paired with a stream the night did not select. */
  const COMPANIONS = new Map();
  const RUNS_NAME = /RUNS\.txt$/i;
  const companionOf = (file) => (file ? COMPANIONS.get(file.name.replace(/\.txt$/i, 'RUNS.txt')) || null : null);

  /* TWO CAPTURE LAYOUTS, ONE RULE EACH — identical to sensor-trio-power-analysis.js: the phone app
     writes `Polar_H10_<id>_YYYYMMDD_HHMMSS_<KIND>.txt`, the capture host the same bytes with one
     14-digit run and `Wellue_O2Ring-S_<serial>_YYYYMMDDHHMMSS_SPO2.csv`; the stamp is
     `(\d{8})_?(\d{6})` so each role has ONE pattern, and the ring's box `_SPO2.csv` IS the 'o2' role.
     The ring's raw `_PPG.txt` has no regex on purpose: the hat reads the ring's PULSE from its CSV. */
  function classify(file) {
    const n = file.name;
    let mo;
    if ((mo = n.match(/^(?:O2Ring.*|Wellue_O2Ring-S_[0-9A-Za-z]+)_(\d{14})(?:_SPO2)?\.csv$/i))) return { role: 'o2', stamp: mo[1] };
    // the ring's RAW pleth is its preferred corner (156 beat markers, then PPGDSP feet); the CSV is the fallback
    if ((mo = n.match(/^Wellue_O2Ring-S_[0-9A-Za-z]+_(\d{14})_PPG\.txt$/i))) return { role: 'o2ppg', stamp: mo[1] };
    /* The H10 corner prefers the RAW _ECG.txt (Pan–Tompkins in the worker): the device _HR.txt is smoothed and
       under-states σ (CLAUDE.md §🎙️ honest-HR facts). _HR.txt stays the fallback for a night without the waveform. */
    if ((mo = n.match(/^Polar_H10_[0-9A-Za-zx]+_(\d{8})_?(\d{6})_([A-Z]+)\.txt$/i))) {
      const k = mo[3].toUpperCase();
      return k === 'HR' ? { role: 'h10', stamp: mo[1] + mo[2] } : k === 'ECG' ? { role: 'h10ecg', stamp: mo[1] + mo[2] } : null;
    }
    if ((mo = n.match(/^Polar_(?:Sense|VeritySense)_[0-9A-Za-zx]+_(\d{8})_?(\d{6})_([A-Z]+)\.txt$/i))) {
      const k = mo[3].toUpperCase(),
        role = k === 'PPG' ? 'verityPPG' : k === 'PPI' ? 'verityPPI' : k === 'HR' ? 'verityHR' : null;
      return role ? { role, stamp: mo[1] + mo[2] } : null;
    }
    return null;
  }
  // sessions starting before noon fold into the PREVIOUS evening's night (floating civil time)
  function nightKeyOf(stamp) {
    /* §2.7 — one refusal for the WHOLE stamp, before any field is read. `stampMs` range-checks all
       six components, so a key this function returns and the instant `stampMs` returns can never
       disagree about whether the stamp was real. §∅: an impossible stamp is null, never a date. */
    if (stampMs(stamp) == null) return null;
    const Y = +stamp.slice(0, 4),
      M = +stamp.slice(4, 6),
      D = +stamp.slice(6, 8),
      h = +stamp.slice(8, 10);
    let ms = Date.UTC(Y, M - 1, D);
    if (h < 12) ms -= 86400000;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  /* THE NIGHT A FILE BELONGS TO COMES FROM ITS FIRST DATA ROW, NOT ITS NAME.
     Measured 2026-10-20 over 9853 corpus files this classifier accepts: 9738 carry a parseable row
     stamp, the median name-to-content error is 3.9 s, 74 files exceed 5 min and the worst sits
     18.71 h out. Eight of them cross the noon fold below, so the name alone indexed them one night
     early — the name is written when the file is offloaded, the row when the recording started.
     A file whose rows carry no stamp keeps the filename key and the ingest note says how many did,
     because a fallback nobody can see is the defect this replaces. */
  const ROW_SCAN_BYTES = 65536,
    ROW_SCAN_LINES = 400;
  // §2.7: Date.UTC rolls bad components onto a wrong instant, so every field is range-checked first
  /* §2.7 in `_ckMk`'s own order: the DATE round-trip, then the ISO end-of-day escape, then the TIME
     range. The order is load-bearing twice over. A bare `h > 23` guard rejects ISO-8601 `24:00:00`,
     which the Clock Contract names as the one legitimate overflow — so the escape must sit above the
     range check. And the round-trip cannot stand in for the range check: minute 99 rolls the HOUR and
     leaves the date alone, so `getUTCDate()` still matches and only the explicit bound refuses it. */
  function _mkTMs(Y, M, D, h, mi, se, ms) {
    se = se || 0;
    ms = ms || 0;
    const day0 = Date.UTC(Y, M - 1, D),
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
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  /* §2.7 — THE FILENAME STAMP GOES THROUGH THE SAME `_mkTMs` THE ROW PARSER ALREADY USES. The bare
     `Date.UTC` that stood here rolled an impossible stamp onto a real instant: measured on this
     shape, `20261332999999` reached 2027-02-05, `20260230000000` reached 2026-03-02 and
     `99999999999999` reached year 10007. This value is the key `resolveTriple` picks a companion by,
     so a fabricated instant mis-picks a file rather than declining to pick one. The validator sat in
     this file already and the parser beside it never called it, which is the whole defect.
     The length test is the §∅ leg: a short stamp would read its missing fields as zero. */
  function stampMs(s) {
    const t = String(s == null ? '' : s);
    if (!/^\d{14}$/.test(t)) return null;
    return _mkTMs(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12), +t.slice(12, 14), 0);
  }
  // the trio sessions that are CONTEMPORANEOUS, anchored on the O2Ring start (as the power tool)
  function resolveTriple(nt) {
    const C = nt.cand || {},
      largest = (a) => (a && a.length ? a.reduce((b, x) => (x.size > b.size ? x : b)) : null);
    const o2 = largest(C.o2),
      o2p = largest(C.o2ppg),
      anchor = o2 || o2p;
    nt.o2 = o2 ? o2.file : null;
    nt.startMs = anchor ? anchor.ms : null;
    const nearest = (a) => {
      if (!a || !a.length) return null;
      if (nt.startMs == null) return largest(a);
      return a.reduce((b, x) => (Math.abs(x.ms - nt.startMs) < Math.abs(b.ms - nt.startMs) ? x : b));
    };
    const he = nearest(C.h10ecg),
      h = nearest(C.h10),
      vppg = nearest(C.verityPPG),
      vppi = nearest(C.verityPPI),
      vhr = nearest(C.verityHR);
    nt.h10 = h ? h.file : null;
    nt.h10ecg = he ? he.file : null;
    const op = nearest(C.o2ppg);
    nt.o2ppg = op ? op.file : null;
    nt.verityPPG = vppg ? vppg.file : null;
    nt.verityPPI = vppi ? vppi.file : null;
    nt.verityHR = vhr ? vhr.file : null;
    nt.o2ppgRuns = companionOf(nt.o2ppg);
    nt.h10ecgRuns = companionOf(nt.h10ecg);
    nt.verityPPGRuns = companionOf(nt.verityPPG);
  }
  const eligible = (nt) => !!((nt.o2ppg || nt.o2) && (nt.h10ecg || nt.h10) && (nt.verityPPG || nt.verityPPI || nt.verityHR));
  const verSrc = (nt) => (nt.verityPPG ? 'PPG' : nt.verityPPI ? 'PPI' : nt.verityHR ? 'HR' : '—');
  let SELECTED = null;
  async function ingestFiles(list) {
    let keyedByName = 0,
      impossibleStamp = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i],
        c = classify(f);
      if (!c) continue;
      if (RUNS_NAME.test(f.name)) {
        COMPANIONS.set(f.name, f);
        continue;
      }
      const rowMs = await firstRowTMs(f);
      if (rowMs == null) keyedByName++;
      /* §∅ — a file whose NAME carries an impossible stamp and whose ROWS carry none is not indexed,
         and the note below says how many were dropped. Bucketing it under a rolled date would file a
         real capture on a night it never happened, which is worse than leaving it out loudly. */
      const nk = rowMs == null ? nightKeyOf(c.stamp) : nightKeyOfMs(rowMs);
      if (nk == null) {
        impossibleStamp++;
        continue;
      }
      const nt = NIGHTS[nk] || (NIGHTS[nk] = { key: nk, cand: {} });
      (nt.cand[c.role] || (nt.cand[c.role] = [])).push({
        file: f,
        ms: rowMs == null ? stampMs(c.stamp) : rowMs,
        stampSource: rowMs == null ? 'filename' : 'first-row',
        size: f.size
      });
    }
    Object.keys(NIGHTS).forEach((k) => resolveTriple(NIGHTS[k]));
    const elig = Object.keys(NIGHTS)
      .filter((k) => eligible(NIGHTS[k]))
      .sort();
    if (!SELECTED || !NIGHTS[SELECTED] || !eligible(NIGHTS[SELECTED])) SELECTED = elig.length ? elig[elig.length - 1] : null;
    renderNightNav();
    const note = $('ingestNote');
    if (note)
      note.textContent =
        Object.keys(NIGHTS).length +
        ' night(s) indexed from ' +
        list.length +
        ' file(s) · ' +
        elig.length +
        ' eligible' +
        (keyedByName ? ' · ' + keyedByName + ' keyed by filename (no row stamp)' : '') +
        (impossibleStamp ? ' · ' + impossibleStamp + ' not indexed (impossible filename stamp)' : '');
    // one eligible night is the landing case: solve it without a click
    if (elig.length === 1 && !RUNNING) solve(NIGHTS[elig[0]]);
    else if (elig.length > 1 && !RUNNING) setStatus('idle', 'pick a night in the sidebar, then Solve');
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
        ok = eligible(nt);
      if (ok) elig++;
      const el = document.createElement('div');
      el.className = 'sb-item' + (SELECTED === k ? ' active' : '') + (ok ? '' : ' ts-dim');
      el.setAttribute('data-k', k);
      el.title = ok
        ? 'O2Ring ' + (nt.o2ppg ? 'PPG' : 'CSV') + ' · H10 ' + (nt.h10ecg ? 'ECG' : 'HR') + ' · Verity ' + verSrc(nt)
        : 'ineligible — needs O2Ring CSV, an H10 ECG or HR and a Verity stream';
      el.innerHTML = '<span class="ts-nk">' + esc(k) + '</span><span class="ts-nres" id="nres-' + esc(k) + '">' + (ok ? 'ready' : 'ineligible') + '</span>';
      nav.appendChild(el);
    });
    const tag = $('nightTag');
    if (tag) tag.textContent = keys.length ? keys.length + ' night' + (keys.length > 1 ? 's' : '') + ' · ' + elig + ' eligible' : 'no night';
    // enabled whenever a night can be solved. It STAYS enabled during a run (the click is then a no-op):
    // the monitor's openNight waits for this button to enable and presses it, and a button disabled by
    // an auto-started solve would read to the monitor as "no eligible night" — a false report.
    const pb = $('procBtn');
    if (pb) pb.disabled = elig === 0;
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  WORKER — one realm; realNight (wantSeries) then nightDerive
  // ═══════════════════════════════════════════════════════════════════════════
  const pend = new Map();
  let seq = 1,
    pool = [],
    _progHook = null;
  function bootPool(K) {
    pool = [];
    const readies = [];
    for (let i = 0; i < K; i++) {
      (function () {
        let w;
        try {
          w = new Worker('sensor-trio-worker.js');
        } catch (_e) {
          return; // no worker here (file:// in a locked-down browser) — the pool stays short, solve() reports it
        }
        const rec = { w: w, ready: false, _res: null };
        pool.push(rec);
        readies.push(
          new Promise((res) => {
            rec._res = res;
          })
        );
        w.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.type === 'ready') {
            rec.ready = true;
            if (rec._res) {
              rec._res();
              rec._res = null;
            }
            return;
          }
          if (m.type === 'progress') {
            if (_progHook) _progHook(m);
            return;
          }
          if (m.type === 'done') {
            const p = pend.get(m.reqId);
            if (p) {
              pend.delete(m.reqId);
              p(m);
            }
          }
        };
        w.onerror = () => {
          if (rec._res) {
            rec._res();
            rec._res = null;
          }
        };
        w.postMessage({ type: 'init' });
      })();
    }
    return Promise.race([Promise.all(readies), new Promise((r) => setTimeout(r, 8000))]);
  }
  function runJob(rec, job) {
    return new Promise((resolve) => {
      const id = seq++;
      pend.set(id, resolve);
      rec.w.postMessage(Object.assign({ type: 'job', reqId: id }, job));
      setTimeout(() => {
        if (pend.has(id)) {
          pend.delete(id);
          resolve({ error: 'timeout' });
        }
      }, job.timeoutMs || 300000);
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  SOLVE one night
  // ═══════════════════════════════════════════════════════════════════════════
  const RESULT = { night: null, real: null, derive: null };
  window.TRIO_NIGHT = RESULT;
  let RUNNING = false;
  async function solve(nt) {
    if (RUNNING || !nt || !eligible(nt)) return;
    RUNNING = true;
    SELECTED = nt.key;
    renderNightNav();
    const rc = $('nres-' + nt.key);
    if (rc) rc.textContent = 'solving…';
    const pb = $('procBtn');
    if (pb) pb.textContent = 'Solving…';
    setStatus('run', nt.key + ' · booting worker');
    if (!pool.length) await bootPool(1);
    const rec = pool.find((r) => r.ready);
    if (!rec) {
      finish(nt, { skip: true, reason: 'no worker realm available (a blob worker was refused)' }, null);
      return;
    }
    _progHook = (mm) => setStatus('run', nt.key + ' · ' + mm.phase);
    const r = await runJob(rec, {
      kind: 'realNight',
      wantSeries: true,
      timeoutMs: 1200000,
      label: nt.key,
      seed: hashStr(nt.key),
      /* RAW WAVEFORMS FIRST. The worker takes the Verity's _PPI.txt before its _PPG.txt when both are given, and the
         PPI rows carry the phone's RECEIVE time in batches (`Phone Data RX timestamp`), so its per-second HR map
         holds only the seconds a batch arrived: on 2026-09-25 that cut a 7.1 h night to 4483 aligned seconds
         (1 h 14 min). The PPI is sent only when there is no PPG; the raw ECG goes as `h10ecg`. */
      files: {
        o2: nt.o2 || null,
        o2ppg: nt.o2ppg || null,
        h10: nt.h10 || null,
        h10ecg: nt.h10ecg || null,
        verityPPG: nt.verityPPG || null,
        verityPPI: nt.verityPPG ? null : nt.verityPPI || null,
        verityHR: nt.verityHR || null,
        /* the validity companions, each paired by name to the file above it */
        o2ppgRuns: nt.o2ppgRuns || null,
        h10ecgRuns: nt.h10ecgRuns || null,
        verityPPGRuns: nt.verityPPGRuns || null
      }
    });
    const real = (r && r.real) || { skip: true, reason: (r && r.error) || 'no result' };
    if (real.skip) {
      finish(nt, real, null);
      return;
    }
    setStatus('run', nt.key + ' · bootstrap CI · running hat · minute bins');
    const d = await runJob(rec, {
      kind: 'nightDerive',
      timeoutMs: 600000,
      seed: hashStr(nt.key),
      keys: real.keys,
      hh: real.hh,
      vv: real.vv,
      oo: real.oo,
      cH: real.cH,
      cV: real.cV,
      cO: real.cO,
      stepSec: 300,
      B: 400
    });
    const derive =
      d && d.ci ? { ci: d.ci, running: d.running || [], pairSd: d.pairSd || null, conf: d.conf || null, minute: d.minute || null } : { ci: null, running: [], pairSd: null, conf: null, minute: null };
    // keep each corner's CI consistent with its (possibly nulled) point estimate — as runRealNight does
    if (derive.ci) for (const k of DKEYS) if (real.sigma[k] == null) derive.ci[k] = null;
    finish(nt, real, derive);
  }
  function finish(nt, real, derive) {
    RESULT.night = nt.key;
    RESULT.real = real;
    RESULT.derive = derive;
    _progHook = null;
    RUNNING = false;
    const pb = $('procBtn');
    if (pb) pb.textContent = 'Solve the hat';
    const rc = $('nres-' + nt.key);
    if (real.skip) {
      if (rc) {
        rc.textContent = 'not solved';
        rc.style.color = FLAG;
      }
      setStatus('bad', nt.key + ' · not solved');
      renderSkip(nt, real);
      return;
    }
    if (rc) {
      rc.innerHTML = evb('hat') + ' σ ' + f2(real.sigma.h10) + ' / ' + f2(real.sigma.verity) + ' / ' + f2(real.sigma.o2);
      rc.style.color = '';
    }
    setStatus('ok', nt.key + ' · solved · ' + hmOf(real.n) + ' overlap');
    renderAll(nt, real, derive);
    ['dlSeries', 'dlDiff', 'dlSigma', 'dlRun', 'dlJson'].forEach((id) => {
      if ($(id)) $(id).disabled = false;
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER — ans-design surfaces, hrvdex-chart canvases, hand-authored SVG
  // ═══════════════════════════════════════════════════════════════════════════
  const CARDS = ['cSeries', 'cSigma', 'cDiff', 'cRun', 'cTri'];
  /* ── TRUST BADGES (CLAUDE.md §🎫) — this page's grades and why. HR series take their node registries' grade
     (ECGDex/PpgDex/OxyDex `hr`/`meanHr`: measured). A difference, a correlation or an overlap is arithmetic on
     those series → measured. σ̂ and everything derived from the hat assume independent corner errors and are not
     validated against a reference here → experimental. A gate verdict is the suite's own rule → experimental. */
  const EV = {
    hrEcg: ['measured', 'heart rate direct from detected R-peaks (ECGDex registry `hr`)'],
    hrPpg: ['measured', 'heart rate direct from pulse-peak intervals (PpgDex registry `hr`)'],
    hrO2: ['measured', 'direct pulse reading (OxyDex registry `meanHr`)'],
    diff: ['measured', 'pairwise difference of two measured HR series on the aligned grid'],
    corr: ['measured', 'Pearson r of two measured HR series on the aligned grid'],
    count: ['measured', 'seconds on the aligned three-way grid — a count'],
    source: ['measured', 'which file each corner was read from — a fact about the inputs'],
    hat: ['experimental', 'three-cornered hat σ̂ — assumes independent corner errors; not validated against a reference'],
    gate: ['experimental', "the suite's own corner gates (Verity harmonic, H10 lead) — a rule, not a measurement"],
    rhoCrit: ['experimental', 'the error correlation at which a corner of this hat collapses to zero — a property of this solve, derived from the same unvalidated σ̂'],
    rhoSens: ['experimental', "how fast a corner's σ̂ moves per 0.01 of error correlation, at ρ = 0 — a derivative of the same unvalidated estimator"],
    rhoNeed: ['experimental', 'the precision to which ρ would have to be known to pin a corner σ̂ to ±0.1 bpm — a requirement, not a measurement of ρ'],
    rhoRef: [
      'measured',
      'error correlation measured against a two-detector consensus over ' +
        ((typeof window !== 'undefined' && window.TCH_REFERENCE_RECORD && window.TCH_REFERENCE_RECORD.claims.nightsScored + ' nights') || 'a population the record did not state') +
        ' (tools/tch-firmware-reference.mjs) — pooled, external to this night'
    ]
  };
  const evb = (k) => (window.MetricRegistry && window.MetricRegistry.badge ? window.MetricRegistry.badge(EV[k][0], EV[k][1]) : '');
  function corner(host, key) {
    if (!host) return;
    host.style.position = 'relative';
    let c = host.querySelector(':scope > .ev-corner');
    if (!c) {
      c = document.createElement('span');
      c.className = 'ev-corner';
      host.appendChild(c);
    }
    c.innerHTML = evb(key);
  }
  // a chart caption is not a badge site — the SERIES is (CLAUDE.md §🎫): one strip per figure, a badge before each series
  function seriesBadges(cardId, items) {
    const card = $(cardId);
    if (!card) return;
    let strip = card.querySelector('.ts-evser');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'ts-evser';
      const p = card.querySelector('p') || card.querySelector('h4');
      if (p && p.nextSibling) card.insertBefore(strip, p.nextSibling);
      else card.appendChild(strip);
    }
    strip.innerHTML = items.map((it) => '<span class="ts-evitem">' + evb(it[0]) + ' ' + it[1] + '</span>').join('');
  }
  function badgeAll() {
    for (const k of DKEYS) corner($('hero-' + k + '-val') && $('hero-' + k + '-val').parentElement, 'hat');
    corner($('kOverlap'), 'count');
    corner($('kMethod'), 'hat');
    corner($('kGate'), 'gate');
    corner($('kSource'), 'source');
    corner($('kSum'), 'hat');
    corner($('kR'), 'corr');
    seriesBadges('cSeries', [
      ['hrEcg', 'Polar H10 HR'],
      ['hrPpg', 'Verity Sense HR'],
      ['hrO2', 'O2Ring HR']
    ]);
    seriesBadges('cSigma', [['hat', 'σ̂ per corner, with its bootstrap CI']]);
    seriesBadges('cDiff', [
      ['diff', 'H10 − Verity'],
      ['diff', 'H10 − O2Ring'],
      ['diff', 'Verity − O2Ring']
    ]);
    seriesBadges('cRun', [['hat', 'running σ̂ per corner']]);
    seriesBadges('cTri', [
      ['corr', 'pairwise r (edges)'],
      ['hat', 'σ̂ (vertices)']
    ]);
  }
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
  /* ── WHAT THE REFERENCE SAYS ABOUT EACH HERO — COMPOSED FROM THE PUBLISHED RECORD, NEVER TYPED ──────
     `codegen/generated/tch-reference-record.js` (generated by tools/tch-reference-record.mjs from the record under
     analysis/published-numbers/) is inlined ahead of this file by tools/build-analysis.mjs. Every pooled
     figure below — the night count, the dates, the σ, the band counts, ρ — is read from it, because the
     numbers move with each run and a typed sentence outlives the run that justified it: that is defect 1
     of TCH-REFERENCE-POPULATIONS §2, where this card kept quoting a night count the reference had
     already outgrown — for three weeks, with every gate green. The record is the HOST axis, which is what this page computes (ECGDex and
     PpgDex already add DexClock.hostAxis correctionAt to the device counter).
     NO FALLBACK (CLAUDE.md §∅): with no record the note REFUSES and says so. A stale number that reads
     as current is worse than a visible absence. */
  const TCHREC = (typeof window !== 'undefined' && window.TCH_REFERENCE_RECORD) || null;
  const TCHAX = (TCHREC && TCHREC.axes && TCHREC.axes.host) || null;
  const TCHALL = (TCHAX && TCHAX.populations && TCHAX.populations.all) || null;
  const TCHSOLID = (TCHAX && TCHAX.populations && TCHAX.populations.solid) || null;
  const TCHMED = (TCHALL && TCHALL.result && TCHALL.result.medians) || null;
  const TCHCLAIMS = (TCHREC && TCHREC.claims) || null;
  const TCHFILE = TCHREC ? 'analysis/published-numbers/tch-firmware-reference-' + TCHREC.generated + '.json' : null;
  const DEVNAME = { h10: 'H10', verity: 'Verity', o2: 'O2Ring' };
  /* The pooled population, as the card must name it: a COUNT and the span of the nights it counted. */
  const tchPop = () => (TCHCLAIMS ? TCHCLAIMS.nightsScored + ' nights, ' + TCHCLAIMS.dateFirst + ' → ' + TCHCLAIMS.dateLast : null);
  const tchSolidPop = () =>
    TCHSOLID && TCHSOLID.population ? TCHSOLID.population.checked + ' of ' + TCHSOLID.population.listed + ' solid nights, ' + TCHSOLID.population.first + ' → ' + TCHSOLID.population.last : null;
  const tchBand = () => (TCHREC ? '±' + TCHREC.band.abs + ' bpm / ' + Math.round(TCHREC.band.rel * 100) + ' %' : null);
  /* TWO AXES, AND THE RECORD STATES ONE OF THEM. `axisCanonical` is the axis the CORNERS ride. The
     reference they are scored against has its own axis, and a record generated before the
     `--reference-axis` flag existed carries no `referenceAxisCanonical`. §∅ — an axis nobody wrote
     down is not the tool's default axis, so this returns null and the clause says so rather than
     printing a value the record never stated. */
  const tchRefAxis = () => (TCHREC && typeof TCHREC.referenceAxisCanonical === 'string' && TCHREC.referenceAxisCanonical ? TCHREC.referenceAxisCanonical : null);
  const TCH_REFUSED = 'reference note REFUSED — the published record did not load, so no pooled figure is shown';
  function validationLine(k) {
    const ib = TCHAX && TCHAX.inBand && TCHAX.inBand[k];
    const m = TCHMED && TCHMED[k];
    if (!ib || !m || !tchPop()) return TCH_REFUSED;
    /* "a measured σ" for the H10, "a true σ" for the optical corners: the reference is built from the
       H10's own detections, so its error is a LOWER BOUND the reference cannot see past (the sibling
       tool reports the H10 and never judges it). */
    return (
      ib.status +
      ' — the hat ' +
      ib.reads +
      ' the ' +
      DEVNAME[k] +
      ' (' +
      f2(m.classic) +
      ' vs ' +
      (k === 'h10' ? 'a measured ' : 'a true ') +
      f2(m.trueSd) +
      ' bpm), in band on ' +
      ib.pass +
      ' of ' +
      ib.of +
      ' nights within ' +
      tchBand() +
      ' · ' +
      tchPop()
    );
  }
  const tchChecked = (k) => !!(TCHAX && TCHAX.inBand && TCHAX.inBand[k] && TCHAX.inBand[k].status === 'reference-checked');
  /* THE POOLED NOTE UNDER THE HEROES. It names BOTH populations, which is defect 2 of §2: the heroes are
     ONE night and this note is the pooled corpus, and a card that names neither invites the reader to
     read one as the other. The rolling-30 window is deliberately absent — §5.4 keeps the trend on the
     board, never on the card, because a 30-night window moves with every night and reads as news. */
  function renderReferenceNote(nightKey) {
    const host = $('tsValNote');
    if (!host) return;
    if (!TCHALL || !TCHMED || !TCHAX.classic) {
      host.innerHTML = '<b>Checked against a reference: REFUSED.</b> ' + esc(TCH_REFUSED) + '. Nothing was examined here, so this is not a finding about the hat.';
      return;
    }
    const C = TCHAX.classic;
    const dir = (k) => (TCHAX.inBand[k] ? TCHAX.inBand[k].reads + ' the ' + DEVNAME[k] : null);
    /* EVERY interpolated value here comes from the published record, which reaches the page as
       generated, build-time-inlined data. It is data, so it goes through `esc` — the same escaper the
       night list uses — rather than being trusted because a tool wrote it (`tools/xss-sink-gate.mjs`). */
    host.innerHTML =
      '<b>Checked against a reference.</b> Over <b>' +
      esc(tchPop()) +
      '</b>, each device was compared with the beats two independent R-peak detectors agree on (ECGDex and the H10 firmware). ' +
      'The classic hat put <b>' +
      esc(C.pass) +
      ' of ' +
      esc(C.total) +
      '</b> judged optical night-corners inside ' +
      esc(tchBand()) +
      ' of the reference-measured σ, against the pre-stated ' +
      esc(Math.round(TCHREC.band.passFraction * 100)) +
      ' % rule — <b>' +
      esc(TCHALL.status) +
      '</b>. True per-second error: Verity ' +
      esc(f2(TCHMED.verity.trueSd)) +
      ' · O2Ring ' +
      esc(f2(TCHMED.o2.trueSd)) +
      ' bpm, with |bias| ≤ ' +
      esc(f2(TCHCLAIMS.maxAbsBias)) +
      ' bpm on every device. This hat assumes independent errors, but the two optical corners share part of theirs (ρ(V,O) ≈ ' +
      esc(f2(TCHMED.rho ? TCHMED.rho.vo : TCHALL.result.rho.vo)) +
      '), so it <b>' +
      esc([dir('verity'), dir('h10')].filter(Boolean).join(' and ')) +
      '</b>' +
      (tchChecked('o2') ? '; the O2Ring σ̂ is within band on ' + esc(TCHAX.inBand.o2.pass) + ' of ' + esc(TCHAX.inBand.o2.of) + ' nights' : '') +
      '. A correlated-error hat fed the reference ρ did not pass either (' +
      esc(TCHAX.correlated.pass) +
      ' of ' +
      esc(TCHAX.correlated.total) +
      ' in band, ' +
      esc(TCHAX.correlated.refused) +
      ' refused): near ρ ≈ σ<sub>Verity</sub>/σ<sub>O2Ring</sub> the two optical devices cannot be separated from pairwise differences. ' +
      'The solid-night stratum (' +
      esc(tchSolidPop() || 'no stratum in this record') +
      ') reads <b>' +
      esc(TCHSOLID ? TCHSOLID.status : '—') +
      '</b>, and it sits at the pre-stated minimum, so one night either way moves it. ' +
      '<b>Two populations, never mixed:</b> the σ̂ above are ONE night' +
      (nightKey ? ' (' + esc(nightKey) + ')' : '') +
      ', these are the pooled corpus. Source: <code>tools/tch-firmware-reference.mjs</code> · <code>' +
      esc(TCHFILE) +
      '</code> · axis <code>' +
      esc(TCHREC.axisCanonical) +
      '</code> · reference axis ' +
      (tchRefAxis()
        ? '<code>' + esc(tchRefAxis()) + '</code>'
        : '<b>not recorded</b> — this record does not state which timebase the reference itself rode, so whether the comparison is same-axis is unknown') +
      '.';
  }
  function hero(k, real, derive) {
    const v = $('hero-' + k + '-val'),
      u = $('hero-' + k + '-unit');
    if (!v) return;
    const s = real ? real.sigma[k] : null;
    v.textContent = f2(s);
    v.style.color = s == null ? FLAG : DEV[k].col;
    const ci = derive && derive.ci && derive.ci[k];
    if (u)
      u.textContent =
        s == null
          ? real && k === 'h10' && real.h10Unreliable
            ? 'nulled — ' + real.h10Fault
            : real
              ? 'negative variance — not a number'
              : 'bpm'
          : ci
            ? 'bpm · 95 % CI ' + f2(ci.lo) + ' – ' + f2(ci.hi)
            : 'bpm · CI unavailable';
    const note = $('hero-' + k + '-val') && $('hero-' + k + '-val').parentElement.querySelector('.ts-valid');
    if (note) {
      note.textContent = validationLine(k);
      note.classList.toggle('ts-unval', !tchChecked(k));
    }
  }
  function renderSkip(nt, real) {
    for (const k of DKEYS) hero(k, null, null);
    renderIndependence(null);
    $('heroNight').textContent = nt.key;
    renderReferenceNote(nt.key);
    kpi('kOverlap', '—', 'no three-way overlap solved', 'bad');
    kpi('kMethod', 'not solved', real.reason || 'no result', 'bad');
    kpi('kGate', real.failure ? 'Verity: ' + real.failure : '—', real.failure ? 'the Verity gate skipped the night' : '', real.failure ? 'warn' : '');
    kpi('kSource', '—', '');
    kpi('kSum', '—', '');
    kpi('kR', '—', '');
    for (const id of CARDS) setEmpty(id, 'This night could not be solved — ' + (real.reason || 'no result'), true);
    badgeAll();
  }
  /* ── INDEPENDENCE SENSITIVITY — what THIS night can and cannot say about correlated errors ────────
     The owner's question is "how much of the σ decomposition survives correlated-error assumptions".
     🔴 THE DIRECT ANSWER IS NOT THIS ROW. It is the pooled note above, and that note is COMPOSED FROM
     THE PUBLISHED RECORD (`codegen/generated/tch-reference-record.js`), so no count or σ is repeated here: measured against
     a two-detector consensus over the recorded population, the classic hat misses the pre-stated band
     fraction, under-reads the Verity and over-reads the H10, because the optical errors correlate. This row
     answers the adjacent, per-night question — how fast this night's decomposition would move if the
     errors were correlated, and how precisely ρ would have to be known for that to be pinned down.
     Both are stated, in that order, so the new row cannot be read as the answer to the question.

     WHAT IT DELIBERATELY DOES NOT DO:
     · It never prints "independent ✓". A negative variance — the standard "your independence assumption
       is broken" tell — requires ρ > σ₀_A/σ₀_B (derived and measured, PR #1824), so with near-equal error
       floors a real ρ of 0.3–0.5 produces NO negative at any N: every corner comes back positive, the
       trio looks clean, and the assumption is silently violated. A positive solve is not evidence of
       uncorrelated errors, and no amount of data makes it one. #3123 is that law in the wild — its pooled
       optical ρ sat BELOW the σ_V/σ_O onset, which is exactly why nothing went negative. (Deliberately
       no digits: that run's ρ is not this record's, and the figure a reader needs is the one the note
       renders from the record.)
     · It states no BAND around ρ_crit, because there is none to state. KNIFE-EDGE §2 asked for a margin
       and the measurement refused it: σ's sensitivity to ρ rises smoothly to the boundary with no regime
       change (dσ per 0.01 of ρ: −0.030 at distance 0.200, −0.183 at 0.010, −0.324 at 0.002). Where the
       regimes do not separate, publish the sensitivity, not a threshold.
     · It does not substitute the pooled ρ for this night's. This night's error correlation is NOT
       computable here — the ECGDex × firmware-RR reference lives in `tools/tch-firmware-reference.mjs`,
       not in the worker — so that slot REFUSES with the reason (CLAUDE.md §∅), never 0. Assuming ρ = 0 is
       precisely the assumption under test, so defaulting it would answer the question with itself.
       Residue `2026-09-26-tch-hat-misattributes-shared-optical-error` is where that moves into the
       worker; when it does, the measured ρ may be DISPLAYED here for identifiability and must NEVER be
       fed into the solve (KNIFE-EDGE §5, leave-one-out only). */
  /* The pooled optical ρ — read from the record, external to this night, and `null` when no record
     loaded rather than a remembered constant. The value moved when the population grew, which is the
     whole reason no pooled figure may be typed into this file (no digits here, by design). */
  const RHO_REF = TCHMED && TCHMED.rho && Number.isFinite(TCHMED.rho.vo) ? TCHMED.rho.vo : TCHALL && TCHALL.result && TCHALL.result.rho ? TCHALL.result.rho.vo : null;
  function renderIndependence(real) {
    const host = $('tsIndep');
    if (!host) return;
    const S = window.AnalysisStats;
    const pv = real && real.pairVars;
    const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
    const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
    if (!S || typeof S.tchRhoCrit !== 'function') {
      host.innerHTML =
        '<b>Independence sensitivity: NOT COMPUTED.</b> The shared statistics kernel (<code>AnalysisStats.tchRhoCrit</code>) did not load, so nothing was examined — this is not a finding about the night. ' +
        evb('rhoCrit');
      return;
    }
    if (!pv || !Number.isFinite(pv.hv) || !Number.isFinite(pv.ho) || !Number.isFinite(pv.vo)) {
      host.innerHTML =
        '<b>Independence sensitivity: REFUSED.</b> This night carries no pairwise difference variances, so the collapse point cannot be located. No value is shown in their place. ' + evb('rhoCrit');
      return;
    }
    /* Corner mapping is load-bearing: the worker solves `threeCorneredHat(vHV, vHO, vVO)` with A = H10,
       B = Verity, C = O2Ring, so ab = H10·Verity, ac = H10·O2Ring, bc = Verity·O2Ring. The operating
       point is ρ = 0 on every pair because that IS the hat's assumption — ρ_crit is then "how much
       shared error this night's variances would tolerate before a corner collapses to zero". */
    const PAIR = { ab: 'H10 · Verity', ac: 'H10 · O2Ring', bc: 'Verity · O2Ring' };
    const r = S.tchRhoCrit(pv.hv, pv.ho, pv.vo, { ab: 0, ac: 0, bc: 0 });
    const parts = [];
    for (const k of ['ab', 'ac', 'bc']) {
      const d = r && r.pairs && r.pairs[k];
      if (!d) {
        parts.push(PAIR[k] + ' — no collapse in range');
        continue;
      }
      const up = d.up ? 'ρ ≥ ' + f2(d.up.at) : null;
      const dn = d.down ? 'ρ ≤ ' + f2(d.down.at) : null;
      parts.push(PAIR[k] + ' — ' + [up, dn].filter(Boolean).join(' or '));
    }
    const n = r && r.nearest;
    const sens = n && Number.isFinite(n.sigmaPerRho) ? f3(Math.abs(n.sigmaPerRho)) + ' bpm per 0.01 of ρ' : 'not computable';
    const need = n && Number.isFinite(n.rhoFor0p1) ? '± ' + f3(n.rhoFor0p1) : 'not computable';
    host.innerHTML =
      '<b>Independence sensitivity — this night.</b> The hat above assumes the three corners\u2019 errors are uncorrelated. ' +
      'A corner of THIS night\u2019s solve reaches zero at: ' +
      parts.join(' · ') +
      '. ' +
      evb('rhoCrit') +
      (n ? ' Nearest is <b>' + PAIR[n.pair] + '</b>, ' + f2(n.margin) + ' of correlation away; there the σ̂ moves <b>' + sens + '</b>. ' + evb('rhoSens') : '') +
      (n ? ' To pin that corner\u2019s σ̂ to ±0.1 bpm, ρ would have to be known to <b>' + need + '</b> — a requirement, not a measurement. ' + evb('rhoNeed') : '') +
      ' <b>This night\u2019s own ρ: REFUSED</b> — the firmware-RR reference is not computed in this page, so it is not substituted with 0; assuming independence is the assumption under test ' +
      '(residue <code>2026-09-26-tch-hat-misattributes-shared-optical-error</code>). ' +
      (Number.isFinite(RHO_REF) ? 'Pooled, external, NOT this night: ρ ≈ ' + f2(RHO_REF) + ' optical over ' + tchPop() + '. ' : 'Pooled, external ρ: REFUSED — the published record did not load. ') +
      evb('rhoRef') +
      ' <b>No "independent ✓" is shown here, and none is available:</b> a negative variance needs ρ > σ₀_A/σ₀_B, so a positive solve is not evidence of uncorrelated errors at any n. ' +
      'No band around the collapse point is given either — sensitivity rises smoothly to it, with no regime to threshold on.';
  }
  function renderAll(nt, real, derive) {
    $('heroNight').textContent = nt.key;
    renderReferenceNote(nt.key);
    for (const k of DKEYS) hero(k, real, derive);
    renderIndependence(real);
    kpi('kOverlap', hmOf(real.n), real.n + ' s on the aligned 1 Hz grid', 'good');
    /* D7 option A (owner's pick 2026-10-12): the worker's point is the UNWEIGHTED hat (tchSigmas), and so
       is every CI replicate and running prefix (DEEP-AUDIT-VI F16: the CI's estimator follows the point's),
       so the label names the estimator that actually produced the numbers. The retired fused-weight hat
       rides along as `real.fusedDiag` and is shown as a DIAGNOSTIC in the sub-line — same three corners,
       weighted by DSP confidence × consensus trust, never the published σ. `estimator` is the worker's own
       machine field, read here rather than assumed, so the label cannot outlive a re-point. */
    const fd = real.fusedDiag;
    const fdTxt = fd ? DKEYS.map((k) => DEV[k].name.split(' ')[0] + ' ' + (fd[k] == null ? 'neg' : f2(fd[k]))).join(' · ') : 'no DSP confidence on this night';
    kpi(
      'kMethod',
      real.neg ? 'negative variance' : real.estimator === 'classic' ? 'unweighted hat' : String(real.estimator),
      (real.neg ? 'a corner is null — see the literature note' : 'equal-weight σ̂ over the three corners') + ' · retired fused diagnostic: ' + fdTxt,
      real.neg ? 'warn' : 'good'
    );
    kpi('kGate', real.h10Unreliable ? 'H10 nulled' : 'both gates ok', real.h10Unreliable ? real.h10Fault : 'Verity harmonic gate · H10 lead gate', real.h10Unreliable ? 'bad' : 'good');
    // every corner's source, because a σ̂ is only comparable across nights that read the same inputs
    const short = (x) =>
      x
        ? String(x)
            .replace(/^ring·/, '')
            .replace(/·.*$/, '')
        : '—';
    kpi(
      'kSource',
      short(real.h10Source) + ' · ' + short(real.source) + ' · ' + short(real.o2Source),
      'H10 ' + (real.h10Source || '—') + ' · Verity ' + (real.source || '—') + ' · O2Ring ' + (real.o2Source || '—'),
      ''
    );
    const o2k = {
      'ring·156-markers': ['finger pleth · 156 beat markers', "the ring firmware's own per-beat markers in its raw pleth → PPI → per-second HR"],
      ring·PPGDSP: ['finger pleth · PPGDSP feet', 'pulse feet detected in the raw pleth by PPGDSP → PPI → per-second HR']
    }[real.o2Source] || ['finger pulse · 1 Hz native', 'direct pulse reading (OxyDex registry `meanHr`)'];
    DEV.o2.kind = o2k[0];
    EV.hrO2 = ['measured', o2k[1]];
    let ss = 0,
      solved = 0;
    for (const k of DKEYS)
      if (real.sigma[k] != null) {
        ss += real.sigma[k] * real.sigma[k];
        solved++;
      }
    kpi('kSum', f2(ss) + ' bpm²', 'Σσ² over ' + solved + ' solved corner' + (solved === 1 ? '' : 's'), '');
    kpi('kR', PAIRS.map((p) => f2(real['r' + p.key.toUpperCase()])).join(' · '), 'r HV · HO · VO', PAIRS.some((p) => (real['r' + p.key.toUpperCase()] ?? 1) < 0.5) ? 'warn' : '');
    const conf = derive && derive.conf;
    const ce = $('kConf');
    if (ce) ce.textContent = conf ? DKEYS.map((k) => DEV[k].name.split(' ')[0] + ' ' + f2(conf[k])).join(' · ') : '—';
    drawSeries(real, derive);
    drawSigma(real, derive);
    drawDiffs(real, derive);
    drawRunning(real, derive);
    drawTriangle(real);
    for (const id of CARDS) fillCard(id);
    badgeAll();
  }
  // ── the house Chart wrapper (mirrors HRVDex's mkChart; engine = hrvdex-chart.js) ───────────
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
  // FIGURE 1 — the three corners over the night (per-minute bins from the worker; a bin with no
  // overlap is null, which the engine draws as a gap, not a bridge)
  function drawSeries(real, derive) {
    const m = derive && derive.minute;
    if (!m || !m.sec || !m.sec.length) {
      setEmpty('cSeries', 'no per-minute series returned by the worker', true);
      return;
    }
    const labels = m.sec.map(utcHM);
    mkChart(
      'ch_series',
      labels,
      DKEYS.map((k) => ({ label: DEV[k].name + ' · ' + DEV[k].kind, data: m[k], borderColor: DEV[k].col, borderWidth: 1.5, pointRadius: 0, fill: false })),
      { maxTicks: 9, yAxis: { title: { display: true, text: 'HR (bpm)' } } }
    );
    const sub = $('sSeries');
    if (sub) sub.textContent = utcHM(m.sec[0]) + ' – ' + utcHM(m.sec[m.sec.length - 1]) + ' floating wall-clock · ' + m.sec.length + ' one-minute bins · ' + real.n + ' aligned seconds';
  }
  // FIGURE 2 — the three pairwise differences the hat decomposes
  function drawDiffs(real, derive) {
    const m = derive && derive.minute;
    if (!m || !m.sec || !m.sec.length) {
      setEmpty('cDiff', 'no per-minute series returned by the worker', true);
      return;
    }
    let Y = 0;
    for (const p of PAIRS) for (const v of m[p.key]) if (v != null && Math.abs(v) > Y) Y = Math.abs(v);
    Y = Math.max(3, Math.ceil(Y * 1.1));
    const sd = derive.pairSd || {};
    mkChart(
      'ch_diff',
      m.sec.map(utcHM),
      PAIRS.map((p) => ({
        label: p.label + ' · sd ' + f2(sd[p.key]) + ' bpm',
        data: m[p.key],
        borderColor: DEV[p.b].col,
        borderWidth: 1.2,
        pointRadius: 0,
        fill: false
      })),
      { maxTicks: 9, yAxis: { min: -Y, max: Y, title: { display: true, text: 'difference (bpm)' } } }
    );
  }
  // FIGURE 4 — running σ̂ over cumulative overlap; a null prefix is a gap
  function drawRunning(real, derive) {
    const run = (derive && derive.running) || [];
    if (!run.length) {
      setEmpty('cRun', 'no running hat returned by the worker', true);
      return;
    }
    mkChart(
      'ch_running',
      run.map((r) => Math.round(r.n / 60) + ' min'),
      DKEYS.map((k) => ({ label: DEV[k].name, data: run.map((r) => (r[k] == null ? null : r[k])), borderColor: DEV[k].col, borderWidth: 1.6, pointRadius: 0, fill: false })),
      { maxTicks: 8, yAxis: { min: 0, title: { display: true, text: 'σ̂ (bpm)' } } }
    );
  }
  // ── SVG helpers (the house norm for non-time-series figures) ──────────────────────────────
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
  // FIGURE 3 — σ̂ ± 95 % CI per corner, with the corpus median and the literature σ-equivalent as
  // labelled marks. Reference marks are context; a gated corner is drawn as an absence.
  function drawSigma(real, derive) {
    const host = $('svg_sigma');
    if (!host) return;
    // viewBox sized to the 2fr column it lives in (~440 px at 1440), so 11 px labels render at ~11 px —
    // a wider box scales the whole figure down and the marks become unreadable
    const W = 440,
      L = 100,
      R = 22,
      T = 26,
      rowH = 66,
      H = T + rowH * DKEYS.length + 34;
    let max = 1;
    for (const k of DKEYS) {
      if (real.sigma[k] != null) max = Math.max(max, real.sigma[k]);
      const ci = derive && derive.ci && derive.ci[k];
      if (ci) max = Math.max(max, ci.hi);
      max = Math.max(max, CORPUS[k], LIT[k].sigma || 0);
    }
    max = Math.ceil(max * 1.15 * 2) / 2;
    const x = (v) => L + (v / max) * (W - L - R);
    let s = '';
    for (const t of niceTicks(max, 5)) {
      s += svgEl('line', { x1: x(t), x2: x(t), y1: T, y2: H - 30, stroke: GRIDC, 'stroke-width': 1 });
      s += svgEl('text', { x: x(t), y: H - 12, fill: MUT, 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, t.toFixed(1));
    }
    s += svgEl('text', { x: x(max), y: H - 12, fill: DIM, 'font-size': 9, 'text-anchor': 'end', 'font-family': 'ui-monospace,monospace', dy: 12 }, 'σ (bpm)');
    DKEYS.forEach((k, i) => {
      const cy = T + rowH * i + rowH / 2,
        d = DEV[k];
      s += svgEl('text', { x: 8, y: cy - 4, fill: d.col, 'font-size': 11, 'font-weight': 700, 'font-family': 'inherit' }, d.name);
      s += svgEl('text', { x: 8, y: cy + 11, fill: MUT, 'font-size': 10, 'font-family': 'inherit' }, d.kind);
      // corpus median — dashed vertical mark
      s += svgEl('line', { x1: x(CORPUS[k]), x2: x(CORPUS[k]), y1: cy - 18, y2: cy + 18, stroke: '#aab8cc', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' });
      // reference tags stack BELOW the row (corpus, then literature) so neither collides with the value label above the dot
      s += svgEl('text', { x: x(CORPUS[k]), y: cy + 27, fill: MUT, 'font-size': 9, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, 'corpus ' + CORPUS[k].toFixed(2));
      // literature σ-equivalent — hollow diamond, only where a published MAE exists
      if (LIT[k].sigma != null) {
        const lx = x(LIT[k].sigma);
        s += svgEl('path', { d: 'M' + lx + ' ' + (cy - 7) + ' l7 7 l-7 7 l-7 -7 z', fill: 'none', stroke: '#e6edf6', 'stroke-width': 1.5 });
        s += svgEl('text', { x: lx, y: cy + 38, fill: MUT, 'font-size': 9, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, 'literature σ≈' + LIT[k].sigma.toFixed(2));
      }
      const sig = real.sigma[k];
      if (sig == null) {
        s += svgEl('text', { x: x(max / 2), y: cy + 5, fill: FLAG, 'font-size': 16, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, '—');
        s += svgEl('text', { x: x(max / 2) + 16, y: cy + 4, fill: FLAG, 'font-size': 10, 'font-family': 'inherit' }, k === 'h10' && real.h10Unreliable ? real.h10Fault : 'negative variance');
        return;
      }
      const ci = derive && derive.ci && derive.ci[k];
      if (ci) {
        s += svgEl('rect', { x: x(ci.lo), y: cy - 5, width: Math.max(1, x(ci.hi) - x(ci.lo)), height: 10, rx: 5, fill: rgba(k, 0.28) });
        s += svgEl('line', { x1: x(ci.lo), x2: x(ci.lo), y1: cy - 9, y2: cy + 9, stroke: d.col, 'stroke-width': 1.5 });
        s += svgEl('line', { x1: x(ci.hi), x2: x(ci.hi), y1: cy - 9, y2: cy + 9, stroke: d.col, 'stroke-width': 1.5 });
      }
      s += svgEl('circle', { cx: x(sig), cy: cy, r: 6.5, fill: d.col, stroke: '#0b0f14', 'stroke-width': 2 });
      s += svgEl(
        'text',
        { x: x(sig), y: cy - 12, fill: '#e6edf6', 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' },
        f2(sig) + (ci ? ' [' + f2(ci.lo) + '–' + f2(ci.hi) + ']' : '')
      );
    });
    host.innerHTML = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'per-corner sigma with confidence interval, corpus median and literature marks' }, s);
  }
  // CORRELATION TRIANGLE — r on each edge; width follows |r|; a null r is a dashed grey edge
  function drawTriangle(real) {
    const host = $('svg_tri');
    if (!host) return;
    const W = 460,
      H = 270,
      cx = W / 2,
      cy = H / 2 + 18,
      Rr = 96;
    const pos = { h10: [cx, cy - Rr], verity: [cx - Rr * 0.98, cy + Rr * 0.62], o2: [cx + Rr * 0.98, cy + Rr * 0.62] };
    let s = '';
    for (const p of PAIRS) {
      const r = real['r' + p.key.toUpperCase()],
        a = pos[p.a],
        b = pos[p.b];
      s += svgEl('line', {
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        stroke: r == null ? MUT : 'rgba(230,237,246,.55)',
        'stroke-width': r == null ? 1 : 1 + 5 * Math.abs(r),
        'stroke-dasharray': r == null ? '5 5' : '0'
      });
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2;
      s += svgEl('rect', { x: mx - 30, y: my - 10, width: 60, height: 18, rx: 9, fill: '#0f141b' });
      s += svgEl(
        'text',
        { x: mx, y: my + 4, fill: r == null ? FLAG : r < 0.5 ? '#FFB84D' : '#e6edf6', 'font-size': 11, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' },
        'r ' + f2(r)
      );
    }
    for (const k of DKEYS) {
      const p = pos[k];
      s += svgEl('circle', { cx: p[0], cy: p[1], r: 23, fill: DEV[k].col }); // r ≥ half of "O2Ring" at 10 px mono, so the label stays inside
      s += svgEl('text', { x: p[0], y: p[1] + 4, fill: '#0b0f14', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, DEV[k].name.split(' ')[0]);
      s += svgEl('text', { x: p[0], y: p[1] + (k === 'h10' ? -26 : 36), fill: MUT, 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'ui-monospace,monospace' }, 'σ̂ ' + f2(real.sigma[k]));
    }
    host.innerHTML = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'pairwise correlation triangle' }, s);
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
  const stamp = () => 'sensor-trio-night-' + (RESULT.night || 'night');
  function dlCanvas(id, tag) {
    const c = $(id);
    if (!c || !RESULT.real || RESULT.real.skip) return;
    c.toBlob((b) => b && dl(stamp() + '-' + tag + '.png', b));
  }
  function dlSvg(hostId, tag) {
    const h = $(hostId);
    if (!h || !h.innerHTML) return;
    dl(stamp() + '-' + tag + '.svg', new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + h.innerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }));
  }
  function exportJson() {
    if (!RESULT.real) return;
    const real = RESULT.real,
      dv = RESULT.derive;
    const out = {
      tool: 'sensor-trio-night',
      night: RESULT.night,
      skip: !!real.skip,
      reason: real.skip ? real.reason || null : null,
      n: real.n == null ? null : real.n,
      source: real.source || null,
      sigma: real.sigma || null,
      ci: dv ? dv.ci : null,
      neg: real.neg == null ? null : real.neg,
      h10Unreliable: !!real.h10Unreliable,
      h10Fault: real.h10Fault || null,
      rHV: real.rHV == null ? null : real.rHV,
      rHO: real.rHO == null ? null : real.rHO,
      rVO: real.rVO == null ? null : real.rVO,
      pairSd: dv ? dv.pairSd : null,
      conf: dv ? dv.conf : null,
      running: dv ? dv.running : null,
      reference: { corpusMedianRhoOn: CORPUS, literatureSigmaEquiv: { verity: LIT.verity.sigma }, note: 'validation references, not inputs (LITERATURE-USE-POLICY §2)' }
    };
    dl(stamp() + '.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  }
  // ── wiring ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const onPick = (e) => {
      const list = e.target.files;
      if (list && list.length) void ingestFiles(list);
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
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) void ingestFiles(e.dataTransfer.files);
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
        if (RUNNING) return; // the monitor presses this once the button enables; a run already in flight is the answer
        const nt = SELECTED && NIGHTS[SELECTED];
        if (!nt || !eligible(nt)) {
          setStatus('idle', 'pick an eligible night first');
          return;
        }
        solve(nt);
      });
    const bind = (id, fn) => {
      if ($(id)) $(id).addEventListener('click', fn);
    };
    bind('dlSeries', () => dlCanvas('ch_series', 'series'));
    bind('dlDiff', () => dlCanvas('ch_diff', 'diffs'));
    bind('dlRun', () => dlCanvas('ch_running', 'running'));
    bind('dlSigma', () => dlSvg('svg_sigma', 'sigma'));
    bind('dlJson', exportJson);
    setStatus('idle', 'waiting for a night');
  });
})();
