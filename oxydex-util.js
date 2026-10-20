/* ════ OxyDex · UTIL (oxydex-util.js) ──────────────────────────────────────────────────
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
   Small null-safe + export-safety helpers loaded FIRST so the profile init
   IIFE can reach them: csvSafe/csvNum, sanitizeFname, escHTML, gv, safeEl/
   safeSet/safeStyle, smoothVals, computeCeilingBaselineArr, and the lineChart
   cache + global trend-control state (gcWin/gcSmooth).
   Plain global script — shares page scope with the other oxydex-*.js files,
   exactly as in the original single-script monolith. No behavior change.

   WHY EVERY FUNCTION HERE CARRIES A biome-ignore: this file is the one OxyDex
   source the shell loads as a CLASSIC script (`<script src>`), ahead of the five
   ES modules that consume it (`<script type="module">`). Its top-level functions
   are therefore page globals, and their callers live in the sibling FILES. Biome
   lints one file at a time and has no option to declare a file a script rather
   than a module, so every global here reads as unused to it. The suppression
   names the caller, which keeps the rule at `error` for this file: a helper that
   genuinely loses its last caller, or a new dead local, still reds the gate.
   Three did lose their last caller and are gone (`getBaseline` and
   `computeBaselineArr`, both superseded by `computeCeilingBaselineArr`, and the
   form-field setter `sv`, whose only caller was the legacy `upToDOM`
   that this change removes).
   Load order: oxydex-util → oxydex-profile → oxydex-dsp → oxydex-render → oxydex-app.
   ════════════════════════════════════════════════════════════════════════ */

// ── csvSafe: prevent Excel formula injection in CSV exports ──
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-app.js calls it (the CSV export path)
function csvSafe(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  // Prefix dangerous formula chars with a tab (RFC 4180 safe, Excel ignores)
  if (s.length > 0 && '=+-@\t\r'.indexOf(s[0]) !== -1) s = '\t' + s;
  // Wrap in quotes if contains comma or newline
  if (s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('"') !== -1) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
// ── csvNum: §∅ — an absent NUMBER is an EMPTY FIELD, never the text "null" ──
/* A CSV cell has no `null`, so absence is the empty field — the convention `exportCSV` already used for
   `Motion (%)` and `Post-Dip HR Response` while three quarters of its fields concatenated the value
   raw. Raw concatenation printed the literal text `null` for every honestly-absent metric, which reads
   as data to a spreadsheet and to anyone who opens one.
   ⚠️ NOT `csvSafe`, deliberately: that function exists to defuse Excel formula injection and prefixes
   anything starting with `-` with a TAB, so a legitimately negative metric would arrive as "\t-3.2".
   This one is for numbers: absent ⇒ '', otherwise the number unchanged. A real 0 is a number and
   prints as 0 — only an unmeasured value is blank. */
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-app.js calls it (the CSV export path)
function csvNum(v) {
  return v == null || typeof v !== 'number' || !isFinite(v) ? '' : v;
}
// ── sanitizeFname: strip HTML-dangerous chars from filenames ──
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-render.js calls it
function sanitizeFname(s) {
  if (!s) return '';
  return String(s).replace(/[<>&"'`]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
  });
}

// ── lineChart cache — avoid rebuilding identical SVGs on re-render ──
var _lineChartCache = {};

// ── Global trend controls state (View Window + Smoothing) ──
var _gcWin = 999; // trend/list view window in nights (999 = All)
var _gcSmooth = 0; // moving-average radius for trend charts (0 = off)
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-render.js calls it
function smoothVals(arr, k) {
  if (!k || k < 1 || !arr || arr.length < 3) return arr;
  return arr.map(function (_v, i) {
    var sum = 0,
      cnt = 0;
    for (var j = Math.max(0, i - k); j <= Math.min(arr.length - 1, i + k); j++) {
      var v = arr[j];
      if (v != null && isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    return cnt ? +(sum / cnt).toFixed(4) : arr[i];
  });
}
// ── getBaseline: shared baseline computation (replaces 11x duplication) ──
// safeEl: safe getElementById wrapper injected by audit fix
// Escape any file-derived / user-controlled string before it enters innerHTML.
// (Filenames and CSV cell values can contain markup; a crafted shared export
// must never be able to execute script in the page that holds your health data.)
// Delegates to THE canonical suite escaper (dex-escape.js, loaded first in the
// OxyDex shell) — one implementation, no per-app copy (SECURITY-REMEDIATION F1/F3).
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-app.js, oxydex-dsp.js, oxydex-fusion.js, oxydex-render.js and OxyDex.src.html call it
function escHTML(s) {
  return escapeHTML(s);
}
function safeEl(id) {
  return document.getElementById(id);
}
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-app.js, oxydex-dsp.js and oxydex-render.js call it
function setIfPresent(id, prop, val) {
  var el = safeEl(id);
  if (el) el[prop] = val;
}
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-app.js, oxydex-dsp.js and oxydex-render.js call it
function safeStyle(id, prop, val) {
  var el = safeEl(id);
  if (el) el.style[prop] = val;
}
// gv/sv: null-safe value getter/setter for form inputs (guards all profile field access)
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-profile.js reads every profile field through it
function gv(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

// ── computeBaselineArr: O(n) sliding-window baseline precomputation ──────────
// Returns an array bl[] where bl[i] = mean(spo2[max(0,i-WIN)..i-1]).
// Replaces the O(n²) pattern: getBaseline(spo2.slice(0,i), WIN) inside loops.
// Usage: var blArr = computeBaselineArr(spo2, WIN); … var bl = blArr[i];

// ── computeCeilingBaselineArr: O(n) trailing high-percentile "ceiling" baseline ──
// Returns bl[] where bl[i] = pct-th percentile of spo2[max(0,i-WIN)..i-1] (the recent
// resting/stable SpO2). Unlike the trailing MEAN (computeBaselineArr), brief dips sit in
// the lower tail and barely move a high percentile, so the ceiling is NOT dragged down by
// closely-spaced desaturations. This is the AASM-style reference level a 4% desaturation
// is defined against, and it removes the trailing-mean self-suppression that made ODI
// under-count proportionally to OSA severity (severe OSA dips drag a mean baseline below
// `baseline−4%`, hiding later events of equal depth). See OXYDEX-ODI-CEILING-FIX-BRIEF.md.
//
// Implementation: incremental 101-bin histogram over integer SpO2 0..100, slid one sample
// per index (add spo2[i-1], drop spo2[i-WIN-1]); the percentile is read by walking the
// histogram low→high to the first value whose cumulative count reaches the target rank.
// Integer SpO2 makes the histogram exact; the per-index walk is over a fixed 101 bins → O(n).
// Window/fallback semantics mirror computeBaselineArr exactly (same coverage, bl[0]=95).
// biome-ignore lint/correctness/noUnusedVariables: a page global — oxydex-dsp.js calls it (the ODI ceiling baseline)
function computeCeilingBaselineArr(spo2, WIN, pct) {
  WIN = WIN || 300;
  pct = pct == null ? 90 : pct; // p90 = the stable resting ceiling (default, brief §2a)
  var n = spo2.length;
  var bl = new Array(n);
  var NB = 101; // bins 0..100 (% SpO2, integer)
  var hist = new Int32Array(NB);
  var cnt = 0,
    i,
    b;
  function bin(v) {
    v = Math.round(v);
    return v < 0 ? 0 : v > 100 ? 100 : v;
  }
  for (i = 0; i < n; i++) {
    if (i > 0) {
      // §∅: absences (null) are NOT measured 0 — they stay out of the histogram,
      // otherwise a dropout drags the p90 ceiling toward 0 and manufactures events.
      var prev = spo2[i - 1];
      if (prev != null) {
        hist[bin(prev)]++;
        cnt++;
      }
    }
    if (i > WIN) {
      var old = spo2[i - WIN - 1];
      if (old != null) {
        hist[bin(old)]--;
        cnt--;
      }
    }
    if (cnt > 0) {
      var target = Math.ceil((pct / 100) * cnt);
      if (target < 1) target = 1;
      var acc = 0,
        v = 100;
      for (b = 0; b < NB; b++) {
        acc += hist[b];
        if (acc >= target) {
          v = b;
          break;
        }
      }
      bl[i] = v;
    } else {
      bl[i] = 95; // same cold-start fallback as the mean baseline
    }
  }
  return bl;
}
