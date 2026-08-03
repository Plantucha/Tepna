#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * cgm-variability-check.mjs — does GlucoDex's variability family actually need a ROBUST scale?
 * ----------------------------------------------------------------------------
 * `TCH-FUSED-ROBUST-HAT-FOLLOWUPS` §5 / Do 4 carries a transfer hypothesis: RMSSD/SDNN/CV/MAGE are
 * all variance-family estimators with breakdown point 0, so the artifact fix built for the
 * three-cornered hat should transfer to GlucoDex — "compression lows inflate CV/SD/MAGE".
 *
 * It is a HYPOTHESIS, marked "principle-transfer" in that brief, and it had never been measured.
 * This tool measures it, because a robust estimator swapped in on principle is a compute-path change
 * to `validated`-tier headline KPIs bought with no evidence.
 *
 * ── THE TEST ────────────────────────────────────────────────────────────────────────────────────
 *
 * A breakdown-point-0 estimator is only WRONG when the data has a tail for it to break on. The
 * discriminator is `SD / MADn` (MADn = 1.4826 · median|x − median|, the Gaussian-consistent robust
 * scale): it is 1.00 on a clean Gaussian and rises with tail mass. If it sits at ~1, a robust swap
 * moves nothing and the hypothesis does not apply to this signal — which is a real answer, not a
 * failure to find one.
 *
 * The tool ALSO splits the day, because a nocturnal artifact can shift the LEVEL without adding
 * VARIANCE, and those two land on completely different metric families: level → mean/GMI/TIR/TBR/LBGI
 * (the validated-tier headline numbers), variance → SD/CV/MAGE. Reporting only the variance answer
 * would have said "no problem here" while leaving the actual exposure unnamed.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────────────────────
 *
 * It does not LABEL compression lows. Without reference glucose that is unfalsifiable from the trace
 * alone, and this suite does not upgrade an inference to a finding by naming it confidently. It
 * reports the nocturnal enrichment and says what would be needed to call it.
 *
 * USAGE  node tools/cgm-variability-check.mjs [--csv <lingo csv>]
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const R = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const CSV = opt('--csv', R + 'uploads/lingo-glucose-data-2026-MAY-23.csv');

if (!fs.existsSync(CSV)) {
  console.log(`no CGM csv at ${CSV}\n  (the real Lingo export is gitignored — pass --csv <path>)`);
  process.exit(0);
}

/* ── parse through the SHIPPED clock, never Date.parse ──────────────────────────────────────────
   The Lingo export stamps `YYYY-MM-DDThh:mm±hh:mm`. Reading the hour off the raw string would be a
   second parser; `DexClock` already owns the Clock Contract, so the hour comes from `getUTC*` on the
   floating tMs it returns. */
const ctx = { console, Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Number, String, Array, Object, RegExp, Error, Map, Set, Symbol };
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
const DexBuild = require(R + 'tools/build-core.js');
for (const f of ['kernel-constants.js', 'clock.js']) vm.runInContext(DexBuild.classicify(fs.readFileSync(R + f, 'utf8'), f), ctx, { filename: f });

const rows = [];
const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
let unparsed = 0;
for (const ln of lines.slice(1)) {
  const c = ln.split(',');
  const g = +c[c.length - 1];
  if (!isFinite(g) || g <= 0) continue;
  ctx.__s = String(c[0]).trim();
  const tMs = vm.runInContext('(function(){var p=DexClock.parseTimestamp(__s);return p?p.tMs:null;})()', ctx);
  if (tMs == null) {
    unparsed++;
    continue;
  }
  rows.push({ tMs, h: new Date(tMs).getUTCHours(), g });
}
if (rows.length < 100) {
  console.log(`only ${rows.length} readings parsed (${unparsed} unparsed) — not enough to judge`);
  process.exit(0);
}
rows.sort((a, b) => a.tMs - b.tMs);

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
const med = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const madn = (a) => {
  const m = med(a);
  return 1.4826 * med(a.map((x) => Math.abs(x - m)));
};

const vals = rows.map((r) => r.g);
const spanD = (rows[rows.length - 1].tMs - rows[0].tMs) / 86400000;
console.log(`CGM variability — ${vals.length} readings over ${spanD.toFixed(1)} d  (${unparsed} unparsed)\n`);

const M = mean(vals),
  S = std(vals),
  Mr = med(vals),
  Sr = madn(vals);
const ratio = Sr > 0 ? S / Sr : null;
console.log('── does the variance family need a ROBUST scale? ──');
console.log(`  classical   mean ${M.toFixed(1)}  SD ${S.toFixed(2)}  CV ${((100 * S) / M).toFixed(1)} %`);
console.log(`  robust      med  ${Mr.toFixed(1)}  MADn ${Sr.toFixed(2)}  CV ${((100 * Sr) / Mr).toFixed(1)} %`);
console.log(`  SD / MADn = ${ratio.toFixed(3)}   (1.00 on a clean Gaussian; a heavy tail drives it up)`);
console.log(`  ⇒ swapping to a robust scale would move CV by ${Math.abs((100 * S) / M - (100 * Sr) / Mr).toFixed(2)} percentage points.`);

/* ── the level/variance split ───────────────────────────────────────────────────────────────────
   Dayparts mirror GlucoDex's own `daypart` windows so the two are directly comparable. */
const parts = [
  ['overnight 00-06', (h) => h >= 0 && h < 6],
  ['morning   06-12', (h) => h >= 6 && h < 12],
  ['afternoon 12-18', (h) => h >= 12 && h < 18],
  ['evening   18-24', (h) => h >= 18 && h < 24]
];
console.log('\n── level vs variance, by daypart (a nocturnal artifact can move one without the other) ──');
console.log('  window            n     mean    CV%    <70%    <54%');
const tbrBy = {};
for (const [name, f] of parts) {
  const v = rows.filter((r) => f(r.h)).map((r) => r.g);
  if (!v.length) continue;
  const m = mean(v),
    lo = v.filter((x) => x < 70).length,
    vlo = v.filter((x) => x < 54).length;
  tbrBy[name] = (100 * lo) / v.length;
  console.log(
    `  ${name}  ${String(v.length).padStart(5)}  ${m.toFixed(1).padStart(6)}  ${(((100 * std(v)) / m) | 0).toString().padStart(4)}   ${((100 * lo) / v.length).toFixed(1).padStart(5)}   ${((100 * vlo) / v.length).toFixed(1).padStart(5)}`
  );
}
const night = tbrBy['overnight 00-06'] ?? 0;
const dayKeys = Object.keys(tbrBy).filter((k) => k !== 'overnight 00-06');
const dayTbr = dayKeys.length ? mean(dayKeys.map((k) => tbrBy[k])) : 0;
console.log(`\n  nocturnal <70 enrichment: ${dayTbr > 0 ? (night / dayTbr).toFixed(2) : 'n/a'}x  (overnight ${night.toFixed(1)} % vs daytime mean ${dayTbr.toFixed(1)} %)`);

console.log('\n── verdict ──');
if (ratio != null && ratio < 1.2) {
  console.log(`  The variance family is NOT tail-dominated here (SD/MADn ${ratio.toFixed(2)} < 1.2), so a robust`);
  console.log('  scale has nothing to fix. If a nocturnal enrichment is present it is a LEVEL shift, and');
  console.log('  the exposed metrics are mean / GMI / TIR / TBR / LBGI — not SD / CV / MAGE.');
} else {
  console.log(`  SD/MADn ${ratio.toFixed(2)} — a heavy tail IS present; a robust scale is worth costing.`);
}
console.log('\n  NOT CLAIMED: that the nocturnal readings are compression lows. From the trace alone that is');
console.log('  unfalsifiable — it needs concurrent reference glucose, or a second sensor on the other arm.');
