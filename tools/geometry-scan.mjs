/*
 * geometry-scan.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * WALK THE TIMELINE-ALIGNMENT CHAIN AND PROBE EVERY STAGE (PAT-GEOMETRY-PROBE-2026-08-11).
 *
 * `geometry-probe.mjs` holds the detectors and is pure. This walks a real recording through the stages
 * that produce or consume a time axis and runs the probes on each one, so a defect is attributed to a
 * STAGE instead of being noticed later in whatever statistic happens to expose it. Every finding in
 * PAT-WANDER-ELIMINATION and PAT-WINDOW-CENSORING was one of these five shapes at one of these stages,
 * found by eye, weeks apart, usually after a wrong conclusion had been published.
 *
 * Stages, in the order a sample travels:
 *   1 ECG sample axis      ECGDSP.parseECG -> tMsAt        drawn? step?
 *   2 ECG beat times       detectPeaks -> tMsAt            step?
 *   3 PPG sample axis      PPGDSP.parsePPG -> relSec       drawn? step?
 *   4 PPG foot times       detectChannel -> foot           step?
 *   5 R->foot lag          RR-bounded, NO window           saturation? sawtooth? censoring?
 *   6 binned lag medians   5-min medians                   saturation? sawtooth? step?
 *
 * Stage 5 is deliberately computed WITHOUT the physiological window: the window is itself one of the
 * things being probed, so pairing through it would hide the censoring it causes. The bound is
 * 0.9 x the local RR, which is what actually prevents beat slip.
 *
 * ⚠️ READ `drawn` AT STAGE 1/3 AS A LEAD, NOT A VERDICT. A host-disciplined axis interpolates between
 * anchors, so over a 5000-sample window its correction can be locally CONSTANT and the deltas come out
 * exact — which fires `drawn` on an axis that is not synthesized. The share separates the cases in
 * practice (measured: an exact ladder 1.000, the O2Ring's legacy synthesized stamp 0.993, a real
 * corrected axis 0.61-0.74), but the probe cannot tell them apart on its own. Confirm against
 * `hostAxis.applied` / the file's `# timebase=` header before calling an axis drawn.
 *
 * Usage:  node tools/geometry-scan.mjs <night-dir> [<night-dir> …]
 * Reads only the files it is pointed at; writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { probeAll, saturation, sawtooth, censoring, drawnAxis, stepiness } from './geometry-probe.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PHYS_LO = 200,
  PHYS_HI = 650,
  BIN = 5 * 60000;

function loadDsp() {
  const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
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
    parseFloat,
    Infinity,
    NaN
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  return { E: ctx.ECGDSP, P: ctx.PPGDSP };
}
const asc = (a) =>
  Array.from(a)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
const qt = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
const med = (a) => qt(asc(a), 0.5);
function feet(bp, peaks, fsHz, winMs) {
  const out = [],
    W = Math.round((winMs * fsHz) / 1000);
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k],
      prev = k > 0 ? peaks[k - 1] : Math.max(0, p - W),
      lo = Math.max(prev, p - W);
    let mi = lo,
      mv = bp[lo];
    for (let j = lo; j < p; j++)
      if (bp[j] < mv) {
        mv = bp[j];
        mi = j;
      }
    let ms = mi,
      msv = -Infinity;
    for (let j = mi; j < p; j++) {
      const dv = bp[j + 1] - bp[j];
      if (dv > msv) {
        msv = dv;
        ms = j;
      }
    }
    out.push(msv > 1e-12 ? Math.max(lo, Math.min(p, ms - (bp[ms] - mv) / msv)) : ms);
  }
  return out;
}
const pick = (dir, re) => {
  const c = fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.s - a.s);
  return c.length ? c[0].f : null;
};
const verdict = (fired) => (fired.length ? fired.join(', ').toUpperCase() : 'ok');

function scan(dir, dsp) {
  const { E, P } = dsp;
  const ef = pick(dir, /Polar_H10_.*_ECG\.txt$/i);
  if (!ef) return;
  const er = E.parseECG(fs.readFileSync(ef, 'utf8'));
  const idx = Array.from(E.detectPeaks(er.int16, E.bandpass(er.int16, er.fs), er.fs));
  const R = idx.map((i) => er.tMsAt(i));
  const row = (stage, res) => console.log('  ' + stage.padEnd(26) + verdict(res.fired || []).padEnd(22) + (res.note || ''));

  console.log('\n=== ' + path.basename(dir));
  // 1 — ECG sample axis, sampled sparsely (millions of samples; the shape is scale-free)
  {
    /* TWO SAMPLINGS, because the two probes need opposite things and one sampling makes one of them
       INERT. `drawn` looks at consecutive inter-sample deltas, so it must see a CONTIGUOUS block —
       decimating an exact ladder turns constant deltas into an interpolated series and the signature
       disappears, which is how the first cut reported "ok" on the O2Ring's known-synthesized axis.
       `step` is scale-free and wants whole-record coverage, so it takes the decimated series. */
    const step = Math.max(1, Math.floor(er.int16.length / 4000));
    const t = [];
    for (let i = 0; i < er.int16.length; i += step) t.push(er.tMsAt(i));
    const contig = [];
    for (let i = 0; i < Math.min(er.int16.length, 5000); i++) contig.push(er.tMsAt(i));
    const d = drawnAxis(contig),
      s = stepiness(t);
    row('1 ECG sample axis', {
      fired: [d.drawn && 'drawn', s.hasStep && 'step'].filter(Boolean),
      note: 'ladder fine/coarse ' + (d.shares ? d.shares.fine.toFixed(3) + '/' + d.shares.coarse.toFixed(3) : '-') + '  step-ratio ' + (s.ratio != null ? s.ratio.toFixed(1) : '-')
    });
  }
  // 2 — ECG beat times
  {
    const s = stepiness(R);
    row('2 ECG beat times', { fired: [s.hasStep && 'step'].filter(Boolean), note: 'step-ratio ' + s.ratio.toFixed(1) + '  n=' + R.length });
  }

  for (const [site, re] of [
    ['finger', /O2Ring.*_PPG\.txt$/i],
    ['ankle', /veritysense.*_PPG\.txt$/i]
  ]) {
    const pf = pick(dir, re);
    if (!pf) continue;
    const pr = P.parsePPG(fs.readFileSync(pf, 'utf8'));
    const det = P.detectChannel(pr.ch[0], pr.fs),
      n = pr.ch[0].length;
    const toMs = (i) => {
      const a = Math.floor(i),
        b = Math.min(n - 1, a + 1);
      const sa = pr.relSec && Number.isFinite(pr.relSec[a]) ? pr.relSec[a] : a / pr.fs;
      const sb = pr.relSec && Number.isFinite(pr.relSec[b]) ? pr.relSec[b] : b / pr.fs;
      return pr.t0Ms + (sa + (sb - sa) * (i - a)) * 1000;
    };
    // 3 — PPG sample axis
    {
      const step = Math.max(1, Math.floor(n / 4000));
      const t = [];
      for (let i = 0; i < n; i += step) t.push(toMs(i));
      const contig = [];
      for (let i = 0; i < Math.min(n, 5000); i++) contig.push(toMs(i));
      const d = drawnAxis(contig),
        s = stepiness(t);
      row('3 PPG axis (' + site + ')', {
        fired: [d.drawn && 'drawn', s.hasStep && 'step'].filter(Boolean),
        note: 'ladder fine/coarse ' + (d.shares ? d.shares.fine.toFixed(3) + '/' + d.shares.coarse.toFixed(3) : '-') + '  step-ratio ' + s.ratio.toFixed(1)
      });
    }
    const F = feet(det.bp, det.peaks, pr.fs, 150).map(toMs);
    // 4 — PPG foot times
    {
      const s = stepiness(F);
      row('4 PPG foot times (' + site + ')', { fired: [s.hasStep && 'step'].filter(Boolean), note: 'step-ratio ' + s.ratio.toFixed(1) + '  n=' + F.length });
    }
    // 5 — R->foot lag, RR-bounded, NO window (the window is under test)
    const lag = [];
    let j = 0;
    for (let i = 0; i + 1 < R.length; i++) {
      const r = R[i],
        rr = R[i + 1] - r;
      if (!(rr > 300 && rr < 2000)) continue;
      while (j < F.length && F[j] < r) j++;
      for (let k = j; k < F.length; k++) {
        const L = F[k] - r;
        if (L > 0.9 * rr) break;
        if (L > 0) {
          lag.push([r, L]);
          break;
        }
      }
    }
    if (lag.length < 500) {
      row('5 R->foot lag (' + site + ')', { fired: [], note: 'only ' + lag.length + ' pairs' });
      continue;
    }
    const v = lag.map((x) => x[1]);
    {
      const c = censoring(v, PHYS_LO, PHYS_HI),
        sa = saturation(v, PHYS_LO, PHYS_HI);
      row('5 R->foot lag (' + site + ')', {
        fired: [c.censored && 'censoring', sa.saturated && 'saturation'].filter(Boolean),
        note: 'median ' + med(v).toFixed(0) + '  discarded ' + (100 * c.outside).toFixed(1) + '%'
      });
    }
    // 6 — binned medians
    const t0 = lag[0][0],
      t1 = lag[lag.length - 1][0],
      bm = [];
    for (let b = t0; b < t1; b += BIN) {
      const w = lag.filter((x) => x[0] >= b && x[0] < b + BIN).map((x) => x[1]);
      if (w.length >= 40) bm.push(med(w));
    }
    if (bm.length >= 12) {
      const rrMed = med(
        R.slice(1)
          .map((x, i) => x - R[i])
          .filter((x) => x > 300 && x < 2000)
      );
      const sw = sawtooth(bm, rrMed),
        st = stepiness(bm),
        sa = saturation(bm, PHYS_LO, PHYS_HI);
      row('6 binned lag (' + site + ')', {
        fired: [sw.isSawtooth && 'sawtooth', st.hasStep && 'step', sa.saturated && 'saturation'].filter(Boolean),
        note: 'bins ' + bm.length + '  wraps ' + sw.wraps + '  step-ratio ' + st.ratio.toFixed(1)
      });
    }
  }
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: node tools/geometry-scan.mjs <night-dir> [<night-dir> …]');
  process.exit(2);
}
const dsp = loadDsp();
console.log('stage                       probes fired');
for (const d of dirs) {
  try {
    scan(d, dsp);
  } catch (e) {
    console.log('\n=== ' + path.basename(d) + '  ERROR: ' + ((e && e.message) || e));
  }
}
