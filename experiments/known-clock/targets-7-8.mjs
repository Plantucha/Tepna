// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const C = createRequire('/run/media/michal/647A504F7A50205A/wt-knownclock/x.js')('/run/media/michal/647A504F7A50205A/wt-knownclock/clock.js');
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const hs = (s) => {
  const m = ISO.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : null;
};
const mono = (a) => {
  let b = [],
    c = a.length ? [a[0]] : [];
  for (let i = 1; i < a.length; i++) {
    if (a[i].devMs >= a[i - 1].devMs) c.push(a[i]);
    else {
      if (c.length > b.length) b = c;
      c = [a[i]];
    }
  }
  return c.length > b.length ? c : b;
};
function load(f, mf) {
  const o = [];
  for (const ln of readFileSync(f, 'utf8').split('\n').slice(1)) {
    const c = ln.split(';');
    if (c.length < 4) continue;
    if (mf && c[2] !== mf) continue;
    const h = hs(c[0]),
      n = Number(c[3]);
    if (h === null || !isFinite(n)) continue;
    o.push({ hostMs: h, devMs: n / 1e6 });
  }
  return mono(o);
}
const pear = (x, y) => {
  const n = x.length,
    mx = x.reduce((a, b) => a + b, 0) / n,
    my = y.reduce((a, b) => a + b, 0) / n;
  let sx = 0,
    sy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx,
      b = y[i] - my;
    sx += a * a;
    sy += b * b;
    sxy += a * b;
  }
  return sxy / Math.sqrt(sx * sy);
};
const q = (a, p) => {
  const s = [...a].sort((u, v) => u - v);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const med = (a) => q(a, 0.5);

/* TARGET 8 — HOST-INDUCED ARTIFACTS.
   Two devices, one capture host, same wall clock. A HOST disturbance is COMMON-MODE: it shifts both
   residuals at the same instant. A device/transport disturbance is not. So correlate the two
   residual series on a shared 1 s host-time grid. */
console.log('=== TARGET 8 · host-induced artifacts (common-mode test) ===');
const pairs = [];
for (const d of readdirSync('/tmp/kc-corpus').sort()) {
  const dir = join('/tmp/kc-corpus', d);
  let st;
  try {
    st = statSync(dir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  const fs_ = readdirSync(dir);
  const H = fs_.filter((x) => /H10.*PMDARRIVAL/.test(x)).map((x) => join(dir, x));
  const V = fs_.filter((x) => /Verity.*PMDARRIVAL/.test(x)).map((x) => join(dir, x));
  for (const hf of H)
    for (const vf of V) {
      const A = load(hf, 'ecg'),
        B = load(vf, 'ppg');
      if (A.length < 500 || B.length < 500) continue;
      const lo = Math.max(A[0].hostMs, B[0].hostMs),
        hi = Math.min(A[A.length - 1].hostMs, B[B.length - 1].hostMs);
      if (hi - lo < 3600e3) continue; // need >=1 h of genuine overlap
      const grid = [];
      for (let t = lo; t <= hi; t += 60000) grid.push(t); // 1 min grid
      const samp = (S) => {
        const r0 = S[0].hostMs - S[0].devMs;
        let i = 0;
        return grid.map((t) => {
          while (i < S.length - 1 && S[i].hostMs < t) i++;
          return S[i].hostMs - S[i].devMs - r0;
        });
      };
      const a = samp(A),
        b = samp(B);
      // remove each device's own linear rate — what remains is the non-rate residual
      const detr = (v) => {
        const n = v.length;
        const mx = (n - 1) / 2,
          my = v.reduce((s, x) => s + x, 0) / n;
        let sxy = 0,
          sxx = 0;
        for (let i = 0; i < n; i++) {
          sxy += (i - mx) * (v[i] - my);
          sxx += (i - mx) ** 2;
        }
        const sl = sxy / sxx;
        return v.map((x, i) => x - (my + sl * (i - mx)));
      };
      const da = detr(a),
        db = detr(b);
      pairs.push({ night: d, hours: (hi - lo) / 3.6e6, r: pear(da, db), sdA: Math.sqrt(da.reduce((s, x) => s + x * x, 0) / da.length), sdB: Math.sqrt(db.reduce((s, x) => s + x * x, 0) / db.length) });
    }
}
if (!pairs.length) console.log('  no qualifying simultaneous pairs');
else {
  console.log(`  pairs=${pairs.length}  med overlap=${med(pairs.map((p) => p.hours)).toFixed(1)} h`);
  console.log(
    `  median correlation of detrended residuals r = ${med(pairs.map((p) => p.r)).toFixed(3)}   [${Math.min(...pairs.map((p) => p.r)).toFixed(3)}, ${Math.max(...pairs.map((p) => p.r)).toFixed(3)}]`
  );
  console.log(`  residual SD: H10 ${med(pairs.map((p) => p.sdA)).toFixed(1)} ms   Verity ${med(pairs.map((p) => p.sdB)).toFixed(1)} ms`);
  const shared = med(pairs.map((p) => p.r));
  console.log(`  => common-mode (host) share of residual variance ~ ${(shared * 100).toFixed(1)} %; the rest is device/transport`);
  console.log(`  host RMS offset is 19.5 us = ${((0.0195 / med(pairs.map((p) => p.sdA))) * 100).toFixed(4)} % of the H10 residual SD`);
}

/* TARGET 7 — SENSOR-SPECIFIC NOISE, at MATCHED span so span cannot masquerade as device. */
console.log('\n=== TARGET 7 · sensor-specific noise (matched span) ===');
const rows = [];
for (const d of readdirSync('/tmp/kc-corpus').sort()) {
  const dir = join('/tmp/kc-corpus', d);
  let st;
  try {
    st = statSync(dir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (!/PMDARRIVAL/.test(f)) continue;
    const dev = /O2Ring/i.test(f) ? 'O2Ring' : /Verity/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : null;
    if (!dev || dev === 'O2Ring') continue;
    for (const meas of dev === 'H10' ? ['ecg', 'acc'] : ['ppg', 'acc']) {
      const a = load(p, meas);
      if (a.length < 300) continue;
      const full = (a[a.length - 1].devMs - a[0].devMs) / 1000;
      for (const S of [1200, 4800]) {
        if (full < S) continue;
        const t0 = a[0].devMs;
        const sub = a.filter((x) => x.devMs - t0 <= S * 1000);
        if (sub.length < 100) continue;
        const r = C.hostAxis(sub);
        if (r.ok && r.stability) rows.push({ dev, meas, S, sig: r.stability.ppmUncertainty, slope: r.stability.slope, spread: r.spreadMs });
      }
    }
  }
}
console.log(' device/meas   span    n   med sigma_y(ppm)   med Allan slope   med spreadMs');
for (const S of [1200, 4800])
  for (const k of ['H10/ecg', 'H10/acc', 'Verity/ppg', 'Verity/acc']) {
    const [dv, ms] = k.split('/');
    const s = rows.filter((r) => r.dev === dv && r.meas === ms && r.S === S);
    if (s.length < 3) continue;
    console.log(
      `  ${k.padEnd(12)} ${String(S).padStart(5)}s ${String(s.length).padStart(4)} ${med(s.map((r) => r.sig))
        .toFixed(1)
        .padStart(17)} ${med(s.map((r) => r.slope))
        .toFixed(3)
        .padStart(17)} ${med(s.map((r) => r.spread))
        .toFixed(0)
        .padStart(14)}`
    );
  }
