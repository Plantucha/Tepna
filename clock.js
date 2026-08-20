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
  /* ── ALLAN DEVIATION, THE SPINE COPY (HOSTAXIS-STABILITY-2026-08-13-BRIEF) ─────────────────────────
     WHY IT LIVES HERE. `hostAxis` publishes a `ppm` with no statement of how far to trust it, and §7's
     rule "never quote a ppm without the span beside it" was enforced by prose plus one hand-picked
     threshold. Allan deviation is the standard answer — it says whether an error shrinks when you
     average longer, which a standard deviation CANNOT, because SD diverges for several of these noise
     types as N grows (NIST/Riley SP 1065).
     Promoted rather than copied: `ppgdex-dsp.js` had the only JS core and `ecgdex-dsp.js` had none, so
     giving each node its own would have made a fourth implementation. It sits in the spine for the same
     reason `parseTimestamp` does (§✅) — one definition, inlined everywhere, delegated to by name.
     `integrator-tch.js` deliberately keeps its own: different domain (frequency series, per-node
     three-cornered hat) and a different API. `capture-host/allan.py` is a different LANGUAGE lane and
     cannot be called from a bundle. All three are pinned to each other by cross-implementation tests.

     INPUT IS PHASE — a time-error series. For a physiological signal the only legitimate phase series
     is the DIFFERENCE between two observers of the same thing; intervals are a FREQUENCY series and a
     heart is not an oscillator with stationary noise. Here the input is the host-minus-device
     divergence, which is a phase series by construction. */
  var CK_ALLAN_MIN_TERMS = 8; // an estimate from a handful of terms is wider than the answer it gives
  /* Slope midpoints between the canonical exponents, and the SAME vocabulary as capture-host/allan.py
     `_NOISE`. Verbatim on purpose: two lanes naming one curve differently is a defect a reader cannot
     see. Drift is the open-ended top, so it is the fall-through — an edge no slope can fail would make
     that arm unreachable. */
  var CK_ALLAN_NOISE = [
    [-0.75, 'white/flicker-phase', 'jitter — averages away fast'],
    [-0.25, 'white-frequency', 'benign; averaging helps as √N'],
    [0.25, 'flicker-frequency', 'A FLOOR — more averaging buys nothing'],
    [0.75, 'random-walk-frequency', 'wanders; a longer fit is worse than a short one']
  ];
  function _ckAllanFromPhase(phaseMs, tau0Sec) {
    // PHASE → FRACTIONAL FREQUENCY: y[i] = (x[i+1] − x[i]) / tau0. The change of variable that makes
    // the overlapping-average form apply, and why this matches allan.py's second-difference form.
    var y = [],
      i;
    for (i = 1; i < phaseMs.length; i++) {
      var v = (phaseMs[i] - phaseMs[i - 1]) / tau0Sec;
      if (!isFinite(v)) return [];
      y.push(v);
    }
    var N = y.length;
    if (N < 3) return [];
    var pre = new Float64Array(N + 1);
    for (var j = 0; j < N; j++) pre[j + 1] = pre[j] + y[j];
    var out = [];
    for (var m = 1; 2 * m + 1 <= N; m *= 2) {
      var sum = 0,
        cnt = 0;
      for (i = 0; i + 2 * m <= N; i++) {
        var d = (pre[i + 2 * m] - pre[i + m]) / m - (pre[i + m] - pre[i]) / m;
        sum += d * d;
        cnt++;
      }
      if (cnt < CK_ALLAN_MIN_TERMS) break;
      out.push({ tau: m * tau0Sec, adev: Math.sqrt(sum / (2 * cnt)), n: cnt });
    }
    return out;
  }
  /* Log-log least squares, returning the slope AND ITS STANDARD ERROR.
     ⚠️ THE SE IS A LOWER BOUND, NOT AN ESTIMATE. Overlapping ADEV points are CORRELATED — adjacent τ
     are computed from largely the same samples — while OLS assumes independent residuals. So the true
     uncertainty is wider than this. Do NOT tighten the 1.96 multiplier below to 1 SE believing that is
     the more rigorous choice; it is the less rigorous one. */
  function _ckAllanSlope(points) {
    var pts = [],
      i;
    for (i = 0; i < (points || []).length; i++) if (points[i].adev > 0 && points[i].tau > 0) pts.push(points[i]);
    if (pts.length < 3) return null; // two points fit any line and cannot be checked
    var xs = [],
      ys = [];
    for (i = 0; i < pts.length; i++) {
      xs.push(Math.log(pts[i].tau) / Math.LN10);
      ys.push(Math.log(pts[i].adev) / Math.LN10);
    }
    var k = xs.length,
      mx = 0,
      my = 0;
    for (i = 0; i < k; i++) {
      mx += xs[i];
      my += ys[i];
    }
    mx /= k;
    my /= k;
    var sxx = 0,
      sxy = 0;
    for (i = 0; i < k; i++) {
      sxx += (xs[i] - mx) * (xs[i] - mx);
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    if (!(sxx > 0) || k < 3) return null;
    var b = sxy / sxx,
      a = my - b * mx,
      ss = 0;
    for (i = 0; i < k; i++) {
      var e = ys[i] - (a + b * xs[i]);
      ss += e * e;
    }
    return { slope: b, se: Math.sqrt(ss / (k - 2) / sxx), nTau: k };
  }
  /* NAME THE NOISE TYPE — OR REFUSE TO. A strict `<` against a POINT ESTIMATE assigns a type the data
     may not support: −0.7501 and −0.7500 sit either side of a boundary while printing identically, and
     the `meaning` string flips between "averages away" and "helps as √N" — the field a consumer
     branches on. So when a boundary lies within 1.96 SE the type is NOT named.
     `noise: null`, never a string like 'ambiguous': a truthy sentinel passes the guard everyone writes
     (`if (noise) …`), which would reintroduce the bug inside its own fix.
     ⚠️ 1.96 SE IS A DELIBERATE STAND-IN, AND THE REASON IS WORTH KEEPING. The textbook treatment is
     Riley/SP-1065 equivalent degrees of freedom, but EDF is a function of THE NOISE TYPE — so computing
     a confidence interval in order to DECIDE the noise type is circular exactly at a boundary. The
     honest forms are to iterate (assume a type → EDF → re-classify) or to test under each candidate;
     near a boundary the iteration is least likely to settle, and a classification that does not
     converge is the same finding as a CI that straddles. So this reaches the same verdict where it
     matters. Anyone implementing EDF properly must handle that circularity before claiming more. */
  /* `nTau` travels WITH the classification, not only beside it. A perfect fit on 3 taus and one on 12
     both yield se 0 and are very different evidence — the SE divides by k−2, so three points lie on a
     line far more easily than twelve. `stability` publishes `taus` at its own level, but a consumer
     holding only this dict could not tell them apart, which is the rename problem one FIELD short
     rather than one LAYER short. */
  function _ckClassifyAllan(sl, se, nTau) {
    if (sl == null || !isFinite(sl)) return null; // an unknown is not a noise type
    var i,
      edges = [];
    for (i = 0; i < CK_ALLAN_NOISE.length; i++) edges.push(CK_ALLAN_NOISE[i][0]);
    /* se === 0 and se == null both skip the refusal — a DECISION, not a fall-through, and the record
       keeps them apart (`slopeSE` is 0 vs null/undefined). No SE supplied ⇒ the pre-SE contract, since
       refusing would break every existing caller over a distinction it never asked about. An SE of
       exactly 0 ⇒ the log-log points fall exactly on a line (reachable: a noiseless τ⁻¹ series returns
       exactly 0), and a perfect fit is the one case where the exponent IS known exactly.
       ⚠️ Do not read 0 as "measured and perfectly certain" on real data: residuals are never exactly
       zero for a capture, so 0 means a degenerate or synthetic input — and the SE is a LOWER bound
       regardless. Published so a reader can tell which they got. */
    // `se > 0` alone: null/undefined/NaN all compare false, so the isFinite guard was redundant — and
    // its `> 0` → `>= 0` mutant is EQUIVALENT (at se === 0 the product is 0 either way), i.e. a guard
    // nothing could observe being wrong. Kept identical to the Python twin.
    var half = se > 0 ? 1.96 * se : 0;
    var straddled = [];
    for (i = 0; i < edges.length; i++) if (sl - half < edges[i] && edges[i] < sl + half) straddled.push(edges[i]);
    var name = null,
      meaning = null;
    for (i = 0; i < CK_ALLAN_NOISE.length; i++) {
      if (sl < CK_ALLAN_NOISE[i][0]) {
        name = CK_ALLAN_NOISE[i][1];
        meaning = CK_ALLAN_NOISE[i][2];
        break;
      }
    }
    if (name == null) {
      name = 'drift';
      meaning = 'deterministic — fit and remove it, never average through it';
    }
    if (straddled.length) {
      // The two types the data cannot separate, so a reader sees WHAT is undecided rather than a blank.
      var cands = [];
      for (i = 0; i < CK_ALLAN_NOISE.length; i++) {
        var lo = i === 0 ? -Infinity : CK_ALLAN_NOISE[i - 1][0];
        if (sl - half < CK_ALLAN_NOISE[i][0] && sl + half > lo) cands.push(CK_ALLAN_NOISE[i][1]);
      }
      if (sl + half > 0.75) cands.push('drift');
      return {
        slope: sl, // UNROUNDED — rounding in the DATA is what made the boundary case invisible
        slopeSE: se,
        nTau: nTau == null ? null : nTau,
        noise: null,
        candidates: cands,
        meaning: 'the slope sits within 1.96 SE of a category boundary — the noise TYPE is not supported by this fit; branch on `slope`, not on a label'
      };
    }
    return { slope: sl, slopeSE: se, nTau: nTau == null ? null : nTau, noise: name, candidates: null, meaning: meaning };
  }

  var CK_AXIS_WIN = 21; // running-median width in anchors; odd so the median is a real sample
  var CK_AXIS_MAX_PPM = 50000; // 5 % — refusal bound, see the plausibility check in hostAxis()
  /* Twice the 1 ms phone-stamp quantum. A residual spread at or below this means the host column is
     the device column rounded, not a second clock — see the measurement in hostAxis(). */
  var CK_AXIS_INERT_MS = 2;
  /* A DEVICE WHOSE AXIS WAS DRAWN IS NOT A SECOND CLOCK — and `spreadMs` alone cannot see it.
     `independent` was `spreadMs > CK_AXIS_INERT_MS`, which detects the OPPOSITE of what it must for a
     drawn axis: a counter synthesised as `index × an assumed rate` at 1 s granularity produces a HUGE
     residual spread (22,335 ms measured on a real O2Ring segment), so the coarser the fabrication the
     more "independent" it read. Measured 2026-08-14 on the O2Ring's monotonic run: `ok:true`,
     `ppm = 2765.5`, `independent:true` — a confident rate for a device with no oscillator, consumed
     downstream by pat-gate.js, ecgdex-dsp.js's fs correction and integrator-dsp.js's skew decision.
     The discriminator that DOES separate them is the concentration of the device's inter-sample
     deltas. Measured over 381 arrival sidecars on the box tree:
         real clock streams (356)  modal-delta share  max  56.00 %   (Verity ppg; H10 ecg 40.79 %)
         DRAWN streams      (25)   modal-delta share  min  79.04 %   (O2Ring counter, Verity ppi)
     Nothing lands between. 0.67 sits in that gap — ~1.2× above the highest real and ~1.2× below the
     lowest drawn — and gives 0/25 missed with 0/356 false positives. It is a property of the DATA,
     like CK_AXIS_INERT_MS, not a tuned knob.
     ⚠ The pre-existing ≥99 % drawn test (ppgdex-dsp) MISSES 5 of those 25 — a drawn axis is only
     ~100 % concentrated when nothing interrupts it; one counter reset, a repeated stamp or a doubled
     delta drops a genuinely fabricated stream to 79 %. Do not raise this back toward 99 %. */
  var CK_AXIS_DRAWN_SHARE = 0.67;

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
    /* Is the DEVICE column a clock at all? (See CK_AXIS_DRAWN_SHARE.) Concentration of the device's
       own inter-sample deltas — computed from the anchors already in hand, no extra input. */
    var _dTally = Object.create(null),
      _dTotal = 0,
      _dTop = 0;
    for (var dq = 1; dq < n; dq++) {
      var dk = String(pts[dq].d - pts[dq - 1].d);
      var dc = (_dTally[dk] = (_dTally[dk] || 0) + 1);
      _dTotal++;
      if (dc > _dTop) _dTop = dc;
    }
    var drawnShare = _dTotal > 0 ? _dTop / _dTotal : 0;
    var deviceDrawn = _dTotal > 0 && drawnShare >= CK_AXIS_DRAWN_SHARE;
    /* `deviceDrawn` is published ADDITIVELY and does NOT gate `independent` — the same discipline the
       spread flag itself shipped under ("ok and ppm are untouched, so every existing consumer behaves
       exactly as before"). Folding it in was tried and reverted: a SYNTHETIC fixture legitimately uses
       a uniform device axis (`devMs = i * 1000`), which is by construction indistinguishable from a
       fabricated one, so gating on it reds 11 assertions including ECGDex's planted-drift recovery —
       a real feature, not a fixture nit. The detector is right about real data (381 files, perfect
       separation) and wrong to be load-bearing here, because a test fixture is not a recording.
       ⚠ CONSEQUENCE, stated because it is a live hole and not a resolved one: `independent` is STILL
       true for a drawn O2Ring axis, and pat-gate.js / ecgdex-dsp.js / integrator-dsp.js still read it.
       Consumers must move to `deviceDrawn` deliberately, node by node, with each node's fixtures
       re-cut to a realistic device axis. Tracked in KNOWN-CLOCK-ADVERSARIAL-CAPTURE §Findings. */
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
      /* HOW FAR TO TRUST THE `ppm` ABOVE — σ_y(τ) for the host-vs-device divergence, plus the noise
         type its slope names. §7 has always said "never quote a `ppm` without the span beside it";
         this is that rule computed rather than asserted.
         ⚠️ RAW divergence, NOT the running-median `sm`. The median exists to keep BLE delivery jitter
         out of the correction, which is exactly the noise this measures — running ADEV on the smoothed
         series would report how well the smoother worked and call it clock stability.
         ⚠️ NULL WHEN THERE IS NO SECOND CLOCK. `independent:false` means the host column is the device
         stamp rounded, so its "divergence" is quantisation; a curve over it would report the rounding
         as physics. That is the COMMON case, not an edge — the whole phone-captured tree reads
         false — so the refusal path is the one most consumers will see.
         Deliberately gated by nothing: this is a diagnostic. The last two arrival diagnostics that
         shipped with thresholds both fired on every stream of the first real night
         (ALLAN-DEVIATION §4); a bar comes after a τ-curve from several nights, not before. */
      stability: (function () {
        if (!independent) return null;
        var spanSec = (pts[n - 1].d - pts[0].d) / 1000;
        if (!(spanSec > 0)) return null;
        var ph = [];
        for (var q = 0; q < n; q++) ph.push(pts[q].r - r0);
        var curve = _ckAllanFromPhase(ph, spanSec / (n - 1));
        if (curve.length < 3) return null;
        var fit = _ckAllanSlope(curve);
        if (!fit) return null;
        var cls = _ckClassifyAllan(fit.slope, fit.se, fit.nTau);
        var bestI = 0;
        for (var b = 1; b < curve.length; b++) if (curve[b].adev < curve[bestI].adev) bestI = b;
        return {
          taus: curve.length,
          tau0Sec: spanSec / (n - 1),
          slope: cls.slope,
          /* Published UNCONDITIONALLY, including when the type IS named — a caller with a wider
             tolerance can then decide for itself instead of being forced to accept this default. */
          slopeSE: cls.slopeSE,
          noise: cls.noise,
          candidates: cls.candidates,
          meaning: cls.meaning,
          /* ⚠️ `…Ms` IS A MISNOMER AND IS KEPT ONLY FOR BACK-COMPAT — these are a RATE, not a duration.
             `_ckAllanFromPhase` is handed phase in MILLISECONDS and τ in SECONDS, so `adev` is a
             fractional frequency in ms/s. `ppmUncertainty` below multiplies the same number by 1000,
             which is only correct because of that: ms/s ÷ 1000 is dimensionless, × 1e6 is ppm.
             Read as milliseconds these two understate themselves by 1000×, and CLAUDE.md §📏 rates a
             wrong unit at the severity of a wrong number. Prefer the `…Ppm` pair below. Renaming in
             place is NOT available — `integrator-dsp.js` and `ppgdex-*` read these names. */
          atShortestMs: curve[0].adev,
          atLongestMs: curve[curve.length - 1].adev,
          /* The same two values in the unit they are actually in. */
          atShortestPpm: curve[0].adev * 1000,
          atLongestPpm: curve[curve.length - 1].adev * 1000,
          tauMaxSec: curve[curve.length - 1].tau,
          /* The averaging time minimising σ_y — the window a measurement on this pair should use, in
             place of one chosen by intuition. On a pure-jitter clock it is simply the longest τ
             measured, and saying so is more honest than implying a minimum was found. */
          optimalTauSec: curve[bestI].tau,
          /* THE POINT OF THE EXERCISE: how much of the `ppm` above is real. σ_y at the recording's own
             span, expressed in ppm — quote the ppm WITH this or not at all. */
          ppmUncertainty: curve[curve.length - 1].adev * 1000,
          note: 'σ_y(τ) of the RAW host−device divergence; slope names the noise type. The SE is a LOWER bound — overlapping ADEV points are correlated while OLS assumes independence.'
        };
      })(),
      /* Published so the `independent` call is checkable rather than trusted — the same reason
         `spreadMs` is published beside it. */
      drawnShare: drawnShare,
      deviceDrawn: deviceDrawn,
      inertReason: independent
        ? null
        : 'host ≡ device — residual spread ' + spreadMs.toFixed(2) + ' ms ≤ ' + CK_AXIS_INERT_MS + ' ms (one stamp quantum); this host column is not an independent clock',
      /* Separate from `inertReason` on purpose: that field answers "is the HOST column real", this one
         answers "is the DEVICE column a clock". Both can be non-null; neither implies the other. */
      drawnReason: deviceDrawn
        ? 'device axis is DRAWN — ' +
          (drawnShare * 100).toFixed(2) +
          ' % of inter-sample deltas share one value (≥ ' +
          (CK_AXIS_DRAWN_SHARE * 100).toFixed(0) +
          ' %); this column is a synthesised counter, not a clock, so there is no second timebase to discipline against'
        : null,
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
    // Promoted from ppgdex-dsp.js so the fleet has ONE JS core (HOSTAXIS-STABILITY §4.3). Nodes
    // delegate by name, the way they already do for parseTimestamp.
    allanFromPhase: _ckAllanFromPhase,
    allanSlope: _ckAllanSlope,
    classifyAllan: _ckClassifyAllan,
    _ckMedian: _ckMedian
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DexClock;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
