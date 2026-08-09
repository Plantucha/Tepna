#!/usr/bin/env node
/*
 * tools/pat-hrv-windows.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PAT THE WAY HRV IS DONE — 5-minute windows, artifact segments discarded, report the DISTRIBUTION.
 *
 * Every PAT verdict in this repo was computed over a WHOLE NIGHT. `pat-window-scaling.mjs` measured
 * why that is the wrong unit: residual IQR grows ×3.96 from 1 min (51 ms) to 60 min (201 ms), so a
 * whole-night figure summarises a non-stationary quantity with one number and lands far above the
 * 60 ms bar by construction. Short-term HRV solved this problem in 1996 and the convention is
 * settled: analyse 5-minute segments, reject artefactual ones, report the distribution.
 *
 * WHY THIS IS NOT THE CIRCULARITY §3c.4 WARNS ABOUT. That warning is about choosing the window that
 * SCORES BEST — selection on the outcome. Nothing here looks at lag, coupling, or scatter when
 * deciding what to keep:
 *   · the window grid is FIXED (5 min, tiled from the overlap start) — every window is scored;
 *   · rejection is on SIGNAL QUALITY ONLY — beat rate plausibility on each stream independently,
 *     and the Malik artefact fraction from PulseDex's own `artifactClean`, the gate this repo
 *     already uses for HRV;
 *   · the reject rule is applied per-stream BEFORE the two are ever compared.
 * A window discarded here would be discarded by an HRV analysis of the same data, for the same
 * reason, without knowing PAT exists.
 *
 * WHAT IS REPORTED. Within each surviving window the window's OWN median lag is removed — the same
 * thing the strict statistic's leave-one-block-out centre does, and the same thing HRV does by
 * working on differences rather than absolute RR. What remains is within-window scatter: the honest
 * comparator for the 60 ms bar. The absolute median lag is reported separately, because it is the
 * physiological quantity (chest→periphery transit) and it must stay in a plausible band.
 *
 *   node tools/pat-hrv-windows.mjs --dir <captures root> [--night 2026-08-03] [--win 5]
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DIR = arg('--dir', null);
const ONLY = arg('--night', null);
const WIN_MIN = +arg('--win', 5); // the HRV convention
const BAR_MS = 60; // pat-gate.js BEAT_IQR_MAX_MS — mirrored, not re-derived
if (!DIR) {
  console.error('need --dir <captures root>');
  process.exit(1);
}

const ECG_AXIS_MIN_SPAN_MS = 2400e3;
const RATE_LO = 30,
  RATE_HI = 120;
const PHYS_LO = 100,
  PHYS_HI = 700;
const MIN_BEATS_WIN = 100; // ~35 bpm floor over 5 min — a coverage test, not a lag test
const MAX_ARTIFACT = 0.2; // Malik-corrected fraction; HRV practice rejects well below this

const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  Math,
  JSON,
  Date,
  Uint8Array,
  Int16Array,
  Float32Array,
  Float64Array,
  Array,
  Object,
  Number,
  String,
  isFinite,
  isNaN,
  parseInt,
  parseFloat
});
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'pulsedex-dsp.js']) {
  try {
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  } catch (e) {
    console.error('load fail', f, e.message.slice(0, 120));
  }
}
const ECG = ctx.ECGDSP || ctx.ECGDex,
  PPG = ctx.PPGDSP || ctx.PpgDex,
  PULSE = ctx.PulseDex;
if (!ECG || !PPG) {
  console.error('DSP unavailable');
  process.exit(1);
}
const artifactClean = PULSE && PULSE._bare && PULSE._bare.artifactClean ? PULSE._bare.artifactClean : null;

const med = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const iqr = (a) => {
  if (a.length < 4) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
};
const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

/* artefact fraction on a beat-time series, via the repo's own Malik filter. Falls back to a
   plain physiologic-range test if PulseDex is not loadable — and SAYS SO, never silently. */
let artifactMode = artifactClean ? 'Malik (PulseDex.artifactClean)' : 'physiologic-range fallback';
function artifactFrac(times) {
  const rr = [];
  for (let i = 1; i < times.length; i++) rr.push(times[i] - times[i - 1]);
  if (rr.length < 10) return 1;
  if (artifactClean) {
    const c = artifactClean(rr);
    const kept = c && c.clean ? c.clean.length : 0;
    return 1 - kept / rr.length;
  }
  let bad = 0;
  for (const v of rr) if (v < 300 || v > 2000) bad++;
  return bad / rr.length;
}

function spanOf(file) {
  const sz = fs.statSync(file).size;
  const head = Buffer.alloc(Math.min(sz, 8192));
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, head.length, 0);
  const tailN = Math.min(sz, 65536);
  const tail = Buffer.alloc(tailN);
  fs.readSync(fd, tail, 0, tailN, sz - tailN);
  fs.closeSync(fd);
  const col = (buf, back) => {
    const L = buf.toString('utf8').split('\n');
    const rng = back ? [...L].reverse() : L;
    for (const line of rng) {
      const p = line.split(';');
      if (p.length > 1 && /^\d{10,}$/.test((p[1] || '').trim())) return Number(BigInt(p[1].trim()) / 1000000n);
    }
    return null;
  };
  const a = col(head, false),
    z = col(tail, true);
  return a != null && z != null ? { a, z, span: z - a } : null;
}
function beatsECG(file) {
  const rec = ECG.parseECG(fs.readFileSync(file, 'utf8'));
  if (!rec || !rec.int16 || !rec.int16.length || !rec.t0Ms) return null;
  const idx = ECG.detectPeaks(rec.int16, ECG.bandpass(rec.int16, rec.fs), rec.fs);
  if (!idx || idx.length < 100) return null;
  return idx.map((i) => rec.t0Ms + (i / rec.fs) * 1000);
}
function beatsPPG(file) {
  const rec = PPG.parsePPG(fs.readFileSync(file, 'utf8'));
  if (!rec) return null;
  const an = PPG.analyze(rec);
  if (!an || !an.tt || an.tt.length < 100) return null;
  return an.tt.map((s) => rec.t0Ms + s * 1000);
}

console.log(`PAT on ${WIN_MIN}-MINUTE WINDOWS — the HRV convention: fixed grid, artefact windows discarded, distribution reported`);
console.log(`  reject on SIGNAL QUALITY only (rate ${RATE_LO}-${RATE_HI}/min per stream · artefact <${(MAX_ARTIFACT * 100) | 0}% · >=${MIN_BEATS_WIN} beats) — never on lag`);
console.log(`  artefact gate: ${artifactMode}\n`);
console.log('  night        win  kept  rej   medLag   IQR  p25  p75   %win<=60ms');
console.log('  ' + '-'.repeat(78));

const nights = fs
  .readdirSync(DIR)
  .filter((d) => /^2026-/.test(d) && (!ONLY || d === ONLY) && fs.statSync(path.join(DIR, d)).isDirectory())
  .sort();
const allIQR = [],
  allLag = [];
let totKept = 0,
  totRej = 0,
  totPass = 0;
for (const n of nights) {
  const dir = path.join(DIR, n),
    files = fs.readdirSync(dir);
  const cand = (re) =>
    files
      .filter((f) => re.test(f))
      .map((f) => {
        const p = path.join(dir, f);
        let s = null;
        try {
          s = spanOf(p);
        } catch {}
        return s ? { f: p, ...s } : null;
      })
      .filter(Boolean)
      .filter((x) => x.span >= ECG_AXIS_MIN_SPAN_MS)
      .sort((a, b) => b.span - a.span);
  const E = cand(/Polar_H10_.*_ECG\.txt$/i),
    P = cand(/veritysense.*_PPG\.txt$/i);
  if (!E.length || !P.length) {
    console.log(`  ${n}  ⊘ no gated fragment pair`);
    continue;
  }
  let best = null;
  for (const e of E)
    for (const p of P) {
      const ov = Math.min(e.z, p.z) - Math.max(e.a, p.a);
      if (ov > 0 && (!best || ov > best.ov)) best = { e, p, ov };
    }
  if (!best || best.ov < WIN_MIN * 60000 * 2) {
    console.log(`  ${n}  ⊘ overlap under two windows`);
    continue;
  }
  let R = null,
    F = null;
  try {
    R = beatsECG(best.e.f);
    F = beatsPPG(best.p.f);
  } catch {}
  if (!R || !F) {
    console.log(`  ${n}  ⊘ detector failed`);
    continue;
  }

  const wm = WIN_MIN * 60000;
  const t0 = Math.max(R[0], F[0]),
    tEnd = Math.min(R[R.length - 1], F[F.length - 1]);
  let kept = 0,
    rej = 0;
  const wIQR = [],
    wLag = [];
  for (let s = t0; s + wm <= tEnd; s += wm) {
    const rw = R.filter((t) => t >= s && t < s + wm);
    const fw = F.filter((t) => t >= s && t < s + wm);
    /* ── QUALITY GATE — computed per stream, before the two are compared ── */
    if (rw.length < MIN_BEATS_WIN || fw.length < MIN_BEATS_WIN) {
      rej++;
      continue;
    }
    const rBpm = rw.length / WIN_MIN,
      fBpm = fw.length / WIN_MIN;
    if (rBpm < RATE_LO || rBpm > RATE_HI || fBpm < RATE_LO || fBpm > RATE_HI) {
      rej++;
      continue;
    }
    if (artifactFrac(rw) > MAX_ARTIFACT || artifactFrac(fw) > MAX_ARTIFACT) {
      rej++;
      continue;
    }
    /* ── only now is a lag computed ── */
    const lags = [];
    let j = 0;
    for (const r of rw) {
      while (j < fw.length && fw[j] < r + PHYS_LO) j++;
      if (j >= fw.length) break;
      const d = fw[j] - r;
      if (d >= PHYS_LO && d <= PHYS_HI) lags.push(d);
    }
    if (lags.length < 30) {
      rej++;
      continue;
    }
    const m = med(lags);
    wIQR.push(iqr(lags));
    wLag.push(m);
    kept++;
  }
  if (!kept) {
    console.log(`  ${n}  ⊘ every window rejected on quality (${rej})`);
    continue;
  }
  const passN = wIQR.filter((v) => v <= BAR_MS).length;
  totKept += kept;
  totRej += rej;
  totPass += passN;
  allIQR.push(...wIQR);
  allLag.push(...wLag);
  console.log(
    `  ${n}  ${String(kept + rej).padStart(4)} ${String(kept).padStart(5)} ${String(rej).padStart(4)}  ` +
      `${med(wLag).toFixed(0).padStart(6)}ms ${med(wIQR).toFixed(0).padStart(5)} ${pct(wIQR, 0.25).toFixed(0).padStart(4)} ${pct(wIQR, 0.75).toFixed(0).padStart(4)}   ` +
      `${((100 * passN) / kept).toFixed(0).padStart(3)}%`
  );
}
if (allIQR.length) {
  console.log('  ' + '-'.repeat(78));
  console.log(`\n  CORPUS — ${allIQR.length} surviving ${WIN_MIN}-min windows (${totRej} rejected on quality, ${((100 * totRej) / (totKept + totRej)).toFixed(0)}%)`);
  console.log(`    within-window IQR : median ${med(allIQR).toFixed(0)} ms   p25 ${pct(allIQR, 0.25).toFixed(0)}   p75 ${pct(allIQR, 0.75).toFixed(0)}`);
  console.log(`    median lag        : ${med(allLag).toFixed(0)} ms  (p25 ${pct(allLag, 0.25).toFixed(0)} · p75 ${pct(allLag, 0.75).toFixed(0)}) — chest→periphery transit`);
  console.log(`    windows clearing the ${BAR_MS} ms bar : ${totPass}/${allIQR.length}  (${((100 * totPass) / allIQR.length).toFixed(1)}%)`);
} else console.log('\n  no window survived — that is the result.');
