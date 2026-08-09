#!/usr/bin/env node
/*
 * tools/pat-window-scaling.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DOES PAT SCATTER GROW WITH WINDOW LENGTH? — the one measurement that separates DRIFT from PHYSIOLOGY.
 *
 * Clinical PAT/PWV is a SHORT-RECORDING measurement (minutes). This repo has only ever asked the
 * whole-night question, and whole-night scatter (84–99 ms) has been read as PTT variability. But the
 * two candidate causes make OPPOSITE predictions about window length, and nobody has looked:
 *
 *   DRIFT / MISALIGNMENT  — a rate error integrates. At the measured −2.3…−81.6 ppm, a 60 min window
 *                           accumulates up to 290 ms while a 1 min window accumulates 5 ms. So scatter
 *                           must GROW, roughly linearly, with window length.
 *   PHYSIOLOGY (PEP+PTT)  — beat-to-beat variability is stationary on these scales. Scatter is FLAT.
 *
 * A flat curve indicts the physiology and PAT is genuinely unreachable from ECG. A rising curve says
 * the instrument was integrating its own clock error and PAT is recoverable in short windows — which
 * is how the measurement is done clinically anyway.
 *
 * SELECTION IS STRUCTURAL, NEVER OUTCOME-BASED. `PAT-UNDER-PERBLOCK-ALIGNMENT` §3c.4 records that
 * pair selection here is unprincipled — "longest is arbitrary, highest-scoring is circular". Choosing
 * windows by their coupling score would manufacture the result. So windows are chosen ONLY by capture
 * integrity, all of which is knowable before any lag is computed:
 *   · inside ONE ECG fragment and ONE PPG fragment — no reconnect boundary, hence no step
 *   · both fragments span ≥ ECG_AXIS_MIN_SPAN_MS, so ECGDex's fs correction actually FIRED
 *   · detector plausibility 30–120 bpm on both streams (the finger tool skips 131–688/min as not-beats)
 * The window LENGTH sweep is then run over the same beats, so every point shares one selection.
 *
 *   node tools/pat-window-scaling.mjs --dir <captures root> [--night 2026-08-03]
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
if (!DIR) {
  console.error('need --dir <captures root>');
  process.exit(1);
}

const ECG_AXIS_MIN_SPAN_MS = 2400e3; // ECGDex's own span gate — mirrored, not re-derived
const RATE_LO = 30,
  RATE_HI = 120; // detector plausibility, as the sibling tools use
const PHYS_LO = 100,
  PHYS_HI = 700; // R-peak → foot, chest→periphery
const WINDOWS_MIN = [1, 2, 5, 10, 30, 60]; // the sweep

/* ── realm ── */
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
for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) {
  try {
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  } catch (e) {
    console.error('load fail', f, e.message.slice(0, 120));
  }
}
const ECG = ctx.ECGDSP || ctx.ECGDex,
  PPG = ctx.PPGDSP || ctx.PpgDex;
if (!ECG || !PPG) {
  console.error('DSP modules unavailable:', !!ECG, !!PPG);
  process.exit(1);
}

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

/* ── fragment inventory: span from the device column, so it matches ECGDex's own gate ── */
function spanOf(file) {
  const sz = fs.statSync(file).size;
  const head = Buffer.alloc(Math.min(sz, 8192));
  let fd = fs.openSync(file, 'r');
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
  const t = idx.map((i) => rec.t0Ms + (i / rec.fs) * 1000);
  const durMin = (t[t.length - 1] - t[0]) / 60000;
  return { t, bpm: t.length / durMin, fs: rec.fs };
}
function beatsPPG(file) {
  const rec = PPG.parsePPG(fs.readFileSync(file, 'utf8'));
  if (!rec) return null;
  const an = PPG.analyze(rec);
  if (!an || !an.tt || an.tt.length < 100) return null;
  const t0 = rec.t0Ms;
  const t = an.tt.map((s) => t0 + s * 1000);
  const durMin = (t[t.length - 1] - t[0]) / 60000;
  return { t, bpm: t.length / durMin };
}

console.log('PAT scatter vs WINDOW LENGTH — drift integrates, physiology does not');
console.log('selection is STRUCTURAL only: one fragment each side, span >= 40 min, 30-120 bpm both\n');
const nights = fs
  .readdirSync(DIR)
  .filter((d) => /^2026-/.test(d) && (!ONLY || d === ONLY) && fs.statSync(path.join(DIR, d)).isDirectory())
  .sort();
const rows = [];
for (const n of nights) {
  const dir = path.join(DIR, n);
  const files = fs.readdirSync(dir);
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
    console.log(`  ${n}  ⊘ no fragment pair clearing the 40-min gate (ECG ${E.length} / PPG ${P.length})`);
    continue;
  }
  // structural pairing: the ECG/PPG fragments with the largest device-time overlap
  let best = null;
  for (const e of E)
    for (const p of P) {
      const ov = Math.min(e.z, p.z) - Math.max(e.a, p.a);
      if (ov > 0 && (!best || ov > best.ov)) best = { e, p, ov };
    }
  if (!best || best.ov < 10 * 60000) {
    console.log(`  ${n}  ⊘ no ≥10 min overlap between gated fragments`);
    continue;
  }
  let B1 = null,
    B2 = null;
  try {
    B1 = beatsECG(best.e.f);
    B2 = beatsPPG(best.p.f);
  } catch (err) {
    console.log(`  ${n}  ⊘ ${err.message.slice(0, 60)}`);
    continue;
  }
  if (!B1 || !B2) {
    console.log(`  ${n}  ⊘ detector produced too few beats`);
    continue;
  }
  if (B1.bpm < RATE_LO || B1.bpm > RATE_HI || B2.bpm < RATE_LO || B2.bpm > RATE_HI) {
    console.log(`  ${n}  ⊘ implausible rate — ECG ${B1.bpm.toFixed(0)}/min · PPG ${B2.bpm.toFixed(0)}/min (not beats)`);
    continue;
  }
  /* pair each R-peak with the NEXT foot inside the physiological window */
  const lags = [],
    at = [];
  let j = 0;
  for (const r of B1.t) {
    while (j < B2.t.length && B2.t[j] < r + PHYS_LO) j++;
    if (j >= B2.t.length) break;
    const d = B2.t[j] - r;
    if (d >= PHYS_LO && d <= PHYS_HI) {
      lags.push(d);
      at.push(r);
    }
  }
  if (lags.length < 200) {
    console.log(`  ${n}  ⊘ only ${lags.length} paired beats`);
    continue;
  }
  const t0 = at[0];
  const out = { night: n, n: lags.length, ovMin: best.ov / 60000, medLag: med(lags), by: {} };
  for (const W of WINDOWS_MIN) {
    const wm = W * 60000,
      per = [];
    for (let s = t0; s < at[at.length - 1]; s += wm) {
      const seg = [];
      for (let k = 0; k < lags.length; k++) if (at[k] >= s && at[k] < s + wm) seg.push(lags[k]);
      if (seg.length >= 30) per.push(iqr(seg));
    }
    out.by[W] = per.length ? med(per) : NaN;
  }
  rows.push(out);
  console.log(
    `  ${n}  beats=${String(out.n).padStart(5)}  ovl=${out.ovMin.toFixed(0)}m  medLag=${out.medLag.toFixed(0)}ms  ` +
      WINDOWS_MIN.map((W) => `${W}m:${isFinite(out.by[W]) ? out.by[W].toFixed(0) : '--'}`).join('  ')
  );
}
if (rows.length) {
  console.log('\n  ── median residual IQR (ms) across nights, by window length ──');
  console.log('    window:  ' + WINDOWS_MIN.map((W) => String(W + 'm').padStart(6)).join(''));
  console.log(
    '    IQR   :  ' +
      WINDOWS_MIN.map((W) => {
        const v = rows.map((r) => r.by[W]).filter(isFinite);
        return String(v.length ? med(v).toFixed(0) : '--').padStart(6);
      }).join('')
  );
  const s = WINDOWS_MIN.map((W) => {
    const v = rows.map((r) => r.by[W]).filter(isFinite);
    return v.length ? med(v) : NaN;
  });
  const lo = s[0],
    hi = s[s.length - 1];
  console.log(`\n  1 min → 60 min:  ${isFinite(lo) ? lo.toFixed(0) : '--'} → ${isFinite(hi) ? hi.toFixed(0) : '--'} ms` + (isFinite(lo) && isFinite(hi) ? `   (×${(hi / lo).toFixed(2)})` : ''));
  console.log('  GROWS  ⇒ drift/misalignment integrates ⇒ PAT recoverable in short windows.');
  console.log('  FLAT   ⇒ stationary beat-to-beat variability ⇒ physiology (PEP+PTT), not the clock.');
  console.log(`  n = ${rows.length} night(s).`);
} else {
  console.log('\n  no night met the structural criteria — that is itself the result (see the ⊘ reasons).');
}
