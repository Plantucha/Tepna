/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * acc-acc-control.mjs — the CALIBRATION CONTROL for wide-range clock alignment.
 *
 * Backs CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF §2c. It exists because a negative
 * result from an uncalibrated instrument is not evidence: an attempt to fit the
 * CPAP's clock by aligning its flow signal against body movement came back
 * negative, and this asks whether the METHOD could have found the answer at all.
 *
 * The pair is chosen so the answer is already known. The capture host writes Polar
 * H10 chest ACC and Polar Verity arm ACC through one daemon on ONE clock, so their
 * true offset is 0 by construction — while remaining two different sensors at two
 * different body sites, correlated only through real movement. That is the same
 * problem shape as ACC-vs-flow, with a known answer. (ACC against itself would
 * only test the arithmetic.)
 *
 * Legs, and the decision each carries:
 *   COARSE@0    the wide-search parameters, true offset 0     — recovers ~0?
 *   COARSE@±I   same, with a known offset planted in device B — recovers I?
 *   FINE@0      PATAlign's own DEFAULTS (50 ms / ±1.6 s)      — does it work at all?
 *
 *   COARSE legs pass          -> instrument sound -> a negative elsewhere is REAL.
 *   FINE passes, COARSE fails -> parameters blind -> that negative is VOID.
 *
 * The injection leg is scored as recovered(I) − recovered(0), a self-consistency
 * check that needs no knowledge of the sign convention.
 *
 * MEASURED (13 nights, 2026-07-16 → 07-28): FINE 13/13 at 0.00 min; COARSE
 * recovers a planted −39 min on 1/13, attenuated to −14.3. Cause: a ±50 min search
 * at 250 ms bins scores 24,001 candidate lags against a ±15 s (121-bin) window, so
 * the chance-maximum correlation ≈ 0.41 exceeds the minCorr 0.35 gate — the gate is
 * inoperative and the peak is noise. Lengthening the window restores it monotonically
 * (±60 s → −27.3, 3/13; ±240 s → −31.4, 6/13) but never converges.
 *
 * Usage:  node tools/acc-acc-control.mjs [repoRoot] [corpusRoot]
 *         WH=<ms> to override the coarse correlation half-window (default 15000).
 * Read-only: parses recordings, writes nothing.
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

/* REPO defaults to THIS FILE's own repo root, never to an absolute path.
   It used to default to `/run/media/…/Tepna`, and that is worse than a crash: run from a WORKTREE the
   tool silently loaded `build-core.js` and every DSP from the MAIN checkout, so it measured a different
   tree's code and reported the answer as if it were this one's. Several sessions work this repo in
   parallel worktrees (CLAUDE.md §👥), which is exactly the "spent an hour debugging another session's
   in-flight clock.js" failure that section exists to prevent — here it would be silent, because the
   tool runs fine and just answers about the wrong code. Two sibling tools carried the same class of
   defect as a hard constant and were dead outright (PR #686); this one ran, which is why it survived.
   An explicit argv[2] still overrides, for pointing it at another checkout ON PURPOSE. */
const SELF_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argRepo = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const REPO = argRepo || SELF_REPO;
const argRoot = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : null;
const ROOT = argRoot || process.env.DEX_CAPTURES || '/home/michal/tepna-smoketest/captures';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: node tools/acc-acc-control.mjs [<repo-root>] [<captures-dir>]');
  console.log("  repo-root defaults to this tool's own checkout; captures-dir to $DEX_CAPTURES.");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const DexBuild = require(path.join(REPO, 'tools/build-core.js'));

function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, contains: () => false },
    setAttribute: noop,
    appendChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop
  });
  const ctx = vm.createContext({
    console,
    document: { getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el(), addEventListener: noop, querySelectorAll: () => [] },
    setTimeout,
    clearTimeout
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.addEventListener = noop;
  for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'ppgdex-dsp.js', 'pat-align.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}
const PA = realm().PATAlign;

/* flow-vs-acc.mjs's exact settings, and PATAlign's own defaults. */
const COARSE = { dtMs: 250, windowHalfMs: Number(process.env.WH || 15000), maxLagMs: 3000000, minCorr: 0.35, anchorMinGapMs: 60000 };
const FINE = { dtMs: 50, windowHalfMs: 1600, maxLagMs: 1600, minCorr: 0.6, anchorMinGapMs: 3000 };
const INJECT = [0, -39 * 60000, 17.5 * 60000]; // 0, the CPAP's known −39 min, and a +17.5 min linearity check

/* Clock Contract: regex the explicit format, never new Date(str). Capture-host ACC carries a
   no-zone ISO phone timestamp (rule 3) -> components verbatim through Date.UTC. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;
function isoMs(s) {
  const m = ISO.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
}

/* One ACC file -> {t: Float64Array (absolute floating ms), v: Float32Array (|xyz| in mg)}.
 *
 * COLUMNS ARE READ FROM THE HEADER, NOT ASSUMED. The capture host changed this file's schema mid-
 * corpus: through 2026-07-18 it wrote
 *     Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]
 * and from 2026-07-21 it dropped the relative column entirely
 *     Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]
 * A fixed-index parser silently yields ZERO rows on the newer layout — which it did, and which is why
 * the first run of this control saw only 2 of 13 nights. Never index these columns positionally.
 *
 * Timebase: the first row's phone timestamp anchors the file (Clock Contract rule 3, no-zone ISO ->
 * Date.UTC of the components as written), and the per-row offset comes from the `sensor timestamp
 * [ns]` delta, which is present in BOTH layouts. Verified equal to the retired `timestamp [ms]`
 * column to all printed digits (671185.348986 ms both ways). The ns values (~6e17) exceed
 * MAX_SAFE_INTEGER, so a float64 delta carries ~128 ns of error — 4 orders of magnitude below the
 * finest bin used here (50 ms), so it is parsed as Number deliberately rather than BigInt per row. */
function parseACC(file) {
  const txt = fs.readFileSync(file, 'utf8');
  let p = txt.indexOf('\n');
  if (p < 0) return null;
  const hdr = txt
    .slice(0, p)
    .replace(/\r$/, '')
    .split(';')
    .map((h) => h.trim());
  const iNs = hdr.findIndex((h) => /^sensor timestamp/i.test(h));
  const iX = hdr.findIndex((h) => /^X\b/i.test(h));
  const iY = hdr.findIndex((h) => /^Y\b/i.test(h));
  const iZ = hdr.findIndex((h) => /^Z\b/i.test(h));
  if (iNs < 0 || iX < 0 || iY < 0 || iZ < 0) return null;
  const need = Math.max(iNs, iX, iY, iZ);
  let q = txt.indexOf('\n', p + 1);
  if (q < 0) return null;
  const t0 = isoMs(txt.slice(p + 1, q));
  if (t0 == null) return null;

  // count rows to size the arrays exactly
  let rows = 1;
  for (let i = p + 1; i < txt.length; i++) if (txt.charCodeAt(i) === 10) rows++;
  const T = new Float64Array(rows),
    V = new Float32Array(rows);
  let n = 0,
    i0 = p + 1,
    ns0 = NaN;
  while (i0 < txt.length && n < rows) {
    let i1 = txt.indexOf('\n', i0);
    if (i1 < 0) i1 = txt.length;
    let f = 0,
      s = i0,
      ns = NaN,
      x = NaN,
      y = NaN,
      z = NaN;
    for (let i = i0; i <= i1; i++) {
      if (i === i1 || txt.charCodeAt(i) === 59) {
        if (f === iNs) ns = +txt.slice(s, i);
        else if (f === iX) x = +txt.slice(s, i);
        else if (f === iY) y = +txt.slice(s, i);
        else if (f === iZ) z = +txt.slice(s, i);
        f++;
        s = i + 1;
      }
    }
    if (f > need && isFinite(ns) && isFinite(x) && isFinite(y) && isFinite(z)) {
      if (!isFinite(ns0)) ns0 = ns;
      T[n] = t0 + (ns - ns0) / 1e6;
      V[n] = Math.sqrt(x * x + y * y + z * z);
      n++;
    }
    i0 = i1 + 1;
  }
  return n ? { t: T.subarray(0, n), v: V.subarray(0, n) } : null;
}

/* All of one device's fragments for one night, stitched and time-ordered. */
function stitch(files) {
  const parts = [];
  let tot = 0;
  for (const f of files) {
    const a = parseACC(f);
    if (a) {
      parts.push(a);
      tot += a.t.length;
    }
  }
  if (!tot) return null;
  parts.sort((a, b) => a.t[0] - b.t[0]);
  const T = new Float64Array(tot),
    V = new Float32Array(tot);
  let n = 0;
  for (const a of parts) {
    T.set(a.t, n);
    V.set(a.v, n);
    n += a.t.length;
  }
  return { t: T, v: V };
}

/* PA.envelope wants an indexable of {tMs, v}. Materialise only the grid span, with an optional shift
   applied to the timeline (the injected offset). */
function envOf(s, t0, t1, shiftMs, opts) {
  const out = [];
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i] + shiftMs;
    if (t >= t0 && t <= t1) out.push({ tMs: t, v: s.v[i] });
  }
  return out.length >= 20 ? PA.envelope(out, t0, t1, opts) : null;
}

const med = (a) => {
  const b = a.slice().sort((x, y) => x - y);
  return b.length ? b[b.length >> 1] : NaN;
};

/* --- inventory: night -> device -> fragment list --- */
const walk = (d) => {
  let o = [];
  let e;
  try {
    e = fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return o;
  }
  for (const x of e) o = x.isDirectory() ? o.concat(walk(path.join(d, x.name))) : o.concat(path.join(d, x.name));
  return o;
};
const nights = new Map();
for (const f of walk(ROOT)) {
  const b = path.basename(f);
  const h10 = /^Polar_H10_[0-9A-Fa-f]+_(\d{8}_?\d{6})_ACC\.txt$/.exec(b);
  const ver = h10 ? null : /^Polar_(?:VeritySense|Sense)_[0-9A-Fa-f]+_(\d{8}_?\d{6})_ACC\.txt$/.exec(b);
  const m = h10 || ver;
  if (!m) continue;
  const dev = h10 ? 'h10' : 'ver';
  /* PSL writes the stamp as YYYYMMDD_HHMMSS (underscore inside); the capture host writes 14
     contiguous digits. Normalise so the positional slices below stay valid for both — the spelling
     fix alone matched 0 PSL files, because the stamp shape was a SECOND, independent blindness
     that only the 0->54 control exposed. */
  const st = m[1].replace('_', '');
  const abs = Date.UTC(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8), +st.slice(8, 10), +st.slice(10, 12), +st.slice(12, 14));
  const night = new Date(abs - 12 * 3600e3).toISOString().slice(0, 10); // noon-to-noon
  if (!nights.has(night)) nights.set(night, { h10: [], ver: [] });
  nights.get(night)[dev].push(f);
}

console.log('\nACC↔ACC CONTROL — H10 chest vs Verity arm, one host clock, TRUE OFFSET = 0');
console.log(`  COARSE (flow-vs-acc params): ${COARSE.dtMs} ms bins · ±${COARSE.windowHalfMs / 1000} s window · ±${COARSE.maxLagMs / 60000} min search · minCorr ${COARSE.minCorr}`);
console.log(`  FINE   (PATAlign DEFAULTS):  ${FINE.dtMs} ms bins · ±${FINE.windowHalfMs} ms window · ±${FINE.maxLagMs} ms search · minCorr ${FINE.minCorr}`);

const res = [];
for (const [night, d] of [...nights].sort()) {
  if (!d.h10.length || !d.ver.length) continue;
  const A = stitch(d.h10),
    B = stitch(d.ver);
  if (!A || !B) {
    console.log(`  ${night}  UNPARSED — h10 ${A ? A.t.length : 0} rows / ver ${B ? B.t.length : 0} rows (${d.h10.length}+${d.ver.length} fragments)`);
    continue;
  }
  const ov0 = Math.max(A.t[0], B.t[0]),
    ov1 = Math.min(A.t[A.t.length - 1], B.t[B.t.length - 1]);
  const ovMin = (ov1 - ov0) / 60000;
  if (!(ovMin > 30)) {
    console.log(`  ${night}  overlap only ${ovMin.toFixed(0)} min — skipped`);
    continue;
  }

  const row = { night, ovMin, legs: {} };
  for (const [tag, opts] of [
    ['COARSE', COARSE],
    ['FINE', FINE]
  ]) {
    const envA = envOf(A, ov0, ov1, 0, opts);
    for (const inj of tag === 'COARSE' ? INJECT : [0]) {
      const envB = envOf(B, ov0, ov1, inj, opts);
      let r = { ok: false, reason: 'no envelope' };
      if (envA && envB) r = PA.alignByAnchors(envA, envB, ov0, opts);
      const key = `${tag}@${(inj / 60000).toFixed(1)}`;
      if (r.ok) {
        const offs = r.anchors.map((a) => a.offsetMs / 60000).sort((a, b) => a - b);
        row.legs[key] = { ok: true, n: r.anchors.length, cand: r.candidates, med: med(offs), lo: offs[0], hi: offs[offs.length - 1] };
      } else row.legs[key] = { ok: false, why: r.reason, cand: r.candidates };
    }
  }
  res.push(row);

  const F = (k) => {
    const L = row.legs[k];
    if (!L) return '        -   ';
    if (!L.ok) return `  ${(L.why || '').slice(0, 22).padEnd(22)}`;
    return `${L.med.toFixed(2).padStart(8)} (${L.n}/${L.cand}) [${L.lo.toFixed(1)}..${L.hi.toFixed(1)}]`;
  };
  console.log(`  ${night} ov=${row.ovMin.toFixed(0).padStart(4)}m  C@0 ${F('COARSE@0.0')}  C@-39 ${F('COARSE@-39.0')}  C@+17.5 ${F('COARSE@17.5')}  FINE ${F('FINE@0.0')}`);
}

/* --- verdict --- */
console.log('\n===== VERDICT =====');
function leg(key, label, expectDelta) {
  const ok = res.map((r) => r.legs[key]).filter((L) => L && L.ok);
  if (!ok.length) {
    console.log(`  ${label.padEnd(26)} 0/${res.length} nights aligned at all`);
    return;
  }
  const meds = ok.map((L) => L.med);
  const spread = ok.map((L) => L.hi - L.lo);
  let extra = '';
  if (expectDelta != null) {
    // self-consistency: recovered(I) - recovered(0) should equal ±I
    const pairs = res.filter((r) => r.legs[key] && r.legs[key].ok && r.legs['COARSE@0.0'] && r.legs['COARSE@0.0'].ok);
    const d = pairs.map((r) => r.legs[key].med - r.legs['COARSE@0.0'].med);
    const hit = d.filter((x) => Math.abs(Math.abs(x) - Math.abs(expectDelta)) <= 5).length;
    extra = ` · Δ vs @0 median ${med(d).toFixed(2)} min (want ±${Math.abs(expectDelta)}) · recovered ${hit}/${pairs.length}`;
  } else {
    const hit = meds.filter((x) => Math.abs(x) <= 5).length;
    extra = ` · within ±5 min of the true 0: ${hit}/${ok.length}`;
  }
  console.log(`  ${label.padEnd(26)} ${ok.length}/${res.length} aligned · median offset ${med(meds).toFixed(2)} min · median anchor spread ${med(spread).toFixed(1)} min${extra}`);
}
leg('COARSE@0.0', 'COARSE @ true 0', null);
leg('COARSE@-39.0', 'COARSE @ injected -39', -39);
leg('COARSE@17.5', 'COARSE @ injected +17.5', 17.5);
leg('FINE@0.0', 'FINE @ true 0', null);
