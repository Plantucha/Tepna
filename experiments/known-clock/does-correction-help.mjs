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
function* files(root) {
  for (const d of readdirSync(root).sort()) {
    const p = join(root, d);
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) if (f.endsWith('_PMDARRIVAL.csv')) yield join(p, f);
  }
}
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
/* TRUTH = the rate measured over the stream's FULL span, used only where that full-span estimate is
   itself resolved (|ppm| > sigma_y). Then: does a SHORT-span estimate get closer to that truth than
   applying no correction at all (i.e. 0 ppm)? */
const out = [];
for (const f of files('/tmp/kc-corpus')) {
  const dev = /O2Ring/i.test(f) ? 'O2Ring' : /Verity/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : 'other';
  if (dev === 'O2Ring') continue;
  const byM = new Map();
  for (const ln of readFileSync(f, 'utf8').split('\n').slice(1)) {
    const c = ln.split(';');
    if (c.length < 4) continue;
    const h = hs(c[0]),
      n = Number(c[3]);
    if (h === null || !isFinite(n)) continue;
    (byM.get(c[2]) ?? byM.set(c[2], []).get(c[2])).push({ hostMs: h, devMs: n / 1e6 });
  }
  for (const [meas, raw] of byM) {
    if (meas === 'ppi') continue;
    const a = mono(raw);
    if (a.length < 400) continue;
    const full = (a[a.length - 1].devMs - a[0].devMs) / 1000;
    if (full < 9600) continue; // need a trustworthy truth
    const T = C.hostAxis(a);
    if (!T.ok || !T.stability) continue;
    if (!(Math.abs(T.ppm) > T.stability.ppmUncertainty)) continue; // truth must be resolved
    const truth = T.ppm,
      t0 = a[0].devMs;
    for (const S of [2400, 4800, 9600]) {
      if (full < S * 1.2) continue;
      const sub = a.filter((x) => x.devMs - t0 <= S * 1000);
      if (sub.length < 50) continue;
      const r = C.hostAxis(sub);
      if (!r.ok) continue;
      out.push({ dev, spanS: S, truth, est: r.ppm, errCorrected: Math.abs(r.ppm - truth), errUncorrected: Math.abs(truth) });
    }
  }
}
const q = (x, p) => {
  const s = [...x].sort((u, v) => u - v);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
console.log(`does applying the short-span correction HELP? n=${out.length} (stream,span) pairs`);
console.log('truth = full-span rate, only where the full-span estimate is itself resolved\n');
console.log('span     n   med|err| CORRECTED   med|err| UNCORRECTED   correction HELPED');
for (const S of [2400, 4800, 9600]) {
  const s = out.filter((o) => o.spanS === S);
  if (!s.length) continue;
  const helped = s.filter((o) => o.errCorrected < o.errUncorrected).length;
  const mark = S === 2400 ? '   <-- shipped gate' : '';
  console.log(
    `${String(S).padStart(5)}s ${String(s.length).padStart(3)} ${q(
      s.map((o) => o.errCorrected),
      0.5
    )
      .toFixed(2)
      .padStart(18)} ${q(
      s.map((o) => o.errUncorrected),
      0.5
    )
      .toFixed(2)
      .padStart(22)} ${((helped / s.length) * 100).toFixed(0).padStart(17)}%${mark}`
  );
}
console.log('\nworst case at the shipped gate:');
const g = out.filter((o) => o.spanS === 2400);
if (g.length) {
  const w = g.reduce((a, b) => (b.errCorrected > a.errCorrected ? b : a));
  console.log(`  ${w.dev}: truth ${w.truth.toFixed(1)} ppm, 2400 s estimate ${w.est.toFixed(1)} ppm -> error ${w.errCorrected.toFixed(1)} ppm (vs ${w.errUncorrected.toFixed(1)} uncorrected)`);
}
