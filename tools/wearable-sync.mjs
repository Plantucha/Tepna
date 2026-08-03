#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ── wearable-sync — ARE THE WEARABLES ON THE SAME TIMELINE? ──────────────────
   Every clock tool in this repo measures a wearable against the CPAP. None
   compared the wearables with EACH OTHER, and all of them assumed they agreed.
   Measured, they do not: the H10 and the Verity sit ~3.3 s apart on 24 of 24
   phone-captured nights (median 3.3 s, NOT ONE inside 1 s) and ~0.2 s apart on
   all 6 nights captured by the vigil box. A systematic bias that survived months
   because no code ever made the comparison.

   Two accelerometers strapped to one body see the same turn at the same instant —
   physics, no physiology in between — so ACC-vs-ACC is the only contrast that can
   check this on EVERY night, rather than on the 8 of 31 where the sparse
   `movement_onset` event channel happened to clear its null.

   The estimator is `IntegratorDSP.alignEnvelopes` (gated: `integrator-dsp ·
   acc-align`), which reports a constant offset AND clock drift in ppm from
   windowed normalized cross-correlation — the published practice, cited in the
   module. This tool only finds files, parses them and prints.

   USAGE
     node tools/wearable-sync.mjs --src <capture dir> [--night YYYY-MM-DD]
                                  [--window 600] [--hop 300] [--max-lag 30]
                                  [--fs 10] [--json out.json] [--skip-existing]

   RUN IT DAILY, NOT IN BATCHES. A whole-corpus sweep is ~1-2 min per night, so 30
   nights is half an hour and a month of backlog is an afternoon — the work grows
   faster than anyone wants to wait for it, and an unmeasured night is
   indistinguishable from a synchronised one until someone looks. One night costs
   ~1-2 min:
     node tools/wearable-sync.mjs --src <captures> --night $(date +%F) \
          --json wearable-sync.json --skip-existing
   `--skip-existing` reads the ledger back and re-measures only what is missing, so
   the same command is safe to run on a timer and cheap to re-run after a failure.
   `--fs 4` costs ~6x less than the 10 Hz default and still resolves the offsets
   seen on this corpus (0.1-4.9 s); 10 Hz is for when the answer is near zero.

   A night is REPORTED WITH ITS REASON when it cannot be measured — a quiet night
   with no shared movement is a real outcome, not an error, and printing nothing
   would let an unmeasured night pass as a synchronised one. */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const SRC = opt('--src', null);
const ONLY = opt('--night', null);
const FS_HZ = parseFloat(opt('--fs', '10'));
const WIN = parseFloat(opt('--window', '600'));
const HOP = parseFloat(opt('--hop', '300'));
const MAXLAG = parseFloat(opt('--max-lag', '30'));
const JSON_OUT = opt('--json', null);
const SKIP_EXISTING = argv.includes('--skip-existing');
if (!SRC || !existsSync(SRC)) {
  console.error('wearable-sync: --src <capture dir> is required and must exist');
  process.exit(2);
}

/* The DSP is loaded into a plain context the same way every other analysis tool in
   this repo does it, so the gated implementation runs — not a copy of it. */
const ctx = { console, Math, Date, JSON, isFinite, parseFloat, parseInt, Float64Array, Array, Object, String, Number, setTimeout };
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
createContext(ctx);
for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'integrator-dsp.js']) runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
const DSP = ctx.IntegratorDSP;

/* TWO vendor timestamp layouts live in this corpus — `YYYYMMDDHHMMSS_ACC` (box)
   and `YYYYMMDD_HHMMSS_ACC` (phone). A regex that matched only the first silently
   skipped every pre-box night while reporting a clean run over the rest, which is
   how a 24-night blind spot looks from the outside. Both are matched explicitly,
   per the Clock Contract's "explicit vendor formats by regex" rule. */
const STAMP = /_(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})_ACC/;
const stampMs = (f) => {
  const m = STAMP.exec(f);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};
const IS_H10 = /^Polar_H10_.*_ACC\.txt$/;
const IS_VER = /^Polar_(Sense|VeritySense)_.*_ACC\.txt$/;
// The evening owns the night: a file starting before noon belongs to the previous date.
const nightOf = (ms) => new Date(new Date(ms).getUTCHours() < 12 ? ms - 86400000 : ms).toISOString().slice(0, 10);

const walk = (d, out = []) => {
  let ents = [];
  try {
    ents = readdirSync(d, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push({ name: e.name, path: p });
  }
  return out;
};
const index = {};
for (const { name, path } of walk(SRC)) {
  const t = stampMs(name);
  if (t == null) continue;
  const dev = IS_H10.test(name) ? 'H10' : IS_VER.test(name) ? 'VER' : null;
  if (!dev) continue;
  const k = nightOf(t);
  (index[k] ||= { H10: [], VER: [] })[dev].push({ path, t });
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;
/* Bin tri-axial ACC onto a uniform grid as MEAN ABSOLUTE SAMPLE-TO-SAMPLE CHANGE.
   The differencing removes gravity and posture before any resampling, so a device
   lying at a different tilt cannot contribute a constant that survives binning. A
   slot no sample reached stays NaN — never 0, which the correlator would read as
   "measured stillness" rather than "not measured". */
function gridMotion(files, t0, t1, fs) {
  const n = Math.floor(((t1 - t0) / 1000) * fs);
  if (n <= 0) return null;
  const sum = new Float64Array(n),
    cnt = new Float64Array(n);
  for (const { path } of files) {
    let txt;
    try {
      txt = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const lines = txt.split('\n');
    if (lines.length < 10) continue;
    const head = lines[0].split(';').map((s) => s.trim().toLowerCase());
    const ix = ['x', 'y', 'z'].map((c) => head.findIndex((h) => h.startsWith(c)));
    if (ix.some((v) => v < 0)) continue;
    let px = null,
      py = 0,
      pz = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      if (c.length < 4) continue;
      const m = ISO.exec(c[0]);
      if (!m) continue;
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
      const x = +c[ix[0]],
        y = +c[ix[1]],
        z = +c[ix[2]];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      if (px != null && ms >= t0 && ms < t1) {
        const b = Math.floor(((ms - t0) / 1000) * fs);
        if (b >= 0 && b < n) {
          sum[b] += Math.abs(x - px) + Math.abs(y - py) + Math.abs(z - pz);
          cnt[b]++;
        }
      }
      px = x;
      py = y;
      pz = z;
    }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = cnt[i] ? Math.log1p(sum[i] / cnt[i]) : NaN;
  return out;
}

/* Already-measured nights, so a daily run is incremental. Only nights that were
   actually MEASURED are skipped: a night that failed for want of shared movement
   is retried, because the raw data may since have grown (a late session sync), and
   silently inheriting an old failure is how a blind spot becomes permanent. */
let prior = [];
if (SKIP_EXISTING && JSON_OUT && existsSync(JSON_OUT)) {
  try {
    prior = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    console.error(`wearable-sync: ${JSON_OUT} is unreadable — measuring everything rather than trusting it`);
    prior = [];
  }
}
const done = new Set(prior.filter((r) => r && r.confident).map((r) => r.night));
const keys = Object.keys(index)
  .filter((k) => (!ONLY || k === ONLY) && index[k].H10.length && index[k].VER.length && !done.has(k))
  .sort();
if (done.size) console.log(`skipping ${done.size} night(s) already measured in ${JSON_OUT}\n`);
if (!keys.length) {
  /* "Nothing left to do" is SUCCESS, not failure. On a daily timer the second run
     of the day has nothing new, and exiting non-zero there would cry wolf every
     day until the alert is ignored — which is how a real failure gets missed. */
  if (done.size) {
    console.log(`nothing new — all ${done.size} night(s) already measured in ${JSON_OUT}`);
    process.exit(0);
  }
  console.error(`wearable-sync: no night under ${SRC} has BOTH an H10 and a Verity ACC file`);
  process.exit(1);
}
console.log(`wearable-sync — H10 vs Verity, ${keys.length} night(s), ${WIN}s windows / ${HOP}s hop / +/-${MAXLAG}s search @ ${FS_HZ} Hz\n`);
/* `drift(ppm)` prints a dash unless the slope is IDENTIFIABLE (§F7), and `spread` rides beside MAD
   because MAD alone reports 0.00 on a quantised plateau while two windows sit 1.2 s away. Same rule as
   the trio printer: a number does not appear without the thing that bounds it. */
console.log('night        H10 VER   span   offset(s)  drift(ppm)  usable  medR   MAD spread  verdict');
const rows = [];
for (const k of keys) {
  const g = index[k];
  const t0 = Math.max(Math.min(...g.H10.map((x) => x.t)), Math.min(...g.VER.map((x) => x.t)));
  const t1 = t0 + 12 * 3600000;
  const A = gridMotion(g.H10, t0, t1, FS_HZ),
    B = gridMotion(g.VER, t0, t1, FS_HZ);
  if (!A || !B) {
    console.log(`${k}  — could not grid one of the streams`);
    continue;
  }
  const r = DSP.alignEnvelopes(A, B, FS_HZ, { windowSec: WIN, hopSec: HOP, maxLagSec: MAXLAG, nullIters: 20 });
  const span = (Math.min(A.length, B.length) / FS_HZ / 3600).toFixed(2);
  const row = { night: k, nH10: g.H10.length, nVer: g.VER.length, spanH: +span, ...r };
  delete row.windows; // the per-window detail is for --json, not the console
  rows.push({ ...row, windows: r.windows });
  console.log(
    `${k} ${String(g.H10.length).padStart(4)}${String(g.VER.length).padStart(4)} ${span.padStart(6)} h` +
      (r.offsetSec == null
        ? '        —          —        —     —      —   '
        : `${r.offsetSec.toFixed(2).padStart(10)}${(r.driftPpm == null ? '—' : r.driftPpm.toFixed(1)).padStart(12)}${(r.nUsable + '/' + r.nWindows).padStart(8)}${(r.medR == null ? '—' : r.medR.toFixed(2)).padStart(7)}${(r.madSec == null ? '—' : r.madSec.toFixed(2)).padStart(6)}${(r.lagSpreadSec == null ? '—' : r.lagSpreadSec.toFixed(2)).padStart(7)}  `) +
      (r.confident ? 'MEASURED' : `— ${(r.reason || '').slice(0, 52)}`)
  );
}
const ok = rows.filter((r) => r.confident);
console.log(`\n${ok.length} of ${rows.length} night(s) measured.`);
if (ok.length) {
  const L = ok.map((r) => r.offsetSec).sort((a, b) => a - b);
  const med = L[L.length >> 1];
  console.log(`offset: median ${med.toFixed(2)} s   range ${L[0].toFixed(2)} … ${L[L.length - 1].toFixed(2)} s`);
  console.log(`|offset| > 1 s on ${ok.filter((r) => Math.abs(r.offsetSec) > 1).length} of ${ok.length} measured night(s)`);
  const D2 = ok
    .filter((r) => r.driftPpm != null)
    .map((r) => r.driftPpm)
    .sort((a, b) => a - b);
  /* The drift summary reports how many nights it could NOT resolve, first. A median over the survivors
     alone is a selected statistic — the earlier version quoted one across nights where 7 of 14 were an
     atom at exactly 0.0 ppm, which reads as agreement and is a quantisation artefact (§F7). */
  const nRefused = ok.length - D2.length;
  if (D2.length)
    console.log(`drift : median ${D2[D2.length >> 1].toFixed(1)} ppm   range ${D2[0].toFixed(1)} … ${D2[D2.length - 1].toFixed(1)} ppm   (over the ${D2.length} night(s) where it is identifiable)`);
  if (nRefused)
    console.log(
      `drift : NOT IDENTIFIABLE on ${nRefused} of ${ok.length} measured night(s) — the slope's 95% interval spans zero, or its median is a quantised-lag tie block. Those nights have an offset and no drift, which is the honest pair.`
    );
  /* A wearable offset above a second is not a rounding detail: it is larger than every physiological
     latency this suite measures between these two devices, so it corrupts any cross-device timing
     before the physiology is even reached. Say so rather than printing a number and moving on. */
  const bad = ok.filter((r) => Math.abs(r.offsetSec) > 1);
  if (bad.length)
    console.log(
      `\n⚠ ${bad.length} night(s) exceed 1 s — larger than the cross-device physiological latencies measured on this corpus, so any cross-device timing on those nights carries it as a bias.`
    );
}
if (JSON_OUT) {
  // Merge, never overwrite: a daily run must not drop the nights it skipped.
  const merged = prior.filter((r) => r && !rows.some((n) => n.night === r.night)).concat(rows);
  merged.sort((a, b) => (a.night < b.night ? -1 : 1));
  writeFileSync(JSON_OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nper-window detail → ${JSON_OUT}`);
}
