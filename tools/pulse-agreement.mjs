#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pulse-agreement.mjs — the O2Ring's 1 Hz VENDOR pulse vs an HR derived from its own finger PPG.
 * ----------------------------------------------------------------------------
 * OXYDEX-PULSE-RESOURCING-FOLLOWUPS §3 asks for the MEASURED agreement on the real corpus; the parent
 * only has a synthetic (Δ≈2 bpm). A negative result is explicitly allowed.
 *
 * WHAT THIS TOOL REFUSES TO DO, and why it is the point. A first pass compared the largest PPG FRAGMENT
 * against the WHOLE-NIGHT vendor median and produced bias −0.83 bpm, SD 4.58, LoA −9.8…+8.1 — numbers
 * that look publishable and are meaningless, because the two series cover different spans. Restricting
 * to a matched window then revealed that on 5 of 6 nights the fragment and the vendor file share
 * ZERO samples: they are different capture sessions on the same date.
 *
 * So the tool SKIPS a night it cannot window-match and says how many it skipped, rather than falling
 * back to a whole-night median. A silent fallback converts "these files do not overlap" into a bias,
 * which is the same failure shape as reporting a sentinel-filled file as coverage
 * (CPAP-SA2-OXIMETRY-SOURCE, refuted the same day).
 *
 * Both sides are stamped with `DexClock.parseTimestamp`, never `Date.parse` — the O2Ring writes
 * `HH:MM:SS DD/MM/YYYY`, which `Date.parse` silently returns NaN for. An earlier pass did exactly that,
 * matched nothing, and fell through to the invalid comparison above without erroring.
 *
 * STATUS: n=1 validly-matched night is NOT an answer to §3. Sound pairing needs SESSION-level alignment
 * across the 117 fragments, not one-file-per-night — see the brief.
 *
 * USAGE  node tools/pulse-agreement.mjs
 * ════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const R = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const DexBuild = require(R + 'tools/build-core.js');
const el = () => ({
  style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {},
  addEventListener() {},
  setAttribute() {},
  getAttribute: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  insertAdjacentHTML() {},
  get textContent() {
    return '';
  },
  set textContent(v) {},
  get innerHTML() {
    return '';
  },
  set innerHTML(v) {},
  getContext: () => null
});
const ctx = {
  console,
  Date,
  Math,
  JSON,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  Object,
  Array,
  String,
  Number,
  Error,
  Float32Array,
  Float64Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  ArrayBuffer,
  DataView,
  TextDecoder,
  TextEncoder,
  setTimeout,
  clearTimeout,
  performance,
  URL,
  crypto,
  RegExp,
  Map,
  Set,
  Symbol,
  Promise
};
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
ctx.document = { createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, head: el(), body: el(), documentElement: el() };
ctx.navigator = { userAgent: 'node' };
vm.createContext(ctx);
for (const f of ['kernel-constants.js', 'clock.js', 'ppgdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(R + f, 'utf8'), f), ctx, { filename: f });

const nights = ['20260725', '20260726', '20260727', '20260728', '20260729', '20260730', '20260731'];
const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
console.log('night     PPG frags  ppgHR   vendorHR   delta   n(vend)  comparison');
const deltas = [];
let skipped = 0;
for (const n of nights) {
  const ppgs = execSync(`find /run/media/michal/647A504F7A50205A -name "*O2Ring*${n}*_PPG.txt" 2>/dev/null | sort -u`).toString().trim().split('\n').filter(Boolean);
  const uniq = [...new Map(ppgs.map((p) => [p.split('/').pop(), p])).values()];
  const csv = execSync(`find /run/media/michal/647A504F7A50205A -name "*O2Ring*${n}*_SPO2.csv" 2>/dev/null | head -1`).toString().trim();
  if (!uniq.length || !csv) {
    console.log(`  ${n}  (missing)`);
    continue;
  }
  // vendor 1 Hz pulse from the SPO2 csv
  const lines = readFileSync(csv, 'utf8').trim().split('\n');
  const hdr = lines[0].split(/[;,]/).map((x) => x.trim().toLowerCase());
  const pi = hdr.findIndex((h) => /pulse|hr\b|heart/.test(h));
  const ti = hdr.findIndex((h) => /time|stamp/.test(h));
  const vendAll = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(/[;,]/);
    const v = +c[pi];
    /* Clock Contract §2.4: NEVER Date.parse a vendor string. The O2Ring writes `HH:MM:SS DD/MM/YYYY`,
       which Date.parse returns NaN for — a first pass did exactly that, matched zero samples, silently
       fell back to a whole-night median and produced an invalid comparison that looked fine. */
    const t =
      ti >= 0
        ? (function () {
            ctx.__s = String(c[ti]).trim();
            const r = vm.runInContext('(function(){var p=DexClock.parseTimestamp(__s,{preferDMY:true});return p?p.tMs:null;})()', ctx);
            return r == null ? NaN : r;
          })()
        : NaN;
    if (isFinite(v) && v >= 30 && v <= 220) vendAll.push({ t: isFinite(t) ? t : null, v });
  }
  // ppg-derived HR: parse the largest fragment, detect beats, median HR
  let best = null,
    bestN = 0;
  for (const p of uniq) {
    if (!existsSync(p)) continue;
    const sz = readFileSync(p, 'utf8').length;
    if (sz > bestN) {
      bestN = sz;
      best = p;
    }
  }
  if (!best) {
    console.log('  ' + n + '  (no readable PPG fragment)');
    continue;
  }
  const bestTxt = readFileSync(best, 'utf8');
  // WINDOW-MATCH: the PPG fragment covers part of the night; comparing it against a WHOLE-NIGHT vendor
  // median mixes real bias with sampling two different time spans. Restrict the vendor pulse to the
  // fragment's own [t0,t1] before comparing. (First pass did not do this — the numbers moved.)
  const fl = bestTxt.trim().split('\n');
  const pt = (ln) => {
    const m = String(ln).match(/^([^;,\t]+)/);
    if (!m) return NaN;
    ctx.__s = m[1].trim();
    const r = vm.runInContext('(function(){var p=DexClock.parseTimestamp(__s);return p?p.tMs:null;})()', ctx);
    return r == null ? NaN : r;
  };
  let t0 = NaN,
    t1 = NaN;
  for (let i = 1; i < fl.length; i++) {
    const v = pt(fl[i]);
    if (isFinite(v)) {
      t0 = v;
      break;
    }
  }
  for (let i = fl.length - 1; i > 0; i--) {
    const v = pt(fl[i]);
    if (isFinite(v)) {
      t1 = v;
      break;
    }
  }
  const inWin = isFinite(t0) && isFinite(t1) ? vendAll.filter((r) => r.t != null && r.t >= t0 - 60000 && r.t <= t1 + 60000) : [];
  /* NO SILENT FALLBACK. A first pass fell back to the whole-night median when the window did not match,
     which converts "these two files do not overlap" into a bias number — the same shape as reporting a
     sentinel-filled file as coverage. An unmatched night is SKIPPED and counted, not estimated. */
  const matched = inWin.length >= 30;
  if (!matched) {
    console.log(`  ${n}  ${String(uniq.length).padStart(3)}     — no overlapping vendor window (${inWin.length} samples) — SKIPPED`);
    skipped++;
    continue;
  }
  const vend = inWin.map((r) => r.v);
  ctx.__t = bestTxt;
  let ppgHR = null;
  try {
    ppgHR = JSON.parse(
      vm.runInContext(
        `(function(){
    const rec=PPGDSP.parsePPG(__t); const a=PPGDSP.analyze(rec);
    return JSON.stringify(a && a.hrv && a.hrv.time ? a.hrv.time.hr : (a?a.hr:null));
  })()`,
        ctx
      )
    );
  } catch (e) {
    ppgHR = 'ERR';
  }
  const vm_ = med(vend);
  const d = typeof ppgHR === 'number' && vm_ != null ? +(ppgHR - vm_).toFixed(1) : null;
  if (d != null) deltas.push(d);
  console.log(
    `  ${n}  ${String(uniq.length).padStart(3)}     ${String(ppgHR).padStart(6)}   ${String(vm_).padStart(6)}   ${String(d).padStart(6)}   ${String(vend.length).padStart(5)}  ${matched ? 'window-matched' : 'WHOLE-NIGHT (unmatched)'}`
  );
}
console.log(`\n${deltas.length} night(s) validly compared · ${skipped} skipped for want of an overlapping window`);
if (deltas.length >= 3) {
  const m = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, deltas.length - 1));
  console.log(`\nn=${deltas.length} nights · bias (ppg - vendor) = ${m.toFixed(2)} bpm · SD ${sd.toFixed(2)} · range ${Math.min(...deltas)}..${Math.max(...deltas)}`);
  console.log(`Bland-Altman LoA (bias +/- 1.96 SD): ${(m - 1.96 * sd).toFixed(2)} .. ${(m + 1.96 * sd).toFixed(2)} bpm`);
} else if (deltas.length) {
  console.log(`deltas: ${deltas.join(', ')} bpm — too few for a distribution; reporting the values, not a bias.`);
}
