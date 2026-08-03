/*
 * clock.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * THE Clock Contract parser — single-sourced (A5, owner-ratified 2026-07-03;
 * OWN-THE-BUILD-FOLLOWUPS-2026-07-03-BRIEF §3). Extracted VERBATIM from the canonical
 * per-node mirror (the byte-identical block pulsedex/ecgdex/integrator carried; hrvdex's
 * commented copy; oxydex's was the same minus the unused _ckP2). The owned bundler inlines
 * this ONE file into every bundle, so it stays bundled-local AND single-source — the
 * copy-paste mirror + its drift risk are retired.
 *
 * Contract (CLAUDE.md §🔒): floating wall-clock tMs via Date.UTC on components-as-written;
 * zoned ISO authoritative; explicit vendor regexes (never locale Date.parse); DMY/MDY §3;
 * time-only rows anchor+roll; NEVER fabricate now() — miss ⇒ null.
 *
 * Adopters delegate via local aliases (var parseTimestamp = DexClock.parseTimestamp; …)
 * inside their IIFE — public surfaces (ECGDSP.parseTimestamp, bare re-export tails) are
 * unchanged. NODE-LOCAL VARIANTS THAT STAY (deliberate, do not force onto DexClock):
 * ppgdex-dsp.js (strict ISO/epoch subset + quote-stripping), glucodex-dsp.js (_ckParse +
 * numeric-returning MDY wrapper), cpapdex-dsp.js (EDF-subset). Load clock.js BEFORE any
 * delegating *-dsp.js (dex-coload.js enforces host membership).
 */
(function (root) {
  'use strict';

  function tzOffset(instantMs) {
    return new Date(instantMs).getTimezoneOffset() * 60000;
  }
  function _ckP2(n) {
    return n < 10 ? '0' + n : '' + n;
  }
  function _ckNumEpoch(n) {
    if (!isFinite(n)) return null;
    if (n < 1e11) n = n * 1000; // 10-digit (or smaller) → seconds → ms
    if (n < 1e11 || n > 4e12) return null; // implausible epoch range
    var off = tzOffset(n);
    return { tMs: n - off, offsetMin: -off / 60000 };
  }
  function _ckZoneMin(z) {
    var zs = z.replace(':', '');
    var sign = zs[0] === '-' ? -1 : 1;
    return sign * (parseInt(zs.slice(1, 3), 10) * 60 + parseInt(zs.slice(3, 5), 10));
  }
  /* Contract §3 — decide day vs month from the first two slash fields.
   `locked` (from resolveDMY) means the ORDER WAS PROVEN FOR THIS FILE: apply it unconditionally, so a
   single row can no longer flip the order mid-file. A row the lock cannot explain (its month field lands
   outside 1..12) is a contradiction, and a contradiction is null — never a guess.
   Unlocked (no pre-scan) keeps the historical per-call behavior for back-compat. */
  function _ckDMY(a, b, preferDMY, locked) {
    if (locked) {
      var ld = preferDMY ? a : b,
        lmo = preferDMY ? b : a;
      return lmo >= 1 && lmo <= 12 && ld >= 1 && ld <= 31 ? { d: ld, mo: lmo } : null;
    }
    if (a > 12) return { d: a, mo: b };
    if (b > 12) return { d: b, mo: a };
    return preferDMY ? { d: a, mo: b } : { d: b, mo: a };
  }

  /* Contract §3, the FILE-LEVEL lock: "Any row with day-component > 12 ⇒ file is unambiguous; lock that
   order for the whole file … Never switch order mid-file."  Scan every stamp ONCE up front:
     a row whose 1st slash field > 12 PROVES DMY · a row whose 2nd field > 12 PROVES MDY.
   Both proofs present ⇒ the file contradicts itself ⇒ refuse (contradictory:true) rather than guess.
   Neither ⇒ genuinely ambiguous ⇒ fall back to the caller's preferDMY, unlocked.
   Pass the result into parseTimestamp as { preferDMY: r.dmy, dmyLocked: r.locked }.
   Only the two ambiguous vendor shapes are scanned (4a "HH:MM:SS D/M/Y" and 4c "D/M/Y HH:MM"); ISO and
   YYYY/MM/DD carry no ambiguity. */
  function resolveDMY(rawStamps, preferDMY) {
    var pref = preferDMY !== false,
      sawDMY = false,
      sawMDY = false;
    var RE_A = /^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/; // 4a — O2Ring
    var RE_C = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/; // 4c — Welltory etc.
    var list = rawStamps || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (typeof s !== 'string') continue;
      s = s.trim().replace(/^["']|["']$/g, '');
      var a = null,
        b = null;
      var mA = s.match(RE_A);
      var mC = mA ? null : s.match(RE_C);
      if (mA) {
        a = +mA[4];
        b = +mA[5];
      } else if (mC) {
        a = +mC[1];
        b = +mC[2];
      } else continue;
      if (a > 12) sawDMY = true;
      if (b > 12) sawMDY = true;
      if (sawDMY && sawMDY) break; // contradiction proven — no need to scan further
    }
    if (sawDMY && sawMDY) return { dmy: pref, locked: false, contradictory: true };
    if (sawDMY) return { dmy: true, locked: true, contradictory: false };
    if (sawMDY) return { dmy: false, locked: true, contradictory: false };
    return { dmy: pref, locked: false, contradictory: false };
  }

  // DEEP-AUDIT-II §12.3 — Clock Contract amendment. Date.UTC SILENTLY ROLLS out-of-range components
  // (month 13 → next January, day 45 → next month, 25:99 → +1 day 1 h 39 m), so a corrupt stamp used to
  // land on a plausible WRONG instant instead of an honest null. `_ckMk` builds the floating tMs ONLY if
  // every component is in range: the date must round-trip (rejects month>12, day>31, Feb 30, Apr 31…) and
  // the time must be 0–23 : 0–59 : 0–59 . 0–999. The ONE legitimate overflow is ISO-8601 `24:00:00`
  // (end-of-day) — normalized to next-day 00:00, NOT rejected (do not add a bare `h>23` guard). Returns
  // a number, or null on any out-of-range component (Clock §2.6 — a bad stamp is visible, never fabricated).
  // §1.2 — a backwards step smaller than this is DISORDER (duplicate/jittered row), not a midnight
  // wrap; a genuine wrap is ~23 h backwards. See the roll site in step 5 for why 1 s is not enough.
  var CK_ROLL_SLACK_MS = 43200000; // 12 h
  function _ckMk(y, mo0, d, h, mi, se, ms) {
    se = se || 0;
    ms = ms || 0;
    var day0 = Date.UTC(y, mo0, d),
      dd = new Date(day0);
    if (dd.getUTCFullYear() !== y || dd.getUTCMonth() !== mo0 || dd.getUTCDate() !== d) return null; // date rolled ⇒ invalid
    if (h === 24 && mi === 0 && se === 0 && ms === 0) return day0 + 86400000; // ISO end-of-day → next 00:00:00
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59 || ms < 0 || ms > 999) return null;
    return Date.UTC(y, mo0, d, h, mi, se, ms);
  }

  function parseTimestamp(raw, opts) {
    opts = opts || {};
    var preferDMY = opts.preferDMY !== false; // default true (O2Ring/Welltory exports are DMY)
    var dmyLocked = opts.dmyLocked === true; // set by resolveDMY — the order is proven for this file
    /* §1.1 — THE FILE CONTRADICTS ITSELF. `resolveDMY` detects this and returns `contradictory:true`,
       and the doc-comment above has always said "refuse rather than guess" — but the flag was computed
       and thrown away by every caller, so the file silently fell back to the caller's PREFERENCE. One
       anomalous row moved a proven-MDY O2Ring night 2026-06-12 → 2026-12-06, with the date, t0Ms,
       exportName(), the crossnight axis and the Integrator's date join all confidently wrong.
       We refuse the ROW, not the FILE: only the two AMBIGUOUS slash shapes (4a/4c) return null, because
       only they depend on the unresolvable order. An ISO, epoch, 14-digit or time-only stamp in the same
       file is not ambiguous and still parses. Punishing unambiguous rows for their neighbours' sins
       would be its own kind of dishonesty. */
    var dmyContradictory = opts.dmyContradictory === true;
    var anchor = opts.dateAnchorMs != null && isFinite(opts.dateAnchorMs) ? opts.dateAnchorMs : null;
    if (raw == null) return null;
    if (typeof raw === 'number') return _ckNumEpoch(raw);
    var s = String(raw)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!s) return null;
    var m;
    // 1. all-digits epoch (ms or s) — but not a 14-digit YYYYMMDDHHMMSS run (step 4b)
    if (/^\d{10,13}$/.test(s)) return _ckNumEpoch(parseInt(s, 10));
    // 2. ISO-8601 WITH explicit zone (Z or ±HH:MM): zone authoritative, re-express as local wall clock
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})$/);
    if (m) {
      var off = m[8] === 'Z' ? 0 : _ckZoneMin(m[8]);
      var _tz = _ckMk(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? +(m[7] + '00').slice(0, 3) : 0);
      return _tz == null ? null : { tMs: _tz, offsetMin: off };
    }
    // 3. ISO / "YYYY-MM-DD[ T]HH:MM[:SS][.sss]" NO zone → components verbatim (ms preserved)
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/);
    if (m) {
      var _ti = _ckMk(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? +(m[7] + '00').slice(0, 3) : 0);
      return _ti == null ? null : { tMs: _ti, offsetMin: null };
    }
    // 4a. "HH:MM:SS DD/MM/YYYY" | "HH:MM:SS MM/DD/YYYY" (O2Ring)
    m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      if (dmyContradictory) return null; // §1.1 — the file's day/month order is unresolvable; this SHAPE cannot be read
      var dm = _ckDMY(+m[4], +m[5], preferDMY, dmyLocked);
      if (!dm) return null; // row contradicts the file's proven order → honest null
      var _to = _ckMk(+m[6], dm.mo - 1, dm.d, +m[1], +m[2], +m[3]);
      return _to == null ? null : { tMs: _to, offsetMin: null };
    }
    // 4b. compact "YYYYMMDDHHMMSS" (14-digit, O2Ring filename embed)
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (m) {
      var _tc = _ckMk(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      return _tc == null ? null : { tMs: _tc, offsetMin: null };
    }
    // 4c. "DD/MM/YYYY HH:MM[:SS]" | "MM/DD/YYYY HH:MM[:SS]" (Welltory etc.)
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      if (dmyContradictory) return null; // §1.1 — the file's day/month order is unresolvable; this SHAPE cannot be read
      var dm2 = _ckDMY(+m[1], +m[2], preferDMY, dmyLocked);
      if (!dm2) return null; // row contradicts the file's proven order → honest null
      var _tw = _ckMk(+m[3], dm2.mo - 1, dm2.d, +m[4], +m[5], m[6] ? +m[6] : 0);
      return _tw == null ? null : { tMs: _tw, offsetMin: null };
    }
    // 4d. "YYYY/MM/DD HH:MM[:SS]"
    m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      var _ty = _ckMk(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
      return _ty == null ? null : { tMs: _ty, offsetMin: null };
    }
    // 5. Time-only "HH:MM[:SS]" → combine with dateAnchorMs, monotonic roll-forward
    m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      if (anchor == null) return null; // never fabricate Jan-1-2000
      var d0 = new Date(anchor);
      var t = _ckMk(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), +m[1], +m[2], m[3] ? +m[3] : 0);
      if (t == null) return null; // §12.3 — an out-of-range time-only stamp (e.g. 25:99) → honest null
      if (opts.prevTMs != null && isFinite(opts.prevTMs)) {
        /* MIDNIGHT ROLL NEEDS REAL SLACK (DEEP-AUDIT-III §1.2). A bare `t < prevTMs` treats ANY
           backwards step as a midnight wrap, so ONE duplicated row turned a 120-minute night into a
           claimed 1560 minutes and collapsed SBII 13× — while start/end still read correctly and
           `clockNonMonotonic` stayed false, because OxyDex's guard only catches a NEGATIVE span.
           The two in-repo siblings (`oxydex-fusion.js:42`, `cpapdex-coimport.js:49`) use a 1-second
           tolerance, and the audit's own fix sketch proposed the same — but executing it disproved
           it: with −1 s only a 1-second blip is absorbed, and 2 s, 5 s, 60 s and 3600 s all still
           rolled a whole day. A real wrap is ~23 h backwards. The threshold therefore has to be a
           FRACTION OF A DAY, not a jitter allowance: roll only when the step back is larger than any
           plausible clock disorder within one recording. 12 h is the natural split — it is the
           largest backwards step that cannot be a wrap (a wrap is ≥ ~23 h) and the smallest that no
           duplicated/jittered row can reach. */
        while (t < opts.prevTMs - CK_ROLL_SLACK_MS) t += 86400000;
      }
      return { tMs: t, offsetMin: null };
    }
    // 6. Fallback — NEVER now(). A missing stamp stays visible (null).
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  //  HOST-DISCIPLINED TIME AXIS — hostAxis()      (WEARABLE-HOST-AXIS-2026-08-02-BRIEF)
  // ══════════════════════════════════════════════════════════════════════════════════════
  //  Every Polar-Sensor-Logger / capture-host stream carries TWO clocks on EVERY row:
  //      col 0  "Phone timestamp"        — the capture HOST (vigil box: chrony local-stratum-1, 0.008 ppm)
  //      col 1  "sensor timestamp [ns]"  — the DEVICE's own crystal
  //  The nodes historically read the host stamp ONCE (to anchor t0Ms) and then rode the DEVICE
  //  crystal for the rest of the night — ppgdex `relSec = ns/1e9`, ecgdex `t0 + i/fs` with fs from
  //  the device's own ms column. That puts an uncorrected crystal on the EXPORTED axis while a
  //  disciplined clock sat unused in column 0 of every row.
  //
  //  Measured on 2026-07-26 by deciles of (host − device), with NO fitting of any kind:
  //      H10 ECG       −0.70 s over 434 min   −27 ppm, smooth
  //      Verity PPG    −0.34 s over 189 min   −30 ppm, smooth
  //      O2Ring PPG   −18.49 s over 190 min   NON-LINEAR — −3035 ppm decaying to −1622 ppm
  //  A counter reset was ruled out first (it would fake any global slope): the O2Ring ramp is
  //  smooth, so it is a genuine rate error — and because it is non-linear, NO single ppm and no
  //  linear fit describes it. That is why this interpolates a measured curve instead of fitting.
  //
  //  TWO properties of the correction, neither optional:
  //    • SLOW.   Its own slope is ~30 ppm (30 µs per second), so RR/PPI intervals keep the device's
  //      fine structure. The crystal is excellent at short scales; only its RATE is wrong. Correcting
  //      the rate must not disturb the intervals HRV is computed from.
  //    • ROBUST. Host stamps carry BLE delivery jitter (~0.1 s here — visible as the Verity's
  //      −0.15/−0.08/−0.26 wobble). Interpolating RAW anchors would inject that jitter straight into
  //      beat times, which for HRV is worse than the drift it fixes. A running median rejects it.
  //
  //  NO SPAN GATE HERE — and that is deliberate, because the sibling tool needed one. A ppm QUOTED
  //  from a short fragment is unreliable (dual-clock-rate.mjs measured the same H10 at −20.3 ppm over
  //  373 min and −65.8 ppm over 10.9 min), so that tool gates on span. This function is not quoting a
  //  rate: it INTERPOLATES the measured divergence, so the correction it applies is bounded by what it
  //  actually observed over that fragment. On a short H10 fragment the noise is ~12 ms; on a short
  //  O2Ring one the real error is ~3 s and very much worth removing. Gating on span would refuse
  //  exactly the case that needs it most. `ppm` is REPORTED for diagnosis — do not quote it from a
  //  short fragment without the span beside it.
  //
  //  ⚠ This does NOT claim the host is absolutely right. It places every device on ONE timebase, so
  //  they become mutually consistent; whether that timebase is itself correct is the host's business
  //  (0.008 ppm on the capture box — UNVERIFIED on phone captures, where the column is a real phone).
  //  Reported, never assumed: `maxStepMs` surfaces a genuine clock STEP smeared across one anchor gap
  //  (2026-07-26 carries a 1.90 s O2Ring step and a 3.22 s H10 one) rather than hiding it in a slope.
  //  Window CHOSEN BY MEASUREMENT, not taste — planted recovery against ±100 ms jitter over the real
  //  190 min / 2873-anchor O2Ring geometry (worst / rms residual, ms):
  //      win  9 → 77 / 36.3      win 21 → 57 / 18.7      win 41 → 168 / 16.5      win 81 → 245 / 24.8
  //  21 halves the jitter without over-smoothing; 41+ starts flattening the O2Ring's real curvature,
  //  which is the one thing this must follow. Step recovery is unaffected across the whole range.
  var CK_AXIS_WIN = 21; // running-median width in anchors; odd so the median is a real sample
  var CK_AXIS_MAX_PPM = 50000; // 5 % — refusal bound, see the plausibility check in hostAxis()
  /* Twice the 1 ms phone-stamp quantum. A residual spread at or below this means the host column is
     the device column rounded, not a second clock — see the measurement in hostAxis(). */
  var CK_AXIS_INERT_MS = 2;

  function _ckMedian(v) {
    var s = v.slice().sort(function (a, b) {
      return a - b;
    });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* anchors: [{ devMs, hostMs }, …] — BOTH relative to the same first row, in device order.
     Returns { ok, correctionAt(devMs) → ms to ADD to the device axis, n, maxStepMs, totalMs, ppm }.
     ok:false ⇒ caller keeps the raw device axis (honest: no correction beats a fabricated one). */
  function hostAxis(anchors, opts) {
    opts = opts || {};
    var win = opts.window > 0 ? opts.window | 0 : CK_AXIS_WIN;
    var pts = [];
    for (var i = 0; i < (anchors ? anchors.length : 0); i++) {
      var a = anchors[i];
      if (!a) continue;
      var d = Number(a.devMs),
        h = Number(a.hostMs);
      if (!isFinite(d) || !isFinite(h)) continue;
      pts.push({ d: d, r: h - d });
    }
    if (pts.length < 3) return { ok: false, reason: 'need ≥3 host anchors, got ' + pts.length, n: pts.length };
    pts.sort(function (x, y) {
      return x.d - y.d;
    });
    /* Divergence is measured RELATIVE to the first anchor: the node has already anchored t0Ms there,
       and an absolute offset here would double-count it.
       ⚠ This comment used to add "so the correction must be 0 at the start and grow". IT IS NOT 0 —
       measured, and now stated in CLAUDE.md §7. The running median's clamped window pulls each end
       INWARD by exactly ⌊win/2⌋/2 = 5 anchors' worth of drift, so `correctionAt(firstAnchor)` is that
       bias and `ppm` under-reads by 1 − 5/(n−1): 12.5 % at n=41, 0.17 % on the real 2873-anchor O2Ring
       geometry. Subtracting r0 sets the ORIGIN of the measurement, which is what this line does; it
       does not make the smoothed series start at zero. (Found by `tools/guarantees.mjs` — the promise
       was both ungated and false.) */
    var r0 = pts[0].r;
    var n = pts.length;
    var sm = new Array(n);
    for (var k = 0; k < n; k++) {
      var lo = k - (win >> 1),
        hi = k + (win >> 1);
      if (lo < 0) lo = 0;
      if (hi > n - 1) hi = n - 1;
      var w = [];
      for (var j = lo; j <= hi; j++) w.push(pts[j].r - r0);
      sm[k] = _ckMedian(w);
    }
    var maxStep = 0;
    for (var s = 1; s < n; s++) {
      var st = Math.abs(sm[s] - sm[s - 1]);
      if (st > maxStep) maxStep = st;
    }
    var span = pts[n - 1].d - pts[0].d;
    var ppm = span > 0 ? (sm[n - 1] / span) * 1e6 : 0;
    /* IS THERE ACTUALLY A SECOND CLOCK HERE? (PAT-NO-VALID-ANCHOR §10, last item.)
       A ppm of ~0 has two completely different meanings and this function used to report them
       identically: (a) two INDEPENDENT clocks that happen to agree — the good case, and (b) the host
       column is not an independent clock at all, because the capture app derived it from the device
       stamp. Under (b) a ~0 ppm is not a measurement of agreement; it is the absence of a measurement,
       and a consumer that reads `ok: true, ppm: 0` cannot tell which it got.

       The discriminator is the SPREAD of the residual, not its slope. Measured over both capture trees:

         box / capture-host   82 files   spread  min 101.89 ms · median 425 ms · max 5124 ms
         phone tree          104 files   spread  min   0.13 ms · median   1.00 ms · max    1.00 ms

       The phone tree's MAXIMUM is exactly 1.00 ms — the resolution of the phone's own timestamp. Its
       host column is the device time rounded to the millisecond, so the residual cannot exceed one
       quantum, and no file in either tree lands between 1.00 and 101.89 ms. The bound below is set at
       twice the stamp quantum: 2× the largest inert spread observed, and 50× below the smallest real
       one. It is a property of the DATA (a host that adds nothing beyond rounding), not a tuned
       threshold, which is why it is stated as a multiple of the quantum rather than a bare number.

       Reported ADDITIVELY: `ok` and `ppm` are untouched, so every existing consumer behaves exactly as
       before. A node that wants to know whether its axis was disciplined by a real second clock now
       has something to read instead of inferring it from a number that cannot carry the distinction. */
    var rMin = Infinity,
      rMax = -Infinity;
    for (var q = 0; q < n; q++) {
      var rv = pts[q].r - r0;
      if (rv < rMin) rMin = rv;
      if (rv > rMax) rMax = rv;
    }
    var spreadMs = rMax - rMin;
    var independent = spreadMs > CK_AXIS_INERT_MS;
    /* PLAUSIBILITY BOUND — refuse, never "correct", an implausible rate. Caught by the ECGDex §4.3
       fixture, whose synthetic ms column advances at 2× its host stamps: unbounded, that is a −500000
       ppm "correction" that doubled fs from 130 to 259.9. A device crystal is wrong by ppm; the worst
       REAL one in this corpus is the O2Ring at −3035 ppm, which this admits with 16× headroom. Beyond
       5 % the two columns are not the two clocks we think they are — a misparse, a unit mismatch, a
       shifted column — and applying it would fabricate a timebase. §2.6's rule, one level up: when the
       input cannot be trusted the answer is "no correction", not a confident wrong one. */
    if (!(Math.abs(ppm) <= CK_AXIS_MAX_PPM)) {
      return { ok: false, reason: 'implausible host/device rate ' + Math.round(ppm) + ' ppm (bound ±' + CK_AXIS_MAX_PPM + ') — columns are probably not host+device', n: n, ppm: ppm };
    }
    return {
      ok: true,
      n: n,
      maxStepMs: maxStep,
      totalMs: sm[n - 1],
      ppm: ppm,
      /* See the spread block above. `independent: false` means the host column carried no information
         the device column did not already have — read this, never a ~0 ppm, to decide whether the axis
         was actually disciplined. `spreadMs` is published so the call is checkable rather than trusted. */
      spreadMs: spreadMs,
      independent: independent,
      inertReason: independent
        ? null
        : 'host ≡ device — residual spread ' + spreadMs.toFixed(2) + ' ms ≤ ' + CK_AXIS_INERT_MS + ' ms (one stamp quantum); this host column is not an independent clock',
      /* Linear between anchors; FLAT outside them. Flat, not extrapolated: past the last anchor there
         is no measurement, and extending a slope there would fabricate one — the same rule as §2.6. */
      correctionAt: function (devMs) {
        var x = Number(devMs);
        if (!isFinite(x)) return 0;
        if (x <= pts[0].d) return sm[0];
        if (x >= pts[n - 1].d) return sm[n - 1];
        var lo2 = 0,
          hi2 = n - 1;
        while (hi2 - lo2 > 1) {
          var mid = (lo2 + hi2) >> 1;
          if (pts[mid].d <= x) lo2 = mid;
          else hi2 = mid;
        }
        var dx = pts[hi2].d - pts[lo2].d;
        if (!(dx > 0)) return sm[lo2];
        return sm[lo2] + ((sm[hi2] - sm[lo2]) * (x - pts[lo2].d)) / dx;
      }
    };
  }

  root.DexClock = {
    tzOffset: tzOffset,
    _ckP2: _ckP2,
    _ckNumEpoch: _ckNumEpoch,
    _ckZoneMin: _ckZoneMin,
    _ckDMY: _ckDMY,
    resolveDMY: resolveDMY,
    parseTimestamp: parseTimestamp,
    hostAxis: hostAxis,
    _ckMedian: _ckMedian
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DexClock;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
